# Start the dental-rag stack. Run from repo root.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Write-Host "Starting dental-rag stack..." -ForegroundColor Cyan
docker compose -f "$root\infra\docker-compose.yml" --env-file "$root\.env" up -d
Write-Host "`nContainers:" -ForegroundColor Cyan
docker ps --filter "name=dental-" --format "{{.Names}}  {{.Status}}  {{.Ports}}"
Write-Host "`nn8n:    http://localhost:5679" -ForegroundColor Green
Write-Host "Qdrant: http://localhost:6343/dashboard" -ForegroundColor Green
