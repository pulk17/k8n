package handlers

import (
	"context"
	"fmt"

	"github.com/user/k8s-graph-controller/backend/internal/k8s"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// DeleteResource deletes a Kubernetes resource
func DeleteResource(client *k8s.Client, kind, name, namespace string, force bool) error {
	if client == nil {
		return fmt.Errorf("k8s client not initialized")
	}

	ctx := context.Background()
	
	// Configure delete options
	deleteOptions := metav1.DeleteOptions{}
	if force {
		// Force delete: set grace period to 0 and propagation policy to background
		gracePeriod := int64(0)
		deleteOptions.GracePeriodSeconds = &gracePeriod
		propagationPolicy := metav1.DeletePropagationBackground
		deleteOptions.PropagationPolicy = &propagationPolicy
	}

	switch kind {
	case "Deployment":
		return client.Clientset.AppsV1().Deployments(namespace).Delete(ctx, name, deleteOptions)
	case "Service":
		return client.Clientset.CoreV1().Services(namespace).Delete(ctx, name, deleteOptions)
	case "ConfigMap":
		return client.Clientset.CoreV1().ConfigMaps(namespace).Delete(ctx, name, deleteOptions)
	case "Secret":
		return client.Clientset.CoreV1().Secrets(namespace).Delete(ctx, name, deleteOptions)
	case "Pod":
		return client.Clientset.CoreV1().Pods(namespace).Delete(ctx, name, deleteOptions)
	case "StatefulSet":
		return client.Clientset.AppsV1().StatefulSets(namespace).Delete(ctx, name, deleteOptions)
	case "DaemonSet":
		return client.Clientset.AppsV1().DaemonSets(namespace).Delete(ctx, name, deleteOptions)
	case "Job":
		return client.Clientset.BatchV1().Jobs(namespace).Delete(ctx, name, deleteOptions)
	case "CronJob":
		return client.Clientset.BatchV1().CronJobs(namespace).Delete(ctx, name, deleteOptions)
	case "Ingress":
		return client.Clientset.NetworkingV1().Ingresses(namespace).Delete(ctx, name, deleteOptions)
	case "ReplicaSet":
		return client.Clientset.AppsV1().ReplicaSets(namespace).Delete(ctx, name, deleteOptions)
	default:
		return fmt.Errorf("unsupported resource kind: %s", kind)
	}
}
