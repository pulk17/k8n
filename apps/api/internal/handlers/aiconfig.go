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
// in the request means "the one already saved".
func keptKey(cfg ai.Config) ai.Config {
	if cfg.APIKey == "" {
		cfg.APIKey = ai.Current().APIKey
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

		saved := ai.Current()
		c.JSON(http.StatusOK, gin.H{
			"enabled":  saved.Enabled(),
			"provider": saved.Provider,
			"model":    saved.Model,
			"baseUrl":  saved.BaseURL,
			"keyHint":  saved.Masked(),
			"source":   saved.Source,
		})
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

		ctx, cancel := context.WithTimeout(c.Request.Context(), 45*time.Second)
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
			c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": runErr.Error()})
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
		cfg := ai.Current()
		c.JSON(http.StatusOK, gin.H{
			"enabled":  cfg.Enabled(),
			"provider": cfg.Provider,
			"model":    cfg.Model,
			"keyHint":  cfg.Masked(),
			"source":   cfg.Source,
		})
	}
}

func truncateReply(s string) string {
	const max = 200
	if len(s) <= max {
		return s
	}
	return s[:max] + "…"
}
