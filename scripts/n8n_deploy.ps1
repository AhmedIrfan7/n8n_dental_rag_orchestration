# Deploy an n8n workflow JSON (from workflows/) into the running instance,
# idempotently (upsert by workflow name), then optionally activate it.
# Placeholders in the JSON are substituted from .env before deploy:
#   __PG_CRED_ID__  -> N8N_PG_CRED_ID
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
$raw = Get-Content $File -Raw
$raw = $raw.Replace('__PG_CRED_ID__', $envMap['N8N_PG_CRED_ID'])
$wf  = $raw | ConvertFrom-Json
$name = $wf.name

# --- upsert by name ---
$existing = (Invoke-RestMethod "$base/rest/workflows" -WebSession $sess).data | Where-Object { $_.name -eq $name }
$payload = @{ name=$wf.name; nodes=$wf.nodes; connections=$wf.connections; settings=$wf.settings } | ConvertTo-Json -Depth 40
if ($existing) {
  $id = $existing[0].id
  Invoke-RestMethod "$base/rest/workflows/$id" -Method Patch -Body $payload -ContentType "application/json" -WebSession $sess | Out-Null
  Write-Host "Updated workflow '$name' (id=$id)" -ForegroundColor Green
} else {
  $created = (Invoke-RestMethod "$base/rest/workflows" -Method Post -Body $payload -ContentType "application/json" -WebSession $sess).data
  $id = $created.id
  Write-Host "Created workflow '$name' (id=$id)" -ForegroundColor Green
}

# --- activate ---
if ($Activate) {
  Invoke-RestMethod "$base/rest/workflows/$id" -Method Patch -Body '{"active":true}' -ContentType "application/json" -WebSession $sess | Out-Null
  Write-Host "Activated '$name'." -ForegroundColor Green
}

# --- report webhook paths ---
$hooks = $wf.nodes | Where-Object { $_.type -eq 'n8n-nodes-base.webhook' }
foreach ($h in $hooks) { Write-Host ("  webhook: {0}/webhook/{1}" -f $base, $h.parameters.path) -ForegroundColor Cyan }
Write-Output $id
