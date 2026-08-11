package handlers

import (
	"encoding/json"
	"net/http"
	"net/url"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/user/k8s-graph-controller/backend/internal/helm"
	"github.com/user/k8s-graph-controller/backend/internal/k8s"
	"helm.sh/helm/v3/pkg/release"
)

// ChartSummary is one Artifact Hub search result.
type ChartSummary struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Version     string `json:"version"`
	Repository  struct {
		Name string `json:"name"`
		URL  string `json:"url"`
	} `json:"repository"`
}

// SearchHelmCharts queries Artifact Hub.
//
// The repository URL is carried through so a chart can be installed straight
// from it. Without that, installing meant registering the repository in the
// user's own Helm configuration first.
func SearchHelmCharts() gin.HandlerFunc {
	return func(c *gin.Context) {
		query := c.Query("q")
		if query == "" {
			c.JSON(http.StatusOK, []ChartSummary{})
			return
		}

		endpoint := "https://artifacthub.io/api/v1/packages/search?kind=0&limit=30&ts_query_web=" +
			url.QueryEscape(query)

		client := &http.Client{Timeout: 15 * time.Second}
		resp, err := client.Get(endpoint)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{
				"error":   "Could not reach Artifact Hub",
				"details": err.Error(),
				"hint":    "Chart search needs internet access",
			})
			return
		}
		defer resp.Body.Close()

		var body struct {
			Packages []ChartSummary `json:"packages"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "Artifact Hub returned something unexpected", "details": err.Error()})
			return
		}
		if body.Packages == nil {
			body.Packages = []ChartSummary{}
		}
		c.JSON(http.StatusOK, body.Packages)
	}
}

// ChartRequest is the payload for template, install and upgrade.
type ChartRequest struct {
	ReleaseName string `json:"releaseName" binding:"required"`
	Chart       string `json:"chart" binding:"required"`
	RepoURL     string `json:"repoUrl"`
	Version     string `json:"version"`
	Namespace   string `json:"namespace"`
	ValuesYaml  string `json:"valuesYaml"`
}

func (r ChartRequest) options() helm.Options {
	return helm.Options{
		Release:   r.ReleaseName,
		Chart:     r.Chart,
		RepoURL:   r.RepoURL,
		Version:   r.Version,
		Namespace: r.Namespace,
		Values:    r.ValuesYaml,
	}
}

func bindChartRequest(c *gin.Context) (ChartRequest, bool) {
	var req ChartRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return req, false
	}
	return req, true
}

// TemplateHelmChart renders a chart to YAML without touching the cluster, so a
// Helm node can be reviewed in the manifest preview like everything else.
func TemplateHelmChart(getClient ClientGetter) gin.HandlerFunc {
	return func(c *gin.Context) {
		req, ok := bindChartRequest(c)
		if !ok {
			return
		}

		manifest, err := helm.Template(getClient(), req.options())
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Could not render chart", "details": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"yaml": manifest})
	}
}

// InstallHelmChart creates a release on the connected cluster.
func InstallHelmChart(getClient ClientGetter) gin.HandlerFunc {
	return func(c *gin.Context) {
		client := getClient()
		if !requireCluster(c, client) {
			return
		}
		req, ok := bindChartRequest(c)
		if !ok {
			return
		}

		rel, err := helm.Install(client, req.options())
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Install failed", "details": err.Error()})
			return
		}
		c.JSON(http.StatusOK, releaseInfo(rel))
	}
}

// UpgradeHelmRelease re-renders a release with new values or a new version.
func UpgradeHelmRelease(getClient ClientGetter) gin.HandlerFunc {
	return func(c *gin.Context) {
		client := getClient()
		if !requireCluster(c, client) {
			return
		}
		req, ok := bindChartRequest(c)
		if !ok {
			return
		}
		req.ReleaseName = c.Param("name")

		rel, err := helm.Upgrade(client, req.options())
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Upgrade failed", "details": err.Error()})
			return
		}
		c.JSON(http.StatusOK, releaseInfo(rel))
	}
}

// RollbackHelmRelease returns a release to an earlier revision.
func RollbackHelmRelease(getClient ClientGetter) gin.HandlerFunc {
	return func(c *gin.Context) {
		client := getClient()
		if !requireCluster(c, client) {
			return
		}
		var req struct {
			Namespace string `json:"namespace"`
			Revision  int    `json:"revision" binding:"required"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		if err := helm.Rollback(client, c.Param("name"), req.Namespace, req.Revision); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Rollback failed", "details": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"message": "Rolled back", "revision": req.Revision})
	}
}

// UninstallHelmRelease removes a release and everything it created.
func UninstallHelmRelease(getClient ClientGetter) gin.HandlerFunc {
	return func(c *gin.Context) {
		client := getClient()
		if !requireCluster(c, client) {
			return
		}
		if err := helm.Uninstall(client, c.Param("name"), c.Query("namespace")); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Uninstall failed", "details": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"message": "Uninstalled"})
	}
}

// ListHelmReleases returns the releases on the connected cluster.
func ListHelmReleases(getClient ClientGetter) gin.HandlerFunc {
	return func(c *gin.Context) {
		client := getClient()
		if !requireCluster(c, client) {
			return
		}

		releases, err := helm.List(client, c.Query("namespace"))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not list releases", "details": err.Error()})
			return
		}

		out := make([]gin.H, 0, len(releases))
		for _, rel := range releases {
			out = append(out, releaseInfo(rel))
		}
		c.JSON(http.StatusOK, out)
	}
}

// GetHelmRelease returns one release, including the manifest it rendered.
func GetHelmRelease(getClient ClientGetter) gin.HandlerFunc {
	return func(c *gin.Context) {
		client := getClient()
		if !requireCluster(c, client) {
			return
		}

		rel, err := helm.Get(client, c.Param("name"), c.Query("namespace"))
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Release not found", "details": err.Error()})
			return
		}

		info := releaseInfo(rel)
		info["notes"] = rel.Info.Notes
		info["values"] = rel.Config
		info["manifest"] = rel.Manifest
		c.JSON(http.StatusOK, info)
	}
}

// GetHelmReleaseHistory returns a release's revisions, newest first.
func GetHelmReleaseHistory(getClient ClientGetter) gin.HandlerFunc {
	return func(c *gin.Context) {
		client := getClient()
		if !requireCluster(c, client) {
			return
		}

		revisions, err := helm.History(client, c.Param("name"), c.Query("namespace"))
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "No history for that release", "details": err.Error()})
			return
		}

		out := make([]gin.H, 0, len(revisions))
		for _, rel := range revisions {
			out = append(out, releaseInfo(rel))
		}
		// Helm returns oldest first; the UI reads newest first.
		for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
			out[i], out[j] = out[j], out[i]
		}
		c.JSON(http.StatusOK, out)
	}
}

// releaseInfo is the shape the frontend and the MCP tools both read.
func releaseInfo(rel *release.Release) gin.H {
	info := gin.H{
		"name":      rel.Name,
		"namespace": rel.Namespace,
		"revision":  rel.Version,
	}
	if rel.Info != nil {
		info["status"] = string(rel.Info.Status)
		info["updated"] = rel.Info.LastDeployed.Format("2006-01-02 15:04:05")
		info["description"] = rel.Info.Description
	}
	if rel.Chart != nil && rel.Chart.Metadata != nil {
		info["chart"] = rel.Chart.Metadata.Name
		info["chartVersion"] = rel.Chart.Metadata.Version
		info["appVersion"] = rel.Chart.Metadata.AppVersion
	}
	return info
}

// helmReleaseNodes renders every HelmRelease node on a graph, so the manifest
// preview shows what the charts will create alongside the graph's own objects.
func helmReleaseNodes(client *k8s.Client, g Graph) (string, []CompileNote) {
	var out string
	var notes []CompileNote

	for _, n := range g.Nodes {
		if n.Kind() != "HelmRelease" {
			continue
		}
		chart, repoURL := chartRefOf(n)
		if chart == "" {
			notes = append(notes, CompileNote{
				NodeID: n.ID, Name: n.Name(), Kind: "HelmRelease", Level: "warning",
				Message: "No chart selected on this node.",
			})
			continue
		}

		manifest, err := helm.Template(client, helm.Options{
			Release:   n.Name(),
			Chart:     chart,
			RepoURL:   repoURL,
			Version:   strField(n.Data, "chartVersion"),
			Namespace: n.Namespace(),
			Values:    strField(n.Data, "valuesYaml"),
		})
		if err != nil {
			notes = append(notes, CompileNote{
				NodeID: n.ID, Name: n.Name(), Kind: "HelmRelease", Level: "warning",
				Message: "Could not render this chart: " + err.Error(),
			})
			continue
		}

		out += "\n---\n# Rendered from Helm chart " + chart + " for release " + n.Name() + "\n" + manifest
		notes = append(notes, CompileNote{
			NodeID: n.ID, Name: n.Name(), Kind: "HelmRelease", Level: "info",
			Message: "Rendered from the chart. Applying installs it as a Helm release, not as plain YAML.",
		})
	}
	return out, notes
}

// chartRefOf reads the chart name and repository from a Helm node.
func chartRefOf(n GraphNode) (chart, repoURL string) {
	if c, ok := n.Data["chart"].(map[string]interface{}); ok {
		return strField(c, "name"), strField(c, "repositoryUrl")
	}
	return strField(n.Data, "chart"), strField(n.Data, "repoUrl")
}
