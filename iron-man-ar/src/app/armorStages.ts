export type Landmark = {
  x: number;
  y: number;
  v: number;
};

export type ArmorFit = "pose" | "torso";

export type ArmorStage = {
  id: string;
  label: string;
  image: string;
  aspect: number;
  fit: ArmorFit;
  landmarks?: Record<string, Landmark>;
};

/**
 * Calibrage des découpes générées dans `public/armor/cutouts`.
 * Les repères sont normalisés sur la découpe (x: largeur, y: hauteur).
 * They come from MediaPipe Pose applied to each source image.
 */
export const ARMOR_STAGES: ArmorStage[] = [
  {
    id: "torse",
    label: "Assemblage du torse",
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
  },
  {
    id: "repulseurs",
    label: "Répulseurs en ligne",
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
  },
  {
    id: "casque",
    label: "Verrouillage du casque",
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
  },
  {
    id: "complet",
    label: "Armure complète",
    image: "/armor/cutouts/armure_terminee.webp",
    aspect: 1.4375,
    // Le plan final est un buste très large : les repères sont trop serrés
    // pour une similarité fiable, on l'ancre donc sur le torse.
    fit: "torso",
  },
];

export const SCAN_EFFECT_SRC = "/armor/HDRjxWl.mp4";
