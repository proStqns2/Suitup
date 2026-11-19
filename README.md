# Suitup — MARK 86 Suit-Up AR

Dépôt du projet : expérience web **Iron Man Suit-Up** en réalité augmentée webcam.
Ouvre la caméra du PC et l'armure s'assemble à l'écran sur toi, en utilisant les
images détourées, les vidéos et le modèle 3D Blender fournis.

## Démarrer

```bash
cd iron-man-ar
npm install
npm run dev -- -H 0.0.0.0 -p 3000
```

Puis ouvrir l'URL du serveur (localhost ou prévisualisation HTTPS) et autoriser
la webcam. Bouton « Démo sans caméra » disponible en secours.

📖 Documentation complète : **[iron-man-ar/README.md](iron-man-ar/README.md)**

## Contenu

| Dossier | Rôle |
|---|---|
| `iron-man-ar/` | site Next.js (app, composants, HUD, scène WebGL) |
| `iron-man-ar/public/armor/` | images détourées + 3 vidéos |
| `iron-man-ar/public/models/` | GLB exportés depuis `The_Nano_Tech_Shader_V2.blend` |
| `iron-man-ar/public/mediapipe/` | moteur de suivi corporel local (pas de CDN) |
| `iron-man-ar/tools/` | scripts Blender pour régénérer les GLB et le rendu |
| `*.png`, `*.mp4`, `*.blend` (racine) | sources originales du projet |

Le modèle Blender est réellement exploité : `tools/export_blender.py` convertit
le mesh « Suzanne » et ses textures packed en `nanotech_head.glb`, et crée un
réacteur 3D ; le site les ancre sur les repères du corps avec three.js.
