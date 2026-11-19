# MARK 86 · Suit-Up AR

Site web (Next.js / React / TypeScript / three.js) qui transforme la webcam du PC
en miroir d'essayage Iron Man : dès que la caméra s'ouvre, le suivi corporel
verrouille les épaules/hanches et l'armure **s'assemble à l'écran sur la personne**,
en combinant les images, les vidéos et le modèle Blender fournis.

## Lancer le projet

```bash
cd iron-man-ar
npm install
npm run dev -- -H 0.0.0.0 -p 3000
```

Ouvrir `http://localhost:3000` (ou l'URL HTTPS de prévisualisation). La caméra
demande un contexte sécurisé : `localhost` ou HTTPS. Autoriser l'accès webcam dans
le navigateur.

```bash
npm run build   # build de production
npm run lint    # ESLint
```

> **Pas de caméra ?** Cliquer sur « Démo sans caméra » (ou `D`) : la séquence
> complète joue sur un mannequin virtuel avec les mêmes calques, vidéos et modèle 3D.

## Ce qui a été amélioré (v2)

| | v1 | v2 |
|---|---|---|
| Suivi corporel | MediaPipe chargé depuis un CDN externe (+ pont OpenPose optionnel) | **MediaPipe Pose embarqué en local** (`public/mediapipe`), aucun réseau externe requis |
| Images | 4 découpes superposées | **5 découpes** (dont le gant/répulseur ancré sur le poignet), affichage par étape avec fondus |
| Vidéos | 1 effet `screen` | **3 vidéos** : fond vert incrusté en chroma key WebGL, cinématique de transformation plein écran, effet de formation du casque |
| Modèle Blender | inutilisé | **`.blend` exporté en GLB** (Suzanne + matériau Nano Tech FX V2), shader de matérialisation nano-tech, réacteur ARC 3D et vitrine 3D sur l'accueil |
| UI | HUD simple | HUD complet, toggles, raccourcis clavier, capture PNG, plein écran, galerie des assets, écran d'accueil |
| Robustesse | build cassé (`startEquip` utilisé avant déclaration) | build + lint propres, mode dégradé si le modèle de suivi ne charge pas |

## Déroulé de l'expérience

1. **Ouvrir la caméra** : vue miroir, chargement du moteur MediaPipe local,
   scan corporel (squelette + cadre HUD).
2. **Verrouillage** : similarité 2D entre les repères calibrés de chaque découpe et
   les repères du corps (épaules, hanches, nez). Interpolation à 60 fps.
3. **Transition cinématique** : `kling-v3_b_generer_moi_une_vidi.mp4` plein écran.
4. **Assemblage en 5 étapes** :
   `mark86_chest_half` → `mark86_frame_repulsor` → `mark86_repulsor_closed` →
   `mark86_frame_helmet` → `armure_terminee`.
   Pendant l'assemblage : vidéo fond vert `Untitled 97_1080p_7.mp4` détourée en
   temps réel (chroma key shader), `HDRjxWl.mp4` en blend `screen`, modèle 3D
   Blender qui se matérialise, réacteur ARC 3D pulsant.
5. **Équipé** : l'armure suit les mouvements ; capture PNG possible.

Un filet de sécurité déclenche l'équipement automatiquement après ~4 s si le
suivi corporel n'est pas disponible (placement centré).

## Contrôles

| Touche | Action |
|---|---|
| `C` | ouvrir / couper la caméra |
| `D` | mode démo sans caméra |
| `E` | équiper maintenant |
| `R` | rejouer la séquence |
| `S` | capturer un PNG (webcam + calques + scène 3D) |
| `H` | afficher / masquer le HUD |
| `F` | plein écran |

Toggles du HUD : modèle 3D, vidéo nano-tech, FX cinéma, squelette, miroir, HUD.

## Assets utilisés

- `public/armor/cutouts/*.webp` : 5 découpes transparentes + `*.json` de repères
  anatomiques calibrés (MediaPipe Pose).
- `public/armor/*.mp4` :
  - `Untitled 97_1080p_7.mp4` — torse/casque sur fond vert → chroma key WebGL ;
  - `kling-v3_b_generer_moi_une_vidi.mp4` — transformation cinématique ;
  - `HDRjxWl.mp4` — formation du casque (blend `screen`).
- `public/models/nanotech_head.glb` — mesh Suzanne (12 755 sommets) + textures
  PBR 1K extraites du `.blend`, exporté depuis `The_Nano_Tech_Shader_V2.blend`.
- `public/models/arc_reactor.glb` — réacteur créé dans Blender.
- `public/models/nano_panel.jpg` — texture « Sci-Fi Panel 20 » du `.blend`, utilisée
  par le shader de matérialisation nano-tech.
- `public/posters/*` — vignettes vidéo + rendu Cycles du shader Blender.
- `public/mediapipe/*` — runtime MediaPipe Pose (Apache-2.0, package npm
  `@mediapipe/pose@0.5.1675469404`) : `pose.js`, WASM SIMD/non-SIMD, `binarypb`,
  modèles TFLite lite/full. Servis en local, pas de CDN.

## Pipeline Blender (reproductible)

Les GLB ne sont pas des fichiers « magiques » : voir `tools/export_blender.py`.

```bash
# Avec Blender installé :
blender -b --python iron-man-ar/tools/export_blender.py
# Avec le module Python bpy (numpy requis) :
python iron-man-ar/tools/export_blender.py
```

Le script ouvre le `.blend`, extrait les textures packed (downscalées en 1K),
recentre/décime le mesh, reconstruit un matériau PBR exportable en glTF et génère
`nanotech_head.glb`, `arc_reactor.glb` et `nano_panel.jpg`.
`tools/render_model_poster.py` régénère la vignette du shader avec Cycles.

> Le shader procédural « Nano_tech_V2 » du `.blend` n'est pas directement
> exportable en glTF : son effet de dissolution est recréé côté navigateur dans
> `BlenderARLayer.tsx` (`onBeforeCompile` + `discard` + liseré cyan + texture
> panneau sci-fi issue du fichier Blender).

## Structure

```
src/app/
  page.tsx                     page d'accueil -> SuitUpAR
  layout.tsx, globals.css      mise en page / styles / animations
  armorStages.ts               étapes + inventaire des assets
  lib/poseMath.ts              similarité 2D, snapshots, ancrages, chroma fit
  lib/usePoseTracker.ts        chargement local de MediaPipe Pose
  components/SuitUpAR.tsx      webcam, séquence, HUD, capture, mode démo
  components/BlenderARLayer.tsx  scène WebGL : GLB Blender + chroma key + réacteur
  components/BlenderPreview.tsx  vitrine 3D de l'écran d'accueil
public/mediapipe|armor|models|posters/
tools/                         scripts Blender
openpose_bridge/               pont OpenPose local historique (optionnel, non requis)
```

## Notes

- Le suivi est calculé ~15 fps et lissé à 60 fps via styles DOM : pas de
  re-render React par frame.
- `next/font/google` a été retiré (le build échouait hors ligne) ; polices système.
- Le pont `openpose_bridge/server.py` reste dans le dépôt mais l'application
  n'en a plus besoin : MediaPipe local suffit, y compris hors ligne.
