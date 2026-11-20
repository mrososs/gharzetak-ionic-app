# Builds the Google Play Android App Bundle (AAB) from the CURRENT checkout (Windows PowerShell). Never uploads anything.
#
#   .\scripts\android-release.ps1 -ApiUrl https://<release-worker> -LegalBaseUrl https://<legal-site> [-GoogleWebClientId <id>]
#
# * Stops before building if the release configuration is incomplete (GZ_RELEASE=1 makes scripts/set-env.mjs refuse a missing legal URL).
# * Signs the bundle ONLY when android/keystore.properties exists (see android/app/build.gradle). Otherwise the AAB is UNSIGNED and the
#   script says so. No key is ever generated, read or printed here.
# * Prints the AAB path and its SHA-256.
param(
  [Parameter(Mandatory = $true)][string]$ApiUrl,
  [Parameter(Mandatory = $true)][string]$LegalBaseUrl,
  [string]$GoogleWebClientId = ''
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (Test-Path 'D:\mostqel\.tools\node24\node.exe') { $env:PATH = 'D:\mostqel\.tools\node24;' + $env:PATH }
$jbr = 'C:\Program Files\Android\Android Studio\jbr'
if (Test-Path $jbr) { $env:JAVA_HOME = $jbr }
if (Test-Path 'D:\Android\Sdk') { $env:ANDROID_HOME = 'D:\Android\Sdk' } elseif (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
Set-Location $root

$env:GZ_RELEASE = '1'
$env:GZ_API_URL = $ApiUrl
$env:GZ_LEGAL_BASE_URL = $LegalBaseUrl
if ($GoogleWebClientId) { $env:GZ_GOOGLE_WEB_CLIENT_ID = $GoogleWebClientId }
# A release must never ship demo flags or a local URL.
foreach ($bad in 'localhost', '127.0.0.1', '10.0.2.2') { if ($ApiUrl -like "*$bad*") { throw "ApiUrl points at a local host: $ApiUrl" } }

npm run build
if ($LASTEXITCODE) { exit $LASTEXITCODE }
npx cap sync android
if ($LASTEXITCODE) { exit $LASTEXITCODE }

Set-Location (Join-Path $root 'android')
$signed = Test-Path 'keystore.properties'
.\gradlew.bat --stop | Out-Null
.\gradlew.bat bundleRelease --no-configuration-cache
if ($LASTEXITCODE) { exit $LASTEXITCODE }
$aab = Join-Path $root 'android\app\build\outputs\bundle\release\app-release.aab'
$hash = (Get-FileHash $aab -Algorithm SHA256).Hash
Write-Host ''
Write-Host 'AAB:    ' $aab
Write-Host 'SHA-256:' $hash
if ($signed) { Write-Host 'Signing: signed with the key in android/keystore.properties (verify with: jarsigner -verify -verbose -certs <aab>)' }
else { Write-Host 'Signing: UNSIGNED (android/keystore.properties not found). Play Console will not accept this file until it is signed with your upload key.' -ForegroundColor Yellow }
