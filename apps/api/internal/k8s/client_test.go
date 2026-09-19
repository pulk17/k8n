package k8s

import (
	"os"
	"path/filepath"
	"testing"
)

// k8n used to read ~/.kube/config and nothing else, so anyone keeping their
// clusters anywhere at all (which $KUBECONFIG exists for) opened it to an empty
// context list and no explanation.
func TestGetContextsReadsKUBECONFIG(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config")
	kubeconfig := `apiVersion: v1
kind: Config
clusters:
- cluster:
    server: https://example.invalid:6443
  name: example
contexts:
- context:
    cluster: example
    user: someone
  name: staging
- context:
    cluster: example
    user: someone
  name: production
current-context: staging
users:
- name: someone
  user: {}
`
	if err := os.WriteFile(path, []byte(kubeconfig), 0o600); err != nil {
		t.Fatal(err)
	}

	t.Setenv("KUBECONFIG", path)

	contexts, err := GetContexts()
	if err != nil {
		t.Fatalf("GetContexts: %v", err)
	}

	found := map[string]bool{}
	for _, name := range contexts {
		found[name] = true
	}
	if !found["staging"] || !found["production"] {
		t.Errorf("expected the contexts from $KUBECONFIG, got %v", contexts)
	}
}

// An empty file is a valid kubeconfig with nothing in it — the app should say
// "no contexts", not fall back to a file the user did not ask for.
func TestGetContextsHonoursAnEmptyKUBECONFIG(t *testing.T) {
	path := filepath.Join(t.TempDir(), "empty")
	if err := os.WriteFile(path, []byte("apiVersion: v1\nkind: Config\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	t.Setenv("KUBECONFIG", path)

	contexts, err := GetContexts()
	if err != nil {
		t.Fatalf("GetContexts: %v", err)
	}
	if len(contexts) != 0 {
		t.Errorf("expected no contexts, got %v", contexts)
	}
}

// The default context has a name too, and the UI shows it: without one there
// is no telling which cluster an apply is about to reach.
func TestNewClientNamesTheDefaultContext(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config")
	kubeconfig := "apiVersion: v1\nkind: Config\nclusters:\n- cluster:\n    server: https://example.invalid:6443\n  name: c\ncontexts:\n- context:\n    cluster: c\n    user: u\n  name: staging\ncurrent-context: staging\nusers:\n- name: u\n  user: {}\n"
	if err := os.WriteFile(path, []byte(kubeconfig), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("KUBECONFIG", path)
	t.Setenv("KUBERNETES_SERVICE_HOST", "") // not in a pod

	client, err := NewClient("")
	if err != nil {
		t.Fatal(err)
	}
	if client.Context != "staging" {
		t.Errorf("Context = %q, want the current context", client.Context)
	}
}
