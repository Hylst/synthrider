# Changelog — SynthRider

## [1.3.0] 2026-08-03

### Ajouté
- Bouton « ℹ️ Comment ce jeu a été fait » sur l'écran titre, ouvrant une modale distincte de
  la modale « Règles et Contrôles » existante (stack, graphismes, musique, interactions,
  architecture, algorithmes notables : projection pseudo-3D, générateur d'obstacles à graine
  fixe donc identique à chaque partie). Étape 15 du chantier de retrofit décrit dans
  `todo.md` racine du monorepo.

### Corrigé
- Tiret long dans le crédit de l'écran titre (« par Hylst — Geoff ») remplacé par une
  virgule, en conformité avec la règle du dépôt.

### Vérifié
- Build propre, modale testée à l'ouverture/fermeture, coexistence confirmée avec la modale
  Règles existante (même nom de composant `InfoModal` déjà utilisé dans ce fichier, la
  nouvelle modale a été nommée `AboutModal` pour éviter toute collision), aucune erreur
  console, aucun débordement horizontal en 390×844.

## [1.2.0] — 2026-07-28
### Ajouté
- Vaisseau rendu 3D amélioré (détails visuels)
- Synchro voie instantané (snap voie)
- Collision/rendu synchro X
- Hint Synchro retiré (nettoyage UI)
- Meilleure gestion des chevauchements de notes

## [1.1.0] — 2025-06-14
### Corrige
- Collision detectée trop tard (hitZone 0.085 → 0.16)
- URLs SEO incorrectes (/pseudo-3d-rhythm-runner-game/ → /synthrider/)
### Ajoute
- Meta tags SEO complets (og, twitter, canonical, robots)
- Image Open Graph via HuggingFace FLUX.1-dev
- Favicon (vaisseau synthwave)

## [1.0.0] — 2025-06-14
### Ajoute
- Premier jeu : **SynthRider** (`/synthrider/`)
- Course rythmique pseudo-3D synthwave
- 5 voies avec déplacement fluide
- Système de combo avec multiplicateur (×1 à ×5)
- Gemmes cyan et jaunes à collecter
- Barrières magenta à esquiver
- Powerups : bouclier, boost, ralenti
- Jauge Synchro → Surcharge (mode invincible)
- Audio synthétisé en temps réel (Web Audio API)
- Progression d'accords : Am - F - C - G
- Contrôles tactiles et clavier
- Écran titre, pause, game over, victoire
- Onboarding intégré (4 étapes)
- Responsive (mobile + desktop)
