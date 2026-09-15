package auth

import "testing"

func TestRedactHidesTheTokenAndNothingElse(t *testing.T) {
	cases := map[string]string{
		"/api/cluster/watch?t=secret":             "/api/cluster/watch?t=REDACTED",
		"/api/cluster/watch?namespace=a&t=secret": "/api/cluster/watch?namespace=a&t=REDACTED",
		"/api/cluster/watch?token=secret&x=1":     "/api/cluster/watch?token=REDACTED&x=1",
		"/api/logs/default/pod":                   "/api/logs/default/pod",
		// A parameter that merely ends in "t" is not the token.
		"/api/graph/list?sort=name": "/api/graph/list?sort=name",
	}

	for in, want := range cases {
		if got := Redact(in); got != want {
			t.Errorf("Redact(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestMatchesRejectsEmptyAndWrong(t *testing.T) {
	if Matches("secret", "") {
		t.Error("an empty token must never match")
	}
	if Matches("secret", "secre") {
		t.Error("a prefix must not match")
	}
	if !Matches("secret", "secret") {
		t.Error("the right token must match")
	}
}

func TestPresentedPrefersTheHeader(t *testing.T) {
	header := func(name string) string {
		switch name {
		case Header:
			return "from-header"
		case "Authorization":
			return "Bearer from-bearer"
		}
		return ""
	}
	query := func(string) string { return "from-query" }

	if got := Presented(header, query); got != "from-header" {
		t.Errorf("header should win, got %q", got)
	}

	noHeader := func(name string) string {
		if name == "Authorization" {
			return "Bearer from-bearer"
		}
		return ""
	}
	if got := Presented(noHeader, query); got != "from-bearer" {
		t.Errorf("bearer should be next, got %q", got)
	}

	none := func(string) string { return "" }
	if got := Presented(none, query); got != "from-query" {
		t.Errorf("query is the fallback, got %q", got)
	}
}
