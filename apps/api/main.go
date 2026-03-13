package main

import (
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/user/k8s-graph-controller/backend/internal/handlers"
	"github.com/user/k8s-graph-controller/backend/internal/k8s"
	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/cli"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		return origin == "http://localhost:3000" || origin == "http://localhost:3001"
	},
}

var k8sClient *k8s.Client

func main() {
	r := gin.Default()

	// Configure CORS
	r.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"http://localhost:3000"},
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

		// Store globally
		k8sClient = newClient
		version, _ := k8sClient.CheckConnection()
		
		c.JSON(http.StatusOK, gin.H{"status": "connected", "context": req.Context, "version": version})
	})

	r.GET("/api/cluster/resources", handlers.GetClusterResources(func() *k8s.Client {
		return k8sClient
	}))

	r.GET("/api/cluster/crds", handlers.GetCRDs(func() *k8s.Client {
		return k8sClient
	}))

	r.GET("/api/schema/:kind", handlers.GetSchema(func() *k8s.Client {
		return k8sClient
	}))

	r.GET("/api/helm/search", handlers.SearchHelmCharts())
	r.POST("/api/helm/install", handlers.InstallHelmChart())

	r.POST("/api/mapper/:kind", handlers.MapToYAML())

	applyHandler := handlers.ApplyResources(func() *k8s.Client {
		return k8sClient
	})
	r.POST("/api/graph/dry-run", applyHandler) // Use ?dryRun=true 
	r.POST("/api/graph/apply", applyHandler)

	// Graph Persistence
	r.POST("/api/graph/save", handlers.SaveGraph())
	r.GET("/api/graph/:id", handlers.LoadGraph())
	r.GET("/api/graph/list", handlers.ListGraphs())

	// Basic K8s connection check
	r.GET("/k8s/check", func(c *gin.Context) {
		if k8sClient == nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "K8s client not initialized"})
			return
		}

		version, err := k8sClient.CheckConnection()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to connect to K8s", "details": err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{"k8s_version": version, "context": k8sClient.Context})
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
		if k8sClient == nil {
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

		// Delete the resource
		if err := handlers.DeleteResource(k8sClient, req.Kind, req.Name, req.Namespace); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete resource", "details": err.Error()})
			return
		}

		fmt.Printf("Deleted %s/%s in namespace %s\n", req.Kind, req.Name, req.Namespace)
		c.JSON(http.StatusOK, gin.H{"message": "Resource deleted successfully"})
	})

	r.Run(":8080")
}
