# bench.ps1 - Mesure CPU/RAM de l'arbre de processus Hexgate Swap.
#
# Usage :
#   powershell -ExecutionPolicy Bypass -File tools\bench.ps1 [-Seconds 10] [-Label "baseline"]
#
# Mesure : tauri-app + tous les msedgewebview2 dont la ligne de commande
# reference tauri-app + le backend python (-m switcher.server).
# CPU = delta de TotalProcessorTime sur la fenetre, normalise par le nb de coeurs.
# Scenarios recommandes : (1) app au premier plan idle, (2) app en arriere-plan,
# (3) mode basse consommation au premier plan. Comparer au meme build (release).

param(
    [int]$Seconds = 10,
    [string]$Label = ""
)

function Get-HexgateTree {
    $rows = @()
    $tauri = Get-Process tauri-app -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($tauri) {
        $rows += [pscustomobject]@{ Name = 'tauri-app'; ProcId = $tauri.Id }
    }
    Get-CimInstance Win32_Process -Filter "Name = 'msedgewebview2.exe'" |
        Where-Object { $_.CommandLine -match 'tauri-app' } |
        ForEach-Object {
            $type = 'webview2'
            if ($_.CommandLine -match '--type=([a-z-]+)') { $type = "webview2:$($Matches[1])" }
            $rows += [pscustomobject]@{ Name = $type; ProcId = $_.ProcessId }
        }
    Get-CimInstance Win32_Process -Filter "Name like 'python%'" |
        Where-Object { $_.CommandLine -match 'switcher\.server' } |
        ForEach-Object {
            $rows += [pscustomobject]@{ Name = 'python-backend'; ProcId = $_.ProcessId }
        }
    return $rows
}

$tree = Get-HexgateTree
if (-not $tree -or $tree.Count -eq 0) {
    Write-Host "AUCUN processus Hexgate trouve (lancer l'app d'abord)." -ForegroundColor Red
    exit 1
}

if ($Label) { Write-Host "=== BENCH [$Label] - fenetre $Seconds s ===" -ForegroundColor Cyan }
else { Write-Host "=== BENCH - fenetre $Seconds s ===" -ForegroundColor Cyan }

# Snapshot CPU t0
$t0 = @{}
foreach ($row in $tree) {
    $p = Get-Process -Id $row.ProcId -ErrorAction SilentlyContinue
    if ($p) { $t0[$row.ProcId] = $p.TotalProcessorTime.TotalMilliseconds }
}

Start-Sleep -Seconds $Seconds

# Snapshot t1 + RAM
$cores = [Environment]::ProcessorCount
$report = @()
$totalRam = 0.0
$totalCpuMs = 0.0
foreach ($row in $tree) {
    $p = Get-Process -Id $row.ProcId -ErrorAction SilentlyContinue
    if (-not $p) { continue }
    $ram = [math]::Round($p.WorkingSet64 / 1MB, 1)
    $cpuMs = 0.0
    if ($t0.ContainsKey($row.ProcId)) {
        $cpuMs = $p.TotalProcessorTime.TotalMilliseconds - $t0[$row.ProcId]
    }
    $cpuPct = [math]::Round($cpuMs / ($Seconds * 1000.0) / $cores * 100, 2)
    $totalRam += $ram
    $totalCpuMs += $cpuMs
    $report += [pscustomobject]@{ Process = $row.Name; ProcId = $row.ProcId; RAM_MB = $ram; CPU_pct = $cpuPct }
}

$report | Sort-Object RAM_MB -Descending | Format-Table -AutoSize
$totalCpuPct = [math]::Round($totalCpuMs / ($Seconds * 1000.0) / $cores * 100, 2)
Write-Host ("TOTAL : RAM = {0} Mo | CPU = {1} % ({2} coeurs)" -f [math]::Round($totalRam,1), $totalCpuPct, $cores) -ForegroundColor Yellow

# Connexions SSE ouvertes vers le backend (port 8722)
$sse = (Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue |
    Where-Object { $_.RemotePort -eq 8722 -or $_.LocalPort -eq 8722 }).Count
Write-Host ("Connexions TCP port 8722 (SSE x2 endpoints) : {0}" -f $sse)
