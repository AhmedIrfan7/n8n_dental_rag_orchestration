# Stop the dental-rag stack (keeps volumes). Pass -v to also remove volumes.
param([switch]$v)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if ($v) {
  docker compose -f "$root\infra\docker-compose.yml" --env-file "$root\.env" down -v
  Write-Host "Stack stopped and volumes removed." -ForegroundColor Yellow
} else {
  docker compose -f "$root\infra\docker-compose.yml" --env-file "$root\.env" down
  Write-Host "Stack stopped (volumes kept)." -ForegroundColor Yellow
}
