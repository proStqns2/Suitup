"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RawLandmark } from "./poseMath";

type PoseSolution = {
  setOptions: (options: Record<string, unknown>) => void;
  onResults: (callback: (result: { poseLandmarks?: RawLandmark[] }) => void) => void;
  send: (input: { image: HTMLVideoElement }) => Promise<void>;
  close: () => Promise<void> | void;
};

declare global {
  interface Window {
    Pose?: new (options: {
      locateFile: (file: string) => string;
    }) => PoseSolution;
  }
}

type TrackerState = "idle" | "loading" | "ready" | "error";

/**
 * Suivi corporel MediaPipe Pose exécuté entièrement dans le navigateur.
 * Les fichiers WASM/TFLite sont servis depuis `/mediapipe` : aucun CDN externe,
 * donc l'expérience fonctionne aussi hors ligne une fois la page chargée.
 */
export function usePoseTracker(
  onResults: (landmarks: RawLandmark[] | null) => void
) {
  const callbackRef = useRef(onResults);
  useEffect(() => {
    callbackRef.current = onResults;
  }, [onResults]);
  const solutionRef = useRef<PoseSolution | null>(null);
  const scriptPromiseRef = useRef<Promise<void> | null>(null);
  const busyRef = useRef(false);
  const [state, setState] = useState<TrackerState>("idle");
  const [error, setError] = useState<string | null>(null);

  const loadScript = useCallback((): Promise<void> => {
    if (typeof window === "undefined") return Promise.resolve();
    if (window.Pose) return Promise.resolve();
    if (scriptPromiseRef.current) return scriptPromiseRef.current;
    scriptPromiseRef.current = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "/mediapipe/pose.js";
      script.async = true;
      script.onload = () => {
        if (window.Pose) resolve();
        else reject(new Error("Global Pose introuvable"));
      };
      script.onerror = () => reject(new Error("Moteur MediaPipe introuvable"));
      document.head.appendChild(script);
    });
    return scriptPromiseRef.current;
  }, []);

  const start = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      await loadScript();
      if (!window.Pose) throw new Error("Moteur MediaPipe indisponible");
      const pose = new window.Pose({
        locateFile: (file: string) => `/mediapipe/${file}`,
      });
      pose.setOptions({
        modelComplexity: 1,
        smoothLandmarks: true,
        enableSegmentation: false,
        smoothSegmentation: false,
        minDetectionConfidence: 0.55,
        minTrackingConfidence: 0.55,
        selfieMode: false,
      });
      pose.onResults((result) => {
        callbackRef.current(result?.poseLandmarks ?? null);
      });
      solutionRef.current = pose;
      setState("ready");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Impossible de charger le suivi corporel"
      );
      setState("error");
    }
  }, [loadScript]);

  const detect = useCallback((video: HTMLVideoElement | null) => {
    const pose = solutionRef.current;
    if (!pose || busyRef.current || !video || video.readyState < 2) return;
    busyRef.current = true;
    pose
      .send({ image: video })
      .catch(() => undefined)
      .finally(() => {
        busyRef.current = false;
      });
  }, []);

  const stop = useCallback(() => {
    try {
      solutionRef.current?.close();
    } catch {
      // ignore
    }
    solutionRef.current = null;
    busyRef.current = false;
    setState("idle");
  }, []);

  useEffect(() => () => stop(), [stop]);

  return { state, error, start, detect, stop };
}
