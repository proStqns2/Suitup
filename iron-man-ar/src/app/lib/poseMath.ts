export type Point = { x: number; y: number };
export type PosePoint = Point & { v: number };
export type VideoRect = { x: number; y: number; w: number; h: number };
export type Transform = { scale: number; angle: number; tx: number; ty: number };

export type PoseSnapshot = {
  /** 33 repères MediaPipe convertis en coordonnées du conteneur (pixels). */
  points: Array<PosePoint | null>;
  rect: VideoRect;
  size: { w: number; h: number };
  valid: boolean;
  shoulderWidth: number;
  shoulderAngle: number;
  ts: number;
};

/** Indices MediaPipe Pose (33 repères). */
export const LM = {
  nose: 0,
  leftEyeInner: 1,
  leftEye: 2,
  leftEyeOuter: 3,
  rightEyeInner: 4,
  rightEye: 5,
  rightEyeOuter: 6,
  leftEar: 7,
  rightEar: 8,
  mouthLeft: 9,
  mouthRight: 10,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
} as const;

export const STAGE_KEYS = [
  "nose",
  "leftShoulder",
  "rightShoulder",
  "leftHip",
  "rightHip",
] as const;

export const KEY_INDEX: Record<(typeof STAGE_KEYS)[number], number> = {
  nose: LM.nose,
  leftShoulder: LM.leftShoulder,
  rightShoulder: LM.rightShoulder,
  leftHip: LM.leftHip,
  rightHip: LM.rightHip,
};

export type RawLandmark = {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
};

export const MIN_VISIBILITY = 0.32;

export function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export function meanPoint(points: Point[]): Point {
  if (!points.length) return { x: 0, y: 0 };
  const sum = points.reduce(
    (acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }),
    { x: 0, y: 0 }
  );
  return { x: sum.x / points.length, y: sum.y / points.length };
}

export function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Similarité 2D (rotation + échelle + translation) : `cible = scale * R * source + t`. */
export function fitSimilarity(source: Point[], target: Point[]): Transform | null {
  if (source.length < 2 || source.length !== target.length) return null;
  const sc = meanPoint(source);
  const tc = meanPoint(target);
  let re = 0;
  let im = 0;
  let den = 0;
  for (let i = 0; i < source.length; i += 1) {
    const sx = source[i].x - sc.x;
    const sy = source[i].y - sc.y;
    const tx = target[i].x - tc.x;
    const ty = target[i].y - tc.y;
    re += tx * sx + ty * sy;
    im += ty * sx - tx * sy;
    den += sx * sx + sy * sy;
  }
  if (den < 1e-8) return null;
  const aRe = re / den;
  const aIm = im / den;
  const scale = Math.hypot(aRe, aIm);
  if (!Number.isFinite(scale) || scale < 1) return null;
  return {
    scale,
    angle: Math.atan2(aIm, aRe),
    tx: tc.x - (aRe * sc.x - aIm * sc.y),
    ty: tc.y - (aRe * sc.y + aIm * sc.x),
  };
}

export function transformPoint(t: Transform, p: Point): Point {
  const cos = Math.cos(t.angle);
  const sin = Math.sin(t.angle);
  return {
    x: t.tx + t.scale * (cos * p.x - sin * p.y),
    y: t.ty + t.scale * (sin * p.x + cos * p.y),
  };
}

/** `object-cover` : coords vidéo normalisées -> pixels du conteneur. */
export function mapRectPoint(rect: VideoRect, x: number, y: number): Point {
  return { x: rect.x + x * rect.w, y: rect.y + y * rect.h };
}

export function computeVideoRect(
  containerW: number,
  containerH: number,
  videoW: number,
  videoH: number
): VideoRect {
  const cw = containerW || 1;
  const ch = containerH || 1;
  const vw = videoW || 16;
  const vh = videoH || 9;
  const videoRatio = vw / vh;
  const stageRatio = cw / ch;
  if (videoRatio > stageRatio) {
    const w = ch * videoRatio;
    return { x: (cw - w) / 2, y: 0, w, h: ch };
  }
  const h = cw / videoRatio;
  return { x: 0, y: (ch - h) / 2, w: cw, h };
}

export function buildPoseSnapshot(
  landmarks: RawLandmark[] | null,
  rect: VideoRect,
  size: { w: number; h: number },
  ts: number
): PoseSnapshot {
  const points: Array<PosePoint | null> = new Array(33).fill(null);
  if (landmarks) {
    for (let i = 0; i < Math.min(33, landmarks.length); i += 1) {
      const lm = landmarks[i];
      const v = Number(lm?.visibility ?? 0);
      if (!lm || v < MIN_VISIBILITY) continue;
      points[i] = { ...mapRectPoint(rect, Number(lm.x), Number(lm.y)), v };
    }
  }
  const ls = points[LM.leftShoulder];
  const rs = points[LM.rightShoulder];
  const lh = points[LM.leftHip];
  const rh = points[LM.rightHip];
  const nose = points[LM.nose];
  const shoulderWidth = ls && rs ? distance(ls, rs) : 0;
  const shoulderAngle =
    ls && rs ? Math.atan2(rs.y - ls.y, rs.x - ls.x) : 0;
  const visible = points.filter(Boolean).length;
  return {
    points,
    rect,
    size,
    valid: Boolean(ls && rs && (lh || rh || nose)) && visible >= 3,
    shoulderWidth,
    shoulderAngle,
    ts,
  };
}

export type StageAnchor = {
  x: number;
  y: number;
  v?: number;
};

export type StageFit = "pose" | "torso" | "hand" | "head";

export type StageLike = {
  id: string;
  aspect: number;
  fit: StageFit;
  landmarks?: Record<string, StageAnchor>;
  torsoScale?: number;
  vertical?: number;
  hand?: "left" | "right";
};

/** Placement de secours si le suivi corporel n'est pas disponible. */
export function centeredTransform(
  aspect: number,
  size: { w: number; h: number }
): Transform {
  const scale = Math.min(size.w * 0.58, (size.h * 0.78) / Math.max(aspect, 0.2));
  return {
    scale,
    angle: 0,
    tx: size.w / 2 - scale / 2,
    ty: size.h / 2 - (scale * aspect) / 2,
  };
}

function fromCenter(
  center: Point,
  scale: number,
  aspect: number,
  angle: number
): Transform {
  const halfW = scale / 2;
  const halfH = (scale * aspect) / 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    scale,
    angle,
    tx: center.x - (halfW * cos - halfH * sin),
    ty: center.y - (halfW * sin + halfH * cos),
  };
}

/** Calcule la transformation d'un calque d'armure à partir du corps détecté. */
export function computeStageTransform(
  stage: StageLike,
  snap: PoseSnapshot,
  fallback: Transform
): Transform {
  if (!snap.valid || !snap.shoulderWidth) return fallback;

  if (stage.fit === "pose" && stage.landmarks) {
    const pairs: { key: string; s: Point; d: Point }[] = [];
    for (const key of STAGE_KEYS) {
      const anchor = stage.landmarks[key];
      const dest = snap.points[KEY_INDEX[key]];
      if (!anchor || !dest) continue;
      if (anchor.v !== undefined && anchor.v < MIN_VISIBILITY) continue;
      if (anchor.x < -0.15 || anchor.x > 1.15 || anchor.y < -0.15 || anchor.y > 1.2) {
        continue;
      }
      pairs.push({
        key,
        s: { x: anchor.x, y: anchor.y * stage.aspect },
        d: dest,
      });
    }
    if (pairs.length >= 2) {
      // Les épaules/hanches sont plus stables que le nez : on l'écarte
      // dès qu'il reste au moins deux autres repères.
      const withoutNose = pairs.filter((p) => p.key !== "nose");
      const stable = withoutNose.length >= 2 ? withoutNose : pairs;
      const fit = fitSimilarity(
        stable.map((p) => p.s),
        stable.map((p) => p.d)
      );
      if (fit) {
        const maxScale = Math.max(snap.rect.w, snap.rect.h) * 1.9;
        const scale = clamp(fit.scale, snap.rect.w * 0.22, maxScale);
        const angle = clamp(fit.angle, -0.55, 0.55);
        if (scale === fit.scale && angle === fit.angle) return { ...fit, scale, angle };
        const srcC = meanPoint(stable.map((p) => p.s));
        const dstC = meanPoint(stable.map((p) => p.d));
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        return {
          scale,
          angle,
          tx: dstC.x - scale * (cos * srcC.x - sin * srcC.y),
          ty: dstC.y - scale * (sin * srcC.x + cos * srcC.y),
        };
      }
    }
  }

  const ls = snap.points[LM.leftShoulder];
  const rs = snap.points[LM.rightShoulder];
  if (!ls || !rs) return fallback;

  if (stage.fit === "hand") {
    const wrist =
      snap.points[stage.hand === "left" ? LM.leftWrist : LM.rightWrist] ?? null;
    const elbow =
      snap.points[stage.hand === "left" ? LM.leftElbow : LM.rightElbow] ?? null;
    if (!wrist) return fallback;
    const angle = elbow
      ? clamp(
          Math.atan2(wrist.y - elbow.y, wrist.x - elbow.x) - Math.PI / 2,
          -1.1,
          1.1
        )
      : snap.shoulderAngle;
    const scale = clamp(snap.shoulderWidth * 0.62, snap.rect.w * 0.12, snap.rect.w * 0.8);
    return fromCenter(wrist, scale, stage.aspect, angle);
  }

  if (stage.fit === "head") {
    const nose = snap.points[LM.nose];
    if (!nose) return fallback;
    const scale = clamp(snap.shoulderWidth * 0.72, snap.rect.w * 0.12, snap.rect.w * 0.9);
    return fromCenter(
      { x: nose.x, y: nose.y - scale * 0.08 },
      scale,
      stage.aspect,
      clamp(snap.shoulderAngle, -0.4, 0.4)
    );
  }

  // Ancrage torse (plan large / buste) : épaules + hanches.
  const lh = snap.points[LM.leftHip];
  const rh = snap.points[LM.rightHip];
  const shoulderMid = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
  const hipMid =
    lh && rh
      ? { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 }
      : { x: shoulderMid.x, y: shoulderMid.y + snap.shoulderWidth * 1.05 };
  const torsoH = Math.max(snap.shoulderWidth * 0.75, hipMid.y - shoulderMid.y);
  const scale = clamp(
    Math.max(snap.shoulderWidth * (stage.torsoScale ?? 2.4), torsoH * 1.25),
    snap.rect.w * 0.3,
    snap.rect.w * 1.8
  );
  const center = {
    x: shoulderMid.x,
    y: shoulderMid.y + torsoH * (stage.vertical ?? 0.65),
  };
  return fromCenter(
    center,
    scale,
    stage.aspect,
    clamp(snap.shoulderAngle, -0.45, 0.45)
  );
}

/** Repères calibrés sur la vidéo fond vert (`Untitled 97_1080p_7.mp4`). */
export const CHROMA_ASPECT = 1080 / 1920;
export const CHROMA_ANCHORS: Record<string, Point> = {
  leftShoulder: { x: 0.85, y: 0.61 * CHROMA_ASPECT },
  rightShoulder: { x: 0.36, y: 0.61 * CHROMA_ASPECT },
  nose: { x: 0.54, y: 0.28 * CHROMA_ASPECT },
};

export function computeChromaTransform(snap: PoseSnapshot): Transform | null {
  if (!snap.valid) return null;
  const keys: (keyof typeof CHROMA_ANCHORS)[] = [
    "leftShoulder",
    "rightShoulder",
    "nose",
  ];
  const sources: Point[] = [];
  const targets: Point[] = [];
  for (const key of keys) {
    const idx = KEY_INDEX[key as (typeof STAGE_KEYS)[number]];
    const dest = snap.points[idx];
    if (!dest) continue;
    sources.push(CHROMA_ANCHORS[key]);
    targets.push(dest);
  }
  if (sources.length < 2) return null;
  const fit = fitSimilarity(sources, targets);
  if (!fit) return null;
  const scale = clamp(fit.scale, snap.rect.w * 0.35, snap.rect.w * 2.6);
  const angle = clamp(fit.angle, -0.5, 0.5);
  return { ...fit, scale, angle };
}

export const POSE_CONNECTIONS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 7],
  [0, 4], [4, 5], [5, 6], [6, 8],
  [9, 10], [11, 12], [11, 13], [13, 15],
  [12, 14], [14, 16], [11, 23], [12, 24],
  [23, 24], [23, 25], [24, 26], [25, 27], [26, 28],
];
