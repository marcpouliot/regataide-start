# Regataide Start V1

Aide GPS pour départ de régate. Application web/PWA indépendante de Regataide.

## Fonctions

- GPS du téléphone
- Ligne de départ : A = bateau comité, B = bouée
- Passage de la bouée à bâbord ou à tribord
- SYNC 5:00 ou heure officielle de départ
- Distance à la ligne
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
