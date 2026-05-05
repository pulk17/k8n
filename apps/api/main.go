package main

import (
	"fmt"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/user/k8s-graph-controller/backend/internal/handlers"
	"github.com/user/k8s-graph-controller/backend/internal/k8s"
	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/cli"
)

// getAllowedOrigins returns the list of allowed CORS origins from env or defaults.
func getAllowedOrigins() []string {
	if env := os.Getenv("ALLOWED_ORIGINS"); env != "" {
		return strings.Split(env, ",")
	}
	return []string{
		"http://localhost:3000", "http://localhost:3001",
		"http://127.0.0.1:3000", "http://127.0.0.1:3001",
	}
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		for _, allowed := range getAllowedOrigins() {
			if strings.TrimSpace(allowed) == origin {
				return true
			}
		}
		return false
	},
}

var (
	k8sClient   *k8s.Client
	k8sClientMu sync.RWMutex
)

// getK8sClient safely reads the global k8sClient under RLock.
func getK8sClient() *k8s.Client {
	k8sClientMu.RLock()
	defer k8sClientMu.RUnlock()
	return k8sClient
}

// setK8sClient safely replaces the global k8sClient under Lock.
func setK8sClient(c *k8s.Client) {
	k8sClientMu.Lock()
	defer k8sClientMu.Unlock()
	k8sClient = c
}

func main() {
	r := gin.Default()

	// Configure CORS
	r.Use(cors.New(cors.Config{
		AllowOrigins:     getAllowedOrigins(),
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Accept", "Authorization"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	}))

	r.GET("/health", func(c *gin.Context) {
		health := gin.H{
			"status": "ok",
			"time":   time.Now().Unix(),
		}

		// Check database connection
		if db := handlers.GetDB(); db != nil {
			if err := db.Ping(); err == nil {
				health["database"] = "connected"
			} else {
				health["database"] = "disconnected"
			}
		} else {
			health["database"] = "disconnected"
		}

		// Check K8s connection
		if k8sClient != nil {
			if version, err := k8sClient.CheckConnection(); err == nil && version != "" {
				health["kubernetes"] = "connected"
				health["k8s_version"] = version
			} else {
				health["kubernetes"] = "disconnected"
			}
		} else {
			health["kubernetes"] = "disconnected"
		}

		c.JSON(http.StatusOK, health)
	})

	// Initialize K8s Client with default context
	var err error
	k8sClient, err = k8s.NewClient("")
	if err != nil {
		fmt.Printf("Warning: Failed to initialize K8s client: %v\n", err)
	}

	// Initialize Postgres DB
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://k8n:k8npassword@localhost:5432/k8n_db?sslmode=disable"
	}
	if err := handlers.InitDB(dbURL); err != nil {
		fmt.Printf("Warning: Database connection failed: %v\n", err)
	} else {
		fmt.Println("Successfully connected to Postgres Database")
	}

	// Cluster Endpoints
	r.GET("/api/cluster/contexts", func(c *gin.Context) {
		contexts, err := k8s.GetContexts()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list contexts", "details": err.Error()})
			return
		}
		c.JSON(http.StatusOK, contexts)
	})

	r.POST("/api/cluster/connect", func(c *gin.Context) {
		var req struct {
			Context string `json:"context" binding:"required"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		newClient, err := k8s.NewClient(req.Context)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to connect to context", "details": err.Error()})
			return
		}

		// Store globally (thread-safe)
		setK8sClient(newClient)
		version, _ := newClient.CheckConnection()
		
		c.JSON(http.StatusOK, gin.H{"status": "connected", "context": req.Context, "version": version})
	})

	r.GET("/api/cluster/resources", handlers.GetClusterResources(func() *k8s.Client {
		return getK8sClient()
	}))

	r.GET("/api/cluster/crds", handlers.GetCRDs(func() *k8s.Client {
		return getK8sClient()
	}))

	r.GET("/api/schema/:kind", handlers.GetSchema(func() *k8s.Client {
		return getK8sClient()
	}))

	// Metrics endpoints
	r.GET("/api/metrics/pod/:name", handlers.GetPodMetrics(func() *k8s.Client {
		return getK8sClient()
	}))
	r.GET("/api/metrics/namespace", handlers.GetNamespaceMetrics(func() *k8s.Client {
		return getK8sClient()
	}))
	r.GET("/api/metrics/:namespace/:kind/:name", handlers.GetResourceMetrics(func() *k8s.Client {
		return getK8sClient()
	}))
	r.GET("/api/metrics/check", handlers.CheckMetricsServer(func() *k8s.Client {
		return getK8sClient()
	}))

	r.GET("/api/helm/search", handlers.SearchHelmCharts())
	r.POST("/api/helm/install", handlers.InstallHelmChart())
	
	// Helm Release Management
	r.GET("/api/helm/releases", handlers.ListHelmReleases())
	r.GET("/api/helm/releases/:name", handlers.GetHelmRelease())
	r.GET("/api/helm/releases/:name/values", handlers.GetHelmReleaseValues())
	r.GET("/api/helm/releases/:name/status", handlers.GetHelmReleaseStatus())
	r.GET("/api/helm/releases/:name/history", handlers.GetHelmReleaseHistory())
	r.POST("/api/helm/releases/:name/upgrade", handlers.UpgradeHelmRelease())
	r.POST("/api/helm/releases/:name/rollback", handlers.RollbackHelmRelease())
	r.DELETE("/api/helm/releases/:name", handlers.UninstallHelmRelease())

	r.POST("/api/mapper/:kind", handlers.MapToYAML())

	applyHandler := handlers.ApplyResources(func() *k8s.Client {
		return getK8sClient()
	})
	r.POST("/api/graph/dry-run", applyHandler) // Use ?dryRun=true 
	r.POST("/api/graph/apply", applyHandler)

	// Graph Persistence
	r.POST("/api/graph/save", handlers.SaveGraph())
	r.GET("/api/graph/:id", handlers.LoadGraph())
	r.GET("/api/graph/list", handlers.ListGraphs())
	r.DELETE("/api/graph/:id", handlers.DeleteGraph())

	// Basic K8s connection check
	r.GET("/k8s/check", func(c *gin.Context) {
		client := getK8sClient()
		if client == nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "K8s client not initialized"})
			return
		}

		version, err := client.CheckConnection()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to connect to K8s", "details": err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{"k8s_version": version, "context": client.Context})
	})

	// Basic Helm check
	r.GET("/helm/check", func(c *gin.Context) {
		settings := cli.New()
		actionConfig := new(action.Configuration)
		if err := actionConfig.Init(settings.RESTClientGetter(), settings.Namespace(), "secret", func(format string, v ...interface{}) {
			fmt.Printf(format, v...)
		}); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to init helm action config", "details": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"helm": "initialized"})
	})

	// Delete resource endpoint
	r.DELETE("/api/resource/delete", func(c *gin.Context) {
		client := getK8sClient()
		if client == nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "K8s client not initialized"})
			return
		}

		var req struct {
			Kind      string `json:"kind" binding:"required"`
			Name      string `json:"name" binding:"required"`
			Namespace string `json:"namespace" binding:"required"`
		}

		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		// Check if force delete is requested
		force := c.Query("force") == "true"

		// Delete the resource
		if err := handlers.DeleteResource(client, req.Kind, req.Name, req.Namespace, force); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete resource", "details": err.Error()})
			return
		}

		deleteType := "Deleted"
		if force {
			deleteType = "Force deleted"
		}
		fmt.Printf("%s %s/%s in namespace %s\n", deleteType, req.Kind, req.Name, req.Namespace)
		c.JSON(http.StatusOK, gin.H{"message": "Resource deleted successfully"})
	})

	port := os.Getenv("API_PORT")
	if port == "" {
		port = "8080"
	}
	r.Run(":" + port)
}

