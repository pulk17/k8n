package handlers

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/user/k8s-graph-controller/backend/internal/ai"
	"google.golang.org/genai"
)

// Choosing a model provider while k8n is running.
//
// The key is written to a file on the machine that makes the model calls, and
// never travels back to the browser: every response here carries a masked hint
// (sk-1a…9f) and nothing else. That matters most in the hosted setup, where the
// page is on someone's server and the engine is on your laptop — the key stays
// on the laptop.
//
// These routes sit behind the pairing token like everything else under /api.

type aiConfigRequest struct {
	Provider string `json:"provider"`
	Model    string `json:"model"`
	BaseURL  string `json:"baseUrl"`
	APIKey   string `json:"apiKey"`
}

func (r aiConfigRequest) config() ai.Config {
	return ai.Config{
		Provider: ai.Provider(strings.TrimSpace(r.Provider)),
		Model:    strings.TrimSpace(r.Model),
		BaseURL:  strings.TrimSpace(r.BaseURL),
		APIKey:   strings.TrimSpace(r.APIKey),
	}
}

// keptKey lets someone change the model without retyping the key: an empty key
// in the request means "the one already saved" — but only for the same
// provider, or switching Gemini to OpenAI would send the Gemini key to OpenAI.
func keptKey(cfg ai.Config) ai.Config {
	if saved := ai.Current(); cfg.APIKey == "" && cfg.Provider == saved.Provider {
		cfg.APIKey = saved.APIKey
	}
	return cfg
}

// SetAIConfig saves a provider, model and key, and puts them into force now.
func SetAIConfig() gin.HandlerFunc {
	return func(c *gin.Context) {
		var req aiConfigRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Expected {provider, model, baseUrl, apiKey}"})
			return
		}

		cfg := keptKey(req.config())
		if !cfg.Enabled() {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "No API key",
				"hint":  "A self-hosted endpoint can go without one — choose the custom provider and give its base URL.",
			})
			return
		}

		if err := ai.Save(cfg); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not save", "details": err.Error()})
			return
		}

		c.JSON(http.StatusOK, aiStatus())
	}
}

// TestAIConfig asks the model to say one word, so a wrong key or a model name
// that does not exist is found here rather than halfway through an answer.
//
// It tests what was sent without saving it, so a bad key cannot replace a
// working one just by being typed.
func TestAIConfig() gin.HandlerFunc {
	return func(c *gin.Context) {
		var req aiConfigRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Expected {provider, model, baseUrl, apiKey}"})
			return
		}

		cfg := keptKey(req.config())
		if !cfg.Enabled() {
			c.JSON(http.StatusBadRequest, gin.H{"error": "No API key to test"})
			return
		}

		// Short on purpose: this asks for one word. Waiting 45 seconds to be told
		// the provider is busy is worse than being told in 20.
		ctx, cancel := context.WithTimeout(c.Request.Context(), 20*time.Second)
		defer cancel()

		client, err := ai.NewClient(ctx, cfg)
		if err != nil || client == nil {
			message := "Could not build a client for that provider"
			if err != nil {
				message = err.Error()
			}
			c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": message})
			return
		}

		var reply strings.Builder
		runErr := client.Run(ctx,
			"You are being checked for connectivity. Reply with the single word: ready.",
			[]*genai.Content{ai.UserContent("Are you there?")},
			nil,
			func(ev ai.Event) {
				if ev.Type == "text" {
					reply.WriteString(ev.Text)
				}
			},
		)
		if runErr != nil {
			message, hint := explainProviderError(runErr)
			c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": message, "hint": hint})
			return
		}

		answer := strings.TrimSpace(reply.String())
		if answer == "" {
			c.JSON(http.StatusBadRequest, gin.H{
				"ok":    false,
				"error": "The provider answered, but with no text. The model name may be wrong for this endpoint.",
			})
			return
		}

		c.JSON(http.StatusOK, gin.H{"ok": true, "reply": truncateReply(answer)})
	}
}

// ForgetAIConfig deletes the saved key. If the environment still has one, that
// becomes current again — which is the only sensible reading of "forget what I
// typed".
func ForgetAIConfig() gin.HandlerFunc {
	return func(c *gin.Context) {
		if err := ai.Forget(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not remove the saved key", "details": err.Error()})
			return
		}
		c.JSON(http.StatusOK, aiStatus())
	}
}

// explainProviderError turns a provider's own words into something that says
// whether the problem is the key, the model, or the provider having a bad day —
// which is the only thing the person pressing Test needs to know.
func explainProviderError(err error) (message, hint string) {
	text := err.Error()
	lower := strings.ToLower(text)

	switch {
	case strings.Contains(lower, "deadline") || strings.Contains(lower, "timeout") ||
		strings.Contains(lower, "context canceled") || strings.Contains(text, "504"):
		return "The provider did not answer in time.",
			"Usually the model being busy rather than anything wrong with your settings. Try again, or pick a smaller model."
	case strings.Contains(text, "503") || strings.Contains(lower, "unavailable") ||
		strings.Contains(lower, "overloaded") || strings.Contains(lower, "high demand"):
		return "The provider says it is overloaded right now.",
			"Nothing is wrong with your key. Try again in a minute, or choose another model."
	case strings.Contains(text, "429") || strings.Contains(lower, "rate limit") ||
		strings.Contains(lower, "quota"):
		return "You have hit the provider's rate limit or quota.",
			"Wait, or check the billing and limits on your provider account."
	case strings.Contains(text, "401") || strings.Contains(text, "403") ||
		strings.Contains(lower, "api key") || strings.Contains(lower, "unauthenticated") ||
		strings.Contains(lower, "permission denied"):
		return "The provider rejected the key.",
			"Check it was pasted whole, and that it belongs to the provider you picked."
	case strings.Contains(text, "404") || strings.Contains(lower, "not found") ||
		strings.Contains(lower, "does not exist") || strings.Contains(lower, "unknown model"):
		return "That model name does not exist at this provider.",
			"Model names change often — check the provider's own list."
	}

	return truncateReply(text), ""
}

func truncateReply(s string) string {
	const max = 200
	if len(s) <= max {
		return s
	}
	return s[:max] + "…"
}
