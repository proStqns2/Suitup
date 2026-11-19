"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { ASSETS } from "../armorStages";
import {
  CHROMA_ASPECT,
  LM,
  clamp,
  computeChromaTransform,
  transformPoint,
  type Point,
  type PoseSnapshot,
  type Transform,
} from "../lib/poseMath";

type Props = {
  /** Repères du corps, mis à jour à chaque frame par le composant parent. */
  poseRef: MutableRefObject<PoseSnapshot | null>;
  /** Canvas partagé avec le parent (utilisé pour la capture d'écran). */
  canvasRef: MutableRefObject<HTMLCanvasElement | null>;
  visible: boolean;
  showHead: boolean;
  showReactor: boolean;
  showChroma: boolean;
  /** 0 = hologramme partiel, 1 = modèle entièrement matérialisé. */
  reveal: number;
  className?: string;
};

type WorldTarget = {
  x: number;
  y: number;
  scale: number;
  angle: number;
};

function radialGlowTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(120,240,255,0.85)");
    g.addColorStop(0.35, "rgba(45,190,255,0.35)");
    g.addColorStop(1, "rgba(0,80,140,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  }
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Calque WebGL : le modèle Blender (`nanotech_head.glb`), le réacteur 3D
 * (`arc_reactor.glb`) et la vidéo fond vert incrustée en chroma key.
 * Tout est ancré sur les repères MediaPipe, en coordonnées écran.
 */
export default function BlenderARLayer(props: Props) {
  const propsRef = useRef(props);
  const { canvasRef } = props;
  useEffect(() => {
    propsRef.current = props;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        premultipliedAlpha: false,
      });
    } catch {
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(0, 1, 1, 0, 0.1, 4000);
    camera.position.set(0, 0, 1200);
    let size = { w: 1, h: 1 };

    scene.add(new THREE.AmbientLight(0xbfe9ff, 0.75));
    const key = new THREE.DirectionalLight(0x9de9ff, 2.4);
    key.position.set(-0.6, 1, 2);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xffb457, 1.7);
    rim.position.set(1, -0.4, 1.4);
    scene.add(rim);
    const reactorLight = new THREE.PointLight(0x38e8ff, 0, 900, 2);
    scene.add(reactorLight);

    // --- Réacteur 3D (modèle créé dans Blender) ---
    const reactorGroup = new THREE.Group();
    reactorGroup.position.z = 40;
    scene.add(reactorGroup);
    const reactorMaterials: THREE.Material[] = [];

    // --- Tête nano-tech (mesh Suzanne du .blend) ---
    const headGroup = new THREE.Group();
    headGroup.position.z = 70;
    scene.add(headGroup);
    const headMaterials: THREE.MeshStandardMaterial[] = [];
    const wireMaterials: THREE.MeshBasicMaterial[] = [];
    const panelTexture = new THREE.TextureLoader().load(ASSETS.panel);
    panelTexture.wrapS = panelTexture.wrapT = THREE.RepeatWrapping;
    panelTexture.colorSpace = THREE.SRGBColorSpace;

    const nanoUniforms = {
      uReveal: { value: 0.4 },
      uTime: { value: 0 },
      uPanel: { value: panelTexture },
      uGlow: { value: 1.0 },
    };

    const decorateHead = (root: THREE.Object3D) => {
      root.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        const source = obj.material as THREE.MeshStandardMaterial;
        const mat = (Array.isArray(source) ? source[0] : source).clone();
        mat.side = THREE.DoubleSide;
        mat.transparent = true;
        mat.opacity = 0.92;
        mat.metalness = Math.max(mat.metalness ?? 0, 0.75);
        mat.roughness = Math.min(mat.roughness ?? 0.4, 0.42);
        mat.onBeforeCompile = (
          shader: Parameters<
            NonNullable<THREE.MeshStandardMaterial["onBeforeCompile"]>
          >[0]
        ) => {
          Object.assign(shader.uniforms, nanoUniforms);
          shader.vertexShader = shader.vertexShader
            .replace(
              "#include <common>",
              `#include <common>
               varying vec3 vNanoLocal;`
            )
            .replace(
              "#include <begin_vertex>",
              `#include <begin_vertex>
               vNanoLocal = position;`
            );
          shader.fragmentShader = shader.fragmentShader
            .replace(
              "#include <common>",
              `#include <common>
               varying vec3 vNanoLocal;
               uniform float uReveal;
               uniform float uTime;
               uniform float uGlow;
               uniform sampler2D uPanel;
               float nanoHash(vec2 p) {
                 return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
               }`
            )
            .replace(
              "#include <dithering_fragment>",
              `#include <dithering_fragment>
               float ny = clamp((vNanoLocal.y + 0.78) / 1.56, 0.0, 1.0);
               vec2 pp = vec2(vNanoLocal.x, vNanoLocal.z) * 1.35;
               float pattern = texture2D(uPanel, pp).r * 0.22
                             + nanoHash(floor(pp * 46.0)) * 0.12;
               float edge = uReveal * 1.28 - 0.06 + pattern;
               if (ny > edge) discard;
               float band = smoothstep(edge - 0.10, edge, ny) * uGlow;
               gl_FragColor.rgb += vec3(0.10, 0.88, 1.0) * band * 1.7;
               gl_FragColor.a *= 0.90 + 0.10 * sin(uTime * 2.2 + ny * 14.0);`
            );
        };
        mat.customProgramCacheKey = () => "mark86-nanotech-v2";
        obj.material = mat;
        headMaterials.push(mat);

        const wire = new THREE.Mesh(
          obj.geometry,
          new THREE.MeshBasicMaterial({
            color: 0x7de8ff,
            wireframe: true,
            transparent: true,
            opacity: 0.1,
            depthWrite: false,
            side: THREE.DoubleSide,
          })
        );
        wire.scale.setScalar(1.018);
        wireMaterials.push(wire.material as THREE.MeshBasicMaterial);
        obj.add(wire);
      });
    };

    let disposed = false;
    const loader = new GLTFLoader();
    loader.load(ASSETS.head, (gltf) => {
      if (disposed) return;
      decorateHead(gltf.scene);
      headGroup.add(gltf.scene);
    });
    loader.load(ASSETS.reactor, (gltf) => {
      if (disposed) return;
      gltf.scene.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        const mat = obj.material as THREE.MeshStandardMaterial;
        mat.side = THREE.DoubleSide;
        mat.transparent = true;
        mat.depthWrite = false;
        if (mat.emissive) mat.emissiveIntensity = 2.2;
        reactorMaterials.push(mat);
      });
      reactorGroup.add(gltf.scene);
    });

    // --- Halo lumineux derrière le réacteur ---
    const glowTex = radialGlowTexture();
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0.55,
      })
    );
    glow.position.z = 20;
    scene.add(glow);

    // --- Vidéo fond vert : chroma key dans un shader WebGL ---
    const greenVideo = document.createElement("video");
    greenVideo.src = ASSETS.chroma;
    greenVideo.loop = true;
    greenVideo.muted = true;
    greenVideo.playsInline = true;
    greenVideo.preload = "auto";
    greenVideo.setAttribute("playsinline", "");
    greenVideo.style.display = "none";
    document.body.appendChild(greenVideo);
    const videoTexture = new THREE.VideoTexture(greenVideo);
    videoTexture.colorSpace = THREE.SRGBColorSpace;
    videoTexture.minFilter = THREE.LinearFilter;
    videoTexture.magFilter = THREE.LinearFilter;
    const chromaUniforms = {
      uTex: { value: videoTexture },
      uOpacity: { value: 0 },
      uTime: { value: 0 },
    };
    const chromaMaterial = new THREE.ShaderMaterial({
      uniforms: chromaUniforms,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform sampler2D uTex;
        uniform float uOpacity;
        uniform float uTime;
        void main() {
          vec3 c = texture2D(uTex, vUv).rgb;
          float green = c.g - max(c.r, c.b);
          float a = 1.0 - smoothstep(0.10, 0.30, green);
          // Supprime les reflets verts sur les bords du métal.
          c = mix(c, vec3(dot(c, vec3(0.299, 0.587, 0.114))), clamp(green * 1.4, 0.0, 0.55));
          float edge = smoothstep(0.08, 0.24, green) * (1.0 - smoothstep(0.24, 0.45, green));
          float scan = 0.94 + 0.06 * sin(vUv.y * 480.0 + uTime * 9.0);
          c = c * scan + vec3(0.05, 0.75, 1.0) * edge * 0.75;
          gl_FragColor = vec4(c, a * uOpacity);
        }
      `,
    });
    const chromaMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, CHROMA_ASPECT),
      chromaMaterial
    );
    chromaMesh.position.z = 10;
    chromaMesh.renderOrder = 1;
    scene.add(chromaMesh);

    const resize = () => {
      const parent = canvas.parentElement;
      const w = Math.max(1, parent?.clientWidth ?? window.innerWidth);
      const h = Math.max(1, parent?.clientHeight ?? window.innerHeight);
      size = { w, h };
      renderer.setSize(w, h, false);
      camera.left = 0;
      camera.right = w;
      camera.top = h;
      camera.bottom = 0;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    if (canvas.parentElement) observer.observe(canvas.parentElement);
    window.addEventListener("resize", resize);

    const smoothHead: WorldTarget = { x: 0, y: 0, scale: 0, angle: 0 };
    const smoothReactor: WorldTarget = { x: 0, y: 0, scale: 0, angle: 0 };
    let headAlpha = 0;
    let reactorAlpha = 0;
    let chromaAlpha = 0;
    let glowAlpha = 0;
    let chromaWanted = false;
    let raf = 0;

    const toWorld = (p: Point, h: number) => ({ x: p.x, y: h - p.y });

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const p = propsRef.current;
      const snap = p.poseRef.current;
      const t = now / 1000;
      nanoUniforms.uTime.value = t;
      chromaUniforms.uTime.value = t;

      // --- Cibles à partir du corps ---
      let headTarget: WorldTarget | null = null;
      let reactorTarget: WorldTarget | null = null;
      let chromaFit: Transform | null = null;

      if (snap && snap.valid && snap.shoulderWidth > 1) {
        const ls = snap.points[LM.leftShoulder]!;
        const rs = snap.points[LM.rightShoulder]!;
        const nose = snap.points[LM.nose];
        const le = snap.points[LM.leftEar];
        const re = snap.points[LM.rightEar];
        const shoulderMid = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
        const lh = snap.points[LM.leftHip];
        const rh = snap.points[LM.rightHip];
        const hipMid =
          lh && rh
            ? { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 }
            : { x: shoulderMid.x, y: shoulderMid.y + snap.shoulderWidth * 1.05 };
        const torsoH = Math.max(snap.shoulderWidth * 0.8, hipMid.y - shoulderMid.y);
        const sw = snap.shoulderWidth;

        const headCenter: Point =
          le && re
            ? { x: (le.x + re.x) / 2, y: (le.y + re.y) / 2 }
            : nose
            ? { x: nose.x, y: nose.y - sw * 0.06 }
            : { x: shoulderMid.x, y: shoulderMid.y - sw * 0.62 };
        headTarget = {
          ...toWorld(headCenter, size.h),
          scale: clamp(sw * 0.34, size.w * 0.08, size.w * 0.65),
          angle: -snap.shoulderAngle,
        };
        reactorTarget = {
          ...toWorld(
            {
              x: shoulderMid.x,
              y: shoulderMid.y + torsoH * 0.46,
            },
            size.h
          ),
          scale: clamp(sw * 0.19, size.w * 0.04, size.w * 0.4),
          angle: -snap.shoulderAngle,
        };
        chromaFit = computeChromaTransform(snap);
      } else {
        // Aucun corps détecté : le modèle 3D reste visible en vitrine.
        const unit = Math.min(size.w, size.h);
        headTarget = {
          x: size.w * 0.5,
          y: size.h * 0.62,
          scale: unit * 0.2,
          angle: 0,
        };
        reactorTarget = {
          x: size.w * 0.5,
          y: size.h * 0.36,
          scale: unit * 0.075,
          angle: 0,
        };
      }

      // --- Lissage ---
      const lerpTarget = (cur: WorldTarget, target: WorldTarget | null, a: number) => {
        if (!target || cur.scale === 0) {
          if (target) Object.assign(cur, target);
          return;
        }
        cur.x += (target.x - cur.x) * a;
        cur.y += (target.y - cur.y) * a;
        cur.scale += (target.scale - cur.scale) * a;
        cur.angle += (target.angle - cur.angle) * a;
      };
      lerpTarget(smoothHead, headTarget, 0.18);
      lerpTarget(smoothReactor, reactorTarget, 0.18);

      const wantHead = p.visible && p.showHead && headTarget ? 1 : 0;
      const wantReactor = p.visible && p.showReactor && reactorTarget ? 1 : 0;
      const wantChroma = p.visible && p.showChroma ? 1 : 0;
      headAlpha += (wantHead - headAlpha) * 0.09;
      reactorAlpha += (wantReactor - reactorAlpha) * 0.09;
      chromaAlpha += (wantChroma - chromaAlpha) * 0.12;
      glowAlpha += (wantReactor * 0.6 - glowAlpha) * 0.08;

      // --- Tête 3D ---
      headGroup.visible = headAlpha > 0.01 && smoothHead.scale > 0;
      if (headGroup.visible) {
        headGroup.position.set(smoothHead.x, smoothHead.y, 70);
        headGroup.scale.setScalar(smoothHead.scale);
        headGroup.rotation.set(
          Math.sin(t * 0.6) * 0.06,
          Math.PI + Math.sin(t * 0.42) * 0.32,
          smoothHead.angle * 0.6 + Math.sin(t * 0.5) * 0.04
        );
      }
      const revealTarget = clamp(p.reveal, 0.08, 1);
      nanoUniforms.uReveal.value +=
        (revealTarget - nanoUniforms.uReveal.value) * 0.06;
      nanoUniforms.uGlow.value = 0.6 + 0.4 * Math.sin(t * 2.0) ** 2;
      for (const mat of headMaterials) mat.opacity = 0.92 * headAlpha;
      for (const mat of wireMaterials) mat.opacity = 0.13 * headAlpha;

      // --- Réacteur 3D ---
      reactorGroup.visible = reactorAlpha > 0.01 && smoothReactor.scale > 0;
      if (reactorGroup.visible) {
        reactorGroup.position.set(smoothReactor.x, smoothReactor.y, 40);
        reactorGroup.scale.setScalar(smoothReactor.scale);
        reactorGroup.rotation.set(Math.sin(t * 0.4) * 0.18, Math.sin(t * 0.55) * 0.35, -t * 0.16);
        const pulse = 1.0 + 0.035 * Math.sin(t * 3.4);
        reactorGroup.scale.multiplyScalar(pulse);
      }
      for (const mat of reactorMaterials) mat.opacity = reactorAlpha;
      reactorLight.position.set(smoothReactor.x, smoothReactor.y, 110);
      reactorLight.intensity = reactorAlpha * 2.4 * (1 + 0.25 * Math.sin(t * 3.2));
      glow.position.set(smoothReactor.x, smoothReactor.y, 20);
      const glowSize = Math.max(smoothReactor.scale * 9, 120);
      glow.scale.set(glowSize, glowSize, 1);
      (glow.material as THREE.SpriteMaterial).opacity = glowAlpha;

      // --- Vidéo chroma key ---
      if (wantChroma && !chromaWanted) {
        void greenVideo.play().catch(() => undefined);
      }
      if (!wantChroma && chromaWanted) greenVideo.pause();
      chromaWanted = Boolean(wantChroma);
      chromaMesh.visible = chromaAlpha > 0.01;
      if (chromaMesh.visible) {
        const fallbackScale = Math.min(size.w * 0.9, size.h * 1.25);
        const fallback: Transform = {
          scale: fallbackScale,
          angle: 0,
          tx: (size.w - fallbackScale) / 2,
          ty: (size.h - fallbackScale * CHROMA_ASPECT) / 2,
        };
        const fit = chromaFit ?? fallback;
        const center = transformPoint(fit, {
          x: 0.5,
          y: 0.5 * CHROMA_ASPECT,
        });
        chromaMesh.position.set(center.x, size.h - center.y, 10);
        chromaMesh.rotation.z = -fit.angle;
        chromaMesh.scale.setScalar(fit.scale);
      }
      chromaUniforms.uOpacity.value = chromaAlpha;

      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("resize", resize);
      greenVideo.pause();
      greenVideo.removeAttribute("src");
      greenVideo.load();
      greenVideo.remove();
      videoTexture.dispose();
      glowTex.dispose();
      panelTexture.dispose();
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const m of mats) m.dispose();
        }
      });
      renderer.dispose();
    };
  }, [canvasRef]);

  return (
    <canvas
      ref={canvasRef}
      className={
        props.className ??
        "pointer-events-none absolute inset-0 z-[15] h-full w-full"
      }
    />
  );
}
