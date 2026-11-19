import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "MARK 86 · Suit-Up AR",
  description:
    "Expérience webcam : l'armure Iron Man s'assemble sur toi en temps réel (images, vidéos et modèle 3D Blender).",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#03060c",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="fr" className="h-full antialiased">
      <body className="min-h-dvh bg-black text-white">{children}</body>
    </html>
  );
}
