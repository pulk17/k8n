package handlers

import (
	"testing"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestStartupStages(t *testing.T) {
	unscheduled := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{CreationTimestamp: metav1.Now()}}
	scheduled := &corev1.Pod{Spec: corev1.PodSpec{NodeName: "n1"}}
	warming := &corev1.Pod{
		Spec: corev1.PodSpec{NodeName: "n1"},
		Status: corev1.PodStatus{ContainerStatuses: []corev1.ContainerStatus{{
			State: corev1.ContainerState{Running: &corev1.ContainerStateRunning{StartedAt: metav1.Now()}},
		}}},
	}
	pulling := &corev1.Event{Reason: "Pulling", EventTime: metav1.NowMicro()}
	pulled := &corev1.Event{Reason: "Pulled", EventTime: metav1.NowMicro()}

	cases := []struct {
		name   string
		pod    *corev1.Pod
		status string
		event  *corev1.Event
		step   int
	}{
		{"no node yet", unscheduled, "Pending", nil, 1},
		{"downloading", scheduled, "Pending", pulling, 2},
		{"image ready", scheduled, "Pending", pulled, 3},
		{"health check", warming, "NotReady", nil, 4},
		{"ready pod", warming, "Running", nil, 0},
		{"broken pod", scheduled, "Error", pulling, 0},
	}
	for _, c := range cases {
		got := startupOf(c.pod, c.status, c.event)
		step := 0
		if got != nil {
			step = got.Step
			if got.Since == "" {
				t.Errorf("%s: no start time", c.name)
			}
		}
		if step != c.step {
			t.Errorf("%s: step %d, want %d", c.name, step, c.step)
		}
	}
}

func TestSameSecondEventsFollowTheLifecycle(t *testing.T) {
	at := metav1.Now()
	scheduled := &corev1.Event{Reason: "Scheduled", LastTimestamp: at}
	pulling := &corev1.Event{Reason: "Pulling", LastTimestamp: at}
	if !newer(pulling, scheduled) || newer(scheduled, pulling) {
		t.Error("Pulling in the same second as Scheduled should count as the latest")
	}
}

func TestStartupReachesTheDeployment(t *testing.T) {
	s := &Startup{Step: 2, Label: "Downloading the image"}
	resources := []Resource{
		{Kind: "Pod", Name: "web-abc-1", Namespace: "d", OwnerReferences: []string{"web-abc"}, Startup: s},
		{Kind: "ReplicaSet", Name: "web-abc", Namespace: "d", OwnerReferences: []string{"web"}},
		{Kind: "Deployment", Name: "web", Namespace: "d"},
		{Kind: "Service", Name: "web", Namespace: "d"},
	}
	shareStartup(resources)
	if resources[2].Startup != s {
		t.Error("the Deployment did not get its pod's progress")
	}
	if resources[3].Startup != nil {
		t.Error("a Service with the same name picked up progress")
	}
}

func TestTheWatchSlowsDownWhenNothingHappens(t *testing.T) {
	// Quiet ticks double the wait, up to the cap; one change puts it straight
	// back to reading often.
	d := watchInterval
	for i := 0; i < 10; i++ {
		d = nextInterval(d, false)
	}
	if d != watchIdleMax {
		t.Errorf("idle interval = %v, want %v", d, watchIdleMax)
	}
	if got := nextInterval(d, true); got != watchInterval {
		t.Errorf("after a change = %v, want %v", got, watchInterval)
	}
}
