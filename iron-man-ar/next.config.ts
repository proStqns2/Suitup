import type { NextConfig } from "next";

/**
 * `next build` et `next dev` partageaient le dossier `.next` : lancer un build
 * pendant que l'aperçu tournait écrasait les chunks du serveur de dev et
 * l'iframe affichait une page cassée. On sépare donc les deux sorties.
 */
const isProductionCommand =
  process.env.npm_lifecycle_event === "build" ||
  process.env.npm_lifecycle_event === "start" ||
  process.argv.includes("build") ||
  process.argv.includes("start");

const nextConfig: NextConfig = {
  distDir: isProductionCommand ? ".next-prod" : ".next",
  // Évite le double montage des contextes WebGL en développement.
  reactStrictMode: false,
  // Le site est servi derrière le proxy de prévisualisation Arena.
  allowedDevOrigins: ["*.e2b.app", "*.arena.site", "*.arena.ai"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/mediapipe/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        source: "/models/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
};

export default nextConfig;
