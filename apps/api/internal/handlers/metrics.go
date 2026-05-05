package handlers

import (
	"context"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/user/k8s-graph-controller/backend/internal/k8s"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	metricsv1beta1 "k8s.io/metrics/pkg/apis/metrics/v1beta1"
	"k8s.io/metrics/pkg/client/clientset/versioned"
)

type PodMetrics struct {
	Name      string            `json:"name"`
	Namespace string            `json:"namespace"`
	CPU       string            `json:"cpu"`
	Memory    string            `json:"memory"`
	Containers []ContainerMetrics `json:"containers"`
}

type ContainerMetrics struct {
	Name   string `json:"name"`
	CPU    string `json:"cpu"`
	Memory string `json:"memory"`
}

// GetPodMetrics returns resource usage for a specific pod
func GetPodMetrics(clientGetter func() *k8s.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		client := clientGetter()
		if client == nil || client.Clientset == nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "K8s client not initialized"})
			return
		}

		podName := c.Param("name")
		namespace := c.Query("namespace")
		if namespace == "" {
			namespace = "default"
		}

		// Create metrics client
		metricsClient, err := versioned.NewForConfig(client.Config)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": "Failed to create metrics client",
				"details": err.Error(),
				"hint": "Ensure metrics-server is installed in your cluster",
			})
			return
		}

		// Get pod metrics
		podMetrics, err := metricsClient.MetricsV1beta1().PodMetricses(namespace).Get(
			context.Background(),
			podName,
			metav1.GetOptions{},
		)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{
				"error": "Failed to get pod metrics",
				"details": err.Error(),
				"hint": "Pod may not exist or metrics-server may not be running",
			})
			return
		}

		result := convertPodMetrics(podMetrics)
		c.JSON(http.StatusOK, result)
	}
}

// GetNamespaceMetrics returns resource usage for all pods in a namespace
func GetNamespaceMetrics(clientGetter func() *k8s.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		client := clientGetter()
		if client == nil || client.Clientset == nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "K8s client not initialized"})
			return
		}

		namespace := c.Query("namespace")
		if namespace == "" {
			namespace = "default"
		}

		// Create metrics client
		metricsClient, err := versioned.NewForConfig(client.Config)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": "Failed to create metrics client",
				"details": err.Error(),
				"hint": "Ensure metrics-server is installed in your cluster",
			})
			return
		}

		// Get all pod metrics in namespace
		podMetricsList, err := metricsClient.MetricsV1beta1().PodMetricses(namespace).List(
			context.Background(),
			metav1.ListOptions{},
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": "Failed to list pod metrics",
				"details": err.Error(),
			})
			return
		}

		results := make([]PodMetrics, 0, len(podMetricsList.Items))
		for _, pm := range podMetricsList.Items {
			results = append(results, convertPodMetrics(&pm))
		}

		c.JSON(http.StatusOK, results)
	}
}

func convertPodMetrics(pm *metricsv1beta1.PodMetrics) PodMetrics {
	result := PodMetrics{
		Name:       pm.Name,
		Namespace:  pm.Namespace,
		Containers: make([]ContainerMetrics, 0, len(pm.Containers)),
	}

	var totalCPU, totalMemory int64
	for _, container := range pm.Containers {
		cpu := container.Usage.Cpu().MilliValue()
		memory := container.Usage.Memory().Value()
		
		totalCPU += cpu
		totalMemory += memory

		result.Containers = append(result.Containers, ContainerMetrics{
			Name:   container.Name,
			CPU:    formatCPU(cpu),
			Memory: formatMemory(memory),
		})
	}

	result.CPU = formatCPU(totalCPU)
	result.Memory = formatMemory(totalMemory)

	return result
}

func formatCPU(milliCores int64) string {
	if milliCores < 1000 {
		return fmt.Sprintf("%dm", milliCores)
	}
	return fmt.Sprintf("%d.%d", milliCores/1000, (milliCores%1000)/100)
}

func formatMemory(bytes int64) string {
	const (
		KB = 1024
		MB = 1024 * KB
		GB = 1024 * MB
	)

	if bytes < KB {
		return fmt.Sprintf("%dB", bytes)
	} else if bytes < MB {
		return fmt.Sprintf("%dKi", bytes/KB)
	} else if bytes < GB {
		return fmt.Sprintf("%dMi", bytes/MB)
	}
	return fmt.Sprintf("%dGi", bytes/GB)
}

// GetResourceMetrics returns metrics for any resource (Pod, Deployment, StatefulSet)
func GetResourceMetrics(clientGetter func() *k8s.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		client := clientGetter()
		if client == nil || client.Clientset == nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "K8s client not initialized"})
			return
		}

		namespace := c.Param("namespace")
		kind := c.Param("kind")
		name := c.Param("name")

		// Create metrics client
		metricsClient, err := versioned.NewForConfig(client.Config)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": "Failed to create metrics client",
				"details": err.Error(),
			})
			return
		}

		// For Deployment/StatefulSet/DaemonSet, get metrics from their pods
		var podMetricsList *metricsv1beta1.PodMetricsList
		
		if kind == "Deployment" || kind == "StatefulSet" || kind == "DaemonSet" {
			// Try multiple label selectors to find pods
			labelSelectors := []string{
				"app=" + name,
				"app.kubernetes.io/name=" + name,
				"k8s-app=" + name,
			}
			
			// Try each selector until we find pods
			for _, selector := range labelSelectors {
				podMetricsList, err = metricsClient.MetricsV1beta1().PodMetricses(namespace).List(
					context.Background(),
					metav1.ListOptions{LabelSelector: selector},
				)
				if err == nil && len(podMetricsList.Items) > 0 {
					break
				}
			}
			
			// If still no pods found, try to get all pods and filter by owner
			if podMetricsList == nil || len(podMetricsList.Items) == 0 {
				// Get all pods in namespace
				allPodMetrics, err := metricsClient.MetricsV1beta1().PodMetricses(namespace).List(
					context.Background(),
					metav1.ListOptions{},
				)
				if err == nil {
					// Filter by checking if pod name starts with resource name
					filteredItems := []metricsv1beta1.PodMetrics{}
					for _, pm := range allPodMetrics.Items {
						// Check if pod name starts with the resource name (common pattern)
						if len(pm.Name) >= len(name) && pm.Name[:len(name)] == name {
							filteredItems = append(filteredItems, pm)
						}
					}
					if len(filteredItems) > 0 {
						podMetricsList = &metricsv1beta1.PodMetricsList{
							Items: filteredItems,
						}
					}
				}
			}
		} else if kind == "Pod" {
			// Get single pod metrics
			podMetrics, err := metricsClient.MetricsV1beta1().PodMetricses(namespace).Get(
				context.Background(),
				name,
				metav1.GetOptions{},
			)
			if err == nil {
				podMetricsList = &metricsv1beta1.PodMetricsList{
					Items: []metricsv1beta1.PodMetrics{*podMetrics},
				}
			}
		} else {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Unsupported resource kind",
				"hint": "Only Pod, Deployment, StatefulSet, and DaemonSet are supported",
			})
			return
		}

		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{
				"error": "Failed to get metrics",
				"details": err.Error(),
				"hint": "Ensure metrics-server is installed and pods are running",
			})
			return
		}

		if podMetricsList == nil || len(podMetricsList.Items) == 0 {
			c.JSON(http.StatusNotFound, gin.H{
				"error": "No metrics found",
				"hint": "No pods found for this resource. The resource may not have any running pods yet.",
			})
			return
		}

		// Aggregate metrics
		var totalCPU, totalMemory int64
		podCount := len(podMetricsList.Items)
		
		for _, pm := range podMetricsList.Items {
			for _, container := range pm.Containers {
				totalCPU += container.Usage.Cpu().MilliValue()
				totalMemory += container.Usage.Memory().Value()
			}
		}

		// Calculate averages for deployments/statefulsets
		avgCPU := float64(0)
		avgMemory := float64(0)
		if podCount > 0 {
			avgCPU = float64(totalCPU) / float64(podCount) / 10.0 // Convert to percentage (assuming 1 core = 1000m)
			avgMemory = float64(totalMemory) / float64(podCount) / (1024 * 1024) // Convert to MB
		}

		c.JSON(http.StatusOK, gin.H{
			"cpu":    avgCPU,
			"memory": avgMemory,
			"pods":   podCount,
		})
	}
}

// CheckMetricsServer checks if metrics-server is available
func CheckMetricsServer(clientGetter func() *k8s.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		client := clientGetter()
		if client == nil || client.Clientset == nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "K8s client not initialized"})
			return
		}

		// Try to create metrics client
		metricsClient, err := versioned.NewForConfig(client.Config)
		if err != nil {
			c.JSON(http.StatusOK, gin.H{
				"available": false,
				"error": "Failed to create metrics client",
				"hint": "Metrics-server may not be installed",
			})
			return
		}

		// Try to list any pod metrics to verify metrics-server is working
		_, err = metricsClient.MetricsV1beta1().PodMetricses("kube-system").List(
			context.Background(),
			metav1.ListOptions{Limit: 1},
		)
		
		if err != nil {
			c.JSON(http.StatusOK, gin.H{
				"available": false,
				"error": "Metrics-server not responding",
				"details": err.Error(),
				"hint": "Install metrics-server: kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml",
			})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"available": true,
			"message": "Metrics-server is available",
		})
	}
}
