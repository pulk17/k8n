package handlers

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/user/k8s-graph-controller/backend/internal/ai"
	"google.golang.org/genai"
)

// The assistant's configuration is read per request, not captured at startup:
// a key added through the UI has to take effect without a restart.

// GetAIStatus tells the frontend whether to show AI features at all.
func GetAIStatus() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(http.StatusOK, aiStatus())
	}
}

// aiStatus is the one shape every AI settings route answers with. Save and
// Forget used to reply with a shorter one that had no provider list, and the
// settings form, which swaps in whatever came back, lost its provider options.
func aiStatus() gin.H {
	cfg := ai.Current()
	return gin.H{
		"enabled":    cfg.Enabled(),
		"model":      cfg.Model,
		"provider":   cfg.Provider,
		"baseUrl":    cfg.BaseURL,
		"keyHint":    cfg.Masked(),
		"source":     cfg.Source,
		"providers":  ai.Providers,
		"mcpServers": ConnectedMCPServers(),
	}
}

// chatRequest is the body of POST /api/ai/chat.
type chatRequest struct {
	Message string `json:"message" binding:"required"`
	// History is prior turns, oldest first.
	History []struct {
		Role string `json:"role"` // "user" | "model"
		Text string `json:"text"`
	} `json:"history"`
	// Graph is the canvas as it stands, so the assistant can reason about what
	// the user is actually looking at.
	Graph     *Graph `json:"graph"`
	Namespace string `json:"namespace"`
	// Depth is how much Kubernetes the reader wants explained: "new", "some" or
	// "expert". The answer is pitched at it.
	Depth string `json:"depth"`
	// Notes are the problems k8n is already showing on screen — failed checks,
	// chart warnings. Without them the assistant re-discovers what the user can
	// already see, and sometimes contradicts it.
	Notes []string `json:"notes"`
}

// AIChat streams an assistant turn over SSE.
func AIChat(clientGetter ClientGetter) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !ai.Current().Enabled() {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error": "AI features are not configured",
				"hint":  "Choose a provider and add a key in the assistant panel. Everything else in k8n works without it.",
			})
			return
		}

		var req chatRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		ctx, cancel := context.WithTimeout(c.Request.Context(), 120*time.Second)
		defer cancel()

		client, err := ai.NewClient(ctx, ai.Current())
		if err != nil || client == nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to initialise the assistant", "details": fmt.Sprint(err)})
			return
		}

		sseHeaders(c)
		emit := func(ev ai.Event) { sseSend(c, ev) }

		// Only the recent conversation goes back: every earlier turn is resent on
		// every request, and old answers rarely matter to the new question.
		turns := req.History
		if len(turns) > maxHistoryTurns {
			turns = turns[len(turns)-maxHistoryTurns:]
		}
		history := make([]*genai.Content, 0, len(turns)+1)
		for _, turn := range turns {
			turn.Text = shorten(turn.Text, 1500)
			if turn.Role == "model" {
				history = append(history, ai.ModelContent(turn.Text))
			} else {
				history = append(history, ai.UserContent(turn.Text))
			}
		}
		history = append(history, ai.UserContent(buildUserTurn(req)))

		tools := assistantTools(clientGetter, req.Graph, remoteMCP, emit)

		if err := client.Run(ctx, assistantPrompt, history, tools, emit); err != nil {
			emit(ai.Event{Type: "error", Message: err.Error()})
		}
		emit(ai.Event{Type: "done"})
	}
}

const maxHistoryTurns = 6

// shorten keeps the start of a long earlier answer; the conclusion is up front.
func shorten(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max] + "…"
}

// buildUserTurn attaches the canvas context to the user's question, so the
// assistant can answer about what is on screen.
func buildUserTurn(req chatRequest) string {
	var sb strings.Builder
	sb.WriteString(req.Message)

	if req.Graph != nil && len(req.Graph.Nodes) > 0 {
		sb.WriteString("\n\n---\nThe user's canvas currently contains:\n")
		for _, n := range req.Graph.Nodes {
			sb.WriteString(fmt.Sprintf("- %s %q (id %s, namespace %s)", n.Kind(), n.Name(), n.ID, n.Namespace()))
			// The status on the card the user is looking at. "ImagePullBackOff"
			// is the entire question in most "why is this broken" turns.
			if status := strField(n.Data, "status"); status != "" {
				sb.WriteString(fmt.Sprintf(" — status: %s", status))
			}
			if msg := strField(n.Data, "statusMessage"); msg != "" {
				sb.WriteString(fmt.Sprintf(" (%s)", msg))
			}
			if strField(n.Data, "origin") == "helm" {
				sb.WriteString(" [rendered from a Helm chart; Helm owns it]")
			}
			sb.WriteString("\n")
		}
		if len(req.Graph.Edges) > 0 {
			sb.WriteString("Edges:\n")
			byID := map[string]GraphNode{}
			for _, n := range req.Graph.Nodes {
				byID[n.ID] = n
			}
			for _, e := range req.Graph.Edges {
				src, dst := byID[e.Source], byID[e.Target]
				sb.WriteString(fmt.Sprintf("- %s %q -> %s %q\n", src.Kind(), src.Name(), dst.Kind(), dst.Name()))
			}
		} else {
			sb.WriteString("(no edges drawn yet)\n")
		}
	}

	if len(req.Notes) > 0 {
		sb.WriteString("\nProblems k8n is already showing the user on screen:\n")
		for _, note := range req.Notes {
			sb.WriteString("- " + note + "\n")
		}
	}

	if req.Namespace != "" && req.Namespace != "all" {
		sb.WriteString(fmt.Sprintf("Active namespace: %s\n", req.Namespace))
	}

	// One line, because the difference between a good answer for a beginner and
	// for an expert is almost entirely where it starts.
	switch req.Depth {
	case "new":
		sb.WriteString("The reader is new to Kubernetes: explain what an object is for before " +
			"using its name as if it were understood, and keep it in plain words.\n")
	case "expert":
		sb.WriteString("The reader uses Kubernetes daily: skip the basics and be terse.\n")
	}

	return sb.String()
}

func strSchema(desc string) *genai.Schema {
	return &genai.Schema{Type: genai.TypeString, Description: desc}
}

// explainRequest is the body of POST /api/ai/explain.
type explainRequest struct {
	Graph  *Graph `json:"graph"`
	NodeID string `json:"nodeId"`
}

// AIExplain returns a plain-English explanation of one node and its wiring.
func AIExplain(clientGetter ClientGetter) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !ai.Current().Enabled() {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "AI features are not configured"})
			return
		}

		var req explainRequest
		if err := c.ShouldBindJSON(&req); err != nil || req.Graph == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Expected {graph, nodeId}"})
			return
		}

		var target *GraphNode
		for i := range req.Graph.Nodes {
			if req.Graph.Nodes[i].ID == req.NodeID {
				target = &req.Graph.Nodes[i]
				break
			}
		}
		if target == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Node not found in the submitted graph"})
			return
		}

		ctx, cancel := context.WithTimeout(c.Request.Context(), 60*time.Second)
		defer cancel()

		client, err := ai.NewClient(ctx, ai.Current())
		if err != nil || client == nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to initialise the assistant"})
			return
		}

		// Compiling first means the explanation describes what will actually be
		// applied, not what the model imagines from the node's fields.
		manifest := ""
		if docs, _, err := BuildManifests(Graph{Nodes: []GraphNode{*target}, Edges: req.Graph.Edges}); err == nil {
			manifest = strings.Join(docs, "\n---\n")
		}

		prompt := fmt.Sprintf(
			"Explain this %s named %q in two or three short sentences: what it does, what it is connected to, and anything that looks wrong or incomplete.\n\n"+
				"Graph context:\n%s\n\nCompiled manifest:\n%s",
			target.Kind(), target.Name(), buildUserTurn(chatRequest{Graph: req.Graph}), manifest)

		var sb strings.Builder
		err = client.Run(ctx, assistantPrompt, []*genai.Content{ai.UserContent(prompt)}, nil, func(ev ai.Event) {
			if ev.Type == "text" {
				sb.WriteString(ev.Text)
			}
		})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{"explanation": strings.TrimSpace(sb.String())})
	}
}
