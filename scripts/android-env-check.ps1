# Prints what the Android build sees (no changes made).
'local.properties: ' + (Get-Content (Join-Path (Split-Path -Parent $PSScriptRoot) 'android\local.properties') -Raw)
'ANDROID_HOME=' + $env:ANDROID_HOME
'ANDROID_SDK_ROOT=' + $env:ANDROID_SDK_ROOT
'Default SDK path exists: ' + (Test-Path (Join-Path $env:LOCALAPPDATA 'Android\Sdk\platforms'))
'Searching for Android SDK copies (platforms\android-36)...'
$candidates = @(
  (Join-Path $env:LOCALAPPDATA 'Android\Sdk'),
  'C:\Android\Sdk', 'D:\Android\Sdk', 'C:\Program Files\Android\Sdk'
)
Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Packages') -Directory -ErrorAction SilentlyContinue | ForEach-Object {
  $candidates += (Join-Path $_.FullName 'LocalCache\Local\Android\Sdk')
}
$candidates | Where-Object { Test-Path (Join-Path $_ 'platforms\android-36') } | ForEach-Object { 'FOUND: ' + $_ }
'done'
