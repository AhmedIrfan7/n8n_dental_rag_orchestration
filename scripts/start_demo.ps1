# Starts the voice client's static server + 3 cloudflared quick tunnels
# (client, voice-fallback, n8n) and prints one shareable URL with the
# tunnel addresses baked in as query params. Quick tunnels get a fresh
# random *.trycloudflare.com hostname every run - re-run this and re-share
# the printed URL each time you restart the demo.
param(
  [int]$ClientPort = 8080,
  [int]$VoicePort = 8000,
  [int]$N8nPort = 5679
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$cloudflared = "$env:USERPROFILE\bin\cloudflared.exe"
if (-not (Test-Path $cloudflared)) { throw "cloudflared not found at $cloudflared - see docs/DEMO.md" }

Write-Host "Starting client static server on :$ClientPort ..." -ForegroundColor Cyan
Start-Process -WindowStyle Hidden python -ArgumentList "-m http.server $ClientPort --directory `"$root\client`""
Start-Sleep 2

function Start-Tunnel($port, $logFile) {
  $proc = Start-Process -WindowStyle Hidden $cloudflared -ArgumentList "tunnel --url http://localhost:$port" -RedirectStandardOutput $logFile -RedirectStandardError "$logFile.err" -PassThru
  return $proc
}

$tmp = Join-Path $env:TEMP "dental_demo_tunnels"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
Write-Host "Starting tunnels (this takes ~5-10s to assign hostnames) ..." -ForegroundColor Cyan
$pClient = Start-Tunnel $ClientPort "$tmp\client.log"
$pVoice  = Start-Tunnel $VoicePort  "$tmp\voice.log"
$pN8n    = Start-Tunnel $N8nPort    "$tmp\n8n.log"

Start-Sleep 8

function Get-TunnelUrl($logFile) {
  $content = Get-Content "$logFile.err" -Raw -ErrorAction SilentlyContinue
  if ($content -match "(https://[a-z0-9-]+\.trycloudflare\.com)") { return $matches[1] }
  return $null
}

$clientUrl = Get-TunnelUrl "$tmp\client.log"
$voiceUrl  = Get-TunnelUrl "$tmp\voice.log"
$n8nUrl    = Get-TunnelUrl "$tmp\n8n.log"

if (-not ($clientUrl -and $voiceUrl -and $n8nUrl)) {
  Write-Host "One or more tunnels did not report a URL yet - wait a few seconds and check:" -ForegroundColor Yellow
  Write-Host "  $tmp\client.log.err"
  Write-Host "  $tmp\voice.log.err"
  Write-Host "  $tmp\n8n.log.err"
  exit 1
}

$voiceEnc = [System.Uri]::EscapeDataString($voiceUrl)
$n8nEnc = [System.Uri]::EscapeDataString($n8nUrl)
$shareUrl = "$clientUrl/?voice=$voiceEnc&n8n=$n8nEnc"

Write-Host ""
Write-Host "=== Share this URL with your team ===" -ForegroundColor Green
Write-Host $shareUrl
Write-Host ""
Write-Host "(client PID=$($pClient.Id), voice PID=$($pVoice.Id), n8n PID=$($pN8n.Id) - stop with Stop-Process)"
