package handlers

import (
	"log"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/chart/loader"
	"helm.sh/helm/v3/pkg/cli"
	"helm.sh/helm/v3/pkg/getter"
	"helm.sh/helm/v3/pkg/repo"
	"sigs.k8s.io/yaml"
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
		settings.SetNamespace(namespace)

		actionConfig := new(action.Configuration)
		if err := actionConfig.Init(settings.RESTClientGetter(), namespace, os.Getenv("HELM_DRIVER"), log.Printf); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to init helm configuration", "details": err.Error()})
			return
		}

		// Ensure common repositories are added
		if err := ensureHelmRepos(settings); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to setup Helm repositories", "details": err.Error()})
			return
		}

		// Create install client
		client := action.NewInstall(actionConfig)
		client.ReleaseName = req.ReleaseName
		client.Namespace = namespace
		client.CreateNamespace = true
		client.Wait = false // Don't wait for resources to be ready (async)

		// Locate the chart
		chartPath, err := client.ChartPathOptions.LocateChart(req.ChartName, settings)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to locate chart", "details": err.Error()})
			return
		}

		// Load the chart
		chart, err := loader.Load(chartPath)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load chart", "details": err.Error()})
			return
		}

		// Parse custom values if provided
		vals := make(map[string]interface{})
		if req.ValuesYaml != "" {
			if err := yaml.Unmarshal([]byte(req.ValuesYaml), &vals); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid values YAML", "details": err.Error()})
				return
			}
		}

		// Install the chart
		release, err := client.Run(chart, vals)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to install chart", "details": err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"status":  "success",
			"message": "Successfully installed Helm chart",
			"release": release.Name,
			"chart":   req.ChartName,
			"version": release.Chart.Metadata.Version,
		})
	}
}

// ensureHelmRepos ensures common Helm repositories are configured
func ensureHelmRepos(settings *cli.EnvSettings) error {
	repoFile := settings.RepositoryConfig

	// Common repositories to add
	repos := []struct {
		name string
		url  string
	}{
		{"bitnami", "https://charts.bitnami.com/bitnami"},
		{"stable", "https://charts.helm.sh/stable"},
		{"ingress-nginx", "https://kubernetes.github.io/ingress-nginx"},
		{"jetstack", "https://charts.jetstack.io"},
	}

	// Load existing repo file
	b, err := os.ReadFile(repoFile)
	if err != nil && !os.IsNotExist(err) {
		return err
	}

	var f repo.File
	if err := yaml.Unmarshal(b, &f); err != nil {
		return err
	}

	// Add repos if they don't exist
	for _, r := range repos {
		if !f.Has(r.name) {
			entry := &repo.Entry{
				Name: r.name,
				URL:  r.url,
			}
			
			chartRepo, err := repo.NewChartRepository(entry, getter.All(settings))
			if err != nil {
				continue // Skip if repo fails
			}

			// Download index
			if _, err := chartRepo.DownloadIndexFile(); err != nil {
				continue // Skip if download fails
			}

			f.Update(entry)
		}
	}

	// Save repo file
	if err := f.WriteFile(repoFile, 0644); err != nil {
		return err
	}

	return nil
}

