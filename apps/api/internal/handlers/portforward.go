package handlers

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/user/k8s-graph-controller/backend/internal/k8s"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/util/intstr"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/portforward"
	"k8s.io/client-go/transport/spdy"
)

// Port forwarding: `kubectl port-forward`, from a button.
//
// A pod's port lives on the cluster's own network, so "containerPort 3000"
// does not mean localhost:3000. This opens a tunnel on 127.0.0.1 of the machine
// running k8n — the same machine as the browser in the local setup — and keeps
// it until stopped or until the pod goes away.

// Forward is one open tunnel.
type Forward struct {
	ID         string `json:"id"`
	Namespace  string `json:"namespace"`
	Kind       string `json:"kind"` // what was asked for: Service or Pod
	Name       string `json:"name"`
	Pod        string `json:"pod"`
	RemotePort int    `json:"remotePort"`
	LocalPort  int    `json:"localPort"`
	URL        string `json:"url"`

	stop chan struct{}
}

var (
	forwardsMu sync.Mutex
	forwards   = map[string]*Forward{}
)

// forwardTarget resolves what to tunnel to: a running pod and the port on it.
// For a Service that means its selector and its targetPort, which may be named.
func forwardTarget(ctx context.Context, cs kubernetes.Interface, kind, namespace, name string, port int) (*corev1.Pod, int, error) {
	switch kind {
	case "Pod":
		pod, err := cs.CoreV1().Pods(namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return nil, 0, err
		}
		if port == 0 {
			port = firstContainerPort(pod)
		}
		if port == 0 {
			return nil, 0, badRequest("%s declares no port; say which one", name)
		}
		return pod, port, nil

	case "Service":
		svc, err := cs.CoreV1().Services(namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return nil, 0, err
		}
		if len(svc.Spec.Selector) == 0 {
			return nil, 0, badRequest("%s has no selector, so there is no pod behind it", name)
		}
		if len(svc.Spec.Ports) == 0 {
			return nil, 0, badRequest("%s exposes no ports", name)
		}
		sp := svc.Spec.Ports[0]
		for _, p := range svc.Spec.Ports {
			if int(p.Port) == port {
				sp = p
			}
		}
		pods, err := cs.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{
			LabelSelector: labels.SelectorFromSet(svc.Spec.Selector).String(),
		})
		if err != nil {
			return nil, 0, err
		}
		pod := readyPod(pods.Items)
		if pod == nil {
			return nil, 0, badRequest("no running pod behind %s yet", name)
		}
		target := targetPort(pod, sp)
		if target == 0 {
			return nil, 0, badRequest("could not find port %s on %s", sp.TargetPort.String(), pod.Name)
		}
		return pod, target, nil
	}
	return nil, 0, badRequest("%s cannot be port-forwarded; pick its Service or a Pod", kind)
}

func readyPod(pods []corev1.Pod) *corev1.Pod {
	sort.Slice(pods, func(i, j int) bool { return pods[i].Name < pods[j].Name })
	for i := range pods {
		p := &pods[i]
		if p.Status.Phase != corev1.PodRunning || p.DeletionTimestamp != nil {
			continue
		}
		for _, c := range p.Status.Conditions {
			if c.Type == corev1.PodReady && c.Status == corev1.ConditionTrue {
				return p
			}
		}
	}
	return nil
}

func targetPort(pod *corev1.Pod, sp corev1.ServicePort) int {
	switch {
	case sp.TargetPort.Type == intstr.String:
		for _, c := range pod.Spec.Containers {
			for _, p := range c.Ports {
				if p.Name == sp.TargetPort.StrVal {
					return int(p.ContainerPort)
				}
			}
		}
		return 0
	case sp.TargetPort.IntVal != 0:
		return int(sp.TargetPort.IntVal)
	default:
		return int(sp.Port) // targetPort defaults to port
	}
}

func firstContainerPort(pod *corev1.Pod) int {
	for _, c := range pod.Spec.Containers {
		for _, p := range c.Ports {
			return int(p.ContainerPort)
		}
	}
	return 0
}

// freeLocalPort prefers the pod's own port — Grafana on localhost:3000 is what
// anyone expects — and falls back to whatever the OS hands out.
func freeLocalPort(preferred int) (int, error) {
	if l, err := net.Listen("tcp", "127.0.0.1:"+strconv.Itoa(preferred)); err == nil {
		l.Close()
		return preferred, nil
	}
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}

// StartForward opens a tunnel and returns once it is listening.
func StartForward(client *k8s.Client, kind, namespace, name string, port int) (*Forward, error) {
	if err := guard(name, namespace); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pod, remote, err := forwardTarget(ctx, client.Clientset, kind, namespace, name, port)
	if err != nil {
		return nil, err
	}
	local, err := freeLocalPort(remote)
	if err != nil {
		return nil, err
	}

	transport, upgrader, err := spdy.RoundTripperFor(client.Config)
	if err != nil {
		return nil, err
	}
	url := client.Clientset.CoreV1().RESTClient().Post().
		Resource("pods").Namespace(namespace).Name(pod.Name).SubResource("portforward").URL()
	dialer := spdy.NewDialer(upgrader, &http.Client{Transport: transport}, "POST", url)

	stop, ready := make(chan struct{}), make(chan struct{})
	pf, err := portforward.NewOnAddresses(dialer, []string{"127.0.0.1"},
		[]string{fmt.Sprintf("%d:%d", local, remote)}, stop, ready, io.Discard, io.Discard)
	if err != nil {
		return nil, err
	}

	f := &Forward{
		ID:        fmt.Sprintf("%s-%s-%d", namespace, name, local),
		Namespace: namespace, Kind: kind, Name: name, Pod: pod.Name,
		RemotePort: remote, LocalPort: local,
		URL:  fmt.Sprintf("http://localhost:%d", local),
		stop: stop,
	}

	failed := make(chan error, 1)
	go func() {
		err := pf.ForwardPorts() // blocks until stopped or the pod goes away
		forwardsMu.Lock()
		delete(forwards, f.ID)
		forwardsMu.Unlock()
		failed <- err
	}()

	select {
	case <-ready:
	case err := <-failed:
		return nil, fmt.Errorf("the tunnel closed straight away: %v", err)
	case <-time.After(10 * time.Second):
		close(stop)
		return nil, fmt.Errorf("the tunnel did not open within 10s")
	}

	forwardsMu.Lock()
	forwards[f.ID] = f
	forwardsMu.Unlock()
	return f, nil
}

func listForwards() []*Forward {
	forwardsMu.Lock()
	defer forwardsMu.Unlock()
	out := make([]*Forward, 0, len(forwards))
	for _, f := range forwards {
		out = append(out, f)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

func stopForward(id string) bool {
	forwardsMu.Lock()
	f, ok := forwards[id]
	delete(forwards, id)
	forwardsMu.Unlock()
	if ok {
		close(f.stop)
	}
	return ok
}

func ListForwardsHandler() gin.HandlerFunc {
	return func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"forwards": listForwards()}) }
}

func StartForwardHandler(getClient ClientGetter) gin.HandlerFunc {
	return func(c *gin.Context) {
		client := getClient()
		if !requireCluster(c, client) {
			return
		}
		var req struct {
			Kind      string `json:"kind" binding:"required"`
			Namespace string `json:"namespace" binding:"required"`
			Name      string `json:"name" binding:"required"`
			Port      int    `json:"port"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Expected {kind, namespace, name, port?}"})
			return
		}
		f, err := StartForward(client, req.Kind, req.Namespace, req.Name, req.Port)
		if err != nil {
			opError(c, err)
			return
		}
		c.JSON(http.StatusOK, f)
	}
}

func StopForwardHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !stopForward(c.Param("id")) {
			c.JSON(http.StatusNotFound, gin.H{"error": "No such tunnel; it may have closed on its own"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"message": "Stopped"})
	}
}
