package handlers

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/user/k8s-graph-controller/backend/internal/k8s"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// Finding is one concrete problem detected in a namespace.
type Finding struct {
	Severity string `json:"severity"` // "critical" | "warning" | "info"
	Kind     string `json:"kind"`
	Name     string `json:"name"`
	Reason   string `json:"reason"`
	Detail   string `json:"detail"`
	Hint     string `json:"hint,omitempty"`
}

// DiagnosisReport is the structured bundle handed to the UI and, when the AI
// layer is enabled, to the model.
type DiagnosisReport struct {
	Namespace string         `json:"namespace"`
	Findings  []Finding      `json:"findings"`
	Events    []EventSummary `json:"events,omitempty"`
	Checked   int            `json:"checked"`
}

// Diagnose runs deterministic checks over a namespace.
//
// These run before any model is consulted, so the common failures are reported
// as facts rather than left for an LLM to infer from raw text. The model's job
// is explanation and remediation, not detection.
func Diagnose(ctx context.Context, client *k8s.Client, namespace string) (*DiagnosisReport, error) {
	report := &DiagnosisReport{Namespace: namespace}

	pods, err := client.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	report.Checked = len(pods.Items)

	for _, pod := range pods.Items {
		for _, cs := range pod.Status.ContainerStatuses {
			// Waiting states carry the most actionable reasons.
			if w := cs.State.Waiting; w != nil {
				switch w.Reason {
				case "CrashLoopBackOff":
					report.Findings = append(report.Findings, Finding{
						Severity: "critical", Kind: "Pod", Name: pod.Name,
						Reason: w.Reason,
						Detail: fmt.Sprintf("Container %q keeps exiting and restarting (%d restarts).", cs.Name, cs.RestartCount),
						Hint:   "Check the previous container's logs — the process is failing on startup.",
					})
				case "ImagePullBackOff", "ErrImagePull":
					report.Findings = append(report.Findings, Finding{
						Severity: "critical", Kind: "Pod", Name: pod.Name,
						Reason: w.Reason,
						Detail: fmt.Sprintf("Cannot pull image %q for container %q. %s", cs.Image, cs.Name, w.Message),
						Hint:   "Verify the image name and tag, and whether the registry needs an imagePullSecret.",
					})
				case "CreateContainerConfigError":
					report.Findings = append(report.Findings, Finding{
						Severity: "critical", Kind: "Pod", Name: pod.Name,
						Reason: w.Reason,
						Detail: fmt.Sprintf("Container %q cannot start: %s", cs.Name, w.Message),
						Hint:   "Usually a ConfigMap or Secret referenced by the pod does not exist yet.",
					})
				}
			}

			// OOMKills show up on the last terminated state, and are easy to miss
			// because the pod may look Running afterwards.
			if t := cs.LastTerminationState.Terminated; t != nil && t.Reason == "OOMKilled" {
				report.Findings = append(report.Findings, Finding{
					Severity: "critical", Kind: "Pod", Name: pod.Name,
					Reason: "OOMKilled",
					Detail: fmt.Sprintf("Container %q was killed for exceeding its memory limit.", cs.Name),
					Hint:   "Raise the memory limit, or reduce the workload's memory use.",
				})
			}
		}

		if pod.Status.Phase == "Pending" {
			for _, cond := range pod.Status.Conditions {
				if cond.Type == "PodScheduled" && cond.Status == "False" {
					report.Findings = append(report.Findings, Finding{
						Severity: "critical", Kind: "Pod", Name: pod.Name,
						Reason: "Unschedulable",
						Detail: cond.Message,
						Hint:   "No node satisfies the pod's resource requests, affinity or tolerations.",
					})
				}
			}
		}

		// A readiness probe that never passes keeps a pod out of every Service.
		for _, cond := range pod.Status.Conditions {
			if cond.Type == "Ready" && cond.Status == "False" && pod.Status.Phase == "Running" && cond.Reason != "" {
				report.Findings = append(report.Findings, Finding{
					Severity: "warning", Kind: "Pod", Name: pod.Name,
					Reason: "NotReady",
					Detail: strings.TrimSpace(cond.Reason + ": " + cond.Message),
					Hint:   "While a pod is not ready it receives no Service traffic.",
				})
			}
		}
	}

	// Services whose selector matches nothing. This is precisely the failure the
	// old compiler produced on every generated Service, and it is invisible in
	// the dashboard because the Service itself looks healthy.
	services, err := client.Clientset.CoreV1().Services(namespace).List(ctx, metav1.ListOptions{})
	if err == nil {
		for _, svc := range services.Items {
			if len(svc.Spec.Selector) == 0 {
				continue // headless or externally managed endpoints
			}
			matched := 0
			for _, pod := range pods.Items {
				if labelsMatch(svc.Spec.Selector, pod.Labels) {
					matched++
				}
			}
			if matched == 0 {
				report.Findings = append(report.Findings, Finding{
					Severity: "critical", Kind: "Service", Name: svc.Name,
					Reason: "NoEndpoints",
					Detail: fmt.Sprintf("Selector %v matches no pods, so this Service routes nowhere.", svc.Spec.Selector),
					Hint:   "The selector must equal the labels on the workload's pod template.",
				})
			}
		}
	}

	// Unbound PVCs block their pods from ever starting.
	pvcs, err := client.Clientset.CoreV1().PersistentVolumeClaims(namespace).List(ctx, metav1.ListOptions{})
	if err == nil {
		for _, pvc := range pvcs.Items {
			if pvc.Status.Phase != "Bound" {
				report.Findings = append(report.Findings, Finding{
					Severity: "warning", Kind: "PersistentVolumeClaim", Name: pvc.Name,
					Reason: string(pvc.Status.Phase),
					Detail: "The claim is not bound to a volume.",
					Hint:   "Check that a StorageClass exists and can provision this claim.",
				})
			}
		}
	}

	// Deployments that never reached their desired replica count.
	deps, err := client.Clientset.AppsV1().Deployments(namespace).List(ctx, metav1.ListOptions{})
	if err == nil {
		for _, d := range deps.Items {
			desired := int32(1)
			if d.Spec.Replicas != nil {
				desired = *d.Spec.Replicas
			}
			if desired > 0 && d.Status.ReadyReplicas < desired {
				report.Findings = append(report.Findings, Finding{
					Severity: "warning", Kind: "Deployment", Name: d.Name,
					Reason: "NotFullyAvailable",
					Detail: fmt.Sprintf("%d of %d replicas are ready.", d.Status.ReadyReplicas, desired),
				})
			}
		}
	}

	// Warning events add the context the object statuses leave out.
	events, err := FetchEvents(ctx, client, namespace, "", 25)
	if err == nil {
		for _, e := range events {
			if e.Type == "Warning" {
				report.Events = append(report.Events, e)
			}
		}
	}

	if report.Findings == nil {
		report.Findings = []Finding{}
	}
	return report, nil
}

func labelsMatch(selector, labels map[string]string) bool {
	if len(selector) == 0 || labels == nil {
		return false
	}
	for k, v := range selector {
		if labels[k] != v {
			return false
		}
	}
	return true
}

// GetDiagnosis serves GET /api/diagnose/:namespace.
func GetDiagnosis(clientGetter func() *k8s.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		client := clientGetter()
		if !requireCluster(c, client) {
			return
		}

		ctx, cancel := context.WithTimeout(c.Request.Context(), 20*time.Second)
		defer cancel()

		report, err := Diagnose(ctx, client, c.Param("namespace"))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Diagnosis failed", "details": err.Error()})
			return
		}
		c.JSON(http.StatusOK, report)
	}
}
