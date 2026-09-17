"""Client Riot API (officiel) pour backfiller un vrai graphe de progression SoloQ.

Utilise Account-V1 (PUUID) + League-V4 (rang actuel) + Match-V5 (historique des
parties classées) pour reconstruire une courbe de rang partie-par-partie.

⚠️ Limites honnêtes (déjà expliquées à l'utilisateur, non contournables) :
- La Riot API n'expose PAS le LP exact gagné/perdu à chaque partie passée. La
  courbe reconstruite est donc EXACTE sur la suite des victoires/défaites et sur
  le rang final (League-V4), mais le LP intermédiaire est ESTIMÉ (pas à pas, à
  rebours depuis le LP actuel avec un gain/perte typique).
- Elle n'expose pas non plus le vrai classement ladder (hors Master+) ni le MMR.

La clé (RIOT_API_KEY) est lue depuis un .env local à la racine du projet — jamais
committée. Une clé *dev* expire toutes les 24 h : en cas de 401/403 « clé
invalide », en régénérer une sur developer.riotgames.com.
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
import concurrent.futures
import os
import threading
from pathlib import Path

# --- Chargement de la clé depuis .env (racine du projet, un cran au-dessus du package) ---
_PROJECT_ROOT = Path(__file__).resolve().parent.parent


def _load_env_key() -> str | None:
    key = os.environ.get("RIOT_API_KEY")
    if key:
        return key.strip()
    env_file = _PROJECT_ROOT / ".env"
    if not env_file.is_file():
        return None
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("#") or "=" not in line:
            continue
        name, _, value = line.partition("=")
        if name.strip() == "RIOT_API_KEY":
            return value.split("#", 1)[0].strip().strip('"').strip("'")
    return None


class RiotApiError(RuntimeError):
    """Erreur d'appel à la Riot API (message affichable à l'utilisateur)."""


# Cloudflare, devant la Riot API, bloque le User-Agent « Python-urllib » par
# défaut (403 « error code: 1010 ») — un UA navigateur est OBLIGATOIRE.
_HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}

_match_cache: dict[str, dict] = {}
_cache_lock = threading.Lock()

# Région courte (stockée dans meta.json / le yaml Riot) → host plateforme + host régional.
# La Riot API v5 (match) et Account-V1 passent par le host RÉGIONAL (europe/americas/asia),
# League-V4 par le host PLATEFORME (euw1, na1, …).
_PLATFORM = {
    "EUW": "euw1", "EUW1": "euw1", "EUNE": "eun1", "EUN1": "eun1",
    "NA": "na1", "NA1": "na1", "KR": "kr", "BR": "br1", "BR1": "br1",
    "LAN": "la1", "LA1": "la1", "LAS": "la2", "LA2": "la2",
    "OCE": "oc1", "OC1": "oc1", "TR": "tr1", "TR1": "tr1",
    "RU": "ru", "JP": "jp1", "JP1": "jp1",
}
_REGIONAL = {
    "euw1": "europe", "eun1": "europe", "tr1": "europe", "ru": "europe",
    "na1": "americas", "br1": "americas", "la1": "americas", "la2": "americas",
    "oc1": "americas",  # OCE routé sur americas pour match-v5
    "kr": "asia", "jp1": "asia",
}

RANKED_SOLO_QUEUE = 420  # queueId Match-V5 des parties classées SoloQ

# Ordre des tiers / divisions — DOIT rester aligné sur vault._TIERS/_DIVS et
# rank.ts (échelle tier*400 + div*100 + lp).
_TIERS = ["IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD",
          "DIAMOND", "MASTER", "GRANDMASTER", "CHALLENGER"]
_DIV_TO_I = {"IV": 0, "III": 1, "II": 2, "I": 3}
_I_TO_DIV = ["IV", "III", "II", "I"]
_APEX = {"MASTER", "GRANDMASTER", "CHALLENGER"}

# Gain/perte de LP typiques utilisés pour reconstruire la courbe à rebours.
# Approximation assumée : la Riot API ne donne pas le LP réel par partie.
_LP_WIN = 21
_LP_LOSS = 19


def _score(tier: str, division: str | None, lp: int) -> int:
    ti = _TIERS.index(tier)
    di = 0 if tier in _APEX else _DIV_TO_I.get(division or "I", 3)
    return ti * 400 + di * 100 + lp


def _score_to_rank(score: int) -> dict:
    """Inverse de _score : score d'échelle → {tier, division, lp}. Copie fidèle de
    rank.ts scoreToRank pour que le point reconstruit s'affiche pareil côté UI."""
    s = max(0, score)
    ti = min(len(_TIERS) - 1, s // 400)
    tier = _TIERS[ti]
    rem = s - ti * 400
    if tier in _APEX:
        return {"tier": tier, "division": None, "lp": max(0, round(rem))}
    di = max(0, min(3, rem // 100))
    return {"tier": tier, "division": _I_TO_DIV[di], "lp": max(0, min(99, round(rem - di * 100)))}


class RiotClient:
    def __init__(self, key: str | None = None):
        self.key = key or _load_env_key()
        if not self.key:
            raise RiotApiError("Aucune clé Riot API (RIOT_API_KEY absent du .env).")

    def _get(self, host: str, path: str, params: dict | None = None):
        url = f"https://{host}.api.riotgames.com{path}"
        if params:
            url += "?" + urllib.parse.urlencode(params)
        req = urllib.request.Request(url, headers={**_HEADERS, "X-Riot-Token": self.key})
        for attempt in range(4):
            try:
                with urllib.request.urlopen(req, timeout=15) as r:
                    return json.load(r)
            except urllib.error.HTTPError as e:
                if e.code == 429:  # rate-limit : respecter Retry-After puis réessayer
                    wait = int(e.headers.get("Retry-After", "2"))
                    time.sleep(min(wait, 10))
                    continue
                if e.code in (401, 403):
                    raise RiotApiError(
                        "Clé Riot API refusée (401/403). Une clé dev expire toutes "
                        "les 24 h — régénère-la sur developer.riotgames.com."
                    ) from e
                if e.code == 404:
                    return None
                raise RiotApiError(f"Riot API {e.code} sur {path}.") from e
            except (urllib.error.URLError, TimeoutError) as e:
                if attempt == 3:
                    raise RiotApiError(f"Riot API injoignable ({e}).") from e
                time.sleep(1)
        raise RiotApiError("Riot API : trop de tentatives (rate-limit).")

    def _hosts(self, region: str) -> tuple[str, str]:
        platform = _PLATFORM.get((region or "").upper(), "euw1")
        regional = _REGIONAL.get(platform, "europe")
        return platform, regional

    def puuid(self, riot_id: str, region: str) -> str:
        if "#" not in riot_id:
            raise RiotApiError(f"Riot ID invalide (pseudo#TAG attendu) : {riot_id!r}")
        game, tag = riot_id.split("#", 1)
        _, regional = self._hosts(region)
        data = self._get(regional, f"/riot/account/v1/accounts/by-riot-id/"
                         f"{urllib.parse.quote(game)}/{urllib.parse.quote(tag)}")
        if not data or "puuid" not in data:
            raise RiotApiError(f"Compte introuvable via Riot API : {riot_id}")
        return data["puuid"]

    def current_solo(self, puuid: str, region: str) -> dict | None:
        """Entrée SoloQ actuelle (League-V4) : {tier, division, lp, wins, losses} ou None."""
        platform, _ = self._hosts(region)
        entries = self._get(platform, f"/lol/league/v4/entries/by-puuid/{puuid}") or []
        for e in entries:
            if e.get("queueType") == "RANKED_SOLO_5x5":
                return {
                    "tier": e.get("tier"),
                    "division": e.get("rank"),
                    "lp": e.get("leaguePoints", 0),
                    "wins": e.get("wins", 0),
                    "losses": e.get("losses", 0),
                }
        return None

    def ranked_solo_results(self, puuid: str, region: str, count: int = 20) -> list[dict]:
        """Parties SoloQ récentes (Match-V5), du plus récent au plus ancien :
        [{win: bool, end: ts_seconds}]. Filtre le queueId 420."""
        _, regional = self._hosts(region)
        params = {"type": "ranked", "start": 0, "count": max(1, min(count, 90))}
        ids = self._get(regional, f"/lol/match/v5/matches/by-puuid/{puuid}/ids", params) or []
        
        def fetch_match(mid):
            with _cache_lock:
                if mid in _match_cache:
                    return _match_cache[mid]
            m = self._get(regional, f"/lol/match/v5/matches/{mid}")
            if m:
                with _cache_lock:
                    _match_cache[mid] = m
                    if len(_match_cache) > 100:
                        oldest = next(iter(_match_cache))
                        _match_cache.pop(oldest, None)
            return m

        # Fetch in parallel
        fetched_matches = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
            fetched_matches = list(executor.map(fetch_match, ids))

        results = []
        for mid, m in zip(ids, fetched_matches):
            if not m:
                continue
            info = m.get("info", {})
            if info.get("queueId") != RANKED_SOLO_QUEUE:
                continue
            me = next((p for p in info.get("participants", []) if p.get("puuid") == puuid), None)
            if me is None:
                continue
            end_ms = info.get("gameEndTimestamp") or info.get("gameStartTimestamp") or 0
            results.append({"win": bool(me.get("win")), "end": end_ms / 1000.0})
        return results

    def matchup_results(self, puuid: str, region: str, my_champion: str, count: int = 25) -> dict:
        """Sur les `count` dernières parties ranked (Solo+Flex) de `puuid`, cherche
        les games où SON adversaire de lane (même teamPosition, équipe adverse à
        la sienne) jouait `my_champion`, et retourne son bilan W/L dans ce
        matchup précis : {wins, losses, sample}. Indicatif : échantillon limité
        aux dernières games, pas un historique complet du matchup."""
        _, regional = self._hosts(region)
        params = {"type": "ranked", "start": 0, "count": max(1, min(count, 100))}
        ids = self._get(regional, f"/lol/match/v5/matches/by-puuid/{puuid}/ids", params) or []

        def fetch_match(mid):
            with _cache_lock:
                if mid in _match_cache:
                    return _match_cache[mid]
            m = self._get(regional, f"/lol/match/v5/matches/{mid}")
            if m:
                with _cache_lock:
                    _match_cache[mid] = m
                    if len(_match_cache) > 100:
                        oldest = next(iter(_match_cache))
                        _match_cache.pop(oldest, None)
            return m

        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
            fetched = list(executor.map(fetch_match, ids))

        wins = losses = 0
        my_champion_l = my_champion.lower()
        for m in fetched:
            if not m:
                continue
            info = m.get("info", {})
            if info.get("queueId") not in (420, 440):
                continue
            participants = info.get("participants", [])
            target = next((p for p in participants if p.get("puuid") == puuid), None)
            if not target:
                continue
            role = target.get("teamPosition") or target.get("individualPosition")
            if not role or role == "UNKNOWN":
                continue
            opp = next(
                (p for p in participants
                 if p.get("teamId") != target.get("teamId")
                 and (p.get("teamPosition") or p.get("individualPosition")) == role),
                None,
            )
            if not opp or opp.get("championName", "").lower() != my_champion_l:
                continue
            if target.get("win"):
                wins += 1
            else:
                losses += 1
        return {"wins": wins, "losses": losses, "sample": wins + losses}

    def active_shard(self, puuid: str, game: str = "lol") -> str:
        try:
            _, regional = self._hosts("EUW")  # regional Europe is a safe hub for Account-V1
            data = self._get(regional, f"/riot/account/v1/active-shards/by-game/{game}/by-puuid/{puuid}")
            if data and "activeShard" in data:
                return data["activeShard"].upper()
        except Exception:
            pass
        return "?"

    def server_status(self, region: str) -> dict | None:
        try:
            platform, _ = self._hosts(region)
            return self._get(platform, "/lol/status/v4/platform-data")
        except Exception:
            return None

    def fetch_match_history(self, puuid: str, region: str, count: int = 20) -> list[dict]:
        """Récupère les count derniers matchs ranked Solo/Flex et retourne les détails nécessaires :
        {match_id, ts, queue_id, champion, win, kills, deaths, assists, duration_s, cs, role}
        """
        _, regional = self._hosts(region)
        params = {"type": "ranked", "start": 0, "count": max(1, min(count, 90))}
        ids = self._get(regional, f"/lol/match/v5/matches/by-puuid/{puuid}/ids", params) or []
        
        def fetch_match(mid):
            with _cache_lock:
                if mid in _match_cache:
                    return _match_cache[mid]
            m = self._get(regional, f"/lol/match/v5/matches/{mid}")
            if m:
                with _cache_lock:
                    _match_cache[mid] = m
                    if len(_match_cache) > 100:
                        oldest = next(iter(_match_cache))
                        _match_cache.pop(oldest, None)
            return m

        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
            fetched_matches = list(executor.map(fetch_match, ids))

        results = []
        for mid, m in zip(ids, fetched_matches):
            if not m:
                continue
            info = m.get("info", {})
            qid = info.get("queueId")
            if qid not in (420, 440):
                continue
            me = next((p for p in info.get("participants", []) if p.get("puuid") == puuid), None)
            if me is None:
                continue
            cs = me.get("totalMinionsKilled", 0) + me.get("neutralMinionsKilled", 0)
            end_ms = info.get("gameEndTimestamp") or info.get("gameStartTimestamp") or 0
            perks = me.get("perks", {})
            styles = perks.get("styles", [])
            keystone_id = 0
            sub_style_id = 0
            if len(styles) > 0:
                selections = styles[0].get("selections", [])
                if len(selections) > 0:
                    keystone_id = selections[0].get("perk", 0)
            if len(styles) > 1:
                sub_style_id = styles[1].get("style", 0)

            results.append({
                "match_id": mid,
                "ts": end_ms / 1000.0,
                "queue_id": qid,
                "champion": me.get("championName"),
                "win": bool(me.get("win")),
                "kills": me.get("kills", 0),
                "deaths": me.get("deaths", 0),
                "assists": me.get("assists", 0),
                "duration_s": info.get("gameDuration", 0),
                "cs": cs,
                "role": me.get("teamPosition") or me.get("individualPosition") or "UNKNOWN",
                "items": [me.get(f"item{i}", 0) for i in range(7)],
                "keystone_id": keystone_id,
                "sub_style_id": sub_style_id,
                "vision_score": me.get("visionScore", 0),
                "wards_placed": me.get("wardsPlaced", 0),
                "wards_killed": me.get("wardsKilled", 0),
                "pink_placed": me.get("detectorWardsPlaced", 0)
            })
        return results


def backfill_history(riot_id: str, region: str, count: int = 20) -> tuple[list[dict], dict]:
    """Reconstruit une liste de points d'historique SoloQ (du plus ancien au plus
    récent) à partir des `count` dernières parties classées, à rebours depuis le
    rang actuel. Retourne (points, solo_actuel) — le rang actuel est renvoyé à
    part pour que l'appelant puisse aussi rafraîchir le rang affiché du compte
    (`meta["rank"]["solo"]`), sinon l'en-tête reste figé sur la dernière valeur
    lue via le LCU alors que le graphe, lui, est à jour.
    Format des points identique à vault.rank_history :
    {ts, tier, division, lp, wins, losses}.

    Le rang final (dernier point) = donnée EXACTE (League-V4). Les W/L sont EXACTS.
    Le LP intermédiaire est ESTIMÉ (±LP typique par partie)."""
    client = RiotClient()
    puuid = client.puuid(riot_id, region)
    solo = client.current_solo(puuid, region)
    if not solo or solo.get("tier") not in _TIERS:
        raise RiotApiError("Ce compte n'a pas de rang SoloQ classé cette saison "
                           "(rien à reconstruire).")
    matches = client.ranked_solo_results(puuid, region, count)
    if not matches:
        raise RiotApiError("Aucune partie classée SoloQ récente trouvée via la Riot API.")

    # État final = rang actuel (après la partie la plus récente = matches[0]).
    score = _score(solo["tier"], solo["division"], solo["lp"])
    wins, losses = solo["wins"], solo["losses"]

    # matches[0] = plus récent. On produit un point APRÈS chaque partie, puis on
    # recule d'une partie (retire le delta LP estimé + décrémente W/L).
    points: list[dict] = []
    for mi in matches:  # du plus récent au plus ancien
        rank = _score_to_rank(score)
        points.append({
            "ts": mi["end"],
            "tier": rank["tier"], "division": rank["division"], "lp": rank["lp"],
            "wins": wins, "losses": losses,
        })
        # reculer d'une partie : défaire l'effet de CETTE partie
        if mi["win"]:
            score = max(0, score - _LP_WIN)
            wins = max(0, wins - 1)
        else:
            score += _LP_LOSS
            losses = max(0, losses - 1)

    points.reverse()  # plus ancien → plus récent (ordre attendu par le graphe)
    return points, solo


def fetch_match_history(riot_id: str, region: str, count: int = 20) -> list[dict]:
    client = RiotClient()
    puuid = client.puuid(riot_id, region)
    return client.fetch_match_history(puuid, region, count)
