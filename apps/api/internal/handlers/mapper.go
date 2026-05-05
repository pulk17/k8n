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
			if image == "" {
				image = "nginx:latest" // Default image if not specified
			}
			
			// Check both "containerPort" and "port" for backwards compatibility
			containerPort := 80
			if p, ok := input["containerPort"].(float64); ok {
				containerPort = int(p)
			} else if p, ok := input["port"].(float64); ok {
				containerPort = int(p)
			}

			// Build container spec
			containerSpec := map[string]interface{}{
				"name":  name,
				"image": image,
				"ports": []map[string]interface{}{
					{"containerPort": containerPort},
				},
			}

			// Optional command/args override
			if cmd, ok := input["command"].([]interface{}); ok && len(cmd) > 0 {
				containerSpec["command"] = cmd
			}
			if args, ok := input["args"].([]interface{}); ok && len(args) > 0 {
				containerSpec["args"] = args
			}

			// Optional env vars from configData or envVars
			if envVars, ok := input["envVars"].([]interface{}); ok && len(envVars) > 0 {
				containerSpec["env"] = envVars
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
							containerSpec,
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
			targetPort := port // Default targetPort to same as port
			if p, ok := input["targetPort"].(float64); ok {
				targetPort = int(p)
			}
			svcType, _ := input["serviceType"].(string)
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
			
		case "StatefulSet":
			fullObj["apiVersion"] = "apps/v1"
			
			replicas := 1
			if r, ok := input["replicas"].(float64); ok {
				replicas = int(r)
			}
			image, _ := input["image"].(string)
			if image == "" {
				image = "postgres:14-alpine"
			}
			
			containerPort := 5432
			if p, ok := input["containerPort"].(float64); ok {
				containerPort = int(p)
			}
			
			serviceName, _ := input["serviceName"].(string)
			if serviceName == "" {
				serviceName = name
			}

			// Build container spec
			stsContainerSpec := map[string]interface{}{
				"name":  name,
				"image": image,
				"ports": []map[string]interface{}{
					{"containerPort": containerPort},
				},
			}

			// Optional env vars
			if envVars, ok := input["envVars"].([]interface{}); ok && len(envVars) > 0 {
				stsContainerSpec["env"] = envVars
			}

			// Optional envFrom (reference a Secret or ConfigMap by name)
			if secretRef, ok := input["envFromSecret"].(string); ok && secretRef != "" {
				stsContainerSpec["envFrom"] = []map[string]interface{}{
					{"secretRef": map[string]interface{}{"name": secretRef}},
				}
			}

			fullObj["spec"] = map[string]interface{}{
				"serviceName": serviceName,
				"replicas":    replicas,
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
							stsContainerSpec,
						},
					},
				},
			}

		case "Secret":
			fullObj["apiVersion"] = "v1"
			
			secretType, _ := input["secretType"].(string)
			if secretType == "" {
				secretType = "Opaque"
			}
			
			fullObj["type"] = secretType
			fullObj["data"] = map[string]string{}

		case "Ingress":
			fullObj["apiVersion"] = "networking.k8s.io/v1"
			
			host, _ := input["host"].(string)
			path, _ := input["path"].(string)
			if path == "" {
				path = "/"
			}
			
			serviceName := name
			servicePort := 80
			if p, ok := input["port"].(float64); ok {
				servicePort = int(p)
			}

			rules := []map[string]interface{}{}
			if host != "" {
				rules = append(rules, map[string]interface{}{
					"host": host,
					"http": map[string]interface{}{
						"paths": []map[string]interface{}{
							{
								"path":     path,
								"pathType": "Prefix",
								"backend": map[string]interface{}{
									"service": map[string]interface{}{
										"name": serviceName,
										"port": map[string]interface{}{
											"number": servicePort,
										},
									},
								},
							},
						},
					},
				})
			}

			fullObj["spec"] = map[string]interface{}{
				"rules": rules,
			}

		case "PersistentVolumeClaim":
			fullObj["apiVersion"] = "v1"
			
			storageSize, _ := input["storageSize"].(string)
			if storageSize == "" {
				storageSize = "10Gi"
			}
			
			accessMode, _ := input["accessMode"].(string)
			if accessMode == "" {
				accessMode = "ReadWriteOnce"
			}
			
			storageClass, _ := input["storageClass"].(string)

			spec := map[string]interface{}{
				"accessModes": []string{accessMode},
				"resources": map[string]interface{}{
					"requests": map[string]interface{}{
						"storage": storageSize,
					},
				},
			}
			
			if storageClass != "" {
				spec["storageClassName"] = storageClass
			}

			fullObj["spec"] = spec

		case "HorizontalPodAutoscaler":
			fullObj["apiVersion"] = "autoscaling/v2"
			
			minReplicas := 1
			if r, ok := input["minReplicas"].(float64); ok {
				minReplicas = int(r)
			}
			
			maxReplicas := 10
			if r, ok := input["maxReplicas"].(float64); ok {
				maxReplicas = int(r)
			}
			
			targetCPU := 80
			if t, ok := input["targetCPU"].(float64); ok {
				targetCPU = int(t)
			}
			
			// Target reference - needs to be connected to a Deployment/StatefulSet
			targetKind := "Deployment"
			if tk, ok := input["targetKind"].(string); ok && tk != "" {
				targetKind = tk
			}
			
			targetName := name
			if tn, ok := input["targetName"].(string); ok && tn != "" {
				targetName = tn
			}

			fullObj["spec"] = map[string]interface{}{
				"scaleTargetRef": map[string]interface{}{
					"apiVersion": "apps/v1",
					"kind":       targetKind,
					"name":       targetName,
				},
				"minReplicas": minReplicas,
				"maxReplicas": maxReplicas,
				"metrics": []map[string]interface{}{
					{
						"type": "Resource",
						"resource": map[string]interface{}{
							"name": "cpu",
							"target": map[string]interface{}{
								"type":               "Utilization",
								"averageUtilization": targetCPU,
							},
						},
					},
				},
			}

		case "DaemonSet":
			fullObj["apiVersion"] = "apps/v1"
			
			image, _ := input["image"].(string)
			if image == "" {
				image = "fluent/fluentd:latest"
			}
			
			containerPort := 24224
			if p, ok := input["containerPort"].(float64); ok {
				containerPort = int(p)
			}

			fullObj["spec"] = map[string]interface{}{
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
										"containerPort": containerPort,
									},
								},
							},
						},
					},
				},
			}

		case "Job":
			fullObj["apiVersion"] = "batch/v1"
			
			image, _ := input["image"].(string)
			if image == "" {
				image = "busybox:latest"
			}

			fullObj["spec"] = map[string]interface{}{
				"template": map[string]interface{}{
					"spec": map[string]interface{}{
						"containers": []map[string]interface{}{
							{
								"name":    name,
								"image":   image,
								"command": []string{"sh", "-c", "echo Hello from Job"},
							},
						},
						"restartPolicy": "Never",
					},
				},
			}

		case "CronJob":
			fullObj["apiVersion"] = "batch/v1"
			
			image, _ := input["image"].(string)
			if image == "" {
				image = "busybox:latest"
			}
			
			schedule, _ := input["schedule"].(string)
			if schedule == "" {
				schedule = "0 0 * * *" // Daily at midnight
			}

			fullObj["spec"] = map[string]interface{}{
				"schedule": schedule,
				"jobTemplate": map[string]interface{}{
					"spec": map[string]interface{}{
						"template": map[string]interface{}{
							"spec": map[string]interface{}{
								"containers": []map[string]interface{}{
									{
										"name":    name,
										"image":   image,
										"command": []string{"sh", "-c", "echo Hello from CronJob"},
									},
								},
								"restartPolicy": "OnFailure",
							},
						},
					},
				},
			}

		default:
			// Handle Generic CRDs
			// For unknown types, try to use a sensible default or return error
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Unsupported resource kind: " + kind,
				"hint":  "Supported kinds: Deployment, StatefulSet, Service, ConfigMap, Secret, Ingress, PersistentVolumeClaim, HorizontalPodAutoscaler, DaemonSet, Job, CronJob",
			})
			return
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
