package handlers

import (
	"encoding/json"
	"fmt"

	"github.com/gin-gonic/gin"
)

// Server-sent events, shared by the assistant stream and the cluster watch.
// Every event is a JSON object carrying a "type", so a client switches on that
// rather than on SSE event names.

func sseHeaders(c *gin.Context) {
	c.Writer.Header().Set("Content-Type", "text/event-stream")
	// no-transform stops a proxy compressing the stream. Without it the Next
	// dev server gzips this response, and the compressor sits on the bytes
	// waiting for a full block — the browser gets a connection that opens and
	// then says nothing.
	c.Writer.Header().Set("Cache-Control", "no-cache, no-transform")
	c.Writer.Header().Set("Connection", "keep-alive")
	// nginx buffers proxied responses by default, which holds the whole stream
	// back until the handler returns.
	c.Writer.Header().Set("X-Accel-Buffering", "no")
	c.Writer.WriteHeader(200)
	c.Writer.Flush()
}

func sseSend(c *gin.Context, payload any) {
	data, err := json.Marshal(payload)
	if err != nil {
		return
	}
	fmt.Fprintf(c.Writer, "data: %s\n\n", data)
	c.Writer.Flush()
}

// ssePing keeps an idle connection open. A comment line is not delivered to the
// client's message handler, so it cannot be mistaken for a real update.
func ssePing(c *gin.Context) {
	fmt.Fprint(c.Writer, ": ping\n\n")
	c.Writer.Flush()
}
