# Deceive dans Hexgate Swap

Source : [molenzwiebel/Deceive](https://github.com/molenzwiebel/Deceive), commit
`ea18a2e2940125db0c8667e95ad81422e9abda42` (consulté le 29/09/2026).
Licence : GPL-3.0, voir [LICENSE](LICENSE). Les sources complètes de ce
composant et ses modifications sont incluses dans ce dossier.

Modifications Hexgate :

- canal HTTP local authentifié (`HexgateControl.cs`) pour consulter et régler
  la présence, le chat de salon et l'activation du filtre ;
- arrêt du proxy pendant un changement de compte sans commande de fermeture
  des jeux propre au menu Deceive ;
- ami fictif League et présence VALORANT affichés sous le nom « Hexgate » ;
- icône et notification Deceive masquées lorsque le moteur est piloté par Hexgate ;
- messages de cet ami adaptés à Hexgate.

Le moteur utilise toujours le fonctionnement réseau de Deceive. Il récupère
son certificat local depuis l'infrastructure de l'auteur et reste sensible
aux changements du client Riot. Toute distribution de ce composant doit
respecter la GPL-3.0 ; examiner les obligations de l'ensemble distribué avant
une publication de Hexgate Swap.
