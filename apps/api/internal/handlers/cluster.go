package handlers

import (
	"context"
	"fmt"
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
	Annotations     map[string]string `json:"annotations,omitempty"`
	Status          string            `json:"status"`
	StatusMessage   string            `json:"statusMessage,omitempty"`
	UID             string            `json:"uid"`
	Selector        map[string]string `json:"selector,omitempty"`
	OwnerReferences []string          `json:"ownerReferences,omitempty"`
	CreatedAt       string            `json:"createdAt,omitempty"`
	
	// Deployment/StatefulSet specific
	Replicas      *int32  `json:"replicas,omitempty"`
	ReadyReplicas int32   `json:"readyReplicas,omitempty"`
	Image         string  `json:"image,omitempty"`
	
	// Service specific
	ServiceType   string   `json:"serviceType,omitempty"`
	ClusterIP     string   `json:"clusterIP,omitempty"`
	ExternalIP    string   `json:"externalIP,omitempty"`
	Ports         []string `json:"ports,omitempty"`
	
	// Pod specific
	PodIP         string `json:"podIP,omitempty"`
	NodeName      string `json:"nodeName,omitempty"`
	RestartCount  int32  `json:"restartCount,omitempty"`
	
	// ConfigMap/Secret specific
	DataKeys      []string `json:"dataKeys,omitempty"`
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

		// Support server-side namespace filtering to reduce bandwidth on large clusters
		namespace := c.Query("namespace")
		// Empty string means all namespaces (matches K8s client behavior)

		// Fetch Pods
		pods, err := client.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})
		if err == nil {
			for _, p := range pods.Items {
				// Determine pod status more accurately
				status := "Unknown"
				statusMessage := ""
				phase := string(p.Status.Phase)
				
				// Calculate total restart count
				var restartCount int32
				for _, cs := range p.Status.ContainerStatuses {
					restartCount += cs.RestartCount
				}
				
				// Get first container image
				image := ""
				if len(p.Spec.Containers) > 0 {
					image = p.Spec.Containers[0].Image
				}
				
				// Check container statuses for more detail
				if phase == "Running" {
					allReady := true
					completedCount := 0
					for _, cs := range p.Status.ContainerStatuses {
						if !cs.Ready {
							allReady = false
							if cs.State.Waiting != nil {
								reason := cs.State.Waiting.Reason
								if reason == "CrashLoopBackOff" || reason == "ImagePullBackOff" || reason == "ErrImagePull" {
									status = "Error"
									statusMessage = reason + ": " + cs.State.Waiting.Message
									break
								}
								statusMessage = reason + ": " + cs.State.Waiting.Message
							} else if cs.State.Terminated != nil {
								reason := cs.State.Terminated.Reason
								exitCode := cs.State.Terminated.ExitCode
								if reason == "Completed" || exitCode == 0 {
									completedCount++
								} else {
									status = "Error"
									statusMessage = reason + ": " + cs.State.Terminated.Message
									break
								}
							}
						}
					}
					if status != "Error" {
						if allReady && len(p.Status.ContainerStatuses) > 0 {
							status = "Running"
						} else if completedCount > 0 && completedCount == len(p.Status.ContainerStatuses) {
							status = "Completed"
							statusMessage = "Pod completed successfully"
						} else {
							status = "NotReady"
						}
					}
				} else if phase == "Pending" {
					// Check if it's actually starting or stuck
					hasContainerCreating := false
					for _, cs := range p.Status.ContainerStatuses {
						if cs.State.Waiting != nil {
							if cs.State.Waiting.Reason == "ContainerCreating" || cs.State.Waiting.Reason == "PodInitializing" {
								hasContainerCreating = true
								statusMessage = cs.State.Waiting.Reason
							} else if cs.State.Waiting.Reason == "CrashLoopBackOff" || cs.State.Waiting.Reason == "ImagePullBackOff" || cs.State.Waiting.Reason == "ErrImagePull" {
								status = "Error"
								statusMessage = cs.State.Waiting.Reason + ": " + cs.State.Waiting.Message
								break
							}
						}
					}
					if status != "Error" {
						if hasContainerCreating {
							status = "Pending"
						} else {
							status = "Pending"
							// Check pod conditions for more info
							for _, cond := range p.Status.Conditions {
								if cond.Status == "False" {
									statusMessage = cond.Reason + ": " + cond.Message
									break
								}
							}
						}
					}
				} else if phase == "Succeeded" {
					// Completed pods (from Jobs/CronJobs)
					status = "Completed"
					statusMessage = "Pod completed successfully"
				} else if phase == "Failed" {
					status = "Failed"
					statusMessage = p.Status.Message
					if statusMessage == "" {
						for _, cs := range p.Status.ContainerStatuses {
							if cs.State.Terminated != nil {
								statusMessage = cs.State.Terminated.Reason + ": " + cs.State.Terminated.Message
								break
							}
						}
					}
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
					Annotations:     p.Annotations,
					Status:          status,
					StatusMessage:   statusMessage,
					UID:             string(p.UID),
					OwnerReferences: owners,
					CreatedAt:       p.CreationTimestamp.Format("2006-01-02 15:04:05"),
					PodIP:           p.Status.PodIP,
					NodeName:        p.Spec.NodeName,
					RestartCount:    restartCount,
					Image:           image,
				})
			}
		}

		// Fetch Deployments
		deps, err := client.Clientset.AppsV1().Deployments(namespace).List(ctx, metav1.ListOptions{})
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
				
				// Get first container image
				image := ""
				if len(d.Spec.Template.Spec.Containers) > 0 {
					image = d.Spec.Template.Spec.Containers[0].Image
				}

				resources = append(resources, Resource{
					Kind:          "Deployment",
					Name:          d.Name,
					Namespace:     d.Namespace,
					Labels:        d.Labels,
					Annotations:   d.Annotations,
					Status:        status,
					UID:           string(d.UID),
					Selector:      selector,
					CreatedAt:     d.CreationTimestamp.Format("2006-01-02 15:04:05"),
					Replicas:      d.Spec.Replicas,
					ReadyReplicas: d.Status.ReadyReplicas,
					Image:         image,
				})
			}
		}

		// Fetch ReplicaSets (since Deployments own RS, and RS own Pods, we might need them or just map loosely frontend side)
		rss, err := client.Clientset.AppsV1().ReplicaSets(namespace).List(ctx, metav1.ListOptions{})
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
		svcs, err := client.Clientset.CoreV1().Services(namespace).List(ctx, metav1.ListOptions{})
		if err == nil {
			for _, s := range svcs.Items {
				var ports []string
				for _, p := range s.Spec.Ports {
					ports = append(ports, fmt.Sprintf("%d:%d/%s", p.Port, p.TargetPort.IntVal, p.Protocol))
				}
				
				externalIP := ""
				if len(s.Status.LoadBalancer.Ingress) > 0 {
					if s.Status.LoadBalancer.Ingress[0].IP != "" {
						externalIP = s.Status.LoadBalancer.Ingress[0].IP
					} else if s.Status.LoadBalancer.Ingress[0].Hostname != "" {
						externalIP = s.Status.LoadBalancer.Ingress[0].Hostname
					}
				}
				
				resources = append(resources, Resource{
					Kind:        "Service",
					Name:        s.Name,
					Namespace:   s.Namespace,
					Labels:      s.Labels,
					Annotations: s.Annotations,
					Status:      "Active",
					UID:         string(s.UID),
					Selector:    s.Spec.Selector,
					CreatedAt:   s.CreationTimestamp.Format("2006-01-02 15:04:05"),
					ServiceType: string(s.Spec.Type),
					ClusterIP:   s.Spec.ClusterIP,
					ExternalIP:  externalIP,
					Ports:       ports,
				})
			}
		}

		// Fetch ConfigMaps
		cms, err := client.Clientset.CoreV1().ConfigMaps(namespace).List(ctx, metav1.ListOptions{})
		if err == nil {
			for _, cm := range cms.Items {
				var dataKeys []string
				for k := range cm.Data {
					dataKeys = append(dataKeys, k)
				}
				
				resources = append(resources, Resource{
					Kind:        "ConfigMap",
					Name:        cm.Name,
					Namespace:   cm.Namespace,
					Labels:      cm.Labels,
					Annotations: cm.Annotations,
					Status:      "Active",
					UID:         string(cm.UID),
					CreatedAt:   cm.CreationTimestamp.Format("2006-01-02 15:04:05"),
					DataKeys:    dataKeys,
				})
			}
		}

		// Fetch DaemonSets
		dss, err := client.Clientset.AppsV1().DaemonSets(namespace).List(ctx, metav1.ListOptions{})
		if err == nil {
			for _, ds := range dss.Items {
				status := "Unknown"
				if ds.Status.DesiredNumberScheduled > 0 {
					if ds.Status.NumberReady == ds.Status.DesiredNumberScheduled {
						status = "Ready"
					} else if ds.Status.NumberReady > 0 {
						status = "NotReady"
					} else {
						status = "Pending"
					}
				}
				
				var selector map[string]string
				if ds.Spec.Selector != nil {
					selector = ds.Spec.Selector.MatchLabels
				}
				
				// Get first container image
				image := ""
				if len(ds.Spec.Template.Spec.Containers) > 0 {
					image = ds.Spec.Template.Spec.Containers[0].Image
				}

				resources = append(resources, Resource{
					Kind:          "DaemonSet",
					Name:          ds.Name,
					Namespace:     ds.Namespace,
					Labels:        ds.Labels,
					Annotations:   ds.Annotations,
					Status:        status,
					UID:           string(ds.UID),
					Selector:      selector,
					CreatedAt:     ds.CreationTimestamp.Format("2006-01-02 15:04:05"),
					Replicas:      &ds.Status.DesiredNumberScheduled,
					ReadyReplicas: ds.Status.NumberReady,
					Image:         image,
				})
			}
		}

		// Fetch StatefulSets
		stss, err := client.Clientset.AppsV1().StatefulSets(namespace).List(ctx, metav1.ListOptions{})
		if err == nil {
			for _, sts := range stss.Items {
				status := "Unknown"
				if sts.Spec.Replicas != nil {
					if sts.Status.ReadyReplicas == *sts.Spec.Replicas && *sts.Spec.Replicas > 0 {
						status = "Ready"
					} else if sts.Status.ReadyReplicas > 0 {
						status = "NotReady"
					} else {
						status = "Pending"
					}
				}
				
				var selector map[string]string
				if sts.Spec.Selector != nil {
					selector = sts.Spec.Selector.MatchLabels
				}
				
				// Get first container image
				image := ""
				if len(sts.Spec.Template.Spec.Containers) > 0 {
					image = sts.Spec.Template.Spec.Containers[0].Image
				}

				resources = append(resources, Resource{
					Kind:          "StatefulSet",
					Name:          sts.Name,
					Namespace:     sts.Namespace,
					Labels:        sts.Labels,
					Annotations:   sts.Annotations,
					Status:        status,
					UID:           string(sts.UID),
					Selector:      selector,
					CreatedAt:     sts.CreationTimestamp.Format("2006-01-02 15:04:05"),
					Replicas:      sts.Spec.Replicas,
					ReadyReplicas: sts.Status.ReadyReplicas,
					Image:         image,
				})
			}
		}

		// Fetch Secrets
		secrets, err := client.Clientset.CoreV1().Secrets(namespace).List(ctx, metav1.ListOptions{})
		if err == nil {
			for _, secret := range secrets.Items {
				var dataKeys []string
				for k := range secret.Data {
					dataKeys = append(dataKeys, k)
				}
				
				resources = append(resources, Resource{
					Kind:        "Secret",
					Name:        secret.Name,
					Namespace:   secret.Namespace,
					Labels:      secret.Labels,
					Annotations: secret.Annotations,
					Status:      "Active",
					UID:         string(secret.UID),
					CreatedAt:   secret.CreationTimestamp.Format("2006-01-02 15:04:05"),
					DataKeys:    dataKeys,
				})
			}
		}

		// Fetch Ingresses
		ingresses, err := client.Clientset.NetworkingV1().Ingresses(namespace).List(ctx, metav1.ListOptions{})
		if err == nil {
			for _, ing := range ingresses.Items {
				resources = append(resources, Resource{
					Kind:        "Ingress",
					Name:        ing.Name,
					Namespace:   ing.Namespace,
					Labels:      ing.Labels,
					Annotations: ing.Annotations,
					Status:      "Active",
					UID:         string(ing.UID),
					CreatedAt:   ing.CreationTimestamp.Format("2006-01-02 15:04:05"),
				})
			}
		}

		// Fetch Jobs
		jobs, err := client.Clientset.BatchV1().Jobs(namespace).List(ctx, metav1.ListOptions{})
		if err == nil {
			for _, job := range jobs.Items {
				status := "Active"
				if job.Status.Succeeded > 0 {
					status = "Completed"
				} else if job.Status.Failed > 0 {
					status = "Failed"
				}
				
				resources = append(resources, Resource{
					Kind:        "Job",
					Name:        job.Name,
					Namespace:   job.Namespace,
					Labels:      job.Labels,
					Annotations: job.Annotations,
					Status:      status,
					UID:         string(job.UID),
					CreatedAt:   job.CreationTimestamp.Format("2006-01-02 15:04:05"),
				})
			}
		}

		// Fetch CronJobs
		cronJobs, err := client.Clientset.BatchV1().CronJobs(namespace).List(ctx, metav1.ListOptions{})
		if err == nil {
			for _, cj := range cronJobs.Items {
				resources = append(resources, Resource{
					Kind:        "CronJob",
					Name:        cj.Name,
					Namespace:   cj.Namespace,
					Labels:      cj.Labels,
					Annotations: cj.Annotations,
					Status:      "Active",
					UID:         string(cj.UID),
					CreatedAt:   cj.CreationTimestamp.Format("2006-01-02 15:04:05"),
				})
			}
		}

		// (MVP) Optional: we could pull CRDs here dynamically, but it significantly slows down graph load.
		// Instead, we let the client query specific CRDs or we just render the basic objects for now.
		// For true Phase 3, we wait for a specific CRD query endpoint or load all if fast enough.

		c.JSON(http.StatusOK, resources)
	}
}
