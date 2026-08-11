package ai

import (
	"context"
	"fmt"
	"strings"

	"google.golang.org/genai"
)

// An Agent is a system prompt plus the tools it is allowed to use.
//
// Splitting the assistant into specialists is not decoration: each one gets a
// narrow brief and a narrow toolset, which is what stops the model from, say,
// proposing a graph change when it was asked why a pod is crash-looping. The
// supervisor sees them as tools and decides which to consult.
type Agent struct {
	Name string
	// Purpose is what the supervisor reads when choosing whom to ask.
	Purpose string
	System  string
	Tools   []Tool
}

// Delegate exposes an agent to the supervisor as a callable tool.
//
// Nested tool calls are forwarded to the same event stream, prefixed with the
// agent's name, so the UI shows who did what rather than a black box.
func (c *Client) Delegate(a Agent, emit func(Event)) Tool {
	return Tool{
		Name:        "ask_" + a.Name,
		Description: a.Purpose,
		Parameters: &genai.Schema{
			Type: genai.TypeObject,
			Properties: map[string]*genai.Schema{
				"task": strSchema("What you want this specialist to do, in a sentence or two. Include any specifics you already know, such as a namespace or resource name."),
			},
			Required: []string{"task"},
		},
		Execute: func(ctx context.Context, args map[string]any) (string, error) {
			task, _ := args["task"].(string)
			if strings.TrimSpace(task) == "" {
				return "", fmt.Errorf("no task given")
			}

			var answer strings.Builder
			err := c.Run(ctx, a.System, []*genai.Content{UserContent(task)}, a.Tools, func(e Event) {
				switch e.Type {
				case "text":
					answer.WriteString(e.Text)
				case "tool", "patch":
					// Keep the trace visible, attributed to the specialist.
					e.Tool = a.Name + "." + e.Tool
					emit(e)
				}
			})
			if err != nil {
				return "", err
			}
			if answer.Len() == 0 {
				return "(the specialist returned nothing)", nil
			}
			return answer.String(), nil
		},
	}
}

// DelegateAll turns a set of agents into supervisor tools.
func (c *Client) DelegateAll(agents []Agent, emit func(Event)) []Tool {
	tools := make([]Tool, 0, len(agents))
	for _, a := range agents {
		tools = append(tools, c.Delegate(a, emit))
	}
	return tools
}

func strSchema(desc string) *genai.Schema {
	return &genai.Schema{Type: genai.TypeString, Description: desc}
}
