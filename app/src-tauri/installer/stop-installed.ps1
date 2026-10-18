param([Parameter(Mandatory = $true)][string]$InstallDir)

$ErrorActionPreference = 'Stop'
try {
    $installRoot = [IO.Path]::GetFullPath($InstallDir)
    $targets = @(
        (Join-Path $installRoot 'tauri-app.exe'),
        (Join-Path $installRoot 'resources\hexgate-backend\hexgate-backend.exe')
    )
    # Only this installation's processes; never Riot, League, or another copy.
    $running = @(Get-Process -Name 'tauri-app', 'hexgate-backend' -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -and $targets -contains $_.Path })
    foreach ($process in $running) {
        if (-not $process.HasExited) {
            try {
                $process.Kill()
                if (-not $process.WaitForExit(10000)) {
                    throw 'Hexgate did not exit within 10 seconds.'
                }
            } catch {
                # The backend can exit itself as soon as its parent is stopped.
                if (-not $process.HasExited) { throw }
            }
        }
    }
    # Wait for the DLL from the reported failure to be released before copying.
    $lockedDll = Join-Path $installRoot 'resources\hexgate-backend\_internal\PIL\_imaging.cp312-win_amd64.pyd'
    if (Test-Path -LiteralPath $lockedDll) {
        $deadline = [DateTime]::UtcNow.AddSeconds(10)
        while ($true) {
            try {
                $handle = [IO.File]::Open($lockedDll, 'Open', 'ReadWrite', 'None')
                $handle.Dispose()
                break
            } catch {
                if ([DateTime]::UtcNow -ge $deadline) { throw }
                Start-Sleep -Milliseconds 200
            }
        }
    }
    exit 0
} catch {
    Write-Error $_ -ErrorAction Continue
    exit 1
}
