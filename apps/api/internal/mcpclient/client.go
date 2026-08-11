// Package mcpclient lets k8n's assistant use tools from other MCP servers.
//
// k8n already *is* an MCP server, so other clients can drive it. This is the
// other direction: point k8n at the servers you already run — a docs server, a
// monitoring server, your own — and their tools become available to the
// assistant alongside k8n's own.
//
// Configuration uses the same shape as every other MCP client, so a config you
// already have works here:
//
//	{
//	  "mcpServers": {
//	    "docs":    { "command": "npx", "args": ["-y", "@acme/docs-mcp"] },
//	    "grafana": { "url": "http://localhost:9000/mcp" }
//	  }
//	}
//
// Read it from K8N_MCP_SERVERS (a path or the JSON itself). Nothing is
// configured by default; without it this package does nothing at all.
package mcpclient

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"sort"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// ServerConfig is one entry under "mcpServers".
type ServerConfig struct {
	// Command and Args spawn a stdio server.
	Command string            `json:"command,omitempty"`
	Args    []string          `json:"args,omitempty"`
	Env     map[string]string `json:"env,omitempty"`
	// URL connects to a server already running over streamable HTTP.
	URL string `json:"url,omitempty"`
	// Disabled keeps an entry in the file without connecting to it.
	Disabled bool `json:"disabled,omitempty"`
}

type config struct {
	Servers map[string]ServerConfig `json:"mcpServers"`
}

// RemoteTool is one tool offered by one connected server.
type RemoteTool struct {
	// Server is the name from the config, used to keep tool names unambiguous.
	Server      string
	Name        string
	Description string
	// InputSchema is the server's own JSON Schema for the arguments.
	InputSchema map[string]any
}

// QualifiedName is how the assistant refers to the tool: two servers may both
// offer a "search".
func (t RemoteTool) QualifiedName() string { return t.Server + "__" + t.Name }

// Session is a live connection to one configured server.
type Session struct {
	Name    string
	session *mcp.ClientSession
	tools   []RemoteTool
}

// Pool holds every connected server.
type Pool struct {
	sessions []*Session
}

// LoadConfig reads K8N_MCP_SERVERS, which is either a path to a JSON file or
// the JSON itself. An empty value means "no external servers", not an error.
func LoadConfig() (map[string]ServerConfig, error) {
	raw := strings.TrimSpace(os.Getenv("K8N_MCP_SERVERS"))
	if raw == "" {
		return nil, nil
	}

	if !strings.HasPrefix(raw, "{") {
		data, err := os.ReadFile(raw)
		if err != nil {
			return nil, fmt.Errorf("could not read %s: %w", raw, err)
		}
		raw = string(data)
	}

	var cfg config
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
		return nil, fmt.Errorf("K8N_MCP_SERVERS is not valid JSON: %w", err)
	}
	return cfg.Servers, nil
}

// Connect dials every configured server and lists its tools.
//
// A server that fails to start is reported and skipped: one broken entry must
// not take the assistant down with it.
func Connect(ctx context.Context, servers map[string]ServerConfig) (*Pool, []error) {
	pool := &Pool{}
	var problems []error

	names := make([]string, 0, len(servers))
	for name := range servers {
		names = append(names, name)
	}
	sort.Strings(names)

	for _, name := range names {
		cfg := servers[name]
		if cfg.Disabled {
			continue
		}
		session, err := dial(ctx, name, cfg)
		if err != nil {
			problems = append(problems, fmt.Errorf("mcp server %q: %w", name, err))
			continue
		}
		pool.sessions = append(pool.sessions, session)
	}
	return pool, problems
}

func dial(ctx context.Context, name string, cfg ServerConfig) (*Session, error) {
	var transport mcp.Transport
	switch {
	case cfg.URL != "":
		transport = &mcp.StreamableClientTransport{Endpoint: cfg.URL}
	case cfg.Command != "":
		cmd := exec.Command(cfg.Command, cfg.Args...)
		cmd.Env = os.Environ()
		for k, v := range cfg.Env {
			cmd.Env = append(cmd.Env, k+"="+v)
		}
		transport = &mcp.CommandTransport{Command: cmd}
	default:
		return nil, fmt.Errorf("needs either a command or a url")
	}

	dialCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	client := mcp.NewClient(&mcp.Implementation{Name: "k8n", Version: "1.0.0"}, nil)
	session, err := client.Connect(dialCtx, transport, nil)
	if err != nil {
		return nil, err
	}

	listed, err := session.ListTools(dialCtx, nil)
	if err != nil {
		session.Close()
		return nil, fmt.Errorf("connected but could not list tools: %w", err)
	}

	s := &Session{Name: name, session: session}
	for _, t := range listed.Tools {
		schema, _ := t.InputSchema.(map[string]any)
		s.tools = append(s.tools, RemoteTool{
			Server:      name,
			Name:        t.Name,
			Description: t.Description,
			InputSchema: schema,
		})
	}
	return s, nil
}

// Tools returns every tool across every connected server.
func (p *Pool) Tools() []RemoteTool {
	if p == nil {
		return nil
	}
	var all []RemoteTool
	for _, s := range p.sessions {
		all = append(all, s.tools...)
	}
	return all
}

// ServerInfo is what a connected server contributes.
type ServerInfo struct {
	Name  string `json:"name"`
	Tools int    `json:"tools"`
}

// Servers describes the connected servers. A server with zero tools connected
// but has nothing to offer, which is worth seeing rather than guessing at.
func (p *Pool) Servers() []ServerInfo {
	if p == nil {
		return nil
	}
	out := make([]ServerInfo, 0, len(p.sessions))
	for _, s := range p.sessions {
		out = append(out, ServerInfo{Name: s.Name, Tools: len(s.tools)})
	}
	return out
}

// Call invokes a tool by its qualified name and returns its text content.
func (p *Pool) Call(ctx context.Context, qualified string, args map[string]any) (string, error) {
	server, tool, ok := strings.Cut(qualified, "__")
	if !ok {
		return "", fmt.Errorf("%q is not a qualified tool name", qualified)
	}

	for _, s := range p.sessions {
		if s.Name != server {
			continue
		}
		result, err := s.session.CallTool(ctx, &mcp.CallToolParams{Name: tool, Arguments: args})
		if err != nil {
			return "", err
		}

		var out strings.Builder
		for _, content := range result.Content {
			if text, ok := content.(*mcp.TextContent); ok {
				out.WriteString(text.Text)
				out.WriteString("\n")
			}
		}
		if result.IsError {
			return "", fmt.Errorf("%s reported an error: %s", qualified, strings.TrimSpace(out.String()))
		}
		return strings.TrimSpace(out.String()), nil
	}
	return "", fmt.Errorf("no connected MCP server named %q", server)
}

// Close shuts every session down.
func (p *Pool) Close() {
	if p == nil {
		return
	}
	for _, s := range p.sessions {
		s.session.Close()
	}
	p.sessions = nil
}
