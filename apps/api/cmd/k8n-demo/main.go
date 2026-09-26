// k8n-demo is the front door of the public k8n demo: a queue, one visitor at
// a time, and a clean cluster and a fresh k8n for each of them. It is the only
// thing reachable from outside; k8n itself listens on localhost behind it.
//
//	k8n-demo -baseline         record the cluster as set up (once, before opening)
//	k8n-demo                   run the demo
package main

import (
	"context"
	"crypto/rand"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"html/template"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

//go:embed room.html
var roomPage string

const cookieName = "k8n_demo"

func main() {
	var (
		listen     = flag.String("listen", "127.0.0.1:8081", "where the gate listens")
		origin     = flag.String("origin", "", "the public address, e.g. https://demo.example.ts.net")
		bin        = flag.String("k8n", "/usr/local/bin/k8n", "the k8n binary")
		port       = flag.Int("k8n-port", 8090, "the port each k8n listens on, on localhost")
		kubeconfig = flag.String("kubeconfig", "/var/lib/k8n/visitor.kubeconfig", "the visitor's restricted kubeconfig")
		state      = flag.String("state", "/var/lib/k8n", "where the baseline and session homes live")
		takeBase   = flag.Bool("baseline", false, "record the cluster as it is now, then exit")
		limits     = Limits{Reset: time.Minute}
	)
	flag.DurationVar(&limits.Session, "session", 20*time.Minute, "the longest a session runs")
	flag.DurationVar(&limits.Idle, "idle", 3*time.Minute, "end a session when its tab has been gone this long")
	flag.DurationVar(&limits.Claim, "claim", 2*time.Minute, "how long the next visitor has to press Start")
	flag.DurationVar(&limits.Stale, "stale", 3*time.Minute, "drop a waiter whose page has been gone this long")
	flag.IntVar(&limits.MaxQueue, "max-queue", 30, "the most people waiting at once")
	flag.Parse()

	cluster, err := connect(*kubeconfig)
	if err != nil {
		log.Fatal(err)
	}
	basePath := *state + "/baseline.json"
	if *takeBase {
		b, err := cluster.Snapshot(context.Background())
		if err == nil {
			data, _ := json.Marshal(b)
			err = os.WriteFile(basePath, data, 0o600)
		}
		if err != nil {
			log.Fatal(err)
		}
		log.Printf("baseline: %d namespaces, %d objects in default", len(b.Namespaces), len(b.Default))
		return
	}
	base, err := loadBaseline(basePath)
	if err != nil {
		log.Fatalf("no baseline (run k8n-demo -baseline on the fresh cluster first): %v", err)
	}

	// Each k8n runs from its own session directory, so a relative path would miss.
	if abs, err := filepath.Abs(*bin); err == nil {
		*bin = abs
	}
	room := NewRoom(limits)
	engine := &Engine{Bin: *bin, Home: *state + "/session", Kubeconfig: *kubeconfig, Origin: *origin, Port: *port}
	go resetLoop(room, cluster, base, engine)
	go func() {
		for range time.Tick(time.Second) {
			room.Tick()
		}
	}()

	page := template.Must(template.New("room").Parse(roomPage))
	facts := map[string]any{
		"Session": minutes(limits.Session), "Idle": minutes(limits.Idle),
		"Claim": minutes(limits.Claim), "Machine": cluster.Machine(context.Background()),
	}
	target, _ := url.Parse("http://127.0.0.1:" + flag.Lookup("k8n-port").Value.String())
	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.FlushInterval = -1 // the live view is a stream

	mux := http.NewServeMux()
	mux.HandleFunc("GET /demo/{$}", func(w http.ResponseWriter, r *http.Request) {
		visitor(w, r)
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		_ = page.Execute(w, facts)
	})
	mux.HandleFunc("GET /demo/status", func(w http.ResponseWriter, r *http.Request) {
		reply(w, http.StatusOK, room.Status(visitor(w, r)))
	})
	mux.HandleFunc("POST /demo/join", func(w http.ResponseWriter, r *http.Request) {
		s, err := room.Join(visitor(w, r))
		if err != nil {
			reply(w, http.StatusServiceUnavailable, map[string]string{"error": "The queue is full right now. Try again in a while."})
			return
		}
		reply(w, http.StatusOK, s)
	})
	mux.HandleFunc("POST /demo/start", func(w http.ResponseWriter, r *http.Request) {
		if !room.Claim(visitor(w, r)) {
			reply(w, http.StatusConflict, map[string]string{"error": "It is not your turn, or your turn has passed."})
			return
		}
		reply(w, http.StatusOK, map[string]string{"go": "/"})
	})
	mux.HandleFunc("POST /demo/leave", func(w http.ResponseWriter, r *http.Request) {
		room.Leave(visitor(w, r))
		reply(w, http.StatusOK, map[string]string{"left": "yes"})
	})
	// The app's countdown bar asks this; answering it also counts as the tab
	// still being open.
	mux.HandleFunc("GET /demo/session", func(w http.ResponseWriter, r *http.Request) {
		id := visitor(w, r)
		if !room.Touch(id) {
			reply(w, http.StatusNotFound, map[string]string{"error": "No session"})
			return
		}
		s := room.Status(id)
		reply(w, http.StatusOK, map[string]any{"endsAt": s.Deadline, "waiting": s.Waiting})
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if room.Touch(visitor(w, r)) {
			proxy.ServeHTTP(w, r)
			return
		}
		if r.Method == http.MethodGet && strings.Contains(r.Header.Get("Accept"), "text/html") {
			http.Redirect(w, r, "/demo/", http.StatusSeeOther)
			return
		}
		reply(w, http.StatusForbidden, map[string]string{"error": "You do not hold the demo session.", "hint": "Join the queue at /demo/"})
	})

	log.Printf("k8n demo on %s: %s sessions, %s idle, %s to claim", *listen, limits.Session, limits.Idle, limits.Claim)
	server := &http.Server{Addr: *listen, Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	log.Fatal(server.ListenAndServe())
}

// visitor is who is asking: a random id in a cookie, made on first sight.
// SameSite=Lax keeps other sites from acting with it.
func visitor(w http.ResponseWriter, r *http.Request) string {
	if c, err := r.Cookie(cookieName); err == nil && len(c.Value) == 32 {
		return c.Value
	}
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	id := hex.EncodeToString(b)
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: id, Path: "/", HttpOnly: true, Secure: true, SameSite: http.SameSiteLaxMode})
	r.AddCookie(&http.Cookie{Name: cookieName, Value: id})
	return id
}

func minutes(d time.Duration) string {
	if n := int(d.Minutes()); n != 1 {
		return fmt.Sprintf("%d minutes", n)
	}
	return "1 minute"
}

func reply(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
