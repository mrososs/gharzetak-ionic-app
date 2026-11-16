# Builds the Android debug APK (Windows PowerShell).
# Uses Android Studio's bundled JDK 21 (Gradle 8.14 does not run on JDK 25) and the portable Node 24.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (Test-Path 'D:\mostqel\.tools\node24\node.exe') { $env:PATH = 'D:\mostqel\.tools\node24;' + $env:PATH }
$jbr = 'C:\Program Files\Android\Android Studio\jbr'
if (Test-Path $jbr) { $env:JAVA_HOME = $jbr }
if (Test-Path 'D:\Android\Sdk') { $env:ANDROID_HOME = 'D:\Android\Sdk' } elseif (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
Set-Location $root
npm run build
if ($LASTEXITCODE) { exit $LASTEXITCODE }
npx cap sync android
if ($LASTEXITCODE) { exit $LASTEXITCODE }
Set-Location (Join-Path $root 'android')
.\gradlew.bat --stop | Out-Null
.\gradlew.bat assembleDebug --no-configuration-cache
if ($LASTEXITCODE) { exit $LASTEXITCODE }
Write-Host ''
Write-Host 'APK:' (Join-Path $root 'android\app\build\outputs\apk\debug\app-debug.apk')
