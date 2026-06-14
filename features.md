# Fonctionnalites de SynthRider

## Gameplay
- Course rythmique pseudo-3D synthwave
- 5 voies avec deplacement fluide
- Objectif : atteindre 2400 mètres sans crash
- BPM : 120, BEAT_SEC : 0.5s

## Systeme de score
- Gemmes cyan (+10 pts) et jaunes (+25 pts)
- Combo avec multiplicateur : ×1 (0-4), ×2 (5-9), ×3 (10-19), ×4 (20-39), ×5 (40+)
- Jauge Synchro → Surcharge (mode invincible 3.8s)

## Entités
- **Barrières** : obstacles magenta à esquiver
- **Gemmes** : objets à collecter (cyan = normal, jaune = premium)
- **Powerups** : bouclier (3 max), boost (×2, 5s), ralenti (-40%, 5s)

## Audio
- Tout est synthétisé en temps réel (Web Audio API)
- Progression d'accords : Am - F - C - G
- Instruments : kick, snare, hi-hat, basse sawtooth, pad, arpeggio, lead
- Effets sonores : pickup, dodge, powerup, surge, shield, crash

## Rendu
- Canvas 2D 100% vectoriel (aucune image externe)
- Ciel dégradé, soleil synthwave, montagnes, étoiles
- Grille perspective animée
- Particules et textes flottants

## Controles
- Clavier : flèches (← →) ou (A D)
- Mobile : swipe ou boutons tactiles
- Espace : Surcharge
- P / Échap : Pause
- M : Mute
- H : Règles

## Statistiques
- BPM : 120
- Distance totale : 2400m
- Voies : 5 (0-4)
- Collision : hitZone = 0.16 (screenY ≈ h×0.87)
- Taille build : ~270 KB (single-file)
