# Structure de SynthRider

```
synth-rider-game-development/
├── index.html                    # Template HTML (source)
├── package.json                  # Deps: React 19, Vite 7, Tailwind 4
├── package-lock.json
├── tsconfig.json
├── vite.config.ts                # Config Vite + singlefile + base: '/synthrider/'
├── public/                       # Fichiers publics (vide)
├── src/
│   ├── main.tsx                  # Point d'entree React
│   ├── App.tsx                   # Wrapper React
│   ├── index.css                 # Styles globaux
│   ├── game/
│   │   └── PisteSynthetique.tsx  # Composant principal (997 lignes)
│   └── utils/
│       └── cn.ts                 # Utilitaire de classNames
└── synthrider/                   # Build final
    ├── index.html                # Build single-file (~270 KB)
    ├── og-image.png              # Image Open Graph
    └── favicon.png               # Favicon
```

## Architecture
- **PisteSynthetique.tsx** : Composant principal contenant toute la logique du jeu (piste, vaisseau, gemmes, barrières, powerups, score, audio)
- **audio.ts** : Moteur audio synthétisé (Web Audio API) — kick, snare, hi-hat, basse, pad, arpeggio, lead
- **cn.ts** : Utilitaire pour combiner les classes CSS
