package handlers

import (
	"fmt"
	"sort"
	"strings"
)

// GraphNode mirrors a React Flow node. Data is intentionally untyped — the
// canvas stores per-kind fields that vary widely, and the builders below pick
// out what each kind needs.
type GraphNode struct {
	ID   string                 `json:"id"`
	Data map[string]interface{} `json:"data"`
}

// GraphEdge mirrors a React Flow edge.
type GraphEdge struct {
	ID     string `json:"id"`
	Source string `json:"source"`
	Target string `json:"target"`
}

// Graph is the whole canvas: what the user drew, sent in one piece so that
// compilation can resolve relationships instead of guessing at them.
type Graph struct {
	Nodes []GraphNode `json:"nodes"`
	Edges []GraphEdge `json:"edges"`
}

// Kind returns the Kubernetes kind for a node, or "" when absent.
func (n GraphNode) Kind() string { return strField(n.Data, "kind") }

// Name returns the object name for a node.
func (n GraphNode) Name() string { return strField(n.Data, "name") }

// Namespace returns the node's namespace, defaulting to "default".
func (n GraphNode) Namespace() string {
	if ns := strField(n.Data, "namespace"); ns != "" {
		return ns
	}
	return "default"
}

// IsFromCluster reports whether this node was imported from a live cluster
// rather than authored on the canvas. Imported nodes are only ever compiled as
// partial objects (see editedFields) so that applying them cannot clobber spec
// fields k8n never knew about.
func (n GraphNode) IsFromCluster() bool { return strField(n.Data, "origin") == "cluster" }

// editedFields returns the set of field names the user actually changed on an
// imported node. The canvas records these in data.__edited.
func (n GraphNode) editedFields() map[string]bool {
	out := map[string]bool{}
	raw, ok := n.Data["__edited"].(map[string]interface{})
	if !ok {
		return out
	}
	for k, v := range raw {
		if b, ok := v.(bool); ok && b {
			out[k] = true
		}
	}
	return out
}

// podLabels is the label set a workload stamps onto its pods. Services and
// selectors resolve against this, which is what makes an edge mean something.
func (n GraphNode) podLabels() map[string]string {
	return map[string]string{"app": n.Name()}
}

// resolver indexes a graph so relationship lookups are O(1) per edge instead of
// a scan per question.
type resolver struct {
	byID     map[string]GraphNode
	outgoing map[string][]string // node ID -> target node IDs
	incoming map[string][]string // node ID -> source node IDs
}

func newResolver(g Graph) *resolver {
	r := &resolver{
		byID:     make(map[string]GraphNode, len(g.Nodes)),
		outgoing: make(map[string][]string),
		incoming: make(map[string][]string),
	}
	for _, n := range g.Nodes {
		r.byID[n.ID] = n
	}
	for _, e := range g.Edges {
		if _, ok := r.byID[e.Source]; !ok {
			continue
		}
		if _, ok := r.byID[e.Target]; !ok {
			continue
		}
		r.outgoing[e.Source] = append(r.outgoing[e.Source], e.Target)
		r.incoming[e.Target] = append(r.incoming[e.Target], e.Source)
	}
	return r
}

// targetsOf returns nodes this node points at, restricted to the given kinds.
func (r *resolver) targetsOf(id string, kinds ...string) []GraphNode {
	return r.pick(r.outgoing[id], kinds)
}

// sourcesOf returns nodes pointing at this node, restricted to the given kinds.
func (r *resolver) sourcesOf(id string, kinds ...string) []GraphNode {
	return r.pick(r.incoming[id], kinds)
}

func (r *resolver) pick(ids []string, kinds []string) []GraphNode {
	allowed := make(map[string]bool, len(kinds))
	for _, k := range kinds {
		allowed[k] = true
	}
	var out []GraphNode
	for _, id := range ids {
		n, ok := r.byID[id]
		if !ok {
			continue
		}
		if len(allowed) == 0 || allowed[n.Kind()] {
			out = append(out, n)
		}
	}
	// Stable ordering keeps compiled YAML deterministic across runs.
	sort.Slice(out, func(i, j int) bool { return out[i].Name() < out[j].Name() })
	return out
}

var workloadKinds = []string{"Deployment", "StatefulSet", "DaemonSet", "ReplicaSet", "Pod", "Job", "CronJob"}

// scalableKinds are what an HPA is allowed to target.
var scalableKinds = []string{"Deployment", "StatefulSet", "ReplicaSet"}

// --- small typed accessors over the untyped node data ------------------------

func strField(m map[string]interface{}, key string) string {
	if m == nil {
		return ""
	}
	if v, ok := m[key].(string); ok {
		return strings.TrimSpace(v)
	}
	return ""
}

func strFieldOr(m map[string]interface{}, key, def string) string {
	if v := strField(m, key); v != "" {
		return v
	}
	return def
}

func intField(m map[string]interface{}, key string, def int) int {
	if m == nil {
		return def
	}
	switch v := m[key].(type) {
	case float64:
		return int(v)
	case int:
		return v
	case string:
		var parsed int
		if _, err := fmt.Sscanf(v, "%d", &parsed); err == nil {
			return parsed
		}
	}
	return def
}

func boolField(m map[string]interface{}, key string) bool {
	if m == nil {
		return false
	}
	b, _ := m[key].(bool)
	return b
}

func sliceField(m map[string]interface{}, key string) []interface{} {
	if m == nil {
		return nil
	}
	v, _ := m[key].([]interface{})
	return v
}

// parseKeyValues turns the "KEY=value" textareas used by ConfigMap and Secret
// nodes into a map. Lines without an "=" are treated as a single embedded file
// under fallbackKey, which is how people paste whole config files in.
func parseKeyValues(raw, fallbackKey string) map[string]string {
	out := map[string]string{}
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return out
	}
	sawPair := false
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if idx := strings.Index(line, "="); idx > 0 {
			key := strings.TrimSpace(line[:idx])
			val := strings.TrimSpace(line[idx+1:])
			if key != "" {
				out[key] = val
				sawPair = true
			}
		}
	}
	if !sawPair {
		return map[string]string{fallbackKey: raw}
	}
	return out
}
