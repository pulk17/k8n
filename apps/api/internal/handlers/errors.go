package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/user/k8s-graph-controller/backend/internal/k8s"
)

// requireCluster writes a 503 and returns false when no cluster is connected.
//
// These handlers used to answer 500 "K8s client not initialized", which reads as
// a server bug and shows up as a red console error for anyone who simply has not
// connected a cluster yet. 503 with a hint says what it is: the feature needs a
// cluster, and the rest of k8n still works.
func requireCluster(c *gin.Context, client *k8s.Client) bool {
	if client != nil && client.Clientset != nil {
		return true
	}
	c.JSON(http.StatusServiceUnavailable, gin.H{
		"error":     "No cluster connected",
		"hint":      "Pick a kubeconfig context on the Connect page, or run k8n where a kubeconfig is available.",
		"connected": false,
	})
	return false
}

// requireDiscovery is requireCluster for handlers that need API discovery.
func requireDiscovery(c *gin.Context, client *k8s.Client) bool {
	if client != nil && client.DiscoveryClient != nil {
		return true
	}
	c.JSON(http.StatusServiceUnavailable, gin.H{
		"error":     "No cluster connected",
		"hint":      "Custom resource discovery needs a connected cluster.",
		"connected": false,
	})
	return false
}

// requireDynamic is requireCluster for handlers that apply or patch objects.
func requireDynamic(c *gin.Context, client *k8s.Client) bool {
	if client != nil && client.DynamicClient != nil {
		return true
	}
	c.JSON(http.StatusServiceUnavailable, gin.H{
		"error":     "No cluster connected",
		"hint":      "Connect a cluster before applying resources. You can still compile and download the YAML.",
		"connected": false,
	})
	return false
}
