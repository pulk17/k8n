# ============================================
# k8n Production Deployment Script (PowerShell)
# ============================================
# Usage:
#   .\deploy.ps1                    # Deploy with defaults
#   .\deploy.ps1 -DbPassword "xxx"  # Deploy with custom DB password
#   .\deploy.ps1 -Teardown          # Tear everything down

param(
    [string]$DbPassword = "k8npassword",
    [string]$KubeconfigPath = "$env:USERPROFILE\.kube",
    [int]$Port = 80,
    [switch]$Teardown,
    [switch]$Rebuild
)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "  k8n Production Deployment" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

# --- Teardown mode ---
if ($Teardown) {
    Write-Host "[TEARDOWN] Stopping all containers..." -ForegroundColor Yellow
    docker-compose -f docker-compose.prod.yml down -v
    Write-Host "[DONE] All containers stopped and volumes removed." -ForegroundColor Green
    exit 0
}

# --- Check prerequisites ---
Write-Host "[1/4] Checking prerequisites..." -ForegroundColor Blue

$docker = Get-Command docker -ErrorAction SilentlyContinue
if (-not $docker) {
    Write-Host "[ERROR] Docker is not installed. Install from https://docs.docker.com/get-docker/" -ForegroundColor Red
    exit 1
}
Write-Host "  Docker: OK" -ForegroundColor Green

# Check Docker is running
try {
    docker info *> $null
} catch {
    Write-Host "[ERROR] Docker daemon is not running. Please start Docker Desktop." -ForegroundColor Red
    exit 1
}
Write-Host "  Docker daemon: Running" -ForegroundColor Green

# Check kubeconfig
if (Test-Path $KubeconfigPath) {
    Write-Host "  Kubeconfig: Found at $KubeconfigPath" -ForegroundColor Green
} else {
    Write-Host "  [WARN] Kubeconfig not found at $KubeconfigPath" -ForegroundColor Yellow
    Write-Host "         k8n will start but won't be able to connect to clusters." -ForegroundColor Yellow
}

# --- Set environment ---
Write-Host ""
Write-Host "[2/4] Setting environment..." -ForegroundColor Blue

$env:POSTGRES_PASSWORD = $DbPassword
$env:KUBECONFIG_PATH = $KubeconfigPath
$env:K8N_PORT = $Port
$env:ALLOWED_ORIGINS = "http://localhost,http://localhost:$Port"

Write-Host "  Database password: $(if ($DbPassword -eq 'k8npassword') {'(default)'} else {'(custom)'})" -ForegroundColor Gray
Write-Host "  Kubeconfig: $KubeconfigPath" -ForegroundColor Gray
Write-Host "  Port: $Port" -ForegroundColor Gray

# --- Build and deploy ---
Write-Host ""
Write-Host "[3/4] Building and deploying..." -ForegroundColor Blue

$buildFlag = if ($Rebuild) { "--build --no-cache" } else { "--build" }
docker-compose -f docker-compose.prod.yml up $buildFlag -d

# --- Wait for health ---
Write-Host ""
Write-Host "[4/4] Waiting for services to start..." -ForegroundColor Blue

$maxRetries = 30
$retryCount = 0
$ready = $false

while (-not $ready -and $retryCount -lt $maxRetries) {
    Start-Sleep -Seconds 2
    $retryCount++
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:$Port" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
        if ($response.StatusCode -eq 200) {
            $ready = $true
        }
    } catch {
        Write-Host "  Waiting... ($retryCount/$maxRetries)" -ForegroundColor Gray -NoNewline
        Write-Host "`r" -NoNewline
    }
}

Write-Host ""
Write-Host ""
if ($ready) {
    Write-Host "======================================" -ForegroundColor Green
    Write-Host "  k8n is LIVE!" -ForegroundColor Green
    Write-Host "======================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "  URL:    http://localhost:$Port" -ForegroundColor White
    Write-Host "  API:    http://localhost:$Port/health" -ForegroundColor White
    Write-Host ""
    Write-Host "  Commands:" -ForegroundColor Gray
    Write-Host "    View logs:   docker-compose -f docker-compose.prod.yml logs -f" -ForegroundColor Gray
    Write-Host "    Stop:        .\deploy.ps1 -Teardown" -ForegroundColor Gray
    Write-Host "    Rebuild:     .\deploy.ps1 -Rebuild" -ForegroundColor Gray
    Write-Host ""
} else {
    Write-Host "[WARN] Services may still be starting." -ForegroundColor Yellow
    Write-Host "  Check status:  docker-compose -f docker-compose.prod.yml ps" -ForegroundColor Gray
    Write-Host "  View logs:     docker-compose -f docker-compose.prod.yml logs -f" -ForegroundColor Gray
}
