import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Compass, Eye, Minus, MoveHorizontal, Plus, RotateCcw } from 'lucide-react';
import { createAircraftMesh, createTextSprite } from '../lib/three/aircraftMesh';
import {
  Consolidation,
  mulberry32,
  PathTree,
  PipelineStage,
  PruneResult,
  RuntimeResult,
  SEG_ACCEPTED,
  SEGMENT_SAMPLES,
} from '../lib/trajectoryTree';

interface Props {
  tree: PathTree;
  prune: PruneResult;
  consolidation: Consolidation;
  runtime: RuntimeResult | null;
  stage: PipelineStage;
  onAnimationDone: (stage: PipelineStage) => void;
}

// Animation timings (ms) — tuned to be followable by a human audience.
const GEN_HOP_MS = 650;
const DENOISE_MS = 900;
const PRUNE_HOP_MS = 1100;
const FADE_REJECTED_MS = 500;
const MERGE_MS = 1700;
const TUBE_FADE_MS = 400;

const VERTS_PER_SEG = (SEGMENT_SAMPLES - 1) * 2;

const COLOR_PENDING = new THREE.Color(0x22d3ee).multiplyScalar(0.85);
const COLOR_ACCEPTED = new THREE.Color(0x22c55e);
const COLOR_REJECTED = new THREE.Color(0xef4444);
const COLOR_YELLOW = new THREE.Color(0xfacc15);
const COLOR_OPTIMAL = new THREE.Color(0xfde047);
const COLOR_PRUNED = new THREE.Color(0x475569);
const COLOR_BG = new THREE.Color(0x040814);

type Anim =
  | { kind: 'generate'; start: number; amps: number[] }
  | { kind: 'prune'; start: number; revealed: number[]; order: Int32Array[] }
  | { kind: 'consolidate'; start: number; phase: 0 | 1 | 2 }
  | null;

interface TubeState {
  mesh: THREE.Mesh;
  label: THREE.Sprite;
  opacity: number;
  targetOpacity: number;
  color: THREE.Color;
  targetColor: THREE.Color;
}

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export const PathTreeViewport3D: React.FC<Props> = ({ tree, prune, consolidation, runtime, stage, onAnimationDone }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);

  // Tree (stage 1/2) objects
  const treeLines = useRef<THREE.LineSegments | null>(null);
  const treeNodes = useRef<THREE.Points | null>(null);
  const noise = useRef<Float32Array>(new Float32Array(0));
  const nodeNoise = useRef<Float32Array>(new Float32Array(0));
  const hopLabels = useRef<THREE.Group | null>(null);
  const scanPlane = useRef<THREE.Mesh | null>(null);
  const hopMeanZ = useRef<number[]>([]);

  // Consolidation (stage 3/4) objects
  const mergeLines = useRef<THREE.LineSegments | null>(null);
  const mergeFrom = useRef<Float32Array>(new Float32Array(0));
  const mergeTo = useRef<Float32Array>(new Float32Array(0));
  const tubes = useRef<TubeState[]>([]);
  const tubeGroup = useRef<THREE.Group | null>(null);
  const optimalGlow = useRef<THREE.Mesh | null>(null);
  const optimalTag = useRef<THREE.Sprite | null>(null);

  const anim = useRef<Anim>(null);
  const stageRef = useRef<PipelineStage>(stage);
  const treeRef = useRef(tree);
  const pruneRef = useRef(prune);
  const doneRef = useRef(onAnimationDone);
  doneRef.current = onAnimationDone;
  treeRef.current = tree;
  pruneRef.current = prune;

  // Orbit camera
  const orbit = useRef({ radius: 40, theta: -2.35, phi: 1.12 });
  const orbitTarget = useRef(new THREE.Vector3(0, 0, 9));
  const camPos = useRef(new THREE.Vector3(-30, 25, -20));
  const camLook = useRef(new THREE.Vector3(0, 0, 9));
  const dragging = useRef<{ x: number; y: number } | null>(null);
  const extentRef = useRef(20);

  const [live, setLive] = useState({ caption: '', accepted: 0, rejected: 0, hop: 0 });
  const liveThrottle = useRef(0);

  const defaultRadius = () => Math.max(24, extentRef.current * 1.15 + 10);

  // ───────────────────────── Scene bootstrap ─────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x040814);
    scene.fog = new THREE.FogExp2(0x040814, 0.0065);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(46, container.clientWidth / Math.max(1, container.clientHeight), 0.3, 900);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    rendererRef.current = renderer;

    scene.add(new THREE.AmbientLight(0xdbeafe, 0.95));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(35, 70, -45);
    scene.add(sun);
    const rim = new THREE.DirectionalLight(0x38bdf8, 0.9);
    rim.position.set(-35, 25, 35);
    scene.add(rim);

    const grid = new THREE.GridHelper(260, 86, 0x0284c7, 0x172554);
    grid.position.set(0, -14, 40);
    scene.add(grid);

    // Original course reference line
    const courseGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 2.5), new THREE.Vector3(0, 0, 140)]);
    const course = new THREE.Line(courseGeo, new THREE.LineDashedMaterial({ color: 0x64748b, dashSize: 0.8, gapSize: 0.6, transparent: true, opacity: 0.6 }));
    course.computeLineDistances();
    scene.add(course);

    const { group: aircraft } = createAircraftMesh(0x06b6d4, 0x0284c7);
    scene.add(aircraft);
    const tag = createTextSprite('AXIS-01 · OWNSHIP', '#22d3ee', 'rgba(8, 20, 40, 0.9)');
    tag.position.set(0, 2.2, -0.6);
    tag.scale.set(4.2, 1.2, 1);
    aircraft.add(tag);

    // "LLM scan" plane that sweeps hop by hop during pruning
    const scan = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false })
    );
    scan.visible = false;
    scene.add(scan);
    scanPlane.current = scan;

    const tg = new THREE.Group();
    scene.add(tg);
    tubeGroup.current = tg;

    let raf = 0;
    const clock = new THREE.Clock();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const t = clock.getElapsedTime();
      tick(performance.now(), t);

      const { radius, theta, phi } = orbit.current;
      const desired = new THREE.Vector3(
        radius * Math.sin(phi) * Math.sin(theta),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.cos(theta)
      ).add(orbitTarget.current);
      camPos.current.lerp(desired, 0.1);
      camLook.current.lerp(orbitTarget.current, 0.1);
      camera.position.copy(camPos.current);
      camera.lookAt(camLook.current);
      renderer.render(scene, camera);
    };
    loop();

    const ro = new ResizeObserver(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    });
    ro.observe(container);

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomBy(Math.exp(e.deltaY * 0.0012));
    };
    container.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      container.removeEventListener('wheel', onWheel);
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        mesh.geometry?.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose();
      });
      renderer.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const zoomBy = (factor: number) => {
    const maxR = extentRef.current * 4 + 40;
    orbit.current.radius = Math.min(maxR, Math.max(5, orbit.current.radius * factor));
  };

  const setPreset = (preset: 'ISO' | 'BEHIND' | 'SIDE' | 'TOP') => {
    const r = defaultRadius();
    const presets = {
      ISO: { radius: r, theta: -2.35, phi: 1.12 },
      BEHIND: { radius: r * 0.8, theta: Math.PI, phi: 1.32 },
      SIDE: { radius: r, theta: -Math.PI / 2, phi: 1.5 },
      TOP: { radius: r * 1.1, theta: Math.PI, phi: 0.12 },
    } as const;
    orbit.current = { ...presets[preset] };
  };

  // ───────────────────────── Tree geometry ─────────────────────────
  /**
   * Writes segment `s` with diffusion noise. Noise lives on nodes (interpolated along the
   * segment, so branches stay attached to their parent) plus a mid-segment wiggle.
   * `ampParent` / `ampChild` are the denoising amplitudes of the two endpoint hops.
   */
  const writeSegment = (s: number, ampParent: number, ampChild: number) => {
    const lines = treeLines.current;
    const nodes = treeNodes.current;
    if (!lines || !nodes) return;
    const pos = lines.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const tr = treeRef.current;
    const pts = tr.segPoints;
    const jit = noise.current;
    const nn = nodeNoise.current;
    const pn = tr.nodeParent[s + 1] * 3;
    const cn = (s + 1) * 3;
    const sample = (k: number, out: number[]) => {
      const i = (s * SEGMENT_SAMPLES + k) * 3;
      const t = k / (SEGMENT_SAMPLES - 1);
      const wp = (1 - t) * ampParent;
      const wc = t * ampChild;
      const wj = Math.sin(Math.PI * t) * ampChild;
      out[0] = pts[i] + nn[pn] * wp + nn[cn] * wc + jit[i] * wj;
      out[1] = pts[i + 1] + nn[pn + 1] * wp + nn[cn + 1] * wc + jit[i + 1] * wj;
      out[2] = pts[i + 2] + nn[pn + 2] * wp + nn[cn + 2] * wc + jit[i + 2] * wj;
    };
    const a = [0, 0, 0];
    const b = [0, 0, 0];
    let o = s * VERTS_PER_SEG * 3;
    sample(0, a);
    for (let k = 1; k < SEGMENT_SAMPLES; k++) {
      sample(k, b);
      arr[o++] = a[0];
      arr[o++] = a[1];
      arr[o++] = a[2];
      arr[o++] = b[0];
      arr[o++] = b[1];
      arr[o++] = b[2];
      a[0] = b[0];
      a[1] = b[1];
      a[2] = b[2];
    }
    const np = (nodes.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    np[s * 3] = a[0];
    np[s * 3 + 1] = a[1];
    np[s * 3 + 2] = a[2];
  };

  const paintSegment = (s: number, color: THREE.Color) => {
    const lines = treeLines.current;
    if (!lines) return;
    const arr = (lines.geometry.getAttribute('color') as THREE.BufferAttribute).array as Float32Array;
    let o = s * VERTS_PER_SEG * 3;
    for (let v = 0; v < VERTS_PER_SEG; v++) {
      arr[o++] = color.r;
      arr[o++] = color.g;
      arr[o++] = color.b;
    }
  };

  const paintAll = (pick: (s: number) => THREE.Color) => {
    for (let s = 0; s < treeRef.current.segCount; s++) paintSegment(s, pick(s));
    markDirty(false, true);
  };

  const markDirty = (positions: boolean, colors: boolean) => {
    if (!treeLines.current || !treeNodes.current) return;
    if (positions) {
      treeLines.current.geometry.getAttribute('position').needsUpdate = true;
      treeNodes.current.geometry.getAttribute('position').needsUpdate = true;
    }
    if (colors) treeLines.current.geometry.getAttribute('color').needsUpdate = true;
  };

  const setDrawnSegments = (count: number) => {
    treeLines.current?.geometry.setDrawRange(0, count * VERTS_PER_SEG);
    treeNodes.current?.geometry.setDrawRange(0, count);
  };

  const verdictColor = (s: number) => (pruneRef.current.status[s] === SEG_ACCEPTED ? COLOR_ACCEPTED : COLOR_REJECTED);

  // Rebuild tree buffers whenever a new tree is generated.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    [treeLines.current, treeNodes.current].forEach((obj) => {
      if (!obj) return;
      scene.remove(obj);
      obj.geometry.dispose();
      (obj.material as THREE.Material).dispose();
    });
    if (hopLabels.current) {
      scene.remove(hopLabels.current);
      hopLabels.current.children.forEach((c) => {
        const mat = (c as THREE.Sprite).material;
        mat.map?.dispose();
        mat.dispose();
      });
    }

    const segCount = tree.segCount;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(segCount * VERTS_PER_SEG * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(segCount * VERTS_PER_SEG * 3), 3));
    const dense = segCount > 4000;
    const lines = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: dense ? 0.4 : 0.8, depthWrite: false })
    );
    lines.frustumCulled = false;
    scene.add(lines);
    treeLines.current = lines;

    const nodeGeo = new THREE.BufferGeometry();
    nodeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(segCount * 3), 3));
    const nodes = new THREE.Points(
      nodeGeo,
      new THREE.PointsMaterial({ color: 0xe0f2fe, size: dense ? 0.12 : 0.28, transparent: true, opacity: 0.85, depthWrite: false })
    );
    nodes.frustumCulled = false;
    scene.add(nodes);
    treeNodes.current = nodes;

    // Diffusion noise (Gaussian): per node, plus a smaller per-sample wiggle. Grows with hop depth.
    const rng = mulberry32(segCount * 7 + 3);
    const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-6, rng()))) * Math.cos(2 * Math.PI * rng());
    const nn = new Float32Array(tree.nodeCount * 3);
    for (let n = 1; n < tree.nodeCount; n++) {
      const scale = 1.2 + tree.nodeHop[n] * 0.45;
      for (let k = 0; k < 3; k++) nn[n * 3 + k] = gauss() * scale;
    }
    nodeNoise.current = nn;
    const nz = new Float32Array(segCount * SEGMENT_SAMPLES * 3);
    for (let i = 0; i < nz.length; i++) nz[i] = gauss() * 0.6;
    noise.current = nz;

    for (let s = 0; s < segCount; s++) {
      writeSegment(s, 0, 0);
      paintSegment(s, COLOR_PENDING);
    }
    markDirty(true, true);

    // Hop labels + extents
    const labels = new THREE.Group();
    const meanZ: number[] = [0];
    let maxZ = 10;
    for (let h = 1; h <= tree.hops; h++) {
      let sumZ = 0;
      let maxY = -Infinity;
      let count = 0;
      for (let s = tree.hopSegStart[h - 1]; s < tree.hopSegStart[h]; s++) {
        const n = s + 1;
        sumZ += tree.nodePos[n * 3 + 2];
        maxY = Math.max(maxY, tree.nodePos[n * 3 + 1]);
        maxZ = Math.max(maxZ, tree.nodePos[n * 3 + 2]);
        count++;
      }
      const z = sumZ / Math.max(1, count);
      meanZ.push(z);
      const sprite = createTextSprite(`HOP ${h}`, '#93c5fd', 'rgba(6, 15, 30, 0.85)');
      sprite.scale.set(4.4, 1.26, 1);
      sprite.position.set(0, maxY + 1.8, z);
      labels.add(sprite);
    }
    scene.add(labels);
    hopLabels.current = labels;
    hopMeanZ.current = meanZ;

    const previousExtent = extentRef.current;
    extentRef.current = maxZ;
    orbitTarget.current.set(0, 0, maxZ * 0.45);
    if (Math.abs(previousExtent - maxZ) > 3) orbit.current.radius = defaultRadius();

    applyStage(stageRef.current, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree]);

  // ───────────────────────── Consolidation geometry ─────────────────────────
  useEffect(() => {
    const scene = sceneRef.current;
    const group = tubeGroup.current;
    if (!scene || !group) return;

    if (mergeLines.current) {
      scene.remove(mergeLines.current);
      mergeLines.current.geometry.dispose();
      (mergeLines.current.material as THREE.Material).dispose();
      mergeLines.current = null;
    }
    tubes.current.forEach((t) => {
      t.mesh.geometry.dispose();
      (t.mesh.material as THREE.Material).dispose();
      (t.label.material as THREE.SpriteMaterial).map?.dispose();
      t.label.material.dispose();
    });
    group.clear();
    tubes.current = [];

    const { memberCount: M, pointsPerPath: P, memberPolylines, memberCluster, centroids } = consolidation;
    const pieces = P - 1;
    const from = new Float32Array(M * pieces * 2 * 3);
    const to = new Float32Array(M * pieces * 2 * 3);
    for (let m = 0; m < M; m++) {
      const c = centroids[memberCluster[m]];
      for (let j = 0; j < pieces; j++) {
        for (let e = 0; e < 2; e++) {
          const src = (m * P + j + e) * 3;
          const cs = (j + e) * 3;
          const dst = ((m * pieces + j) * 2 + e) * 3;
          from[dst] = memberPolylines[src];
          from[dst + 1] = memberPolylines[src + 1];
          from[dst + 2] = memberPolylines[src + 2];
          to[dst] = c[cs];
          to[dst + 1] = c[cs + 1];
          to[dst + 2] = c[cs + 2];
        }
      }
    }
    mergeFrom.current = from;
    mergeTo.current = to;
    const mgeo = new THREE.BufferGeometry();
    mgeo.setAttribute('position', new THREE.BufferAttribute(from.slice(), 3));
    mgeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(from.length), 3));
    const merge = new THREE.LineSegments(
      mgeo,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.75, depthWrite: false })
    );
    merge.frustumCulled = false;
    merge.visible = false;
    scene.add(merge);
    mergeLines.current = merge;

    centroids.forEach((poly, i) => {
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k < P; k++) pts.push(new THREE.Vector3(poly[k * 3], poly[k * 3 + 1], poly[k * 3 + 2]));
      const curve = new THREE.CatmullRomCurve3(pts);
      const mat = new THREE.MeshStandardMaterial({
        color: COLOR_YELLOW.clone(),
        emissive: 0xa16207,
        emissiveIntensity: 0.7,
        roughness: 0.35,
        metalness: 0.1,
        transparent: true,
        opacity: 0,
      });
      const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(24, P * 3), 0.14, 8, false), mat);
      mesh.visible = false;
      const label = createTextSprite(`T${i + 1}`, '#facc15', 'rgba(30, 24, 4, 0.9)');
      label.scale.set(1.5, 0.45, 1);
      label.position.copy(pts[pts.length - 1]).add(new THREE.Vector3(0, 0.9, 0.6));
      label.visible = false;
      group.add(mesh, label);
      tubes.current.push({
        mesh,
        label,
        opacity: 0,
        targetOpacity: 0,
        color: COLOR_YELLOW.clone(),
        targetColor: COLOR_YELLOW.clone(),
      });
    });

    applyStage(stageRef.current, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consolidation]);

  // ───────────────────────── Stage transitions ─────────────────────────
  const setTreeVisible = (v: boolean) => {
    if (treeLines.current) treeLines.current.visible = v;
    if (treeNodes.current) treeNodes.current.visible = v;
    if (hopLabels.current) hopLabels.current.visible = v;
  };

  const setTubeTargets = (pick: (i: number) => { opacity: number; color: THREE.Color }, instant = false) => {
    tubes.current.forEach((t, i) => {
      const { opacity, color } = pick(i);
      t.targetOpacity = opacity;
      t.targetColor.copy(color);
      if (instant) {
        t.opacity = opacity;
        t.color.copy(color);
      }
    });
  };

  const clearOptimal = () => {
    const scene = sceneRef.current;
    if (scene && optimalGlow.current) {
      scene.remove(optimalGlow.current);
      optimalGlow.current.geometry.dispose();
      (optimalGlow.current.material as THREE.Material).dispose();
    }
    if (scene && optimalTag.current) {
      // Sprites share a static geometry — only dispose the material + texture.
      scene.remove(optimalTag.current);
      optimalTag.current.material.map?.dispose();
      optimalTag.current.material.dispose();
    }
    optimalGlow.current = null;
    optimalTag.current = null;
  };

  const applyRuntime = (rt: RuntimeResult | null) => {
    clearOptimal();
    if (!rt) return;
    const survivors = new Set(rt.survivors);
    setTubeTargets((i) =>
      survivors.has(i)
        ? { opacity: 1, color: i === rt.optimal ? COLOR_OPTIMAL : COLOR_YELLOW }
        : { opacity: 0, color: COLOR_PRUNED }
    );
    const opt = tubes.current[rt.optimal];
    const scene = sceneRef.current;
    if (!opt || !scene) return;
    const params = (opt.mesh.geometry as THREE.TubeGeometry).parameters;
    const glow = new THREE.Mesh(
      new THREE.TubeGeometry(params.path, params.tubularSegments, 0.42, 12, false),
      new THREE.MeshBasicMaterial({ color: 0xfef08a, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    scene.add(glow);
    optimalGlow.current = glow;
    const tag = createTextSprite('OPTIMAL · NN', '#fde047', 'rgba(40, 30, 4, 0.92)');
    tag.scale.set(3.4, 0.98, 1);
    tag.position.copy(opt.label.position).add(new THREE.Vector3(0, 1.1, 0));
    scene.add(tag);
    optimalTag.current = tag;
  };

  const applyStage = (s: PipelineStage, rebuilt = false) => {
    const tr = treeRef.current;
    if (!treeLines.current) return;
    const now = performance.now();
    if (scanPlane.current) scanPlane.current.visible = false;
    if (mergeLines.current) mergeLines.current.visible = false;
    if (s !== 'runtime') clearOptimal();

    switch (s) {
      case 'idle':
        anim.current = null;
        setTreeVisible(false);
        setTubeTargets(() => ({ opacity: 0, color: COLOR_YELLOW }), true);
        setLive({ caption: 'Press “Generate paths” to start the diffusion wavefront', accepted: 0, rejected: 0, hop: 0 });
        break;
      case 'generating': {
        setTreeVisible(true);
        if (hopLabels.current) hopLabels.current.children.forEach((c) => (c.visible = false));
        setTubeTargets(() => ({ opacity: 0, color: COLOR_YELLOW }), true);
        paintAll(() => COLOR_PENDING);
        for (let i = 0; i < tr.segCount; i++) writeSegment(i, tr.nodeHop[i + 1] === 1 ? 0 : 1, 1);
        markDirty(true, false);
        setDrawnSegments(0);
        // amps[h] = denoising amplitude of hop-h nodes (root is always exact).
        anim.current = { kind: 'generate', start: now, amps: [0, ...new Array(tr.hops).fill(1)] };
        break;
      }
      case 'generated':
        anim.current = null;
        setTreeVisible(true);
        hopLabels.current?.children.forEach((c) => (c.visible = true));
        setTubeTargets(() => ({ opacity: 0, color: COLOR_YELLOW }), true);
        for (let i = 0; i < tr.segCount; i++) writeSegment(i, 0, 0);
        markDirty(true, false);
        paintAll(() => COLOR_PENDING);
        setDrawnSegments(tr.segCount);
        setLive({ caption: `${tr.segCount.toLocaleString()} candidate segments generated — ready for LLM pruning`, accepted: 0, rejected: 0, hop: tr.hops });
        break;
      case 'pruning': {
        setTreeVisible(true);
        hopLabels.current?.children.forEach((c) => (c.visible = true));
        setDrawnSegments(tr.segCount);
        paintAll(() => COLOR_PENDING);
        const rng = mulberry32(tr.segCount + 99);
        const order: Int32Array[] = [new Int32Array(0)];
        for (let h = 1; h <= tr.hops; h++) {
          const lo = tr.hopSegStart[h - 1];
          const n = tr.hopSegStart[h] - lo;
          const arr = new Int32Array(n);
          for (let i = 0; i < n; i++) arr[i] = lo + i;
          for (let i = n - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            const tmp = arr[i];
            arr[i] = arr[j];
            arr[j] = tmp;
          }
          order.push(arr);
        }
        anim.current = { kind: 'prune', start: now, revealed: new Array(tr.hops + 1).fill(0), order };
        if (scanPlane.current) scanPlane.current.visible = true;
        break;
      }
      case 'pruned':
        anim.current = null;
        setTreeVisible(true);
        hopLabels.current?.children.forEach((c) => (c.visible = true));
        setDrawnSegments(tr.segCount);
        paintAll(verdictColor);
        setTubeTargets(() => ({ opacity: 0, color: COLOR_YELLOW }), true);
        setLive({
          caption: `LLM pruning complete — ${pruneRef.current.acceptedLeaves.length} feasible end-to-end paths`,
          accepted: pruneRef.current.acceptedCount,
          rejected: pruneRef.current.rejectedCount,
          hop: tr.hops,
        });
        break;
      case 'consolidating':
        if (rebuilt) {
          // Data changed mid-animation: jump to the end state.
          applyStage('consolidated');
          doneRef.current('consolidating');
          return;
        }
        anim.current = { kind: 'consolidate', start: now, phase: 0 };
        break;
      case 'consolidated':
        anim.current = null;
        setTreeVisible(false);
        setTubeTargets(() => ({ opacity: 1, color: COLOR_YELLOW }), rebuilt);
        setLive({
          caption: `${tubes.current.length} consolidated trajectories — run the NN classifier`,
          accepted: pruneRef.current.acceptedCount,
          rejected: pruneRef.current.rejectedCount,
          hop: tr.hops,
        });
        break;
      case 'runtime':
        anim.current = null;
        setTreeVisible(false);
        applyRuntime(runtimeRef.current);
        setLive((l) => ({ ...l, accepted: pruneRef.current.acceptedCount, rejected: pruneRef.current.rejectedCount }));
        break;
    }
  };

  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;

  useEffect(() => {
    const prev = stageRef.current;
    stageRef.current = stage;
    // Re-entering the same stage from a data rebuild is handled by the rebuild effects.
    if (prev !== stage || stage === 'generating' || stage === 'pruning' || stage === 'consolidating') applyStage(stage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  useEffect(() => {
    if (stageRef.current === 'runtime') {
      applyRuntime(runtime);
      setLive((l) => ({
        ...l,
        caption: runtime
          ? `NN classifier kept ${runtime.survivors.length} of ${tubes.current.length} trajectories · stress ${(runtime.stress * 100).toFixed(0)}%`
          : l.caption,
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime, stage]);

  // ───────────────────────── Per-frame animation ─────────────────────────
  const tick = (now: number, time: number) => {
    const a = anim.current;
    const tr = treeRef.current;
    const pushLive = (next: Partial<typeof live>) => {
      if (now - liveThrottle.current < 90) return;
      liveThrottle.current = now;
      setLive((l) => ({ ...l, ...next }));
    };

    if (a?.kind === 'generate') {
      const t = now - a.start;
      const hopF = Math.min(tr.hops, t / GEN_HOP_MS);
      const fullHops = Math.floor(hopF);
      let drawn = tr.hopSegStart[fullHops];
      if (fullHops < tr.hops) drawn += Math.floor((hopF - fullHops) * (tr.hopSegStart[fullHops + 1] - tr.hopSegStart[fullHops]));
      setDrawnSegments(drawn);
      hopLabels.current?.children.forEach((c, i) => (c.visible = i < Math.ceil(hopF)));

      // Each hop denoises from the moment it starts to appear.
      const prevAmps = a.amps.slice();
      for (let h = 1; h <= tr.hops; h++) {
        const hs = (h - 1) * GEN_HOP_MS;
        const lin = t < hs ? 1 : Math.max(0, 1 - (t - hs) / DENOISE_MS);
        a.amps[h] = lin * lin;
      }
      let dirty = false;
      for (let h = 1; h <= tr.hops; h++) {
        if (t < (h - 1) * GEN_HOP_MS) break; // not drawn yet
        if (a.amps[h] === prevAmps[h] && a.amps[h - 1] === prevAmps[h - 1] && a.amps[h] === 0) continue;
        for (let s = tr.hopSegStart[h - 1]; s < tr.hopSegStart[h]; s++) writeSegment(s, a.amps[h - 1], a.amps[h]);
        dirty = true;
      }
      if (dirty) markDirty(true, false);
      pushLive({ caption: `Diffusion denoising wavefront · hop ${Math.max(1, Math.ceil(hopF))}/${tr.hops}`, hop: Math.ceil(hopF) });
      if (a.amps.every((v) => v === 0)) {
        anim.current = null;
        doneRef.current('generating');
      }
    } else if (a?.kind === 'prune') {
      const t = now - a.start;
      const status = pruneRef.current.status;
      let dirty = false;
      let accepted = 0;
      let rejected = 0;
      let activeHop = tr.hops;
      for (let h = 1; h <= tr.hops; h++) {
        const hs = (h - 1) * PRUNE_HOP_MS;
        const frac = Math.min(1, Math.max(0, (t - hs) / (PRUNE_HOP_MS * 0.85)));
        if (frac < 1 && t >= hs && activeHop === tr.hops) activeHop = h;
        const order = a.order[h];
        const target = Math.floor(frac * order.length);
        for (let i = a.revealed[h]; i < target; i++) {
          paintSegment(order[i], verdictColor(order[i]));
          dirty = true;
        }
        a.revealed[h] = Math.max(a.revealed[h], target);
        for (let i = 0; i < a.revealed[h]; i++) {
          if (status[order[i]] === SEG_ACCEPTED) accepted++;
          else rejected++;
        }
      }
      if (dirty) markDirty(false, true);

      // Sweep the scan plane through the hop currently under evaluation.
      const scan = scanPlane.current;
      if (scan) {
        const hopF = Math.min(tr.hops, t / PRUNE_HOP_MS);
        const h0 = Math.min(tr.hops, Math.floor(hopF) + 1);
        const z0 = hopMeanZ.current[h0 - 1] ?? 0;
        const z1 = hopMeanZ.current[h0] ?? z0;
        scan.position.set(0, 0, z0 + (z1 - z0) * (hopF - Math.floor(hopF)));
        const size = 14 + h0 * 9;
        scan.scale.set(size, size, 1);
        (scan.material as THREE.MeshBasicMaterial).opacity = 0.06 + Math.sin(time * 6) * 0.03;
      }
      pushLive({ caption: `LLM evaluating hop ${activeHop}/${tr.hops} against airframe envelope`, accepted, rejected, hop: activeHop });
      if (t >= tr.hops * PRUNE_HOP_MS) {
        anim.current = null;
        if (scan) scan.visible = false;
        doneRef.current('pruning');
      }
    } else if (a?.kind === 'consolidate') {
      const t = now - a.start;
      const merge = mergeLines.current;
      if (a.phase === 0) {
        // Fade rejected (red) segments into the background.
        const k = Math.min(1, t / FADE_REJECTED_MS);
        const c = COLOR_REJECTED.clone().lerp(COLOR_BG, k);
        const status = pruneRef.current.status;
        for (let s = 0; s < tr.segCount; s++) if (status[s] !== SEG_ACCEPTED) paintSegment(s, c);
        markDirty(false, true);
        pushLive({ caption: 'Excluding rejected paths…' });
        if (k >= 1) {
          a.phase = 1;
          setTreeVisible(false);
          if (merge) merge.visible = true;
        }
      } else if (a.phase === 1 && merge) {
        // Green member paths converge onto their cluster centroids and turn yellow.
        const k = easeInOut(Math.min(1, (t - FADE_REJECTED_MS) / MERGE_MS));
        const posArr = (merge.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
        const colArr = (merge.geometry.getAttribute('color') as THREE.BufferAttribute).array as Float32Array;
        const from = mergeFrom.current;
        const to = mergeTo.current;
        for (let i = 0; i < from.length; i++) posArr[i] = from[i] + (to[i] - from[i]) * k;
        const c = COLOR_ACCEPTED.clone().lerp(COLOR_YELLOW, k);
        for (let i = 0; i < colArr.length; i += 3) {
          colArr[i] = c.r;
          colArr[i + 1] = c.g;
          colArr[i + 2] = c.b;
        }
        merge.geometry.getAttribute('position').needsUpdate = true;
        merge.geometry.getAttribute('color').needsUpdate = true;
        pushLive({ caption: `Consolidating ${pruneRef.current.acceptedLeaves.length} green paths into ${tubes.current.length} trajectories…` });
        if (k >= 1) {
          a.phase = 2;
          setTubeTargets(() => ({ opacity: 1, color: COLOR_YELLOW }));
        }
      } else if (a.phase === 2) {
        if (t >= FADE_REJECTED_MS + MERGE_MS + TUBE_FADE_MS) {
          if (merge) merge.visible = false;
          anim.current = null;
          doneRef.current('consolidating');
        }
      } else {
        // No merge geometry (nothing accepted) — finish immediately.
        anim.current = null;
        doneRef.current('consolidating');
      }
    }

    // Tube opacity / colour easing (consolidation + runtime NN pruning).
    tubes.current.forEach((tb) => {
      tb.opacity += (tb.targetOpacity - tb.opacity) * 0.12;
      if (Math.abs(tb.targetOpacity - tb.opacity) < 0.005) tb.opacity = tb.targetOpacity;
      tb.color.lerp(tb.targetColor, 0.15);
      const mat = tb.mesh.material as THREE.MeshStandardMaterial;
      mat.opacity = tb.opacity;
      mat.color.copy(tb.color);
      tb.mesh.visible = tb.opacity > 0.01;
      tb.label.visible = tb.mesh.visible;
      tb.label.material.opacity = tb.opacity;
    });
    if (optimalGlow.current) {
      (optimalGlow.current.material as THREE.MeshBasicMaterial).opacity = 0.22 + Math.sin(time * 4) * 0.12;
    }
  };

  // ───────────────────────── Pointer orbit ─────────────────────────
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    dragging.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragging.current) return;
    const dx = e.clientX - dragging.current.x;
    const dy = e.clientY - dragging.current.y;
    orbit.current.theta -= dx * 0.007;
    orbit.current.phi = Math.min(2.6, Math.max(0.08, orbit.current.phi - dy * 0.007));
    dragging.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    dragging.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const camBtn = 'p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors';

  return (
    <div ref={containerRef} className="relative w-full h-full min-h-[460px] bg-slate-950 overflow-hidden">
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="absolute inset-0 w-full h-full block cursor-grab active:cursor-grabbing touch-none select-none"
      />

      {/* Top Left: viewport title */}
      <div className="absolute top-3 left-3 flex flex-col gap-1 pointer-events-none z-10">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse shadow-md shadow-cyan-400/50" />
          <span className="text-xs font-mono uppercase tracking-wider text-slate-100 font-bold">3D Trajectory Wavefront</span>
          <span className="text-[10px] font-mono font-bold text-cyan-300 bg-cyan-950/80 border border-cyan-700/80 px-2 py-0.5 rounded shadow">
            {tree.args.pathsPerHop}^{tree.hops} = {tree.theoreticalPaths.toLocaleString()} PATHS
          </span>
        </div>
        <div className="text-[11px] font-mono text-slate-300">
          Cap half-angle {tree.capDeg.toFixed(0)}° · Turn radius {tree.args.turningRadiusNM.toFixed(1)} NM
        </div>
      </div>

      {/* Top Right: legend */}
      <div className="absolute top-3 right-3 bg-slate-950/90 backdrop-blur-md border border-slate-700/90 rounded-lg p-2.5 text-xs font-mono text-slate-200 flex flex-col gap-1.5 shadow-xl max-w-[220px] z-10 pointer-events-none">
        <div className="text-[10px] uppercase text-cyan-400 tracking-wider font-bold border-b border-slate-800 pb-1">Pipeline Legend</div>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="w-5 h-0.5 bg-cyan-400 rounded" />
          <span>Generated (diffusion)</span>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="w-5 h-0.5 bg-green-500 rounded" />
          <span className="text-green-300">Accepted (LLM)</span>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="w-5 h-0.5 bg-red-500 rounded" />
          <span className="text-red-300">Rejected (LLM)</span>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="w-5 h-1 bg-yellow-400 rounded" />
          <span className="text-yellow-200">Consolidated trajectory</span>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="w-5 h-1.5 bg-yellow-200 rounded shadow-[0_0_8px_#fde047]" />
          <span className="text-yellow-100 font-semibold">Optimal (NN)</span>
        </div>
      </div>

      {/* Bottom Left: live counters */}
      <div className="absolute bottom-16 left-3 bg-slate-950/90 backdrop-blur-md border border-slate-700/80 p-3 rounded-xl text-xs font-mono shadow-2xl z-10 pointer-events-none min-w-[210px]">
        <div className="flex justify-between gap-4 text-slate-300">
          <span>Segments rendered</span>
          <span className="text-slate-100 font-bold">{tree.segCount.toLocaleString()}</span>
        </div>
        {tree.truncated && (
          <div className="flex justify-between gap-4 text-slate-400 text-[10px]">
            <span>Theoretical segments</span>
            <span>{tree.theoreticalSegments.toLocaleString()}</span>
          </div>
        )}
        <div className="flex justify-between gap-4 text-green-300">
          <span>Accepted</span>
          <span className="font-bold">{live.accepted.toLocaleString()}</span>
        </div>
        <div className="flex justify-between gap-4 text-red-300">
          <span>Rejected</span>
          <span className="font-bold">{live.rejected.toLocaleString()}</span>
        </div>
      </div>

      {/* Bottom centre: stage caption */}
      {live.caption && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-slate-950/95 border border-slate-700/90 text-slate-200 text-xs font-mono px-4 py-2 rounded-xl shadow-2xl z-10 pointer-events-none max-w-[60%] text-center">
          {live.caption}
        </div>
      )}

      {/* Bottom Right: camera controls */}
      <div className="absolute bottom-3 right-3 flex items-center gap-1 bg-slate-950/95 backdrop-blur-md p-1 rounded-xl border border-slate-700/90 shadow-2xl z-10">
        <button onClick={() => zoomBy(0.8)} className={camBtn} title="Zoom in">
          <Plus className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => zoomBy(1.25)} className={camBtn} title="Zoom out">
          <Minus className="w-3.5 h-3.5" />
        </button>
        <span className="w-px h-4 bg-slate-700 mx-0.5" />
        <button onClick={() => setPreset('ISO')} className={camBtn} title="Isometric orbit (reset)">
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => setPreset('BEHIND')} className={camBtn} title="Behind the aircraft">
          <Eye className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => setPreset('SIDE')} className={camBtn} title="Side profile (climb / descent)">
          <MoveHorizontal className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => setPreset('TOP')} className={camBtn} title="Top down (lateral)">
          <Compass className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
