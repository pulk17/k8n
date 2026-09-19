package handlers

import (
	"context"
	"time"

	"github.com/user/k8s-graph-controller/backend/internal/k8s"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// Startup is where a pod that is not ready yet has got to. Kubernetes never
// reports how far an image download is, but it does say which stage a pod is
// in and when that stage began — enough to tell "slow" from "stuck".
type Startup struct {
	Step  int    `json:"step"` // 1..StartupSteps
	Label string `json:"label"`
	Since string `json:"since,omitempty"` // RFC3339; the page counts up from it
}

// StartupSteps: find a node, download the image, start it, pass the health check.
const StartupSteps = 4

// startupOf returns nil for a pod that is not starting: ready, finished,
// failed, or being deleted. lastEvent is the most recent event about the pod.
func startupOf(p *corev1.Pod, status string, lastEvent *corev1.Event) *Startup {
	if p.DeletionTimestamp != nil || (status != "Pending" && status != "NotReady") {
		return nil
	}
	created := formatTime(p.CreationTimestamp.Time)

	if p.Spec.NodeName == "" {
		return &Startup{Step: 1, Label: "Waiting for a node with room for it", Since: created}
	}
	if lastEvent != nil && lastEvent.Reason == "Pulling" {
		return &Startup{Step: 2, Label: "Downloading the image", Since: formatTime(eventTime(lastEvent))}
	}
	for _, cs := range p.Status.ContainerStatuses {
		if cs.State.Running != nil && !cs.Ready {
			return &Startup{Step: 4, Label: "Started; waiting for its health check", Since: formatTime(cs.State.Running.StartedAt.Time)}
		}
	}
	since := created
	if lastEvent != nil {
		since = formatTime(eventTime(lastEvent))
	}
	return &Startup{Step: 3, Label: "Starting the container", Since: since}
}

// shareStartup gives each workload the progress of its least-advanced starting
// pod. The canvas draws the Deployment, not its pods, so without this the card
// someone is watching would still just say NotReady.
func shareStartup(resources []Resource) {
	byOwner := map[string]*Startup{}
	note := func(ns string, owners []string, s *Startup) {
		for _, o := range owners {
			key := ns + "/" + o
			if prev, ok := byOwner[key]; !ok || s.Step < prev.Step {
				byOwner[key] = s
			}
		}
	}
	for _, r := range resources {
		if r.Kind == "Pod" && r.Startup != nil {
			note(r.Namespace, r.OwnerReferences, r.Startup)
		}
	}
	// Pod -> ReplicaSet -> Deployment: one more hop up.
	for _, r := range resources {
		if s := byOwner[r.Namespace+"/"+r.Name]; r.Kind == "ReplicaSet" && s != nil {
			note(r.Namespace, r.OwnerReferences, s)
		}
	}
	for i, r := range resources {
		switch r.Kind {
		case "Deployment", "StatefulSet", "DaemonSet", "ReplicaSet", "Job":
			resources[i].Startup = byOwner[r.Namespace+"/"+r.Name]
		}
	}
}

// eventTime is when an event last happened. Newer kubelets fill EventTime and
// leave the older timestamp fields empty, so both have to be read.
func eventTime(e *corev1.Event) time.Time {
	switch {
	case !e.LastTimestamp.IsZero():
		return e.LastTimestamp.Time
	case !e.EventTime.IsZero():
		return e.EventTime.Time
	default:
		return e.FirstTimestamp.Time
	}
}

// latestPodEvents maps namespace/name to the newest event for each pod. It is
// only called when some pod is starting, so a settled cluster pays nothing.
func latestPodEvents(ctx context.Context, client *k8s.Client, namespace string) map[string]*corev1.Event {
	list, err := client.Clientset.CoreV1().Events(namespace).List(ctx, metav1.ListOptions{
		FieldSelector: "involvedObject.kind=Pod",
	})
	latest := map[string]*corev1.Event{}
	if err != nil {
		return latest // the bar just loses its download step; not worth failing the list
	}
	for i := range list.Items {
		e := &list.Items[i]
		key := e.InvolvedObject.Namespace + "/" + e.InvolvedObject.Name
		if prev, ok := latest[key]; !ok || newer(e, prev) {
			latest[key] = e
		}
	}
	return latest
}

// lifecycle orders the kubelet's start-up events. Timestamps only have
// one-second resolution and "Scheduled" and "Pulling" routinely share a second,
// so a tie is broken by which one has to come later.
var lifecycle = map[string]int{"Scheduled": 1, "Pulling": 2, "Pulled": 3, "Created": 4, "Started": 5}

func newer(a, b *corev1.Event) bool {
	ta, tb := eventTime(a), eventTime(b)
	if !ta.Equal(tb) {
		return ta.After(tb)
	}
	return lifecycle[a.Reason] > lifecycle[b.Reason]
}
