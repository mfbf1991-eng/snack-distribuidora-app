param(
  [string]$ApiBase = "https://snack-distribuidora-app-production.up.railway.app/api",
  [string]$OutputDir = "$PSScriptRoot\..\server\data\pc-backups",
  [int]$Retries = 3
)

$ErrorActionPreference = "Stop"

if (!(Test-Path -LiteralPath $OutputDir)) {
  New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}

$logDir = Join-Path $OutputDir "_logs"
if (!(Test-Path -LiteralPath $logDir)) {
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$target = Join-Path $OutputDir "db_export_$timestamp.json"
$logFile = Join-Path $logDir "backup_$timestamp.log"
$uri = "$ApiBase/system/db-export"

function Write-Log([string]$msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
  Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8
  Write-Output $line
}

$lastErr = $null
for ($i = 1; $i -le [Math]::Max(1, $Retries); $i++) {
  try {
    Write-Log ("Intento {0}: exportando desde {1}" -f $i, $uri)
    $response = Invoke-WebRequest -UseBasicParsing -Uri $uri -TimeoutSec 45
    [System.IO.File]::WriteAllText($target, $response.Content, [System.Text.Encoding]::UTF8)
    Write-Log "Backup guardado: $target"
    $lastErr = $null
    break
  } catch {
    $lastErr = $_
    Write-Log ("Intento {0} fallido: {1}" -f $i, $_.Exception.Message)
    Start-Sleep -Seconds 2
  }
}

if ($lastErr -ne $null) {
  throw "No fue posible exportar la base tras $Retries intentos. Error: $($lastErr.Exception.Message)"
}

# Keep only the latest 60 backups to avoid unlimited growth.
$files = Get-ChildItem -LiteralPath $OutputDir -File -Filter "db_export_*.json" | Sort-Object LastWriteTime -Descending
if ($files.Count -gt 60) {
  $files | Select-Object -Skip 60 | Remove-Item -Force
}

# Keep only the latest 120 logs.
$logs = Get-ChildItem -LiteralPath $logDir -File -Filter "backup_*.log" | Sort-Object LastWriteTime -Descending
if ($logs.Count -gt 120) {
  $logs | Select-Object -Skip 120 | Remove-Item -Force
}

Write-Log "Proceso finalizado correctamente."
