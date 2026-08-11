package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/user/k8s-graph-controller/backend/internal/ai"
	"google.golang.org/genai"
)

// AIConfig is resolved once at startup.
var aiConfig = ai.ConfigFromEnv()

// GetAIStatus tells the frontend whether to show AI features at all.
func GetAIStatus() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"enabled":    aiConfig.Enabled(),
			"model":      aiConfig.Model,
			"agents":     []string{"inspector", "architect"},
			"mcpServers": ConnectedMCPServers(),
		})
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
}

// AIChat streams an assistant turn over SSE.
func AIChat(clientGetter ClientGetter) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !aiConfig.Enabled() {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error": "AI features are not configured",
				"hint":  "Set GEMINI_API_KEY to enable the assistant. Everything else in k8n works without it.",
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

		client, err := ai.NewClient(ctx, aiConfig)
		if err != nil || client == nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to initialise the assistant", "details": fmt.Sprint(err)})
			return
		}

		// SSE preamble.
		c.Writer.Header().Set("Content-Type", "text/event-stream")
		c.Writer.Header().Set("Cache-Control", "no-cache")
		c.Writer.Header().Set("Connection", "keep-alive")
		c.Writer.Header().Set("X-Accel-Buffering", "no")
		c.Writer.WriteHeader(http.StatusOK)
		c.Writer.Flush()

		emit := func(ev ai.Event) {
			data, err := json.Marshal(ev)
			if err != nil {
				return
			}
			fmt.Fprintf(c.Writer, "data: %s\n\n", data)
			c.Writer.Flush()
		}

		history := make([]*genai.Content, 0, len(req.History)+1)
		for _, turn := range req.History {
			if turn.Role == "model" {
				history = append(history, ai.ModelContent(turn.Text))
			} else {
				history = append(history, ai.UserContent(turn.Text))
			}
		}
		history = append(history, ai.UserContent(buildUserTurn(req)))

		tools := agentTeam(client, clientGetter, req.Graph, remoteMCP, emit)

		if err := client.Run(ctx, supervisorPrompt, history, tools, emit); err != nil {
			emit(ai.Event{Type: "error", Message: err.Error()})
		}
		emit(ai.Event{Type: "done"})
	}
}

// buildUserTurn attaches the canvas context to the user's question, so the
// assistant can answer about what is on screen.
func buildUserTurn(req chatRequest) string {
	var sb strings.Builder
	sb.WriteString(req.Message)

	if req.Graph != nil && len(req.Graph.Nodes) > 0 {
		sb.WriteString("\n\n---\nThe user's canvas currently contains:\n")
		for _, n := range req.Graph.Nodes {
			sb.WriteString(fmt.Sprintf("- %s %q (id %s, namespace %s)\n", n.Kind(), n.Name(), n.ID, n.Namespace()))
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

	if req.Namespace != "" && req.Namespace != "all" {
		sb.WriteString(fmt.Sprintf("Active namespace: %s\n", req.Namespace))
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
		if !aiConfig.Enabled() {
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

		client, err := ai.NewClient(ctx, aiConfig)
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
		err = client.Run(ctx, inspectorPrompt, []*genai.Content{ai.UserContent(prompt)}, nil, func(ev ai.Event) {
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
