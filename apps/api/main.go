package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/user/k8s-graph-controller/backend/internal/ai"
	"github.com/user/k8s-graph-controller/backend/internal/auth"
	"github.com/user/k8s-graph-controller/backend/internal/handlers"
	"github.com/user/k8s-graph-controller/backend/internal/k8s"
	"github.com/user/k8s-graph-controller/backend/internal/mcpserver"
)

var (
	k8sClient   *k8s.Client
	k8sClientMu sync.RWMutex
)

// mountUI serves the embedded frontend; set only in builds tagged embedui (ui.go).
var mountUI func(*gin.Engine)

// version is set by the release build: -ldflags "-X main.version=v0.2.0".
var version = "dev"

// requireToken rejects anything that reaches the API or the MCP endpoint
// without the pairing token.
//
// The UI itself is served unguarded: it is not secret, and it is what shows the
// "paste your token" prompt when a browser has not paired yet. /health is open
// for the container healthcheck, which knows no token; it reports only whether
// a cluster is reachable.
func requireToken(token string) gin.HandlerFunc {
	return func(c *gin.Context) {
		path := c.Request.URL.Path
		guarded := strings.HasPrefix(path, "/api/") || strings.HasPrefix(path, "/mcp")
		// A CORS preflight carries no custom headers by definition; rejecting it
		// would fail the real request before it was ever made.
		if !guarded || c.Request.Method == http.MethodOptions {
			c.Next()
			return
		}

		// The token in the address is for EventSource, which can only GET and
		// cannot set a header. Anything that changes something has to send the
		// header: a page elsewhere can fire a no-CORS POST at localhost with a
		// token it got hold of, but it cannot add a custom header without CORS
		// letting it.
		query := func(string) string { return "" }
		if c.Request.Method == http.MethodGet {
			query = c.Query
		}
		presented := auth.Presented(c.GetHeader, query)
		if !auth.Matches(token, presented) {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "Not paired with this k8n",
				"hint":  "Open the link k8n printed when it started, or paste its token when asked.",
			})
			return
		}
		c.Next()
	}
}

// requestLogger is gin's own logger with the token taken out of the query
// string. The default one prints the raw path, which would put the secret in
// the terminal, in scrollback, and in anything collecting container logs.
func requestLogger() gin.HandlerFunc {
	return gin.LoggerWithFormatter(func(p gin.LogFormatterParams) string {
		return fmt.Sprintf("[GIN] %3d | %13v | %15s | %-7s %q\n",
			p.StatusCode, p.Latency, p.ClientIP, p.Method, auth.Redact(p.Path))
	})
}

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

// hostedSite is the public copy of the UI, which talks to the engine on the
// visitor's own machine. It has to be named exactly: CORS is all that stands
// between a web page and the cluster behind this port. K8N_SITE overrides it
// for a fork hosted somewhere else.
func hostedSite() string {
	if site := strings.TrimRight(strings.TrimSpace(os.Getenv("K8N_SITE")), "/"); site != "" {
		return site
	}
	return "https://k8n.pages.dev"
}

// originAllowed decides which pages may call this engine: this machine, the
// hosted site, and anything listed in ALLOWED_ORIGINS. It compares the host
// exactly — the previous prefix check let http://localhost.attacker.com in.
func originAllowed(origin string) bool {
	u, err := url.Parse(origin)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return false
	}
	switch u.Hostname() {
	case "localhost", "127.0.0.1", "::1":
		return true
	}
	if origin == hostedSite() {
		return true
	}
	for _, a := range strings.Split(os.Getenv("ALLOWED_ORIGINS"), ",") {
		if a = strings.TrimSpace(a); a != "" && a == origin {
			return true
		}
	}
	return false
}

func corsConfig() cors.Config {
	return cors.Config{
		AllowOriginFunc:  originAllowed,
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Accept", "Authorization", auth.Header},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	}
}

// allowPrivateNetwork answers Chrome's question before a public page may reach
// a service on this machine: a preflight with
// Access-Control-Request-Private-Network, which fails unless the reply says
// yes. Only for origins CORS would let through anyway.
func allowPrivateNetwork(c *gin.Context) {
	if c.Request.Method == http.MethodOptions &&
		c.GetHeader("Access-Control-Request-Private-Network") == "true" &&
		originAllowed(c.GetHeader("Origin")) {
		c.Header("Access-Control-Allow-Private-Network", "true")
	}
	c.Next()
}

var (
	openFlag = flag.Bool("open", false, "open the paired link in your browser once k8n is listening")
	portFlag = flag.String("port", "", "port to listen on (overrides API_PORT)")
)

// openWhenReady waits for the server to actually accept a connection, then
// hands the browser the pairing link. Opening it immediately would race the
// listener and land on a refused connection.
func openWhenReady(port, token string) {
	address := net.JoinHostPort("127.0.0.1", port)
	for i := 0; i < 100; i++ {
		conn, err := net.DialTimeout("tcp", address, 250*time.Millisecond)
		if err == nil {
			conn.Close()
			url := "http://" + address + "/"
			if token != "" {
				url += "?" + auth.QueryParam + "=" + token
			}
			if err := openInBrowser(url); err != nil {
				fmt.Printf("Could not open a browser: %v\n", err)
			}
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	fmt.Println("k8n did not start in time to open a browser.")
}

func openInBrowser(url string) error {
	switch runtime.GOOS {
	case "windows":
		return exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	case "darwin":
		return exec.Command("open", url).Start()
	default:
		return exec.Command("xdg-open", url).Start()
	}
}

func main() {
	flag.Parse()
	handlers.Version = version

	var err error
	if k8sClient, err = k8s.NewClient(""); err != nil {
		fmt.Printf("No cluster connection yet: %v\n", err)
	}

	// Postgres only when asked for. Without it workflows are files in
	// ~/.k8n/workflows; trying a default address on every start was a network
	// probe that told everyone their workflows were "disabled" when they were not.
	if dbURL := os.Getenv("DATABASE_URL"); dbURL != "" {
		if err := handlers.InitDB(dbURL); err != nil {
			fmt.Printf("DATABASE_URL is set but the database is unreachable (%v); workflows are saved as files instead.\n", err)
		}
	}

	// The assistant's provider and key: the saved file first, the environment
	// otherwise. Nothing here is required — without it the AI panel explains
	// how to turn itself on and the rest of k8n is unaffected.
	ai.Init()

	// External MCP servers, if any are configured. Their tools become available
	// to the assistant alongside k8n's own.
	for _, problem := range handlers.InitMCPClients(context.Background()) {
		fmt.Printf("MCP: %v\n", problem)
	}
	for _, server := range handlers.ConnectedMCPServers() {
		fmt.Printf("MCP server %q connected with %d tools\n", server.Name, server.Tools)
	}

	r := gin.New()
	r.Use(gin.Recovery(), requestLogger())
	r.Use(allowPrivateNetwork, cors.New(corsConfig()))

	// Anything that is not a GET may have changed the cluster — an apply, a
	// scale, a Helm upgrade. The open watch streams read often again straight
	// away instead of waiting out the slow tick they settle into when nothing
	// is happening.
	r.Use(func(c *gin.Context) {
		c.Next()
		if c.Request.Method != http.MethodGet && c.Writer.Status() < 400 {
			handlers.TouchCluster()
		}
	})

	// Pairing. Every /api and /mcp route needs the token; the UI and /health do
	// not, because the page has to load in order to ask for the token, and the
	// container healthcheck has no way to know it.
	token := ""
	if !auth.Disabled() {
		var err error
		if token, err = auth.Load(); err != nil {
			fmt.Printf("Could not set up the pairing token: %v\n", err)
			os.Exit(1)
		}
		r.Use(requireToken(token))
	}

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
	r.POST("/api/resource/finalize", handlers.FinishDeletionHandler(getK8sClient))
	r.POST("/api/cluster/namespaces", handlers.CreateNamespaceHandler(getK8sClient))
	r.DELETE("/api/cluster/namespaces/:name", handlers.DeleteNamespaceHandler(getK8sClient))
	r.GET("/api/cluster/ingressclasses", handlers.IngressClassesHandler(getK8sClient))
	r.GET("/api/secret/:namespace/:name", handlers.RevealSecretHandler(getK8sClient))
	r.POST("/api/workload/:action", handlers.WorkloadActionHandler(getK8sClient))
	r.POST("/api/exec", handlers.ExecHandler(getK8sClient))
	r.GET("/api/rbac/serviceaccount/:namespace/:name", handlers.ServiceAccountPermissionsHandler(getK8sClient))
	r.GET("/api/portforward", handlers.ListForwardsHandler())
	r.POST("/api/portforward", handlers.StartForwardHandler(getK8sClient))
	r.DELETE("/api/portforward/:id", handlers.StopForwardHandler())

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
	// Choosing a provider while k8n runs, rather than restarting with a
	// different environment variable. The key never comes back out.
	r.POST("/api/ai/config", handlers.SetAIConfig())
	r.POST("/api/ai/config/test", handlers.TestAIConfig())
	r.DELETE("/api/ai/config", handlers.ForgetAIConfig())
	r.POST("/api/ai/chat", handlers.AIChat(getK8sClient))
	r.POST("/api/ai/explain", handlers.AIExplain(getK8sClient))

	// Helm. Every one of these runs against the cluster k8n is connected to,
	// not against whatever the ambient kubeconfig points at.
	r.GET("/api/helm/search", handlers.SearchHelmCharts())
	r.POST("/api/helm/template", handlers.TemplateHelmChart(getK8sClient))
	r.POST("/api/helm/values", handlers.ChartValuesHandler())
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
	r.POST("/api/graph/diff", handlers.DiffHandler(getK8sClient))
	r.GET("/api/history", handlers.HistoryHandler())

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

	if mountUI != nil {
		mountUI(r)
	}

	port := *portFlag
	if port == "" {
		port = os.Getenv("API_PORT")
	}
	chosen := port != ""
	if !chosen {
		port = "8080"
	}
	// Loopback by default. There is no authentication on any of these routes,
	// and CORS is a browser policy — it stops a web page calling us, not curl.
	// Binding every interface meant anyone on the same network could apply and
	// delete cluster resources. Set API_HOST=0.0.0.0 to expose it deliberately,
	// and put something that authenticates in front when you do.
	host := os.Getenv("API_HOST")
	if host == "" {
		host = "127.0.0.1"
	}
	// Double-clicked: there is no terminal to copy a link from, and the window
	// closes the moment k8n exits.
	alone := launchedOnItsOwn()

	// Listen first, and only then print the links: they used to be printed
	// before the port was known to be free, so a clash produced links to
	// whatever else was listening there.
	listener, at, err := listen(host, port, chosen)
	if errors.Is(err, errAlreadyRunning) {
		port = strconv.Itoa(at)
		fmt.Printf("\n  k8n is already running on this machine.\n")
		printStartupBanner(host, port, token)
		if alone {
			openInBrowser("http://127.0.0.1:" + port + "/?" + auth.QueryParam + "=" + token)
			pause()
		}
		return
	}
	if err != nil {
		fmt.Printf("\n  k8n could not start: %v\n", err)
		if alone {
			pause()
		}
		os.Exit(1)
	}
	port = strconv.Itoa(at)
	printStartupBanner(host, port, token)

	// --open is for a desktop shortcut, and a double-click is the same thing:
	// start k8n and land in the app, paired, with nothing to copy.
	if *openFlag || alone {
		go openWhenReady(port, token)
	}
	if alone {
		fmt.Printf("  Keep this window open while you use k8n; closing it stops it.\n\n")
	}

	if err := r.RunListener(listener); err != nil {
		fmt.Printf("Server stopped: %v\n", err)
		if alone {
			pause()
		}
		os.Exit(1)
	}
}

var errAlreadyRunning = errors.New("k8n is already running there")

// listen takes the port asked for. When nobody asked — the default — and it is
// taken, it moves up to the next free one rather than giving up: someone who
// double-clicked k8n has no way to pass --port. If what holds the port is
// another k8n, it says so instead of starting a second.
func listen(host, port string, chosen bool) (net.Listener, int, error) {
	first, err := strconv.Atoi(port)
	if err != nil {
		return nil, 0, fmt.Errorf("%q is not a port number", port)
	}
	for p := first; p < first+20; p++ {
		l, err := net.Listen("tcp", net.JoinHostPort(host, strconv.Itoa(p)))
		if err == nil {
			if p != first {
				fmt.Printf("\n  Port %d is in use by another program, so k8n is on %d.\n", first, p)
			}
			return l, p, nil
		}
		// An earlier k8n may itself have moved up from a busy default.
		if isK8n(p) {
			return nil, p, errAlreadyRunning
		}
		if chosen {
			return nil, 0, fmt.Errorf("port %d is in use (%v); pick another with --port", p, err)
		}
	}
	return nil, 0, fmt.Errorf("ports %d to %d are all in use; pick one with --port", first, first+19)
}

// isK8n asks whatever holds the port whether it is k8n.
func isK8n(port int) bool {
	client := http.Client{Timeout: time.Second}
	resp, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/health", port))
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	var health struct {
		Status  string `json:"status"`
		Version string `json:"version"`
	}
	return json.NewDecoder(resp.Body).Decode(&health) == nil && health.Status == "ok" && health.Version != ""
}

// pause keeps a double-clicked window open long enough to read.
func pause() {
	fmt.Printf("  Press Enter to close this window.")
	_, _ = bufio.NewReader(os.Stdin).ReadString('\n')
}

// printStartupBanner gives the user the one thing they need: a link that pairs
// their browser. The token is in the link so that opening it is the whole
// setup; the UI stores it and takes it out of the address bar.
func printStartupBanner(host, port, token string) {
	shown := host
	if shown == "0.0.0.0" || shown == "::" {
		shown = "127.0.0.1"
	}

	fmt.Printf("\n  k8n is running on http://%s:%s\n", shown, port)
	if token == "" {
		fmt.Printf("\n  ⚠ Pairing is OFF (K8N_NO_AUTH=true). Anything that can reach this port\n" +
			"    can read and change your cluster.\n\n")
		return
	}
	fmt.Printf("\n  Open this link to pair your browser:\n\n    http://%s:%s/?%s=%s\n\n", shown, port, auth.QueryParam, token)
	// The same pairing through the hosted page, which then keeps this engine's
	// address and talks to it. Not in Safari, which will not let a public page
	// reach this machine; the link above always works.
	hosted := url.Values{"engine": {"http://127.0.0.1:" + port}, auth.QueryParam: {token}}
	fmt.Printf("  Or use it from the web:\n\n    %s/?%s\n\n", hostedSite(), hosted.Encode())
	fmt.Printf("  Treat both like a password: they let the holder change your cluster.\n\n")
}
