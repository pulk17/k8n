package handlers

import "testing"

func TestHelmBookkeepingIsNotTheUsersToDelete(t *testing.T) {
	cases := map[string]bool{
		"sh.helm.release.v1.grafana.v2": true,  // Helm's record of a revision
		"grafana":                       false, // the release's own Secret
		"kube-root-ca.crt":              true,
	}
	for name, want := range cases {
		if got := IsProtected(name, "default"); got != want {
			t.Errorf("IsProtected(%q) = %v, want %v", name, got, want)
		}
	}
}
