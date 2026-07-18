# One-command bootstrap: stack up -> voice service ready -> all workflows
# built + deployed + activated -> (optionally) ingest a clinic URL.
# Assumes .env already has N8N_OWNER_EMAIL/PASSWORD, N8N_PG_CRED_ID, and
# N8N_OPENAI_CRED_ID set (one-time setup - see docs/RUNBOOK.md section 1).
param(
  [string]$IngestUrl = ""
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

Write-Host "=== 1/5: starting core stack ===" -ForegroundColor Cyan
& "$root\scripts\up.ps1"

Write-Host "`n=== 2/5: building + starting voice-fallback (skip if already built) ===" -ForegroundColor Cyan
$hasImage = docker images -q dental-rag-voice-fallback
if (-not $hasImage) {
  docker compose -f "$root\infra\docker-compose.yml" build voice-fallback
}
docker compose -f "$root\infra\docker-compose.yml" up -d voice-fallback

Write-Host "`n=== 3/5: assembling workflow JSON from source ===" -ForegroundColor Cyan
node "$root\scripts\build_workflows.js"

Write-Host "`n=== 4/5: deploying + activating all workflows ===" -ForegroundColor Cyan
$order = @(
  "01_ingestion_pipeline", "02_extract_facts", "03_build_index", "04_retriever",
  "11_booking_agent", "12_pricing_agent", "13_services_faq_agent", "14_general_knowledge_agent",
  "10_orchestrator", "05_voice_ask"
)
foreach ($name in $order) {
  & "$root\scripts\n8n_deploy.ps1" -File "workflows\$name.json" -Activate | Out-Null
  Write-Host "  deployed $name" -ForegroundColor Green
}

Write-Host "`n=== 5/5: health check ===" -ForegroundColor Cyan
& "$root\scripts\healthcheck.ps1"
try { Invoke-RestMethod "http://localhost:8000/health" | Out-Null; Write-Host "  voice-fallback: ok" -ForegroundColor Green }
catch { Write-Host "  voice-fallback: NOT responding yet" -ForegroundColor Yellow }

if ($IngestUrl) {
  Write-Host "`n=== ingesting $IngestUrl (this can take 1-3 minutes) ===" -ForegroundColor Cyan
  $body = @{ website_url = $IngestUrl } | ConvertTo-Json
  $result = Invoke-RestMethod "http://localhost:5679/webhook/ingest" -Method Post -Body $body -ContentType "application/json" -TimeoutSec 600
  $result | ConvertTo-Json -Depth 6
}

Write-Host "`n=== ready ===" -ForegroundColor Green
Write-Host "Ingest a clinic:  curl -X POST http://localhost:5679/webhook/ingest -H `"Content-Type: application/json`" -d '{\"website_url\":\"https://example.com/\"}'"
Write-Host "Ask a question:   curl -X POST http://localhost:5679/webhook/ask -H `"Content-Type: application/json`" -d '{\"query\":\"...\",\"website_url\":\"https://example.com/\"}'"
Write-Host "Voice client:     python -m http.server 8080 --directory client   (then open http://localhost:8080)"
Write-Host "Run eval suite:   node scripts/run_eval.js"
