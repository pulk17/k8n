// Command k8n-mcp runs k8n's MCP server over stdio.
//
// Register it with an MCP client, e.g. in Claude Code:
//
//	claude mcp add k8n -- /path/to/k8n-mcp
//
// It talks to whatever cluster your kubeconfig points at. Set
// K8N_MCP_READONLY=true to expose only the read tools.
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"sync"
	"syscall"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/user/k8s-graph-controller/backend/internal/k8s"
	"github.com/user/k8s-graph-controller/backend/internal/mcpserver"
)

var (
	mu     sync.RWMutex
	client *k8s.Client
)

func getClient() *k8s.Client {
	mu.RLock()
	defer mu.RUnlock()
	return client
}

func setClient(c *k8s.Client) {
	mu.Lock()
	defer mu.Unlock()
	client = c
}

func main() {
	// stdout is the MCP transport, so diagnostics must go to stderr.
	initial, err := k8s.NewClient(os.Getenv("K8N_CONTEXT"))
	if err != nil {
		fmt.Fprintf(os.Stderr, "k8n-mcp: no cluster yet (%v). Use the use_context tool to connect.\n", err)
	} else {
		setClient(initial)
	}

	opts := mcpserver.OptionsFromEnv()
	if opts.ReadOnly {
		fmt.Fprintln(os.Stderr, "k8n-mcp: read-only mode — apply and delete tools are not registered.")
	}

	server := mcpserver.New(getClient, setClient, opts)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := server.Run(ctx, &mcp.StdioTransport{}); err != nil && ctx.Err() == nil {
		fmt.Fprintf(os.Stderr, "k8n-mcp: %v\n", err)
		os.Exit(1)
	}
}
