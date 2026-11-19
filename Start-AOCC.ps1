param([switch]$Open)
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$localUrl = 'http://127.0.0.1:3010'
Set-Location -LiteralPath $projectRoot
$sourceFiles = @(Get-ChildItem -LiteralPath (Join-Path $projectRoot 'web'),(Join-Path $projectRoot 'server'),(Join-Path $projectRoot 'public') -Recurse -File) + @(Get-Item -LiteralPath (Join-Path $projectRoot 'index.html'),(Join-Path $projectRoot 'vite.config.js'),(Join-Path $projectRoot 'package.json'))
$latestSource = ($sourceFiles | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1).LastWriteTimeUtc
$buildFile = Join-Path $projectRoot 'dist\index.html'
$needsBuild = -not (Test-Path -LiteralPath $buildFile)
if (-not $needsBuild) { $needsBuild = (Get-Item -LiteralPath $buildFile).LastWriteTimeUtc -lt $latestSource }
$needsRestart = $needsBuild
$serviceRecord = Join-Path $projectRoot '.data\service.json'
if (Test-Path -LiteralPath $serviceRecord) { try { $record = Get-Content -LiteralPath $serviceRecord -Raw | ConvertFrom-Json; if (([DateTimeOffset]$record.startedAt).UtcDateTime -lt $latestSource) { $needsRestart = $true } } catch { $needsRestart = $true } }
$alreadyRunning = $false
try {
    $health = Invoke-RestMethod -Uri "$localUrl/api/health" -TimeoutSec 2
    if ($health.ok -and $health.readonly) {
        $alreadyRunning = $true
        if (-not $needsRestart) {
        Write-Host "Airline Simulator AOCC is running: $localUrl"
        if ($Open) { Start-Process $localUrl }
        exit 0
        }
    }
} catch { }
$nodeCommand = Get-Command node -ErrorAction Stop
$nodeVersion = (& $nodeCommand.Source --version).Trim()
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(\d+)\.') { throw 'Cannot determine Node.js version.' }
$nodeMajor = [int]$Matches[1]
if ($nodeMajor -lt 24) { throw 'Node.js 24 or later is required.' }
if ($needsBuild) {
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules'))) { & npm.cmd ci --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' } }
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'AOCC build failed.' }
}
if ($alreadyRunning) { & (Join-Path $projectRoot 'Stop-AOCC.ps1') }
$dataDir = Join-Path $projectRoot '.data'
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
$serverPath = Join-Path $projectRoot 'server\index.mjs'
$process = Start-Process -FilePath $nodeCommand.Source -ArgumentList @('"' + $serverPath + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $dataDir 'server.log') -RedirectStandardError (Join-Path $dataDir 'server-error.log')
@{ pid = $process.Id; root = $projectRoot; startedAt = (Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json | Set-Content -Encoding utf8 -LiteralPath (Join-Path $dataDir 'service.json')
for ($attempt = 0; $attempt -lt 15; $attempt++) {
    Start-Sleep -Milliseconds 500
    try {
        $health = Invoke-RestMethod -Uri "$localUrl/api/health" -TimeoutSec 2
        if ($health.ok -and $health.readonly) {
            Write-Host "Airline Simulator AOCC: $localUrl"
            if ($Open) { Start-Process $localUrl }
            exit 0
        }
    } catch { }
}
throw 'AOCC did not start. See .data/server-error.log.'
