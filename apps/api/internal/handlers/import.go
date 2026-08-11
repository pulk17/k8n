package handlers

import (
	"fmt"
	"net/http"
	"sort"
	"strings"

	"github.com/gin-gonic/gin"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"sigs.k8s.io/yaml"
)

// ImportedNode is one canvas node reconstructed from a manifest. Fields uses the
// same names buildAuthoredObject reads, so importing a manifest and compiling it
// again round-trips.
type ImportedNode struct {
	ID        string                 `json:"id"`
	Kind      string                 `json:"kind"`
	Name      string                 `json:"name"`
	Namespace string                 `json:"namespace"`
	Fields    map[string]interface{} `json:"fields"`
}

type ImportedEdge struct {
	Source string `json:"source"`
	Target string `json:"target"`
}

type ImportResponse struct {
	Nodes []ImportedNode `json:"nodes"`
	Edges []ImportedEdge `json:"edges"`
	Notes []CompileNote  `json:"notes"`
}

// ImportManifest turns pasted YAML into a graph.
//
// The frontend used to do this with regexes over the raw text: it took the first
// "name:" in each document (often a container's, not the resource's), ignored
// every field it did not have a pattern for, and connected each Service to
// whichever Deployment happened to share its namespace. Here the manifest is
// parsed properly and edges come from real references.
func ImportManifest() gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			YAML string `json:"yaml" binding:"required"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Expected {yaml: string}"})
			return
		}

		objects, err := parseYAML(req.YAML)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Could not parse YAML", "details": err.Error()})
			return
		}
		if len(objects) == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "No Kubernetes resources found in that document"})
			return
		}

		c.JSON(http.StatusOK, buildImportGraph(objects))
	}
}

func buildImportGraph(objects []*unstructured.Unstructured) ImportResponse {
	resp := ImportResponse{Nodes: []ImportedNode{}, Edges: []ImportedEdge{}, Notes: []CompileNote{}}

	for _, obj := range objects {
		if obj.GetName() == "" {
			resp.Notes = append(resp.Notes, CompileNote{
				Kind: obj.GetKind(), Level: "warning",
				Message: "Skipped a document with no metadata.name.",
			})
			continue
		}
		ns := obj.GetNamespace()
		if ns == "" {
			ns = "default"
		}
		resp.Nodes = append(resp.Nodes, ImportedNode{
			ID:        fmt.Sprintf("%s/%s/%s", obj.GetKind(), ns, obj.GetName()),
			Kind:      obj.GetKind(),
			Name:      obj.GetName(),
			Namespace: ns,
			Fields:    fieldsFromObject(obj),
		})
	}

	attachMountPaths(resp.Nodes, objects)
	resp.Edges = importEdges(resp.Nodes, objects)
	return resp
}

// attachMountPaths copies each claim's mount path onto its PVC node.
//
// The canvas models the mount path as a property of the PVC, because that is
// where you set it when drawing a storage edge. In a manifest it lives on the
// container that mounts the volume, so it has to be carried back.
func attachMountPaths(nodes []ImportedNode, objects []*unstructured.Unstructured) {
	pvcNode := map[string]*ImportedNode{}
	for i := range nodes {
		if nodes[i].Kind == "PersistentVolumeClaim" {
			pvcNode[nodes[i].Namespace+"/"+nodes[i].Name] = &nodes[i]
		}
	}
	if len(pvcNode) == 0 {
		return
	}

	for _, obj := range objects {
		spec := podSpecOf(obj)
		if spec == nil {
			continue
		}
		ns := obj.GetNamespace()
		if ns == "" {
			ns = "default"
		}

		claimOfVolume := map[string]string{}
		for _, v := range spec.Volumes {
			if v.PersistentVolumeClaim != nil {
				claimOfVolume[v.Name] = v.PersistentVolumeClaim.ClaimName
			}
		}
		for _, ctr := range spec.Containers {
			for _, mount := range ctr.VolumeMounts {
				claim, ok := claimOfVolume[mount.Name]
				if !ok {
					continue
				}
				if node := pvcNode[ns+"/"+claim]; node != nil && mount.MountPath != "" {
					node.Fields["mountPath"] = mount.MountPath
				}
			}
		}
	}
}

// --- field extraction --------------------------------------------------------

func fieldsFromObject(obj *unstructured.Unstructured) map[string]interface{} {
	f := map[string]interface{}{}
	set := func(key string, value interface{}) {
		switch v := value.(type) {
		case string:
			if v == "" {
				return
			}
		case int64:
			if v == 0 {
				return
			}
		case nil:
			return
		}
		f[key] = value
	}

	switch obj.GetKind() {
	case "Deployment", "StatefulSet", "DaemonSet", "ReplicaSet":
		set("replicas", nestedInt(obj, "spec", "replicas"))
		podFields(obj, f, "spec", "template", "spec")
		if obj.GetKind() == "StatefulSet" {
			set("serviceName", nestedString(obj, "spec", "serviceName"))
		}

	case "Pod":
		podFields(obj, f, "spec")

	case "Job":
		podFields(obj, f, "spec", "template", "spec")
		set("completions", nestedInt(obj, "spec", "completions"))
		set("parallelism", nestedInt(obj, "spec", "parallelism"))
		set("backoffLimit", nestedInt(obj, "spec", "backoffLimit"))

	case "CronJob":
		podFields(obj, f, "spec", "jobTemplate", "spec", "template", "spec")
		set("schedule", nestedString(obj, "spec", "schedule"))
		set("concurrencyPolicy", nestedString(obj, "spec", "concurrencyPolicy"))

	case "Service":
		set("serviceType", nestedString(obj, "spec", "type"))
		ports, _, _ := unstructured.NestedSlice(obj.Object, "spec", "ports")
		if len(ports) > 0 {
			if p, ok := ports[0].(map[string]interface{}); ok {
				set("port", asInt(p["port"]))
				set("targetPort", asInt(p["targetPort"]))
				set("protocol", asString(p["protocol"]))
				set("nodePort", asInt(p["nodePort"]))
			}
		}

	case "Ingress":
		set("ingressClassName", nestedString(obj, "spec", "ingressClassName"))
		rules, _, _ := unstructured.NestedSlice(obj.Object, "spec", "rules")
		if len(rules) > 0 {
			if rule, ok := rules[0].(map[string]interface{}); ok {
				set("host", asString(rule["host"]))
				if p := firstIngressPath(rule); p != nil {
					set("path", asString(p["path"]))
					set("pathType", asString(p["pathType"]))
					if svc := ingressBackendService(p); svc != nil {
						set("port", asInt(nestedIn(svc, "port", "number")))
					}
				}
			}
		}
		if tls, _, _ := unstructured.NestedSlice(obj.Object, "spec", "tls"); len(tls) > 0 {
			f["tlsEnabled"] = true
			if t, ok := tls[0].(map[string]interface{}); ok {
				set("tlsSecretName", asString(t["secretName"]))
			}
		}

	case "ConfigMap":
		data, _, _ := unstructured.NestedStringMap(obj.Object, "data")
		set("configData", joinKeyValues(data))

	case "Secret":
		set("secretType", nestedString(obj, "type"))
		// Values are base64 in `data`; the editor holds plain text, so only the
		// keys survive an import. Overwriting them with garbage would be worse.
		data, _, _ := unstructured.NestedStringMap(obj.Object, "data")
		stringData, _, _ := unstructured.NestedStringMap(obj.Object, "stringData")
		if len(stringData) > 0 {
			set("secretData", joinKeyValues(stringData))
		} else if len(data) > 0 {
			keys := make([]string, 0, len(data))
			for k := range data {
				keys = append(keys, k+"=")
			}
			sort.Strings(keys)
			set("secretData", strings.Join(keys, "\n"))
		}

	case "PersistentVolumeClaim", "PersistentVolume":
		modes, _, _ := unstructured.NestedStringSlice(obj.Object, "spec", "accessModes")
		if len(modes) > 0 {
			set("accessMode", modes[0])
		}
		set("storageClass", nestedString(obj, "spec", "storageClassName"))
		set("storageSize", nestedString(obj, "spec", "resources", "requests", "storage"))
		set("storageSize", nestedString(obj, "spec", "capacity", "storage"))

	case "HorizontalPodAutoscaler":
		set("minReplicas", nestedInt(obj, "spec", "minReplicas"))
		set("maxReplicas", nestedInt(obj, "spec", "maxReplicas"))
		set("targetKind", nestedString(obj, "spec", "scaleTargetRef", "kind"))
		set("targetName", nestedString(obj, "spec", "scaleTargetRef", "name"))
		metrics, _, _ := unstructured.NestedSlice(obj.Object, "spec", "metrics")
		for _, m := range metrics {
			mm, ok := m.(map[string]interface{})
			if !ok {
				continue
			}
			if res, ok := mm["resource"].(map[string]interface{}); ok {
				set("targetCPU", asInt(nestedIn(res, "target", "averageUtilization")))
			}
		}

	case "Role", "ClusterRole":
		rules, _, _ := unstructured.NestedSlice(obj.Object, "rules")
		if len(rules) > 0 {
			if rule, ok := rules[0].(map[string]interface{}); ok {
				set("apiGroups", joinAny(rule["apiGroups"]))
				set("resources", joinAny(rule["resources"]))
				set("verbs", joinAny(rule["verbs"]))
			}
		}

	case "RoleBinding", "ClusterRoleBinding":
		set("roleKind", nestedString(obj, "roleRef", "kind"))
		set("roleName", nestedString(obj, "roleRef", "name"))
		subjects, _, _ := unstructured.NestedSlice(obj.Object, "subjects")
		if len(subjects) > 0 {
			if s, ok := subjects[0].(map[string]interface{}); ok {
				set("subjectName", asString(s["name"]))
			}
		}

	case "NetworkPolicy":
		set("policyTypes", joinAny(nestedIn(obj.Object, "spec", "policyTypes")))

	default:
		// Custom resources keep their spec verbatim, which is what the node
		// editor shows for kinds k8n has no model for.
		set("apiVersion", obj.GetAPIVersion())
		if spec, found, _ := unstructured.NestedFieldNoCopy(obj.Object, "spec"); found {
			if out, err := yaml.Marshal(spec); err == nil {
				set("spec", strings.TrimSpace(string(out)))
			}
		}
	}

	if labels := obj.GetLabels(); len(labels) > 0 {
		f["labels"] = toInterfaceMap(labels)
	}
	if ann := obj.GetAnnotations(); len(ann) > 0 {
		f["annotations"] = toInterfaceMap(ann)
	}
	return f
}

// podFields reads the first container plus the pod-level settings the editor
// exposes, from wherever the pod spec sits for this kind.
func podFields(obj *unstructured.Unstructured, f map[string]interface{}, path ...string) {
	raw, found, _ := unstructured.NestedMap(obj.Object, path...)
	if !found {
		return
	}

	var spec corev1.PodSpec
	if err := runtime.DefaultUnstructuredConverter.FromUnstructured(raw, &spec); err != nil {
		return
	}
	if spec.ServiceAccountName != "" {
		f["serviceAccountName"] = spec.ServiceAccountName
	}
	if len(spec.Containers) == 0 {
		return
	}

	ctr := spec.Containers[0]
	f["image"] = ctr.Image
	if len(ctr.Ports) > 0 {
		f["containerPort"] = int64(ctr.Ports[0].ContainerPort)
	}
	if len(ctr.Command) > 0 {
		f["command"] = strings.Join(ctr.Command, " ")
	}
	if len(ctr.Args) > 0 {
		f["args"] = strings.Join(ctr.Args, " ")
	}
	for key, qty := range map[string]string{
		"cpuRequest":    ctr.Resources.Requests.Cpu().String(),
		"memoryRequest": ctr.Resources.Requests.Memory().String(),
		"cpuLimit":      ctr.Resources.Limits.Cpu().String(),
		"memoryLimit":   ctr.Resources.Limits.Memory().String(),
	} {
		if qty != "" && qty != "0" {
			f[key] = qty
		}
	}
}

// --- edges -------------------------------------------------------------------

// importEdges connects nodes using the references in the manifest: a Service's
// selector against pod labels, an Ingress backend, an HPA scale target, and the
// ConfigMaps, Secrets, PVCs and ServiceAccounts each pod spec names.
func importEdges(nodes []ImportedNode, objects []*unstructured.Unstructured) []ImportedEdge {
	byKey := map[string]string{} // "Kind/namespace/name" -> node id
	for _, n := range nodes {
		byKey[n.ID] = n.ID
	}

	// Pod labels per workload, so a Service selector can be matched properly.
	type workload struct {
		id     string
		labels map[string]string
	}
	var workloads []workload
	objByID := map[string]*unstructured.Unstructured{}

	for i, obj := range objects {
		if i >= len(nodes) {
			break
		}
		id := nodes[i].ID
		objByID[id] = obj
		if labels, found, _ := unstructured.NestedStringMap(obj.Object, "spec", "template", "metadata", "labels"); found {
			workloads = append(workloads, workload{id: id, labels: labels})
		} else if obj.GetKind() == "Pod" {
			workloads = append(workloads, workload{id: id, labels: obj.GetLabels()})
		}
	}

	var edges []ImportedEdge
	seen := map[string]bool{}
	link := func(source, target string) {
		if source == "" || target == "" || source == target {
			return
		}
		key := source + "->" + target
		if seen[key] {
			return
		}
		seen[key] = true
		edges = append(edges, ImportedEdge{Source: source, Target: target})
	}

	ref := func(kind, namespace, name string) string {
		id := fmt.Sprintf("%s/%s/%s", kind, namespace, name)
		if _, ok := byKey[id]; ok {
			return id
		}
		return ""
	}

	for _, n := range nodes {
		obj := objByID[n.ID]
		if obj == nil {
			continue
		}

		switch n.Kind {
		case "Service":
			selector, _, _ := unstructured.NestedStringMap(obj.Object, "spec", "selector")
			for _, w := range workloads {
				if matchesLabels(selector, w.labels) {
					link(n.ID, w.id)
				}
			}

		case "NetworkPolicy":
			// A NetworkPolicy names its target by labels rather than by name.
			selector, _, _ := unstructured.NestedStringMap(obj.Object, "spec", "podSelector", "matchLabels")
			for _, w := range workloads {
				if matchesLabels(selector, w.labels) {
					link(n.ID, w.id)
				}
			}

		case "Ingress":
			rules, _, _ := unstructured.NestedSlice(obj.Object, "spec", "rules")
			for _, r := range rules {
				rule, ok := r.(map[string]interface{})
				if !ok {
					continue
				}
				if p := firstIngressPath(rule); p != nil {
					if svc := ingressBackendService(p); svc != nil {
						link(n.ID, ref("Service", n.Namespace, asString(svc["name"])))
					}
				}
			}

		case "HorizontalPodAutoscaler":
			link(n.ID, ref(
				nestedString(obj, "spec", "scaleTargetRef", "kind"),
				n.Namespace,
				nestedString(obj, "spec", "scaleTargetRef", "name"),
			))

		case "RoleBinding", "ClusterRoleBinding":
			roleKind := nestedString(obj, "roleRef", "kind")
			link(ref(roleKind, n.Namespace, nestedString(obj, "roleRef", "name")), n.ID)
			subjects, _, _ := unstructured.NestedSlice(obj.Object, "subjects")
			for _, s := range subjects {
				if sub, ok := s.(map[string]interface{}); ok && asString(sub["kind"]) == "ServiceAccount" {
					link(ref("ServiceAccount", n.Namespace, asString(sub["name"])), n.ID)
				}
			}
		}

		// Config, storage and identity all point at the workload, matching the
		// direction the canvas draws them.
		if spec := podSpecOf(obj); spec != nil {
			configMaps, secrets, pvcs := podSpecRefs(spec)
			for _, name := range configMaps {
				link(ref("ConfigMap", n.Namespace, name), n.ID)
			}
			for _, name := range secrets {
				link(ref("Secret", n.Namespace, name), n.ID)
			}
			for _, name := range pvcs {
				link(ref("PersistentVolumeClaim", n.Namespace, name), n.ID)
			}
			if spec.ServiceAccountName != "" {
				link(ref("ServiceAccount", n.Namespace, spec.ServiceAccountName), n.ID)
			}
		}
	}

	return edges
}

// podSpecOf finds the pod spec wherever this kind keeps it.
func podSpecOf(obj *unstructured.Unstructured) *corev1.PodSpec {
	paths := [][]string{
		{"spec", "template", "spec"},
		{"spec", "jobTemplate", "spec", "template", "spec"},
	}
	if obj.GetKind() == "Pod" {
		paths = [][]string{{"spec"}}
	}

	for _, path := range paths {
		raw, found, _ := unstructured.NestedMap(obj.Object, path...)
		if !found {
			continue
		}
		var spec corev1.PodSpec
		if err := runtime.DefaultUnstructuredConverter.FromUnstructured(raw, &spec); err == nil {
			return &spec
		}
	}
	return nil
}

func matchesLabels(selector, labels map[string]string) bool {
	if len(selector) == 0 || len(labels) == 0 {
		return false
	}
	for k, v := range selector {
		if labels[k] != v {
			return false
		}
	}
	return true
}

// --- small accessors ---------------------------------------------------------

func nestedString(obj *unstructured.Unstructured, path ...string) string {
	v, _, _ := unstructured.NestedString(obj.Object, path...)
	return v
}

func nestedInt(obj *unstructured.Unstructured, path ...string) int64 {
	v, _, _ := unstructured.NestedInt64(obj.Object, path...)
	return v
}

func nestedIn(m map[string]interface{}, path ...string) interface{} {
	v, found, _ := unstructured.NestedFieldNoCopy(m, path...)
	if !found {
		return nil
	}
	return v
}

func asString(v interface{}) string {
	s, _ := v.(string)
	return s
}

func asInt(v interface{}) int64 {
	switch n := v.(type) {
	case int64:
		return n
	case float64:
		return int64(n)
	}
	return 0
}

func firstIngressPath(rule map[string]interface{}) map[string]interface{} {
	paths, found, _ := unstructured.NestedSlice(rule, "http", "paths")
	if !found || len(paths) == 0 {
		return nil
	}
	p, _ := paths[0].(map[string]interface{})
	return p
}

func ingressBackendService(path map[string]interface{}) map[string]interface{} {
	svc, found, _ := unstructured.NestedMap(path, "backend", "service")
	if !found {
		return nil
	}
	return svc
}

func joinKeyValues(data map[string]string) string {
	keys := make([]string, 0, len(data))
	for k := range data {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	lines := make([]string, 0, len(keys))
	for _, k := range keys {
		lines = append(lines, k+"="+data[k])
	}
	return strings.Join(lines, "\n")
}

func joinAny(v interface{}) string {
	items, ok := v.([]interface{})
	if !ok {
		return ""
	}
	parts := make([]string, 0, len(items))
	for _, item := range items {
		if s := asString(item); s != "" {
			parts = append(parts, s)
		}
	}
	return strings.Join(parts, ",")
}

func toInterfaceMap(m map[string]string) map[string]interface{} {
	out := make(map[string]interface{}, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}
