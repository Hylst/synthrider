# SynthRider

**Course rythmique pseudo-3D synthwave — 100% navigateur, gratuit.**

Jouez sur : https://games.hylst.fr/synthrider/

## Description

SynthRider est un jeu de course rythmique rétro-futuriste. Pilotez un vaisseau sur une piste synthwave pseudo-3D à 120 BPM, esquivez les barrières, collectez les gemmes et atteignez 2400 mètres.

## Fonctionnalités

- 5 voies sur piste courbe en perspective pseudo-3D
- Système de combo et multiplicateur de score
- Gemmes cyan et jaunes à collecter
- Barrières magenta à esquiver
- Pouvoirs : Bouclier, Turbo (×2 score), Ralenti
- Jauge Synchro → Surcharge (traverse les barrières)
- Audio synthwave générée en temps réel (Web Audio API)
- 100% vectoriel, zéro image externe
- Responsive (desktop + mobile)
- Contrôles : clavier (flèches) ou tactile (swipe)

## Stack technique

- React 19 + TypeScript 5.9
- Tailwind CSS 4
- Canvas 2D (API native)
- Web Audio API (audio synthwave procédural)
- Vite 7 (bundler)

## Lancement en développement

```bash
cd pseudo-3d-rhythm-runner-game
npm install
npm run dev
```

## Build de production

```bash
npm run build
```

Le build produit un unique fichier `dist/index.html` (via `vite-plugin-singlefile`).

## Contrôles

| Action | Clavier | Mobile |
|--------|---------|--------|
| Gauche | ← ou A | Swipe ← ou bouton ◀ |
| Droite | → ou D | Swipe → ou bouton ▶ |
| Surcharge | Espace | Bouton ⚡ |
| Pause | P / Échap | — |
| Son | M | — |
| Règles | H | — |

## Crédits

Créé par **Hylst** (Geoffroy Streit) avec l'aide d'une IA.
