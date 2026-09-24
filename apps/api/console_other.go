//go:build !windows

package main

// launchedOnItsOwn is Windows-only: elsewhere a binary is started from a
// terminal, which stays open after it exits.
func launchedOnItsOwn() bool { return false }
