import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Évite le double montage des contextes WebGL en développement.
  reactStrictMode: false,
  // Le site est servi derrière le proxy de prévisualisation Arena.
  allowedDevOrigins: ["*.e2b.app"],
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
