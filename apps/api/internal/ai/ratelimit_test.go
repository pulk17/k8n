package ai

import (
	"errors"
	"testing"
	"time"
)

func TestRateLimitDelay(t *testing.T) {
	gemini := errors.New("Gemini request failed: Error 429, Message: You exceeded your current quota. Please retry in 37.8s., Status: RESOURCE_EXHAUSTED")
	if d, ok := rateLimitDelay(gemini); !ok || d < 38*time.Second || d > 40*time.Second {
		t.Errorf("gemini: %v %v", d, ok)
	}
	openai := errors.New("https://api.openai.com/v1/chat/completions said 429 Too Many Requests: {}")
	if d, ok := rateLimitDelay(openai); !ok || d != 20*time.Second {
		t.Errorf("openai: %v %v", d, ok)
	}
	if _, ok := rateLimitDelay(errors.New("401 invalid key")); ok {
		t.Error("a bad key is not a rate limit")
	}
	if _, ok := rateLimitDelay(nil); ok {
		t.Error("nil is not a rate limit")
	}
}
