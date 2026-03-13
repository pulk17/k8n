@echo off
REM k8n Installation Script for Windows
REM This script automates the setup process for k8n

echo.
echo ================================
echo k8n Installation Script
echo ================================
echo.

REM Check Node.js
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js is not installed
    echo Please install Node.js 18+ from https://nodejs.org/
    exit /b 1
)
echo [OK] Node.js found

REM Check npm
where npm >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] npm is not installed
    exit /b 1
)
echo [OK] npm found

REM Check Go
where go >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Go is not installed
    echo Please install Go 1.21+ from https://golang.org/dl/
    exit /b 1
)
echo [OK] Go found

REM Check Docker
where docker >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Docker is not installed
    echo Please install Docker from https://docs.docker.com/get-docker/
    exit /b 1
)
echo [OK] Docker found

REM Check kubectl
where kubectl >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [WARNING] kubectl is not installed
    echo kubectl is required to connect to Kubernetes clusters
    echo Install from: https://kubernetes.io/docs/tasks/tools/
)

echo.
echo All prerequisites met!
echo.

REM Create .env file if it doesn't exist
if not exist .env (
    echo Creating .env file...
    (
        echo # Database
        echo DATABASE_URL=postgres://k8n:k8npassword@localhost:5432/k8n_db?sslmode=disable
        echo.
        echo # API
        echo API_PORT=8080
        echo.
        echo # Frontend
        echo NEXT_PUBLIC_API_URL=http://localhost:8080
    ) > .env
    echo [OK] .env file created
) else (
    echo [SKIP] .env file already exists
)

REM Create frontend .env.local if it doesn't exist
if not exist apps\web\.env.local (
    echo Creating apps\web\.env.local file...
    (
        echo NEXT_PUBLIC_API_URL=http://localhost:8080
    ) > apps\web\.env.local
    echo [OK] apps\web\.env.local file created
) else (
    echo [SKIP] apps\web\.env.local file already exists
)

echo.
echo Starting PostgreSQL database...
docker-compose up -d
timeout /t 3 /nobreak >nul

echo.
echo Installing frontend dependencies...
cd apps\web
call npm install
cd ..\..
echo [OK] Frontend dependencies installed

echo.
echo Downloading Go dependencies...
cd apps\api
go mod download
cd ..\..
echo [OK] Go dependencies downloaded

echo.
echo ================================
echo Installation complete!
echo ================================
echo.
echo To start k8n:
echo.
echo 1. Start the backend (in one terminal):
echo    cd apps\api
echo    go run main.go
echo.
echo 2. Start the frontend (in another terminal):
echo    cd apps\web
echo    npm run dev
echo.
echo 3. Open your browser:
echo    http://localhost:3000
echo.
echo For more information, see README.md
echo.
pause
