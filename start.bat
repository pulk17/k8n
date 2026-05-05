@echo off
REM ============================================
REM k8n Start Script for Windows
REM ============================================
REM Starts both backend and frontend for development

echo.
echo ====================================
echo    k8n - Visual Kubernetes IDE
echo ====================================
echo.

REM Check prerequisites
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js not found. Install from https://nodejs.org/
    pause
    exit /b 1
)

where go >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Go not found. Install from https://golang.org/dl/
    pause
    exit /b 1
)

REM Check if node_modules exists
if not exist node_modules (
    echo [SETUP] Installing dependencies...
    call npm install
    echo.
)

REM Create .env if missing
if not exist .env (
    echo [SETUP] Creating .env from .env.example...
    copy .env.example .env >nul 2>nul
    if %ERRORLEVEL% NEQ 0 (
        echo DATABASE_URL=postgres://k8n:k8npassword@localhost:5432/k8n_db?sslmode=disable> .env
        echo API_PORT=8080>> .env
        echo NEXT_PUBLIC_API_URL=http://localhost:8080>> .env
    )
    echo [OK] .env created
)

REM Create web .env.local if missing
if not exist apps\web\.env.local (
    echo NEXT_PUBLIC_API_URL=http://localhost:8080> apps\web\.env.local
    echo [OK] apps\web\.env.local created
)

REM Optionally start database
where docker >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    docker ps >nul 2>nul
    if %ERRORLEVEL% EQU 0 (
        docker ps --format "{{.Names}}" | findstr /C:"k8n_db" >nul 2>nul
        if %ERRORLEVEL% NEQ 0 (
            echo [DB] Starting PostgreSQL...
            docker-compose up -d
            timeout /t 3 /nobreak >nul
        ) else (
            echo [DB] PostgreSQL already running
        )
    ) else (
        echo [WARN] Docker not running - database features disabled
    )
) else (
    echo [WARN] Docker not installed - database features disabled
)

echo.
echo Starting k8n...
echo   Backend:  http://localhost:8080
echo   Frontend: http://localhost:3000
echo.
echo Press Ctrl+C in each window to stop.
echo.

REM Start everything via turbo
call npm run dev
