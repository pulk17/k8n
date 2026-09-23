package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/user/k8s-graph-controller/backend/internal/auth"
)

func TestOnlyThisMachineAndTheHostedSiteMayCallTheEngine(t *testing.T) {
	t.Setenv("K8N_SITE", "")
	t.Setenv("ALLOWED_ORIGINS", "https://k8n.example.com")

	cases := map[string]bool{
		"http://127.0.0.1:8090":             true,
		"http://localhost:3000":             true,
		"http://[::1]:8080":                 true,
		"https://k8n.pages.dev":             true,
		"https://k8n.example.com":           true,
		"http://localhost.attacker.com":     false, // passed the old prefix check
		"http://127.0.0.1.nip.io":           false,
		"https://evil.k8n.pages.dev":        false, // a preview or another project
		"https://k8n.pages.dev.attacker.io": false,
		"null":                              false,
		"":                                  false,
	}
	for origin, want := range cases {
		if got := originAllowed(origin); got != want {
			t.Errorf("originAllowed(%q) = %v, want %v", origin, got, want)
		}
	}
}

func TestATokenInTheAddressOnlyOpensReads(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(requireToken("secret"))
	r.Any("/api/graph/apply", func(c *gin.Context) { c.Status(http.StatusOK) })

	status := func(method, target string, header bool) int {
		req := httptest.NewRequest(method, target, nil)
		if header {
			req.Header.Set(auth.Header, "secret")
		}
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w.Code
	}

	if got := status(http.MethodGet, "/api/graph/apply?t=secret", false); got != http.StatusOK {
		t.Errorf("GET with ?t= = %d, want 200 (EventSource needs it)", got)
	}
	if got := status(http.MethodPost, "/api/graph/apply?t=secret", false); got != http.StatusUnauthorized {
		t.Errorf("POST with ?t= = %d, want 401: a page elsewhere could send that", got)
	}
	if got := status(http.MethodPost, "/api/graph/apply", true); got != http.StatusOK {
		t.Errorf("POST with the header = %d, want 200", got)
	}
}
