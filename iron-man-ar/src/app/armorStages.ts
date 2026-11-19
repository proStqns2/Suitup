import type { StageAnchor, StageFit } from "./lib/poseMath";

export type ArmorStage = {
  id: string;
  label: string;
  short: string;
  detail: string;
  image: string;
  aspect: number;
  fit: StageFit;
  landmarks?: Record<string, StageAnchor>;
  torsoScale?: number;
  vertical?: number;
  hand?: "left" | "right";
  duration: number;
  accent: string;
};

/**
 * Calibrage des découpes transparentes (`public/armor/cutouts`).
 * Les repères sont normalisés sur chaque image et issus de MediaPipe Pose.
 */
export const ARMOR_STAGES: ArmorStage[] = [
  {
    id: "torse",
    label: "Nano-paquets · torse",
    short: "Torse",
    detail: "mark86_chest_half.webp",
    image: "/armor/cutouts/mark86_chest_half.webp",
    aspect: 0.73173,
    fit: "pose",
    landmarks: {
      nose: { x: 0.58076, y: 0.26438, v: 1 },
      leftShoulder: { x: 0.779, y: 0.46203, v: 0.998 },
      rightShoulder: { x: 0.29433, y: 0.46135, v: 0.999 },
      leftHip: { x: 0.69075, y: 0.91637, v: 0.545 },
      rightHip: { x: 0.40382, y: 0.92526, v: 0.635 },
    },
    duration: 900,
    accent: "#38bdf8",
  },
  {
    id: "repulseurs",
    label: "Répulseurs en ligne",
    short: "Répulseurs",
    detail: "mark86_frame_repulsor.webp",
    image: "/armor/cutouts/mark86_frame_repulsor.webp",
    aspect: 0.99335,
    fit: "pose",
    landmarks: {
      nose: { x: 0.52569, y: 0.05824, v: 0.998 },
      leftShoulder: { x: 0.70183, y: 0.25673, v: 0.997 },
      rightShoulder: { x: 0.37496, y: 0.23882, v: 0.993 },
      leftHip: { x: 0.63798, y: 0.69182, v: 0.994 },
      rightHip: { x: 0.46658, y: 0.6753, v: 0.991 },
    },
    duration: 850,
    accent: "#fbbf24",
  },
  {
    id: "gant",
    label: "Gant · répulseur fermé",
    short: "Gant",
    detail: "mark86_repulsor_closed.webp",
    image: "/armor/cutouts/mark86_repulsor_closed.webp",
    aspect: 0.99225,
    fit: "hand",
    hand: "right",
    duration: 750,
    accent: "#a78bfa",
  },
  {
    id: "casque",
    label: "Verrouillage du casque",
    short: "Casque",
    detail: "mark86_frame_helmet.webp",
    image: "/armor/cutouts/mark86_frame_helmet.webp",
    aspect: 0.64744,
    fit: "pose",
    landmarks: {
      nose: { x: 0.50898, y: 0.28261, v: 1 },
      leftShoulder: { x: 0.69113, y: 0.4222, v: 1 },
      rightShoulder: { x: 0.29579, y: 0.4127, v: 1 },
      leftHip: { x: 0.59541, y: 0.76376, v: 0.992 },
      rightHip: { x: 0.39853, y: 0.76119, v: 0.993 },
    },
    duration: 900,
    accent: "#22d3ee",
  },
  {
    id: "complet",
    label: "Armure complète · Mark 86",
    short: "Complet",
    detail: "armure_terminee.webp",
    image: "/armor/cutouts/armure_terminee.webp",
    aspect: 1.4375,
    fit: "torso",
    torsoScale: 3.0,
    vertical: 0.7,
    duration: 1000,
    accent: "#fb7185",
  },
];

export const ASSETS = {
  /** Vidéo de formation du casque (fond noir, blend « screen »). */
  scan: "/armor/HDRjxWl.mp4",
  /** Vidéo fond vert : torse + casque, incrustée en chroma key temps réel. */
  chroma: "/armor/Untitled 97_1080p_7.mp4",
  /** Vidéo cinématique de transformation plein écran. */
  transformation: "/armor/kling-v3_b_generer_moi_une_vidi.mp4",
  /** Modèles issus du fichier Blender The_Nano_Tech_Shader_V2.blend. */
  head: "/models/nanotech_head.glb",
  reactor: "/models/arc_reactor.glb",
  panel: "/models/nano_panel.jpg",
  modelPoster: "/posters/nanotech_model_front.png",
  transformationPoster: "/posters/transformation.jpg",
  greenPoster: "/posters/greenscreen.jpg",
  scanPoster: "/posters/helmet_scan.jpg",
  /** Moteur de suivi corporel MediaPipe, servi en local (aucun CDN requis). */
  poseScript: "/mediapipe/pose.js",
} as const;

export const ASSET_COUNTS = {
  images: ARMOR_STAGES.length,
  videos: 3,
  models: 2,
};
