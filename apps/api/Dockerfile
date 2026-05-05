# ============================================
# k8n API - Multi-stage Docker Build
# ============================================

# Stage 1: Build the Go binary
FROM golang:1.25-alpine AS builder

RUN apk add --no-cache git ca-certificates

WORKDIR /app

# Copy go modules first for layer caching
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build static binary
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
    -ldflags="-w -s" \
    -o /app/server \
    main.go

# Stage 2: Minimal runtime image
FROM alpine:3.21

RUN apk add --no-cache ca-certificates curl

# Create non-root user
RUN addgroup -S k8n && adduser -S k8n -G k8n

WORKDIR /app

# Copy binary from builder
COPY --from=builder /app/server .

# Set ownership
RUN chown -R k8n:k8n /app

USER k8n

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

ENTRYPOINT ["./server"]
