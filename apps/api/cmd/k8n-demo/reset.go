package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"slices"
	"strings"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/clientcmd"
)

// The cluster as it was set up, so a reset knows what visitors added. Only
// namespaces and what sits in default are tracked: the visitor's account can
// write nothing cluster-wide and nothing in the system namespaces.
type Baseline struct {
	Namespaces []string    `json:"namespaces"`
	Default    []types.UID `json:"default"`
}

type Cluster struct {
	kube *kubernetes.Clientset
	dyn  dynamic.Interface
}

func connect(kubeconfig string) (*Cluster, error) {
	cfg, err := clientcmd.BuildConfigFromFlags("", kubeconfig)
	if err != nil {
		return nil, err
	}
	kube, err := kubernetes.NewForConfig(cfg)
	if err != nil {
		return nil, err
	}
	dyn, err := dynamic.NewForConfig(cfg)
	return &Cluster{kube, dyn}, err
}

// inDefault lists everything the account can list and delete in default.
// Children the system keeps (events, endpoints) are left to the system.
func (c *Cluster) inDefault(ctx context.Context, each func(schema.GroupVersionResource, metav1.Object)) error {
	lists, err := c.kube.Discovery().ServerPreferredNamespacedResources()
	if err != nil && len(lists) == 0 {
		return err
	}
	for _, l := range lists {
		gv, _ := schema.ParseGroupVersion(l.GroupVersion)
		for _, r := range l.APIResources {
			if strings.Contains(r.Name, "/") || !slices.Contains(r.Verbs, "list") || !slices.Contains(r.Verbs, "delete") ||
				slices.Contains([]string{"events", "endpoints", "endpointslices", "leases"}, r.Name) {
				continue
			}
			gvr := gv.WithResource(r.Name)
			items, err := c.dyn.Resource(gvr).Namespace("default").List(ctx, metav1.ListOptions{})
			if err != nil {
				continue // not the account's to list, so not the visitor's to have made
			}
			for i := range items.Items {
				each(gvr, &items.Items[i])
			}
		}
	}
	return nil
}

func (c *Cluster) Snapshot(ctx context.Context) (Baseline, error) {
	var b Baseline
	nss, err := c.kube.CoreV1().Namespaces().List(ctx, metav1.ListOptions{})
	if err != nil {
		return b, err
	}
	for _, ns := range nss.Items {
		b.Namespaces = append(b.Namespaces, ns.Name)
	}
	err = c.inDefault(ctx, func(_ schema.GroupVersionResource, o metav1.Object) { b.Default = append(b.Default, o.GetUID()) })
	return b, err
}

// Wipe deletes every namespace and every object in default that the baseline
// does not have, and waits for the namespaces to finish going.
func (c *Cluster) Wipe(ctx context.Context, b Baseline) error {
	background := metav1.DeletePropagationBackground
	gone := metav1.DeleteOptions{PropagationPolicy: &background}
	nss, err := c.kube.CoreV1().Namespaces().List(ctx, metav1.ListOptions{})
	if err != nil {
		return err
	}
	var doomed []string
	for _, ns := range nss.Items {
		if !slices.Contains(b.Namespaces, ns.Name) {
			doomed = append(doomed, ns.Name)
			if ns.DeletionTimestamp == nil {
				_ = c.kube.CoreV1().Namespaces().Delete(ctx, ns.Name, gone)
			}
		}
	}
	err = c.inDefault(ctx, func(gvr schema.GroupVersionResource, o metav1.Object) {
		if !slices.Contains(b.Default, o.GetUID()) {
			_ = c.dyn.Resource(gvr).Namespace("default").Delete(ctx, o.GetName(), gone)
		}
	})
	if err != nil {
		return err
	}
	// ponytail: a namespace held by a finalizer is left terminating after 2
	// minutes and the next visitor starts anyway; clear finalizers if it happens.
	for deadline := time.Now().Add(2 * time.Minute); len(doomed) > 0 && time.Now().Before(deadline); {
		time.Sleep(2 * time.Second)
		doomed = slices.DeleteFunc(doomed, func(ns string) bool {
			_, err := c.kube.CoreV1().Namespaces().Get(ctx, ns, metav1.GetOptions{})
			return err != nil
		})
	}
	if len(doomed) > 0 {
		return fmt.Errorf("still terminating: %s", strings.Join(doomed, ", "))
	}
	return nil
}

// Machine says what one session gets, from what the node offers pods.
func (c *Cluster) Machine(ctx context.Context) string {
	nodes, err := c.kube.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
	if err != nil || len(nodes.Items) == 0 {
		return "a small free Oracle Cloud machine"
	}
	a := nodes.Items[0].Status.Allocatable
	return fmt.Sprintf("%s CPU cores, %.0f GB of memory and room for %s pods",
		a.Cpu().String(), float64(a.Memory().Value())/(1<<30), a.Pods().String())
}

// Engine is one k8n for one visitor: its own home directory, so saved
// workflows, history and any AI key go when it does.
type Engine struct {
	Bin, Home, Kubeconfig, Origin string
	Port                          int
	cmd                           *exec.Cmd
}

func (e *Engine) Start() error {
	if err := os.RemoveAll(e.Home); err != nil {
		return err
	}
	if err := os.MkdirAll(e.Home, 0o700); err != nil {
		return err
	}
	cmd := exec.Command(e.Bin, "--port", fmt.Sprint(e.Port))
	// Only what it needs: nothing of the gate's environment, no API keys.
	cmd.Env = []string{
		"PATH=" + os.Getenv("PATH"), "HOME=" + e.Home, "USERPROFILE=" + e.Home, "SystemRoot=" + os.Getenv("SystemRoot"),
		"KUBECONFIG=" + e.Kubeconfig, "API_HOST=127.0.0.1", "K8N_NO_AUTH=true", "ALLOWED_ORIGINS=" + e.Origin,
	}
	cmd.Dir = e.Home
	cmd.Stdout, cmd.Stderr = os.Stderr, os.Stderr
	if err := cmd.Start(); err != nil {
		return err
	}
	e.cmd = cmd
	for range 60 {
		if res, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/health", e.Port)); err == nil {
			res.Body.Close()
			return nil
		}
		time.Sleep(500 * time.Millisecond)
	}
	return fmt.Errorf("k8n did not come up on port %d", e.Port)
}

func (e *Engine) Stop() {
	if e.cmd != nil {
		_ = e.cmd.Process.Kill()
		_ = e.cmd.Wait()
		e.cmd = nil
	}
	_ = os.RemoveAll(e.Home)
}

func loadBaseline(path string) (Baseline, error) {
	var b Baseline
	data, err := os.ReadFile(path)
	if err == nil {
		err = json.Unmarshal(data, &b)
	}
	return b, err
}

// resetLoop runs each reset the room asks for: stop the old k8n, clear the
// cluster, start a fresh k8n, then let the next visitor in.
func resetLoop(room *Room, cluster *Cluster, base Baseline, engine *Engine) {
	for range room.Resets() {
		start := time.Now()
		engine.Stop()
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		if err := cluster.Wipe(ctx, base); err != nil {
			log.Printf("reset: %v", err)
		}
		cancel()
		for err := engine.Start(); err != nil; err = engine.Start() {
			log.Printf("reset: k8n would not start, retrying: %v", err)
			engine.Stop()
			time.Sleep(5 * time.Second)
		}
		log.Printf("reset in %s", time.Since(start).Round(time.Second))
		room.Ready()
	}
}
