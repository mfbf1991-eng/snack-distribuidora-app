param(
  [string]$ApiBase = "https://snack-distribuidora-app-production.up.railway.app/api",
  [string]$OutputDir = "$PSScriptRoot\..\server\data\pc-backups"
)

$ErrorActionPreference = "Stop"

if (!(Test-Path -LiteralPath $OutputDir)) {
  New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$target = Join-Path $OutputDir "db_export_$timestamp.json"
$uri = "$ApiBase/system/db-export"

$response = Invoke-WebRequest -UseBasicParsing -Uri $uri -TimeoutSec 45
[System.IO.File]::WriteAllText($target, $response.Content, [System.Text.Encoding]::UTF8)

# Keep only the latest 60 backups to avoid unlimited growth.
$files = Get-ChildItem -LiteralPath $OutputDir -File -Filter "db_export_*.json" | Sort-Object LastWriteTime -Descending
if ($files.Count -gt 60) {
  $files | Select-Object -Skip 60 | Remove-Item -Force
}

Write-Output "Backup guardado: $target"
