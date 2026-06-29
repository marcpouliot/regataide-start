# Regataide Start2 V1

Aide GPS pour départ de régate. Application web/PWA indépendante de Regataide.

## Fonctions

- GPS du téléphone
- Carte Leaflet/OpenStreetMap
- Ligne de départ : A = bateau comité, B = bouée
- Passage de la bouée à bâbord ou à tribord
- SYNC 5:00 ou heure officielle de départ
- Distance à la ligne : mode perpendiculaire ou centre de ligne
- Affichage graphique du bateau, de la ligne A-B, du centre et du point GAP
- Vitesse actuelle
- Vitesse idéale vers la prochaine minute pile
- Affichage en nœuds ou milles/heure
- Interface multilingue français/anglais avec fichiers `i18n/fr.json` et `i18n/en.json`
- Guides d’utilisation : `guide-fr.html` et `guide-en.html`

## Test local

```bash
python3 -m http.server 8080
```

Puis ouvrir :

```text
http://localhost:8080
```

Sur téléphone, utiliser idéalement HTTPS via GitHub Pages ou Vercel, car le GPS navigateur peut être bloqué hors contexte sécurisé.

## Limite importante

Le GPS d’un téléphone peut varier de plusieurs mètres. Cette app est une aide tactique, pas un outil officiel de jugement de ligne.

## Carte

La carte utilise Leaflet et les tuiles OpenStreetMap. Elle demande une connexion internet pour charger la bibliothèque et les fonds de carte. Si la carte ne charge pas, le mode texte de l’app continue de fonctionner.

## Configurations JSON

Par défaut, la V1 charge :

- Comité A : `45.840722, -71.112139`
- Bouée B : `45.9404030, -71.1172860`

Le panneau **Configuration** permet :

- de choisir un nom de fichier ;
- de sauvegarder localement sur le téléphone ;
- d’exporter un fichier `.json` ;
- de recharger un fichier `.json` plus tard.

Le navigateur téléchargera le fichier dans le dossier de téléchargements de l’appareil. L’app ne peut pas choisir directement un dossier arbitraire pour des raisons de sécurité navigateur.
