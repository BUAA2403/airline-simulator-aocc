$ErrorActionPreference = 'Stop'
$servicePath = Join-Path $PSScriptRoot '.data\service.json'
if (-not (Test-Path -LiteralPath $servicePath)) { Write-Host 'No managed AOCC process.'; exit 0 }
$service = Get-Content -LiteralPath $servicePath -Raw | ConvertFrom-Json
$expectedScript = Join-Path $PSScriptRoot 'server\index.mjs'
$process = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$service.pid)" -ErrorAction SilentlyContinue
if ($process -and $process.Name -eq 'node.exe' -and $process.CommandLine.Contains($expectedScript)) {
    Stop-Process -Id ([int]$service.pid)
    Write-Host 'Airline Simulator AOCC stopped.'
} elseif ($process) { throw 'Process identity differs; no process was stopped.' }
