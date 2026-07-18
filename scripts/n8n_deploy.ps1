# Deploy an n8n workflow JSON (from workflows/) into the running instance,
# idempotently (upsert by workflow name), then optionally activate it.
# Placeholders in the JSON are substituted from .env before deploy:
#   __PG_CRED_ID__            -> N8N_PG_CRED_ID
#   __OPENAI_CRED_ID__        -> N8N_OPENAI_CRED_ID
#   __WEBHOOK_AUTH_CRED_ID__  -> N8N_WEBHOOK_AUTH_CRED_ID (httpHeaderAuth credential, used by Webhook trigger nodes)
#   __WEBHOOK_API_KEY__       -> N8N_WEBHOOK_API_KEY (raw secret; only needed by Code nodes that call another
#                                webhook manually via helpers.httpRequest, since credential injection only
#                                applies to dedicated nodes - see orchestrator/route_and_call.js)
# Usage:
#   ./scripts/n8n_deploy.ps1 -File workflows/01_ingestion_pipeline.json -Activate
param(
  [Parameter(Mandatory=$true)][string]$File,
  [switch]$Activate
)
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path $File)) { $File = Join-Path $root $File }

# --- load .env ---
$envMap = @{}
Get-Content "$root\.env" | ForEach-Object { if ($_ -match '^\s*([^#=]+)=(.*)$') { $envMap[$matches[1].Trim()] = $matches[2] } }
$base  = "http://localhost:$($envMap['N8N_PORT'])"
$email = $envMap['N8N_OWNER_EMAIL']; $pass = $envMap['N8N_OWNER_PASSWORD']

# --- login ---
$sess = New-Object Microsoft.PowerShell.Commands.WebRequestSession
Invoke-WebRequest "$base/rest/login" -Method Post -Body (@{emailOrLdapLoginId=$email;password=$pass}|ConvertTo-Json) -ContentType "application/json" -WebSession $sess -UseBasicParsing -TimeoutSec 20 | Out-Null

# --- read + substitute placeholders ---
# Send the raw (substituted) JSON directly. Do NOT round-trip through
# PowerShell ConvertTo-Json — 5.1 mangles large multi-line jsCode strings.
# Workflow files contain exactly {name, nodes, connections, settings}.
$raw = Get-Content $File -Raw
$raw = $raw.Replace('__PG_CRED_ID__', $envMap['N8N_PG_CRED_ID'])
$raw = $raw.Replace('__OPENAI_CRED_ID__', $envMap['N8N_OPENAI_CRED_ID'])
$raw = $raw.Replace('__WEBHOOK_AUTH_CRED_ID__', $envMap['N8N_WEBHOOK_AUTH_CRED_ID'])
$raw = $raw.Replace('__WEBHOOK_API_KEY__', $envMap['N8N_WEBHOOK_API_KEY'])
$wf  = $raw | ConvertFrom-Json
$name = $wf.name
$payload = $raw

# --- upsert by name ---
$bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($payload)   # avoid PS 5.1 body mis-encoding
$existing = (Invoke-RestMethod "$base/rest/workflows" -WebSession $sess).data | Where-Object { $_.name -eq $name }
if ($existing) {
  $id = $existing[0].id
  Invoke-RestMethod "$base/rest/workflows/$id" -Method Patch -Body $bodyBytes -ContentType "application/json" -WebSession $sess | Out-Null
  Write-Host "Updated workflow '$name' (id=$id)" -ForegroundColor Green
} else {
  $created = (Invoke-RestMethod "$base/rest/workflows" -Method Post -Body $bodyBytes -ContentType "application/json" -WebSession $sess).data
  $id = $created.id
  Write-Host "Created workflow '$name' (id=$id)" -ForegroundColor Green
}

# --- activate (n8n 2.x: publish the version, flip active, restart to register webhooks) ---
if ($Activate) {
  docker exec dental-n8n n8n publish:workflow --id=$id 2>&1 | Out-Null
  Invoke-RestMethod "$base/rest/workflows/$id" -Method Patch -Body '{"active":true}' -ContentType "application/json" -WebSession $sess | Out-Null
  docker restart dental-n8n | Out-Null
  for ($i=0; $i -lt 30; $i++) { try { $r=Invoke-WebRequest "$base/healthz" -UseBasicParsing -TimeoutSec 3; if ($r.StatusCode -eq 200) { break } } catch { Start-Sleep 2 } }
  Start-Sleep 2
  Write-Host "Published + activated '$name' (webhooks registered after restart)." -ForegroundColor Green
}

# --- report webhook paths ---
$hooks = $wf.nodes | Where-Object { $_.type -eq 'n8n-nodes-base.webhook' }
foreach ($h in $hooks) { Write-Host ("  webhook: {0}/webhook/{1}" -f $base, $h.parameters.path) -ForegroundColor Cyan }
Write-Output $id
