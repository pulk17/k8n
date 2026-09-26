package main

import (
	"errors"
	"log"
	"sync"
	"time"
)

// Limits are the rules of the room, shown to visitors before they join.
type Limits struct {
	Session  time.Duration // the longest a session runs
	Idle     time.Duration // a session ends once its tab has been silent this long
	Claim    time.Duration // how long the front of the queue has to press Start
	Stale    time.Duration // a waiter whose page stopped asking loses their place
	Reset    time.Duration // about how long a reset takes, for wait estimates
	MaxQueue int
}

var errFull = errors.New("the queue is full")

type seat struct {
	id   string
	seen time.Time
}

// Room is who is using the demo and who is waiting for it: one visitor at a
// time, everyone else in order. It lives in memory; a restart empties it and
// resets the cluster, which is the safe way round.
//
// Every method takes the lock and first brings the state up to date (tick),
// so a transition never waits on the ticker and never happens twice.
type Room struct {
	mu      sync.Mutex
	limits  Limits
	now     func() time.Time
	queue   []*seat
	offer   time.Time // when queue[0] must have started by; zero when not offered
	active  *seat
	started time.Time
	ready   bool // the cluster is clean and a fresh k8n is up
	avg     time.Duration
	ended   map[string]string // why a visitor's last session ended, for their page
	resets  chan struct{}
}

func NewRoom(l Limits) *Room {
	r := &Room{limits: l, now: time.Now, avg: l.Session / 2, ended: map[string]string{}, resets: make(chan struct{}, 1)}
	r.resets <- struct{}{} // start from a clean cluster whatever the last run left
	return r
}

// Resets fires when the cluster needs resetting; call Ready when it is done.
func (r *Room) Resets() <-chan struct{} { return r.resets }

type Status struct {
	State     string    `json:"state"`              // out, waiting, your-turn, active
	Position  int       `json:"position,omitempty"` // 1 is next
	Waiting   int       `json:"waiting"`
	WaitSecs  int       `json:"waitSeconds,omitempty"`
	Deadline  time.Time `json:"deadline,omitzero"` // your-turn: start by; active: session ends
	Busy      bool      `json:"busy"`
	Resetting bool      `json:"resetting"`
	Ended     string    `json:"ended,omitempty"` // why your last session ended
}

func (r *Room) Join(id string) (Status, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := r.tick()
	if r.index(id) < 0 && (r.active == nil || r.active.id != id) {
		if len(r.queue) >= r.limits.MaxQueue {
			return r.status(id, now), errFull
		}
		r.queue = append(r.queue, &seat{id: id, seen: now})
		delete(r.ended, id)
		log.Printf("join %s, %d waiting", short(id), len(r.queue))
		r.tick()
	}
	return r.status(id, now), nil
}

// Status is also the waiting page's heartbeat: asking keeps your place.
func (r *Room) Status(id string) Status {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := r.tick()
	if i := r.index(id); i >= 0 {
		r.queue[i].seen = now
	}
	return r.status(id, now)
}

// Claim starts the session, for the visitor at the front with a live offer only.
func (r *Room) Claim(id string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := r.tick()
	if r.offer.IsZero() || len(r.queue) == 0 || r.queue[0].id != id {
		return false
	}
	r.active, r.queue, r.offer, r.started = r.queue[0], r.queue[1:], time.Time{}, now
	r.active.seen = now
	log.Printf("start %s, %d waiting", short(id), len(r.queue))
	return true
}

// Touch records activity from the session holder and says whether id holds it.
func (r *Room) Touch(id string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := r.tick()
	if r.active == nil || r.active.id != id {
		return false
	}
	r.active.seen = now
	return true
}

// Leave takes id out of the queue, or ends their session.
func (r *Room) Leave(id string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.tick()
	if r.active != nil && r.active.id == id {
		r.end("ended it")
		return
	}
	if i := r.index(id); i >= 0 {
		r.drop(i)
		log.Printf("leave %s", short(id))
	}
	r.tick()
}

func (r *Room) Ready() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.ready = true
	r.tick()
}

// Tick is for the ticker: time alone ends sessions and moves the queue.
func (r *Room) Tick() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.tick()
}

func (r *Room) tick() time.Time {
	now := r.now()
	kept := r.queue[:0]
	for i, s := range r.queue {
		if now.Sub(s.seen) <= r.limits.Stale {
			kept = append(kept, s)
		} else if i == 0 {
			r.offer = time.Time{}
		}
	}
	r.queue = kept
	if !r.offer.IsZero() && now.After(r.offer) {
		log.Printf("missed turn %s", short(r.queue[0].id))
		r.ended[r.queue[0].id] = "missed its turn"
		r.drop(0)
	}
	if r.active != nil {
		switch {
		case now.Sub(r.started) >= r.limits.Session:
			r.end("ran out of time")
		case now.Sub(r.active.seen) >= r.limits.Idle:
			r.end("closed")
		}
	}
	if r.active == nil && r.ready && r.offer.IsZero() && len(r.queue) > 0 {
		r.offer = now.Add(r.limits.Claim)
		log.Printf("offer %s", short(r.queue[0].id))
	}
	return now
}

func (r *Room) end(why string) {
	took := r.now().Sub(r.started)
	log.Printf("end %s after %s: %s", short(r.active.id), took.Round(time.Second), why)
	r.ended[r.active.id] = why
	if len(r.ended) > 1000 {
		r.ended = map[string]string{} // ponytail: only feeds a message; never grows unbounded
	}
	r.avg = (3*r.avg + took) / 4
	r.active, r.ready = nil, false
	select {
	case r.resets <- struct{}{}:
	default:
	}
}

func (r *Room) drop(i int) {
	if i == 0 {
		r.offer = time.Time{}
	}
	r.queue = append(r.queue[:i], r.queue[i+1:]...)
}

func (r *Room) index(id string) int {
	for i, s := range r.queue {
		if s.id == id {
			return i
		}
	}
	return -1
}

func (r *Room) status(id string, now time.Time) Status {
	s := Status{State: "out", Waiting: len(r.queue), Busy: r.active != nil, Resetting: !r.ready && r.active == nil}
	switch i := r.index(id); {
	case r.active != nil && r.active.id == id:
		s.State, s.Deadline = "active", r.started.Add(r.limits.Session)
	case i == 0 && !r.offer.IsZero():
		s.State, s.Position, s.Deadline = "your-turn", 1, r.offer
	case i >= 0:
		s.State, s.Position, s.WaitSecs = "waiting", i+1, int(r.wait(i, now).Seconds())
	default:
		s.Ended = r.ended[id]
	}
	return s
}

// wait estimates from real session lengths: what is left of the current one,
// then a reset and an average session for everyone ahead.
func (r *Room) wait(ahead int, now time.Time) time.Duration {
	var d time.Duration
	if r.active != nil {
		left := max(r.avg-now.Sub(r.started), time.Minute)
		d = min(left, r.started.Add(r.limits.Session).Sub(now)) + r.limits.Reset
	} else if !r.ready {
		d = r.limits.Reset
	}
	return d + time.Duration(ahead)*(r.avg+r.limits.Reset)
}

func short(id string) string { return id[:min(8, len(id))] }
