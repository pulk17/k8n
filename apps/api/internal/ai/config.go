package ai

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// Where the assistant's model access comes from, and how it is stored.
//
// It used to be one environment variable read once at startup, which meant
// turning the assistant on required a restart and a terminal — and that only
// Gemini was ever possible. Almost every provider now speaks the OpenAI chat
// format, so one HTTP client covers OpenAI, Anthropic, Mistral, DeepSeek, Z.AI,
// OpenRouter and anything self-hosted; Google keeps its own SDK.
//
// The key is written to ~/.k8n/config.json, owner-readable, on the machine that
// makes the model calls. It is never sent to the browser: the UI gets a masked
// hint and nothing more.

// Provider identifies which API shape and endpoint to use.
type Provider string

const (
	ProviderGoogle     Provider = "google"
	ProviderOpenAI     Provider = "openai"
	ProviderAnthropic  Provider = "anthropic"
	ProviderMistral    Provider = "mistral"
	ProviderDeepSeek   Provider = "deepseek"
	ProviderZAI        Provider = "zai"
	ProviderOpenRouter Provider = "openrouter"
	// ProviderCustom is any other OpenAI-compatible endpoint: Ollama, LM Studio,
	// vLLM, a gateway, a provider added after this was written.
	ProviderCustom Provider = "custom"
)

// DefaultModel is used when no model is chosen and the provider is Google.
const DefaultModel = "gemini-2.5-flash"

// Known describes a provider for the UI: where it lives and a model to start
// from. Model ids change often — these are a starting point, not a promise,
// which is why the UI has a Test button.
type Known struct {
	ID           Provider `json:"id"`
	Label        string   `json:"label"`
	BaseURL      string   `json:"baseUrl"`
	DefaultModel string   `json:"defaultModel"`
	KeysURL      string   `json:"keysUrl,omitempty"`
	Note         string   `json:"note,omitempty"`
}

// Providers is what the UI offers. Anything OpenAI-compatible that is not
// listed works through "custom".
var Providers = []Known{
	{ProviderGoogle, "Google Gemini", "", DefaultModel,
		"https://aistudio.google.com/apikey", ""},
	{ProviderOpenAI, "OpenAI", "https://api.openai.com/v1", "gpt-4.1-mini",
		"https://platform.openai.com/api-keys", ""},
	{ProviderAnthropic, "Anthropic", "https://api.anthropic.com/v1", "claude-sonnet-5",
		"https://console.anthropic.com/settings/keys",
		"Uses Anthropic's OpenAI-compatible endpoint."},
	{ProviderMistral, "Mistral", "https://api.mistral.ai/v1", "mistral-large-latest",
		"https://console.mistral.ai/api-keys", ""},
	{ProviderDeepSeek, "DeepSeek", "https://api.deepseek.com/v1", "deepseek-chat",
		"https://platform.deepseek.com/api_keys", ""},
	{ProviderZAI, "Z.AI", "https://api.z.ai/api/paas/v4", "glm-4.6",
		"https://z.ai/manage-apikey/apikey-list", ""},
	{ProviderOpenRouter, "OpenRouter", "https://openrouter.ai/api/v1", "",
		"https://openrouter.ai/keys",
		"One key for many models. Use the full model id, e.g. anthropic/claude-sonnet-4.5."},
	{ProviderCustom, "Other (OpenAI-compatible)", "", "", "",
		"Ollama, LM Studio, vLLM, a gateway — anything serving /chat/completions."},
}

func known(p Provider) (Known, bool) {
	for _, k := range Providers {
		if k.ID == p {
			return k, true
		}
	}
	return Known{}, false
}

// Config is the resolved model access.
type Config struct {
	Provider Provider `json:"provider"`
	Model    string   `json:"model"`
	APIKey   string   `json:"apiKey"`
	BaseURL  string   `json:"baseUrl,omitempty"`
	// Source says where this came from, so the UI can explain why a key it did
	// not set is in use.
	Source string `json:"-"` // "file" | "env" | ""
}

// Enabled reports whether AI features should be offered at all. Without a key
// every AI surface says so and the rest of k8n is unaffected.
//
// A self-hosted endpoint needs no key, so a custom base URL counts too.
func (c Config) Enabled() bool {
	return c.APIKey != "" || (c.Provider == ProviderCustom && c.BaseURL != "")
}

// Masked is what the browser is allowed to see of the key.
func (c Config) Masked() string {
	key := c.APIKey
	if len(key) <= 8 {
		if key == "" {
			return ""
		}
		return "…"
	}
	return key[:4] + "…" + key[len(key)-4:]
}

// resolved returns the config with provider defaults filled in.
func (c Config) resolved() Config {
	if c.Provider == "" {
		c.Provider = ProviderGoogle
	}
	if k, ok := known(c.Provider); ok {
		if c.BaseURL == "" {
			c.BaseURL = k.BaseURL
		}
		if c.Model == "" {
			c.Model = k.DefaultModel
		}
	}
	return c
}

// --- storage -----------------------------------------------------------------

var (
	mu      sync.RWMutex
	current Config
)

// Current is the configuration in force. It changes while k8n is running,
// because the whole point is not having to restart to add a key.
func Current() Config {
	mu.RLock()
	defer mu.RUnlock()
	return current
}

// Init loads the saved configuration, falling back to the environment.
//
// The file wins: it is the more recent, more deliberate act — someone typed it
// into the running app. The environment is how a container is set up, and stays
// the answer when there is no file.
func Init() {
	if cfg, err := loadFile(); err == nil && cfg.Enabled() {
		cfg.Source = "file"
		set(cfg.resolved())
		return
	}
	if cfg := fromEnv(); cfg.Enabled() {
		cfg.Source = "env"
		set(cfg.resolved())
		return
	}
	set(Config{})
}

// Save writes a new configuration and puts it into force immediately.
func Save(cfg Config) error {
	cfg = cfg.resolved()
	if err := writeFile(cfg); err != nil {
		return err
	}
	cfg.Source = "file"
	set(cfg)
	return nil
}

// Forget removes the stored key, falling back to the environment if there is
// one — which is the only sensible reading of "forget what I typed".
func Forget() error {
	path, err := configPath()
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("could not remove %s: %w", path, err)
	}
	Init()
	return nil
}

func set(cfg Config) {
	mu.Lock()
	defer mu.Unlock()
	current = cfg
}

func fromEnv() Config {
	// GEMINI_API_KEY stays the name it always was; the generic names are for
	// anyone configuring a different provider without the UI.
	key := strings.TrimSpace(os.Getenv("K8N_AI_API_KEY"))
	provider := Provider(strings.TrimSpace(os.Getenv("K8N_AI_PROVIDER")))
	model := strings.TrimSpace(os.Getenv("K8N_AI_MODEL"))
	baseURL := strings.TrimSpace(os.Getenv("K8N_AI_BASE_URL"))

	if key == "" {
		if gemini := strings.TrimSpace(os.Getenv("GEMINI_API_KEY")); gemini != "" {
			key = gemini
			provider = ProviderGoogle
			if model == "" {
				model = strings.TrimSpace(os.Getenv("GEMINI_MODEL"))
			}
		}
	}

	return Config{Provider: provider, Model: model, APIKey: key, BaseURL: baseURL}
}

func configPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("could not find your home directory: %w", err)
	}
	return filepath.Join(home, ".k8n", "config.json"), nil
}

func loadFile() (Config, error) {
	path, err := configPath()
	if err != nil {
		return Config{}, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return Config{}, err
	}
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return Config{}, fmt.Errorf("%s is not valid JSON: %w", path, err)
	}
	return cfg, nil
}

func writeFile(cfg Config) error {
	path, err := configPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("could not create %s: %w", filepath.Dir(path), err)
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	// 0600: this file holds an API key.
	if err := os.WriteFile(path, data, 0o600); err != nil {
		return fmt.Errorf("could not write %s: %w", path, err)
	}
	return nil
}
