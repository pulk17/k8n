package handlers

import "testing"

func TestStacksAreReadFromWhatKubernetesRecords(t *testing.T) {
	rs := []Resource{
		{Kind: "Deployment", Name: "grafana", Namespace: "default", Annotations: map[string]string{"meta.helm.sh/release-name": "grafana"}},
		{Kind: "ReplicaSet", Name: "grafana-abc", Namespace: "default", OwnerReferences: []string{"grafana"}},
		{Kind: "Pod", Name: "grafana-abc-1", Namespace: "default", OwnerReferences: []string{"grafana-abc"}},
		{Kind: "Secret", Name: "sh.helm.release.v1.grafana.v1", Namespace: "default", Labels: map[string]string{"owner": "helm", "name": "grafana"}},
		{Kind: "Service", Name: "web", Namespace: "default", Labels: map[string]string{partOfLabel: "shop", managedByLabel: "k8n"}},
		{Kind: "ConfigMap", Name: "other", Namespace: "default", Labels: map[string]string{"app.kubernetes.io/instance": "redis"}},
		{Kind: "ConfigMap", Name: "loose", Namespace: "default"},
		{Kind: "Pod", Name: "grafana-test", Namespace: "default", Labels: map[string]string{"app.kubernetes.io/instance": "grafana"}},
	}
	assignStacks(rs)
	want := []struct{ name, source string }{
		{"grafana", "helm"}, {"grafana", "helm"}, {"grafana", "helm"}, {"grafana", "helm"},
		{"shop", "k8n"}, {"redis", "label"}, {"", ""}, {"grafana", "helm"},
	}
	for i, w := range want {
		if rs[i].Stack != w.name || rs[i].StackSource != w.source {
			t.Errorf("%s/%s: got %q (%s), want %q (%s)", rs[i].Kind, rs[i].Name, rs[i].Stack, rs[i].StackSource, w.name, w.source)
		}
	}
}

func TestCompiledObjectsCarryTheirStack(t *testing.T) {
	objs := compile(t, Graph{
		Stack: "My Shop Workflow!",
		Nodes: []GraphNode{
			node("cm", "ConfigMap", "cfg", nil),
			node("live", "Deployment", "old", map[string]any{"origin": "cluster", "replicas": 2, "__edited": map[string]any{"replicas": true}}),
		},
	})
	if dig(objs["ConfigMap/cfg"], "metadata", "labels", partOfLabel) != "my-shop-workflow" {
		t.Errorf("labels: %v", dig(objs["ConfigMap/cfg"], "metadata", "labels"))
	}
	if dig(objs["Deployment/old"], "metadata", "labels") != nil {
		t.Error("an imported object's partial apply must not relabel it into this stack")
	}
}
