package handlers

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"sigs.k8s.io/yaml"
)

// CompileNote explains something the compiler decided or refused to do, so the
// canvas can tell the user instead of silently dropping their work.
type CompileNote struct {
	NodeID  string `json:"nodeId,omitempty"`
	Name    string `json:"name,omitempty"`
	Kind    string `json:"kind,omitempty"`
	Level   string `json:"level"` // "info" | "warning"
	Message string `json:"message"`
}

// separator between YAML documents.
const separator = "\n---\n"

// CompileResponse is what POST /api/graph/compile returns.
//
// HelmYAML is kept separate from YAML on purpose: it is what the charts *would*
// create, shown so a release can be reviewed like everything else. Applying it
// as plain YAML would install the chart's resources twice — once owned by k8n
// and once by Helm — so only YAML is ever sent to the apply endpoint.
type CompileResponse struct {
	YAML     string        `json:"yaml"`
	HelmYAML string        `json:"helmYaml,omitempty"`
	Objects  int           `json:"objects"`
	Notes    []CompileNote `json:"notes"`
}

// CompileGraph turns the whole canvas into a multi-document manifest. Taking the
// entire graph (rather than one node at a time) is what lets Service selectors,
// Ingress backends, HPA targets, config mounts and volumes resolve from edges.
//
// Helm nodes are rendered as well, so the preview shows what a chart will
// create instead of it being installed sight-unseen after the fact.
func CompileGraph(getClient ClientGetter) gin.HandlerFunc {
	return func(c *gin.Context) {
		var g Graph
		if err := c.ShouldBindJSON(&g); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid graph payload", "details": err.Error()})
			return
		}

		docs, notes, err := BuildManifests(g)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error(), "notes": notes})
			return
		}

		// Rendering a chart reaches out to a chart repository, so this only does
		// anything when the graph actually contains a Helm node.
		charts, chartNotes := helmReleaseNodes(getClient(), g)
		notes = append(notes, chartNotes...)

		c.JSON(http.StatusOK, CompileResponse{
			YAML:     strings.Join(docs, separator),
			HelmYAML: charts,
			Objects:  len(docs),
			Notes:    notes,
		})
	}
}

// BuildManifests compiles every applicable node in the graph to YAML.
func BuildManifests(g Graph) ([]string, []CompileNote, error) {
	r := newResolver(g)
	var docs []string
	var notes []CompileNote

	for _, n := range g.Nodes {
		kind := n.Kind()
		if kind == "" || kind == "HelmRelease" {
			// Helm releases are installed through the Helm API, not applied as YAML.
			continue
		}
		if n.Name() == "" {
			notes = append(notes, CompileNote{
				NodeID: n.ID, Kind: kind, Level: "warning",
				Message: "Skipped: the node has no name.",
			})
			continue
		}

		obj, note, err := buildObject(n, r)
		if err != nil {
			return nil, notes, fmt.Errorf("%s %q: %w", kind, n.Name(), err)
		}
		if note != nil {
			notes = append(notes, *note)
		}
		if obj == nil {
			continue
		}

		out, err := yaml.Marshal(obj)
		if err != nil {
			return nil, notes, fmt.Errorf("%s %q: failed to serialize: %w", kind, n.Name(), err)
		}
		docs = append(docs, strings.TrimSpace(string(out)))
	}

	return docs, notes, nil
}

// buildObject produces the manifest for one node. A nil object means "nothing to
// apply", which is legitimate for untouched cluster-imported nodes.
func buildObject(n GraphNode, r *resolver) (map[string]interface{}, *CompileNote, error) {
	if n.IsFromCluster() {
		return buildImportedObject(n)
	}
	obj, err := buildAuthoredObject(n, r)
	return obj, nil, err
}

// buildImportedObject handles nodes that were read out of a live cluster.
//
// k8n only ever saw a summary of these resources — never their full spec — so
// regenerating them from scratch would strip probes, volumes, env, limits and
// anything else it does not model. Instead we emit a partial object containing
// only the fields the user actually edited and let server-side apply merge it,
// leaving every other field with its existing owner.
func buildImportedObject(n GraphNode) (map[string]interface{}, *CompileNote, error) {
	edited := n.editedFields()
	if len(edited) == 0 {
		return nil, &CompileNote{
			NodeID: n.ID, Name: n.Name(), Kind: n.Kind(), Level: "info",
			Message: "Unchanged cluster resource — left untouched.",
		}, nil
	}

	apiVersion, err := apiVersionFor(n.Kind())
	if err != nil {
		return nil, nil, err
	}

	obj := map[string]interface{}{
		"apiVersion": apiVersion,
		"kind":       n.Kind(),
		"metadata": map[string]interface{}{
			"name":      n.Name(),
			"namespace": n.Namespace(),
		},
	}

	spec := map[string]interface{}{}
	var unsupported []string

	for field := range edited {
		switch field {
		case "replicas":
			if isScalable(n.Kind()) {
				spec["replicas"] = intField(n.Data, "replicas", 1)
			} else {
				unsupported = append(unsupported, field)
			}
		case "image":
			// A container patch has to carry the merge key ("name"), so we need
			// the real container name that came back with the cluster summary.
			container := firstContainerName(n)
			if container == "" {
				unsupported = append(unsupported, field)
				continue
			}
			spec["template"] = map[string]interface{}{
				"spec": map[string]interface{}{
					"containers": []map[string]interface{}{
						{"name": container, "image": strField(n.Data, "image")},
					},
				},
			}
		case "namespace", "name", "kind", "color", "status", "origin":
			// Identity/presentation only — nothing to patch.
		default:
			unsupported = append(unsupported, field)
		}
	}

	if len(spec) == 0 {
		return nil, &CompileNote{
			NodeID: n.ID, Name: n.Name(), Kind: n.Kind(), Level: "warning",
			Message: fmt.Sprintf("No applicable changes for this imported resource (%s). Edit it in your own manifests instead.", strings.Join(unsupported, ", ")),
		}, nil
	}

	obj["spec"] = spec

	var note *CompileNote
	if len(unsupported) > 0 {
		note = &CompileNote{
			NodeID: n.ID, Name: n.Name(), Kind: n.Kind(), Level: "warning",
			Message: fmt.Sprintf("Applying only replicas/image; k8n cannot safely patch %s on an imported resource.", strings.Join(unsupported, ", ")),
		}
	} else {
		note = &CompileNote{
			NodeID: n.ID, Name: n.Name(), Kind: n.Kind(), Level: "info",
			Message: "Imported resource — applying a partial patch so untracked fields are preserved.",
		}
	}
	return obj, note, nil
}

func firstContainerName(n GraphNode) string {
	for _, raw := range sliceField(n.Data, "containers") {
		if m, ok := raw.(map[string]interface{}); ok {
			if name := strField(m, "name"); name != "" {
				return name
			}
		}
	}
	return ""
}

func isScalable(kind string) bool {
	return kind == "Deployment" || kind == "StatefulSet" || kind == "ReplicaSet"
}

// apiVersionFor maps a kind to its group/version.
func apiVersionFor(kind string) (string, error) {
	switch kind {
	case "Deployment", "StatefulSet", "DaemonSet", "ReplicaSet":
		return "apps/v1", nil
	case "Pod", "Service", "ConfigMap", "Secret", "PersistentVolumeClaim", "PersistentVolume", "ServiceAccount", "Namespace":
		return "v1", nil
	case "Job", "CronJob":
		return "batch/v1", nil
	case "Ingress", "NetworkPolicy":
		return "networking.k8s.io/v1", nil
	case "HorizontalPodAutoscaler":
		return "autoscaling/v2", nil
	case "Role", "RoleBinding", "ClusterRole", "ClusterRoleBinding":
		return "rbac.authorization.k8s.io/v1", nil
	}
	return "", fmt.Errorf("unknown kind")
}

// buildAuthoredObject builds a full manifest for a node the user created on the
// canvas.
func buildAuthoredObject(n GraphNode, r *resolver) (map[string]interface{}, error) {
	kind := n.Kind()
	name := n.Name()

	metadata := map[string]interface{}{
		"name":      name,
		"namespace": n.Namespace(),
	}
	if labels := stringMapField(n.Data, "labels"); len(labels) > 0 {
		metadata["labels"] = labels
	}
	if ann := stringMapField(n.Data, "annotations"); len(ann) > 0 {
		metadata["annotations"] = ann
	}

	obj := map[string]interface{}{
		"kind":     kind,
		"metadata": metadata,
	}

	// Cluster-scoped kinds must not carry a namespace.
	if isClusterScoped(kind) {
		delete(metadata, "namespace")
	}

	if av, err := apiVersionFor(kind); err == nil {
		obj["apiVersion"] = av
	}

	switch kind {
	case "Deployment":
		obj["spec"] = map[string]interface{}{
			"replicas": intField(n.Data, "replicas", 1),
			"selector": map[string]interface{}{"matchLabels": n.podLabels()},
			"template": buildPodTemplate(n, r),
		}

	case "StatefulSet":
		spec := map[string]interface{}{
			"replicas":    intField(n.Data, "replicas", 1),
			"serviceName": strFieldOr(n.Data, "serviceName", name),
			"selector":    map[string]interface{}{"matchLabels": n.podLabels()},
			"template":    buildPodTemplate(n, r),
		}
		if vcts := buildVolumeClaimTemplates(n, r); len(vcts) > 0 {
			spec["volumeClaimTemplates"] = vcts
		}
		obj["spec"] = spec

	case "DaemonSet":
		obj["spec"] = map[string]interface{}{
			"selector": map[string]interface{}{"matchLabels": n.podLabels()},
			"template": buildPodTemplate(n, r),
		}

	case "Pod":
		podSpec := buildPodSpec(n, r, "Never")
		metadata["labels"] = mergeLabels(n.podLabels(), stringMapField(n.Data, "labels"))
		obj["spec"] = podSpec

	case "Job":
		spec := map[string]interface{}{
			"template": buildPodTemplate(n, r, "Never"),
		}
		if v := intField(n.Data, "completions", 0); v > 0 {
			spec["completions"] = v
		}
		if v := intField(n.Data, "parallelism", 0); v > 0 {
			spec["parallelism"] = v
		}
		if v := intField(n.Data, "backoffLimit", -1); v >= 0 {
			spec["backoffLimit"] = v
		}
		obj["spec"] = spec

	case "CronJob":
		obj["spec"] = map[string]interface{}{
			"schedule":          strFieldOr(n.Data, "schedule", "0 0 * * *"),
			"concurrencyPolicy": strFieldOr(n.Data, "concurrencyPolicy", "Allow"),
			"jobTemplate": map[string]interface{}{
				"spec": map[string]interface{}{
					"template": buildPodTemplate(n, r, "OnFailure"),
				},
			},
		}

	case "Service":
		obj["spec"] = buildServiceSpec(n, r)

	case "Ingress":
		obj["spec"] = buildIngressSpec(n, r)

	case "ConfigMap":
		raw := strField(n.Data, "configData")
		if raw == "" {
			raw = strField(n.Data, "data")
		}
		obj["data"] = parseKeyValues(raw, "config.yaml")

	case "Secret":
		obj["type"] = strFieldOr(n.Data, "secretType", "Opaque")
		// stringData lets the API server do the base64 encoding, so what the
		// user typed is what lands in the Secret.
		obj["stringData"] = parseKeyValues(strField(n.Data, "secretData"), "value")

	case "PersistentVolumeClaim":
		spec := map[string]interface{}{
			"accessModes": []string{strFieldOr(n.Data, "accessMode", "ReadWriteOnce")},
			"resources": map[string]interface{}{
				"requests": map[string]interface{}{
					"storage": strFieldOr(n.Data, "storageSize", "10Gi"),
				},
			},
		}
		if sc := strField(n.Data, "storageClass"); sc != "" {
			spec["storageClassName"] = sc
		}
		obj["spec"] = spec

	case "PersistentVolume":
		spec := map[string]interface{}{
			"accessModes": []string{strFieldOr(n.Data, "accessMode", "ReadWriteOnce")},
			"capacity": map[string]interface{}{
				"storage": strFieldOr(n.Data, "storageSize", "10Gi"),
			},
			"persistentVolumeReclaimPolicy": strFieldOr(n.Data, "reclaimPolicy", "Retain"),
			"hostPath": map[string]interface{}{
				"path": strFieldOr(n.Data, "hostPath", "/mnt/data"),
			},
		}
		if sc := strField(n.Data, "storageClass"); sc != "" {
			spec["storageClassName"] = sc
		}
		obj["spec"] = spec

	case "HorizontalPodAutoscaler":
		obj["spec"] = buildHPASpec(n, r)

	case "NetworkPolicy":
		obj["spec"] = buildNetworkPolicySpec(n, r)

	case "ServiceAccount":
		// A ServiceAccount is just metadata; the binding happens on the pods
		// that reference it (see buildPodSpec).

	case "Role", "ClusterRole":
		obj["rules"] = buildPolicyRules(n)

	case "RoleBinding", "ClusterRoleBinding":
		roleKind := "Role"
		if kind == "ClusterRoleBinding" {
			roleKind = "ClusterRole"
		}
		if rk := strField(n.Data, "roleKind"); rk != "" {
			roleKind = rk
		}
		obj["roleRef"] = map[string]interface{}{
			"apiGroup": "rbac.authorization.k8s.io",
			"kind":     roleKind,
			"name":     strFieldOr(n.Data, "roleName", resolveRoleName(n, r, roleKind)),
		}
		obj["subjects"] = buildSubjects(n, r)

	default:
		// Custom resources: the node carries a raw spec, which we parse rather
		// than rejecting the kind outright.
		return buildCustomResource(n, obj)
	}

	return obj, nil
}

func isClusterScoped(kind string) bool {
	switch kind {
	case "PersistentVolume", "ClusterRole", "ClusterRoleBinding", "Namespace":
		return true
	}
	return false
}

func mergeLabels(base, extra map[string]string) map[string]string {
	out := map[string]string{}
	for k, v := range base {
		out[k] = v
	}
	for k, v := range extra {
		out[k] = v
	}
	return out
}

func stringMapField(m map[string]interface{}, key string) map[string]string {
	out := map[string]string{}
	raw, ok := m[key].(map[string]interface{})
	if !ok {
		return out
	}
	for k, v := range raw {
		if s, ok := v.(string); ok {
			out[k] = s
		}
	}
	return out
}

// --- pod-level assembly ------------------------------------------------------

func buildPodTemplate(n GraphNode, r *resolver, restartPolicy ...string) map[string]interface{} {
	return map[string]interface{}{
		"metadata": map[string]interface{}{
			"labels": mergeLabels(n.podLabels(), stringMapField(n.Data, "podLabels")),
		},
		"spec": buildPodSpec(n, r, restartPolicy...),
	}
}

// buildPodSpec assembles the pod spec, folding in everything the incoming edges
// imply: config from ConfigMap/Secret, volumes from PVCs, identity from a
// ServiceAccount.
func buildPodSpec(n GraphNode, r *resolver, restartPolicy ...string) map[string]interface{} {
	container := map[string]interface{}{
		"name":  n.Name(),
		"image": defaultImageFor(n),
	}

	if port := containerPortFor(n); port > 0 {
		container["ports"] = []map[string]interface{}{{"containerPort": port}}
	}

	if cmd := commandField(n.Data, "command"); len(cmd) > 0 {
		container["command"] = cmd
	}
	if args := commandField(n.Data, "args"); len(args) > 0 {
		container["args"] = args
	}

	if env := sliceField(n.Data, "envVars"); len(env) > 0 {
		container["env"] = env
	}

	// Config edges: every ConfigMap/Secret wired into this workload becomes an
	// envFrom source. This is the payoff for drawing the yellow line.
	var envFrom []map[string]interface{}
	for _, src := range r.sourcesOf(n.ID, "ConfigMap") {
		envFrom = append(envFrom, map[string]interface{}{
			"configMapRef": map[string]interface{}{"name": src.Name()},
		})
	}
	for _, src := range r.sourcesOf(n.ID, "Secret") {
		envFrom = append(envFrom, map[string]interface{}{
			"secretRef": map[string]interface{}{"name": src.Name()},
		})
	}
	// Legacy single-field escape hatch, kept so older saved graphs still compile.
	if ref := strField(n.Data, "envFromSecret"); ref != "" {
		envFrom = append(envFrom, map[string]interface{}{
			"secretRef": map[string]interface{}{"name": ref},
		})
	}
	if len(envFrom) > 0 {
		container["envFrom"] = envFrom
	}

	if res := buildResources(n); res != nil {
		container["resources"] = res
	}

	// Storage edges: each PVC becomes a volume plus a mount.
	var volumes []map[string]interface{}
	var mounts []map[string]interface{}
	for _, pvc := range r.sourcesOf(n.ID, "PersistentVolumeClaim") {
		volName := "vol-" + pvc.Name()
		volumes = append(volumes, map[string]interface{}{
			"name": volName,
			"persistentVolumeClaim": map[string]interface{}{
				"claimName": pvc.Name(),
			},
		})
		mounts = append(mounts, map[string]interface{}{
			"name":      volName,
			"mountPath": strFieldOr(pvc.Data, "mountPath", "/data/"+pvc.Name()),
		})
	}
	if len(mounts) > 0 {
		container["volumeMounts"] = mounts
	}

	spec := map[string]interface{}{
		"containers": []map[string]interface{}{container},
	}
	if len(volumes) > 0 {
		spec["volumes"] = volumes
	}

	// Identity edges.
	if sas := r.sourcesOf(n.ID, "ServiceAccount"); len(sas) > 0 {
		spec["serviceAccountName"] = sas[0].Name()
	} else if sa := strField(n.Data, "serviceAccountName"); sa != "" {
		spec["serviceAccountName"] = sa
	}

	if len(restartPolicy) > 0 && restartPolicy[0] != "" {
		spec["restartPolicy"] = restartPolicy[0]
	}

	return spec
}

// defaultImageFor keeps the old per-kind default images so existing graphs keep
// behaving, while always preferring whatever the user typed.
func defaultImageFor(n GraphNode) string {
	if img := strField(n.Data, "image"); img != "" {
		return img
	}
	switch n.Kind() {
	case "StatefulSet":
		return "postgres:14-alpine"
	case "DaemonSet":
		return "fluent/fluentd:latest"
	case "Job", "CronJob":
		return "busybox:latest"
	}
	return "nginx:latest"
}

func containerPortFor(n GraphNode) int {
	if p := intField(n.Data, "containerPort", 0); p > 0 {
		return p
	}
	// Jobs and CronJobs usually do not listen on anything.
	switch n.Kind() {
	case "Job", "CronJob":
		return intField(n.Data, "port", 0)
	case "StatefulSet":
		return intField(n.Data, "port", 5432)
	case "DaemonSet":
		return intField(n.Data, "port", 24224)
	}
	return intField(n.Data, "port", 80)
}

// commandField accepts either a JSON array or a shell-ish string, because the
// node editor offers a plain text box. Quoted segments stay together, so
//
//	sh -c 'run migrations'
//
// yields three arguments rather than four.
func commandField(m map[string]interface{}, key string) []interface{} {
	if raw := sliceField(m, key); len(raw) > 0 {
		return raw
	}
	s := strField(m, key)
	if s == "" {
		return nil
	}
	var out []interface{}
	for _, part := range splitArgs(s) {
		out = append(out, part)
	}
	return out
}

// splitArgs splits on whitespace while honouring single and double quotes.
func splitArgs(s string) []string {
	var args []string
	var cur strings.Builder
	var quote rune
	hasCur := false

	for _, ch := range s {
		switch {
		case quote != 0:
			if ch == quote {
				quote = 0
			} else {
				cur.WriteRune(ch)
			}
		case ch == '\'' || ch == '"':
			quote = ch
			hasCur = true
		case ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r':
			if hasCur || cur.Len() > 0 {
				args = append(args, cur.String())
				cur.Reset()
				hasCur = false
			}
		default:
			cur.WriteRune(ch)
		}
	}
	if hasCur || cur.Len() > 0 {
		args = append(args, cur.String())
	}
	return args
}

func buildResources(n GraphNode) map[string]interface{} {
	requests := map[string]interface{}{}
	limits := map[string]interface{}{}

	if v := strField(n.Data, "cpuRequest"); v != "" {
		requests["cpu"] = v
	}
	if v := strField(n.Data, "memoryRequest"); v != "" {
		requests["memory"] = v
	}
	if v := strField(n.Data, "cpuLimit"); v != "" {
		limits["cpu"] = v
	}
	if v := strField(n.Data, "memoryLimit"); v != "" {
		limits["memory"] = v
	}

	out := map[string]interface{}{}
	if len(requests) > 0 {
		out["requests"] = requests
	}
	if len(limits) > 0 {
		out["limits"] = limits
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// buildVolumeClaimTemplates lets a StatefulSet own its storage rather than
// sharing a single PVC across replicas, when the PVC node opts in.
func buildVolumeClaimTemplates(n GraphNode, r *resolver) []map[string]interface{} {
	var out []map[string]interface{}
	for _, pvc := range r.sourcesOf(n.ID, "PersistentVolumeClaim") {
		if !boolField(pvc.Data, "asVolumeClaimTemplate") {
			continue
		}
		spec := map[string]interface{}{
			"accessModes": []string{strFieldOr(pvc.Data, "accessMode", "ReadWriteOnce")},
			"resources": map[string]interface{}{
				"requests": map[string]interface{}{
					"storage": strFieldOr(pvc.Data, "storageSize", "10Gi"),
				},
			},
		}
		if sc := strField(pvc.Data, "storageClass"); sc != "" {
			spec["storageClassName"] = sc
		}
		out = append(out, map[string]interface{}{
			"metadata": map[string]interface{}{"name": pvc.Name()},
			"spec":     spec,
		})
	}
	return out
}

// --- networking --------------------------------------------------------------

// buildServiceSpec resolves the selector from the workload this Service points
// at. Previously the selector was the Service's own name, which matched nothing.
func buildServiceSpec(n GraphNode, r *resolver) map[string]interface{} {
	port := intField(n.Data, "port", 80)
	targetPort := intField(n.Data, "targetPort", 0)

	selector := map[string]string{}
	if targets := r.targetsOf(n.ID, workloadKinds...); len(targets) > 0 {
		w := targets[0]
		selector = w.podLabels()
		if targetPort == 0 {
			targetPort = containerPortFor(w)
		}
	} else {
		// No edge drawn: fall back to the Service's own name so the manifest is
		// still valid, and let the UI flag the dangling Service.
		selector = map[string]string{"app": n.Name()}
	}
	if targetPort == 0 {
		targetPort = port
	}

	portEntry := map[string]interface{}{
		"port":       port,
		"targetPort": targetPort,
		"protocol":   strFieldOr(n.Data, "protocol", "TCP"),
	}
	svcType := strFieldOr(n.Data, "serviceType", "ClusterIP")
	if svcType == "NodePort" {
		if np := intField(n.Data, "nodePort", 0); np > 0 {
			portEntry["nodePort"] = np
		}
	}

	return map[string]interface{}{
		"type":     svcType,
		"selector": selector,
		"ports":    []map[string]interface{}{portEntry},
	}
}

// buildIngressSpec resolves its backend from the Service edge rather than
// pointing at a service named after the Ingress itself.
func buildIngressSpec(n GraphNode, r *resolver) map[string]interface{} {
	backendName := ""
	backendPort := intField(n.Data, "port", 0)

	if targets := r.targetsOf(n.ID, "Service"); len(targets) > 0 {
		svc := targets[0]
		backendName = svc.Name()
		if backendPort == 0 {
			backendPort = intField(svc.Data, "port", 80)
		}
	} else {
		backendName = strFieldOr(n.Data, "serviceName", n.Name())
	}
	if backendPort == 0 {
		backendPort = 80
	}

	host := strField(n.Data, "host")
	path := strFieldOr(n.Data, "path", "/")

	httpRule := map[string]interface{}{
		"paths": []map[string]interface{}{
			{
				"path":     path,
				"pathType": strFieldOr(n.Data, "pathType", "Prefix"),
				"backend": map[string]interface{}{
					"service": map[string]interface{}{
						"name": backendName,
						"port": map[string]interface{}{"number": backendPort},
					},
				},
			},
		},
	}

	rule := map[string]interface{}{"http": httpRule}
	if host != "" {
		rule["host"] = host
	}

	spec := map[string]interface{}{
		"rules": []map[string]interface{}{rule},
	}

	if class := strField(n.Data, "ingressClassName"); class != "" {
		spec["ingressClassName"] = class
	}

	// TLS was a checkbox in the editor that the compiler used to throw away.
	if boolField(n.Data, "tlsEnabled") && host != "" {
		tls := map[string]interface{}{"hosts": []string{host}}
		if secret := strField(n.Data, "tlsSecretName"); secret != "" {
			tls["secretName"] = secret
		} else {
			tls["secretName"] = n.Name() + "-tls"
		}
		spec["tls"] = []map[string]interface{}{tls}
	}

	return spec
}

func buildHPASpec(n GraphNode, r *resolver) map[string]interface{} {
	targetKind := strFieldOr(n.Data, "targetKind", "Deployment")
	targetName := strField(n.Data, "targetName")

	if targets := r.targetsOf(n.ID, scalableKinds...); len(targets) > 0 {
		targetKind = targets[0].Kind()
		targetName = targets[0].Name()
	}
	if targetName == "" {
		targetName = n.Name()
	}

	targetCPU := intField(n.Data, "targetCPU", 80)

	return map[string]interface{}{
		"scaleTargetRef": map[string]interface{}{
			"apiVersion": "apps/v1",
			"kind":       targetKind,
			"name":       targetName,
		},
		"minReplicas": intField(n.Data, "minReplicas", 1),
		"maxReplicas": intField(n.Data, "maxReplicas", 10),
		"metrics": []map[string]interface{}{
			{
				"type": "Resource",
				"resource": map[string]interface{}{
					"name": "cpu",
					"target": map[string]interface{}{
						"type":               "Utilization",
						"averageUtilization": targetCPU,
					},
				},
			},
		},
	}
}

func buildNetworkPolicySpec(n GraphNode, r *resolver) map[string]interface{} {
	selector := map[string]string{}
	if targets := r.targetsOf(n.ID, workloadKinds...); len(targets) > 0 {
		selector = targets[0].podLabels()
	}

	policyTypes := []string{}
	for _, t := range strings.Split(strFieldOr(n.Data, "policyTypes", "Ingress"), ",") {
		if t = strings.TrimSpace(t); t != "" {
			policyTypes = append(policyTypes, t)
		}
	}

	spec := map[string]interface{}{
		"podSelector": map[string]interface{}{"matchLabels": selector},
		"policyTypes": policyTypes,
	}

	// Default-deny unless the node opts into allowing same-namespace traffic.
	if boolField(n.Data, "allowSameNamespace") {
		spec["ingress"] = []map[string]interface{}{
			{"from": []map[string]interface{}{
				{"podSelector": map[string]interface{}{}},
			}},
		}
	}

	return spec
}

// --- RBAC --------------------------------------------------------------------

func buildPolicyRules(n GraphNode) []map[string]interface{} {
	apiGroups := splitCSV(strFieldOr(n.Data, "apiGroups", ""))
	if len(apiGroups) == 0 {
		apiGroups = []string{""}
	}
	resources := splitCSV(strFieldOr(n.Data, "resources", "pods"))
	verbs := splitCSV(strFieldOr(n.Data, "verbs", "get,list,watch"))

	return []map[string]interface{}{
		{
			"apiGroups": apiGroups,
			"resources": resources,
			"verbs":     verbs,
		},
	}
}

func resolveRoleName(n GraphNode, r *resolver, roleKind string) string {
	if srcs := r.sourcesOf(n.ID, roleKind); len(srcs) > 0 {
		return srcs[0].Name()
	}
	if tgts := r.targetsOf(n.ID, roleKind); len(tgts) > 0 {
		return tgts[0].Name()
	}
	return n.Name()
}

func buildSubjects(n GraphNode, r *resolver) []map[string]interface{} {
	var subjects []map[string]interface{}
	accounts := append(r.sourcesOf(n.ID, "ServiceAccount"), r.targetsOf(n.ID, "ServiceAccount")...)
	for _, sa := range accounts {
		subjects = append(subjects, map[string]interface{}{
			"kind":      "ServiceAccount",
			"name":      sa.Name(),
			"namespace": sa.Namespace(),
		})
	}
	if len(subjects) == 0 {
		subjects = append(subjects, map[string]interface{}{
			"kind":      "ServiceAccount",
			"name":      strFieldOr(n.Data, "subjectName", "default"),
			"namespace": n.Namespace(),
		})
	}
	return subjects
}

func splitCSV(s string) []string {
	var out []string
	for _, part := range strings.Split(s, ",") {
		if part = strings.TrimSpace(part); part != "" {
			out = append(out, part)
		}
	}
	return out
}

// --- custom resources --------------------------------------------------------

// buildCustomResource handles kinds k8n has no first-class model for. The node's
// "spec" textarea is parsed as YAML so CRDs discovered from the cluster are
// actually usable instead of being rejected at compile time.
func buildCustomResource(n GraphNode, obj map[string]interface{}) (map[string]interface{}, error) {
	apiVersion := strField(n.Data, "apiVersion")
	if apiVersion == "" {
		group := strField(n.Data, "group")
		version := strFieldOr(n.Data, "version", "v1")
		if group == "" {
			return nil, fmt.Errorf("custom resources need an apiVersion (set it on the node)")
		}
		apiVersion = group + "/" + version
	}
	obj["apiVersion"] = apiVersion

	raw := strField(n.Data, "spec")
	if raw == "" {
		return obj, nil
	}

	var spec interface{}
	if err := yaml.Unmarshal([]byte(raw), &spec); err != nil {
		return nil, fmt.Errorf("spec is not valid YAML: %w", err)
	}
	obj["spec"] = spec
	return obj, nil
}
