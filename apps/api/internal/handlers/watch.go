package handlers

import (
	"context"
	"encoding/json"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	watchInterval  = 3 * time.Second
	watchKeepalive = 20 * time.Second
)

// watchEvent is one message on the stream. The first carries every resource;
// after that only what changed, so an idle cluster sends nothing at all.
type watchEvent struct {
	Type    string     `json:"type"`
	Changed []Resource `json:"changed,omitempty"`
	Removed []string   `json:"removed,omitempty"`
	Message string     `json:"message,omitempty"`
}

// WatchResources streams cluster state over SSE.
//
// The deployed view sat behind a refresh button, so a rollout only showed up
// when you thought to ask. The polling moves here: one loop per open page
// regardless of how many resources it draws, and the diff means a settled
// cluster costs a keepalive comment every 20 seconds.
func WatchResources(clientGetter ClientGetter) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !requireCluster(c, clientGetter()) {
			return
		}

		namespace := c.Query("namespace")
		if namespace == "all" {
			namespace = ""
		}

		sseHeaders(c)

		ctx := c.Request.Context()
		sent := map[string]string{}
		lastWrite := time.Now()

		// The snapshot goes out even when it is empty, otherwise a cluster with
		// nothing in it produces no first event and the page waits forever for
		// one.
		first := true

		for {
			// Re-read the client every tick: connecting to a different context
			// swaps it underneath us, and the stream should follow.
			client := clientGetter()
			if client == nil || client.Clientset == nil {
				sseSend(c, watchEvent{Type: "error", Message: "The cluster connection was closed."})
				return
			}

			listCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
			resources, err := CollectResources(listCtx, client, namespace)
			cancel()

			switch {
			case err != nil:
				sseSend(c, watchEvent{Type: "error", Message: err.Error()})
				lastWrite = time.Now()
			default:
				if event, changed := diffResources(sent, resources); changed || first {
					sseSend(c, event)
					lastWrite = time.Now()
					first = false
				}
			}

			if time.Since(lastWrite) >= watchKeepalive {
				ssePing(c)
				lastWrite = time.Now()
			}

			select {
			case <-ctx.Done():
				return
			case <-time.After(watchInterval):
			}
		}
	}
}

// diffResources works out what the client has not seen yet. `sent` holds a
// fingerprint per resource and is updated in place.
func diffResources(sent map[string]string, current []Resource) (watchEvent, bool) {
	event := watchEvent{Type: "update"}
	alive := make(map[string]bool, len(current))

	for _, r := range current {
		alive[r.UID] = true
		fingerprint := fingerprintOf(r)
		if previous, ok := sent[r.UID]; ok && previous == fingerprint {
			continue
		}
		sent[r.UID] = fingerprint
		event.Changed = append(event.Changed, r)
	}

	for uid := range sent {
		if !alive[uid] {
			delete(sent, uid)
			event.Removed = append(event.Removed, uid)
		}
	}

	return event, len(event.Changed) > 0 || len(event.Removed) > 0
}

// fingerprintOf is the serialised resource. Comparing the whole thing is cheap
// at this size and cannot miss a field the way a hand-written comparison would.
func fingerprintOf(r Resource) string {
	data, err := json.Marshal(r)
	if err != nil {
		// Unreachable for a struct of plain fields; treat it as always-changed
		// rather than silently matching a resource that has no fingerprint yet.
		return time.Now().String()
	}
	return string(data)
}
