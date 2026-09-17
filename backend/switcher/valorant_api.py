"""Adaptateur HenrikDev : données publiques Valorant, normalisées pour Hexgate.

Les réponses brutes et la clé ne sont ni persistées ni journalisées. Seul le
résumé utile à l'interface est conservé localement dans les métadonnées du compte.
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter

from . import secure_settings

BASE_URL = "https://api.henrikdev.xyz"
SECRET_KEY = "henrikdev_api_key"

_REGIONS = {
    "EUW": "eu", "EUNE": "eu", "EU": "eu",
    "NA": "na", "LAN": "latam", "LAS": "latam", "BR": "br",
    "KR": "kr", "JP": "ap", "OCE": "ap", "TR": "eu", "RU": "eu",
}


class ValorantApiError(RuntimeError):
    def __init__(self, message: str, code: str = "api_error"):
        super().__init__(message)
        self.code = code


def region_for(league_region: str | None) -> str:
    return _REGIONS.get((league_region or "").upper(), "eu")


def _riot_id(riot_id: str) -> tuple[str, str]:
    name, mark, tag = riot_id.rpartition("#")
    if not mark or not name.strip() or not tag.strip():
        raise ValorantApiError("Ce compte n'a pas de Riot ID complet (Nom#TAG).", "riot_id_missing")
    return name.strip(), tag.strip()


# Optim 2 (PASSATION_HEXGATE_SWAP_V2_1.md §14) : nombre de nouvelles tentatives
# après un 429 avant d'abandonner, et délais d'attente associés (secondes).
# Reste conservateur pour ne jamais aggraver une vraie limite fournisseur.
_RATE_LIMIT_RETRIES = 2
_RATE_LIMIT_BACKOFF = (2.0, 5.0)


def _request(path: str) -> dict:
    key = secure_settings.get_secret(SECRET_KEY)
    if not key:
        raise ValorantApiError("Configure d'abord ta clé HenrikDev dans Réglages > Données & comptes.", "key_missing")
    request = urllib.request.Request(
        BASE_URL + path,
        headers={"Authorization": key, "Accept": "application/json", "User-Agent": "Hexgate-Swap/2"},
    )
    attempt = 0
    while True:
        try:
            with urllib.request.urlopen(request, timeout=18) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            if error.code in (401, 403):
                raise ValorantApiError("La clé HenrikDev est refusée ou expirée.", "key_invalid") from None
            if error.code == 404:
                raise ValorantApiError("Ce profil Valorant est introuvable pour cette région.", "not_found") from None
            if error.code == 429:
                if attempt < _RATE_LIMIT_RETRIES:
                    # Backoff avant de réessayer : une limite HenrikDev touche
                    # tout appelant, jamais seulement un compte — inutile de le
                    # traiter comme une erreur définitive dès la première fois.
                    time.sleep(_RATE_LIMIT_BACKOFF[min(attempt, len(_RATE_LIMIT_BACKOFF) - 1)])
                    attempt += 1
                    continue
                raise ValorantApiError("Limite HenrikDev atteinte : réessaie dans quelques instants.", "rate_limited") from None
            raise ValorantApiError(f"HenrikDev est momentanément indisponible (HTTP {error.code}).") from None
        except (urllib.error.URLError, TimeoutError):
            raise ValorantApiError("HenrikDev est inaccessible pour le moment.", "network") from None
        except json.JSONDecodeError:
            raise ValorantApiError("Réponse HenrikDev invalide.") from None


def _get(mapping: dict, *keys, default=None):
    for key in keys:
        if isinstance(mapping, dict) and mapping.get(key) is not None:
            return mapping[key]
    return default


def _label(value, default: str = "Inconnu") -> str:
    """Convertit les libellés HenrikDev v3/v4 (texte ou objet) en texte UI."""
    if isinstance(value, dict):
        value = _get(value, "name", "display_name", "displayName", "title", "id", default=default)
    if value is None or value == "":
        return default
    return str(value)


def _normalise_rank(payload: dict) -> dict | None:
    data = payload.get("data") if isinstance(payload, dict) else None
    current = _get(data or {}, "current_data", "currentData", default=data or {})
    if not isinstance(current, dict):
        return None
    label = _get(current, "currenttierpatched", "current_tier_patched", "tier_name")
    rr = _get(current, "ranking_in_tier", "rr")
    if label is None and rr is None:
        return None
    return {
        "label": str(label or "Non classé"),
        "rr": int(rr) if isinstance(rr, (int, float)) else None,
        "elo": _get(current, "elo"),
        "last_change": _get(current, "mmr_change_to_last_game", "last_change"),
    }


def _team_result(teams, own_team):
    values = list(teams.values()) if isinstance(teams, dict) else (teams if isinstance(teams, list) else [])
    own = next((team for team in values if str(_get(team, "team_id", "team", "id", default="")).lower() == str(own_team).lower()), None)
    other = next((team for team in values if team is not own), None)
    if not isinstance(own, dict):
        return None, None
    won = _get(own, "has_won", "won")
    def rounds_won(team: dict | None):
        rounds = _get(team or {}, "rounds_won", "roundsWon", "rounds")
        # V4 : `rounds` est parfois {won, lost}, et non un entier.
        if isinstance(rounds, dict):
            rounds = _get(rounds, "won", "wins", "rounds_won")
        return rounds

    if won is None and isinstance(other, dict):
        own_rounds = rounds_won(own)
        other_rounds = rounds_won(other)
        if isinstance(own_rounds, (int, float)) and isinstance(other_rounds, (int, float)):
            won = own_rounds > other_rounds
    own_rounds = rounds_won(own)
    other_rounds = rounds_won(other)
    score = f"{own_rounds}:{other_rounds}" if own_rounds is not None and other_rounds is not None else None
    return bool(won) if isinstance(won, bool) else None, score


def _normalise_matches(payload: dict, name: str, tag: str) -> list[dict]:
    raw_matches = payload.get("data") if isinstance(payload, dict) else []
    if not isinstance(raw_matches, list):
        return []
    result: list[dict] = []
    for raw in raw_matches[:10]:
        if not isinstance(raw, dict):
            continue
        players = raw.get("players") or []
        if isinstance(players, dict):
            players = players.get("all_players") or players.get("players") or []
        player = next((p for p in players if isinstance(p, dict) and str(_get(p, "name", "game_name", default="")).casefold() == name.casefold() and str(_get(p, "tag", "tagline", default="")).casefold() == tag.casefold()), None)
        if not player:
            continue
        metadata = raw.get("metadata") or {}
        map_data = metadata.get("map") if isinstance(metadata.get("map"), dict) else {}
        won, score = _team_result(raw.get("teams"), _get(player, "team_id", "team"))
        stats = player.get("stats") or {}
        result.append({
            "id": str(_get(metadata, "matchid", "match_id", default="")),
            "map": _label(_get(map_data, "name", default=_get(metadata, "map", "map_name", default=None)), "Inconnue"),
            "played_at": _get(metadata, "game_start", "started_at", "game_start_patched"),
            "mode": str(_get(metadata.get("queue") or {}, "name", "mode_type", default="Inconnu")),
            "agent": _label(_get(player, "character", "agent", default=None)),
            "won": won,
            "score": score,
            "kills": _get(stats, "kills"), "deaths": _get(stats, "deaths"), "assists": _get(stats, "assists"),
        })
    return result


def fetch_summary(riot_id: str, league_region: str | None) -> dict:
    """Lit le rang et les dix dernières compétitives, puis retourne le cache UI."""
    name, tag = _riot_id(riot_id)
    region = region_for(league_region)
    q_name, q_tag = urllib.parse.quote(name, safe=""), urllib.parse.quote(tag, safe="")
    # HenrikDev peut connaître le compte mais ne pas encore avoir de MMR/match
    # compétitif (nouveau compte, aucun ranked ou aucune partie indexée). Le
    # profil forcé est l'API prévue pour résoudre cette première situation ; il
    # évite aussi de confondre « pas encore de stats » avec « Riot ID invalide ».
    profile = _request(f"/valorant/v2/account/{q_name}/{q_tag}?force=true")
    profile_data = profile.get("data") if isinstance(profile, dict) else {}
    if isinstance(profile_data, dict) and isinstance(profile_data.get("region"), str):
        region = profile_data["region"].lower()
    try:
        rank = _normalise_rank(_request(f"/valorant/v2/mmr/{region}/{q_name}/{q_tag}"))
    except ValorantApiError as error:
        if error.code != "not_found":
            raise
        rank = None
    try:
        # L'agent principal et l'historique restent utiles même sans classement :
        # on lit donc les dix dernières parties, tous modes confondus.
        matches = _normalise_matches(
            _request(f"/valorant/v4/matches/{region}/pc/{q_name}/{q_tag}?size=10"), name, tag,
        )
    except ValorantApiError as error:
        if error.code != "not_found":
            raise
        matches = []
    agents = Counter(match["agent"] for match in matches if match["agent"] != "Inconnu")
    wins = sum(1 for match in matches if match["won"] is True)
    losses = sum(1 for match in matches if match["won"] is False)
    return {
        "rank": rank,
        "account_level": _get(profile_data if isinstance(profile_data, dict) else {}, "account_level"),
        "title": _get(profile_data if isinstance(profile_data, dict) else {}, "title"),
        "matches": matches,
        "top_agent": agents.most_common(1)[0][0] if agents else None,
        "wins": wins,
        "losses": losses,
        "last_synced": int(time.time()),
        "source": "henrikdev",
    }
