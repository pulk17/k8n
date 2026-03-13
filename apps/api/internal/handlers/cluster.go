package handlers

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/user/k8s-graph-controller/backend/internal/k8s"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type Resource struct {
	Kind            string            `json:"kind"`
	Name            string            `json:"name"`
	Namespace       string            `json:"namespace"`
	Labels          map[string]string `json:"labels"`
	Status          string            `json:"status"`
	UID             string            `json:"uid"`
	Selector        map[string]string `json:"selector,omitempty"`
	OwnerReferences []string          `json:"ownerReferences,omitempty"`
}

// GetClusterResources fetches Pods, Deployments, Services, ConfigMaps
func GetClusterResources(clientGetter func() *k8s.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		client := clientGetter()
		if client == nil || client.Clientset == nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "K8s client not initialized"})
			return
		}

		var resources []Resource
		ctx := context.Background()

		// Fetch Pods
		pods, err := client.Clientset.CoreV1().Pods("").List(ctx, metav1.ListOptions{})
		if err == nil {
			for _, p := range pods.Items {
				// Determine pod status more accurately
				status := "Unknown"
				phase := string(p.Status.Phase)
				
				// Check container statuses for more detail
				if phase == "Running" {
					allReady := true
					for _, cs := range p.Status.ContainerStatuses {
						if !cs.Ready {
							allReady = false
							break
						}
					}
					if allReady && len(p.Status.ContainerStatuses) > 0 {
						status = "Running"
					} else {
						status = "NotReady"
					}
				} else if phase == "Pending" {
					// Check if it's actually starting or stuck
					hasContainerCreating := false
					for _, cs := range p.Status.ContainerStatuses {
						if cs.State.Waiting != nil {
							if cs.State.Waiting.Reason == "ContainerCreating" || cs.State.Waiting.Reason == "PodInitializing" {
								hasContainerCreating = true
							} else if cs.State.Waiting.Reason == "CrashLoopBackOff" || cs.State.Waiting.Reason == "ImagePullBackOff" {
								status = "Error"
								break
							}
						}
					}
					if status != "Error" {
						if hasContainerCreating {
							status = "Pending"
						} else {
							status = "Pending"
						}
					}
				} else if phase == "Succeeded" {
					status = "Succeeded"
				} else if phase == "Failed" {
					status = "Failed"
				} else {
					status = phase
				}
				
				var owners []string
				for _, o := range p.OwnerReferences {
					owners = append(owners, o.Name)
				}
				resources = append(resources, Resource{
					Kind:            "Pod",
					Name:            p.Name,
					Namespace:       p.Namespace,
					Labels:          p.Labels,
					Status:          status,
					UID:             string(p.UID),
					OwnerReferences: owners,
				})
			}
		}

		// Fetch Deployments
		deps, err := client.Clientset.AppsV1().Deployments("").List(ctx, metav1.ListOptions{})
		if err == nil {
			for _, d := range deps.Items {
				status := "Unknown"
				if d.Spec.Replicas != nil {
					if d.Status.ReadyReplicas == *d.Spec.Replicas && *d.Spec.Replicas > 0 {
						status = "Ready"
					} else if d.Status.ReadyReplicas > 0 {
						status = "NotReady"
					} else if d.Status.UnavailableReplicas > 0 {
						status = "NotReady"
					} else {
						status = "Pending"
					}
				}
				
				var selector map[string]string
				if d.Spec.Selector != nil {
					selector = d.Spec.Selector.MatchLabels
				}

				resources = append(resources, Resource{
					Kind:      "Deployment",
					Name:      d.Name,
					Namespace: d.Namespace,
					Labels:    d.Labels,
					Status:    status,
					UID:       string(d.UID),
					Selector:  selector,
				})
			}
		}

		// Fetch ReplicaSets (since Deployments own RS, and RS own Pods, we might need them or just map loosely frontend side)
		rss, err := client.Clientset.AppsV1().ReplicaSets("").List(ctx, metav1.ListOptions{})
		if err == nil {
			for _, rs := range rss.Items {
				var owners []string
				for _, o := range rs.OwnerReferences {
					owners = append(owners, o.Name)
				}
				resources = append(resources, Resource{
					Kind:            "ReplicaSet",
					Name:            rs.Name,
					Namespace:       rs.Namespace,
					Labels:          rs.Labels,
					Status:          "Active",
					UID:             string(rs.UID),
					OwnerReferences: owners,
				})
			}
		}

		// Fetch Services
		svcs, err := client.Clientset.CoreV1().Services("").List(ctx, metav1.ListOptions{})
		if err == nil {
			for _, s := range svcs.Items {
				resources = append(resources, Resource{
					Kind:      "Service",
					Name:      s.Name,
					Namespace: s.Namespace,
					Labels:    s.Labels,
					Status:    "Active",
					UID:       string(s.UID),
					Selector:  s.Spec.Selector,
				})
			}
		}

		// Fetch ConfigMaps
		cms, err := client.Clientset.CoreV1().ConfigMaps("").List(ctx, metav1.ListOptions{})
		if err == nil {
			for _, cm := range cms.Items {
				resources = append(resources, Resource{
					Kind:      "ConfigMap",
					Name:      cm.Name,
					Namespace: cm.Namespace,
					Labels:    cm.Labels,
					Status:    "Active",
					UID:       string(cm.UID),
				})
			}
		}

		// (MVP) Optional: we could pull CRDs here dynamically, but it significantly slows down graph load.
		// Instead, we let the client query specific CRDs or we just render the basic objects for now.
		// For true Phase 3, we wait for a specific CRD query endpoint or load all if fast enough.

		c.JSON(http.StatusOK, resources)
	}
}
