"""Aperçu (indicatif) de l'adversaire de lane en partie live : winrate SoloQ de
la saison, winrate dans le matchup précis contre MON champion, et un "pic
observé" LOCAL.

⚠️ Le "pic" n'est PAS un vrai career-high : Riot n'expose aucun historique de
rang par l'API (seulement le rang courant). C'est le rang le plus haut que
Hexgate a personnellement vu chez ce joueur au fil de VOS parties passées —
il grandit avec le temps, ne part jamais de zéro (sauf 1ère rencontre)."""
from __future__ import annotations

import json
import threading

from . import paths, riot_api

_lock = threading.Lock()


def _load_peaks() -> dict:
    if not paths.OPPONENT_PEAKS_FILE.is_file():
        return {}
    try:
        return json.loads(paths.OPPONENT_PEAKS_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def _save_peaks(data: dict) -> None:
    paths.OPPONENT_PEAKS_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = paths.OPPONENT_PEAKS_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(data), encoding="utf-8")
    tmp.replace(paths.OPPONENT_PEAKS_FILE)


def _update_peak(puuid: str, solo: dict | None) -> dict:
    """Compare le rang actuel au pic connu localement pour ce joueur, met à
    jour si c'est un nouveau plus haut. Retourne l'entrée à jour."""
    with _lock:
        peaks = _load_peaks()
        entry = dict(peaks.get(puuid, {}))
        entry["seen_count"] = entry.get("seen_count", 0) + 1
        if solo and solo.get("tier"):
            score = riot_api._score(solo["tier"], solo.get("division"), solo.get("lp", 0))
            if entry.get("score") is None or score > entry["score"]:
                entry.update({
                    "score": score,
                    "tier": solo["tier"],
                    "division": solo.get("division"),
                    "lp": solo.get("lp", 0),
                })
        peaks[puuid] = entry
        _save_peaks(peaks)
        return entry


def get_insight(riot_id: str, region: str, my_champion: str) -> dict:
    """{puuid, solo: {tier,division,lp,wins,losses}|None, matchup: {wins,losses,sample},
    peak: {tier,division,lp,seen_count}|{"seen_count":N} si jamais classé cette saison}."""
    client = riot_api.RiotClient()
    puuid = client.puuid(riot_id, region)
    solo = client.current_solo(puuid, region)
    matchup = client.matchup_results(puuid, region, my_champion, count=25)
    peak = _update_peak(puuid, solo)
    return {"puuid": puuid, "solo": solo, "matchup": matchup, "peak": peak}
