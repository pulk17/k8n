package handlers

import (
	"context"
	"fmt"
	"net/http"
	"sort"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/user/k8s-graph-controller/backend/internal/k8s"
	corev1 "k8s.io/api/core/v1"
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

	// Protected marks cluster machinery. The frontend used to keep its own copy
	// of this list; now it just reads the flag.
	Protected bool `json:"protected"`

	// Deployment/StatefulSet specific
	Replicas      *int32 `json:"replicas,omitempty"`
	ReadyReplicas int32  `json:"readyReplicas,omitempty"`
	Image         string `json:"image,omitempty"`

	// Service specific
	ServiceType string   `json:"serviceType,omitempty"`
	ClusterIP   string   `json:"clusterIP,omitempty"`
	ExternalIP  string   `json:"externalIP,omitempty"`
	Ports       []string `json:"ports,omitempty"`

	// Pod specific
	PodIP        string `json:"podIP,omitempty"`
	NodeName     string `json:"nodeName,omitempty"`
	RestartCount int32  `json:"restartCount,omitempty"`

	// ConfigMap/Secret specific
	DataKeys []string `json:"dataKeys,omitempty"`

	// Containers carries the real container names, which a partial apply needs
	// as the merge key when patching an imported workload's image.
	Containers []ContainerSummary `json:"containers,omitempty"`

	// References extracted from the live object. The canvas draws edges from
	// these instead of guessing from names or connecting everything in a
	// namespace to everything else.
	ConfigMapRefs      []string `json:"configMapRefs,omitempty"`
	SecretRefs         []string `json:"secretRefs,omitempty"`
	PVCRefs            []string `json:"pvcRefs,omitempty"`
	ServiceAccountName string   `json:"serviceAccountName,omitempty"`

	// Ingress specific
	Backends []string `json:"backends,omitempty"`
	Hosts    []string `json:"hosts,omitempty"`

	// HPA specific
	ScaleTargetKind string `json:"scaleTargetKind,omitempty"`
	ScaleTargetName string `json:"scaleTargetName,omitempty"`
	MinReplicas     *int32 `json:"minReplicas,omitempty"`
	MaxReplicas     int32  `json:"maxReplicas,omitempty"`

	// PVC specific
	StorageSize string `json:"storageSize,omitempty"`
	AccessMode  string `json:"accessMode,omitempty"`
}

// ContainerSummary is the subset of a container the canvas needs.
type ContainerSummary struct {
	Name  string `json:"name"`
	Image string `json:"image"`
}

// podSpecRefs pulls every ConfigMap, Secret and PVC a pod spec depends on, from
// envFrom, env valueFrom and volumes.
func podSpecRefs(spec *corev1.PodSpec) (configMaps, secrets, pvcs []string) {
	seenCM, seenSec, seenPVC := map[string]bool{}, map[string]bool{}, map[string]bool{}

	addCM := func(name string) {
		if name != "" && !seenCM[name] {
			seenCM[name] = true
			configMaps = append(configMaps, name)
		}
	}
	addSec := func(name string) {
		if name != "" && !seenSec[name] {
			seenSec[name] = true
			secrets = append(secrets, name)
		}
	}

	containers := append([]corev1.Container{}, spec.Containers...)
	containers = append(containers, spec.InitContainers...)
	for _, ctr := range containers {
		for _, ef := range ctr.EnvFrom {
			if ef.ConfigMapRef != nil {
				addCM(ef.ConfigMapRef.Name)
			}
			if ef.SecretRef != nil {
				addSec(ef.SecretRef.Name)
			}
		}
		for _, env := range ctr.Env {
			if env.ValueFrom == nil {
				continue
			}
			if env.ValueFrom.ConfigMapKeyRef != nil {
				addCM(env.ValueFrom.ConfigMapKeyRef.Name)
			}
			if env.ValueFrom.SecretKeyRef != nil {
				addSec(env.ValueFrom.SecretKeyRef.Name)
			}
		}
	}

	for _, vol := range spec.Volumes {
		if vol.ConfigMap != nil {
			addCM(vol.ConfigMap.Name)
		}
		if vol.Secret != nil {
			addSec(vol.Secret.SecretName)
		}
		if vol.PersistentVolumeClaim != nil {
			name := vol.PersistentVolumeClaim.ClaimName
			if name != "" && !seenPVC[name] {
				seenPVC[name] = true
				pvcs = append(pvcs, name)
			}
		}
	}

	return configMaps, secrets, pvcs
}

// containerSummaries flattens a container list for the canvas.
func containerSummaries(containers []corev1.Container) []ContainerSummary {
	out := make([]ContainerSummary, 0, len(containers))
	for _, ctr := range containers {
		out = append(out, ContainerSummary{Name: ctr.Name, Image: ctr.Image})
	}
	return out
}

// GetClusterResources fetches all resource types concurrently with a timeout.
func GetClusterResources(clientGetter func() *k8s.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		client := clientGetter()
		if !requireCluster(c, client) {
			return
		}

		// 15-second timeout prevents the handler from hanging indefinitely
		ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
		defer cancel()

		resources, err := CollectResources(ctx, client, c.Query("namespace"))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list resources", "details": err.Error()})
			return
		}
		if resources == nil {
			resources = []Resource{}
		}
		c.JSON(http.StatusOK, resources)
	}
}

// CollectResources gathers every resource type concurrently. It is shared by the
// REST handler and the MCP tool so both see exactly the same view of a cluster.
// An empty namespace means all namespaces.
func CollectResources(ctx context.Context, client *k8s.Client, namespace string) ([]Resource, error) {
	var (
		mu        sync.Mutex
		resources []Resource
		wg        sync.WaitGroup
	)

	// appendResources is a thread-safe helper to add resources
	appendResources := func(items []Resource) {
		mu.Lock()
		resources = append(resources, items...)
		mu.Unlock()
	}

	// --- Fetch Pods ---
	wg.Add(1)
	go func() {
		defer wg.Done()
		pods, err := client.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})
		if err != nil {
			fmt.Printf("[resources] failed to list Pods: %v\n", err)
			return
		}
		var items []Resource
		for _, p := range pods.Items {
			status := "Unknown"
			statusMessage := ""
			phase := string(p.Status.Phase)

			var restartCount int32
			for _, cs := range p.Status.ContainerStatuses {
				restartCount += cs.RestartCount
			}

			image := ""
			if len(p.Spec.Containers) > 0 {
				image = p.Spec.Containers[0].Image
			}

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
						for _, cond := range p.Status.Conditions {
							if cond.Status == "False" {
								statusMessage = cond.Reason + ": " + cond.Message
								break
							}
						}
					}
				}
			} else if phase == "Succeeded" {
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

			cmRefs, secRefs, pvcRefs := podSpecRefs(&p.Spec)

			items = append(items, Resource{
				Kind:               "Pod",
				Name:               p.Name,
				Namespace:          p.Namespace,
				Labels:             p.Labels,
				Annotations:        p.Annotations,
				Status:             status,
				StatusMessage:      statusMessage,
				UID:                string(p.UID),
				OwnerReferences:    owners,
				CreatedAt:          p.CreationTimestamp.Format("2006-01-02 15:04:05"),
				PodIP:              p.Status.PodIP,
				NodeName:           p.Spec.NodeName,
				RestartCount:       restartCount,
				Image:              image,
				Containers:         containerSummaries(p.Spec.Containers),
				ConfigMapRefs:      cmRefs,
				SecretRefs:         secRefs,
				PVCRefs:            pvcRefs,
				ServiceAccountName: p.Spec.ServiceAccountName,
			})
		}
		appendResources(items)
	}()

	// --- Fetch Deployments ---
	wg.Add(1)
	go func() {
		defer wg.Done()
		deps, err := client.Clientset.AppsV1().Deployments(namespace).List(ctx, metav1.ListOptions{})
		if err != nil {
			fmt.Printf("[resources] failed to list Deployments: %v\n", err)
			return
		}
		var items []Resource
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

			image := ""
			if len(d.Spec.Template.Spec.Containers) > 0 {
				image = d.Spec.Template.Spec.Containers[0].Image
			}

			cmRefs, secRefs, pvcRefs := podSpecRefs(&d.Spec.Template.Spec)

			items = append(items, Resource{
				Kind:               "Deployment",
				Name:               d.Name,
				Namespace:          d.Namespace,
				Labels:             d.Labels,
				Annotations:        d.Annotations,
				Status:             status,
				UID:                string(d.UID),
				Selector:           selector,
				CreatedAt:          d.CreationTimestamp.Format("2006-01-02 15:04:05"),
				Replicas:           d.Spec.Replicas,
				ReadyReplicas:      d.Status.ReadyReplicas,
				Image:              image,
				Containers:         containerSummaries(d.Spec.Template.Spec.Containers),
				ConfigMapRefs:      cmRefs,
				SecretRefs:         secRefs,
				PVCRefs:            pvcRefs,
				ServiceAccountName: d.Spec.Template.Spec.ServiceAccountName,
			})
		}
		appendResources(items)
	}()

	// --- Fetch ReplicaSets ---
	wg.Add(1)
	go func() {
		defer wg.Done()
		rss, err := client.Clientset.AppsV1().ReplicaSets(namespace).List(ctx, metav1.ListOptions{})
		if err != nil {
			fmt.Printf("[resources] failed to list ReplicaSets: %v\n", err)
			return
		}
		var items []Resource
		for _, rs := range rss.Items {
			var owners []string
			for _, o := range rs.OwnerReferences {
				owners = append(owners, o.Name)
			}
			items = append(items, Resource{
				Kind:            "ReplicaSet",
				Name:            rs.Name,
				Namespace:       rs.Namespace,
				Labels:          rs.Labels,
				Status:          "Active",
				UID:             string(rs.UID),
				OwnerReferences: owners,
			})
		}
		appendResources(items)
	}()

	// --- Fetch Services ---
	wg.Add(1)
	go func() {
		defer wg.Done()
		svcs, err := client.Clientset.CoreV1().Services(namespace).List(ctx, metav1.ListOptions{})
		if err != nil {
			fmt.Printf("[resources] failed to list Services: %v\n", err)
			return
		}
		var items []Resource
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

			items = append(items, Resource{
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
		appendResources(items)
	}()

	// --- Fetch ConfigMaps ---
	wg.Add(1)
	go func() {
		defer wg.Done()
		cms, err := client.Clientset.CoreV1().ConfigMaps(namespace).List(ctx, metav1.ListOptions{})
		if err != nil {
			fmt.Printf("[resources] failed to list ConfigMaps: %v\n", err)
			return
		}
		var items []Resource
		for _, cm := range cms.Items {
			var dataKeys []string
			for k := range cm.Data {
				dataKeys = append(dataKeys, k)
			}

			items = append(items, Resource{
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
		appendResources(items)
	}()

	// --- Fetch DaemonSets ---
	wg.Add(1)
	go func() {
		defer wg.Done()
		dss, err := client.Clientset.AppsV1().DaemonSets(namespace).List(ctx, metav1.ListOptions{})
		if err != nil {
			fmt.Printf("[resources] failed to list DaemonSets: %v\n", err)
			return
		}
		var items []Resource
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

			image := ""
			if len(ds.Spec.Template.Spec.Containers) > 0 {
				image = ds.Spec.Template.Spec.Containers[0].Image
			}

			cmRefs, secRefs, pvcRefs := podSpecRefs(&ds.Spec.Template.Spec)
			desired := ds.Status.DesiredNumberScheduled

			items = append(items, Resource{
				Kind:               "DaemonSet",
				Name:               ds.Name,
				Namespace:          ds.Namespace,
				Labels:             ds.Labels,
				Annotations:        ds.Annotations,
				Status:             status,
				UID:                string(ds.UID),
				Selector:           selector,
				CreatedAt:          ds.CreationTimestamp.Format("2006-01-02 15:04:05"),
				Replicas:           &desired,
				ReadyReplicas:      ds.Status.NumberReady,
				Image:              image,
				Containers:         containerSummaries(ds.Spec.Template.Spec.Containers),
				ConfigMapRefs:      cmRefs,
				SecretRefs:         secRefs,
				PVCRefs:            pvcRefs,
				ServiceAccountName: ds.Spec.Template.Spec.ServiceAccountName,
			})
		}
		appendResources(items)
	}()

	// --- Fetch StatefulSets ---
	wg.Add(1)
	go func() {
		defer wg.Done()
		stss, err := client.Clientset.AppsV1().StatefulSets(namespace).List(ctx, metav1.ListOptions{})
		if err != nil {
			fmt.Printf("[resources] failed to list StatefulSets: %v\n", err)
			return
		}
		var items []Resource
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

			image := ""
			if len(sts.Spec.Template.Spec.Containers) > 0 {
				image = sts.Spec.Template.Spec.Containers[0].Image
			}

			cmRefs, secRefs, pvcRefs := podSpecRefs(&sts.Spec.Template.Spec)

			items = append(items, Resource{
				Kind:               "StatefulSet",
				Name:               sts.Name,
				Namespace:          sts.Namespace,
				Labels:             sts.Labels,
				Annotations:        sts.Annotations,
				Status:             status,
				UID:                string(sts.UID),
				Selector:           selector,
				CreatedAt:          sts.CreationTimestamp.Format("2006-01-02 15:04:05"),
				Replicas:           sts.Spec.Replicas,
				ReadyReplicas:      sts.Status.ReadyReplicas,
				Image:              image,
				Containers:         containerSummaries(sts.Spec.Template.Spec.Containers),
				ConfigMapRefs:      cmRefs,
				SecretRefs:         secRefs,
				PVCRefs:            pvcRefs,
				ServiceAccountName: sts.Spec.Template.Spec.ServiceAccountName,
			})
		}
		appendResources(items)
	}()

	// --- Fetch Secrets ---
	wg.Add(1)
	go func() {
		defer wg.Done()
		secrets, err := client.Clientset.CoreV1().Secrets(namespace).List(ctx, metav1.ListOptions{})
		if err != nil {
			fmt.Printf("[resources] failed to list Secrets: %v\n", err)
			return
		}
		var items []Resource
		for _, secret := range secrets.Items {
			var dataKeys []string
			for k := range secret.Data {
				dataKeys = append(dataKeys, k)
			}

			items = append(items, Resource{
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
		appendResources(items)
	}()

	// --- Fetch Ingresses ---
	wg.Add(1)
	go func() {
		defer wg.Done()
		ingresses, err := client.Clientset.NetworkingV1().Ingresses(namespace).List(ctx, metav1.ListOptions{})
		if err != nil {
			fmt.Printf("[resources] failed to list Ingresses: %v\n", err)
			return
		}
		var items []Resource
		for _, ing := range ingresses.Items {
			// The actual backend services, so the canvas can draw the real
			// Ingress→Service edge instead of connecting every Ingress to
			// every Service in the namespace.
			var backends, hosts []string
			seenBackend := map[string]bool{}
			for _, rule := range ing.Spec.Rules {
				if rule.Host != "" {
					hosts = append(hosts, rule.Host)
				}
				if rule.HTTP == nil {
					continue
				}
				for _, path := range rule.HTTP.Paths {
					if path.Backend.Service == nil {
						continue
					}
					name := path.Backend.Service.Name
					if name != "" && !seenBackend[name] {
						seenBackend[name] = true
						backends = append(backends, name)
					}
				}
			}
			if ing.Spec.DefaultBackend != nil && ing.Spec.DefaultBackend.Service != nil {
				if name := ing.Spec.DefaultBackend.Service.Name; name != "" && !seenBackend[name] {
					seenBackend[name] = true
					backends = append(backends, name)
				}
			}

			items = append(items, Resource{
				Kind:        "Ingress",
				Name:        ing.Name,
				Namespace:   ing.Namespace,
				Labels:      ing.Labels,
				Annotations: ing.Annotations,
				Status:      "Active",
				UID:         string(ing.UID),
				CreatedAt:   ing.CreationTimestamp.Format("2006-01-02 15:04:05"),
				Backends:    backends,
				Hosts:       hosts,
			})
		}
		appendResources(items)
	}()

	// --- Fetch PersistentVolumeClaims ---
	wg.Add(1)
	go func() {
		defer wg.Done()
		pvcs, err := client.Clientset.CoreV1().PersistentVolumeClaims(namespace).List(ctx, metav1.ListOptions{})
		if err != nil {
			fmt.Printf("[resources] failed to list PersistentVolumeClaims: %v\n", err)
			return
		}
		var items []Resource
		for _, pvc := range pvcs.Items {
			accessMode := ""
			if len(pvc.Spec.AccessModes) > 0 {
				accessMode = string(pvc.Spec.AccessModes[0])
			}
			storage := ""
			if q, ok := pvc.Spec.Resources.Requests[corev1.ResourceStorage]; ok {
				storage = q.String()
			}

			items = append(items, Resource{
				Kind:        "PersistentVolumeClaim",
				Name:        pvc.Name,
				Namespace:   pvc.Namespace,
				Labels:      pvc.Labels,
				Annotations: pvc.Annotations,
				Status:      string(pvc.Status.Phase),
				UID:         string(pvc.UID),
				CreatedAt:   pvc.CreationTimestamp.Format("2006-01-02 15:04:05"),
				StorageSize: storage,
				AccessMode:  accessMode,
			})
		}
		appendResources(items)
	}()

	// --- Fetch HorizontalPodAutoscalers ---
	wg.Add(1)
	go func() {
		defer wg.Done()
		hpas, err := client.Clientset.AutoscalingV2().HorizontalPodAutoscalers(namespace).List(ctx, metav1.ListOptions{})
		if err != nil {
			fmt.Printf("[resources] failed to list HorizontalPodAutoscalers: %v\n", err)
			return
		}
		var items []Resource
		for _, hpa := range hpas.Items {
			status := "Active"
			if hpa.Status.CurrentReplicas < hpa.Status.DesiredReplicas {
				status = "Pending"
			}

			items = append(items, Resource{
				Kind:            "HorizontalPodAutoscaler",
				Name:            hpa.Name,
				Namespace:       hpa.Namespace,
				Labels:          hpa.Labels,
				Annotations:     hpa.Annotations,
				Status:          status,
				UID:             string(hpa.UID),
				CreatedAt:       hpa.CreationTimestamp.Format("2006-01-02 15:04:05"),
				ScaleTargetKind: hpa.Spec.ScaleTargetRef.Kind,
				ScaleTargetName: hpa.Spec.ScaleTargetRef.Name,
				MinReplicas:     hpa.Spec.MinReplicas,
				MaxReplicas:     hpa.Spec.MaxReplicas,
			})
		}
		appendResources(items)
	}()

	// --- Fetch ServiceAccounts ---
	wg.Add(1)
	go func() {
		defer wg.Done()
		sas, err := client.Clientset.CoreV1().ServiceAccounts(namespace).List(ctx, metav1.ListOptions{})
		if err != nil {
			fmt.Printf("[resources] failed to list ServiceAccounts: %v\n", err)
			return
		}
		var items []Resource
		for _, sa := range sas.Items {
			items = append(items, Resource{
				Kind:        "ServiceAccount",
				Name:        sa.Name,
				Namespace:   sa.Namespace,
				Labels:      sa.Labels,
				Annotations: sa.Annotations,
				Status:      "Active",
				UID:         string(sa.UID),
				CreatedAt:   sa.CreationTimestamp.Format("2006-01-02 15:04:05"),
			})
		}
		appendResources(items)
	}()

	// --- Fetch Jobs ---
	wg.Add(1)
	go func() {
		defer wg.Done()
		jobs, err := client.Clientset.BatchV1().Jobs(namespace).List(ctx, metav1.ListOptions{})
		if err != nil {
			fmt.Printf("[resources] failed to list Jobs: %v\n", err)
			return
		}
		var items []Resource
		for _, job := range jobs.Items {
			status := "Active"
			if job.Status.Succeeded > 0 {
				status = "Completed"
			} else if job.Status.Failed > 0 {
				status = "Failed"
			}

			items = append(items, Resource{
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
		appendResources(items)
	}()

	// --- Fetch CronJobs ---
	wg.Add(1)
	go func() {
		defer wg.Done()
		cronJobs, err := client.Clientset.BatchV1().CronJobs(namespace).List(ctx, metav1.ListOptions{})
		if err != nil {
			fmt.Printf("[resources] failed to list CronJobs: %v\n", err)
			return
		}
		var items []Resource
		for _, cj := range cronJobs.Items {
			items = append(items, Resource{
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
		appendResources(items)
	}()

	// Wait for all goroutines to complete (or timeout via ctx)
	wg.Wait()

	for i := range resources {
		resources[i].Protected = IsProtected(resources[i].Name, resources[i].Namespace)
	}

	// The fetchers run concurrently, so without this the order changes between
	// requests and the resource list reshuffles on every refresh.
	sort.Slice(resources, func(i, j int) bool {
		a, b := resources[i], resources[j]
		if a.Kind != b.Kind {
			return a.Kind < b.Kind
		}
		if a.Namespace != b.Namespace {
			return a.Namespace < b.Namespace
		}
		return a.Name < b.Name
	})

	return resources, nil
}

// GetNamespaces lists the cluster's namespaces. The canvas used to derive its
// namespace dropdown from whatever resources came back, so empty namespaces
// never appeared and a hand-built graph had nothing to choose from.
func GetNamespaces(clientGetter func() *k8s.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		client := clientGetter()
		if !requireCluster(c, client) {
			return
		}

		ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
		defer cancel()

		list, err := client.Clientset.CoreV1().Namespaces().List(ctx, metav1.ListOptions{})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list namespaces", "details": err.Error()})
			return
		}

		names := make([]string, 0, len(list.Items))
		for _, ns := range list.Items {
			names = append(names, ns.Name)
		}
		sort.Strings(names)

		c.JSON(http.StatusOK, names)
	}
}
