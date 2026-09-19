package main

import "testing"

func TestSegmentFile(t *testing.T) {
	for in, want := range map[string]string{
		"/help/__next.help.__PAGE__.txt":         "/help/__next.help/__PAGE__.txt",
		"/deployed/__next.deployed.__PAGE__.txt": "/deployed/__next.deployed/__PAGE__.txt",
		"/help/__next.help.txt":                  "/help/__next.help.txt", // a real file as it is
		"/help/index.txt":                        "/help/index.txt",
		"/_next/static/chunks/app.js":            "/_next/static/chunks/app.js",
	} {
		if got := segmentFile(in); got != want {
			t.Errorf("segmentFile(%q) = %q, want %q", in, got, want)
		}
	}
}
