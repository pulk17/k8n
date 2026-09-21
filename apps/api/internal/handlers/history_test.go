package handlers

import "testing"

func TestChangesComeBackNewestFirst(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home) // os.UserHomeDir on Windows

	Record(nil, "apply", []string{"Deployment/web"}, "")
	Record(nil, "scale", []string{"Deployment/default/web"}, "Scaled to 3")

	changes := ReadChanges(10)
	if len(changes) != 2 {
		t.Fatalf("got %d changes, want 2", len(changes))
	}
	if changes[0].Action != "scale" || changes[0].Detail != "Scaled to 3" {
		t.Errorf("newest = %+v", changes[0])
	}
	if got := ReadChanges(1); len(got) != 1 || got[0].Action != "scale" {
		t.Errorf("limit did not keep the newest: %+v", got)
	}
}
