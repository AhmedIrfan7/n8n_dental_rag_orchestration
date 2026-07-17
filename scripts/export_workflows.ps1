# Export all n8n workflows from the running container to workflows/ as
# separate pretty JSON files, so they can be version-controlled.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $root "workflows"
docker exec dental-n8n sh -c "rm -rf /tmp/wf && mkdir -p /tmp/wf && n8n export:workflow --all --pretty --separate --output=/tmp/wf" 2>&1 | Out-Host
# copy out
docker cp dental-n8n:/tmp/wf/. "$dest" 2>&1 | Out-Host
Write-Host "Exported workflows to $dest" -ForegroundColor Green
Get-ChildItem $dest -Filter *.json | Select-Object -ExpandProperty Name
