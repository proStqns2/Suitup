"use client";

import { Component, useEffect, useState, type ReactNode } from "react";
import SuitUpAR from "./components/SuitUpAR";

function BootScreen() {
  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-[#03060c] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,rgba(34,211,238,0.12),transparent_60%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-20 [background:linear-gradient(rgba(0,255,255,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(0,255,255,0.08)_1px,transparent_1px)] [background-size:48px_48px]" />
      <div className="relative flex flex-col items-center gap-5 text-center">
        <div className="grid h-14 w-14 place-items-center rounded-2xl border border-cyan-300/40 bg-cyan-300/10 font-mono text-lg font-bold text-cyan-200">
          86
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.36em] text-cyan-300/80">
            Stark Industries · AR Lab
          </p>
          <p className="mt-2 text-lg font-semibold tracking-wide">
            Initialisation du système Mark 86…
          </p>
        </div>
        <div className="h-1 w-48 overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-1/3 origin-left animate-cine-bar rounded-full bg-gradient-to-r from-cyan-300 to-amber-200" />
        </div>
      </div>
    </main>
  );
}

/** Évite une page blanche si un rendu client échoue (WebGL, extension…). */
class ErrorBoundary extends Component<
  { children: ReactNode },
  { message: string | null }
> {
  state = { message: null as string | null };

  static getDerivedStateFromError(error: unknown) {
    return {
      message: error instanceof Error ? error.message : String(error),
    };
  }

  render() {
    if (this.state.message) {
      return (
        <main className="grid min-h-dvh place-items-center bg-[#03060c] p-6 text-white">
          <div className="max-w-lg rounded-2xl border border-red-300/30 bg-red-500/10 p-6 text-center">
            <p className="text-[10px] uppercase tracking-[0.3em] text-red-200/80">
              Système Mark 86
            </p>
            <h1 className="mt-2 text-xl font-semibold">
              Le rendu a été interrompu
            </h1>
            <p className="mt-3 break-words font-mono text-xs text-red-100/75">
              {this.state.message}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="mt-5 rounded-full bg-cyan-300 px-6 py-2.5 text-sm font-semibold text-black transition hover:bg-cyan-200"
            >
              ↻ Recharger l&apos;application
            </button>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}

/**
 * Même sortie au premier rendu côté serveur ET côté client (l'écran de boot),
 * puis montage de l'application après hydratation. Pas de `next/dynamic` : un
 * chunk supplémentaire pouvait échouer dans l'iframe de prévisualisation et
 * laisser l'écran de boot figé, donc tous les boutons inertes.
 */
export default function Home() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setMounted(true), 0);
    return () => window.clearTimeout(id);
  }, []);
  return mounted ? (
    <ErrorBoundary>
      <SuitUpAR />
    </ErrorBoundary>
  ) : (
    <BootScreen />
  );
}
