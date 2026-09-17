# Empaquette le backend Python en sidecar autonome (PyInstaller) pour un build
# release distribuable — Optim 1, PASSATION_HEXGATE_SWAP_V2_1.md §14.
#
# Ne dépend plus d'un `python` installé sur la machine cible ni du chemin
# absolu de développement.
#
# --onedir (pas --onefile) : constat Yaniss du 17/09/2026, « les comptes
# mettent plusieurs secondes avant d'apparaître » au lancement. Un onefile
# réextrait TOUT le runtime Python dans un dossier temporaire à CHAQUE
# démarrage (~2 s mesurées ici) avant même que le serveur puisse écouter ;
# un onedir est déjà décompressé sur disque, donc démarre quasi instantanément.
# Le prix : ce n'est plus un fichier .exe unique mais un dossier
# (hexgate-backend.exe + son sous-dossier _internal/), donc le mécanisme
# "externalBin" de Tauri (qui ne gère qu'un binaire plat) ne s'applique plus —
# le dossier entier est copié comme resource Tauri (voir tauri.conf.json et
# src-tauri/src/lib.rs, qui le résout via resource_dir() et le lance en
# std::process::Command direct plutôt que via le plugin shell/sidecar).
#
# Usage (depuis la racine du projet) :
#   powershell -File tools/build-sidecar.ps1
#
# Prérequis : `pip install pyinstaller` (outil de build uniquement — le
# backend runtime reste stdlib, cf. CLAUDE.md/PASSATION §2.4).

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root "backend"
$resourcesDir = Join-Path $root "app\src-tauri\resources"
$distDir = Join-Path $backend "dist"
$buildDir = Join-Path $backend "build"

$assetsDir = Join-Path $backend "assets"

Push-Location $backend
try {
    # --add-data embarque backend/assets/ (emblèmes de rank) dans le sous-dossier
    # "assets" que lit ui_assets.assets_dir() via sys._MEIPASS (pointe vers
    # _internal/ en onedir, identique au comportement onefile). Sans ça,
    # rank_emblem() ne trouve jamais les PNG et retombe silencieusement sur le
    # badge hexagone+lettre dessiné — régression du 14/09/2026, invisible en
    # dev car `python -m switcher.server` lit assets/ directement sur le disque.
    python -m PyInstaller `
        --name hexgate-backend `
        --distpath $distDir `
        --workpath $buildDir `
        --specpath $buildDir `
        --add-data "$assetsDir;assets" `
        --console `
        --clean `
        --noconfirm `
        entry.py

    if ($LASTEXITCODE -ne 0) {
        throw "PyInstaller a échoué (code $LASTEXITCODE)."
    }
} finally {
    Pop-Location
}

$source = Join-Path $distDir "hexgate-backend"
if (-not (Test-Path (Join-Path $source "hexgate-backend.exe"))) {
    throw "Dossier onedir attendu introuvable : $source"
}

$target = Join-Path $resourcesDir "hexgate-backend"
if (Test-Path $target) {
    Remove-Item -Recurse -Force $target
}
New-Item -ItemType Directory -Force -Path $resourcesDir | Out-Null
Copy-Item -Path $source -Destination $target -Recurse -Force

Write-Host "Sidecar packagé (onedir) : $target" -ForegroundColor Green
