package helm

import (
	"errors"
	"testing"
)

func TestIsUnreachable(t *testing.T) {
	down := errors.New(`Kubernetes cluster unreachable: Get "https://127.0.0.1:51080/version": dial tcp 127.0.0.1:51080: connectex: No connection could be made because the target machine actively refused it.`)
	if !IsUnreachable(down) {
		t.Error("a stopped Docker Desktop should count as unreachable")
	}
	if IsUnreachable(errors.New("template: grafana/templates/x.yaml:3: nil pointer")) {
		t.Error("a chart bug is not the cluster being down")
	}
}
