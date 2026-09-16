package handlers

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// Saved workflows without a database.
//
// Postgres is the right store when k8n runs as a deployment with several
// people's work in it. For the single binary — the way most people will run
// this — requiring a database to save your own canvas is absurd, and the
// browser-only fallback loses everything when site data is cleared.
//
// So when there is no database, workflows are files in ~/.k8n/workflows: one
// JSON document each, named by id, which you can read, copy between machines,
// or keep in git.

type savedGraph struct {
	ID        string      `json:"id"`
	Name      string      `json:"name"`
	Namespace string      `json:"namespace"`
	GraphJSON interface{} `json:"graph_json"`
	CreatedAt time.Time   `json:"created_at"`
	UpdatedAt time.Time   `json:"updated_at"`
}

func workflowDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("could not find your home directory: %w", err)
	}
	dir := filepath.Join(home, ".k8n", "workflows")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", fmt.Errorf("could not create %s: %w", dir, err)
	}
	return dir, nil
}

// workflowPath refuses anything that is not a plain id, so a crafted id cannot
// write outside the directory.
func workflowPath(id string) (string, error) {
	if id == "" || strings.ContainsAny(id, `/\.`) {
		return "", fmt.Errorf("invalid workflow id")
	}
	dir, err := workflowDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, id+".json"), nil
}

func saveGraphFile(req SaveGraphRequest, id string) error {
	path, err := workflowPath(id)
	if err != nil {
		return err
	}

	saved := savedGraph{
		ID:        id,
		Name:      req.Name,
		Namespace: req.Namespace,
		GraphJSON: req.GraphJSON,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	// Keep the original creation time when overwriting, so the list stays in a
	// meaningful order.
	if existing, err := loadGraphFile(id); err == nil {
		saved.CreatedAt = existing.CreatedAt
	}

	data, err := json.MarshalIndent(saved, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o600)
}

func loadGraphFile(id string) (savedGraph, error) {
	path, err := workflowPath(id)
	if err != nil {
		return savedGraph{}, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return savedGraph{}, err
	}
	var saved savedGraph
	if err := json.Unmarshal(data, &saved); err != nil {
		return savedGraph{}, fmt.Errorf("%s is not a workflow k8n wrote: %w", path, err)
	}
	return saved, nil
}

// listGraphFiles returns what is on disk, newest first. A file that will not
// parse is skipped rather than failing the whole list: one bad file should not
// hide the rest of someone's work.
func listGraphFiles() ([]map[string]interface{}, error) {
	dir, err := workflowDir()
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}

	var saved []savedGraph
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		if graph, err := loadGraphFile(strings.TrimSuffix(entry.Name(), ".json")); err == nil {
			saved = append(saved, graph)
		}
	}
	sort.Slice(saved, func(i, j int) bool { return saved[i].UpdatedAt.After(saved[j].UpdatedAt) })

	list := make([]map[string]interface{}, 0, len(saved))
	for _, graph := range saved {
		list = append(list, map[string]interface{}{
			"id":         graph.ID,
			"name":       graph.Name,
			"namespace":  graph.Namespace,
			"created_at": graph.CreatedAt,
			"updated_at": graph.UpdatedAt,
		})
	}
	return list, nil
}

func deleteGraphFile(id string) error {
	path, err := workflowPath(id)
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}
