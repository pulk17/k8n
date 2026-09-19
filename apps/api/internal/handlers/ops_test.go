package handlers

import (
	"context"
	"errors"
	"net"
	"strings"
	"testing"

	appsv1 "k8s.io/api/apps/v1"
	autoscalingv1 "k8s.io/api/autoscaling/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/intstr"
	"k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"
)

var bg = context.Background()

func TestRevealSecret(t *testing.T) {
	cs := fake.NewSimpleClientset(
		&corev1.Secret{ObjectMeta: metav1.ObjectMeta{Name: "grafana", Namespace: "default"},
			Data: map[string][]byte{"admin-password": []byte("s3cret")}},
		&corev1.Secret{ObjectMeta: metav1.ObjectMeta{Name: "token", Namespace: "kube-system"}},
	)
	data, err := RevealSecret(bg, cs, "default", "grafana")
	if err != nil || data["admin-password"] != "s3cret" {
		t.Fatalf("got %v, %v", data, err)
	}
	if _, err := RevealSecret(bg, cs, "kube-system", "token"); !errors.Is(err, ErrProtected) {
		t.Errorf("a kube-system secret should be refused, got %v", err)
	}
}

func TestScale(t *testing.T) {
	cs := fake.NewSimpleClientset(&appsv1.Deployment{ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default"}})
	var got int32 = -1
	cs.PrependReactor("update", "deployments", func(a k8stesting.Action) (bool, runtime.Object, error) {
		if a.GetSubresource() != "scale" {
			return false, nil, nil
		}
		s := a.(k8stesting.UpdateAction).GetObject().(*autoscalingv1.Scale)
		got = s.Spec.Replicas
		return true, s, nil
	})

	if err := Scale(bg, cs, "Deployment", "default", "web", 3); err != nil || got != 3 {
		t.Fatalf("scale: replicas %d, err %v", got, err)
	}
	for _, bad := range []int32{-1, maxReplicas + 1} {
		if err := Scale(bg, cs, "Deployment", "default", "web", bad); !errors.Is(err, errBadRequest) {
			t.Errorf("%d replicas should be refused, got %v", bad, err)
		}
	}
	if err := Scale(bg, cs, "Service", "default", "web", 1); !errors.Is(err, errBadRequest) {
		t.Errorf("a Service cannot be scaled, got %v", err)
	}
	if err := Scale(bg, cs, "Deployment", "kube-system", "coredns", 0); !errors.Is(err, ErrProtected) {
		t.Errorf("coredns must not be scaled, got %v", err)
	}
}

func TestRestartStampsThePodTemplate(t *testing.T) {
	cs := fake.NewSimpleClientset(&appsv1.Deployment{ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default"}})
	if err := Restart(bg, cs, "Deployment", "default", "web"); err != nil {
		t.Fatal(err)
	}
	d, _ := cs.AppsV1().Deployments("default").Get(bg, "web", metav1.GetOptions{})
	if d.Spec.Template.Annotations["kubectl.kubernetes.io/restartedAt"] == "" {
		t.Error("the pod template was not stamped, so no pods would be replaced")
	}
	if err := Restart(bg, cs, "ConfigMap", "default", "web"); !errors.Is(err, errBadRequest) {
		t.Errorf("a ConfigMap cannot be restarted, got %v", err)
	}
}

func replicaSet(name string, rev, image string, owner types.UID) *appsv1.ReplicaSet {
	return &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Name: name, Namespace: "default",
			Annotations:     map[string]string{revisionAnnotation: rev},
			OwnerReferences: []metav1.OwnerReference{{UID: owner, Name: "web", Kind: "Deployment"}},
		},
		Spec: appsv1.ReplicaSetSpec{Template: corev1.PodTemplateSpec{
			ObjectMeta: metav1.ObjectMeta{Labels: map[string]string{"app": "web", "pod-template-hash": name}},
			Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "web", Image: image}}},
		}},
	}
}

func TestRollbackGoesToThePreviousRevision(t *testing.T) {
	dep := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default", UID: "d1"},
		Spec: appsv1.DeploymentSpec{Template: corev1.PodTemplateSpec{
			Spec: corev1.PodSpec{Containers: []corev1.Container{{Name: "web", Image: "nginx:3"}}},
		}},
	}
	cs := fake.NewSimpleClientset(dep,
		replicaSet("web-1", "1", "nginx:1", "d1"),
		replicaSet("web-2", "2", "nginx:2", "d1"),
		replicaSet("web-3", "3", "nginx:3", "d1"),
		replicaSet("other-9", "9", "busybox", "someone-else"),
	)
	rev, err := Rollback(bg, cs, "default", "web")
	if err != nil || rev != 2 {
		t.Fatalf("rolled back to %d, err %v", rev, err)
	}
	d, _ := cs.AppsV1().Deployments("default").Get(bg, "web", metav1.GetOptions{})
	if img := d.Spec.Template.Spec.Containers[0].Image; img != "nginx:2" {
		t.Errorf("image is %s, want nginx:2", img)
	}
	if _, ok := d.Spec.Template.Labels["pod-template-hash"]; ok {
		t.Error("the old ReplicaSet's hash label was copied onto the Deployment")
	}

	fresh := fake.NewSimpleClientset(dep, replicaSet("web-1", "1", "nginx:1", "d1"))
	if _, err := Rollback(bg, fresh, "default", "web"); !errors.Is(err, errBadRequest) {
		t.Errorf("one revision has nothing to go back to, got %v", err)
	}
}

func TestNamespaces(t *testing.T) {
	cs := fake.NewSimpleClientset()
	if err := CreateNamespace(bg, cs, "team-a"); err != nil {
		t.Fatal(err)
	}
	if err := CreateNamespace(bg, cs, "Not_Valid"); !errors.Is(err, errBadRequest) {
		t.Errorf("an invalid name should be refused, got %v", err)
	}
	for _, ns := range []string{"default", "kube-system"} {
		if err := DeleteNamespace(bg, cs, ns); !errors.Is(err, ErrProtected) {
			t.Errorf("%s must not be deleted, got %v", ns, err)
		}
	}
	if err := DeleteNamespace(bg, cs, "team-a"); err != nil {
		t.Error(err)
	}
}

func TestServiceAccountPermissions(t *testing.T) {
	sa := rbacv1.Subject{Kind: "ServiceAccount", Name: "app", Namespace: "default"}
	cs := fake.NewSimpleClientset(
		&rbacv1.Role{ObjectMeta: metav1.ObjectMeta{Name: "reader", Namespace: "default"},
			Rules: []rbacv1.PolicyRule{{Verbs: []string{"get", "list"}, Resources: []string{"pods"}}}},
		&rbacv1.RoleBinding{ObjectMeta: metav1.ObjectMeta{Name: "app-reads", Namespace: "default"},
			Subjects: []rbacv1.Subject{sa}, RoleRef: rbacv1.RoleRef{Kind: "Role", Name: "reader"}},
		&rbacv1.ClusterRole{ObjectMeta: metav1.ObjectMeta{Name: "nodes"},
			Rules: []rbacv1.PolicyRule{{Verbs: []string{"get"}, Resources: []string{"nodes"}}}},
		&rbacv1.ClusterRoleBinding{ObjectMeta: metav1.ObjectMeta{Name: "all-sa"},
			Subjects: []rbacv1.Subject{{Kind: "Group", Name: "system:serviceaccounts"}}, RoleRef: rbacv1.RoleRef{Kind: "ClusterRole", Name: "nodes"}},
		&rbacv1.RoleBinding{ObjectMeta: metav1.ObjectMeta{Name: "not-me", Namespace: "default"},
			Subjects: []rbacv1.Subject{{Kind: "ServiceAccount", Name: "other", Namespace: "default"}}, RoleRef: rbacv1.RoleRef{Kind: "Role", Name: "reader"}},
	)
	perms, err := ServiceAccountPermissions(bg, cs, "default", "app")
	if err != nil {
		t.Fatal(err)
	}
	if len(perms) != 2 {
		t.Fatalf("want the role and the group's cluster role, got %+v", perms)
	}
	if perms[0].Namespace != "default" || perms[1].Namespace != "" || !strings.Contains(perms[1].Source, "all-sa") {
		t.Errorf("sources wrong: %+v", perms)
	}
}

func TestIngressClasses(t *testing.T) {
	names, _ := IngressClasses(bg, fake.NewSimpleClientset())
	if len(names) != 0 {
		t.Errorf("empty cluster should have none, got %v", names)
	}
	names, _ = IngressClasses(bg, fake.NewSimpleClientset(&networkingv1.IngressClass{ObjectMeta: metav1.ObjectMeta{Name: "nginx"}}))
	if len(names) != 1 || names[0] != "nginx" {
		t.Errorf("got %v", names)
	}
}

func readyGrafana(name string) *corev1.Pod {
	return &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: "default", Labels: map[string]string{"app": "grafana"}},
		Spec: corev1.PodSpec{Containers: []corev1.Container{{
			Name: "grafana", Ports: []corev1.ContainerPort{{Name: "grafana", ContainerPort: 3000}},
		}}},
		Status: corev1.PodStatus{Phase: corev1.PodRunning, Conditions: []corev1.PodCondition{{Type: corev1.PodReady, Status: corev1.ConditionTrue}}},
	}
}

func TestForwardTargetFollowsTheService(t *testing.T) {
	svc := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{Name: "grafana", Namespace: "default"},
		Spec: corev1.ServiceSpec{
			Selector: map[string]string{"app": "grafana"},
			Ports:    []corev1.ServicePort{{Port: 80, TargetPort: intstr.FromString("grafana")}},
		},
	}
	notReady := readyGrafana("grafana-a")
	notReady.Status.Conditions = nil
	cs := fake.NewSimpleClientset(svc, notReady, readyGrafana("grafana-b"))

	pod, port, err := forwardTarget(bg, cs, "Service", "default", "grafana", 0)
	if err != nil {
		t.Fatal(err)
	}
	if pod.Name != "grafana-b" || port != 3000 {
		t.Errorf("got %s:%d, want the ready pod on the named port 3000", pod.Name, port)
	}

	empty := fake.NewSimpleClientset(svc)
	if _, _, err := forwardTarget(bg, empty, "Service", "default", "grafana", 0); !errors.Is(err, errBadRequest) {
		t.Errorf("no pods should be a clear error, got %v", err)
	}
	if _, _, err := forwardTarget(bg, empty, "ConfigMap", "default", "x", 0); !errors.Is(err, errBadRequest) {
		t.Errorf("a ConfigMap cannot be forwarded, got %v", err)
	}

	_, port, _ = forwardTarget(bg, fake.NewSimpleClientset(readyGrafana("p")), "Pod", "default", "p", 0)
	if port != 3000 {
		t.Errorf("a pod with no port given should use its declared one, got %d", port)
	}
}

func TestTargetPortDefaults(t *testing.T) {
	pod := readyGrafana("p")
	if got := targetPort(pod, corev1.ServicePort{Port: 8080}); got != 8080 {
		t.Errorf("no targetPort means the service port, got %d", got)
	}
	if got := targetPort(pod, corev1.ServicePort{Port: 80, TargetPort: intstr.FromInt(9090)}); got != 9090 {
		t.Errorf("got %d", got)
	}
}

func TestFreeLocalPortPrefersTheSameNumber(t *testing.T) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Skip("no loopback")
	}
	taken := l.Addr().(*net.TCPAddr).Port
	defer l.Close()
	got, err := freeLocalPort(taken)
	if err != nil || got == taken || got == 0 {
		t.Errorf("a taken port should fall back to another, got %d (%v)", got, err)
	}
	l.Close()
	if got, _ := freeLocalPort(taken); got != taken {
		t.Errorf("a free port should be used as asked, got %d", got)
	}
}

func TestCappedOutput(t *testing.T) {
	var c capped
	c.Write([]byte(strings.Repeat("x", maxExecOutput-10)))
	c.Write([]byte(strings.Repeat("y", 100)))
	c.Write([]byte("z"))
	if c.Len() > maxExecOutput+64 || !strings.Contains(c.String(), "cut at 64 KB") {
		t.Errorf("output was not capped: %d bytes", c.Len())
	}
}

func TestDiffIgnoresServerBookkeeping(t *testing.T) {
	live := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "v1", "kind": "ConfigMap",
		"metadata": map[string]any{"name": "cfg", "resourceVersion": "7", "uid": "u", "managedFields": []any{"x"}},
		"data":     map[string]any{"mode": "fast"},
		"status":   map[string]any{},
	}}
	same := live.DeepCopy()
	unstructured.SetNestedField(same.Object, "8", "metadata", "resourceVersion")
	if d := unifiedDiff(comparable(live), comparable(same)); d != "" {
		t.Errorf("only bookkeeping changed, yet a diff was produced:\n%s", d)
	}

	changed := live.DeepCopy()
	unstructured.SetNestedField(changed.Object, "slow", "data", "mode")
	d := unifiedDiff(comparable(live), comparable(changed))
	if !strings.Contains(d, "-  mode: fast") || !strings.Contains(d, "+  mode: slow") {
		t.Errorf("the real change is missing:\n%s", d)
	}
}

func TestForwardTargetFollowsAWorkload(t *testing.T) {
	dep := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: "grafana", Namespace: "default"},
		Spec:       appsv1.DeploymentSpec{Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "grafana"}}},
	}
	pod, port, err := forwardTarget(bg, fake.NewSimpleClientset(dep, readyGrafana("grafana-x")), "Deployment", "default", "grafana", 0)
	if err != nil || pod.Name != "grafana-x" || port != 3000 {
		t.Fatalf("got %v:%d, %v", pod, port, err)
	}
	if _, _, err := forwardTarget(bg, fake.NewSimpleClientset(dep), "Deployment", "default", "grafana", 0); !errors.Is(err, errBadRequest) {
		t.Errorf("no ready pod should be a clear error, got %v", err)
	}
}
