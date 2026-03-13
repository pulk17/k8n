#!/bin/bash

# k8n Installation Script
# This script automates the setup process for k8n

set -e

echo "🚀 k8n Installation Script"
echo "=========================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check prerequisites
echo "📋 Checking prerequisites..."

# Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js is not installed${NC}"
    echo "Please install Node.js 18+ from https://nodejs.org/"
    exit 1
fi
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}❌ Node.js version must be 18 or higher (found: $(node -v))${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Node.js $(node -v)${NC}"

# Check npm
if ! command -v npm &> /dev/null; then
    echo -e "${RED}❌ npm is not installed${NC}"
    exit 1
fi
echo -e "${GREEN}✓ npm $(npm -v)${NC}"

# Check Go
if ! command -v go &> /dev/null; then
    echo -e "${RED}❌ Go is not installed${NC}"
    echo "Please install Go 1.21+ from https://golang.org/dl/"
    exit 1
fi
GO_VERSION=$(go version | awk '{print $3}' | cut -d'o' -f2 | cut -d'.' -f2)
if [ "$GO_VERSION" -lt 21 ]; then
    echo -e "${RED}❌ Go version must be 1.21 or higher (found: $(go version))${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Go $(go version | awk '{print $3}')${NC}"

# Check Docker
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker is not installed${NC}"
    echo "Please install Docker from https://docs.docker.com/get-docker/"
    exit 1
fi
echo -e "${GREEN}✓ Docker $(docker --version | awk '{print $3}' | tr -d ',')${NC}"

# Check Docker Compose
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo -e "${RED}❌ Docker Compose is not installed${NC}"
    echo "Please install Docker Compose from https://docs.docker.com/compose/install/"
    exit 1
fi
echo -e "${GREEN}✓ Docker Compose${NC}"

# Check kubectl
if ! command -v kubectl &> /dev/null; then
    echo -e "${YELLOW}⚠️  kubectl is not installed${NC}"
    echo "kubectl is required to connect to Kubernetes clusters"
    echo "Install from: https://kubernetes.io/docs/tasks/tools/"
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
else
    echo -e "${GREEN}✓ kubectl $(kubectl version --client --short 2>/dev/null | awk '{print $3}')${NC}"
fi

echo ""
echo "✅ All prerequisites met!"
echo ""

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo "📝 Creating .env file..."
    cat > .env << EOF
# Database
DATABASE_URL=postgres://k8n:k8npassword@localhost:5432/k8n_db?sslmode=disable

# API
API_PORT=8080

# Frontend
NEXT_PUBLIC_API_URL=http://localhost:8080
EOF
    echo -e "${GREEN}✓ .env file created${NC}"
else
    echo -e "${YELLOW}⚠️  .env file already exists, skipping${NC}"
fi

# Create frontend .env.local if it doesn't exist
if [ ! -f apps/web/.env.local ]; then
    echo "📝 Creating apps/web/.env.local file..."
    cat > apps/web/.env.local << EOF
NEXT_PUBLIC_API_URL=http://localhost:8080
EOF
    echo -e "${GREEN}✓ apps/web/.env.local file created${NC}"
else
    echo -e "${YELLOW}⚠️  apps/web/.env.local file already exists, skipping${NC}"
fi

# Start database
echo ""
echo "🗄️  Starting PostgreSQL database..."
docker-compose up -d
sleep 3

# Check if database is running
if docker ps | grep -q k8n-postgres; then
    echo -e "${GREEN}✓ Database is running${NC}"
else
    echo -e "${RED}❌ Failed to start database${NC}"
    exit 1
fi

# Install frontend dependencies
echo ""
echo "📦 Installing frontend dependencies..."
cd apps/web
npm install
cd ../..
echo -e "${GREEN}✓ Frontend dependencies installed${NC}"

# Download Go dependencies
echo ""
echo "📦 Downloading Go dependencies..."
cd apps/api
go mod download
cd ../..
echo -e "${GREEN}✓ Go dependencies downloaded${NC}"

echo ""
echo "🎉 Installation complete!"
echo ""
echo "To start k8n:"
echo ""
echo "1. Start the backend (in one terminal):"
echo "   cd apps/api && go run main.go"
echo ""
echo "2. Start the frontend (in another terminal):"
echo "   cd apps/web && npm run dev"
echo ""
echo "3. Open your browser:"
echo "   http://localhost:3000"
echo ""
echo "For more information, see README.md"
echo ""
