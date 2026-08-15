# Continuum — Claude Code auto-context uninstaller (Windows PowerShell).
#
# A bootstrap only: it locates a Python 3.8+, downloads uninstall_hook.py, and
# hands off. Pure local cleanup, no token needed. Linux/macOS have their own
# bootstrap, uninstall-hook.sh.
#
# Usage (PowerShell 5.1+ / pwsh):
#   irm https://continuum-mcp.sshogunn.org/uninstall-hook.ps1 | iex
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
        Write-Error ("No Python 3.8+ found on PATH — delete $env:USERPROFILE\.continuum and the " +
                     "continuum-* files in $env:USERPROFILE\.claude\hooks by hand, then remove their " +
                     "entries from $env:USERPROFILE\.claude\settings.json.")
        return
    }

    $workDir = Join-Path ([System.IO.Path]::GetTempPath()) ("continuum-" + [System.Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $workDir -Force | Out-Null
    try {
        $target = Join-Path $workDir 'uninstall_hook.py'
        Invoke-WebRequest -Uri "$baseUrl/uninstall_hook.py" -OutFile $target -UseBasicParsing
        & $python.Exe @($python.Args + @($target))
    }
    finally {
        Remove-Item -Recurse -Force $workDir -ErrorAction SilentlyContinue
    }
}
