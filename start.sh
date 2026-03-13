#!/bin/bash

# k8n Start Script
# Starts both backend and frontend in the background

set -e

echo "🚀 Starting k8n..."
echo ""

# Check if database is running
if ! docker ps | grep -q k8n-postgres; then
    echo "📦 Starting database..."
    docker-compose up -d
    sleep 3
fi

# Start backend in background
echo "🔧 Starting backend..."
cd apps/api
go run main.go > ../../backend.log 2>&1 &
BACKEND_PID=$!
echo "Backend PID: $BACKEND_PID"
cd ../..

# Wait for backend to start
echo "⏳ Waiting for backend to start..."
sleep 3

# Start frontend in background
echo "🎨 Starting frontend..."
cd apps/web
npm run dev > ../../frontend.log 2>&1 &
FRONTEND_PID=$!
echo "Frontend PID: $FRONTEND_PID"
cd ../..

echo ""
echo "✅ k8n is starting!"
echo ""
echo "Backend:  http://localhost:8080 (PID: $BACKEND_PID)"
echo "Frontend: http://localhost:3000 (PID: $FRONTEND_PID)"
echo ""
echo "Logs:"
echo "  Backend:  tail -f backend.log"
echo "  Frontend: tail -f frontend.log"
echo ""
echo "To stop k8n:"
echo "  kill $BACKEND_PID $FRONTEND_PID"
echo ""
echo "Or run: ./stop.sh"
echo ""

# Save PIDs to file for stop script
echo "$BACKEND_PID" > .k8n.pid
echo "$FRONTEND_PID" >> .k8n.pid

echo "Opening browser in 5 seconds..."
sleep 5
if command -v xdg-open &> /dev/null; then
    xdg-open http://localhost:3000
elif command -v open &> /dev/null; then
    open http://localhost:3000
fi
