package main

import (
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func testRoom() (*Room, *time.Time) {
	clock := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	r := NewRoom(Limits{Session: 20 * time.Minute, Idle: 3 * time.Minute, Claim: 2 * time.Minute, Stale: time.Minute, Reset: time.Minute, MaxQueue: 3})
	r.now = func() time.Time { return clock }
	<-r.Resets()
	r.Ready()
	return r, &clock
}

func TestOneAtATimeInOrder(t *testing.T) {
	r, clock := testRoom()
	a, _ := r.Join("a")
	b, _ := r.Join("b")
	if a.State != "your-turn" || b.State != "waiting" || b.Position != 2 {
		t.Fatalf("a %+v, b %+v", a, b)
	}
	if r.Claim("b") {
		t.Fatal("b jumped the queue")
	}
	if !r.Claim("a") || r.Claim("a") {
		t.Fatal("a should start exactly once")
	}
	if s := r.Status("b"); s.State != "waiting" || s.Position != 1 || s.WaitSecs == 0 {
		t.Fatalf("b while a plays: %+v", s)
	}

	// a closes the tab: silent past the idle limit ends it; b waits for the reset.
	for range 7 { // b's page keeps asking, a's tab is gone
		*clock = clock.Add(30 * time.Second)
		r.Status("b")
	}
	if r.Touch("a") {
		t.Fatal("an idle session should have ended")
	}
	if s := r.Status("a"); s.State != "out" || s.Ended != "closed" {
		t.Fatalf("a after idling: %+v", s)
	}
	select {
	case <-r.Resets():
	default:
		t.Fatal("the end of a session should ask for a reset")
	}
	if s := r.Status("b"); s.State != "waiting" || !s.Resetting {
		t.Fatalf("b during the reset: %+v", s)
	}
	r.Ready()
	if s := r.Status("b"); s.State != "your-turn" {
		t.Fatalf("b after the reset: %+v", s)
	}
}

func TestTheClockEndsASession(t *testing.T) {
	r, clock := testRoom()
	r.Join("a")
	r.Claim("a")
	for range 25 { // an active tab, well past the session limit
		*clock = clock.Add(time.Minute)
		r.Touch("a")
	}
	if s := r.Status("a"); s.State != "out" || s.Ended != "ran out of time" {
		t.Fatalf("%+v", s)
	}
}

func TestAMissedTurnGoesToTheNext(t *testing.T) {
	r, clock := testRoom()
	r.Join("a")
	r.Join("b")
	for range 3 { // both pages open, a never presses Start
		*clock = clock.Add(50 * time.Second)
		r.Status("a")
		r.Status("b")
	}
	if s := r.Status("a"); s.State != "out" || s.Ended != "missed its turn" {
		t.Fatalf("a: %+v", s)
	}
	if s := r.Status("b"); s.State != "your-turn" {
		t.Fatalf("b: %+v", s)
	}
}

func TestAClosedWaitingPageLosesItsPlace(t *testing.T) {
	r, clock := testRoom()
	r.Join("a")
	r.Claim("a")
	r.Join("b")
	r.Join("c")
	for range 2 { // c's page keeps asking, b's has gone
		*clock = clock.Add(45 * time.Second)
		r.Status("c")
		r.Touch("a")
	}
	if s := r.Status("c"); s.Position != 1 || s.Waiting != 1 {
		t.Fatalf("c should be next once b's page went quiet: %+v", s)
	}
}

func TestTheQueueHasAnEnd(t *testing.T) {
	r, _ := testRoom()
	for i := range 3 {
		if _, err := r.Join(fmt.Sprint(i)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := r.Join("late"); err != errFull {
		t.Fatalf("want errFull, got %v", err)
	}
}

// However many tabs press Start at once, one session starts.
func TestSimultaneousStartsGiveOneSession(t *testing.T) {
	r, _ := testRoom()
	r.Join("a")
	var wins atomic.Int32
	var wg sync.WaitGroup
	for range 64 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if r.Claim("a") {
				wins.Add(1)
			}
			r.Touch("a")
			r.Status("a")
		}()
	}
	wg.Wait()
	if wins.Load() != 1 {
		t.Fatalf("%d sessions started", wins.Load())
	}
}
