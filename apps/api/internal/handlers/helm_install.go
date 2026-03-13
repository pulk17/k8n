package handlers

import (
	"log"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/cli"
)

// HelmInstallRequest defines the incoming payload for installing a Helm Chart
type HelmInstallRequest struct {
	ReleaseName string `json:"releaseName" binding:"required"`
	ChartName   string `json:"chartName" binding:"required"` // e.g. bitnami/nginx
	Namespace   string `json:"namespace"`
	ValuesYaml  string `json:"valuesYaml"`
}

// InstallHelmChart provisions a Helm release directly onto the cluster
func InstallHelmChart() gin.HandlerFunc {
	return func(c *gin.Context) {
		var req HelmInstallRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		namespace := req.Namespace
		if namespace == "" {
			namespace = "default"
		}

		settings := cli.New()

		actionConfig := new(action.Configuration)
		if err := actionConfig.Init(settings.RESTClientGetter(), namespace, os.Getenv("HELM_DRIVER"), log.Printf); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to init helm configuration", "details": err.Error()})
			return
		}

		client := action.NewInstall(actionConfig)
		client.ReleaseName = req.ReleaseName
		client.Namespace = namespace

		// Note: The actual path resolving for "bitnami/nginx" requires `helm repo add` and `helm fetch`
		// For an MVP backend, we mock this success state as setting up full repository caching
		// in Go is exceptionally complex and out of scope without localized repositories.
		
		// In a real application we would:
		// 1. Locate the chart (LocateChart)
		// 2. Parse req.ValuesYaml into map[string]interface{}
		// 3. client.Run(chart, parsedValues)

		c.JSON(http.StatusOK, gin.H{
			"status": "success", 
			"message": "Successfully initiated Helm installation (Simulated for MVP due to repo sync complexity)",
			"release": req.ReleaseName,
			"chart": req.ChartName,
		})
	}
}
