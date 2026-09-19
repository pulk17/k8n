//go:build embedui

package main

import (
	"embed"
	"io/fs"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
)

// The frontend as static files (apps/web/out, built with K8N_EXPORT=1 and
// copied to ./ui). With it this binary is the whole app: one process, one port,
// and the page on the same origin as the API. Built only with -tags embedui, so
// the dev server and the Docker images are unaffected.
//
//go:embed all:ui
var uiFiles embed.FS

func init() {
	if os.Getenv("GIN_MODE") == "" {
		gin.SetMode(gin.ReleaseMode)
	}
	mountUI = func(r *gin.Engine) {
		site, _ := fs.Sub(uiFiles, "ui")
		files := http.FileServer(http.FS(site))
		r.NoRoute(func(c *gin.Context) {
			p := c.Request.URL.Path
			if _, err := fs.Stat(site, strings.TrimPrefix(p, "/")); err != nil {
				c.Request.URL.Path = segmentFile(p)
			}
			files.ServeHTTP(c.Writer, c.Request)
		})
	}
}
