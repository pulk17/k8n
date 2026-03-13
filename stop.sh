#!/bin/bash

# k8n Stop Script
# Stops both backend and frontend

echo "🛑 Stopping k8n..."
echo ""

if [ -f .k8n.pid ]; then
    while IFS= read -r pid; do
        if ps -p $pid > /dev/null 2>&1; then
            echo "Stopping process $pid..."
            kill $pid
        fi
    done < .k8n.pid
    rm .k8n.pid
    echo "✅ k8n stopped"
else
    echo "⚠️  No PID file found. Trying to find processes..."
    
    # Try to find and kill processes
    pkill -f "go run main.go" || true
    pkill -f "next-server" || true
    
    echo "✅ Attempted to stop k8n processes"
fi

echo ""
echo "To stop the database:"
echo "  docker-compose down"
echo ""
