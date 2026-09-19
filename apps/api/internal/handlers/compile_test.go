package handlers

import (
	"strings"
	"testing"

	"sigs.k8s.io/yaml"
)

func node(id, kind, name string, fields map[string]any) GraphNode {
	data := map[string]any{"kind": kind, "name": name, "namespace": "default"}
	for k, v := range fields {
		data[k] = v
	}
	return GraphNode{ID: id, Data: data}
}

func edge(from, to string) GraphEdge { return GraphEdge{ID: from + "-" + to, Source: from, Target: to} }

// compile builds the graph and returns each object keyed by kind/name.
func compile(t *testing.T, g Graph) map[string]map[string]any {
	t.Helper()
	docs, _, err := BuildManifests(g)
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]map[string]any{}
	for _, d := range docs {
		var obj map[string]any
		if err := yaml.Unmarshal([]byte(d), &obj); err != nil {
			t.Fatalf("not YAML: %v\n%s", err, d)
		}
		meta := obj["metadata"].(map[string]any)
		out[obj["kind"].(string)+"/"+meta["name"].(string)] = obj
	}
	return out
}

func dig(obj map[string]any, path ...any) any {
	var cur any = obj
	for _, p := range path {
		switch k := p.(type) {
		case string:
			m, ok := cur.(map[string]any)
			if !ok {
				return nil
			}
			cur = m[k]
		case int:
			l, ok := cur.([]any)
			if !ok || k >= len(l) {
				return nil
			}
			cur = l[k]
		}
	}
	return cur
}

func container(obj map[string]any) map[string]any {
	c, _ := dig(obj, "spec", "template", "spec", "containers", 0).(map[string]any)
	return c
}

func TestServiceEdgeBecomesSelectorAndPort(t *testing.T) {
	objs := compile(t, Graph{
		Nodes: []GraphNode{
			node("svc", "Service", "web", nil),
			node("dep", "Deployment", "web-app", map[string]any{"image": "nginx", "containerPort": 8080}),
		},
		Edges: []GraphEdge{edge("svc", "dep")},
	})
	svc := objs["Service/web"]
	if dig(svc, "spec", "selector", "app") != "web-app" {
		t.Errorf("selector: %v", dig(svc, "spec", "selector"))
	}
	if tp := dig(svc, "spec", "ports", 0, "targetPort"); tp != float64(8080) {
		t.Errorf("targetPort = %v, want the workload's 8080", tp)
	}
}

func TestConfigEdgesBecomeEnvFrom(t *testing.T) {
	objs := compile(t, Graph{
		Nodes: []GraphNode{
			node("cm", "ConfigMap", "settings", nil),
			node("sec", "Secret", "creds", nil),
			node("dep", "Deployment", "api", map[string]any{"image": "api:1"}),
		},
		Edges: []GraphEdge{edge("cm", "dep"), edge("sec", "dep")},
	})
	env := container(objs["Deployment/api"])["envFrom"]
	text, _ := yaml.Marshal(env)
	if !strings.Contains(string(text), "name: settings") || !strings.Contains(string(text), "name: creds") {
		t.Errorf("envFrom missing a source:\n%s", text)
	}
}

func TestStorageEdgeMountsTheClaim(t *testing.T) {
	objs := compile(t, Graph{
		Nodes: []GraphNode{
			node("pvc", "PersistentVolumeClaim", "data", nil),
			node("dep", "Deployment", "db", map[string]any{"image": "postgres"}),
		},
		Edges: []GraphEdge{edge("pvc", "dep")},
	})
	dep := objs["Deployment/db"]
	if dig(dep, "spec", "template", "spec", "volumes", 0, "persistentVolumeClaim", "claimName") != "data" {
		t.Error("the claim is not a volume")
	}
	if dig(container(dep), "volumeMounts", 0) == nil {
		t.Error("the volume is not mounted")
	}
}

func TestHealthPathBecomesBothProbes(t *testing.T) {
	objs := compile(t, Graph{Nodes: []GraphNode{
		node("dep", "Deployment", "web", map[string]any{"image": "nginx", "containerPort": 80, "healthPath": "/healthz"}),
	}})
	c := container(objs["Deployment/web"])
	for _, probe := range []string{"readinessProbe", "livenessProbe"} {
		if dig(c, probe, "httpGet", "path") != "/healthz" || dig(c, probe, "httpGet", "port") != float64(80) {
			t.Errorf("%s: %v", probe, c[probe])
		}
	}
	if dig(c, "livenessProbe", "initialDelaySeconds").(float64) <= dig(c, "readinessProbe", "initialDelaySeconds").(float64) {
		t.Error("liveness must wait longer than readiness, or a slow start looks like a hang")
	}

	objs = compile(t, Graph{Nodes: []GraphNode{node("dep", "Deployment", "web", map[string]any{"image": "nginx", "containerPort": 80})}})
	if c := container(objs["Deployment/web"]); c["readinessProbe"] != nil {
		t.Error("no health path should mean no probe")
	}
}

func TestResourcesAreCompiled(t *testing.T) {
	objs := compile(t, Graph{Nodes: []GraphNode{
		node("dep", "Deployment", "web", map[string]any{"image": "nginx", "cpuRequest": "100m", "memoryLimit": "256Mi"}),
	}})
	c := container(objs["Deployment/web"])
	if dig(c, "resources", "requests", "cpu") != "100m" || dig(c, "resources", "limits", "memory") != "256Mi" {
		t.Errorf("resources: %v", c["resources"])
	}
}

func TestChartRenderedNodesAreNotCompiled(t *testing.T) {
	objs := compile(t, Graph{Nodes: []GraphNode{
		node("h", "Deployment", "grafana", map[string]any{"image": "grafana", "origin": "helm"}),
		node("mine", "ConfigMap", "mine", nil),
	}})
	if _, ok := objs["Deployment/grafana"]; ok {
		t.Error("Helm creates chart resources; compiling them too would install them twice")
	}
	if _, ok := objs["ConfigMap/mine"]; !ok {
		t.Error("the user's own node went missing")
	}
}

func TestIngressHPAAndServiceAccountEdges(t *testing.T) {
	objs := compile(t, Graph{
		Nodes: []GraphNode{
			node("ing", "Ingress", "front", map[string]any{"host": "app.local"}),
			node("svc", "Service", "web", map[string]any{"port": 80}),
			node("dep", "Deployment", "web-app", map[string]any{"image": "nginx", "containerPort": 80, "cpuRequest": "100m"}),
			node("hpa", "HorizontalPodAutoscaler", "web-hpa", map[string]any{"minReplicas": 2, "maxReplicas": 5, "targetCPU": 70}),
			node("sa", "ServiceAccount", "web-sa", nil),
		},
		Edges: []GraphEdge{edge("ing", "svc"), edge("svc", "dep"), edge("hpa", "dep"), edge("sa", "dep")},
	})
	text, _ := yaml.Marshal(objs["Ingress/front"])
	if !strings.Contains(string(text), "name: web") {
		t.Errorf("the Ingress does not route to the Service:\n%s", text)
	}
	hpa := objs["HorizontalPodAutoscaler/web-hpa"]
	if dig(hpa, "spec", "scaleTargetRef", "name") != "web-app" || dig(hpa, "spec", "scaleTargetRef", "kind") != "Deployment" {
		t.Errorf("scaleTargetRef: %v", dig(hpa, "spec", "scaleTargetRef"))
	}
	if dig(objs["Deployment/web-app"], "spec", "template", "spec", "serviceAccountName") != "web-sa" {
		t.Error("the ServiceAccount edge did not set serviceAccountName")
	}
}

func TestEveryAuthoredKindCompiles(t *testing.T) {
	kinds := map[string]map[string]any{
		"Deployment": {"image": "nginx"}, "StatefulSet": {"image": "redis"}, "DaemonSet": {"image": "fluentd"},
		"Pod": {"image": "busybox"}, "Job": {"image": "busybox", "command": "echo hi"},
		"CronJob": {"image": "busybox", "schedule": "*/5 * * * *"}, "Service": nil, "ConfigMap": nil,
		"Secret": nil, "PersistentVolumeClaim": nil, "ServiceAccount": nil, "Namespace": nil,
		"NetworkPolicy": nil, "Role": nil, "ClusterRole": nil,
	}
	for kind, fields := range kinds {
		objs := compile(t, Graph{Nodes: []GraphNode{node("n", kind, "thing", fields)}})
		if _, ok := objs[kind+"/thing"]; !ok {
			t.Errorf("%s produced nothing (got %v)", kind, keys(objs))
		}
	}
}

func keys(m map[string]map[string]any) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

func TestImportedNodesOnlyApplyWhatWasEdited(t *testing.T) {
	untouched := node("a", "Deployment", "live", map[string]any{"origin": "cluster", "image": "nginx:1"})
	docs, notes, err := BuildManifests(Graph{Nodes: []GraphNode{untouched}})
	if err != nil || len(docs) != 0 || len(notes) != 1 {
		t.Fatalf("an unedited import must produce nothing: %d docs, %v, %v", len(docs), notes, err)
	}

	edited := node("a", "Deployment", "live", map[string]any{
		"origin": "cluster", "replicas": 4, "__edited": map[string]any{"replicas": true},
	})
	objs := compile(t, Graph{Nodes: []GraphNode{edited}})
	dep := objs["Deployment/live"]
	if dig(dep, "spec", "replicas") != float64(4) {
		t.Errorf("replicas: %v", dig(dep, "spec", "replicas"))
	}
	if dig(dep, "spec", "template") != nil {
		t.Error("an edit to replicas must not regenerate the pod template and wipe live settings")
	}
}
