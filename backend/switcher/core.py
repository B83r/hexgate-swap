"""Orchestration : swap de compte et ajout de compte sans perte de session.

Points clés appris en test :
- Riot fait tourner le jeton de session (ssid) à chaque reconnexion : une
  sauvegarde n'est valable qu'une fois → avant d'écraser les fichiers live,
  on re-sauvegarde toujours la session fraîche du compte actif.
- « Se déconnecter » dans le client invalide la session côté serveur : la
  sauvegarde du compte meurt. Pour ajouter un compte, on efface les fichiers
  de session locaux (le client affiche le login) au lieu de se déconnecter.
- Après restauration, l'API locale du client dit si la session est acceptée
  (phase != 'Login') ; on s'en sert pour détecter les sessions mortes et
  pour lancer le jeu.
"""
import time
from collections.abc import Callable

from . import client_api, lcu_api, process, vault

StatusCb = Callable[[str], None]


class SessionExpired(Exception):
    """La session sauvegardée a été rejetée par Riot (probablement invalidée
    par une déconnexion manuelle dans le client)."""


def swap(name: str, product: str = "league_of_legends",
         on_status: StatusCb = lambda _: None) -> None:
    if product not in process.PRODUCTS:
        raise ValueError("produit Riot inconnu")
    # Relevé AVANT l'arrêt du client : une fois Riot tué, plus aucune API locale
    # ne peut dire à qui appartient la session live qu'on s'apprête à re-sauvegarder.
    try:
        live_identity = client_api.current_identity()
    except client_api.ClientNotRunning:
        live_identity = None
    on_status("Fermeture du client Riot…")
    process.kill_riot()
    refreshed = vault.refresh_active(expected_identity=live_identity)
    if refreshed and refreshed != name:
        on_status(f"Session de « {refreshed} » re-sauvegardée.")
    on_status(f"Restauration de la session « {name} »…")
    vault.restore(name)
    vault.set_active(name)
    on_status("Relance du client…")
    process.launch_product(product)
    _wait_and_launch_product(name, product, on_status)


class WrongAccountLoggedIn(Exception):
    """Le client s'est connecté sur un compte autre que celui demandé."""


def _assert_expected_account(name: str) -> None:
    """Vérifie que le compte RÉELLEMENT connecté est bien celui du swap.

    `swap()` marquait `name` comme actif sans jamais confronter ce nom au compte
    effectivement connecté — `is_logged_in()` ne dit que « une session existe »,
    jamais « laquelle ». Quand le client revenait sur un autre compte (session
    persistante du client Riot, restauration sans effet), le pointeur mentait :
    le watcher de rang écrasait alors la fiche de `name` avec les données de
    l'autre compte toutes les 120 s, et au swap suivant `refresh_active()`
    recopiait la session de l'autre compte DANS le dossier de `name` — écrasant
    ses identifiants. C'est le scénario qui a détruit « FREEPALESTINE#M280 »
    le 14/09/2026.

    Sans identité connue pour le compte (fiche neuve), on ne peut rien vérifier :
    on laisse passer, la première synchronisation l'enregistrera.
    """
    identity = client_api.current_identity()
    if not identity:
        return
    accounts = {a.name: a for a in vault.list_accounts()}
    account = accounts.get(name)
    if account is None:
        return
    known_puuid = vault.account_puuid(name)
    if known_puuid:
        if identity["puuid"] == known_puuid:
            return
    elif not account.riot_id or not identity.get("riot_id"):
        return  # aucune référence fiable : rien à vérifier
    elif identity["riot_id"] == account.riot_id:
        return

    # Identité contredite : on efface le pointeur plutôt que de le laisser
    # mentir — un pointeur vide est inoffensif, un pointeur faux détruit.
    vault.set_active(None)
    raise WrongAccountLoggedIn(
        f"Le client s'est connecté sur « {identity.get('riot_id') or identity['puuid']} » "
        f"et non sur « {name} ».\n\n"
        "Le swap a été interrompu pour protéger tes comptes : sans cette "
        "vérification, les données et la session de « " + name + " » auraient été "
        "écrasées par celles de l'autre compte.\n\n"
        "Pour réparer : déconnecte-toi dans le client Riot, puis relance le swap."
    )


def _wait_and_launch_product(name: str, product: str, on_status: StatusCb,
                             timeout: float = 120.0) -> None:
    """Attend le verdict du client sur la session restaurée, puis lance le jeu.

    Session acceptée → phase quitte 'Login' et l'autorisation RSO passe à 200.
    Session morte → le client reste sur 'Login' sans autorisation.
    """
    on_status("Attente de la reconnexion…")
    deadline = time.monotonic() + timeout
    login_since = None
    launch_announced = False
    while time.monotonic() < deadline:
        try:
            if client_api.is_logged_in():
                _assert_expected_account(name)
                if not launch_announced:
                    game_name = "VALORANT" if product == "valorant" else "League of Legends"
                    on_status(f"Session acceptée — lancement de {game_name}…")
                    launch_announced = True
                # Le product-launcher n'est pas prêt immédiatement après le
                # login : on retente à chaque tour jusqu'à acceptation.
                if client_api.launch_product(product):
                    on_status(f"Connecté sur « {name} », le jeu se lance.")
                    return
                time.sleep(0.5)
                continue
            current_phase = client_api.phase()
        except client_api.ClientNotRunning:
            time.sleep(0.5)  # le client démarre encore
            continue
        if current_phase == "Login":
            login_since = login_since or time.monotonic()
            if time.monotonic() - login_since > 25:
                vault.mark_expired(name)
                vault.set_active(None)
                raise SessionExpired(
                    f"La session sauvegardée de « {name} » a été rejetée par Riot.\n\n"
                    "Cause la plus fréquente : une déconnexion manuelle "
                    "(« Se déconnecter ») dans le client, qui invalide la session "
                    "côté serveur.\n\n"
                    "Pour réparer : connecte-toi sur ce compte dans le client "
                    "(« Rester connecté » coché), puis clique "
                    "« Sauvegarder la session actuelle » avec le même nom."
                )
        else:
            login_since = None
        time.sleep(0.5)
    raise TimeoutError("Le client n'a pas fini de démarrer dans le temps imparti.")


def prepare_new_login(product: str = "league_of_legends",
                      on_status: StatusCb = lambda _: None) -> None:
    """Amène le client sur la page de login SANS invalider la session actuelle."""
    try:
        live_identity = client_api.current_identity()
    except client_api.ClientNotRunning:
        live_identity = None
    on_status("Fermeture du client Riot…")
    process.kill_riot()
    refreshed = vault.refresh_active(expected_identity=live_identity)
    if refreshed:
        on_status(f"Session de « {refreshed} » re-sauvegardée.")
    vault.clear_live_session()
    vault.set_active(None)
    on_status("Relance du client…")
    process.launch_product(product)
    on_status("Connecte-toi (« Rester connecté » coché !) puis clique "
              "« Sauvegarder la session actuelle ».")


def reconnect_expired(name: str, on_status: StatusCb = lambda _: None,
                      timeout: float = 300.0) -> None:
    """Reconnecte un compte marqué expiré : amène le client sur la page de login,
    puis sauvegarde automatiquement la session dès que l'utilisateur s'est reconnecté
    manuellement sur le bon compte (aucun mot de passe n'est géré par l'application).
    """
    account = next((a for a in vault.list_accounts() if a.name == name), None)
    if account is None:
        raise FileNotFoundError(f"Compte « {name} » introuvable.")
    expected_riot_id = account.riot_id

    prepare_new_login(on_status=lambda _m: None)
    on_status(
        f"Reconnecte-toi sur « {expected_riot_id or name} » "
        "(« Rester connecté » coché), la session sera sauvegardée automatiquement…"
    )

    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        time.sleep(2)
        try:
            if not client_api.is_logged_in():
                continue
            summoner = lcu_api.current_summoner()
        except (client_api.ClientNotRunning, lcu_api.LeagueNotRunning):
            continue
        if not summoner:
            continue
        if expected_riot_id and summoner["riot_id"] != expected_riot_id:
            raise ValueError(
                f"Connecté sur « {summoner['riot_id']} » au lieu de « {expected_riot_id} » : "
                "reconnexion annulée pour éviter d'écraser le mauvais compte."
            )
        vault.capture(name, refresh=True)
        on_status(f"Session de « {name} » ressauvegardée automatiquement.")
        return
    raise TimeoutError("Reconnexion non détectée dans le temps imparti (5 minutes).")


def update_active_profile(timeout: float = 120.0) -> str | None:
    """Attend le client LoL puis rafraîchit riot id / niveau / rank du compte actif.

    À lancer dans un thread de fond après un swap ou une sauvegarde.
    Retourne le riot id récupéré, ou None si le client LoL n'est pas venu.
    """
    name = vault.get_active()
    if not name:
        return None
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if vault.get_active() != name:
            return None  # un autre swap est passé entre-temps
        try:
            summoner = lcu_api.current_summoner()
        except lcu_api.LeagueNotRunning:
            summoner = None
        if summoner:
            try:
                rank = lcu_api.ranked_stats()
            except lcu_api.LeagueNotRunning:
                rank = None
            try:
                w = lcu_api.wallet()
            except lcu_api.LeagueNotRunning:
                w = None
            vault.update_profile(name, riot_id=summoner["riot_id"],
                                 level=summoner.get("level"), rank=rank,
                                 icon_id=summoner.get("icon_id"), wallet=w,
                                 puuid=summoner.get("puuid"))
            return summoner["riot_id"]
        time.sleep(3)
    return None


def suggest_account_name() -> str | None:
    """Riot ID du compte connecté, si le client LoL tourne (pour pré-remplir le nom)."""
    try:
        summoner = lcu_api.current_summoner()
    except lcu_api.LeagueNotRunning:
        return None
    return summoner["riot_id"] if summoner else None


def capture_current(name: str) -> "vault.Account":
    """Sauvegarde la session courante, en vérifiant d'abord via l'API locale
    que le client est réellement connecté (évite de sauvegarder une session vide)."""
    try:
        if not client_api.is_logged_in():
            raise ValueError(
                "Le client Riot n'est pas connecté : impossible de sauvegarder.\n"
                "Connecte-toi d'abord (« Rester connecté » coché)."
            )
    except client_api.ClientNotRunning:
        pass  # client fermé : on se fie au contenu du fichier de session
    return vault.capture(name)
