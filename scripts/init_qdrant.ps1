# Create the Qdrant collection for the clinic knowledge base.
# nomic-embed-text -> 768 dims, cosine distance.
$ErrorActionPreference = "Stop"
$port = 6343
$name = "clinic_kb"
$dim  = 768
$body = @{ vectors = @{ size = $dim; distance = "Cosine" } } | ConvertTo-Json
try {
  Invoke-RestMethod -Uri "http://localhost:$port/collections/$name" -Method Put -Body $body -ContentType "application/json" | Out-Null
  Write-Host "Collection '$name' created ($dim-dim, cosine)." -ForegroundColor Green
} catch {
  Write-Host "Create returned: $($_.Exception.Message) (may already exist)" -ForegroundColor Yellow
}
# payload indexes for filtered retrieval (type/page_type/service)
foreach ($field in @("type","page_type","service_name","website_url")) {
  $idx = @{ field_name = $field; field_schema = "keyword" } | ConvertTo-Json
  try { Invoke-RestMethod -Uri "http://localhost:$port/collections/$name/index" -Method Put -Body $idx -ContentType "application/json" | Out-Null } catch {}
}
Write-Host "=== collection info ===" -ForegroundColor Cyan
(Invoke-RestMethod -Uri "http://localhost:$port/collections/$name").result | ConvertTo-Json -Depth 4
