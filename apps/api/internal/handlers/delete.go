package handlers

import (
	"context"
	"fmt"

	"github.com/user/k8s-graph-controller/backend/internal/k8s"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// DeleteResource deletes a Kubernetes resource
func DeleteResource(client *k8s.Client, kind, name, namespace string) error {
	if client == nil {
		return fmt.Errorf("k8s client not initialized")
	}

	ctx := context.Background()

	switch kind {
	case "Deployment":
		return client.Clientset.AppsV1().Deployments(namespace).Delete(ctx, name, metav1.DeleteOptions{})
	case "Service":
		return client.Clientset.CoreV1().Services(namespace).Delete(ctx, name, metav1.DeleteOptions{})
	case "ConfigMap":
		return client.Clientset.CoreV1().ConfigMaps(namespace).Delete(ctx, name, metav1.DeleteOptions{})
	case "Secret":
		return client.Clientset.CoreV1().Secrets(namespace).Delete(ctx, name, metav1.DeleteOptions{})
	case "Pod":
		return client.Clientset.CoreV1().Pods(namespace).Delete(ctx, name, metav1.DeleteOptions{})
	case "StatefulSet":
		return client.Clientset.AppsV1().StatefulSets(namespace).Delete(ctx, name, metav1.DeleteOptions{})
	case "DaemonSet":
		return client.Clientset.AppsV1().DaemonSets(namespace).Delete(ctx, name, metav1.DeleteOptions{})
	case "Job":
		return client.Clientset.BatchV1().Jobs(namespace).Delete(ctx, name, metav1.DeleteOptions{})
	case "CronJob":
		return client.Clientset.BatchV1().CronJobs(namespace).Delete(ctx, name, metav1.DeleteOptions{})
	case "Ingress":
		return client.Clientset.NetworkingV1().Ingresses(namespace).Delete(ctx, name, metav1.DeleteOptions{})
	case "ReplicaSet":
		return client.Clientset.AppsV1().ReplicaSets(namespace).Delete(ctx, name, metav1.DeleteOptions{})
	default:
		return fmt.Errorf("unsupported resource kind: %s", kind)
	}
}
