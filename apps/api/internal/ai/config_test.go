package ai

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/zalando/go-keyring"
)

// The key must end up in the credential store, not in the file, and come back
// from it on the next start.
func TestKeyGoesToTheKeyring(t *testing.T) {
	keyring.MockInit()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)

	if err := Save(Config{Provider: ProviderGoogle, APIKey: "AIza-secret-value"}); err != nil {
		t.Fatal(err)
	}
	file, _ := os.ReadFile(filepath.Join(home, ".k8n", "config.json"))
	if strings.Contains(string(file), "AIza-secret-value") {
		t.Fatalf("the key was written to the file:\n%s", file)
	}
	if !Current().InKeyring {
		t.Error("status should say the key is in the credential store")
	}

	set(Config{})
	Init()
	if Current().APIKey != "AIza-secret-value" {
		t.Errorf("the key did not come back from the credential store: %q", Current().APIKey)
	}

	if err := Forget(); err != nil {
		t.Fatal(err)
	}
	path, _ := configPath()
	if _, err := keyring.Get(keyringService, path); err == nil {
		t.Error("forgetting left the key in the credential store")
	}
}

// Without a credential store (a container) the key stays in the file.
func TestKeyFallsBackToTheFile(t *testing.T) {
	keyring.MockInitWithError(keyring.ErrUnsupportedPlatform)
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)

	if err := Save(Config{Provider: ProviderOpenAI, APIKey: "sk-file-key"}); err != nil {
		t.Fatal(err)
	}
	if Current().InKeyring {
		t.Error("no credential store, yet it claims to use one")
	}
	set(Config{})
	Init()
	if Current().APIKey != "sk-file-key" {
		t.Errorf("got %q", Current().APIKey)
	}
}

func TestMasked(t *testing.T) {
	for key, want := range map[string]string{"": "", "short": "…", "AIzaSyABCDEFGH1234": "AIza…1234"} {
		if got := (Config{APIKey: key}).Masked(); got != want {
			t.Errorf("Masked(%q) = %q, want %q", key, got, want)
		}
	}
}

// Two homes, two keys: a test instance must never touch the real one.
func TestKeysAreSeparatePerHome(t *testing.T) {
	keyring.MockInit()
	use := func(home string) {
		t.Setenv("HOME", home)
		t.Setenv("USERPROFILE", home)
	}
	real, test := t.TempDir(), t.TempDir()

	use(real)
	if err := Save(Config{Provider: ProviderGoogle, APIKey: "the-real-key"}); err != nil {
		t.Fatal(err)
	}
	use(test)
	if err := Save(Config{Provider: ProviderGoogle, APIKey: "a-test-key"}); err != nil {
		t.Fatal(err)
	}
	if err := Forget(); err != nil {
		t.Fatal(err)
	}

	use(real)
	set(Config{})
	Init()
	if Current().APIKey != "the-real-key" {
		t.Errorf("the test home clobbered the real key: got %q", Current().APIKey)
	}
}
