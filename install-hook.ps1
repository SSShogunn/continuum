# Continuum — Claude Code auto-context installer (Windows PowerShell).
#
# A bootstrap only: it locates a Python 3.8+, downloads install_hook.py, and
# hands off. The installed hooks are Python too, so the same ones run on every
# platform. Linux/macOS have their own bootstrap, install-hook.sh.
#
# Usage (PowerShell 5.1+ / pwsh):
#   $env:CONTINUUM_TOKEN="<token>"; irm https://continuum-mcp.sshogunn.org/install-hook.ps1 | iex
#
# <token> comes from the dashboard's Connections page ("Generate token"). If
# CONTINUUM_TOKEN isn't set, this prompts for it interactively.
& {
    $ErrorActionPreference = 'Stop'

    $baseUrl = if ($env:CONTINUUM_MCP_URL) { $env:CONTINUUM_MCP_URL } else { 'https://continuum-mcp.sshogunn.org' }
    $baseUrl = $baseUrl.TrimEnd('/')

    $versionCheck = 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)'
    $python = $null
    foreach ($candidate in @(
        @{ Exe = 'py';      Args = @('-3') },
        @{ Exe = 'python';  Args = @() },
        @{ Exe = 'python3'; Args = @() }
    )) {
        if (-not (Get-Command $candidate.Exe -ErrorAction SilentlyContinue)) { continue }
        & $candidate.Exe @($candidate.Args + @('-c', $versionCheck)) 2>$null
        if ($LASTEXITCODE -eq 0) { $python = $candidate; break }
    }
    if (-not $python) {
        Write-Error ("Continuum's Claude Code hooks need Python 3.8 or newer, and none was found on PATH.`n" +
                     "Install it from https://www.python.org/downloads/ (tick `"Add python.exe to PATH`") " +
                     "or run 'winget install Python.Python.3.12', then re-run this command.")
        return
    }

    $workDir = Join-Path ([System.IO.Path]::GetTempPath()) ("continuum-" + [System.Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $workDir -Force | Out-Null
    try {
        $target = Join-Path $workDir 'install_hook.py'
        Invoke-WebRequest -Uri "$baseUrl/install_hook.py" -OutFile $target -UseBasicParsing

        $env:CONTINUUM_MCP_URL = $baseUrl
        & $python.Exe @($python.Args + @($target))
        if ($LASTEXITCODE -ne 0) { Write-Error "Continuum install failed (exit code $LASTEXITCODE)." }
    }
    finally {
        Remove-Item -Recurse -Force $workDir -ErrorAction SilentlyContinue
    }
}
