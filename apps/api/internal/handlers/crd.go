package handlers

import (
	"context"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/user/k8s-graph-controller/backend/internal/k8s"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
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
		if client == nil || client.DiscoveryClient == nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "K8s discovery client not initialized"})
			return
		}

		// Fetch all API server groups
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

// FetchDynamicResources pulls instances of a given CRD using the dynamic client
func FetchDynamicResources(dynClient dynamic.Interface, group, version, resource string) ([]Resource, error) {
	gvr := schema.GroupVersionResource{Group: group, Version: version, Resource: resource}
	
	list, err := dynClient.Resource(gvr).Namespace("").List(context.Background(), metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	var dynResources []Resource
	for _, item := range list.Items {
		var owners []string
		for _, o := range item.GetOwnerReferences() {
			owners = append(owners, o.Name)
		}

		status := "Active" // Simplification for CRDs
		
		dynResources = append(dynResources, Resource{
			Kind:            item.GetKind(),
			Name:            item.GetName(),
			Namespace:       item.GetNamespace(),
			Labels:          item.GetLabels(),
			Status:          status,
			UID:             string(item.GetUID()),
			OwnerReferences: owners,
		})
	}
	
	return dynResources, nil
}
