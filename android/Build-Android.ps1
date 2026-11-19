param([switch]$SkipWeb)
$ErrorActionPreference = 'Stop'
$androidRoot = $PSScriptRoot
$projectRoot = Split-Path -Parent $androidRoot
Set-Location -LiteralPath $androidRoot
$taskJava = Get-ChildItem -LiteralPath (Join-Path $androidRoot 'toolchain\java') -Directory | Select-Object -First 1
$taskSdk = Join-Path $androidRoot 'toolchain\sdk'
$taskBuildTools = Join-Path $taskSdk 'android-15'
$taskPlatform = Join-Path $taskSdk 'android-35\android.jar'
if (-not $taskJava -or -not (Test-Path -LiteralPath $taskPlatform) -or -not (Test-Path -LiteralPath (Join-Path $taskBuildTools 'aapt2.exe'))) { throw 'Android toolchain is missing. See android/README.md.' }
$javaBin = Join-Path $taskJava.FullName 'bin'
$buildRoot = Join-Path $androidRoot 'build'
$privateRoot = Join-Path $androidRoot 'private'
New-Item -ItemType Directory -Force -Path $buildRoot,$privateRoot,(Join-Path $buildRoot 'classes'),(Join-Path $buildRoot 'dex') | Out-Null
function Invoke-Checked([string]$Executable, [string[]]$Arguments) {
    # Android's Windows resource tools require ASCII relative paths.
    $taskArguments = @($Arguments | ForEach-Object { $_.Replace($androidRoot + '\','.\').Replace($projectRoot + '\','..\') })
    & $Executable @taskArguments
    if ($LASTEXITCODE -ne 0) { throw "Android build failed: $Executable" }
}
if (-not $SkipWeb) {
    Push-Location -LiteralPath $projectRoot
    try { Invoke-Checked (Get-Command 'npx.cmd').Source @('--no-install','vite','build','--config','android/vite.config.mjs') } finally { Pop-Location }
}
$resourceArchive = Join-Path $buildRoot 'resources.zip'
Invoke-Checked (Join-Path $taskBuildTools 'aapt2.exe') @('compile','--dir',(Join-Path $androidRoot 'app\res'),'-o',$resourceArchive)
$unsignedApk = Join-Path $buildRoot 'unsigned.apk'
Invoke-Checked (Join-Path $taskBuildTools 'aapt2.exe') @('link','-o',$unsignedApk,'-I',$taskPlatform,'--manifest',(Join-Path $androidRoot 'app\AndroidManifest.xml'),$resourceArchive)
# aapt2 on Windows emits backslashes for nested -A paths. Package assets with
# canonical ZIP separators so Android AssetManager finds the exact web URLs.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$taskWebRoot = Join-Path $androidRoot 'web-dist'
$taskArchive = [System.IO.Compression.ZipFile]::Open($unsignedApk,[System.IO.Compression.ZipArchiveMode]::Update)
try {
    foreach ($taskFile in (Get-ChildItem -LiteralPath $taskWebRoot -Recurse -File)) {
        $taskEntry = 'assets/' + [System.IO.Path]::GetRelativePath($taskWebRoot,$taskFile.FullName).Replace('\','/')
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($taskArchive,$taskFile.FullName,$taskEntry,[System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally { $taskArchive.Dispose() }
$sources = @(Get-ChildItem -LiteralPath (Join-Path $androidRoot 'app\src') -Recurse -Filter '*.java' | ForEach-Object { $_.FullName })
Invoke-Checked (Join-Path $javaBin 'javac.exe') (@('-encoding','UTF-8','-source','8','-target','8','-classpath',$taskPlatform,'-d',(Join-Path $buildRoot 'classes')) + $sources)
$classesJar = Join-Path $buildRoot 'classes.jar'
Invoke-Checked (Join-Path $javaBin 'jar.exe') @('--create','--file',$classesJar,'-C',(Join-Path $buildRoot 'classes'),'.')
Invoke-Checked (Join-Path $javaBin 'java.exe') @('-cp',(Join-Path $taskBuildTools 'lib\d8.jar'),'com.android.tools.r8.D8','--lib',$taskPlatform,'--min-api','28','--output',(Join-Path $buildRoot 'dex'),$classesJar)
Invoke-Checked (Join-Path $javaBin 'jar.exe') @('--update','--file',$unsignedApk,'-C',(Join-Path $buildRoot 'dex'),'classes.dex')
$alignedApk = Join-Path $buildRoot 'aligned.apk'
Invoke-Checked (Join-Path $taskBuildTools 'zipalign.exe') @('-f','-p','4',$unsignedApk,$alignedApk)
$signingKey = Join-Path $privateRoot 'polaris-android.p12'
$passwordFile = Join-Path $privateRoot 'signing-password.txt'
if (-not (Test-Path -LiteralPath $signingKey)) {
    if (-not (Test-Path -LiteralPath $passwordFile)) {
        $taskPassword = [Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
        [System.IO.File]::WriteAllText($passwordFile,$taskPassword)
    }
    Invoke-Checked (Join-Path $javaBin 'keytool.exe') @('-genkeypair','-keystore',$signingKey,'-storetype','PKCS12','-alias','polaris-air','-keyalg','RSA','-keysize','3072','-validity','10000','-dname','CN=Airline Simulator AOCC Android','-storepass:file',$passwordFile,'-keypass:file',$passwordFile)
}
$outputDirectory = Join-Path $projectRoot 'exports\android'
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
$outputApk = Join-Path $outputDirectory 'Airline-Simulator-AOCC-Android-1.0.0.apk'
Invoke-Checked (Join-Path $javaBin 'java.exe') @('-jar',(Join-Path $taskBuildTools 'lib\apksigner.jar'),'sign','--ks',$signingKey,'--ks-key-alias','polaris-air','--ks-pass',('file:'+$passwordFile),'--out',$outputApk,$alignedApk)
Invoke-Checked (Join-Path $javaBin 'java.exe') @('-jar',(Join-Path $taskBuildTools 'lib\apksigner.jar'),'verify','--verbose',$outputApk)
Invoke-Checked (Join-Path $taskBuildTools 'zipalign.exe') @('-c','4',$outputApk)
$taskArchive = [System.IO.Compression.ZipFile]::OpenRead($outputApk)
try {
    $taskNames = @($taskArchive.Entries | ForEach-Object { $_.FullName })
    if (@($taskNames | Where-Object { $_.Contains('\') }).Count -ne 0) { throw 'APK contains invalid asset path separators.' }
    foreach ($taskFile in (Get-ChildItem -LiteralPath $taskWebRoot -Recurse -File)) {
        $taskEntry = 'assets/' + [System.IO.Path]::GetRelativePath($taskWebRoot,$taskFile.FullName).Replace('\','/')
        if ($taskEntry -cnotin $taskNames) { throw "APK asset missing: $taskEntry" }
    }
} finally { $taskArchive.Dispose() }
$taskHash = (Get-FileHash -LiteralPath $outputApk -Algorithm SHA256).Hash.ToLower()
[System.IO.File]::WriteAllText((Join-Path $outputDirectory 'SHA256.txt'),"$taskHash  Airline-Simulator-AOCC-Android-1.0.0.apk`n")
Write-Output "Android APK: $outputApk"
