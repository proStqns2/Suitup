"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ARMOR_STAGES,
  SCAN_EFFECT_SRC,
  type ArmorStage,
  type Landmark,
} from "../armorStages";

type Phase = "idle" | "scanning" | "equipping" | "equipped";

type Point = { x: number; y: number };
type Transform = { scale: number; angle: number; tx: number; ty: number };
type VideoRect = { x: number; y: number; w: number; h: number };

const POSE_KEYS = [
  "nose",
  "leftShoulder",
  "rightShoulder",
  "leftHip",
  "rightHip",
] as const;

const LM_INDEX: Record<(typeof POSE_KEYS)[number], number> = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftHip: 23,
  rightHip: 24,
};

const MIN_VISIBILITY = 0.35;
const OPENPOSE_URL = "http://127.0.0.1:8765";

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

/**
 * Fusionne les repères MediaPipe et OpenPose (pont de `openpose_bridge/server.py`).
 * Quand les deux sources se rejoignent on les moyenne, sinon on garde la plus confiante.
 */
function mergePoseLandmarks(a: any[] | null, b: any[] | null): any[] | null {
  if (!a) return b;
  if (!b) return a;

  const merged: any[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const pa = a[i];
    const pb = b[i];
    if (!pa) {
      merged.push(pb ?? null);
      continue;
    }
    if (!pb) {
      merged.push(pa);
      continue;
    }

    const va = Number(pa.visibility ?? pa.presence ?? 0);
    const vb = Number(pb.visibility ?? pb.presence ?? 0);
    if (Math.abs(va - vb) <= 0.15) {
      merged.push({
        x: (Number(pa.x) + Number(pb.x)) / 2,
        y: (Number(pa.y) + Number(pb.y)) / 2,
        visibility: (va + vb) / 2,
      });
    } else {
      merged.push(va >= vb ? pa : pb);
    }
  }
  return merged;
}

function meanPoint(points: Point[]): Point {
  const sum = points.reduce(
    (acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }),
    { x: 0, y: 0 }
  );
  return { x: sum.x / points.length, y: sum.y / points.length };
}

/**
 * Similarité 2D (rotation + échelle + translation) entre les repères de l'armure
 * et ceux de la personne filmée. `a = scale * e^(i*angle)`.
 */
function fitSimilarity(source: Point[], target: Point[]): Transform | null {
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

  const angle = Math.atan2(aIm, aRe);
  return {
    scale,
    angle,
    tx: tc.x - (aRe * sc.x - aIm * sc.y),
    ty: tc.y - (aRe * sc.y + aIm * sc.x),
  };
}

/** Repères d'une étape, exprimés en unités de largeur (y multiplié par l'aspect). */
function sourcePoints(stage: ArmorStage): { points: Point[]; keys: string[] } {
  const points: Point[] = [];
  const keys: string[] = [];

  for (const key of POSE_KEYS) {
    const lm = stage.landmarks?.[key] as Landmark | undefined;
    if (!lm || lm.v < MIN_VISIBILITY) continue;
    if (lm.x < -0.1 || lm.x > 1.1 || lm.y < -0.1 || lm.y > 1.15) continue;
    points.push({ x: lm.x, y: lm.y * stage.aspect });
    keys.push(key);
  }

  return { points, keys };
}

/** Conversion des coordonnées vidéo (object-cover) vers le conteneur affiché. */
function mapRectPoint(rect: VideoRect, x: number, y: number): Point {
  return { x: rect.x + x * rect.w, y: rect.y + y * rect.h };
}

export default function SuitUpAR() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const layerRefs = useRef<Array<HTMLDivElement | null>>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const detectorRef = useRef<any>(null);
  const lastDetectRef = useRef(0);
  const lastVisibleRef = useRef(0);
  const fallbackArmedRef = useRef(true);
  const timersRef = useRef<number[]>([]);
  const flashTimerRef = useRef<number | null>(null);
  const phaseRef = useRef<Phase>("idle");
  const trackingRef = useRef(false);

  // Pont OpenPose optionnel (coécrit avec GitHub Copilot).
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const openPoseAvailableRef = useRef(false);
  const openPoseBusyRef = useRef(false);
  const lastOpenPoseRef = useRef(0);
  const mediaPipeLandmarksRef = useRef<any[] | null>(null);
  const openPoseLandmarksRef = useRef<any[] | null>(null);

  const targetRef = useRef<Transform[]>(
    ARMOR_STAGES.map(() => ({ scale: 0, angle: 0, tx: 0, ty: 0 }))
  );
  const currentRef = useRef<Transform[]>(
    ARMOR_STAGES.map(() => ({ scale: 0, angle: 0, tx: 0, ty: 0 }))
  );
  const videoRectRef = useRef<VideoRect>({ x: 0, y: 0, w: 1, h: 1 });

  const [phase, setPhase] = useState<Phase>("idle");
  const [cameraOn, setCameraOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Caméra en attente");
  const [progress, setProgress] = useState(0);
  const [stageIndex, setStageIndex] = useState(-1);
  const [modelReady, setModelReady] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [openPoseState, setOpenPoseState] = useState<
    "idle" | "checking" | "active" | "unavailable"
  >("idle");
  const [showFlash, setShowFlash] = useState(false);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Préchargement des découpes et de l'effet de scan
  useEffect(() => {
    for (const s of ARMOR_STAGES) {
      const img = new Image();
      img.decoding = "async";
      img.src = s.image;
    }
    const effect = document.createElement("video");
    effect.preload = "auto";
    effect.src = SCAN_EFFECT_SRC;
  }, []);

  const clearTimers = useCallback(() => {
    for (const t of timersRef.current) window.clearTimeout(t);
    timersRef.current = [];
    if (flashTimerRef.current !== null) {
      window.clearTimeout(flashTimerRef.current);
      flashTimerRef.current = null;
    }
  }, []);

  const updateVideoRect = useCallback(() => {
    const video = videoRef.current;
    const stage = stageRef.current;
    if (!video || !stage) return;

    const cw = stage.clientWidth || window.innerWidth;
    const ch = stage.clientHeight || window.innerHeight;
    const vw = video.videoWidth || 16;
    const vh = video.videoHeight || 9;
    const videoRatio = vw / vh;
    const stageRatio = cw / ch;

    if (videoRatio > stageRatio) {
      const w = ch * videoRatio;
      videoRectRef.current = { x: (cw - w) / 2, y: 0, w, h: ch };
    } else {
      const h = cw / videoRatio;
      videoRectRef.current = { x: 0, y: (ch - h) / 2, w: cw, h };
    }
  }, []);

  useEffect(() => {
    updateVideoRect();
    window.addEventListener("resize", updateVideoRect);
    const video = videoRef.current;
    video?.addEventListener("loadedmetadata", updateVideoRect);
    return () => {
      window.removeEventListener("resize", updateVideoRect);
      video?.removeEventListener("loadedmetadata", updateVideoRect);
    };
  }, [updateVideoRect]);

  const centeredTransform = useCallback((aspect: number): Transform => {
    const { w, h } = videoRectRef.current;
    const scale = Math.min(w * 0.62, h * 0.52);
    return {
      scale,
      angle: 0,
      tx: (w - scale) / 2,
      ty: (h - scale * aspect) / 2,
    };
  }, []);

  const setFallbackTargets = useCallback(() => {
    ARMOR_STAGES.forEach((stage, i) => {
      targetRef.current[i] = centeredTransform(stage.aspect);
    });
  }, [centeredTransform]);

  const computeTargets = useCallback(
    (landmarks: any[]) => {
      const rect = videoRectRef.current;
      const user: Partial<Record<(typeof POSE_KEYS)[number], Point>> = {};

      for (const key of POSE_KEYS) {
        const lm = landmarks[LM_INDEX[key]];
        const visibility = Number(lm?.visibility ?? lm?.presence ?? 0);
        if (!lm || visibility < MIN_VISIBILITY) continue;
        user[key] = mapRectPoint(rect, Number(lm.x), Number(lm.y));
      }

      const visibleCount = Object.keys(user).length;
      const hasTorso =
        user.leftShoulder && user.rightShoulder && user.leftHip && user.rightHip;

      ARMOR_STAGES.forEach((stage, i) => {
        if (stage.fit === "torso") {
          // Ancrage manuel pour le plan final (buste large).
          const ls = user.leftShoulder;
          const rs = user.rightShoulder;
          const lh = user.leftHip;
          const rh = user.rightHip;
          if (!ls || !rs) return;

          const shoulderW = Math.hypot(rs.x - ls.x, rs.y - ls.y);
          const hipY = lh && rh ? (lh.y + rh.y) / 2 : (ls.y + rs.y) / 2 + shoulderW * 1.1;
          const shoulderY = (ls.y + rs.y) / 2;
          const torsoH = Math.max(shoulderW * 0.8, hipY - shoulderY);
          const scale = clamp(
            Math.max(shoulderW * 3.1, torsoH * 1.55),
            rect.w * 0.35,
            rect.w * 1.6
          );
          const angle = Math.atan2(rs.y - ls.y, rs.x - ls.x);
          const cx = (ls.x + rs.x) / 2;
          const cy = shoulderY + torsoH * 0.72;

          // Centre de l'image après rotation autour du coin supérieur gauche.
          const halfW = scale * 0.5;
          const halfH = (scale * stage.aspect) / 2;
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          targetRef.current[i] = {
            scale,
            angle,
            tx: cx - (halfW * cos - halfH * sin),
            ty: cy - (halfW * sin + halfH * cos),
          };
          return;
        }

        const src = sourcePoints(stage);
        const pairs: { s: Point; d: Point }[] = [];
        for (let k = 0; k < src.keys.length; k += 1) {
          const d = user[src.keys[k] as (typeof POSE_KEYS)[number]];
          if (d) pairs.push({ s: src.points[k], d });
        }
        if (pairs.length < 2) return;

        // On privilégie épaules + hanches (plus stables que le nez seul).
        const preferred = pairs
          .filter((p) => p.s !== undefined)
          .sort((a, b) => {
            const order = (key: string) =>
              key === "leftShoulder" || key === "rightShoulder"
                ? 0
                : key === "leftHip" || key === "rightHip"
                ? 1
                : 2;
            return (
              order(src.keys[src.points.indexOf(a.s)]) -
              order(src.keys[src.points.indexOf(b.s)])
            );
          });

        const fit = fitSimilarity(
          preferred.map((p) => p.s),
          preferred.map((p) => p.d)
        );
        if (!fit) return;

        const maxScale = Math.max(rect.w, rect.h) * 1.8;
        const scale = clamp(fit.scale, rect.w * 0.22, maxScale);
        const angle = clamp(fit.angle, -0.6, 0.6);

        if (scale === fit.scale && angle === fit.angle) {
          targetRef.current[i] = { ...fit, scale, angle };
        } else {
          // Recalcule la translation après bornage pour ne pas décaler l'armure.
          const sourceCenter = meanPoint(preferred.map((p) => p.s));
          const targetCenter = meanPoint(preferred.map((p) => p.d));
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          targetRef.current[i] = {
            scale,
            angle,
            tx: targetCenter.x - scale * (cos * sourceCenter.x - sin * sourceCenter.y),
            ty: targetCenter.y - scale * (sin * sourceCenter.x + cos * sourceCenter.y),
          };
        }
      });

      return visibleCount >= 3 && Boolean(hasTorso);
    },
    []
  );

  const applyPoseData = useCallback(() => {
    const merged = mergePoseLandmarks(
      mediaPipeLandmarksRef.current,
      openPoseLandmarksRef.current
    );
    if (!merged) return false;

    const bodyFound = computeTargets(merged) ?? false;
    if (bodyFound) {
      lastVisibleRef.current = performance.now();
      if (!trackingRef.current) {
        trackingRef.current = true;
        setTracking(true);
      }
      if (phaseRef.current === "scanning") {
        setStatus("Cible verrouillée · équipement");
        startEquip();
      }
    } else if (phaseRef.current === "scanning") {
      if (trackingRef.current) {
        trackingRef.current = false;
        setTracking(false);
      }
      setStatus("Recherche du corps dans le cadre");
    }
    return bodyFound;
  }, [computeTargets, startEquip]);

  const probeOpenPose = useCallback(async () => {
    setOpenPoseState("checking");
    try {
      const res = await fetch(`${OPENPOSE_URL}/health`, { cache: "no-store" });
      const data = (await res.json()) as { ready?: boolean };
      if (!res.ok || !data?.ready) throw new Error("OpenPose non prêt");
      openPoseAvailableRef.current = true;
      setOpenPoseState("active");
    } catch {
      openPoseAvailableRef.current = false;
      setOpenPoseState("unavailable");
    }
  }, []);

  const postOpenPoseFrame = useCallback(
    async (ts: number) => {
      if (
        !openPoseAvailableRef.current ||
        openPoseBusyRef.current ||
        ts - lastOpenPoseRef.current < 330
      ) {
        return;
      }

      const video = videoRef.current;
      if (!video || video.readyState < 2 || !video.videoWidth) return;

      openPoseBusyRef.current = true;
      lastOpenPoseRef.current = ts;
      try {
        const canvas = canvasRef.current ?? document.createElement("canvas");
        canvasRef.current = canvas;
        const width = 320;
        const height = Math.max(
          1,
          Math.round((video.videoHeight / video.videoWidth) * width)
        );
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(video, 0, 0, width, height);

        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/jpeg", 0.7)
        );
        if (!blob) return;

        const res = await fetch(`${OPENPOSE_URL}/pose`, {
          method: "POST",
          headers: { "Content-Type": "image/jpeg" },
          body: blob,
        });
        if (!res.ok) throw new Error("Inférence OpenPose indisponible");

        const data = (await res.json()) as { landmarks?: any[] };
        if (Array.isArray(data.landmarks)) {
          openPoseLandmarksRef.current = data.landmarks.map((lm: any) =>
            lm
              ? {
                  x: Number(lm.x),
                  y: Number(lm.y),
                  visibility: Number(lm.visibility ?? 0),
                }
              : null
          );
          applyPoseData();
        }
      } catch {
        openPoseAvailableRef.current = false;
        setOpenPoseState("unavailable");
      } finally {
        openPoseBusyRef.current = false;
      }
    },
    [applyPoseData]
  );

  const stopCamera = useCallback(() => {
    clearTimers();
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;

    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    const video = videoRef.current;
    if (video) video.srcObject = null;

    try {
      detectorRef.current?.close?.();
    } catch {
      // ignore
    }
    detectorRef.current = null;

    setCameraOn(false);
    setPhase("idle");
    setStatus("Caméra en attente");
    setProgress(0);
    setStageIndex(-1);
    setShowFlash(false);
    setModelReady(false);
    setTracking(false);
    trackingRef.current = false;
    setOpenPoseState("idle");
    openPoseAvailableRef.current = false;
    openPoseBusyRef.current = false;
    mediaPipeLandmarksRef.current = null;
    openPoseLandmarksRef.current = null;
    setFallbackTargets();
  }, [clearTimers, setFallbackTargets]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const flash = useCallback(() => {
    setShowFlash(true);
    if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => setShowFlash(false), 120);
  }, []);

  const startEquip = useCallback(() => {
    if (phaseRef.current === "equipping" || phaseRef.current === "equipped") return;
    clearTimers();
    fallbackArmedRef.current = false;
    setPhase("equipping");
    setStatus("Séquence d'équipement lancée");
    setProgress(0);
    setStageIndex(0);

    const step = 800;
    ARMOR_STAGES.forEach((_, i) => {
      const timer = window.setTimeout(() => {
        setStageIndex(i);
        setProgress(Math.round(((i + 1) / ARMOR_STAGES.length) * 100));
        setStatus(ARMOR_STAGES[i].label);
        if (i > 0) flash();

        if (i === ARMOR_STAGES.length - 1) {
          const done = window.setTimeout(() => {
            setPhase("equipped");
            setStatus("Armure synchronisée au corps");
          }, 550);
          timersRef.current.push(done);
        }
      }, 220 + i * step);
      timersRef.current.push(timer);
    });
  }, [clearTimers, flash]);

  const ensureDetector = useCallback(async () => {
    if (detectorRef.current) return;
    try {
      // Import dynamique depuis le CDN : garde le bundle Next.js léger.
      const loadVision = new Function(
        "u",
        "return import(u)"
      ) as (u: string) => Promise<any>;
      const vision = await loadVision(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0"
      );
      const { PoseLandmarker, FilesetResolver } = vision as any;
      const fileset = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
      );

      const options = {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numPoses: 1,
        minPoseDetectionConfidence: 0.4,
        minPosePresenceConfidence: 0.4,
        minTrackingConfidence: 0.4,
      };

      try {
        detectorRef.current = await PoseLandmarker.createFromOptions(fileset, options);
      } catch {
        detectorRef.current = await PoseLandmarker.createFromOptions(fileset, {
          ...options,
          baseOptions: { ...options.baseOptions, delegate: "CPU" },
        });
      }

      setModelReady(true);
      if (phaseRef.current === "scanning") {
        setStatus("Suivi corporel actif · place-toi face caméra");
      }
    } catch {
      if (phaseRef.current === "scanning") {
        setStatus("Mode rapide · équipement automatique");
      }
    }
  }, []);

  const frame = useCallback(
    (ts: number) => {
      const video = videoRef.current;
      const detector = detectorRef.current;

      if (video && video.readyState >= 2) {
        if (detector && ts - lastDetectRef.current > 85) {
          lastDetectRef.current = ts;
          try {
            const result = detector.detectForVideo(video, ts);
            const landmarks = result?.landmarks?.[0] as any[] | undefined;
            mediaPipeLandmarksRef.current = landmarks ?? null;
            applyPoseData();
          } catch {
            // Erreurs par frame ignorées : le flux continue.
          }
        } else if (!detector && phaseRef.current === "scanning" && fallbackArmedRef.current) {
          if (ts - lastDetectRef.current > 700) {
            lastDetectRef.current = ts;
            setStatus("Mode rapide · équipement");
            startEquip();
          }
        }

        if (openPoseAvailableRef.current) void postOpenPoseFrame(ts);
      }

      // Interpolation côté DOM à 60 fps pour un suivi fluide.
      const alpha = 0.16;
      ARMOR_STAGES.forEach((_, i) => {
        const el = layerRefs.current[i];
        if (!el) return;
        const target = targetRef.current[i];
        const current = currentRef.current[i];
        if (!target.scale) return;

        const first = current.scale === 0;
        const a = first ? 1 : alpha;
        current.scale += (target.scale - current.scale) * a;
        current.angle += (target.angle - current.angle) * a;
        current.tx += (target.tx - current.tx) * a;
        current.ty += (target.ty - current.ty) * a;

        el.style.width = `${current.scale.toFixed(2)}px`;
        el.style.height = `${(current.scale * ARMOR_STAGES[i].aspect).toFixed(2)}px`;
        el.style.transform = `translate3d(${current.tx.toFixed(2)}px, ${current.ty.toFixed(2)}px, 0) rotate(${current.angle.toFixed(4)}rad)`;
      });

      rafRef.current = requestAnimationFrame(frame);
    },
    [applyPoseData, postOpenPoseFrame]
  );

  const startCamera = useCallback(async () => {
    setError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("mediaDevices unavailable");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: false,
      });
      streamRef.current = stream;

      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => undefined);
      }
      updateVideoRect();

      clearTimers();
      currentRef.current.forEach((t) => {
        t.scale = 0;
      });
      fallbackArmedRef.current = true;
      lastDetectRef.current = 0;
      lastVisibleRef.current = 0;
      lastOpenPoseRef.current = 0;
      mediaPipeLandmarksRef.current = null;
      openPoseLandmarksRef.current = null;
      trackingRef.current = false;
      setCameraOn(true);
      setPhase("scanning");
      setStatus("Initialisation du scan corporel...");
      setProgress(0);
      setStageIndex(-1);
      setTracking(false);
      setFallbackTargets();
      void ensureDetector();
      void probeOpenPose();

      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(frame);
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setError("Accès caméra refusé. Autorise la caméra pour ce site puis réessaie.");
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        setError("Aucune caméra compatible détectée.");
      } else {
        setError(
          "Impossible d'ouvrir la webcam. Utilise http://localhost ou un site en HTTPS."
        );
      }
      setStatus("Caméra indisponible");
    }
  }, [
    clearTimers,
    ensureDetector,
    frame,
    probeOpenPose,
    setFallbackTargets,
    updateVideoRect,
  ]);

  const resetSuit = useCallback(() => {
    clearTimers();
    setStageIndex(-1);
    setProgress(0);
    setShowFlash(false);
    fallbackArmedRef.current = true;
    lastDetectRef.current = 0;
    if (cameraOn) {
      setPhase("scanning");
      setStatus(
        modelReady
          ? "Recherche du corps dans le cadre"
          : "Mode rapide prêt"
      );
    } else {
      setPhase("idle");
      setStatus("Caméra en attente");
    }
  }, [cameraOn, clearTimers, modelReady]);

  const showArmor = cameraOn && stageIndex >= 0 && phase !== "scanning";
  const showScanFrame = cameraOn && phase === "scanning";

  return (
    <div className="relative min-h-dvh overflow-hidden bg-black text-white">
      {/* Le miroir s'applique à la vidéo ET à l'armure : les repères restent alignés. */}
      <div ref={stageRef} className="absolute inset-0 [transform:scaleX(-1)]">
        <video
          ref={videoRef}
          className="h-full w-full object-cover"
          playsInline
          muted
          autoPlay
        />

        {ARMOR_STAGES.map((stage, i) => (
          <div
            key={stage.id}
            ref={(el) => {
              layerRefs.current[i] = el;
            }}
            className="armor-layer pointer-events-none absolute left-0 top-0 z-10 origin-top-left"
            style={{
              opacity: showArmor && i <= stageIndex ? 1 : 0,
              filter:
                i === stageIndex && phase === "equipped"
                  ? "drop-shadow(0 0 22px rgba(251,191,36,0.42)) drop-shadow(0 0 48px rgba(56,189,248,0.25))"
                  : "drop-shadow(0 0 16px rgba(56,189,248,0.26))",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={stage.image}
              alt=""
              className="h-full w-full select-none object-fill"
              draggable={false}
              decoding="async"
            />
          </div>
        ))}

        {showArmor && (
          <video
            key={stageIndex}
            className="scan-effect pointer-events-none absolute inset-0 z-20 h-full w-full object-cover"
            src={SCAN_EFFECT_SRC}
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
          />
        )}
      </div>

      {/* Overlays (non mirrorés) */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_16%,rgba(0,0,0,0.62)_100%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-20 [background:linear-gradient(rgba(0,255,255,0.07)_1px,transparent_1px),linear-gradient(90deg,rgba(0,255,255,0.07)_1px,transparent_1px)] [background-size:44px_44px]" />

      {showScanFrame && (
        <div className="pointer-events-none absolute inset-x-[8%] top-[7%] bottom-[6%] rounded-[2rem] border border-cyan-300/40 shadow-[0_0_40px_rgba(34,211,238,0.18)]">
          <div className="animate-scan absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-cyan-300/0 via-cyan-300/20 to-cyan-300/0" />
          <div className="absolute left-3 top-3 h-7 w-7 border-l-2 border-t-2 border-cyan-300" />
          <div className="absolute right-3 top-3 h-7 w-7 border-r-2 border-t-2 border-cyan-300" />
          <div className="absolute bottom-3 left-3 h-7 w-7 border-b-2 border-l-2 border-cyan-300" />
          <div className="absolute bottom-3 right-3 h-7 w-7 border-b-2 border-r-2 border-cyan-300" />
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-cyan-300/30 bg-black/45 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-cyan-100/90">
            {tracking ? "Corps verrouillé" : "Scan corporel"}
          </div>
        </div>
      )}

      {showFlash && <div className="pointer-events-none absolute inset-0 z-20 bg-cyan-100/25" />}

      <div className="relative z-30 flex min-h-dvh flex-col justify-between p-4 sm:p-6 md:p-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-xl rounded-xl border border-cyan-400/25 bg-black/45 px-4 py-3 backdrop-blur-md">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-300/80">
              Stark AR · Mark 86
            </p>
            <h1 className="mt-1 text-xl font-semibold tracking-wide text-white sm:text-2xl">
              Iron Man Suit-Up
            </h1>
            <p className="mt-1 text-sm text-zinc-300">
              Place-toi debout face à l&apos;objectif : l&apos;armure s&apos;aligne sur tes
              épaules, tes hanches et tes mouvements.
            </p>
          </div>

          <div
            aria-live="polite"
            className="rounded-xl border border-amber-300/25 bg-black/45 px-4 py-3 text-right backdrop-blur-md"
          >
            <p className="text-[11px] uppercase tracking-[0.22em] text-amber-200/80">
              Statut
            </p>
            <p className="mt-1 text-sm font-medium text-white">{status}</p>
            <p className="mt-1 flex items-center justify-end gap-2 text-xs text-zinc-400">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  tracking ? "bg-cyan-300" : "bg-zinc-600"
                }`}
              />
              {modelReady
                ? tracking
                  ? openPoseState === "active"
                    ? "MediaPipe + OpenPose local"
                    : "Suivi corporel actif"
                  : "Suivi en veille"
                : cameraOn
                ? "Démarrage rapide"
                : "En veille"}
            </p>
          </div>
        </header>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-black/55 p-4 backdrop-blur-md">
            <div className="mb-3 flex items-center justify-between text-sm">
              <span className="text-zinc-300">Progression de l&apos;armure</span>
              <span className="font-semibold text-cyan-300">{progress}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-sky-300 to-amber-300 transition-[width] duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              {ARMOR_STAGES.map((s, i) => (
                <div
                  key={s.id}
                  className={`rounded-lg border px-2 py-2 text-center transition-colors ${
                    i <= stageIndex
                      ? "border-cyan-300/40 bg-cyan-300/10 text-cyan-100"
                      : "border-white/10 bg-white/5 text-zinc-400"
                  }`}
                >
                  {s.label}
                </div>
              ))}
            </div>
            {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
          </div>

          <div className="flex flex-wrap gap-3">
            {!cameraOn ? (
              <button
                onClick={startCamera}
                className="rounded-full bg-cyan-400 px-6 py-3 text-sm font-semibold text-black shadow-[0_0_30px_rgba(34,211,238,0.35)] transition hover:bg-cyan-300"
              >
                Ouvrir la caméra
              </button>
            ) : (
              <>
                <button
                  onClick={startEquip}
                  disabled={phase === "equipping"}
                  className="rounded-full bg-amber-300 px-6 py-3 text-sm font-semibold text-black transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Équiper maintenant
                </button>
                <button
                  onClick={resetSuit}
                  className="rounded-full border border-white/20 bg-white/10 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/15"
                >
                  Réinitialiser
                </button>
                <button
                  onClick={stopCamera}
                  className="rounded-full border border-red-300/30 bg-red-500/10 px-5 py-3 text-sm font-semibold text-red-100 transition hover:bg-red-500/20"
                >
                  Couper
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {!cameraOn && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <div className="mx-6 max-w-lg rounded-3xl border border-cyan-300/20 bg-black/40 p-8 text-center backdrop-blur-sm">
            <p className="text-sm uppercase tracking-[0.3em] text-cyan-200/70">
              Système Mark 86
            </p>
            <p className="mt-3 text-2xl font-semibold">Prêt pour l&apos;assemblage</p>
            <p className="mt-2 text-zinc-300">
              Autorise l&apos;accès webcam pour lancer le suivi corporel et voir l&apos;armure
              se former sur toi.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
