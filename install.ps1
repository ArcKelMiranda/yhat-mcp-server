# yhat-mcp Windows Installer
# Run as: powershell -ExecutionPolicy Bypass -File install.ps1

param(
    [string]$InstallPath = "$env:LOCALAPPDATA\yhat-mcp"
)

$ErrorActionPreference = "Stop"

Write-Host "=== yhat-mcp Windows Installer ===" -ForegroundColor Cyan
Write-Host ""

# Check Node.js
try {
    $nodeVersion = node --version 2>$null
    Write-Host "[OK] Node.js found: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Node.js is not installed. Please install Node.js 20+ from https://nodejs.org" -ForegroundColor Red
    exit 1
}

# Create install directory
if (-not (Test-Path $InstallPath)) {
    New-Item -ItemType Directory -Path $InstallPath -Force | Out-Null
}

Write-Host ""
Write-Host "[...] Copying files..." -ForegroundColor Yellow

# Copy dist files
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$distDir = Join-Path $scriptDir "dist"
$cliDest = Join-Path $InstallPath "cli.js"

if (-not (Test-Path $distDir)) {
    Write-Host "[ERROR] dist/cli.js not found. Run 'npm run build:cli' first." -ForegroundColor Red
    exit 1
}

Copy-Item "$distDir\cli.js" $cliDest -Force
Copy-Item "$distDir\cli.js.map" $InstallPath -Force -ErrorAction SilentlyContinue

# Write version file
$pkgVersion = "0.1.0"
$pkgPath = Join-Path $scriptDir "package.json"
if (Test-Path $pkgPath) {
    $pkgContent = Get-Content $pkgPath -Raw | ConvertFrom-Json
    $pkgVersion = $pkgContent.version
}
Set-Content -Path (Join-Path $InstallPath "version.txt") -Value $pkgVersion -NoNewline

Write-Host "[OK] Files copied to $InstallPath" -ForegroundColor Green

# Add to PATH if not already there
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
$pathEntry = $InstallPath

if ($userPath -notlike "*$pathEntry*") {
    Write-Host ""
    Write-Host "[...] Adding $InstallPath to PATH..." -ForegroundColor Yellow
    $newPath = "$userPath;$pathEntry"
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    $env:Path = "$env:Path;$pathEntry"
    Write-Host "[OK] Added to PATH. You may need to restart your terminal." -ForegroundColor Green
} else {
    Write-Host "[OK] Already in PATH." -ForegroundColor Green
}

Write-Host ""
Write-Host "=== Installation complete! ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Run the setup wizard:" -ForegroundColor White
Write-Host "  yhat-mcp setup" -ForegroundColor Green
Write-Host ""
Write-Host "Other commands:" -ForegroundColor White
Write-Host "  yhat-mcp install   - Add to OpenCode config" -ForegroundColor White
Write-Host "  yhat-mcp config   - Edit whitelist" -ForegroundColor White
Write-Host "  yhat-mcp start    - Start the server" -ForegroundColor White
Write-Host "  yhat-mcp update   - Check for updates" -ForegroundColor White
Write-Host ""
