# Iron Man Suit-Up AR (Webcam)

Expérience Next.js qui utilise la webcam pour afficher une séquence d'équipement de l'armure Iron Man sur la personne devant la caméra, en s'appuyant sur les images/vidéos fournies dans `public/armor/`.

## Fonctionnalités

- **Ouverture webcam** (caméra frontale, vue miroir) via `getUserMedia`
- **Séquence d'équipement progressive** avec les assets fournis :
  - `mark86_chest_half.png` → torse
  - `mark86_frame_repulsor.png` → répulseurs
  - `mark86_frame_helmet.png` → casque
  - `armure_terminee.png` → armure complète
- **Effet visuel vidéo** pendant l'équipement : `HDRjxWl.mp4` (blend)
- **Détourage des assets** : les photos opaques sont prétraitées en découpes transparentes (`public/armor/cutouts/*.webp`) avec leurs repères anatomiques calibrés, afin que l'armure puisse réellement se coller au corps.
- **Suivi corporel** : MediaPipe suit le corps dans le navigateur ; le service OpenPose local peut fournir une seconde estimation. Les repères concordants sont fusionnés et les repères divergents sont départagés par leur confiance.
- **Alignement** : similarité 2D épaules/hanches + interpolation à 60 fps, avec prise en compte du cadrage `object-cover` de la webcam.
- **Mode dégradé** : si OpenPose est absent, MediaPipe continue seul ; si aucun modèle n'est disponible, le mode rapide reste possible.
- **UI HUD** : statut, progression, étapes, boutons (ouvrir caméra / équiper / réinitialiser / couper)

## Lancer le projet

```bash
cd iron-man-ar
npm install
npm run dev
```

Puis ouvrir [http://localhost:3000](http://localhost:3000).

> La caméra nécessite un contexte sécurisé : `http://localhost` fonctionne, ou un site en HTTPS. Autorise l'accès caméra dans le navigateur.

## Activer le suivi OpenPose local (facultatif)

Le navigateur conserve MediaPipe comme suivi temps réel principal. Quand le service local répond, une image réduite de la webcam lui est envoyée environ trois fois par seconde ; ses repères BODY_25 sont fusionnés avec ceux de MediaPipe. Les images restent sur la machine et le service écoute uniquement sur `127.0.0.1`.

Le pont requiert **OpenPose compilé avec son API Python (`BUILD_PYTHON`)** et les modèles BODY_25. La version de Python qui lance le pont doit correspondre à celle ayant servi à construire les bindings. Consulte la [documentation officielle OpenPose pour Windows](https://github.com/CMU-Perceptual-Computing-Lab/openpose/blob/master/doc/installation/0_index.md) ; l'installation portable seule ne fournit pas nécessairement `pyopenpose`.

Dans une deuxième fenêtre PowerShell, après avoir installé OpenPose et ses modèles :

```powershell
$env:OPENPOSE_HOME = "C:\chemin\vers\openpose"
py -3.12 .\openpose_bridge\server.py
```

Le dossier indiqué doit contenir `models`, `bin`, `x64\Release` et `python\openpose\Release`. Le navigateur affiche l'état « MediaPipe + OpenPose local » lorsque la fusion fonctionne. En l'absence du serveur, MediaPipe reste actif.

OpenPose peut être lent sur CPU. Cette machine dispose d'un GPU Intel UHD 620 (pas de CUDA NVIDIA) ; il faut donc s'attendre à une fréquence d'images réduite côté OpenPose.

## Structure utile

- `src/app/page.tsx` : page principale
- `src/app/armorStages.ts` : calibration des étapes (repères, ratio, stratégie d'ancrage)
- `src/app/components/SuitUpAR.tsx` : webcam, suivi MediaPipe/OpenPose, fusion, séquence et UI
- `openpose_bridge/server.py` : pont HTTP local vers l'API Python OpenPose (travail de GitHub Copilot)
- `public/armor/` : sources brutes
- `public/armor/cutouts/` : découpes transparentes + métadonnées JSON générées depuis les sources

## Assets de costume observés

- `mark86_chest_half.png`, les images de casque et les images de répulseur sont des photos opaques avec leur décor. Elles ont été prétraitées en découpes transparentes dans `public/armor/cutouts/` (masque de segmentation + détourage colorimétrique), ce qui permet enfin de les caler sur la silhouette. `mark86_frame_helmet.png` et `mark86_frame_helmet (1).png` sont des doublons identiques.
- `kling-v3_b_generer_moi_une_vidi.mp4` est une vidéo portrait de transformation sur fond de pièce ; elle convient mieux à un aperçu plein écran qu'à une pièce d'armure superposée.
- `Untitled 97_1080p_7.mp4` montre le torse sur fond vert ; c'est le meilleur candidat pour un futur effet chroma key, mais son cadrage ne couvre pas le corps entier.
- `HDRjxWl.mp4` est un clip cinématique paysage de formation du casque ; il reste un effet de transition, pas une source de suivi corporel.

## Notes performance

- Préchargement des images d'armure pour des transitions instantanées
- Détection MediaPipe throttlée (~10 fps) et fusion OpenPose optionnelle (~3 fps)
- Mise à jour de la position via styles DOM (évite des re-renders React à chaque frame)
- Chargement du modèle de suivi **à la demande** après ouverture caméra
- Les PNG sources sont volumineux (qualité fournie) : pour de meilleures perfs réseau, envisager des versions WebP/AVIF optimisées tout en conservant la transparence.
