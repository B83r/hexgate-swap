param(
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$projectRoot = Split-Path -Parent $PSScriptRoot
$assetRoot = Join-Path $projectRoot "app/public/assets/riot/communitydragon"
$latestRoot = "https://raw.communitydragon.org/latest/plugins"
$gameDataRoot = "$latestRoot/rcp-be-lol-game-data/global/default"

function Save-Asset {
    param(
        [Parameter(Mandatory)][string]$Url,
        [Parameter(Mandatory)][string]$RelativePath
    )

    $destination = Join-Path $assetRoot $RelativePath
    if (-not $Force -and (Test-Path -LiteralPath $destination)) {
        return
    }

    $parent = Split-Path -Parent $destination
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    Invoke-WebRequest -Uri $Url -OutFile $destination -UseBasicParsing -TimeoutSec 60
}

# Embarquer toutes les voix disponibles rend l'ajout futur d'un champion local.
$voiceRoot = "$gameDataRoot/v1/champion-choose-vo"
$voiceIndex = Invoke-WebRequest -Uri "$voiceRoot/" -UseBasicParsing -TimeoutSec 60
$voiceFiles = @(
    $voiceIndex.Links.href |
        Where-Object { $_ -match '^\d+\.ogg$' } |
        Sort-Object -Unique
)
foreach ($file in $voiceFiles) {
    Save-Asset -Url "$voiceRoot/$file" -RelativePath "champion-choose-vo/$file"
}

$perkRoot = "$gameDataRoot/v1/perk-images/styles"
$perkFiles = @(
    "precision/presstheattack/presstheattack.png",
    "precision/lethaltempo/lethaltempotemp.png",
    "precision/fleetfootwork/fleetfootwork.png",
    "precision/conqueror/conqueror.png",
    "domination/electrocute/electrocute.png",
    "domination/predator/predator.png",
    "domination/darkharvest/darkharvest.png",
    "domination/hailofblades/hailofblades.png",
    "sorcery/summonaery/summonaery.png",
    "sorcery/arcanecomet/arcanecomet.png",
    "sorcery/phaserush/stormraiderssurgeruneicon2.png",
    "resolve/graspoftheundying/graspoftheundying.png",
    "resolve/veteranaftershock/veteranaftershock.png",
    "resolve/guardian/guardian.png",
    "inspiration/glacialaugment/glacialaugment.png",
    "inspiration/unsealedspellbook/unsealedspellbook.png",
    "inspiration/firststrike/firststrike.png",
    "7201_precision.png",
    "7200_domination.png",
    "7202_sorcery.png",
    "7204_resolve.png",
    "7203_whimsy.png"
)
foreach ($file in $perkFiles) {
    Save-Asset -Url "$perkRoot/$file" -RelativePath "perk-images/styles/$file"
}

$borderRoot = "$latestRoot/rcp-fe-lol-static-assets/global/default/images/uikit/themed-borders"
foreach ($theme in 1..21) {
    $file = "theme-$theme-border.png"
    Save-Asset -Url "$borderRoot/$file" -RelativePath "profile-borders/$file"
}

$crestRoot = "$latestRoot/rcp-fe-lol-static-assets/global/default/images/ranked-mini-crests"
$tiers = @("unranked", "iron", "bronze", "silver", "gold", "platinum", "emerald", "diamond", "master", "grandmaster", "challenger")
foreach ($tier in $tiers) {
    Save-Asset -Url "$crestRoot/$tier.svg" -RelativePath "ranked-mini-crests/$tier.svg"
}

$gameModeRoot = "$gameDataRoot/content/src/leagueclient/gamemodeassets"
Save-Asset -Url "$gameModeRoot/classic_sru/img/game-select-icon-default.png" -RelativePath "game-modes/normal.png"
Save-Asset -Url "$gameModeRoot/aram/img/game-select-icon-default.png" -RelativePath "game-modes/aram.png"
Save-Asset -Url "$latestRoot/rcp-fe-lol-parties/global/default/golden-spatula-club-icon.png" -RelativePath "game-modes/mayhem.png"
# Arena est saisonnier et absent de certaines versions `latest`; 15.9 reste immuable.
Save-Asset -Url "https://raw.communitydragon.org/15.9/plugins/rcp-be-lol-game-data/global/default/content/src/leagueclient/gamemodeassets/cherry/img/game-select-icon-default.png" -RelativePath "game-modes/arena.png"

$manifest = [ordered]@{
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    source = "CommunityDragon (Riot Games assets)"
    voiceFiles = $voiceFiles.Count
    perkFiles = $perkFiles.Count
    profileBorders = 21
    rankedCrests = $tiers.Count
    gameModeIcons = 4
}
$manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $assetRoot "manifest.json") -Encoding utf8

Write-Output "CommunityDragon assets synchronized in $assetRoot"
Write-Output ("Files: {0}" -f ($voiceFiles.Count + $perkFiles.Count + 21 + $tiers.Count + 4))
