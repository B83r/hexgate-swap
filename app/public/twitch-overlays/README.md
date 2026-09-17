# NextRank Twitch overlays

Ces overlays HTML sont prévus pour une **Source navigateur** OBS en 1920×1080.
Le fond de chaque page est transparent.

## Pages

- `corner.html` — badge compact, placé en bas à droite par défaut.
- `strip.html` — bandeau inférieur, placé en bas à gauche par défaut.
- `hud.html` — panneau de rang, placé en haut à droite par défaut.
- `mark.html` — logo minimal, placé en haut à gauche par défaut.
- `index.html` — galerie de démonstration; son fond sombre n'est pas transparent.

## Utilisation locale dans OBS

1. Ajouter une **Source navigateur**.
2. Activer **Fichier local**.
3. Sélectionner l'une des quatre pages HTML ci-dessus.
4. Utiliser une largeur de `1920` et une hauteur de `1080`.
5. Activer l'arrêt de la source quand elle n'est pas visible si souhaité.

## Personnalisation par URL

Pour utiliser les paramètres, désactiver **Fichier local** et saisir une URL `file:///` vers la page.

Exemple :

```text
file:///C:/Users/yaniss/hexgate-swap-v2/app/public/twitch-overlays/hud.html?rank=IMMORTAL&align=br&scale=1.1
```

Paramètres disponibles :

- `align=tl|tr|bl|br|center`
- `scale=0.5` à `2`
- `motion=off` pour désactiver les animations
- `rank=RADIANT` pour le HUD
- `partner=THIS%20STREAM` pour le Corner Signal
- `session=RANKED%20TEAMMATE%20SESSION` et `site=NEXTRANK.EU` pour le bandeau
