"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type MutableRefObject,
} from "react";
import {
  ARMOR_STAGES,
  ASSETS,
  ASSET_COUNTS,
} from "../armorStages";
import {
  buildPoseSnapshot,
  centeredTransform,
  computeStageTransform,
  computeVideoRect,
  POSE_CONNECTIONS,
  type PoseSnapshot,
  type RawLandmark,
  type Transform,
  type VideoRect,
} from "../lib/poseMath";
import { usePoseTracker } from "../lib/usePoseTracker";
import BlenderARLayer from "./BlenderARLayer";
import BlenderPreview from "./BlenderPreview";

type Phase = "idle" | "scanning" | "transition" | "equipping" | "equipped";

type Toggles = {
  mirror: boolean;
  skeleton: boolean;
  hud: boolean;
  three: boolean;
  chroma: boolean;
  scan: boolean;
};

const DEFAULT_TOGGLES: Toggles = {
  mirror: true,
  skeleton: true,
  hud: true,
  three: true,
  chroma: true,
  scan: true,
};

function formatTime() {
  return new Date().toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

type CameraDiag = {
  embedded: boolean;
  secure: boolean;
  policyCamera: boolean | null;
  permission: string;
  devices: number;
  url: string;
  /** URL à ouvrir en onglet de premier niveau, avec demande caméra automatique. */
  autoCamUrl: string;
  host: string;
};

const INITIAL_DIAG: CameraDiag = {
  embedded: false,
  secure: true,
  policyCamera: null,
  permission: "inconnu",
  devices: 0,
  url: "",
  autoCamUrl: "",
  host: "",
};

type PolicyDocument = Document & {
  permissionsPolicy?: { allowsFeature: (feature: string) => boolean };
  featurePolicy?: { allowsFeature: (feature: string) => boolean };
};

/**
 * Ouvre la webcam avec repli progressif sur des contraintes plus simples :
 * certaines webcams refusent les contraintes 1280x720/30 fps (OverconstrainedError).
 */
async function requestCameraStream(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("mediaDevices indisponible (contexte non sécurisé ?)");
  }
  const attempts: MediaStreamConstraints[] = [
    {
      video: {
        facingMode: "user",
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 30 },
      },
      audio: false,
    },
    { video: { facingMode: "user" }, audio: false },
    { video: true, audio: false },
  ];
  let lastError: unknown;
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      lastError = err;
      const name = err instanceof DOMException ? err.name : "";
      if (
        !["OverconstrainedError", "NotFoundError", "TypeError", "AbortError"].includes(
          name
        )
      ) {
        throw err;
      }
    }
  }
  throw lastError;
}

/** Silhouette virtuelle utilisée par le mode démo (sans webcam). */
const DEMO_LANDMARKS: RawLandmark[] = (() => {
  const lm: RawLandmark[] = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    visibility: 0,
  }));
  const set = (i: number, x: number, y: number, visibility = 0.98) => {
    lm[i] = { x, y, visibility };
  };
  set(0, 0.5, 0.2); // nez
  set(2, 0.47, 0.185);
  set(5, 0.53, 0.185);
  set(7, 0.435, 0.2);
  set(8, 0.565, 0.2);
  set(11, 0.66, 0.4); // épaule gauche (image droite)
  set(12, 0.34, 0.4);
  set(13, 0.75, 0.58);
  set(14, 0.25, 0.58);
  set(15, 0.68, 0.73);
  set(16, 0.32, 0.73);
  set(23, 0.59, 0.72);
  set(24, 0.41, 0.72);
  set(25, 0.59, 0.9);
  set(26, 0.41, 0.9);
  set(27, 0.59, 1.02);
  set(28, 0.41, 1.02);
  return lm;
})();

export default function SuitUpAR() {
  // --- DOM / flux ---
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const layerRefs = useRef<Array<HTMLDivElement | null>>([]);
  const skeletonCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const threeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const imagesRef = useRef<Array<HTMLImageElement | null>>([]);
  const rafRef = useRef<number | null>(null);
  const timersRef = useRef<number[]>([]);
  const transitionTimerRef = useRef<number | null>(null);
  const flashTimerRef = useRef<number | null>(null);
  const captureTimerRef = useRef<number | null>(null);

  // --- Données temps réel (refs pour éviter les re-renders à 60 fps) ---
  const phaseRef = useRef<Phase>("idle");
  const cameraOnRef = useRef(false);
  const demoOnRef = useRef(false);
  const stageIndexRef = useRef(-1);
  const autoArmedRef = useRef(true);
  const validFramesRef = useRef(0);
  const trackingRef = useRef(false);
  const trackerStateRef = useRef<string>("idle");
  const lastDetectRef = useRef(0);
  const landmarksRef = useRef<RawLandmark[] | null>(null);
  const videoRectRef = useRef<VideoRect>({ x: 0, y: 0, w: 1, h: 1 });
  const poseRef: MutableRefObject<PoseSnapshot | null> = useRef(null);
  const targetRef = useRef<Transform[]>(
    ARMOR_STAGES.map(() => ({ scale: 0, angle: 0, tx: 0, ty: 0 }))
  );
  const currentRef = useRef<Transform[]>(
    ARMOR_STAGES.map(() => ({ scale: 0, angle: 0, tx: 0, ty: 0 }))
  );
  const togglesRef = useRef<Toggles>(DEFAULT_TOGGLES);
  const frameRef = useRef<(ts: number) => void>(() => undefined);

  // --- État UI ---
  const [phase, setPhase] = useState<Phase>("idle");
  const [cameraOn, setCameraOn] = useState(false);
  const [demoOn, setDemoOn] = useState(false);
  const [status, setStatus] = useState("Système en veille");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [stageIndex, setStageIndex] = useState(-1);
  const [tracking, setTracking] = useState(false);
  const [transition, setTransition] = useState(false);
  const [flash, setFlash] = useState(false);
  const [captureFlash, setCaptureFlash] = useState(false);
  const [toggles, setToggles] = useState<Toggles>(DEFAULT_TOGGLES);
  const [lastCapture, setLastCapture] = useState<string | null>(null);
  // Composant 100 % client : on peut lire `window` dès l'initialisation,
  // sans risque de divergence d'hydratation.
  const [diag, setDiag] = useState<CameraDiag>(() => {
    if (typeof window === "undefined") return INITIAL_DIAG;
    const url = window.location.href;
    let autoCamUrl = url;
    let host = window.location.host;
    try {
      const parsed = new URL(url);
      host = parsed.host;
      parsed.searchParams.set("autocam", "1");
      autoCamUrl = parsed.toString();
    } catch {
      // URL non analyzable : on garde les valeurs brutes.
    }
    return {
      ...INITIAL_DIAG,
      embedded: window.self !== window.top,
      secure: window.isSecureContext,
      url,
      autoCamUrl,
      host,
    };
  });
  const [lastCameraError, setLastCameraError] = useState<{
    name: string;
    message: string;
  } | null>(null);
  const [demoImage, setDemoImage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const demoImageElRef = useRef<HTMLImageElement | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const diagRef = useRef<CameraDiag>(INITIAL_DIAG);

  const setPhaseSafe = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const onPoseResults = useCallback((landmarks: RawLandmark[] | null) => {
    landmarksRef.current = landmarks;
  }, []);

  const {
    state: trackerState,
    error: trackerError,
    start: startTracker,
    detect: detectPose,
    stop: stopTracker,
  } = usePoseTracker(onPoseResults);

  // Les refs miroirs sont synchronisées après le rendu (règles React 19).
  useEffect(() => {
    togglesRef.current = toggles;
  }, [toggles]);
  useEffect(() => {
    trackerStateRef.current = trackerState;
  }, [trackerState]);

  /** Diagnostic caméra : détecte l'iframe et la politique Permissions Policy. */
  const refreshDiag = useCallback(async () => {
    const embedded = window.self !== window.top;
    const secure = window.isSecureContext;
    let policyCamera: boolean | null = null;
    try {
      const doc = document as PolicyDocument;
      const policy = doc.permissionsPolicy ?? doc.featurePolicy;
      if (policy?.allowsFeature) policyCamera = policy.allowsFeature("camera");
    } catch {
      policyCamera = null;
    }
    let permission = "inconnu";
    try {
      if (navigator.permissions?.query) {
        const result = await navigator.permissions.query({
          name: "camera" as PermissionName,
        });
        permission = result.state;
      }
    } catch {
      permission = "indisponible";
    }
    let devices = 0;
    try {
      if (navigator.mediaDevices?.enumerateDevices) {
        const list = await navigator.mediaDevices.enumerateDevices();
        devices = list.filter((device) => device.kind === "videoinput").length;
      }
    } catch {
      devices = -1;
    }
    let host = "";
    let autoCamUrl = window.location.href;
    try {
      const current = new URL(window.location.href);
      host = current.host;
      current.searchParams.set("autocam", "1");
      autoCamUrl = current.toString();
    } catch {
      host = window.location.host;
    }
    setDiag({
      embedded,
      secure,
      policyCamera,
      permission,
      devices,
      url: window.location.href,
      autoCamUrl,
      host,
    });
  }, []);

  useEffect(() => {
    // Diagnostic différé : les API navigateur sont interrogées hors du rendu.
    const id = window.setTimeout(() => void refreshDiag(), 0);
    return () => window.clearTimeout(id);
  }, [refreshDiag]);
  useEffect(() => {
    diagRef.current = diag;
  }, [diag]);

  useEffect(() => {
    if (!demoImage) {
      demoImageElRef.current = null;
      return;
    }
    const img = new Image();
    img.src = demoImage;
    demoImageElRef.current = img;
    return () => {
      URL.revokeObjectURL(demoImage);
    };
  }, [demoImage]);

  const copyLink = useCallback(() => {
    const url = window.location.href;
    if (!navigator.clipboard?.writeText) return;
    navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2600);
      })
      .catch(() => setCopied(false));
  }, []);

  const onPhotoSelected = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setDemoImage(URL.createObjectURL(file));
  }, []);

  // --- Préchargement des calques d'armure ---
  useEffect(() => {
    ARMOR_STAGES.forEach((stage, i) => {
      const img = new Image();
      img.decoding = "async";
      img.src = stage.image;
      imagesRef.current[i] = img;
    });
  }, []);

  const clearTimers = useCallback(() => {
    for (const t of timersRef.current) window.clearTimeout(t);
    timersRef.current = [];
    if (transitionTimerRef.current !== null) {
      window.clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
    }
    if (flashTimerRef.current !== null) {
      window.clearTimeout(flashTimerRef.current);
      flashTimerRef.current = null;
    }
  }, []);

  const triggerFlash = useCallback(() => {
    setFlash(true);
    if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => setFlash(false), 130);
  }, []);

  const measure = useCallback(() => {
    const stage = stageRef.current;
    const video = videoRef.current;
    const w = stage?.clientWidth || window.innerWidth;
    const h = stage?.clientHeight || window.innerHeight;
    videoRectRef.current = computeVideoRect(
      w,
      h,
      video?.videoWidth || 16,
      video?.videoHeight || 9
    );
    return { w, h };
  }, []);

  // --- Séquence d'équipement ---
  const startEquip = useCallback(() => {
    if (phaseRef.current === "equipping" || phaseRef.current === "equipped") return;
    clearTimers();
    autoArmedRef.current = false;
    setTransition(false);
    setPhaseSafe("equipping");
    setStatus("Assemblage nano-tech en cours");
    setProgress(0);
    setStageIndex(-1);
    stageIndexRef.current = -1;

    let delay = 180;
    ARMOR_STAGES.forEach((stage, i) => {
      const timer = window.setTimeout(() => {
        stageIndexRef.current = i;
        setStageIndex(i);
        setProgress(Math.round(((i + 1) / ARMOR_STAGES.length) * 100));
        setStatus(stage.label);
        if (i > 0) triggerFlash();
      }, delay);
      timersRef.current.push(timer);
      delay += stage.duration;
    });

    const done = window.setTimeout(() => {
      setPhaseSafe("equipped");
      setProgress(100);
      setStatus("Armure synchronisée · Mark 86 en ligne");
    }, delay + 200);
    timersRef.current.push(done);
  }, [clearTimers, setPhaseSafe, triggerFlash]);

  const finishTransition = useCallback(() => {
    if (transitionTimerRef.current !== null) {
      window.clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
    }
    setTransition(false);
    startEquip();
  }, [startEquip]);

  const startTransition = useCallback(() => {
    if (
      !cameraOnRef.current ||
      phaseRef.current === "transition" ||
      phaseRef.current === "equipping" ||
      phaseRef.current === "equipped"
    ) {
      return;
    }
    clearTimers();
    autoArmedRef.current = false;
    validFramesRef.current = 0;
    setTransition(true);
    setPhaseSafe("transition");
    setStatus("Séquence de transformation nano-tech");
    transitionTimerRef.current = window.setTimeout(() => {
      transitionTimerRef.current = null;
      finishTransition();
    }, 2900);
  }, [clearTimers, finishTransition, setPhaseSafe]);

  // --- Boucle principale : suivi, alignement, rendu DOM ---
  const frame = useCallback(
    (ts: number) => {
      const { w, h } = measure();
      const isDemo = demoOnRef.current;
      const snap = buildPoseSnapshot(
        isDemo ? DEMO_LANDMARKS : landmarksRef.current,
        videoRectRef.current,
        { w, h },
        ts
      );
      poseRef.current = snap;

      // Détection throttlée (~15 fps) : le lissage DOM reste à 60 fps.
      if (!isDemo && ts - lastDetectRef.current > 62 && videoRef.current) {
        lastDetectRef.current = ts;
        detectPose(videoRef.current);
      }

      // Cible verrouillée ?
      const bodyVisible = snap.valid && snap.shoulderWidth > w * 0.06;
      if (bodyVisible !== trackingRef.current) {
        trackingRef.current = bodyVisible;
        setTracking(bodyVisible);
        if (phaseRef.current === "scanning") {
          setStatus(
            bodyVisible
              ? "Corps verrouillé · préparation de l'assemblage"
              : trackerStateRef.current === "error"
              ? "Suivi indisponible · mode manuel"
              : "Recherche du corps dans le cadre"
          );
        }
      }

      // Auto-équipement dès que le corps est stable (mode webcam uniquement).
      if (!isDemo && phaseRef.current === "scanning" && autoArmedRef.current) {
        validFramesRef.current = bodyVisible ? validFramesRef.current + 1 : 0;
        if (validFramesRef.current >= 8) startTransition();
      }

      // Transformations des calques d'images.
      for (let i = 0; i < ARMOR_STAGES.length; i += 1) {
        const stage = ARMOR_STAGES[i];
        const fallback = centeredTransform(stage.aspect, { w, h });
        targetRef.current[i] = computeStageTransform(stage, snap, fallback);
      }

      const alpha = 0.17;
      for (let i = 0; i < ARMOR_STAGES.length; i += 1) {
        const el = layerRefs.current[i];
        if (!el) continue;
        const target = targetRef.current[i];
        const current = currentRef.current[i];
        if (!target.scale) continue;
        const a = current.scale === 0 ? 1 : alpha;
        current.scale += (target.scale - current.scale) * a;
        current.angle += (target.angle - current.angle) * a;
        current.tx += (target.tx - current.tx) * a;
        current.ty += (target.ty - current.ty) * a;
        el.style.width = `${current.scale.toFixed(2)}px`;
        el.style.height = `${(current.scale * ARMOR_STAGES[i].aspect).toFixed(2)}px`;
        el.style.transform = `translate3d(${current.tx.toFixed(2)}px, ${current.ty.toFixed(2)}px, 0) rotate(${current.angle.toFixed(4)}rad)`;
      }

      // Squelette de scan (canvas 2D).
      const canvas = skeletonCanvasRef.current;
      if (canvas && togglesRef.current.skeleton && cameraOnRef.current) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
          canvas.width = Math.round(w * dpr);
          canvas.height = Math.round(h * dpr);
        }
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, w, h);
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          for (const [a, b] of POSE_CONNECTIONS) {
            const pa = snap.points[a];
            const pb = snap.points[b];
            if (!pa || !pb) continue;
            ctx.strokeStyle = "rgba(56, 211, 238, 0.34)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(pa.x, pa.y);
            ctx.lineTo(pb.x, pb.y);
            ctx.stroke();
          }
          for (const p of snap.points) {
            if (!p) continue;
            ctx.fillStyle = "rgba(190, 250, 255, 0.9)";
            ctx.beginPath();
            ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      } else if (canvas) {
        const ctx = canvas.getContext("2d");
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
      }

      rafRef.current = requestAnimationFrame((next) => frameRef.current(next));
    },
    [detectPose, measure, startTransition]
  );

  useEffect(() => {
    frameRef.current = frame;
  }, [frame]);

  // --- Caméra ---
  const startCamera = useCallback(async () => {
    setError(null);
    setLastCameraError(null);
    try {
      const stream = await requestCameraStream();
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => undefined);
      }
      measure();
      clearTimers();
      currentRef.current.forEach((t) => {
        t.scale = 0;
      });
      autoArmedRef.current = true;
      validFramesRef.current = 0;
      lastDetectRef.current = 0;
      trackingRef.current = false;
      landmarksRef.current = null;
      poseRef.current = null;
      stageIndexRef.current = -1;
      cameraOnRef.current = true;
      setCameraOn(true);
      setTracking(false);
      setTransition(false);
      setStageIndex(-1);
      setProgress(0);
      setPhaseSafe("scanning");
      setStatus("Initialisation du suivi corporel local…");
      void startTracker();

      // Filet de sécurité : sans modèle de suivi, l'armure s'équipe quand même.
      const fallbackTimer = window.setTimeout(() => {
        if (phaseRef.current === "scanning" && !trackingRef.current) {
          setStatus("Équipement automatique · placement centré");
          startTransition();
        }
      }, 4200);
      timersRef.current.push(fallbackTimer);

      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame((ts) => frameRef.current(ts));
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "Erreur";
      const message = err instanceof Error ? err.message : String(err);
      setLastCameraError({ name, message });
      void refreshDiag();
      const d = diagRef.current;
      const iframeBlocked =
        d.embedded &&
        (d.policyCamera === false ||
          name === "NotAllowedError" ||
          name === "SecurityError");
      if (iframeBlocked) {
        setError(
          "Caméra bloquée par l'aperçu intégré (iframe). L'autorisation affichée concerne arena.ai, pas l'origine de l'application (" +
            (d.host || "…e2b.app") +
            "). Chrome interdit getUserMedia dans ce cadre : ouvre l'application dans son propre onglet, puis autorise la caméra SUR CET ONGLET."
        );
      } else if (!d.secure || name === "SecurityError") {
        setError(
          "Contexte non sécurisé : la webcam exige HTTPS ou localhost. Ouvre l'application via son URL HTTPS dans un nouvel onglet."
        );
      } else if (name === "NotAllowedError") {
        setError(
          "Autorisation refusée pour ce site. Clique sur l'icône caméra / cadenas dans la barre d'adresse de l'onglet de l'application (" +
            (d.host || "ce site") +
            "), passe la caméra sur « Autoriser », puis clique sur Réessayer."
        );
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        setError(
          "Aucune webcam compatible détectée (ou format vidéo refusé). Vérifie que la caméra est branchée et non désactivée."
        );
      } else if (name === "NotReadableError" || name === "TrackStartError") {
        setError(
          "La caméra est déjà utilisée par une autre application (Zoom, Teams, OBS…). Ferme-la puis clique sur Réessayer."
        );
      } else {
        setError("Impossible d'ouvrir la webcam : " + message);
      }
      setStatus("Caméra indisponible");
    }
  }, [clearTimers, measure, refreshDiag, setPhaseSafe, startTracker, startTransition]);

  /**
   * Lien `?autocam=1` (ouvert depuis l'iframe) : l'application est alors dans
   * un onglet de premier niveau, elle demande elle-même l'autorisation caméra
   * dès son chargement, ce qui fait apparaître la fenêtre du navigateur.
   */
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.self !== window.top) return;
    let cleanUrl = "";
    try {
      const current = new URL(window.location.href);
      if (current.searchParams.get("autocam") !== "1") return;
      current.searchParams.delete("autocam");
      cleanUrl = current.toString();
      window.history.replaceState({}, "", cleanUrl);
    } catch {
      return;
    }
    const id = window.setTimeout(() => void startCamera(), 650);
    return () => window.clearTimeout(id);
  }, [startCamera]);

  /** Mode vitrine : même séquence, mais sur un mannequin virtuel (sans webcam). */
  const startDemo = useCallback(() => {
    setError(null);
    clearTimers();
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    const video = videoRef.current;
    if (video) video.srcObject = null;
    stopTracker();
    demoOnRef.current = true;
    cameraOnRef.current = true;
    autoArmedRef.current = false;
    validFramesRef.current = 0;
    trackingRef.current = false;
    landmarksRef.current = DEMO_LANDMARKS;
    poseRef.current = null;
    stageIndexRef.current = -1;
    currentRef.current.forEach((t) => {
      t.scale = 0;
    });
    measure();
    setDemoOn(true);
    setCameraOn(true);
    setTracking(false);
    setTransition(false);
    setStageIndex(-1);
    setProgress(0);
    setPhaseSafe("scanning");
    setStatus("Mode démo · mannequin virtuel");
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame((ts) => frameRef.current(ts));
    startTransition();
  }, [clearTimers, measure, setPhaseSafe, startTransition, stopTracker]);

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
    stopTracker();
    demoOnRef.current = false;
    cameraOnRef.current = false;
    setDemoOn(false);
    autoArmedRef.current = true;
    validFramesRef.current = 0;
    trackingRef.current = false;
    landmarksRef.current = null;
    poseRef.current = null;
    stageIndexRef.current = -1;
    currentRef.current.forEach((t) => {
      t.scale = 0;
    });
    setCameraOn(false);
    setTracking(false);
    setTransition(false);
    setStageIndex(-1);
    setProgress(0);
    setFlash(false);
    setPhaseSafe("idle");
    setStatus("Système en veille");
  }, [clearTimers, setPhaseSafe, stopTracker]);

  const resetSuit = useCallback(() => {
    clearTimers();
    setTransition(false);
    setFlash(false);
    setStageIndex(-1);
    stageIndexRef.current = -1;
    setProgress(0);
    validFramesRef.current = 0;
    if (cameraOnRef.current) {
      setPhaseSafe("scanning");
      if (demoOnRef.current) {
        setStatus("Mode démo · nouvelle séquence");
        const t = window.setTimeout(() => startTransition(), 900);
        timersRef.current.push(t);
      } else {
        setStatus("Nouveau scan · place-toi face caméra");
        // Laisse passer quelques frames avant de réarmer l'auto-équipement.
        const t = window.setTimeout(() => {
          autoArmedRef.current = true;
        }, 1600);
        timersRef.current.push(t);
      }
    } else {
      setPhaseSafe("idle");
      setStatus("Système en veille");
    }
  }, [clearTimers, setPhaseSafe, startTransition]);

  // --- Capture d'écran (vidéo + calques + scène 3D) ---
  const capture = useCallback(() => {
    const video = videoRef.current;
    const isDemo = demoOnRef.current || !video?.videoWidth;
    const stage = stageRef.current;
    const w = stage?.clientWidth || window.innerWidth;
    const h = stage?.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    if (togglesRef.current.mirror) {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }

    // Webcam avec le même cadrage object-cover que l'écran (ou fond démo).
    if (!isDemo && video) {
      const scale = Math.max(w / video.videoWidth, h / video.videoHeight);
      const dw = video.videoWidth * scale;
      const dh = video.videoHeight * scale;
      ctx.drawImage(video, (w - dw) / 2, (h - dh) / 2, dw, dh);
    } else {
      const bg = ctx.createRadialGradient(w / 2, h * 0.45, 10, w / 2, h * 0.5, Math.max(w, h) * 0.7);
      bg.addColorStop(0, "#0b2634");
      bg.addColorStop(1, "#03060c");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      const photo = demoImageElRef.current;
      if (photo?.complete && photo.naturalWidth) {
        const k = Math.min(w / photo.naturalWidth, h / photo.naturalHeight);
        const pw = photo.naturalWidth * k;
        const ph = photo.naturalHeight * k;
        ctx.drawImage(photo, (w - pw) / 2, (h - ph) / 2, pw, ph);
      }
    }

    // Calque d'armure actif.
    const active = stageIndexRef.current;
    if (active >= 0) {
      const t = currentRef.current[active];
      const img = imagesRef.current[active];
      if (t && img?.complete && img.naturalWidth) {
        ctx.save();
        ctx.translate(t.tx, t.ty);
        ctx.rotate(t.angle);
        ctx.drawImage(img, 0, 0, t.scale, t.scale * ARMOR_STAGES[active].aspect);
        ctx.restore();
      }
    }

    // Scène 3D / vidéo chroma key.
    const three = threeCanvasRef.current;
    if (three && three.width && three.height) {
      ctx.drawImage(three, 0, 0, w, h);
    }

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "rgba(2, 8, 18, 0.55)";
    ctx.fillRect(w - 250, h - 54, 236, 38);
    ctx.fillStyle = "#7dd3fc";
    ctx.font = "600 13px system-ui, sans-serif";
    ctx.fillText(`MARK 86 · SUIT-UP AR · ${formatTime()}`, w - 238, h - 30);
    ctx.restore();

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `mark86-suitup-${Date.now()}.png`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
      setLastCapture(formatTime());
      setCaptureFlash(true);
      if (captureTimerRef.current !== null) window.clearTimeout(captureTimerRef.current);
      captureTimerRef.current = window.setTimeout(() => setCaptureFlash(false), 180);
    }, "image/png");
  }, []);

  const toggle = useCallback((key: keyof Toggles) => {
    setToggles((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      void document.documentElement.requestFullscreen().catch(() => undefined);
    }
  }, []);

  // Raccourcis clavier.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key.toLowerCase() === "c") {
        if (cameraOnRef.current) stopCamera();
        else void startCamera();
      } else if (e.key.toLowerCase() === "d") {
        if (!cameraOnRef.current) startDemo();
      } else if (e.key.toLowerCase() === "e") {
        if (cameraOnRef.current) startTransition();
      } else if (e.key.toLowerCase() === "r") {
        resetSuit();
      } else if (e.key.toLowerCase() === "s") {
        capture();
      } else if (e.key.toLowerCase() === "h") {
        toggle("hud");
      } else if (e.key.toLowerCase() === "f") {
        toggleFullscreen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [capture, resetSuit, startCamera, startDemo, startTransition, stopCamera, toggle, toggleFullscreen]);

  useEffect(() => () => stopCamera(), [stopCamera]);
  useEffect(
    () => () => {
      if (captureTimerRef.current !== null) {
        window.clearTimeout(captureTimerRef.current);
      }
    },
    []
  );

  // --- Valeurs dérivées pour l'affichage ---
  const showArmor =
    cameraOn &&
    stageIndex >= 0 &&
    phase !== "scanning" &&
    phase !== "transition";
  const showScanFrame = cameraOn && phase === "scanning";
  const showHead = toggles.three && cameraOn;
  const showReactor =
    toggles.three && cameraOn && stageIndex >= 1 && phase !== "scanning";
  const showChroma = toggles.chroma && cameraOn && phase === "equipping";
  const showScanEffect = toggles.scan && cameraOn && phase === "equipping";
  const reveal =
    phase === "scanning"
      ? 0.42
      : phase === "transition"
      ? 0.6
      : phase === "equipping"
      ? 0.6 + (progress / 100) * 0.4
      : 1;

  const trackerLabel = demoOn
    ? "Mannequin virtuel · mode démo"
    : trackerState === "ready"
      ? tracking
        ? "MediaPipe · corps verrouillé"
        : "MediaPipe · recherche"
      : trackerState === "loading"
      ? "Chargement du modèle local"
      : trackerState === "error"
      ? "Mode dégradé (sans suivi)"
      : "En veille";

  return (
    <main className="relative min-h-dvh overflow-hidden bg-[#03060c] text-white">
      {/* ===================== SCÈNE WEBCAM ===================== */}
      <div
        ref={stageRef}
        className="absolute inset-0"
        style={{ transform: toggles.mirror ? "scaleX(-1)" : undefined }}
      >
        <video
          ref={videoRef}
          className="h-full w-full object-cover"
          style={{ opacity: demoOn ? 0 : 1 }}
          playsInline
          muted
          autoPlay
        />

        {demoOn && (
          <div className="absolute inset-0 z-0 overflow-hidden bg-[#03060c]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={demoImage ?? ASSETS.transformationPoster}
              alt=""
              className={`h-full w-full object-center ${
                demoImage
                  ? "object-contain opacity-90"
                  : "object-cover opacity-[0.18]"
              }`}
            />
            <div
              className={`absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,rgba(34,211,238,0.14),rgba(3,6,12,0.92)_68%)] ${
                demoImage ? "opacity-30" : ""
              }`}
            />
            <div className="absolute inset-0 opacity-20 [background:linear-gradient(rgba(0,255,255,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(0,255,255,0.08)_1px,transparent_1px)] [background-size:52px_52px]" />
          </div>
        )}

        {ARMOR_STAGES.map((stage, i) => (
          <div
            key={stage.id}
            ref={(el) => {
              layerRefs.current[i] = el;
            }}
            className="armor-layer pointer-events-none absolute left-0 top-0 z-10 origin-top-left"
            style={{
              opacity: showArmor && i === stageIndex ? 1 : 0,
              filter:
                "drop-shadow(0 0 18px rgba(56,189,248,0.28)) drop-shadow(0 0 46px rgba(251,191,36,0.12))",
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

        {cameraOn && (
          <BlenderARLayer
            poseRef={poseRef}
            canvasRef={threeCanvasRef}
            visible={cameraOn}
            showHead={showHead}
            showReactor={showReactor}
            showChroma={showChroma}
            reveal={reveal}
          />
        )}

        <canvas
          ref={skeletonCanvasRef}
          className="pointer-events-none absolute inset-0 z-[16] h-full w-full"
        />

        {showScanEffect && (
          <video
            key={`scan-${stageIndex}`}
            className="scan-effect pointer-events-none absolute inset-0 z-20 h-full w-full object-cover"
            src={ASSETS.scan}
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
          />
        )}
      </div>

      {/* Ambiance (non mirrorée) */}
      <div className="pointer-events-none absolute inset-0 z-[21] bg-[radial-gradient(circle_at_center,transparent_22%,rgba(0,0,0,0.72)_100%)]" />
      <div className="pointer-events-none absolute inset-0 z-[21] opacity-[0.16] [background:linear-gradient(rgba(0,255,255,0.09)_1px,transparent_1px),linear-gradient(90deg,rgba(0,255,255,0.09)_1px,transparent_1px)] [background-size:48px_48px]" />

      {/* Cadre de scan */}
      {showScanFrame && (
        <div className="pointer-events-none absolute inset-x-[7%] bottom-[6%] top-[7%] z-[25] rounded-[2rem] border border-cyan-300/35 shadow-[0_0_50px_rgba(34,211,238,0.12)]">
          <div className="animate-scan absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-cyan-300/0 via-cyan-300/20 to-cyan-300/0" />
          <div className="absolute left-3 top-3 h-8 w-8 border-l-2 border-t-2 border-cyan-300" />
          <div className="absolute right-3 top-3 h-8 w-8 border-r-2 border-t-2 border-cyan-300" />
          <div className="absolute bottom-3 left-3 h-8 w-8 border-b-2 border-l-2 border-cyan-300" />
          <div className="absolute bottom-3 right-3 h-8 w-8 border-b-2 border-r-2 border-cyan-300" />
          <div className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full border border-cyan-300/30 bg-black/55 px-4 py-1.5 text-[11px] uppercase tracking-[0.24em] text-cyan-100">
            {tracking ? "Cible verrouillée" : "Scan corporel · tenez-vous debout"}
          </div>
        </div>
      )}

      {flash && <div className="pointer-events-none absolute inset-0 z-[40] bg-cyan-100/20" />}
      {captureFlash && <div className="pointer-events-none absolute inset-0 z-[41] bg-white/60" />}

      {/* ===================== TRANSITION CINÉMATIQUE ===================== */}
      {transition && (
        <div className="absolute inset-0 z-50 bg-black">
          <video
            className="h-full w-full object-cover opacity-90"
            src={ASSETS.transformation}
            autoPlay
            muted
            playsInline
            onEnded={finishTransition}
          />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_20%,rgba(0,0,0,0.75)_100%)]" />
          <div className="absolute inset-x-0 bottom-10 flex flex-col items-center gap-4 px-6">
            <p className="text-[11px] uppercase tracking-[0.4em] text-cyan-200/80">
              Nano-tech assembly · Mark 86
            </p>
            <div className="h-1 w-64 overflow-hidden rounded-full bg-white/15">
              <div className="h-full w-full origin-left animate-cine-bar bg-gradient-to-r from-cyan-300 to-amber-200" />
            </div>
            <button
              onClick={finishTransition}
              className="rounded-full border border-white/25 bg-black/45 px-5 py-2 text-xs font-semibold text-white backdrop-blur-md transition hover:bg-white/15"
            >
              Passer l&apos;intro →
            </button>
          </div>
        </div>
      )}

      {/* ===================== HUD ===================== */}
      {cameraOn && toggles.hud && (
        <div className="pointer-events-none relative z-30 flex min-h-dvh flex-col justify-between p-4 sm:p-6">
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div className="rounded-xl border border-cyan-400/25 bg-black/50 px-4 py-3 backdrop-blur-md">
              <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-cyan-300/80">
                Stark Industries · AR Lab
              </p>
              <h1 className="mt-1 text-lg font-semibold tracking-wide sm:text-xl">
                MARK 86 <span className="text-cyan-300">/ SUIT-UP</span>
              </h1>
              <p className="mt-1 max-w-sm text-xs text-zinc-300">
                Images détourées · vidéos incrustées · modèle Blender · suivi
                corporel temps réel.
              </p>
            </div>

            <div className="rounded-xl border border-amber-300/25 bg-black/50 px-4 py-3 text-right backdrop-blur-md">
              <p className="text-[10px] uppercase tracking-[0.24em] text-amber-200/80">
                Statut système
              </p>
              <p className="mt-1 max-w-[240px] text-sm font-medium">{status}</p>
              <p className="mt-1 flex items-center justify-end gap-2 text-[11px] text-zinc-400">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    tracking ? "bg-cyan-300" : "bg-zinc-600"
                  }`}
                />
                {trackerLabel}
              </p>
              {trackerError && (
                <p className="mt-1 text-[10px] text-amber-200/70">{trackerError}</p>
              )}
            </div>
          </header>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            {/* Progression + étapes */}
            <div className="pointer-events-auto w-full max-w-xl rounded-2xl border border-white/10 bg-black/55 p-4 backdrop-blur-md">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="text-zinc-300">Assemblage de l&apos;armure</span>
                <span className="font-mono font-semibold text-cyan-300">
                  {progress.toString().padStart(2, "0")}%
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-sky-300 to-amber-300 transition-[width] duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-1.5 text-[11px] sm:grid-cols-5">
                {ARMOR_STAGES.map((s, i) => (
                  <div
                    key={s.id}
                    className={`rounded-lg border px-2 py-1.5 text-center transition-colors ${
                      i === stageIndex
                        ? "border-cyan-300/60 bg-cyan-300/15 text-cyan-100"
                        : i < stageIndex
                        ? "border-white/15 bg-white/5 text-zinc-300"
                        : "border-white/10 bg-white/[0.03] text-zinc-500"
                    }`}
                  >
                    {s.short}
                  </div>
                ))}
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {(
                  [
                    ["three", "Modèle 3D"],
                    ["chroma", "Vidéo nano-tech"],
                    ["scan", "FX cinéma"],
                    ["skeleton", "Squelette"],
                    ["mirror", "Miroir"],
                    ["hud", "HUD"],
                  ] as Array<[keyof Toggles, string]>
                ).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => toggle(key)}
                    className={`rounded-full border px-2.5 py-1 text-[10px] font-medium transition ${
                      toggles[key]
                        ? "border-cyan-300/50 bg-cyan-300/15 text-cyan-100"
                        : "border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {error && <p className="mt-3 text-xs text-red-300">{error}</p>}
              {lastCapture && (
                <p className="mt-2 text-[10px] text-emerald-300/80">
                  Capture enregistrée à {lastCapture}
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="pointer-events-auto flex flex-wrap items-center gap-2">
              {phase === "equipped" || phase === "equipping" ? (
                <button
                  onClick={resetSuit}
                  className="rounded-full bg-amber-300 px-5 py-2.5 text-xs font-semibold text-black shadow-[0_0_28px_rgba(251,191,36,0.3)] transition hover:bg-amber-200"
                >
                  ↻ Rejouer la séquence
                </button>
              ) : (
                <button
                  onClick={startTransition}
                  className="rounded-full bg-amber-300 px-5 py-2.5 text-xs font-semibold text-black shadow-[0_0_28px_rgba(251,191,36,0.3)] transition hover:bg-amber-200"
                >
                  ⚡ Équiper maintenant
                </button>
              )}
              <button
                onClick={capture}
                className="rounded-full border border-white/20 bg-white/10 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-white/20"
              >
                ⬇ Capturer
              </button>
              <button
                onClick={toggleFullscreen}
                className="rounded-full border border-white/20 bg-white/10 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-white/20"
              >
                ⛶ Plein écran
              </button>
              <button
                onClick={stopCamera}
                className="rounded-full border border-red-300/30 bg-red-500/10 px-4 py-2.5 text-xs font-semibold text-red-100 transition hover:bg-red-500/20"
              >
                ⏻ Couper
              </button>
            </div>
          </div>

          <p className="mt-2 text-center text-[10px] uppercase tracking-[0.2em] text-white/35">
            Raccourcis : C caméra · D démo · E équiper · R rejouer · S capture · H HUD · F plein écran
          </p>
        </div>
      )}

      {/* Bouton minimal pour réafficher le HUD masqué */}
      {cameraOn && !toggles.hud && (
        <button
          onClick={() => toggle("hud")}
          className="absolute right-4 top-4 z-30 rounded-full border border-white/20 bg-black/50 px-3 py-2 text-[11px] text-white backdrop-blur-md"
        >
          Afficher le HUD (H)
        </button>
      )}

      {/* ===================== ÉCRAN D'ACCUEIL ===================== */}
      {!cameraOn && (
        <div className="absolute inset-0 z-[60] overflow-y-auto">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={ASSETS.transformationPoster}
            alt=""
            className="pointer-events-none absolute inset-0 h-full w-full object-cover object-center opacity-25"
          />
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(3,6,12,0.97)_0%,rgba(3,6,12,0.82)_45%,rgba(3,6,12,0.55)_100%)]" />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_75%_35%,rgba(34,211,238,0.13),transparent_55%)]" />

          <div className="relative mx-auto flex min-h-dvh max-w-7xl flex-col px-5 py-6 sm:px-10">
            <header className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-xl border border-cyan-300/40 bg-cyan-300/10 font-mono text-sm font-bold text-cyan-200">
                  86
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.34em] text-cyan-300/80">
                    Stark Industries · AR Lab
                  </p>
                  <p className="text-sm font-semibold tracking-wide">
                    MARK 86 / SUIT-UP AR
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[11px] text-zinc-300">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300" />
                Interface prête · Webcam · Temps réel · v2.0
              </div>
            </header>

            <div className="grid flex-1 items-center gap-8 py-10 lg:grid-cols-[1.1fr_0.9fr]">
              <section>
                <p className="text-[11px] uppercase tracking-[0.42em] text-amber-200/80">
                  Nano-tech suit-up experience
                </p>
                <h1 className="mt-4 text-4xl font-semibold leading-[1.08] tracking-tight sm:text-6xl">
                  L&apos;armure
                  <span className="block bg-gradient-to-r from-cyan-200 via-sky-300 to-amber-200 bg-clip-text text-transparent">
                    s&apos;assemble sur toi.
                  </span>
                </h1>
                <p className="mt-5 max-w-xl text-sm leading-relaxed text-zinc-300 sm:text-base">
                  Ouvre ta webcam : le suivi corporel verrouille tes épaules et
                  tes hanches, puis les images détourées, les vidéos incrustées
                  et le modèle 3D issu du fichier Blender se calent sur ta
                  silhouette, en direct à l&apos;écran.
                </p>

                {diag.embedded && (
                  <div className="mt-6 max-w-xl rounded-xl border border-amber-300/40 bg-amber-300/[0.08] px-4 py-3 text-xs text-amber-100">
                    <p className="font-semibold">
                      ⚠ Aperçu intégré : la webcam peut être bloquée ici
                    </p>
                    <p className="mt-1 leading-relaxed text-amber-100/80">
                      L&apos;application est affichée dans un iframe d&apos;une autre
                      origine ({diag.host || "…e2b.app"}). Même avec la caméra
                      autorisée sur arena.ai, Chrome refuse{" "}
                      <span className="font-mono">getUserMedia</span> dans ce cadre.
                      Ouvre l&apos;application dans son propre onglet pour utiliser
                      la webcam.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <a
                        href={diag.autoCamUrl || diag.url || "#"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-full bg-amber-300 px-4 py-2 text-[11px] font-semibold text-black transition hover:bg-amber-200"
                      >
                        🎥 Autoriser la caméra dans un nouvel onglet ↗
                      </a>
                      <button
                        onClick={copyLink}
                        className="rounded-full border border-amber-300/40 px-4 py-2 text-[11px] font-semibold text-amber-100 transition hover:bg-amber-300/10"
                      >
                        {copied ? "Lien copié ✓" : "Copier le lien"}
                      </button>
                    </div>
                    {diag.autoCamUrl && (
                      <input
                        readOnly
                        value={diag.autoCamUrl}
                        onFocus={(event) => event.currentTarget.select()}
                        aria-label="Lien à copier manuellement"
                        className="mt-2 w-full rounded-lg border border-amber-300/25 bg-black/35 px-2 py-1.5 font-mono text-[10px] text-amber-100/70 outline-none"
                      />
                    )}
                  </div>
                )}

                <div className="mt-7 flex flex-wrap items-center gap-3">
                  {diag.embedded ? (
                    <a
                      href={diag.autoCamUrl || diag.url || "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={copyLink}
                      className="group rounded-full bg-cyan-300 px-7 py-3.5 text-sm font-semibold text-black shadow-[0_0_40px_rgba(34,211,238,0.35)] transition hover:bg-cyan-200"
                    >
                      🎥 Autoriser la caméra et démarrer
                      <span className="ml-2 opacity-60 transition group-hover:translate-x-1">
                        ↗
                      </span>
                    </a>
                  ) : (
                    <button
                      onClick={startCamera}
                      className="group rounded-full bg-cyan-300 px-7 py-3.5 text-sm font-semibold text-black shadow-[0_0_40px_rgba(34,211,238,0.35)] transition hover:bg-cyan-200"
                    >
                      🎥 Autoriser la caméra et démarrer
                      <span className="ml-2 opacity-60 transition group-hover:translate-x-1">
                        →
                      </span>
                    </button>
                  )}
                  <button
                    onClick={startDemo}
                    className="rounded-full border border-cyan-300/40 bg-cyan-300/10 px-5 py-3.5 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-300/20"
                  >
                    ▶ Démo sans caméra
                  </button>
                  <button
                    onClick={() => photoInputRef.current?.click()}
                    className="rounded-full border border-white/20 bg-white/5 px-4 py-3.5 text-xs font-semibold text-zinc-200 transition hover:bg-white/10"
                  >
                    {demoImage ? "✓ Photo chargée (changer)" : "＋ Utiliser ma photo"}
                  </button>
                  <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={onPhotoSelected}
                  />
                  <span className="text-xs text-zinc-400">
                    ou <kbd className="rounded border border-white/20 px-1.5 py-0.5">C</kbd> caméra · <kbd className="rounded border border-white/20 px-1.5 py-0.5">D</kbd> démo
                  </span>
                </div>
                <p className="mt-3 text-[11px] text-cyan-200/75">
                  {diag.embedded
                    ? "Le bouton ouvre l'application dans son propre onglet : c'est là que le navigateur affiche la demande d'autorisation caméra, puis le scan démarre tout seul. Si aucun onglet ne s'ouvre, le lien est copié — colle-le dans un nouvel onglet (ou utilise le champ ci-dessus)."
                    : "Le navigateur va afficher la demande d'autorisation caméra ; accepte-la, l'armure s'équipe automatiquement."}
                </p>

                {error && (
                  <div className="mt-4 max-w-xl rounded-xl border border-red-300/35 bg-red-500/10 px-4 py-3 text-xs text-red-100">
                    <p className="font-semibold">Caméra non activée</p>
                    <p className="mt-1 leading-relaxed text-red-100/85">{error}</p>
                    {lastCameraError && (
                      <p className="mt-2 rounded-lg bg-black/35 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-red-200/80">
                        {lastCameraError.name} · {lastCameraError.message}
                        <br />
                        iframe: {diag.embedded ? "oui" : "non"} · politique caméra:{" "}
                        {diag.policyCamera === false
                          ? "BLOQUÉE"
                          : diag.policyCamera === true
                          ? "autorisée"
                          : "inconnue"}{" "}
                        · permission: {diag.permission} · caméras: {diag.devices} ·
                        HTTPS: {diag.secure ? "oui" : "non"} · hôte: {diag.host}
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        onClick={startCamera}
                        className="rounded-full bg-red-200 px-4 py-2 text-[11px] font-semibold text-black transition hover:bg-red-100"
                      >
                        ↻ Réessayer
                      </button>
                      <a
                        href={diag.autoCamUrl || diag.url || "#"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-full border border-white/25 bg-white/10 px-4 py-2 text-[11px] font-semibold text-white transition hover:bg-white/20"
                      >
                        🎥 Demander l&apos;autorisation dans un nouvel onglet ↗
                      </a>
                      <button
                        onClick={startDemo}
                        className="rounded-full border border-white/25 bg-white/10 px-4 py-2 text-[11px] font-semibold text-white transition hover:bg-white/20"
                      >
                        ▶ Mode démo
                      </button>
                    </div>
                    <p className="mt-2 text-[10px] leading-relaxed text-red-100/60">
                      Astuce : dans le nouvel onglet, clique sur l&apos;icône 🎥 à
                      droite de la barre d&apos;adresse → « Autoriser ». Si Chrome
                      a mémorisé un blocage, ouvre{" "}
                      <span className="font-mono">chrome://settings/content/camera</span>{" "}
                      et supprime l&apos;entrée bloquée pour {diag.host || "ce site"}.
                    </p>
                  </div>
                )}

                <div className="mt-9 grid max-w-xl grid-cols-3 gap-3">
                  {[
                    ["01", "Webcam", "Vue miroir + suivi MediaPipe local"],
                    ["02", "Scan", "Verrouillage épaules / hanches"],
                    ["03", "Suit-up", "5 images · 3 vidéos · 2 modèles 3D"],
                  ].map(([n, title, desc]) => (
                    <div
                      key={n}
                      className="rounded-xl border border-white/10 bg-white/[0.04] p-3"
                    >
                      <p className="font-mono text-[10px] text-cyan-300/80">{n}</p>
                      <p className="mt-1 text-sm font-semibold">{title}</p>
                      <p className="mt-1 text-[11px] leading-snug text-zinc-400">
                        {desc}
                      </p>
                    </div>
                  ))}
                </div>
              </section>

              {/* Vitrine 3D Blender */}
              <section className="relative">
                <div className="relative overflow-hidden rounded-3xl border border-cyan-300/20 bg-[radial-gradient(circle_at_50%_45%,rgba(20,80,110,0.35),rgba(3,8,16,0.9)_70%)] shadow-[0_0_70px_rgba(34,211,238,0.1)]">
                  <div className="absolute left-4 top-4 z-10">
                    <p className="text-[10px] uppercase tracking-[0.3em] text-cyan-200/80">
                      Modèle Blender · GLB
                    </p>
                    <p className="mt-1 text-xs text-zinc-300">
                      The_Nano_Tech_Shader_V2.blend
                    </p>
                  </div>
                  <div className="absolute right-4 top-4 z-10 rounded-full border border-cyan-300/30 bg-black/40 px-3 py-1 text-[10px] text-cyan-200">
                    Nano Tech FX V2
                  </div>
                  <div className="h-[300px] w-full sm:h-[380px]">
                    <BlenderPreview />
                  </div>
                  <div className="absolute inset-x-0 bottom-0 flex items-center justify-between border-t border-white/10 bg-black/40 px-4 py-2.5 text-[10px] text-zinc-400 backdrop-blur-sm">
                    <span>Suzanne · 12 755 sommets · textures PBR 1K</span>
                    <span className="text-cyan-300/80">WebGL / three.js</span>
                  </div>
                </div>
              </section>
            </div>

            {/* Galerie des assets réellement utilisés */}
            <section id="assets" className="border-t border-white/10 pt-6">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold tracking-wide">
                  ASSETS DU PROJET
                </h2>
                <p className="text-[11px] text-zinc-400">
                  {ASSET_COUNTS.images} images · {ASSET_COUNTS.videos} vidéos ·{" "}
                  {ASSET_COUNTS.models} modèles Blender
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
                {[
                  { src: ARMOR_STAGES[0].image, label: "Torse", kind: "IMAGE" },
                  { src: ARMOR_STAGES[1].image, label: "Répulseurs", kind: "IMAGE" },
                  { src: ARMOR_STAGES[2].image, label: "Gant", kind: "IMAGE" },
                  { src: ARMOR_STAGES[3].image, label: "Casque", kind: "IMAGE" },
                  { src: ARMOR_STAGES[4].image, label: "Armure", kind: "IMAGE" },
                  { src: ASSETS.greenPoster, label: "Fond vert", kind: "VIDÉO" },
                  { src: ASSETS.scanPoster, label: "Scan casque", kind: "VIDÉO" },
                  { src: ASSETS.modelPoster, label: "Blender", kind: "3D" },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="group relative aspect-[3/4] overflow-hidden rounded-xl border border-white/10 bg-black/40"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.src}
                      alt={item.label}
                      className="h-full w-full object-cover opacity-80 transition duration-500 group-hover:scale-105 group-hover:opacity-100"
                    />
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-2 pb-2 pt-6">
                      <p className="text-[9px] tracking-[0.2em] text-cyan-300/80">
                        {item.kind}
                      </p>
                      <p className="truncate text-[11px] font-medium">{item.label}</p>
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-[11px] leading-relaxed text-zinc-500">
                Caméra requise (HTTPS ou localhost). Le moteur de suivi MediaPipe
                est embarqué dans <span className="font-mono">/public/mediapipe</span> :
                aucun téléchargement externe n&apos;est nécessaire pendant
                l&apos;expérience. Les fichiers GLB sont générés depuis le
                <span className="font-mono"> .blend</span> via{" "}
                <span className="font-mono">tools/export_blender.py</span>.
              </p>
            </section>
          </div>
        </div>
      )}
    </main>
  );
}
