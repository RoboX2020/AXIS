import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { AircraftState, ConflictAnalysis, Vector3D } from '../lib/types';
import { createAircraftMesh, createTextSprite } from '../lib/three/aircraftMesh';
import { Eye, Video, RotateCcw, Compass, ShieldAlert, Navigation, Layers, Maximize2 } from 'lucide-react';

interface Props {
  planeA: AircraftState;
  planeB: AircraftState;
  conflict: ConflictAnalysis;
  isSimulating: boolean;
}

export type CameraViewMode = 'TACTICAL' | 'CHASE_A' | 'CHASE_B' | 'COCKPIT_A' | 'INTERCEPT' | 'TOP_DOWN';

export const AeroVisualizer3D: React.FC<Props> = ({
  planeA,
  planeB,
  conflict,
  isSimulating,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [viewMode, setViewMode] = useState<CameraViewMode>('TACTICAL');

  // Three.js internal references
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);

  // Mesh & Object References
  const planeAGroup = useRef<THREE.Group | null>(null);
  const planeBGroup = useRef<THREE.Group | null>(null);
  const planeADropLine = useRef<THREE.Line | null>(null);
  const planeBDropLine = useRef<THREE.Line | null>(null);
  const planeAShadow = useRef<THREE.Mesh | null>(null);
  const planeBShadow = useRef<THREE.Mesh | null>(null);
  const planeABubble = useRef<THREE.Mesh | null>(null);
  const planeBBubble = useRef<THREE.Mesh | null>(null);

  // Jet Engine Exhaust Trail Glows
  const engineGlowA1 = useRef<THREE.Mesh | null>(null);
  const engineGlowA2 = useRef<THREE.Mesh | null>(null);
  const engineGlowB1 = useRef<THREE.Mesh | null>(null);
  const engineGlowB2 = useRef<THREE.Mesh | null>(null);

  // 3D Billboards / Labels
  const tagA = useRef<THREE.Sprite | null>(null);
  const tagB = useRef<THREE.Sprite | null>(null);
  const cpaTag = useRef<THREE.Sprite | null>(null);

  // Trajectory Lines
  const predLineA = useRef<THREE.Line | null>(null);
  const predLineB = useRef<THREE.Line | null>(null);
  const decidedLineA = useRef<THREE.Line | null>(null);
  const decidedLineB = useRef<THREE.Line | null>(null);
  const cpaMarkerRef = useRef<THREE.Group | null>(null);
  const separationLine = useRef<THREE.Line | null>(null);
  const emergency12NMRing = useRef<THREE.Mesh | null>(null);

  // Time tick waypoint spheres along predicted trajectory
  const waypointMarkersGroup = useRef<THREE.Group | null>(null);

  // Orbit camera control state
  const isDragging = useRef<boolean>(false);
  const previousMousePosition = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const sphericalCoords = useRef<{ radius: number; theta: number; phi: number }>({
    radius: 42,
    theta: Math.PI / 4,
    phi: Math.PI / 3.2,
  });

  // Camera lerp targets for smooth transitions
  const camCurrentPos = useRef<THREE.Vector3>(new THREE.Vector3(30, 25, 30));
  const camCurrentTarget = useRef<THREE.Vector3>(new THREE.Vector3(0, 8, 0));

  // Altitude scaling: 1,000 FT = 0.65 units in 3D (Y axis) for clear vertical clearance
  const ALT_SCALE = 0.00065;

  // Initialize Three.js scene
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const width = container.clientWidth;
    const height = container.clientHeight;

    // Scene - Brightened for crisp high-visibility daylight tactical airspace
    const scene = new THREE.Scene();
    sceneRef.current = scene;
    scene.background = new THREE.Color(0x0f2744); // Crisp high-visibility aeronautical sky
    scene.fog = new THREE.FogExp2(0x0f2744, 0.0035); // Very light fog for distant depth, maximum visual clarity

    // Camera
    const camera = new THREE.PerspectiveCamera(46, width / height, 0.5, 600);
    cameraRef.current = camera;
    camera.position.set(30, 25, 30);
    camera.lookAt(0, 8, 0);

    // Renderer
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.35; // Bright, vivid exposure
    rendererRef.current = renderer;

    // High-Visibility Daylight Tactical Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.5);
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xffffff, 2.5);
    sunLight.position.set(40, 80, 50);
    scene.add(sunLight);

    const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x1e3a8a, 1.4);
    scene.add(hemiLight);

    const rimLight = new THREE.DirectionalLight(0x60a5fa, 1.2);
    rimLight.position.set(-35, 30, -35);
    scene.add(rimLight);

    // Tactical Ground Holographic Grid - Electric Blue & White
    const groundGrid = new THREE.GridHelper(60, 60, 0x3b82f6, 0x1d4ed8);
    groundGrid.position.y = 0;
    scene.add(groundGrid);

    // 12 NM Emergency Detection Range Ring & Holographic Cylinder
    const emergencyRingGeo = new THREE.RingGeometry(11.9, 12.1, 96);
    emergencyRingGeo.rotateX(-Math.PI / 2);
    const emergencyRingMat = new THREE.MeshBasicMaterial({
      color: 0xef4444, // Red emergency boundary
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
    });
    const emergencyRing = new THREE.Mesh(emergencyRingGeo, emergencyRingMat);
    emergencyRing.position.y = 0.03;
    scene.add(emergencyRing);
    emergency12NMRing.current = emergencyRing;

    // 12 NM Transparent Warning Cylinder Fence
    const fenceGeo = new THREE.CylinderGeometry(12, 12, 16, 64, 1, true);
    const fenceMat = new THREE.MeshBasicMaterial({
      color: 0xef4444,
      transparent: true,
      opacity: 0.06,
      side: THREE.DoubleSide,
      wireframe: true,
    });
    const fenceMesh = new THREE.Mesh(fenceGeo, fenceMat);
    fenceMesh.position.y = 8;
    scene.add(fenceMesh);

    // Ground Tactical Airspace Range Rings (5 NM, 10 NM, 15 NM, 20 NM)
    [5, 10, 15, 20].forEach((r) => {
      const ringGeo = new THREE.RingGeometry(r - 0.04, r + 0.04, 72);
      ringGeo.rotateX(-Math.PI / 2);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x2563eb,
        side: THREE.DoubleSide,
      });
      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      ringMesh.position.y = 0.02;
      scene.add(ringMesh);
    });

    // Airfield Runway Representation at ground origin
    const runwayGeo = new THREE.PlaneGeometry(1.2, 9);
    runwayGeo.rotateX(-Math.PI / 2);
    const runwayMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.7,
    });
    const runway = new THREE.Mesh(runwayGeo, runwayMat);
    runway.position.set(0, 0.04, 0);
    scene.add(runway);

    const centerLineGeo = new THREE.PlaneGeometry(0.12, 8.5);
    centerLineGeo.rotateX(-Math.PI / 2);
    const centerLineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const centerLine = new THREE.Mesh(centerLineGeo, centerLineMat);
    centerLine.position.set(0, 0.05, 0);
    scene.add(centerLine);

    // Build Plane A (Electric Cobalt Blue & Bright White)
    const { group: meshA, rightExhaust: exA1, leftExhaust: exA2 } = createAircraftMesh(0x2563eb, 0x1d4ed8);
    scene.add(meshA);
    planeAGroup.current = meshA;
    engineGlowA1.current = exA1;
    engineGlowA2.current = exA2;

    // Build Plane B (Pure Crisp Titanium White with Sapphire Winglets)
    const { group: meshB, rightExhaust: exB1, leftExhaust: exB2 } = createAircraftMesh(0xffffff, 0x3b82f6);
    scene.add(meshB);
    planeBGroup.current = meshB;
    engineGlowB1.current = exB1;
    engineGlowB2.current = exB2;

    // Floating 3D HUD Sprites above aircraft
    const spriteA = createTextSprite('UAL842 · FL140', '#60a5fa', 'rgba(0, 0, 0, 0.92)');
    spriteA.position.y = 2.4;
    meshA.add(spriteA);
    tagA.current = spriteA;

    const spriteB = createTextSprite('DLH419 · FL140', '#ffffff', 'rgba(0, 0, 0, 0.92)');
    spriteB.position.y = 2.4;
    meshB.add(spriteB);
    tagB.current = spriteB;

    // Ground Shadows & Drop Rings
    const shadowGeo = new THREE.RingGeometry(0.4, 0.8, 24);
    shadowGeo.rotateX(-Math.PI / 2);
    const shadowMatA = new THREE.MeshBasicMaterial({ color: 0x2563eb, transparent: true, opacity: 0.5 });
    const shadowA = new THREE.Mesh(shadowGeo, shadowMatA);
    shadowA.position.y = 0.03;
    scene.add(shadowA);
    planeAShadow.current = shadowA;

    const shadowMatB = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });
    const shadowB = new THREE.Mesh(shadowGeo, shadowMatB);
    shadowB.position.y = 0.03;
    scene.add(shadowB);
    planeBShadow.current = shadowB;

    // Altitude Drop Lines (connecting aircraft to ground)
    const lineMatA = new THREE.LineBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.75 });
    const dropLineA = new THREE.Line(new THREE.BufferGeometry(), lineMatA);
    scene.add(dropLineA);
    planeADropLine.current = dropLineA;

    const lineMatB = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 });
    const dropLineB = new THREE.Line(new THREE.BufferGeometry(), lineMatB);
    scene.add(dropLineB);
    planeBDropLine.current = dropLineB;

    // Direct Separation Line between aircraft
    const sepMat = new THREE.LineDashedMaterial({
      color: 0xef4444,
      dashSize: 0.6,
      gapSize: 0.4,
      linewidth: 2,
      transparent: true,
      opacity: 0.8,
    });
    const sepLine = new THREE.Line(new THREE.BufferGeometry(), sepMat);
    scene.add(sepLine);
    separationLine.current = sepLine;

    // TCAS Alerting Protective Spheroids / Bubbles (Calibrated radius for distinct boundary separation)
    const bubbleGeo = new THREE.SphereGeometry(2.2, 32, 24);
    const bubbleMatA = new THREE.MeshBasicMaterial({
      color: 0x06b6d4,
      transparent: true,
      opacity: 0.22,
      wireframe: true,
    });
    const bubbleA = new THREE.Mesh(bubbleGeo, bubbleMatA);
    meshA.add(bubbleA);
    planeABubble.current = bubbleA;

    const bubbleMatB = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.22,
      wireframe: true,
    });
    const bubbleB = new THREE.Mesh(bubbleGeo, bubbleMatB);
    meshB.add(bubbleB);
    planeBBubble.current = bubbleB;

    // Dotted Predicted Trajectory Lines (Crisp dashed styling for extended long-range trajectory)
    const dottedMatA = new THREE.LineDashedMaterial({
      color: 0x38bdf8,
      dashSize: 0.7,
      gapSize: 0.45,
      linewidth: 2.5,
    });
    const pLineA = new THREE.Line(new THREE.BufferGeometry(), dottedMatA);
    scene.add(pLineA);
    predLineA.current = pLineA;

    const dottedMatB = new THREE.LineDashedMaterial({
      color: 0xfbbf24,
      dashSize: 0.7,
      gapSize: 0.45,
      linewidth: 2.5,
    });
    const pLineB = new THREE.Line(new THREE.BufferGeometry(), dottedMatB);
    scene.add(pLineB);
    predLineB.current = pLineB;

    // Solid Grey Decided Route Lines (Decided trajectory after prompt)
    const decidedMatA = new THREE.LineBasicMaterial({
      color: 0xe2e8f0, // Crisp Solid Grey
      linewidth: 3.5,
    });
    const dLineA = new THREE.Line(new THREE.BufferGeometry(), decidedMatA);
    scene.add(dLineA);
    decidedLineA.current = dLineA;

    const decidedMatB = new THREE.LineBasicMaterial({
      color: 0x94a3b8,
      linewidth: 3,
    });
    const dLineB = new THREE.Line(new THREE.BufferGeometry(), decidedMatB);
    scene.add(dLineB);
    decidedLineB.current = dLineB;

    // Group for Waypoint Time Ticks (T+10s, T+20s, etc.)
    const wpGroup = new THREE.Group();
    scene.add(wpGroup);
    waypointMarkersGroup.current = wpGroup;

    // CPA 3D Intercept Target Marker
    const cpaGroup = new THREE.Group();
    const cpaRingGeo = new THREE.RingGeometry(0.8, 1.0, 32);
    const cpaRingMat = new THREE.MeshBasicMaterial({
      color: 0xef4444,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
    });
    const cpaRing = new THREE.Mesh(cpaRingGeo, cpaRingMat);
    cpaRing.rotateX(Math.PI / 2);
    cpaGroup.add(cpaRing);

    const cpaDiamondGeo = new THREE.OctahedronGeometry(0.5);
    const cpaDiamondMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      wireframe: true,
    });
    const cpaDiamond = new THREE.Mesh(cpaDiamondGeo, cpaDiamondMat);
    cpaGroup.add(cpaDiamond);

    const cpaSprite = createTextSprite('PREDICTED CPA INTERCEPT', '#ef4444', 'rgba(30, 5, 5, 0.9)');
    cpaSprite.position.y = 1.4;
    cpaGroup.add(cpaSprite);
    cpaTag.current = cpaSprite;

    scene.add(cpaGroup);
    cpaMarkerRef.current = cpaGroup;
    cpaGroup.visible = false;

    // Render loop with smooth camera lerping
    let animationFrameId: number;
    let clock = new THREE.Clock();

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      const time = clock.getElapsedTime();

      // Pulsing 12 NM emergency ring
      if (emergency12NMRing.current) {
        const mat = emergency12NMRing.current.material as THREE.MeshBasicMaterial;
        mat.opacity = 0.5 + Math.sin(time * 3) * 0.3;
      }

      // Rotate CPA diamond marker
      if (cpaMarkerRef.current && cpaMarkerRef.current.visible) {
        cpaMarkerRef.current.rotation.y += delta * 1.5;
      }

      // Camera orchestration based on selected view mode
      if (cameraRef.current && planeAGroup.current && planeBGroup.current) {
        const cam = cameraRef.current;
        const pA = planeAGroup.current.position;
        const pB = planeBGroup.current.position;

        let desiredPos = new THREE.Vector3();
        let desiredTarget = new THREE.Vector3();

        if (viewMode === 'TACTICAL') {
          // Free orbit around scene midpoint
          const { radius, theta, phi } = sphericalCoords.current;
          desiredPos.set(
            radius * Math.sin(phi) * Math.sin(theta),
            radius * Math.cos(phi),
            radius * Math.sin(phi) * Math.cos(theta)
          );
          desiredTarget.set(0, 9, 0);
          camCurrentPos.current.lerp(desiredPos, 0.08);
          camCurrentTarget.current.lerp(desiredTarget, 0.08);
          cam.position.copy(camCurrentPos.current);
          cam.lookAt(camCurrentTarget.current);
        } else if (viewMode === 'CHASE_A') {
          // Smooth glide behind Flight Alpha along true flight heading
          const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(planeAGroup.current.quaternion);
          desiredPos.copy(pA).sub(forward.clone().multiplyScalar(13)).add(new THREE.Vector3(0, 4.0, 0));
          desiredTarget.copy(pA).add(forward.clone().multiplyScalar(18));
          camCurrentPos.current.lerp(desiredPos, 0.1);
          camCurrentTarget.current.lerp(desiredTarget, 0.1);
          cam.position.copy(camCurrentPos.current);
          cam.lookAt(camCurrentTarget.current);
        } else if (viewMode === 'CHASE_B') {
          // Smooth glide behind Flight Bravo along true flight heading
          const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(planeBGroup.current.quaternion);
          desiredPos.copy(pB).sub(forward.clone().multiplyScalar(13)).add(new THREE.Vector3(0, 4.0, 0));
          desiredTarget.copy(pB).add(forward.clone().multiplyScalar(18));
          camCurrentPos.current.lerp(desiredPos, 0.1);
          camCurrentTarget.current.lerp(desiredTarget, 0.1);
          cam.position.copy(camCurrentPos.current);
          cam.lookAt(camCurrentTarget.current);
        } else if (viewMode === 'COCKPIT_A') {
          // Pilot Cockpit View from Flight Alpha looking forward out windscreen
          const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(planeAGroup.current.quaternion);
          desiredPos.copy(pA).add(forward.clone().multiplyScalar(1.8)).add(new THREE.Vector3(0, 0.35, 0));
          desiredTarget.copy(desiredPos).add(forward.clone().multiplyScalar(30));
          cam.position.copy(desiredPos);
          cam.lookAt(desiredTarget);
        } else if (viewMode === 'INTERCEPT') {
          // Side intercept camera viewing the confrontation corridor
          const midPoint = new THREE.Vector3().addVectors(pA, pB).multiplyScalar(0.5);
          desiredPos.set(midPoint.x + 14, midPoint.y + 7, midPoint.z + 14);
          desiredTarget.copy(midPoint);
          camCurrentPos.current.lerp(desiredPos, 0.08);
          camCurrentTarget.current.lerp(desiredTarget, 0.08);
          cam.position.copy(camCurrentPos.current);
          cam.lookAt(camCurrentTarget.current);
        } else if (viewMode === 'TOP_DOWN') {
          // Top-down tactical overhead
          desiredPos.set(0, 52, 0.01);
          desiredTarget.set(0, 0, 0);
          camCurrentPos.current.lerp(desiredPos, 0.08);
          camCurrentTarget.current.lerp(desiredTarget, 0.08);
          cam.position.copy(camCurrentPos.current);
          cam.lookAt(camCurrentTarget.current);
        }
      }

      renderer.render(scene, camera);
    };

    animate();

    const handleResize = () => {
      if (!containerRef.current || !rendererRef.current || !cameraRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
    };
  }, [viewMode]);

  // Update Aircraft positions, rotations, altitude stems & trajectories in 3D
  useEffect(() => {
    if (!planeAGroup.current || !planeBGroup.current || !sceneRef.current) return;

    // Convert coordinates to 3D units
    const posA3D = new THREE.Vector3(
      planeA.position.x,
      planeA.position.z * ALT_SCALE,
      -planeA.position.y
    );

    const posB3D = new THREE.Vector3(
      planeB.position.x,
      planeB.position.z * ALT_SCALE,
      -planeB.position.y
    );

    planeAGroup.current.position.copy(posA3D);
    planeBGroup.current.position.copy(posB3D);

    // Orientation: Local nose is +Z. In Three.js -Z is North, +X is East, +Z is South, -X is West.
    // Setting rotY = Math.PI - (heading * Math.PI) / 180 points nose precisely along flight track!
    const headingRadA = Math.PI - (planeA.heading * Math.PI) / 180;
    const pitchRadA = (planeA.pitchAngle * Math.PI) / 180;
    const rollRadA = (planeA.bankAngle * Math.PI) / 180;
    planeAGroup.current.rotation.set(pitchRadA, headingRadA, rollRadA, 'YXZ');

    const headingRadB = Math.PI - (planeB.heading * Math.PI) / 180;
    const pitchRadB = (planeB.pitchAngle * Math.PI) / 180;
    const rollRadB = (planeB.bankAngle * Math.PI) / 180;
    planeBGroup.current.rotation.set(pitchRadB, headingRadB, rollRadB, 'YXZ');

    // Update Ground Shadows
    if (planeAShadow.current) {
      planeAShadow.current.position.set(posA3D.x, 0.03, posA3D.z);
    }
    if (planeBShadow.current) {
      planeBShadow.current.position.set(posB3D.x, 0.03, posB3D.z);
    }

    // Update Drop Lines
    if (planeADropLine.current) {
      const positions = new Float32Array([posA3D.x, posA3D.y, posA3D.z, posA3D.x, 0, posA3D.z]);
      planeADropLine.current.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    }
    if (planeBDropLine.current) {
      const positions = new Float32Array([posB3D.x, posB3D.y, posB3D.z, posB3D.x, 0, posB3D.z]);
      planeBDropLine.current.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    }

    // Direct Intercept Separation Line
    if (separationLine.current) {
      if (conflict.distanceNM <= 14.0) {
        separationLine.current.visible = true;
        const positions = new Float32Array([posA3D.x, posA3D.y, posA3D.z, posB3D.x, posB3D.y, posB3D.z]);
        separationLine.current.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        separationLine.current.computeLineDistances();
      } else {
        separationLine.current.visible = false;
      }
    }

    // Update TCAS Alerting Bubble
    const isRA = conflict.tcasStatus === 'RESOLUTION_ADVISORY' || conflict.isWithinEmergencyRange;
    const isTA = conflict.tcasStatus === 'TRAFFIC_ADVISORY';

    const updateBubble = (bubble: THREE.Mesh | null, isThreat: boolean, isResolution: boolean) => {
      if (!bubble) return;
      const mat = bubble.material as THREE.MeshBasicMaterial;
      if (isResolution) {
        mat.color.setHex(0xef4444);
        mat.opacity = 0.45;
        bubble.scale.set(1.25, 1.25, 1.25);
      } else if (isThreat) {
        mat.color.setHex(0xf59e0b);
        mat.opacity = 0.32;
        bubble.scale.set(1.12, 1.12, 1.12);
      } else {
        mat.color.setHex(0x06b6d4);
        mat.opacity = 0.20;
        bubble.scale.set(1.0, 1.0, 1.0);
      }
    };

    updateBubble(planeABubble.current, isTA || isRA, isRA);
    updateBubble(planeBBubble.current, isTA || isRA, isRA);

    // Dotted Predicted Trajectory Lines
    const updatePredLine = (
      lineRef: THREE.Line | null,
      pts: Array<Vector3D & { timeSec: number }>
    ) => {
      if (!lineRef || pts.length < 2) return;
      const points = pts.map((p) => new THREE.Vector3(p.x, p.z * ALT_SCALE, -p.y));
      lineRef.geometry.dispose();
      lineRef.geometry = new THREE.BufferGeometry().setFromPoints(points);
      lineRef.computeLineDistances();
    };

    updatePredLine(predLineA.current, planeA.predictedTrajectory);
    updatePredLine(predLineB.current, planeB.predictedTrajectory);

    // Update Waypoint Markers (Time ticks along extended 120s trajectory line)
    if (waypointMarkersGroup.current) {
      waypointMarkersGroup.current.clear();
      const dotGeo = new THREE.SphereGeometry(0.2, 10, 10);
      const dotMatA = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
      const dotMatB = new THREE.MeshBasicMaterial({ color: 0xfbbf24 });

      // Add time ticks for Plane A (every 15 seconds up to 105s)
      planeA.predictedTrajectory.forEach((p) => {
        if (p.timeSec % 15 === 0 && p.timeSec > 0 && p.timeSec <= 105) {
          const marker = new THREE.Mesh(dotGeo, dotMatA);
          marker.position.set(p.x, p.z * ALT_SCALE, -p.y);
          waypointMarkersGroup.current?.add(marker);
        }
      });

      // Add time ticks for Plane B
      planeB.predictedTrajectory.forEach((p) => {
        if (p.timeSec % 15 === 0 && p.timeSec > 0 && p.timeSec <= 105) {
          const marker = new THREE.Mesh(dotGeo, dotMatB);
          marker.position.set(p.x, p.z * ALT_SCALE, -p.y);
          waypointMarkersGroup.current?.add(marker);
        }
      });
    }

    // Solid Decided Route Lines (Solid grey line as requested)
    const updateDecidedLine = (lineRef: THREE.Line | null, pts: Vector3D[]) => {
      if (!lineRef) return;
      if (pts.length < 2) {
        lineRef.visible = false;
        return;
      }
      lineRef.visible = true;
      const points = pts.map((p) => new THREE.Vector3(p.x, p.z * ALT_SCALE, -p.y));
      lineRef.geometry.dispose();
      lineRef.geometry = new THREE.BufferGeometry().setFromPoints(points);
    };

    updateDecidedLine(decidedLineA.current, planeA.decidedRoute);
    updateDecidedLine(decidedLineB.current, planeB.decidedRoute);

    // CPA 3D Marker
    if (cpaMarkerRef.current) {
      if (conflict.timeToCPASec > 0 && conflict.timeToCPASec <= 55 && conflict.distanceAtCPANM < 2.5) {
        cpaMarkerRef.current.visible = true;
        cpaMarkerRef.current.position.set(
          conflict.cpaPoint.x,
          conflict.cpaPoint.z * ALT_SCALE,
          -conflict.cpaPoint.y
        );
      } else {
        cpaMarkerRef.current.visible = false;
      }
    }
  }, [planeA, planeB, conflict]);

  // Pointer drag for orbit control
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (viewMode !== 'TACTICAL') return;
    isDragging.current = true;
    previousMousePosition.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDragging.current || viewMode !== 'TACTICAL') return;
    const deltaX = e.clientX - previousMousePosition.current.x;
    const deltaY = e.clientY - previousMousePosition.current.y;

    sphericalCoords.current.theta -= deltaX * 0.007;
    sphericalCoords.current.phi = Math.max(
      0.15,
      Math.min(Math.PI / 2 - 0.05, sphericalCoords.current.phi - deltaY * 0.007)
    );

    previousMousePosition.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    isDragging.current = false;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (viewMode !== 'TACTICAL') return;
    sphericalCoords.current.radius = Math.max(
      15,
      Math.min(100, sphericalCoords.current.radius + e.deltaY * 0.04)
    );
  };

  return (
    <div
      ref={containerRef}
      onWheel={handleWheel}
      className={`relative w-full h-full min-h-[440px] bg-slate-950 rounded-xl overflow-hidden border transition-all duration-300 ${
        conflict.tcasStatus === 'RESOLUTION_ADVISORY' || conflict.isWithinEmergencyRange
          ? 'border-red-500 ring-2 ring-red-500/30 animate-tcas-ra'
          : conflict.tcasStatus === 'TRAFFIC_ADVISORY'
          ? 'border-amber-500 ring-1 ring-amber-500/20'
          : 'border-slate-800'
      }`}
    >
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className="w-full h-full block cursor-grab active:cursor-grabbing touch-none select-none"
      />

      {/* Cockpit HUD Reticle Overlay if in COCKPIT_A view */}
      {viewMode === 'COCKPIT_A' && (
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          <div className="w-48 h-48 border border-blue-400/50 rounded-full flex items-center justify-center">
            <div className="w-16 h-[1px] bg-blue-400/70" />
            <div className="h-16 w-[1px] bg-blue-400/70" />
            <div className="absolute top-2 text-[10px] font-mono text-blue-300 font-bold">HUD GUNSIGHT / INTRUDER TRACK</div>
          </div>
          <div className="absolute top-12 left-12 text-xs font-mono text-white bg-black/90 p-2.5 rounded-lg border border-blue-500/50 shadow-xl">
            <div className="text-blue-400 font-bold">SPD: {Math.round(planeA.speed)} KT</div>
            <div>ALT: {planeA.position.z.toLocaleString()} FT</div>
            <div>HDG: {Math.round(planeA.heading)}°</div>
          </div>
        </div>
      )}

      {/* Top Left: 3D Viewport Header & 12 NM Callout */}
      <div className="absolute top-3 left-3 flex flex-col gap-1 pointer-events-none z-10">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-blue-500 shadow-md shadow-blue-500/50" />
          <span className="text-xs font-mono uppercase tracking-wider text-white font-bold">
            3D Spatial Visualizer (High-Visibility Daylight)
          </span>
          <span className="text-[10px] font-mono font-bold text-white bg-blue-950/80 border border-blue-600/80 px-2 py-0.5 rounded shadow">
            12 NM ENVELOPE
          </span>
        </div>
        <div className="text-[11px] font-mono text-slate-300">
          Range: <span className="text-white font-bold">{conflict.distanceNM.toFixed(2)} NM</span> · Closure: <span className="text-white font-bold">{Math.round(conflict.rangeRateKnots)} KT</span>
        </div>
      </div>

      {/* Top Right: Trajectory Legend */}
      <div className="absolute top-3 right-3 bg-black/90 backdrop-blur-md border border-blue-900/60 rounded-xl p-2.5 text-xs font-mono text-white pointer-events-auto flex flex-col gap-1.5 shadow-2xl max-w-[250px] z-10">
        <div className="text-[10px] uppercase text-blue-400 tracking-wider font-black border-b border-white/10 pb-1">
          AXIS 3D Visual Legend
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="w-5 h-0 border-t-2 border-dashed border-blue-400" />
          <span>Flight Alpha Path (Blue)</span>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="w-5 h-0 border-t-2 border-dashed border-white" />
          <span className="text-white">Flight Bravo Path (White)</span>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="w-5 h-0.5 bg-white rounded shadow-[0_0_8px_#ffffff]" />
          <span className="text-white font-bold">Decided Route (Solid)</span>
        </div>
      </div>

      {/* Floating 3D Aircraft Altitude Overlays */}
      <div className="absolute bottom-16 left-3 flex flex-col gap-1.5 bg-black/90 backdrop-blur-md border border-blue-900/60 p-3 rounded-xl text-xs font-mono shadow-2xl z-10">
        <div className="flex items-center justify-between gap-4 text-blue-400">
          <div className="flex items-center gap-1.5 font-bold">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
            <span>{planeA.callsign}:</span>
          </div>
          <span className="text-white font-bold">{planeA.position.z.toLocaleString()} FT</span>
        </div>
        <div className="flex items-center justify-between gap-4 text-white">
          <div className="flex items-center gap-1.5 font-bold">
            <span className="w-2.5 h-2.5 rounded-full bg-white" />
            <span>{planeB.callsign}:</span>
          </div>
          <span className="text-white font-bold">{planeB.position.z.toLocaleString()} FT</span>
        </div>
        <div className="border-t border-white/10 pt-1 text-[11px] text-slate-300 flex justify-between font-semibold">
          <span>Vertical Delta:</span>
          <span className={conflict.verticalDeltaFt < 500 ? 'text-red-400 font-bold' : 'text-white'}>
            {Math.round(conflict.verticalDeltaFt)} FT
          </span>
        </div>
      </div>

      {/* Camera View Mode Controls (Ensuring all camera modes are easily switchable) */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-black/95 backdrop-blur-md p-1.5 rounded-xl border border-blue-900/60 shadow-2xl pointer-events-auto z-10 flex-wrap justify-center">
        <button
          onClick={() => setViewMode('TACTICAL')}
          className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all whitespace-nowrap flex items-center gap-1.5 ${
            viewMode === 'TACTICAL'
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
              : 'text-slate-300 hover:text-white hover:bg-white/10'
          }`}
          title="Free 3D orbit around airspace"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Tactical Orbit</span>
        </button>

        <button
          onClick={() => setViewMode('CHASE_A')}
          className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all whitespace-nowrap flex items-center gap-1.5 ${
            viewMode === 'CHASE_A'
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
              : 'text-slate-300 hover:text-white hover:bg-white/10'
          }`}
          title="Follow behind Flight Alpha"
        >
          <Video className="w-3.5 h-3.5" />
          <span>Chase {planeA.callsign}</span>
        </button>

        <button
          onClick={() => setViewMode('CHASE_B')}
          className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all whitespace-nowrap flex items-center gap-1.5 ${
            viewMode === 'CHASE_B'
              ? 'bg-white text-black shadow-lg font-black'
              : 'text-slate-300 hover:text-white hover:bg-white/10'
          }`}
          title="Follow behind Flight Bravo"
        >
          <Video className="w-3.5 h-3.5" />
          <span>Chase {planeB.callsign}</span>
        </button>

        <button
          onClick={() => setViewMode('COCKPIT_A')}
          className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all whitespace-nowrap flex items-center gap-1.5 ${
            viewMode === 'COCKPIT_A'
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
              : 'text-slate-300 hover:text-white hover:bg-white/10'
          }`}
          title="Cockpit windscreen view from Flight Alpha"
        >
          <Navigation className="w-3.5 h-3.5" />
          <span>Cockpit View</span>
        </button>

        <button
          onClick={() => setViewMode('INTERCEPT')}
          className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all whitespace-nowrap flex items-center gap-1.5 ${
            viewMode === 'INTERCEPT'
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
              : 'text-slate-300 hover:text-white hover:bg-white/10'
          }`}
          title="Corridor view of converging paths"
        >
          <Eye className="w-3.5 h-3.5" />
          <span>Intercept Cam</span>
        </button>

        <button
          onClick={() => setViewMode('TOP_DOWN')}
          className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all whitespace-nowrap flex items-center gap-1.5 ${
            viewMode === 'TOP_DOWN'
              ? 'bg-white text-black font-black shadow-lg'
              : 'text-slate-300 hover:text-white hover:bg-white/10'
          }`}
          title="Top-down tactical view"
        >
          <Compass className="w-3.5 h-3.5" />
          <span>Top Down</span>
        </button>
      </div>
    </div>
  );
};
