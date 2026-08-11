// Package ai provides k8n's Gemini-backed assistant.
//
// The assistant never touches the cluster directly. It reads cluster state
// through the same functions the REST API and MCP server use, and any change it
// proposes comes back as a graph patch the user accepts or rejects on the
// canvas. Applying remains a human action.
package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"google.golang.org/genai"
)

// DefaultModel is used when GEMINI_MODEL is unset.
const DefaultModel = "gemini-2.5-flash"

// Config describes the assistant's model access.
type Config struct {
	APIKey string
	Model  string
}

// ConfigFromEnv reads the assistant configuration.
func ConfigFromEnv() Config {
	model := os.Getenv("GEMINI_MODEL")
	if model == "" {
		model = DefaultModel
	}
	return Config{
		APIKey: strings.TrimSpace(os.Getenv("GEMINI_API_KEY")),
		Model:  model,
	}
}

// Enabled reports whether AI features should be offered at all. Without a key
// every AI surface stays hidden and the rest of k8n is unaffected.
func (c Config) Enabled() bool { return c.APIKey != "" }

// Client wraps the Gemini SDK with k8n's tool loop.
type Client struct {
	genai *genai.Client
	model string
}

// NewClient builds a Gemini client, or returns nil when no key is configured.
func NewClient(ctx context.Context, cfg Config) (*Client, error) {
	if !cfg.Enabled() {
		return nil, nil
	}
	gc, err := genai.NewClient(ctx, &genai.ClientConfig{
		APIKey:  cfg.APIKey,
		Backend: genai.BackendGeminiAPI,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create Gemini client: %w", err)
	}
	return &Client{genai: gc, model: cfg.Model}, nil
}

// Tool is a function the model may call.
type Tool struct {
	Name        string
	Description string
	// Parameters is a JSON-schema-ish description of the arguments.
	Parameters *genai.Schema
	// Execute runs the tool. Returned values are treated as data, never as
	// instructions.
	Execute func(ctx context.Context, args map[string]any) (string, error)
}

// Event is one step of a streamed assistant turn.
type Event struct {
	Type    string `json:"type"` // "text" | "tool" | "patch" | "error" | "done"
	Text    string `json:"text,omitempty"`
	Tool    string `json:"tool,omitempty"`
	Detail  string `json:"detail,omitempty"`
	Patch   any    `json:"patch,omitempty"`
	Message string `json:"message,omitempty"`
}

// maxToolRounds bounds the agent loop so a confused model cannot spin forever.
const maxToolRounds = 6

// Run executes a full assistant turn: the model may call tools repeatedly, and
// each step is reported through emit.
func (c *Client) Run(
	ctx context.Context,
	systemPrompt string,
	history []*genai.Content,
	tools []Tool,
	emit func(Event),
) error {
	byName := make(map[string]Tool, len(tools))
	decls := make([]*genai.FunctionDeclaration, 0, len(tools))
	for _, t := range tools {
		byName[t.Name] = t
		decls = append(decls, &genai.FunctionDeclaration{
			Name:        t.Name,
			Description: t.Description,
			Parameters:  t.Parameters,
		})
	}

	config := &genai.GenerateContentConfig{
		SystemInstruction: &genai.Content{
			Role:  "user",
			Parts: []*genai.Part{{Text: systemPrompt}},
		},
	}
	if len(decls) > 0 {
		config.Tools = []*genai.Tool{{FunctionDeclarations: decls}}
	}

	contents := history

	for round := 0; round < maxToolRounds; round++ {
		resp, err := c.genai.Models.GenerateContent(ctx, c.model, contents, config)
		if err != nil {
			return fmt.Errorf("Gemini request failed: %w", err)
		}
		if len(resp.Candidates) == 0 || resp.Candidates[0].Content == nil {
			return fmt.Errorf("the model returned no content")
		}

		candidate := resp.Candidates[0].Content
		contents = append(contents, candidate)

		// Surface any prose the model produced this round.
		for _, part := range candidate.Parts {
			if part.Text != "" {
				emit(Event{Type: "text", Text: part.Text})
			}
		}

		calls := resp.FunctionCalls()
		if len(calls) == 0 {
			return nil // the model is done talking
		}

		// Run each requested tool and feed the results back.
		var responseParts []*genai.Part
		for _, call := range calls {
			tool, ok := byName[call.Name]
			if !ok {
				responseParts = append(responseParts, &genai.Part{
					FunctionResponse: &genai.FunctionResponse{
						Name:     call.Name,
						Response: map[string]any{"error": "unknown tool"},
					},
				})
				continue
			}

			emit(Event{Type: "tool", Tool: call.Name, Detail: summarizeArgs(call.Args)})

			output, err := tool.Execute(ctx, call.Args)
			result := map[string]any{}
			if err != nil {
				result["error"] = err.Error()
			} else {
				// Tool output is cluster data. It is wrapped as a plain value so
				// the model treats it as an observation, not as a new prompt.
				result["result"] = truncate(output, 24000)
			}

			responseParts = append(responseParts, &genai.Part{
				FunctionResponse: &genai.FunctionResponse{Name: call.Name, Response: result},
			})
		}

		contents = append(contents, &genai.Content{Role: "user", Parts: responseParts})
	}

	emit(Event{
		Type:    "error",
		Message: "Stopped after too many tool calls without reaching an answer.",
	})
	return nil
}

func summarizeArgs(args map[string]any) string {
	if len(args) == 0 {
		return ""
	}
	data, err := json.Marshal(args)
	if err != nil {
		return ""
	}
	return truncate(string(data), 200)
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	// Keep the tail of logs — the failure is usually at the end.
	return "…(truncated)…\n" + s[len(s)-max:]
}

// UserContent builds a user turn.
func UserContent(text string) *genai.Content {
	return &genai.Content{Role: "user", Parts: []*genai.Part{{Text: text}}}
}

// ModelContent builds a prior assistant turn.
func ModelContent(text string) *genai.Content {
	return &genai.Content{Role: "model", Parts: []*genai.Part{{Text: text}}}
}
