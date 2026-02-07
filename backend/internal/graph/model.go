package graph

// Position represents the x, y coordinates of a node on the canvas
type Position struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// NodeData contains the kubernetes specific data and UI metadata
type NodeData struct {
	// K8s Metadata
	APIVersion string `json:"apiVersion"`
	Kind       string `json:"kind"`
	Name       string `json:"name"`
	Namespace  string `json:"namespace"`

	// The full K8s resource spec
	Spec interface{} `json:"spec"`

	// Real-time status from K8s
	Status interface{} `json:"status,omitempty"`

	// UI helpers
	Label  string      `json:"label"`
	Schema interface{} `json:"schema,omitempty"` // JSON Schema for the node's form
}

// Node represents a single entity in the implementation graph
type Node struct {
	ID       string   `json:"id"`
	Type     string   `json:"type"` // e.g., "generic-k8s-node"
	Position Position `json:"position"`
	Data     NodeData `json:"data"`

	// Edges/Connections are usually stored separately or as adjacency list,
	// but React Flow often keeps them in a separate array.
	// We might add ParentID if we support nesting (groups).
	ParentNode string `json:"parentNode,omitempty"`
}

// Graph represents the full state of the canvas
type Graph struct {
	Nodes []Node `json:"nodes"`
	Edges []Edge `json:"edges"`
}

// Edge represents a connection between nodes
type Edge struct {
	ID       string `json:"id"`
	Source   string `json:"source"`
	Target   string `json:"target"`
	Type     string `json:"type"` // e.g., "dependency" or "data-flow"
	Animated bool   `json:"animated,omitempty"`
	Label    string `json:"label,omitempty"`
}
