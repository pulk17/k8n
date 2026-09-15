package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"google.golang.org/genai"
)

// One client for every provider that speaks the OpenAI chat format — which is
// nearly all of them.
//
// The conversation is kept in Google's genai types because that is what the
// agent loop, the tool declarations and the handlers already use; this file
// translates in both directions each round. That is a little conversion work
// per request in exchange for not having a second copy of the loop, the tools
// and the prompts.

type openAIProvider struct {
	baseURL string
	apiKey  string
	model   string
	http    *http.Client
}

func (p *openAIProvider) name() string { return p.model }

// --- the wire format ---------------------------------------------------------

type oaMessage struct {
	Role       string       `json:"role"`
	Content    string       `json:"content,omitempty"`
	ToolCalls  []oaToolCall `json:"tool_calls,omitempty"`
	ToolCallID string       `json:"tool_call_id,omitempty"`
	Name       string       `json:"name,omitempty"`
}

type oaToolCall struct {
	ID       string     `json:"id"`
	Type     string     `json:"type"`
	Function oaCallBody `json:"function"`
}

type oaCallBody struct {
	Name string `json:"name"`
	// Arguments is a JSON *string*, not an object. Providers differ on whether
	// they send valid JSON in it, so parsing is defensive below.
	Arguments string `json:"arguments"`
}

type oaTool struct {
	Type     string     `json:"type"`
	Function oaFunction `json:"function"`
}

type oaFunction struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Parameters  any    `json:"parameters,omitempty"`
}

type oaRequest struct {
	Model    string      `json:"model"`
	Messages []oaMessage `json:"messages"`
	Tools    []oaTool    `json:"tools,omitempty"`
}

type oaResponse struct {
	Choices []struct {
		Message oaMessage `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
		Type    string `json:"type"`
	} `json:"error"`
}

// --- generate ----------------------------------------------------------------

func (p *openAIProvider) generate(
	ctx context.Context,
	system string,
	contents []*genai.Content,
	decls []*genai.FunctionDeclaration,
) (*genai.Content, error) {
	body := oaRequest{
		Model:    p.model,
		Messages: append([]oaMessage{{Role: "system", Content: system}}, toMessages(contents)...),
		Tools:    toTools(decls),
	}

	payload, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}

	url := strings.TrimSuffix(p.baseURL, "/") + "/chat/completions"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if p.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+p.apiKey)
	}

	res, err := p.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("could not reach %s: %w", url, err)
	}
	defer res.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(res.Body, 8<<20))
	if err != nil {
		return nil, err
	}

	var parsed oaResponse
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, fmt.Errorf("%s returned something that is not JSON (%s): %s",
			url, res.Status, truncate(string(raw), 200))
	}
	if parsed.Error != nil {
		return nil, fmt.Errorf("%s: %s", res.Status, parsed.Error.Message)
	}
	if res.StatusCode >= 400 {
		return nil, fmt.Errorf("%s said %s: %s", url, res.Status, truncate(string(raw), 200))
	}
	if len(parsed.Choices) == 0 {
		return nil, fmt.Errorf("the model returned no choices")
	}

	return fromMessage(parsed.Choices[0].Message), nil
}

// toMessages converts the conversation into OpenAI's shape.
//
// Tool calls are matched to their results by position: the loop always answers
// the calls it was given, in order, so the ids assigned here line up with the
// responses in the message that follows.
func toMessages(contents []*genai.Content) []oaMessage {
	var out []oaMessage

	for _, content := range contents {
		if content == nil {
			continue
		}

		var text strings.Builder
		var calls []oaToolCall
		var responses []*genai.FunctionResponse

		for _, part := range content.Parts {
			switch {
			case part == nil:
			case part.FunctionCall != nil:
				args, _ := json.Marshal(part.FunctionCall.Args)
				calls = append(calls, oaToolCall{
					ID:       callID(part.FunctionCall, len(calls)),
					Type:     "function",
					Function: oaCallBody{Name: part.FunctionCall.Name, Arguments: string(args)},
				})
			case part.FunctionResponse != nil:
				responses = append(responses, part.FunctionResponse)
			case part.Text != "":
				text.WriteString(part.Text)
			}
		}

		role := "user"
		if content.Role == "model" || content.Role == "assistant" {
			role = "assistant"
		}

		if text.Len() > 0 || len(calls) > 0 {
			out = append(out, oaMessage{Role: role, Content: text.String(), ToolCalls: calls})
		}

		for i, response := range responses {
			payload, _ := json.Marshal(response.Response)
			out = append(out, oaMessage{
				Role:       "tool",
				Name:       response.Name,
				ToolCallID: responseID(response, i),
				Content:    string(payload),
			})
		}
	}

	return out
}

func callID(call *genai.FunctionCall, index int) string {
	if call.ID != "" {
		return call.ID
	}
	return fmt.Sprintf("call_%d_%s", index, call.Name)
}

func responseID(response *genai.FunctionResponse, index int) string {
	if response.ID != "" {
		return response.ID
	}
	return fmt.Sprintf("call_%d_%s", index, response.Name)
}

func toTools(decls []*genai.FunctionDeclaration) []oaTool {
	tools := make([]oaTool, 0, len(decls))
	for _, decl := range decls {
		tools = append(tools, oaTool{
			Type: "function",
			Function: oaFunction{
				Name:        decl.Name,
				Description: decl.Description,
				Parameters:  schemaToJSON(decl.Parameters),
			},
		})
	}
	return tools
}

// schemaToJSON turns a genai schema into plain JSON Schema. genai's type names
// are upper-case ("STRING"); OpenAI expects lower-case.
func schemaToJSON(schema *genai.Schema) map[string]any {
	if schema == nil {
		return map[string]any{"type": "object", "properties": map[string]any{}}
	}

	out := map[string]any{}
	if schema.Type != "" {
		out["type"] = strings.ToLower(string(schema.Type))
	}
	if schema.Description != "" {
		out["description"] = schema.Description
	}
	if len(schema.Enum) > 0 {
		out["enum"] = schema.Enum
	}
	if schema.Items != nil {
		out["items"] = schemaToJSON(schema.Items)
	}
	if len(schema.Properties) > 0 {
		properties := map[string]any{}
		for name, property := range schema.Properties {
			properties[name] = schemaToJSON(property)
		}
		out["properties"] = properties
	}
	if len(schema.Required) > 0 {
		out["required"] = schema.Required
	}
	return out
}

// fromMessage converts the model's reply back into the genai content the agent
// loop understands.
func fromMessage(message oaMessage) *genai.Content {
	content := &genai.Content{Role: "model"}

	if message.Content != "" {
		content.Parts = append(content.Parts, &genai.Part{Text: message.Content})
	}

	for i, call := range message.ToolCalls {
		args := map[string]any{}
		if call.Function.Arguments != "" {
			// A model that returns malformed arguments should reach the tool as
			// empty arguments and fail there with a useful message, rather than
			// killing the whole turn here.
			_ = json.Unmarshal([]byte(call.Function.Arguments), &args)
		}
		id := call.ID
		if id == "" {
			id = fmt.Sprintf("call_%d_%s", i, call.Function.Name)
		}
		content.Parts = append(content.Parts, &genai.Part{
			FunctionCall: &genai.FunctionCall{ID: id, Name: call.Function.Name, Args: args},
		})
	}

	return content
}
