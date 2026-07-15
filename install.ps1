# yhat-mcp Windows Installer
# Run as: powershell -ExecutionPolicy Bypass -File install.ps1

param(
    [string]$InstallPath = "$env:LOCALAPPDATA\yhat-mcp",
    [string]$ReleaseTag,
    [string]$Repository = "ArcKelMiranda/yhat-mcp-server"
)

$ErrorActionPreference = "Stop"
$releaseTagValue = if ($ReleaseTag) { $ReleaseTag } elseif ($env:YHAT_RELEASE_TAG) { $env:YHAT_RELEASE_TAG } else { $null }

function Get-NodeVersion {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodeCommand) {
        return $null
    }

    try {
        $rawVersion = & node --version 2>$null
    } catch {
        return $null
    }

    if ($rawVersion -match '^v(\d+)\.(\d+)\.(\d+)$') {
        return [version]"$($Matches[1]).$($Matches[2]).$($Matches[3])"
    }

    return $null
}

function Ensure-NodeVersion {
    param(
        [version]$Version
    )

    if (-not $Version) {
        return
    }

    if ($Version.Major -lt 20) {
        throw "Node.js $Version is installed, but Node.js 20+ is required. Upgrade Node.js and rerun the installer."
    }
}

function Get-NodeInstallCandidates {
    $candidates = @()

    if ($env:ProgramFiles) {
        $candidates += (Join-Path $env:ProgramFiles "nodejs\node.exe")
    }

    if (${env:ProgramFiles(x86)}) {
        $candidates += (Join-Path ${env:ProgramFiles(x86)} "nodejs\node.exe")
    }

    return $candidates | Where-Object { $_ -and (Test-Path $_) }
}

function Install-NodeViaWinget {
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $winget) {
        throw "Node.js 20+ is required but missing. winget was not found, so automatic installation is unavailable on Windows. Install Node.js 20+ from https://nodejs.org or enable winget and rerun the installer."
    }

    Write-Host "[...] Node.js is missing; bootstrapping Node.js 20+ via winget..." -ForegroundColor Yellow

    & winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements --silent
    if ($LASTEXITCODE -ne 0) {
        throw "winget could not install Node.js automatically. Install Node.js 20+ from https://nodejs.org or rerun after winget is repaired."
    }

    foreach ($candidate in Get-NodeInstallCandidates) {
        $candidateDir = Split-Path $candidate -Parent
        if ($env:Path -notlike "*$candidateDir*") {
            $env:Path = "$candidateDir;$env:Path"
        }
    }
}

function Ensure-NodeRuntime {
    $nodeVersion = Get-NodeVersion
    if ($nodeVersion) {
        Ensure-NodeVersion -Version $nodeVersion
        return
    }

    Install-NodeViaWinget

    $nodeVersion = Get-NodeVersion
    if (-not $nodeVersion) {
        foreach ($candidate in Get-NodeInstallCandidates) {
            $candidateDir = Split-Path $candidate -Parent
            if ($env:Path -notlike "*$candidateDir*") {
                $env:Path = "$candidateDir;$env:Path"
            }
        }

        $nodeVersion = Get-NodeVersion
    }

    if (-not $nodeVersion) {
        throw "winget finished, but Node.js is still unavailable from this shell. Close and reopen PowerShell, then rerun the installer."
    }

    Ensure-NodeVersion -Version $nodeVersion
}

Write-Host "=== yhat-mcp Windows Installer ===" -ForegroundColor Cyan
Write-Host ""

# Check Node.js or bootstrap it when missing
try {
    Ensure-NodeRuntime
    $nodeVersion = node --version 2>$null
    Write-Host "[OK] Node.js found: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] $($_.Exception.Message)" -ForegroundColor Red
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
