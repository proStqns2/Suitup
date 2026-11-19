"use client";

import dynamic from "next/dynamic";

/**
 * L'expérience dépend entièrement d'API navigateur (getUserMedia, WebGL,
 * permissions, WebAssembly). On désactive le rendu serveur : aucun arbre SSR
 * n'est produit, donc aucune divergence d'hydratation n'est possible, même
 * après un HMR ou un rechargement de l'iframe de prévisualisation.
 */
const SuitUpAR = dynamic(() => import("./components/SuitUpAR"), {
  ssr: false,
  loading: () => <BootScreen />,
});

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
          <div className="h-full w-1/3 animate-cine-bar origin-left rounded-full bg-gradient-to-r from-cyan-300 to-amber-200" />
        </div>
      </div>
    </main>
  );
}

export default function Home() {
  return <SuitUpAR />;
}
