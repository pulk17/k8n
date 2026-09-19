package main

import (
	"path"
	"strings"
)

// segmentFile maps the file name a Next.js page prefetches to the one a static
// export writes: the browser asks for /help/__next.help.__PAGE__.txt, and the
// export put it at /help/__next.help/__PAGE__.txt. Everything else is returned
// unchanged. Without it every hover over a link logged a 404.
func segmentFile(p string) string {
	dir, file := path.Split(p)
	if !strings.HasPrefix(file, "__next.") || !strings.HasSuffix(file, ".txt") {
		return p
	}
	parts := strings.Split(strings.TrimSuffix(strings.TrimPrefix(file, "__next."), ".txt"), ".")
	if len(parts) < 2 {
		return p
	}
	return dir + "__next." + strings.Join(parts, "/") + ".txt"
}
