package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/user/k8s-graph-controller/backend/internal/k8s"
	autoscalingv1 "k8s.io/api/autoscaling/v1"
	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/httpstream"
	"k8s.io/apimachinery/pkg/util/validation"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/tools/remotecommand"
)

// Day-to-day operations on live objects: the things people otherwise open a
// terminal for. Each one is a plain function over kubernetes.Interface, so the
// tests run against a fake clientset, and a thin handler around it.
//
// Everything here refuses cluster machinery, same as delete.

var errBadRequest = errors.New("bad request")

func badRequest(format string, args ...any) error {
	return fmt.Errorf("%w: %s", errBadRequest, fmt.Sprintf(format, args...))
}

// opError maps the sentinel errors to status codes.
func opError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrProtected):
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error(), "hint": "k8n does not change cluster components; use kubectl if you really mean to."})
	case errors.Is(err, errBadRequest):
		c.JSON(http.StatusBadRequest, gin.H{"error": strings.TrimPrefix(err.Error(), errBadRequest.Error()+": ")})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
	}
}

func guard(name, namespace string) error {
	if IsProtected(name, namespace) {
		return fmt.Errorf("%w: %s/%s", ErrProtected, namespace, name)
	}
	return nil
}

// --- Secrets -------------------------------------------------------------------

// RevealSecret returns a Secret's values as text. The API already base64-decodes
// them; the page shows them only when someone clicks.
func RevealSecret(ctx context.Context, cs kubernetes.Interface, namespace, name string) (map[string]string, error) {
	if err := guard(name, namespace); err != nil {
		return nil, err
	}
	s, err := cs.CoreV1().Secrets(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}
	out := make(map[string]string, len(s.Data)+len(s.StringData))
	for k, v := range s.Data {
		out[k] = string(v)
	}
	for k, v := range s.StringData {
		out[k] = v
	}
	return out, nil
}

// --- Workloads -----------------------------------------------------------------

const maxReplicas = 100

// fieldManager is the name every k8n write is recorded under, the same one
// Apply uses, so a field's history reads "k8n" rather than "k8n.exe".
const fieldManager = "k8n"

// Scale sets a Deployment's or StatefulSet's replica count.
func Scale(ctx context.Context, cs kubernetes.Interface, kind, namespace, name string, replicas int32) error {
	if err := guard(name, namespace); err != nil {
		return err
	}
	if replicas < 0 || replicas > maxReplicas {
		return badRequest("replicas must be between 0 and %d", maxReplicas)
	}
	scale := &autoscalingv1.Scale{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: namespace},
		Spec:       autoscalingv1.ScaleSpec{Replicas: replicas},
	}
	var err error
	switch kind {
	case "Deployment":
		_, err = cs.AppsV1().Deployments(namespace).UpdateScale(ctx, name, scale, metav1.UpdateOptions{FieldManager: fieldManager})
	case "StatefulSet":
		_, err = cs.AppsV1().StatefulSets(namespace).UpdateScale(ctx, name, scale, metav1.UpdateOptions{FieldManager: fieldManager})
	default:
		return badRequest("%s cannot be scaled", kind)
	}
	return err
}

// Restart is `kubectl rollout restart`: changing a pod-template annotation makes
// the controller replace every pod, one batch at a time.
func Restart(ctx context.Context, cs kubernetes.Interface, kind, namespace, name string) error {
	if err := guard(name, namespace); err != nil {
		return err
	}
	patch := fmt.Sprintf(`{"spec":{"template":{"metadata":{"annotations":{"kubectl.kubernetes.io/restartedAt":%q}}}}}`,
		time.Now().Format(time.RFC3339))
	var err error
	switch kind {
	case "Deployment":
		_, err = cs.AppsV1().Deployments(namespace).Patch(ctx, name, types.StrategicMergePatchType, []byte(patch), metav1.PatchOptions{FieldManager: fieldManager})
	case "StatefulSet":
		_, err = cs.AppsV1().StatefulSets(namespace).Patch(ctx, name, types.StrategicMergePatchType, []byte(patch), metav1.PatchOptions{FieldManager: fieldManager})
	case "DaemonSet":
		_, err = cs.AppsV1().DaemonSets(namespace).Patch(ctx, name, types.StrategicMergePatchType, []byte(patch), metav1.PatchOptions{FieldManager: fieldManager})
	default:
		return badRequest("%s cannot be restarted", kind)
	}
	return err
}

const revisionAnnotation = "deployment.kubernetes.io/revision"

// Rollback is `kubectl rollout undo` for a Deployment: the pod template of the
// previous ReplicaSet becomes the Deployment's again. Returns the revision it
// went back to.
func Rollback(ctx context.Context, cs kubernetes.Interface, namespace, name string) (int, error) {
	if err := guard(name, namespace); err != nil {
		return 0, err
	}
	dep, err := cs.AppsV1().Deployments(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return 0, err
	}
	sets, err := cs.AppsV1().ReplicaSets(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return 0, err
	}

	type rev struct {
		n   int
		idx int
	}
	var revs []rev
	for i, rs := range sets.Items {
		owned := false
		for _, o := range rs.OwnerReferences {
			if o.UID == dep.UID {
				owned = true
			}
		}
		if n, err := strconv.Atoi(rs.Annotations[revisionAnnotation]); owned && err == nil {
			revs = append(revs, rev{n, i})
		}
	}
	if len(revs) < 2 {
		return 0, badRequest("%s has no earlier revision to go back to", name)
	}
	sort.Slice(revs, func(i, j int) bool { return revs[i].n > revs[j].n })
	previous := sets.Items[revs[1].idx]

	template := previous.Spec.Template.DeepCopy()
	delete(template.Labels, "pod-template-hash") // the controller adds its own
	body, err := json.Marshal([]map[string]any{{"op": "replace", "path": "/spec/template", "value": template}})
	if err != nil {
		return 0, err
	}
	_, err = cs.AppsV1().Deployments(namespace).Patch(ctx, name, types.JSONPatchType, body, metav1.PatchOptions{FieldManager: fieldManager})
	return revs[1].n, err
}

// --- Namespaces ----------------------------------------------------------------

func CreateNamespace(ctx context.Context, cs kubernetes.Interface, name string) error {
	if msgs := validation.IsDNS1123Label(name); len(msgs) > 0 {
		return badRequest("%q is not a valid namespace name: %s", name, strings.Join(msgs, "; "))
	}
	_, err := cs.CoreV1().Namespaces().Create(ctx, &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: name}}, metav1.CreateOptions{})
	return err
}

// DeleteNamespace deletes a namespace and everything in it. "default" is
// refused along with the system ones: Kubernetes would only recreate it, empty.
func DeleteNamespace(ctx context.Context, cs kubernetes.Interface, name string) error {
	if name == "default" || IsProtected("", name) {
		return fmt.Errorf("%w: namespace %s", ErrProtected, name)
	}
	return cs.CoreV1().Namespaces().Delete(ctx, name, metav1.DeleteOptions{})
}

// --- RBAC ----------------------------------------------------------------------

// Permission is one rule a ServiceAccount has, and where it comes from.
type Permission struct {
	Source    string   `json:"source"`
	Verbs     []string `json:"verbs"`
	Resources []string `json:"resources"`
	APIGroups []string `json:"apiGroups,omitempty"`
	Namespace string   `json:"namespace"` // "" = cluster-wide
}

// ServiceAccountPermissions answers "what can this ServiceAccount do?" by
// following every binding that names it or a group it belongs to.
func ServiceAccountPermissions(ctx context.Context, cs kubernetes.Interface, namespace, name string) ([]Permission, error) {
	matches := func(subjects []rbacv1.Subject) bool {
		for _, s := range subjects {
			switch {
			case s.Kind == "ServiceAccount" && s.Name == name && s.Namespace == namespace:
				return true
			case s.Kind == "Group" && (s.Name == "system:serviceaccounts" ||
				s.Name == "system:serviceaccounts:"+namespace || s.Name == "system:authenticated"):
				return true
			}
		}
		return false
	}

	rulesOf := func(ref rbacv1.RoleRef, ns string) []rbacv1.PolicyRule {
		if ref.Kind == "ClusterRole" {
			if r, err := cs.RbacV1().ClusterRoles().Get(ctx, ref.Name, metav1.GetOptions{}); err == nil {
				return r.Rules
			}
			return nil
		}
		if r, err := cs.RbacV1().Roles(ns).Get(ctx, ref.Name, metav1.GetOptions{}); err == nil {
			return r.Rules
		}
		return nil
	}

	var out []Permission
	add := func(source, ns string, rules []rbacv1.PolicyRule) {
		for _, r := range rules {
			resources := append(append([]string{}, r.Resources...), r.NonResourceURLs...)
			out = append(out, Permission{Source: source, Verbs: r.Verbs, Resources: resources, APIGroups: r.APIGroups, Namespace: ns})
		}
	}

	rbs, err := cs.RbacV1().RoleBindings(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	for _, b := range rbs.Items {
		if matches(b.Subjects) {
			add(fmt.Sprintf("%s %s via RoleBinding %s", b.RoleRef.Kind, b.RoleRef.Name, b.Name), namespace, rulesOf(b.RoleRef, namespace))
		}
	}
	crbs, err := cs.RbacV1().ClusterRoleBindings().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	for _, b := range crbs.Items {
		if matches(b.Subjects) {
			add(fmt.Sprintf("ClusterRole %s via ClusterRoleBinding %s", b.RoleRef.Name, b.Name), "", rulesOf(b.RoleRef, ""))
		}
	}
	return out, nil
}

// --- Ingress -------------------------------------------------------------------

// IngressClasses lists what can serve an Ingress. None means an Ingress on the
// canvas will be accepted and then do nothing at all.
func IngressClasses(ctx context.Context, cs kubernetes.Interface) ([]string, error) {
	list, err := cs.NetworkingV1().IngressClasses().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(list.Items))
	for _, ic := range list.Items {
		names = append(names, ic.Name)
	}
	return names, nil
}

// --- Exec ----------------------------------------------------------------------

const maxExecOutput = 64 << 10

// Exec runs one command in a container and returns what it printed. Not an
// interactive shell: most of what people open one for is a single command.
// ponytail: one-shot only; a real terminal needs a websocket and xterm.js.
func Exec(ctx context.Context, client *k8s.Client, namespace, pod, container, command string) (string, error) {
	if err := guard(pod, namespace); err != nil {
		return "", err
	}
	if strings.TrimSpace(command) == "" {
		return "", badRequest("no command")
	}

	run := func(argv []string) (string, error) {
		req := client.Clientset.CoreV1().RESTClient().Post().
			Resource("pods").Namespace(namespace).Name(pod).SubResource("exec").
			VersionedParams(&corev1.PodExecOptions{
				Container: container, Command: argv, Stdout: true, Stderr: true,
			}, scheme.ParameterCodec)
		// WebSockets first, as kubectl does since 1.30: over SPDY the output of a
		// short command was intermittently lost before the stream closed.
		ws, err := remotecommand.NewWebSocketExecutor(client.Config, "GET", req.URL().String())
		if err != nil {
			return "", err
		}
		spdy, err := remotecommand.NewSPDYExecutor(client.Config, "POST", req.URL())
		if err != nil {
			return "", err
		}
		exec, err := remotecommand.NewFallbackExecutor(ws, spdy, httpstream.IsUpgradeFailure)
		if err != nil {
			return "", err
		}
		// Separate writers: handing remotecommand one writer for both streams
		// intermittently dropped a short command's whole output.
		var stdout, stderr capped
		err = exec.StreamWithContext(ctx, remotecommand.StreamOptions{Stdout: &stdout, Stderr: &stderr})
		return stdout.String() + stderr.String(), err
	}

	// Through a shell first, so pipes and globs work; distroless images have no
	// shell, and then the command runs as plain words.
	out, err := run([]string{"sh", "-c", command})
	if err != nil && strings.Contains(err.Error(), "executable file not found") {
		out, err = run(strings.Fields(command))
	}
	return out, err
}

// capped keeps the first maxExecOutput bytes and drops the rest.
type capped struct{ bytes.Buffer }

func (c *capped) Write(p []byte) (int, error) {
	if room := maxExecOutput - c.Len(); room > 0 {
		if len(p) > room {
			c.Buffer.Write(p[:room])
			c.Buffer.WriteString("\n…(output cut at 64 KB)")
		} else {
			c.Buffer.Write(p)
		}
	}
	return len(p), nil
}

// --- Handlers ------------------------------------------------------------------

func withCluster(getClient ClientGetter, timeout time.Duration, fn func(c *gin.Context, ctx context.Context, client *k8s.Client)) gin.HandlerFunc {
	return func(c *gin.Context) {
		client := getClient()
		if !requireCluster(c, client) {
			return
		}
		ctx, cancel := context.WithTimeout(c.Request.Context(), timeout)
		defer cancel()
		fn(c, ctx, client)
	}
}

func RevealSecretHandler(getClient ClientGetter) gin.HandlerFunc {
	return withCluster(getClient, 10*time.Second, func(c *gin.Context, ctx context.Context, client *k8s.Client) {
		data, err := RevealSecret(ctx, client.Clientset, c.Param("namespace"), c.Param("name"))
		if err != nil {
			opError(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": data})
	})
}

type workloadRequest struct {
	Kind      string `json:"kind" binding:"required"`
	Namespace string `json:"namespace" binding:"required"`
	Name      string `json:"name" binding:"required"`
	Replicas  *int32 `json:"replicas"`
}

// WorkloadActionHandler serves POST /api/workload/:action (scale|restart|rollback).
func WorkloadActionHandler(getClient ClientGetter) gin.HandlerFunc {
	return withCluster(getClient, 20*time.Second, func(c *gin.Context, ctx context.Context, client *k8s.Client) {
		var req workloadRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Expected {kind, namespace, name}"})
			return
		}
		var (
			err     error
			message string
		)
		switch c.Param("action") {
		case "scale":
			if req.Replicas == nil {
				err = badRequest("replicas is required")
				break
			}
			err = Scale(ctx, client.Clientset, req.Kind, req.Namespace, req.Name, *req.Replicas)
			message = fmt.Sprintf("Scaled to %d", *req.Replicas)
		case "restart":
			err = Restart(ctx, client.Clientset, req.Kind, req.Namespace, req.Name)
			message = "Restarting: pods are being replaced a few at a time"
		case "rollback":
			if req.Kind != "Deployment" {
				err = badRequest("only a Deployment keeps revisions to roll back to")
				break
			}
			var rev int
			rev, err = Rollback(ctx, client.Clientset, req.Namespace, req.Name)
			message = fmt.Sprintf("Rolled back to revision %d", rev)
		default:
			err = badRequest("unknown action %q", c.Param("action"))
		}
		if err != nil {
			opError(c, err)
			return
		}
		Record(client, c.Param("action"), []string{req.Kind + "/" + req.Namespace + "/" + req.Name}, message)
		c.JSON(http.StatusOK, gin.H{"message": message})
	})
}

func CreateNamespaceHandler(getClient ClientGetter) gin.HandlerFunc {
	return withCluster(getClient, 10*time.Second, func(c *gin.Context, ctx context.Context, client *k8s.Client) {
		var req struct {
			Name string `json:"name" binding:"required"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Expected {name}"})
			return
		}
		if err := CreateNamespace(ctx, client.Clientset, strings.TrimSpace(req.Name)); err != nil {
			opError(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"message": "Namespace created"})
	})
}

func DeleteNamespaceHandler(getClient ClientGetter) gin.HandlerFunc {
	return withCluster(getClient, 10*time.Second, func(c *gin.Context, ctx context.Context, client *k8s.Client) {
		if err := DeleteNamespace(ctx, client.Clientset, c.Param("name")); err != nil {
			opError(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"message": "Namespace is being deleted, with everything in it"})
	})
}

func ServiceAccountPermissionsHandler(getClient ClientGetter) gin.HandlerFunc {
	return withCluster(getClient, 15*time.Second, func(c *gin.Context, ctx context.Context, client *k8s.Client) {
		perms, err := ServiceAccountPermissions(ctx, client.Clientset, c.Param("namespace"), c.Param("name"))
		if err != nil {
			opError(c, err)
			return
		}
		if perms == nil {
			perms = []Permission{}
		}
		c.JSON(http.StatusOK, gin.H{"permissions": perms})
	})
}

func IngressClassesHandler(getClient ClientGetter) gin.HandlerFunc {
	return withCluster(getClient, 10*time.Second, func(c *gin.Context, ctx context.Context, client *k8s.Client) {
		names, err := IngressClasses(ctx, client.Clientset)
		if err != nil {
			opError(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"ingressClasses": names})
	})
}

func ExecHandler(getClient ClientGetter) gin.HandlerFunc {
	return withCluster(getClient, 35*time.Second, func(c *gin.Context, ctx context.Context, client *k8s.Client) {
		var req struct {
			Namespace string `json:"namespace" binding:"required"`
			Pod       string `json:"pod" binding:"required"`
			Container string `json:"container"`
			Command   string `json:"command" binding:"required"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Expected {namespace, pod, command}"})
			return
		}
		out, err := Exec(ctx, client, req.Namespace, req.Pod, req.Container, req.Command)
		if err != nil && out == "" {
			opError(c, err)
			return
		}
		// A command that exits non-zero still printed something worth reading.
		resp := gin.H{"output": out}
		if err != nil {
			resp["exitError"] = err.Error()
		}
		c.JSON(http.StatusOK, resp)
	})
}
