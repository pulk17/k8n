package main

import (
	"fmt"
	"net/http"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/user/k8s-graph-controller/backend/internal/k8s"
	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/cli"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

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
		c.JSON(http.StatusOK, gin.H{
			"status": "ok",
			"time":   time.Now().Unix(),
		})
	})

	// Initialize K8s Client
	// inside main to capture startup errors
	k8sClient, err := k8s.NewClient()
	if err != nil {
		fmt.Printf("Warning: Failed to initialize K8s client: %v\n", err)
	}

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

		c.JSON(http.StatusOK, gin.H{"k8s_version": version})
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

	r.Run(":8080")
}
