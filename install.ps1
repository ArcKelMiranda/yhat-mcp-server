# yhat-mcp Windows Installer
# Run as: powershell -ExecutionPolicy Bypass -File install.ps1

param(
    [string]$InstallPath = "$env:LOCALAPPDATA\yhat-mcp",
    [string]$ReleaseTag,
    [string]$Repository = "ArcKelMiranda/yhat-mcp-server"
)

$ErrorActionPreference = "Stop"
$releaseTagValue = if ($ReleaseTag) { $ReleaseTag } elseif ($env:YHAT_RELEASE_TAG) { $env:YHAT_RELEASE_TAG } else { $null }

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

function Get-ReleaseInfo {
    param(
        [string]$Repository,
        [string]$ReleaseTag
    )

    $uri = if ($ReleaseTag) {
        "https://api.github.com/repos/$Repository/releases/tags/$ReleaseTag"
    } else {
        "https://api.github.com/repos/$Repository/releases/latest"
    }

    $headers = @{ "User-Agent" = "yhat-mcp-installer" }
    if ($env:GITHUB_TOKEN) {
        $headers["Authorization"] = "Bearer $env:GITHUB_TOKEN"
    }

    try {
        Invoke-RestMethod -Uri $uri -Headers $headers -Method Get
    } catch {
        throw "Failed to resolve GitHub release from $uri."
    }
}

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("yhat-mcp-install-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null

try {
    $release = Get-ReleaseInfo -Repository $Repository -ReleaseTag $releaseTagValue
    $archivePath = Join-Path $tempRoot "release.zip"
    $extractDir = Join-Path $tempRoot "source"

    Write-Host "[...] Downloading $($release.tag_name) from GitHub Releases..." -ForegroundColor Yellow
    $downloadHeaders = @{ "User-Agent" = "yhat-mcp-installer" }
    if ($env:GITHUB_TOKEN) {
        $downloadHeaders["Authorization"] = "Bearer $env:GITHUB_TOKEN"
    }
    Invoke-WebRequest -Uri $release.zipball_url -Headers $downloadHeaders -OutFile $archivePath

    Write-Host "[...] Extracting and building release source..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Path $extractDir -Force | Out-Null
    Expand-Archive -Path $archivePath -DestinationPath $extractDir -Force
    $sourceRoot = Get-ChildItem -Path $extractDir -Directory | Select-Object -First 1
    if (-not $sourceRoot) {
        throw "Release archive did not contain a source directory."
    }

    Push-Location $sourceRoot.FullName
    try {
        npm ci
        npm run build:cli
    } finally {
        Pop-Location
    }

    # Create install directory
    if (-not (Test-Path $InstallPath)) {
        New-Item -ItemType Directory -Path $InstallPath -Force | Out-Null
    }

    Write-Host ""
    Write-Host "[...] Copying files..." -ForegroundColor Yellow

    $cliSource = Join-Path $sourceRoot.FullName "dist\cli.cjs"
    $cliDest = Join-Path $InstallPath "cli.cjs"
    $keytarSource = Join-Path $sourceRoot.FullName "node_modules\keytar"
    $keytarDest = Join-Path $InstallPath "node_modules\keytar"

    Copy-Item $cliSource $cliDest -Force

    if (Test-Path $keytarSource) {
        New-Item -ItemType Directory -Path (Split-Path $keytarDest -Parent) -Force | Out-Null
        Copy-Item $keytarSource $keytarDest -Recurse -Force
    } else {
        Write-Host "[WARN] keytar bindings not found; falling back to YHAT_DB_PASSWORD if set." -ForegroundColor Yellow
    }

    $launcher = Join-Path $InstallPath "yhat-mcp.cmd"
    @"
@echo off
node "%~dp0cli.cjs" %*
"@ | Set-Content -Path $launcher -NoNewline

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
} finally {
    Remove-Item $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
