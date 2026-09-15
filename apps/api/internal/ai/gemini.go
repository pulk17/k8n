// Package ai provides k8n's assistant.
//
// The assistant never touches the cluster directly. It reads cluster state
// through the same functions the REST API and MCP server use, and any change it
// proposes comes back as a graph patch the user accepts or rejects on the
// canvas. Applying remains a human action.
//
// The agent loop below is the whole assistant. Which model runs it is a
// provider (see config.go): Google through its SDK, everyone else through the
// OpenAI chat format.
package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"google.golang.org/genai"
)

// provider is one model endpoint. It takes the conversation so far and returns
// the model's next turn — prose, tool calls, or both.
type provider interface {
	generate(
		ctx context.Context,
		system string,
		contents []*genai.Content,
		decls []*genai.FunctionDeclaration,
	) (*genai.Content, error)
	name() string
}

// Client runs k8n's tool loop against whichever provider is configured.
type Client struct {
	backend provider
	model   string
}

// NewClient builds a client for the given configuration, or returns nil when
// nothing is configured — callers treat nil as "the assistant is off".
func NewClient(ctx context.Context, cfg Config) (*Client, error) {
	cfg = cfg.resolved()
	if !cfg.Enabled() {
		return nil, nil
	}

	if cfg.Provider == ProviderGoogle {
		gc, err := genai.NewClient(ctx, &genai.ClientConfig{
			APIKey:  cfg.APIKey,
			Backend: genai.BackendGeminiAPI,
		})
		if err != nil {
			return nil, fmt.Errorf("failed to create the Gemini client: %w", err)
		}
		return &Client{backend: &geminiProvider{genai: gc, model: cfg.Model}, model: cfg.Model}, nil
	}

	if cfg.BaseURL == "" {
		return nil, fmt.Errorf("%s needs a base URL", cfg.Provider)
	}
	return &Client{
		backend: &openAIProvider{
			baseURL: cfg.BaseURL,
			apiKey:  cfg.APIKey,
			model:   cfg.Model,
			// Generous: a reasoning model with six rounds of tools is not quick,
			// and the handler's own context bounds the whole turn anyway.
			http: &http.Client{Timeout: 120 * time.Second},
		},
		model: cfg.Model,
	}, nil
}

// geminiProvider is Google's SDK behind the same interface.
type geminiProvider struct {
	genai *genai.Client
	model string
}

func (p *geminiProvider) name() string { return p.model }

func (p *geminiProvider) generate(
	ctx context.Context,
	system string,
	contents []*genai.Content,
	decls []*genai.FunctionDeclaration,
) (*genai.Content, error) {
	config := &genai.GenerateContentConfig{
		SystemInstruction: &genai.Content{
			Role:  "user",
			Parts: []*genai.Part{{Text: system}},
		},
	}
	if len(decls) > 0 {
		config.Tools = []*genai.Tool{{FunctionDeclarations: decls}}
	}

	resp, err := p.genai.Models.GenerateContent(ctx, p.model, contents, config)
	if err != nil {
		return nil, fmt.Errorf("Gemini request failed: %w", err)
	}
	if len(resp.Candidates) == 0 || resp.Candidates[0].Content == nil {
		return nil, fmt.Errorf("the model returned no content")
	}
	return resp.Candidates[0].Content, nil
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

	contents := history

	for round := 0; round < maxToolRounds; round++ {
		candidate, err := c.backend.generate(ctx, systemPrompt, contents, decls)
		if err != nil {
			return err
		}
		contents = append(contents, candidate)

		// Surface any prose the model produced this round.
		for _, part := range candidate.Parts {
			if part.Text != "" {
				emit(Event{Type: "text", Text: part.Text})
			}
		}

		// Read the calls off the turn itself rather than from a provider's
		// response type, so every backend goes through the same path.
		var calls []*genai.FunctionCall
		for _, part := range candidate.Parts {
			if part.FunctionCall != nil {
				calls = append(calls, part.FunctionCall)
			}
		}
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
						// The id is carried back so a provider that matches
						// results to calls by id (anything OpenAI-shaped) can.
						ID:       call.ID,
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
				FunctionResponse: &genai.FunctionResponse{ID: call.ID, Name: call.Name, Response: result},
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
