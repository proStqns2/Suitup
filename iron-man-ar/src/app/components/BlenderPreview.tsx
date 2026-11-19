"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { ASSETS } from "../armorStages";

/** Vitrine 3D du modèle Blender affichée sur l'écran d'accueil. */
export default function BlenderPreview() {
  const holderRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const holder = holderRef.current;
    if (!holder) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    } catch {
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.domElement.className = "h-full w-full";
    holder.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 0.15, 6.2);
    scene.add(new THREE.AmbientLight(0xc9ecff, 1.0));
    const key = new THREE.DirectionalLight(0x8ce8ff, 2.5);
    key.position.set(-2, 2, 3);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xffae55, 2.0);
    rim.position.set(2, -1, 2);
    scene.add(rim);

    const group = new THREE.Group();
    scene.add(group);
    const reactor = new THREE.Group();
    reactor.position.set(0, -1.35, -0.4);
    reactor.scale.setScalar(0.42);
    scene.add(reactor);

    let disposed = false;
    const loader = new GLTFLoader();
    loader.load(ASSETS.head, (gltf) => {
      if (disposed) return;
      gltf.scene.rotation.y = Math.PI;
      gltf.scene.scale.setScalar(1.15);
      gltf.scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          const mat = obj.material as THREE.MeshStandardMaterial;
          mat.side = THREE.DoubleSide;
        }
      });
      group.add(gltf.scene);
    });
    loader.load(ASSETS.reactor, (gltf) => {
      if (disposed) return;
      gltf.scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          const mat = obj.material as THREE.MeshStandardMaterial;
          mat.side = THREE.DoubleSide;
          if (mat.emissive) mat.emissiveIntensity = 2.6;
        }
      });
      reactor.add(gltf.scene);
    });

    const resize = () => {
      const w = Math.max(1, holder.clientWidth);
      const h = Math.max(1, holder.clientHeight);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(holder);

    let raf = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const t = now / 1000;
      group.rotation.y = Math.sin(t * 0.45) * 0.55;
      group.position.y = Math.sin(t * 0.8) * 0.07;
      reactor.rotation.z = t * 0.35;
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const m of mats) m.dispose();
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={holderRef} className="h-full w-full" aria-hidden="true" />;
}
