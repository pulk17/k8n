package handlers

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/user/k8s-graph-controller/backend/internal/k8s"
)

type CRDSummary struct {
	Name    string `json:"name"`
	Group   string `json:"group"`
	Version string `json:"version"`
	Kind    string `json:"kind"`
}

func GetCRDs(clientGetter func() *k8s.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		client := clientGetter()
		if !requireDiscovery(c, client) {
			return
		}

		// Fetch all API server groups (with timeout context for safety)
		groups, err := client.DiscoveryClient.ServerGroups()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to discover API groups", "details": err.Error()})
			return
		}

		var crds []CRDSummary

		for _, group := range groups.Groups {
			// Skip core kubernetes groups to isolate "Custom" extensions mostly
			if group.Name == "" || group.Name == "apps" || group.Name == "batch" || group.Name == "extensions" || group.Name == "networking.k8s.io" || group.Name == "rbac.authorization.k8s.io" || group.Name == "storage.k8s.io" || group.Name == "admissionregistration.k8s.io" || group.Name == "apiextensions.k8s.io" || group.Name == "apiregistration.k8s.io" || group.Name == "authentication.k8s.io" || group.Name == "authorization.k8s.io" || group.Name == "autoscaling" || group.Name == "certificates.k8s.io" || group.Name == "coordination.k8s.io" || group.Name == "discovery.k8s.io" || group.Name == "events.k8s.io" || group.Name == "flowcontrol.apiserver.k8s.io" || group.Name == "node.k8s.io" || group.Name == "policy" || group.Name == "scheduling.k8s.io" {
				continue
			}

			// Get the preferred version for the group
			version := group.PreferredVersion.Version
			gv := group.Name + "/" + version

			resources, err := client.DiscoveryClient.ServerResourcesForGroupVersion(gv)
			if err != nil {
				continue // Permission or offline API issues
			}

			for _, res := range resources.APIResources {
				// We only want standard addressable objects, ignore subresources like /status or /scale
				if strings.Contains(res.Name, "/") {
					continue
				}

				crds = append(crds, CRDSummary{
					Name:    res.Name,
					Group:   group.Name,
					Version: version,
					Kind:    res.Kind,
				})
			}
		}

		c.JSON(http.StatusOK, crds)
	}
}

