package main

import (
	"errors"
	"net"
	"net/http"
	"strconv"
	"testing"
)

func TestAPortInUseDoesNotStopK8n(t *testing.T) {
	// Something else — not k8n — holds a port.
	other, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	taken := other.Addr().(*net.TCPAddr).Port

	l, _, err := listen("127.0.0.1", strconv.Itoa(taken), false)
	if err != nil {
		t.Fatalf("default port taken: %v, want the next free one", err)
	}
	if got := l.Addr().(*net.TCPAddr).Port; got <= taken {
		t.Errorf("moved to %d, want a port above %d", got, taken)
	}
	l.Close()

	if _, _, err := listen("127.0.0.1", strconv.Itoa(taken), true); err == nil {
		t.Error("a port given with --port was taken, and k8n quietly used another")
	}
}

func TestASecondK8nSaysTheFirstIsRunning(t *testing.T) {
	running, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer running.Close()
	go http.Serve(running, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"status":"ok","version":"v0.9.0"}`))
	}))
	port := strconv.Itoa(running.Addr().(*net.TCPAddr).Port)

	if _, at, err := listen("127.0.0.1", port, false); !errors.Is(err, errAlreadyRunning) || strconv.Itoa(at) != port {
		t.Errorf("listen = %v, want errAlreadyRunning", err)
	}
}
