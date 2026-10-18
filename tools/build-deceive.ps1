$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$project = Join-Path $root "third_party\deceive\Deceive\Deceive.csproj"
$output = Join-Path $root "third_party\deceive\Deceive\bin\Release\net472"
$target = Join-Path $root "app\src-tauri\resources\deceive"

$env:DOTNET_CLI_TELEMETRY_OPTOUT = "1"
dotnet build $project -c Release -v quiet
if ($LASTEXITCODE -ne 0) { throw "Build du moteur Deceive échoué." }

New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item -LiteralPath (Join-Path $output "Deceive.exe") -Destination $target -Force
Copy-Item -LiteralPath (Join-Path $output "Deceive.exe.config") -Destination $target -Force
Copy-Item -LiteralPath (Join-Path $root "third_party\deceive\LICENSE") -Destination (Join-Path $target "DECEIVE-LICENSE.txt") -Force
Copy-Item -LiteralPath (Join-Path $root "third_party\deceive\HEXGATE-CHANGES.md") -Destination $target -Force

# Fournir les sources correspondantes du composant GPL avec le binaire.
$sourceRoot = Join-Path $root "third_party\deceive"
$sourceTarget = Join-Path $target "source"
New-Item -ItemType Directory -Force -Path (Join-Path $sourceTarget "Deceive\Properties"), (Join-Path $sourceTarget "Deceive\Resources\games") | Out-Null
Get-ChildItem -LiteralPath $sourceRoot -File | Copy-Item -Destination $sourceTarget -Force
Get-ChildItem -LiteralPath (Join-Path $sourceRoot "Deceive") -File | Copy-Item -Destination (Join-Path $sourceTarget "Deceive") -Force
Get-ChildItem -LiteralPath (Join-Path $sourceRoot "Deceive\Properties") -File | Copy-Item -Destination (Join-Path $sourceTarget "Deceive\Properties") -Force
Get-ChildItem -LiteralPath (Join-Path $sourceRoot "Deceive\Resources") -File | Copy-Item -Destination (Join-Path $sourceTarget "Deceive\Resources") -Force
Get-ChildItem -LiteralPath (Join-Path $sourceRoot "Deceive\Resources\games") -File | Copy-Item -Destination (Join-Path $sourceTarget "Deceive\Resources\games") -Force
Write-Host "Moteur Deceive intégré : $target"
