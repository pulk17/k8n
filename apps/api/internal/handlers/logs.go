package handlers

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/user/k8s-graph-controller/backend/internal/k8s"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// LogOptions describes a log request.
type LogOptions struct {
	Namespace string
	Pod       string
	Container string
	TailLines int64
	Previous  bool
}

// FetchLogs reads a pod's logs. It is shared by the REST handler and the MCP
// tool so both behave identically.
func FetchLogs(ctx context.Context, client *k8s.Client, opts LogOptions) (string, error) {
	if opts.TailLines <= 0 {
		opts.TailLines = 200
	}
	// Logs are fed to an LLM and rendered in a panel; unbounded tails help
	// neither.
	if opts.TailLines > 2000 {
		opts.TailLines = 2000
	}

	podLogOpts := &corev1.PodLogOptions{
		Container: opts.Container,
		TailLines: &opts.TailLines,
		Previous:  opts.Previous,
	}

	req := client.Clientset.CoreV1().Pods(opts.Namespace).GetLogs(opts.Pod, podLogOpts)
	stream, err := req.Stream(ctx)
	if err != nil {
		return "", err
	}
	defer stream.Close()

	// Cap the read so a chatty pod cannot exhaust memory.
	const maxBytes = 256 * 1024
	data, err := io.ReadAll(io.LimitReader(stream, maxBytes))
	if err != nil {
		return "", err
	}

	return string(data), nil
}

// GetPodLogs serves GET /api/logs/:namespace/:pod.
func GetPodLogs(clientGetter func() *k8s.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		client := clientGetter()
		if !requireCluster(c, client) {
			return
		}

		tail, _ := strconv.ParseInt(c.DefaultQuery("tailLines", "200"), 10, 64)

		ctx, cancel := context.WithTimeout(c.Request.Context(), 20*time.Second)
		defer cancel()

		logs, err := FetchLogs(ctx, client, LogOptions{
			Namespace: c.Param("namespace"),
			Pod:       c.Param("pod"),
			Container: c.Query("container"),
			TailLines: tail,
			Previous:  c.Query("previous") == "true",
		})
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{
				"error":   "Failed to read logs",
				"details": err.Error(),
				"hint":    "The pod may not exist, or the container may not have started yet.",
			})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"pod":       c.Param("pod"),
			"namespace": c.Param("namespace"),
			"container": c.Query("container"),
			"logs":      logs,
		})
	}
}

// EventSummary is a trimmed Kubernetes event.
type EventSummary struct {
	Type      string `json:"type"`
	Reason    string `json:"reason"`
	Message   string `json:"message"`
	Object    string `json:"object"`
	Count     int32  `json:"count"`
	FirstSeen string `json:"firstSeen,omitempty"`
	LastSeen  string `json:"lastSeen,omitempty"`
}

// FetchEvents returns events for a namespace, optionally narrowed to one object.
// Events are the single most useful signal for "why is this broken", and k8n had
// no way to read them.
func FetchEvents(ctx context.Context, client *k8s.Client, namespace, objectName string, limit int) ([]EventSummary, error) {
	list, err := client.Clientset.CoreV1().Events(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	var out []EventSummary
	for _, e := range list.Items {
		if objectName != "" {
			// Match the object itself and anything it owns (pods of a deployment
			// are named <deployment>-<hash>-<id>).
			if e.InvolvedObject.Name != objectName && !strings.HasPrefix(e.InvolvedObject.Name, objectName+"-") {
				continue
			}
		}
		out = append(out, EventSummary{
			Type:      e.Type,
			Reason:    e.Reason,
			Message:   e.Message,
			Object:    fmt.Sprintf("%s/%s", e.InvolvedObject.Kind, e.InvolvedObject.Name),
			Count:     e.Count,
			FirstSeen: formatTime(e.FirstTimestamp.Time),
			LastSeen:  formatTime(e.LastTimestamp.Time),
		})
	}

	// Most recent first — that is what anyone debugging wants.
	sort.Slice(out, func(i, j int) bool { return out[i].LastSeen > out[j].LastSeen })

	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func formatTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format(time.RFC3339)
}

// GetEvents serves GET /api/events/:namespace.
func GetEvents(clientGetter func() *k8s.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		client := clientGetter()
		if !requireCluster(c, client) {
			return
		}

		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))

		ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
		defer cancel()

		events, err := FetchEvents(ctx, client, c.Param("namespace"), c.Query("object"), limit)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list events", "details": err.Error()})
			return
		}

		if events == nil {
			events = []EventSummary{}
		}
		c.JSON(http.StatusOK, events)
	}
}
