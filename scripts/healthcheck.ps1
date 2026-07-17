# Verify every service in the dental-rag stack is reachable.
$root = Split-Path -Parent $PSScriptRoot
$ok = $true
function Test-Svc($name, $script) {
  try { & $script; Write-Host ("[OK]   {0}" -f $name) -ForegroundColor Green }
  catch { Write-Host ("[FAIL] {0}: {1}" -f $name, $_.Exception.Message) -ForegroundColor Red; $script:ok = $false }
}

Test-Svc "n8n (5679)"     { $r = Invoke-WebRequest "http://localhost:5679/healthz" -UseBasicParsing -TimeoutSec 5; if ($r.StatusCode -ne 200) { throw "status $($r.StatusCode)" } }
Test-Svc "Qdrant (6343)"  { $r = Invoke-WebRequest "http://localhost:6343/readyz" -UseBasicParsing -TimeoutSec 5; if ($r.StatusCode -ne 200) { throw "status $($r.StatusCode)" } }
Test-Svc "Postgres (5433)" { docker exec dental-postgres pg_isready -U dental -d dental | Out-Null; if ($LASTEXITCODE -ne 0) { throw "pg_isready failed" } }
Test-Svc "Redis (6380)"   { $p = docker exec dental-redis redis-cli ping; if ($p.Trim() -ne "PONG") { throw "ping=$p" } }
Test-Svc "Ollama (11435)" { $r = Invoke-WebRequest "http://localhost:11435/api/tags" -UseBasicParsing -TimeoutSec 5; if ($r.StatusCode -ne 200) { throw "status $($r.StatusCode)" } }

if ($ok) { Write-Host "`nAll services healthy." -ForegroundColor Green; exit 0 }
else { Write-Host "`nSome services unhealthy." -ForegroundColor Red; exit 1 }
