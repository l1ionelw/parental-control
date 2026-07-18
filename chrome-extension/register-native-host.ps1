# Register the Parental Controls native messaging host for Chrome.
# Run this script as the user who will be running Chrome.

$manifestPath = "D:\PC-Files\Documents\Github\parental-control\chrome-extension\com.parentalcontrol.native_host.json"
$hostName = "com.parentalcontrol.native_host"
$keyPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName"

if (-not (Test-Path $manifestPath)) {
    Write-Error "Manifest not found: $manifestPath"
    exit 1
}

if (-not (Test-Path "HKCU:\Software\Google\Chrome\NativeMessagingHosts")) {
    New-Item -Path "HKCU:\Software\Google\Chrome\NativeMessagingHosts" -Force | Out-Null
}

New-Item -Path $keyPath -Force | Out-Null
Set-ItemProperty -Path $keyPath -Name "(Default)" -Value $manifestPath

Write-Host "Registered native host: $hostName"
Write-Host "  -> $manifestPath"
Write-Host "Restart Chrome and reload the extension."
