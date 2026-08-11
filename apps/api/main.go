package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/user/k8s-graph-controller/backend/internal/handlers"
	"github.com/user/k8s-graph-controller/backend/internal/k8s"
	"github.com/user/k8s-graph-controller/backend/internal/mcpserver"
)

var (
	k8sClient   *k8s.Client
	k8sClientMu sync.RWMutex
)

func getK8sClient() *k8s.Client {
	k8sClientMu.RLock()
	defer k8sClientMu.RUnlock()
	return k8sClient
}

func setK8sClient(c *k8s.Client) {
	k8sClientMu.Lock()
	defer k8sClientMu.Unlock()
	k8sClient = c
}

// corsConfig allows the browser to call this API cross-origin.
//
// In the normal setup Next.js proxies /api/* to us, so requests are same-origin
// and none of this applies. Localhost is allowed for split dev servers;
// anything else must be listed in ALLOWED_ORIGINS. The previous version allowed
// any origin whose name merely contained "ngrok", which any host can claim.
func corsConfig() cors.Config {
	allowed := strings.Split(os.Getenv("ALLOWED_ORIGINS"), ",")

	isLocalhost := func(origin string) bool {
		for _, host := range []string{"localhost", "127.0.0.1", "[::1]"} {
			if strings.HasPrefix(origin, "http://"+host) || strings.HasPrefix(origin, "https://"+host) {
				return true
			}
		}
		return false
	}

	return cors.Config{
		AllowOriginFunc: func(origin string) bool {
			if isLocalhost(origin) {
				return true
			}
			for _, a := range allowed {
				if a != "" && strings.TrimSpace(a) == origin {
					return true
				}
			}
			return false
		},
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Accept", "Authorization"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	}
}

func main() {
	var err error
	if k8sClient, err = k8s.NewClient(""); err != nil {
		fmt.Printf("No cluster connection yet: %v\n", err)
	}

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://k8n:k8npassword@localhost:5432/k8n_db?sslmode=disable"
	}
	if err := handlers.InitDB(dbURL); err != nil {
		fmt.Printf("No database; saved workflows are disabled: %v\n", err)
	}

	// External MCP servers, if any are configured. Their tools become available
	// to the assistant alongside k8n's own.
	for _, problem := range handlers.InitMCPClients(context.Background()) {
		fmt.Printf("MCP: %v\n", problem)
	}
	for _, server := range handlers.ConnectedMCPServers() {
		fmt.Printf("MCP server %q connected with %d tools\n", server.Name, server.Tools)
	}

	r := gin.Default()
	r.Use(cors.New(corsConfig()))

	r.GET("/health", handlers.Health(getK8sClient))

	// Cluster
	r.GET("/api/cluster/contexts", handlers.ListContexts())
	r.POST("/api/cluster/connect", handlers.Connect(setK8sClient))
	r.GET("/api/cluster/resources", handlers.GetClusterResources(getK8sClient))
	r.GET("/api/cluster/watch", handlers.WatchResources(getK8sClient))
	r.GET("/api/cluster/namespaces", handlers.GetNamespaces(getK8sClient))
	r.GET("/api/cluster/crds", handlers.GetCRDs(getK8sClient))
	r.GET("/api/schema/:kind", handlers.GetSchema(getK8sClient))
	r.DELETE("/api/resource/delete", handlers.DeleteResourceHandler(getK8sClient))

	// Metrics
	r.GET("/api/metrics/check", handlers.CheckMetricsServer(getK8sClient))
	r.GET("/api/metrics/namespace", handlers.GetNamespaceMetrics(getK8sClient))
	r.GET("/api/metrics/pod/:name", handlers.GetPodMetrics(getK8sClient))
	r.GET("/api/metrics/:namespace/:kind/:name", handlers.GetResourceMetrics(getK8sClient))

	// Logs, events and diagnosis — the signals needed to answer "why is this
	// broken", for the UI and the AI layer alike.
	r.GET("/api/logs/:namespace/:pod", handlers.GetPodLogs(getK8sClient))
	r.GET("/api/events/:namespace", handlers.GetEvents(getK8sClient))
	r.GET("/api/diagnose/:namespace", handlers.GetDiagnosis(getK8sClient))

	// AI assistant. Every route degrades to 503 with a hint when GEMINI_API_KEY
	// is unset, and the frontend hides the panel based on /api/ai/status.
	r.GET("/api/ai/status", handlers.GetAIStatus())
	r.POST("/api/ai/chat", handlers.AIChat(getK8sClient))
	r.POST("/api/ai/explain", handlers.AIExplain(getK8sClient))

	// Helm. Every one of these runs against the cluster k8n is connected to,
	// not against whatever the ambient kubeconfig points at.
	r.GET("/api/helm/search", handlers.SearchHelmCharts())
	r.POST("/api/helm/template", handlers.TemplateHelmChart(getK8sClient))
	r.POST("/api/helm/install", handlers.InstallHelmChart(getK8sClient))
	r.GET("/api/helm/releases", handlers.ListHelmReleases(getK8sClient))
	r.GET("/api/helm/releases/:name", handlers.GetHelmRelease(getK8sClient))
	r.GET("/api/helm/releases/:name/history", handlers.GetHelmReleaseHistory(getK8sClient))
	r.POST("/api/helm/releases/:name/upgrade", handlers.UpgradeHelmRelease(getK8sClient))
	r.POST("/api/helm/releases/:name/rollback", handlers.RollbackHelmRelease(getK8sClient))
	r.DELETE("/api/helm/releases/:name", handlers.UninstallHelmRelease(getK8sClient))

	// The whole graph is compiled at once so edges can resolve into selectors,
	// backends, scale targets, config mounts and volumes.
	r.POST("/api/graph/compile", handlers.CompileGraph(getK8sClient))
	r.POST("/api/graph/import", handlers.ImportManifest())
	r.POST("/api/graph/apply", handlers.ApplyResources(getK8sClient)) // ?dryRun=true

	// Saved workflows
	r.POST("/api/graph/save", handlers.SaveGraph())
	r.GET("/api/graph/list", handlers.ListGraphs())
	r.GET("/api/graph/:id", handlers.LoadGraph())
	r.DELETE("/api/graph/:id", handlers.DeleteGraph())

	// MCP over streamable HTTP, for clients that connect to a running k8n rather
	// than spawning the stdio binary. Same tools, same implementations.
	mcpOpts := mcpserver.OptionsFromEnv()
	mcpHandler := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server {
		return mcpserver.New(getK8sClient, setK8sClient, mcpOpts)
	}, nil)
	r.Any("/mcp", gin.WrapH(mcpHandler))
	r.Any("/mcp/*path", gin.WrapH(mcpHandler))

	port := os.Getenv("API_PORT")
	if port == "" {
		port = "8080"
	}
	if err := r.Run(":" + port); err != nil {
		fmt.Printf("Server stopped: %v\n", err)
		os.Exit(1)
	}
}
