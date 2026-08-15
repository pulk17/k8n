package handlers

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/user/k8s-graph-controller/backend/internal/k8s"
)

// ClientGetter returns the currently connected cluster client, or nil.
type ClientGetter func() *k8s.Client

// Health reports whether the database and cluster connections are usable. It is
// the endpoint the frontend polls to decide whether to show its "backend is
// down" screen, so it must answer even when everything else is broken.
func Health(getClient ClientGetter) gin.HandlerFunc {
	return func(c *gin.Context) {
		health := gin.H{"status": "ok", "database": "disconnected", "kubernetes": "disconnected"}

		if db := GetDB(); db != nil && db.Ping() == nil {
			health["database"] = "connected"
		}

		if client := getClient(); client != nil {
			if version, err := client.CheckConnection(); err == nil && version != "" {
				health["kubernetes"] = "connected"
				health["k8sVersion"] = version
				health["context"] = client.Context
			}
		}

		c.JSON(http.StatusOK, health)
	}
}

// ListContexts returns the contexts found in the local kubeconfig.
func ListContexts() gin.HandlerFunc {
	return func(c *gin.Context) {
		contexts, err := k8s.GetContexts()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error":   "Failed to read kubeconfig",
				"details": err.Error(),
				"hint":    "Check that ~/.kube/config exists and is readable",
			})
			return
		}
		c.JSON(http.StatusOK, contexts)
	}
}

// Connect switches the active cluster to the given kubeconfig context.
func Connect(setClient func(*k8s.Client)) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			Context string `json:"context" binding:"required"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		client, err := k8s.NewClient(req.Context)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to connect to context", "details": err.Error()})
			return
		}

		setClient(client)
		version, _ := client.CheckConnection()
		c.JSON(http.StatusOK, gin.H{"status": "connected", "context": req.Context, "version": version})
	}
}

// DeleteResourceHandler removes one resource. force=true drops the grace period
// for objects stuck terminating; it does not get past the protection check.
func DeleteResourceHandler(getClient ClientGetter) gin.HandlerFunc {
	return func(c *gin.Context) {
		client := getClient()
		if !requireDynamic(c, client) {
			return
		}

		var req struct {
			Kind      string `json:"kind" binding:"required"`
			Name      string `json:"name" binding:"required"`
			Namespace string `json:"namespace"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
		defer cancel()

		err := DeleteResource(ctx, client, req.Kind, req.Name, req.Namespace, c.Query("force") == "true")
		if errors.Is(err, ErrProtected) {
			c.JSON(http.StatusForbidden, gin.H{
				"error": err.Error(),
				"hint":  "Use kubectl if you really need to remove cluster components",
			})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete resource", "details": err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{"message": "Resource deleted"})
	}
}
