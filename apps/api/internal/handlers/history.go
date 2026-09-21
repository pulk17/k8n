package handlers

import (
	"bufio"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/user/k8s-graph-controller/backend/internal/k8s"
)

// What k8n changed, and when.
//
// k8n applies with Force, scales, restarts and upgrades releases; the cluster
// remembers the result but not that it was you, from here, twenty minutes ago.
// Every change is appended as one JSON line to ~/.k8n/history.jsonl — readable
// with `tail`, copyable, and the Deployed page reads it back.
type HistoryEntry struct {
	At      time.Time `json:"at"`
	Cluster string    `json:"cluster,omitempty"`
	Action  string    `json:"action"`
	Targets []string  `json:"targets,omitempty"`
	Detail  string    `json:"detail,omitempty"`
}

var historyMu sync.Mutex

// historyMaxBytes is where the file is trimmed back to its recent half. A
// change is ~150 bytes, so this is a few thousand of them.
const historyMaxBytes = 512 * 1024

func historyPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(home, ".k8n")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	return filepath.Join(dir, "history.jsonl"), nil
}

// Record appends one change. It never fails a request: a history that cannot be
// written is worth a line on the console, not a failed apply.
func Record(client *k8s.Client, action string, targets []string, detail string) {
	entry := HistoryEntry{At: time.Now().UTC(), Action: action, Targets: targets, Detail: detail}
	if client != nil {
		entry.Cluster = client.Context
	}
	line, err := json.Marshal(entry)
	if err != nil {
		return
	}

	historyMu.Lock()
	defer historyMu.Unlock()

	path, err := historyPath()
	if err != nil {
		return
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	_, _ = f.Write(append(line, '\n'))
	_ = f.Close()

	if info, err := os.Stat(path); err == nil && info.Size() > historyMaxBytes {
		trimHistory(path)
	}
}

// trimHistory keeps the newer half of the file.
func trimHistory(path string) {
	all := readLines(path)
	kept := all[len(all)/2:]
	_ = os.WriteFile(path, []byte(strings.Join(kept, "\n")+"\n"), 0o600)
}

func readLines(path string) []string {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()
	var lines []string
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		if line := strings.TrimSpace(scanner.Text()); line != "" {
			lines = append(lines, line)
		}
	}
	return lines
}

// ReadChanges returns the most recent changes, newest first.
func ReadChanges(limit int) []HistoryEntry {
	path, err := historyPath()
	if err != nil {
		return nil
	}
	historyMu.Lock()
	lines := readLines(path)
	historyMu.Unlock()

	if limit > 0 && len(lines) > limit {
		lines = lines[len(lines)-limit:]
	}
	changes := make([]HistoryEntry, 0, len(lines))
	for i := len(lines) - 1; i >= 0; i-- {
		var entry HistoryEntry
		if json.Unmarshal([]byte(lines[i]), &entry) == nil {
			changes = append(changes, entry)
		}
	}
	return changes
}

// HistoryHandler answers GET /api/history?limit=50.
func HistoryHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		limit, err := strconv.Atoi(c.DefaultQuery("limit", "50"))
		if err != nil || limit <= 0 {
			limit = 50
		}
		c.JSON(http.StatusOK, gin.H{"changes": ReadChanges(limit)})
	}
}
