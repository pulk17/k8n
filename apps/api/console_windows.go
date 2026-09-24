package main

import (
	"syscall"
	"unsafe"
)

// launchedOnItsOwn reports whether k8n has a console window to itself — it was
// double-clicked rather than started from a terminal. Windows then closes the
// window the moment k8n exits, so an error would vanish unread, and there is no
// terminal to copy a link out of.
func launchedOnItsOwn() bool {
	list := syscall.NewLazyDLL("kernel32.dll").NewProc("GetConsoleProcessList")
	var pids [2]uint32
	n, _, _ := list.Call(uintptr(unsafe.Pointer(&pids[0])), uintptr(len(pids)))
	return n == 1
}
