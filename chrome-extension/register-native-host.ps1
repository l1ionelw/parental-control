# Register the Parental Controls native messaging host for Chrome.
# Run this script as the user who will be running Chrome.
# The manifest checked into the repo uses a relative "path"; Chrome requires
# an absolute path, so this script resolves it against this script's own
# location and writes the resolved manifest to a per-machine file (not
# tracked by git) rather than baking a machine-specific path into the repo.

$templatePath = Join-Path $PSScriptRoot "com.parentalcontrol.native_host.json"
$exePath = Join-Path $PSScriptRoot "native-host.exe"
$hostName = "com.parentalcontrol.native_host"
$keyPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName"

if (-not (Test-Path $templatePath)) {
    Write-Error "Manifest template not found: $templatePath"
    exit 1
}

if (-not (Test-Path $exePath)) {
    Write-Error "native-host.exe not found: $exePath"
    exit 1
}

$manifest = Get-Content $templatePath -Raw | ConvertFrom-Json
$manifest.path = $exePath
$manifestDir = Join-Path $env:LOCALAPPDATA "ParentalControl"
New-Item -ItemType Directory -Path $manifestDir -Force | Out-Null
$manifestPath = Join-Path $manifestDir "com.parentalcontrol.native_host.json"
$manifest | ConvertTo-Json | Set-Content -Path $manifestPath -Encoding UTF8

if (-not (Test-Path "HKCU:\Software\Google\Chrome\NativeMessagingHosts")) {
    New-Item -Path "HKCU:\Software\Google\Chrome\NativeMessagingHosts" -Force | Out-Null
}

New-Item -Path $keyPath -Force | Out-Null
Set-ItemProperty -Path $keyPath -Name "(Default)" -Value $manifestPath

Write-Host "Registered native host: $hostName"
Write-Host "  -> $manifestPath"
Write-Host "Restart Chrome and reload the extension."
