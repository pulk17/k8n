package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"sigs.k8s.io/yaml"
)

// MapToYAML turns simple node data into full K8s YAML
func MapToYAML() gin.HandlerFunc {
	return func(c *gin.Context) {
		kind := c.Param("kind")
		
		var input map[string]interface{}
		if err := c.ShouldBindJSON(&input); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		// Extract base metadata that every K8s object needs
		name, _ := input["name"].(string)
		namespace, _ := input["namespace"].(string)
		if namespace == "" {
			namespace = "default"
		}

		fullObj := map[string]interface{}{
			"apiVersion": "v1", // Defaults, will be overridden
			"kind":       kind,
			"metadata": map[string]interface{}{
				"name":      name,
				"namespace": namespace,
			},
		}

		// Basic mapper logic
		switch kind {
		case "Deployment":
			fullObj["apiVersion"] = "apps/v1"
			
			replicas := 1
			if r, ok := input["replicas"].(float64); ok {
				replicas = int(r)
			}
			image, _ := input["image"].(string)
			port := 80
			if p, ok := input["port"].(float64); ok {
				port = int(p)
			}

			fullObj["spec"] = map[string]interface{}{
				"replicas": replicas,
				"selector": map[string]interface{}{
					"matchLabels": map[string]interface{}{
						"app": name,
					},
				},
				"template": map[string]interface{}{
					"metadata": map[string]interface{}{
						"labels": map[string]interface{}{
							"app": name,
						},
					},
					"spec": map[string]interface{}{
						"containers": []map[string]interface{}{
							{
								"name":  name,
								"image": image,
								"ports": []map[string]interface{}{
									{
										"containerPort": port,
									},
								},
							},
						},
					},
				},
			}

		case "Service":
			fullObj["apiVersion"] = "v1"
			
			port := 80
			if p, ok := input["port"].(float64); ok {
				port = int(p)
			}
			targetPort := 80
			if p, ok := input["targetPort"].(float64); ok {
				targetPort = int(p)
			}
			svcType, _ := input["type"].(string)
			if svcType == "" {
				svcType = "ClusterIP"
			}

			// In a real scenario, the selector would come from edges pointing to a Deployment
			// but for this MVP, we use the graph mapping or simple matching by name
			fullObj["spec"] = map[string]interface{}{
				"type": svcType,
				"selector": map[string]interface{}{
					"app": name, // Simplification: assuming matching app=name layout
				},
				"ports": []map[string]interface{}{
					{
						"port":       port,
						"targetPort": targetPort,
					},
				},
			}

		case "ConfigMap":
			fullObj["apiVersion"] = "v1"
			
			// If data is provided stringified from the form
			var dataMap map[string]string
			if d, ok := input["data"].(string); ok && d != "" {
				// We just put it under one key or try to parse
				dataMap = map[string]string{
					"config.json": d,
				}
			} else {
				dataMap = map[string]string{}
			}

			fullObj["data"] = dataMap
			
		default:
			// Handle Generic CRDs
			// Normally requires looking up Group/Version from Discovery, but for now we fallback
			// to assuming "experimental/v1" if user didn't specify.
			fullObj["apiVersion"] = "experimental/v1" // Dummy generic API version
			
			// Inject "spec" if provided as string (parsing it to map if needed, or dumping string)
			if specStr, ok := input["spec"].(string); ok && specStr != "" {
				var specMap map[string]interface{}
				if err := yaml.Unmarshal([]byte(specStr), &specMap); err == nil {
					fullObj["spec"] = specMap
				} else {
					fullObj["spec"] = map[string]interface{}{"raw": specStr}
				}
			}
		}

		// Convert to YAML
		yamlBytes, err := yaml.Marshal(fullObj)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to map to YAML", "details": err.Error()})
			return
		}

		c.String(http.StatusOK, string(yamlBytes))
	}
}
