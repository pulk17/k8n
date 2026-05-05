package handlers

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/user/k8s-graph-controller/backend/internal/k8s"
	"golang.org/x/text/cases"
	"golang.org/x/text/language"
)

var schemaCache = make(map[string]map[string]interface{})

// GetSchema fetches the OpenAPI schema for a given K8s Kind
func GetSchema(clientGetter func() *k8s.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		kind := c.Param("kind")
		if kind == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Kind is required"})
			return
		}

		// Normalize kind to Title case
		kind = cases.Title(language.Und).String(strings.ToLower(kind))

		// Check cache
		if cached, ok := schemaCache[kind]; ok {
			c.JSON(http.StatusOK, cached)
			return
		}

		client := clientGetter()
		if client == nil || client.Clientset == nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "K8s client not initialized"})
			return
		}

		schema := generateSimplifiedSchema(kind)
		if schema == nil {
			// For Phase 3: We generate a generic fallback schema for unknown CRDs
			// In a full implementation, this would query the API server's /openapi/v2 endpoint
			// and parse the specific properties. For MVP, we provide a basic text area for spec.
			schema = map[string]interface{}{
				"title":    kind,
				"type":     "object",
				"required": []string{"name", "spec"},
				"properties": map[string]interface{}{
					"name": map[string]interface{}{
						"type":  "string",
						"title": kind + " Name",
					},
					"spec": map[string]interface{}{
						"type":  "string",
						"title": "Spec (YAML/JSON)",
					},
				},
			}
		}

		schemaCache[kind] = schema
		c.JSON(http.StatusOK, schema)
	}
}

func generateSimplifiedSchema(kind string) map[string]interface{} {
	switch kind {
	case "Deployment":
		return map[string]interface{}{
			"title": "Deployment",
			"type":  "object",
			"required": []string{"name", "image", "replicas", "port"},
			"properties": map[string]interface{}{
				"name": map[string]interface{}{
					"type": "string",
					"title": "Deployment Name",
				},
				"image": map[string]interface{}{
					"type": "string",
					"title": "Container Image",
				},
				"replicas": map[string]interface{}{
					"type": "integer",
					"title": "Replicas",
					"default": 1,
				},
				"port": map[string]interface{}{
					"type": "integer",
					"title": "Container Port",
					"default": 80,
				},
			},
		}
	case "Service":
		return map[string]interface{}{
			"title": "Service",
			"type":  "object",
			"required": []string{"name", "port", "targetPort", "type"},
			"properties": map[string]interface{}{
				"name": map[string]interface{}{
					"type": "string",
					"title": "Service Name",
				},
				"port": map[string]interface{}{
					"type": "integer",
					"title": "Service Port (External)",
					"default": 80,
				},
				"targetPort": map[string]interface{}{
					"type": "integer",
					"title": "Target Port (Container)",
					"default": 80,
				},
				"type": map[string]interface{}{
					"type": "string",
					"title": "Service Type",
					"enum": []string{"ClusterIP", "NodePort", "LoadBalancer"},
					"default": "ClusterIP",
				},
			},
		}
	case "ConfigMap":
		return map[string]interface{}{
			"title": "ConfigMap",
			"type":  "object",
			"required": []string{"name", "data"},
			"properties": map[string]interface{}{
				"name": map[string]interface{}{
					"type": "string",
					"title": "ConfigMap Name",
				},
				"data": map[string]interface{}{
					"type": "string",
					"title": "Data (JSON format)",
				},
			},
		}
	default:
		return nil
	}
}
