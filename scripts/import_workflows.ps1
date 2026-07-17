# Import all workflow JSON from workflows/ into the running n8n container.
# Use to restore/rehydrate the stack from version control.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root "workflows"
$files = Get-ChildItem $src -Filter *.json -ErrorAction SilentlyContinue
if (-not $files) { Write-Host "No workflow JSON in $src yet." -ForegroundColor Yellow; exit 0 }
docker exec dental-n8n sh -c "rm -rf /tmp/wf && mkdir -p /tmp/wf" | Out-Null
foreach ($f in $files) { docker cp "$($f.FullName)" "dental-n8n:/tmp/wf/$($f.Name)" | Out-Null }
docker exec dental-n8n n8n import:workflow --separate --input=/tmp/wf 2>&1 | Out-Host
Write-Host "Imported $($files.Count) workflow(s) into n8n." -ForegroundColor Green
