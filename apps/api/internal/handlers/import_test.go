package handlers

import "testing"

// A small application as someone would paste it: a Deployment with a ConfigMap
// and a PVC, a Service in front and an Ingress in front of that.
const manifest = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: 2
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: web
          image: nginx:1.27
          ports:
            - containerPort: 8080
          envFrom:
            - configMapRef:
                name: web-config
          volumeMounts:
            - name: data
              mountPath: /var/data
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: web-data
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: web-config
data:
  GREETING: hello
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: web-data
spec:
  resources:
    requests:
      storage: 1Gi
---
apiVersion: v1
kind: Service
metadata:
  name: web
spec:
  selector:
    app: web
  ports:
    - port: 80
      targetPort: 8080
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: web
spec:
  rules:
    - host: example.test
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: web
                port:
                  number: 80
`

func TestAPastedManifestComesBackAsTheGraphItDescribes(t *testing.T) {
	objects, err := parseYAML(manifest)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	graph := buildImportGraph(objects)

	if len(graph.Nodes) != 5 {
		t.Fatalf("got %d nodes, want 5: %+v", len(graph.Nodes), graph.Nodes)
	}

	// Edges come from the references in the manifest, not from names that
	// happen to match: the ConfigMap is wired because the pod reads it.
	want := map[string]string{
		"ConfigMap/default/web-config":           "Deployment/default/web",
		"PersistentVolumeClaim/default/web-data": "Deployment/default/web",
		"Service/default/web":                    "Deployment/default/web",
		"Ingress/default/web":                    "Service/default/web",
	}
	got := map[string]string{}
	for _, e := range graph.Edges {
		got[e.Source] = e.Target
	}
	for source, target := range want {
		if got[source] != target {
			t.Errorf("%s should point at %s, points at %q", source, target, got[source])
		}
	}
	if len(graph.Edges) != len(want) {
		t.Errorf("got %d edges, want %d: %+v", len(graph.Edges), len(want), graph.Edges)
	}

	// The fields have to be the ones the compiler reads back, or a round trip
	// through import silently drops what it did not understand.
	byID := map[string]ImportedNode{}
	for _, n := range graph.Nodes {
		byID[n.ID] = n
	}
	deployment := byID["Deployment/default/web"].Fields
	if deployment["image"] != "nginx:1.27" || deployment["replicas"] != int64(2) {
		t.Errorf("deployment fields = %+v", deployment)
	}
	if path := byID["PersistentVolumeClaim/default/web-data"].Fields["mountPath"]; path != "/var/data" {
		t.Errorf("mount path = %v, want /var/data (it lives on the container in YAML)", path)
	}
}

func TestADocumentWithNoNameIsReportedNotDropped(t *testing.T) {
	objects, err := parseYAML("apiVersion: v1\nkind: ConfigMap\ndata: {}\n")
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	graph := buildImportGraph(objects)
	if len(graph.Nodes) != 0 || len(graph.Notes) != 1 {
		t.Fatalf("nodes=%d notes=%d, want 0 and 1", len(graph.Nodes), len(graph.Notes))
	}
}

func TestParseYAMLSkipsTheEmptyDocumentsEveryoneLeavesBehind(t *testing.T) {
	objects, err := parseYAML("---\n\n---\napiVersion: v1\nkind: Namespace\nmetadata:\n  name: demo\n---\n# just a comment\n")
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(objects) != 1 || objects[0].GetName() != "demo" {
		t.Fatalf("got %d objects: %+v", len(objects), objects)
	}
}
