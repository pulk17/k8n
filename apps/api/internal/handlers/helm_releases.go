package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/chart/loader"
	"sigs.k8s.io/yaml"
)

// HelmReleaseInfo represents a deployed Helm release
type HelmReleaseInfo struct {
	Name        string `json:"name"`
	Namespace   string `json:"namespace"`
	Revision    int    `json:"revision"`
	Updated     string `json:"updated"`
	Status      string `json:"status"`
	Chart       string `json:"chart"`
	ChartVersion string `json:"chartVersion"`
	AppVersion  string `json:"appVersion"`
	Description string `json:"description"`
}

// ListHelmReleases returns all Helm releases across all namespaces
func ListHelmReleases() gin.HandlerFunc {
	return func(c *gin.Context) {
		namespace := c.Query("namespace")

		actionConfig, _, err := getHelmActionConfig(namespace)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to init helm configuration", "details": err.Error()})
			return
		}

		client := action.NewList(actionConfig)
		client.AllNamespaces = (namespace == "")
		client.All = true // Include all statuses

		releases, err := client.Run()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list releases", "details": err.Error()})
			return
		}

		result := make([]HelmReleaseInfo, 0, len(releases))
		for _, rel := range releases {
			result = append(result, HelmReleaseInfo{
				Name:         rel.Name,
				Namespace:    rel.Namespace,
				Revision:     rel.Version,
				Updated:      rel.Info.LastDeployed.Format("2006-01-02 15:04:05"),
				Status:       string(rel.Info.Status),
				Chart:        rel.Chart.Metadata.Name,
				ChartVersion: rel.Chart.Metadata.Version,
				AppVersion:   rel.Chart.Metadata.AppVersion,
				Description:  rel.Info.Description,
			})
		}

		c.JSON(http.StatusOK, result)
	}
}

// GetHelmRelease returns details about a specific release
func GetHelmRelease() gin.HandlerFunc {
	return func(c *gin.Context) {
		releaseName := c.Param("name")
		namespace := c.Query("namespace")
		if namespace == "" {
			namespace = "default"
		}

		actionConfig, _, err := getHelmActionConfig(namespace)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to init helm configuration", "details": err.Error()})
			return
		}

		client := action.NewGet(actionConfig)
		rel, err := client.Run(releaseName)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Release not found", "details": err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"name":         rel.Name,
			"namespace":    rel.Namespace,
			"revision":     rel.Version,
			"updated":      rel.Info.LastDeployed.Format("2006-01-02 15:04:05"),
			"status":       string(rel.Info.Status),
			"chart":        rel.Chart.Metadata.Name,
			"chartVersion": rel.Chart.Metadata.Version,
			"appVersion":   rel.Chart.Metadata.AppVersion,
			"description":  rel.Info.Description,
			"notes":        rel.Info.Notes,
			"values":       rel.Config,
			"manifest":     rel.Manifest,
		})
	}
}

// GetHelmReleaseValues returns the values for a specific release
func GetHelmReleaseValues() gin.HandlerFunc {
	return func(c *gin.Context) {
		releaseName := c.Param("name")
		namespace := c.Query("namespace")
		if namespace == "" {
			namespace = "default"
		}

		actionConfig, _, err := getHelmActionConfig(namespace)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to init helm configuration", "details": err.Error()})
			return
		}

		client := action.NewGetValues(actionConfig)
		values, err := client.Run(releaseName)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Failed to get values", "details": err.Error()})
			return
		}

		c.JSON(http.StatusOK, values)
	}
}

// UninstallHelmRelease removes a Helm release
func UninstallHelmRelease() gin.HandlerFunc {
	return func(c *gin.Context) {
		releaseName := c.Param("name")
		namespace := c.Query("namespace")
		if namespace == "" {
			namespace = "default"
		}

		actionConfig, _, err := getHelmActionConfig(namespace)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to init helm configuration", "details": err.Error()})
			return
		}

		client := action.NewUninstall(actionConfig)
		resp, err := client.Run(releaseName)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to uninstall release", "details": err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"status":  "success",
			"message": "Successfully uninstalled release",
			"release": resp.Release.Name,
			"info":    resp.Info,
		})
	}
}

// UpgradeHelmRelease upgrades an existing Helm release
func UpgradeHelmRelease() gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			ReleaseName string `json:"releaseName" binding:"required"`
			ChartName   string `json:"chartName" binding:"required"`
			Namespace   string `json:"namespace"`
			ValuesYaml  string `json:"valuesYaml"`
			Version     string `json:"version"`
		}
		
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		namespace := req.Namespace
		if namespace == "" {
			namespace = "default"
		}

		actionConfig, settings, err := getHelmActionConfig(namespace)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to init helm configuration", "details": err.Error()})
			return
		}

		// Ensure repos are available
		if err := ensureHelmRepos(settings); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to setup Helm repositories", "details": err.Error()})
			return
		}

		client := action.NewUpgrade(actionConfig)
		client.Namespace = namespace
		client.Wait = false
		if req.Version != "" {
			client.Version = req.Version
		}

		// Locate chart
		chartPath, err := client.ChartPathOptions.LocateChart(req.ChartName, settings)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to locate chart", "details": err.Error()})
			return
		}

		// Load chart
		chart, err := loader.Load(chartPath)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load chart", "details": err.Error()})
			return
		}

		// Parse values
		vals := make(map[string]interface{})
		if req.ValuesYaml != "" {
			if err := yaml.Unmarshal([]byte(req.ValuesYaml), &vals); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid values YAML", "details": err.Error()})
				return
			}
		}

		// Upgrade
		rel, err := client.Run(req.ReleaseName, chart, vals)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to upgrade release", "details": err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"status":  "success",
			"message": "Successfully upgraded release",
			"release": rel.Name,
			"version": rel.Chart.Metadata.Version,
			"revision": rel.Version,
		})
	}
}

// RollbackHelmRelease rolls back a release to a previous revision
func RollbackHelmRelease() gin.HandlerFunc {
	return func(c *gin.Context) {
		releaseName := c.Param("name")
		var req struct {
			Namespace string `json:"namespace"`
			Revision  int    `json:"revision"`
		}
		
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		namespace := req.Namespace
		if namespace == "" {
			namespace = "default"
		}

		actionConfig, _, err := getHelmActionConfig(namespace)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to init helm configuration", "details": err.Error()})
			return
		}

		client := action.NewRollback(actionConfig)
		client.Version = req.Revision
		client.Wait = false

		if err := client.Run(releaseName); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to rollback release", "details": err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"status":  "success",
			"message": "Successfully rolled back release",
			"release": releaseName,
			"revision": req.Revision,
		})
	}
}

// GetHelmReleaseHistory returns the revision history for a release
func GetHelmReleaseHistory() gin.HandlerFunc {
	return func(c *gin.Context) {
		releaseName := c.Param("name")
		namespace := c.Query("namespace")
		if namespace == "" {
			namespace = "default"
		}

		actionConfig, _, err := getHelmActionConfig(namespace)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to init helm configuration", "details": err.Error()})
			return
		}

		client := action.NewHistory(actionConfig)
		client.Max = 256

		history, err := client.Run(releaseName)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Failed to get history", "details": err.Error()})
			return
		}

		result := make([]map[string]interface{}, 0, len(history))
		for _, rel := range history {
			result = append(result, map[string]interface{}{
				"revision":    rel.Version,
				"updated":     rel.Info.LastDeployed.Format("2006-01-02 15:04:05"),
				"status":      string(rel.Info.Status),
				"chart":       rel.Chart.Metadata.Name + "-" + rel.Chart.Metadata.Version,
				"appVersion":  rel.Chart.Metadata.AppVersion,
				"description": rel.Info.Description,
			})
		}

		c.JSON(http.StatusOK, result)
	}
}

// GetHelmReleaseStatus returns the status of a release
func GetHelmReleaseStatus() gin.HandlerFunc {
	return func(c *gin.Context) {
		releaseName := c.Param("name")
		namespace := c.Query("namespace")
		if namespace == "" {
			namespace = "default"
		}

		actionConfig, _, err := getHelmActionConfig(namespace)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to init helm configuration", "details": err.Error()})
			return
		}

		client := action.NewStatus(actionConfig)
		rel, err := client.Run(releaseName)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Release not found", "details": err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"name":      rel.Name,
			"namespace": rel.Namespace,
			"status":    string(rel.Info.Status),
			"revision":  rel.Version,
			"updated":   rel.Info.LastDeployed.Format("2006-01-02 15:04:05"),
			"notes":     rel.Info.Notes,
		})
	}
}
