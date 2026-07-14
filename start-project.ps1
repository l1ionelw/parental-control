# Start Windsurf and run both terminals via Command Palette (reliable timing)
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$projectPath = $scriptDir

# Open Windsurf with project folder (reuse window if already open)
& windsurf --reuse-window $projectPath

# Wait for window to be ready
Start-Sleep -Seconds 3

# Add Windows.Forms for SendKeys
Add-Type -AssemblyName System.Windows.Forms

# Focus Windsurf
$wshell = New-Object -ComObject WScript.Shell
$wshell.AppActivate("Windsurf")
Start-Sleep -Seconds 1

# Function to open terminal via Command Palette
function OpenTerminal {
    [System.Windows.Forms.SendKeys]::SendWait("^+p")  # Ctrl+Shift+P
    Start-Sleep -Seconds 1
    [System.Windows.Forms.SendKeys]::SendWait("Terminal: Create New Terminal{ENTER}")
    Start-Sleep -Seconds 1
}

# Terminal 1: Server
OpenTerminal
[System.Windows.Forms.SendKeys]::SendWait("cd server{ENTER}")
Start-Sleep -Seconds 1
[System.Windows.Forms.SendKeys]::SendWait(".\venv\Scripts\activate{ENTER}")
Start-Sleep -Seconds 2
[System.Windows.Forms.SendKeys]::SendWait("python server.py{ENTER}")
Start-Sleep -Seconds 2

# Terminal 2: React Client
OpenTerminal
[System.Windows.Forms.SendKeys]::SendWait("cd react-client{ENTER}")
Start-Sleep -Seconds 1
[System.Windows.Forms.SendKeys]::SendWait("npm run dev{ENTER}")

Write-Host "Done! Both terminals running in Windsurf."

# Open trayapp.sln in Visual Studio 2022
$trayappPath = Join-Path $projectPath "trayapp\trayapp.sln"
if (Test-Path $trayappPath) {
    Start-Process $trayappPath
    Write-Host "Opened trayapp.sln in Visual Studio"
} else {
    Write-Warning "trayapp.sln not found at $trayappPath"
}

# Open OpenCode desktop app
$opencodePath = "$env:USERPROFILE\AppData\Local\Programs\@opencode-aidesktop\OpenCode.exe"
if (Test-Path $opencodePath) {
    Start-Process $opencodePath
    Write-Host "Opened OpenCode desktop app"
} else {
    Write-Warning "OpenCode not found at $opencodePath"
}