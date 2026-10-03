import React, { useRef, useEffect, useState, useMemo } from 'react';
import * as THREE from 'three';
import QRCode from 'qrcode';
import { PlayerPlane } from '../../types/gameTypes';
import { gameSocket } from '../../lib/gameSocket';
import {
  QrCode,
  Users,
  Video,
  Eye,
  Plus,
  RotateCcw,
  ShieldAlert,
  AlertTriangle,
  Compass,
  Maximize2,
  Volume2,
  VolumeX,
  ExternalLink,
  Copy,
  Check,
  Plane,
} from 'lucide-react';

interface Props {
  roomId?: string;
  onNavigateToSimulator: () => void;
  onOpenMobileControllerDirectly: () => void;
}

export const HostGameArena: React.FC<Props> = ({
  roomId = 'sky-arena-1',
  onNavigateToSimulator,
  onOpenMobileControllerDirectly,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [players, setPlayers] = useState<Record<string, PlayerPlane>>({});
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [cameraMode, setCameraMode] = useState<'MASTER_OVERVIEW' | 'ATC_TOWER' | 'CHASE_LEADER' | 'TOP_DOWN'>('MASTER_OVERVIEW');
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(false);

  const controllerUrl = useMemo(() => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/?mode=controller&room=${roomId}`;
  }, [roomId]);

  // Generate QR code for mobile controllers to scan
  useEffect(() => {
    QRCode.toDataURL(controllerUrl, {
      width: 240,
      margin: 2,
      color: {
        dark: '#030712',
        light: '#38bdf8',
      },
    })
      .then((url) => setQrDataUrl(url))
      .catch((err) => console.error('Failed to generate QR code', err));
  }, [controllerUrl]);

  // Connect as Host via WebSocket
  useEffect(() => {
    gameSocket.connect('host', roomId);
    setIsConnected(true);

    const unsubscribe = gameSocket.onMessage((msg) => {
      if (msg.type === 'room_state' && msg.players) {
        setPlayers({ ...msg.players });
      }
    });

    return () => {
      unsubscribe();
    };
  }, [roomId]);

  // Three.js 3D Master Scene Lifecycle
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || 900;
    const height = container.clientHeight || 560;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020617);
    scene.fog = new THREE.FogExp2(0x020617, 0.008);

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.5, 2000);
    camera.position.set(0, 45, 75);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // Lighting
    const hemiLight = new THREE.HemisphereLight(0x38bdf8, 0x0f172a, 0.9);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.4);
    dirLight.position.set(40, 80, 50);
    scene.add(dirLight);

    // Ground Grid & Runway System
    const gridHelper = new THREE.GridHelper(200, 40, 0x0284c7, 0x1e293b);
    gridHelper.position.y = 0;
    scene.add(gridHelper);

    // Runway Strip
    const runwayGeo = new THREE.PlaneGeometry(8, 90);
    const runwayMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.8 });
    const runway = new THREE.Mesh(runwayGeo, runwayMat);
    runway.rotation.x = -Math.PI / 2;
    runway.position.set(0, 0.1, 0);
    scene.add(runway);

    // Airspace Range Cylinders
    const ringGeo = new THREE.RingGeometry(29.8, 30.2, 64);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xef4444, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.2;
    scene.add(ring);

    // Dynamic Plane Meshes Cache
    const planeMeshes: Map<
      string,
      {
        group: THREE.Group;
        bodyMesh: THREE.Mesh;
        trailLine: THREE.Line;
        warningBubble: THREE.Mesh;
      }
    > = new Map();

    const createPlaneMesh = (colorHex: string) => {
      const group = new THREE.Group();

      // Sleek Jet Fuselage
      const fuselageGeo = new THREE.ConeGeometry(0.8, 4.2, 8);
      fuselageGeo.rotateX(Math.PI / 2);
      const fuselageMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(colorHex),
        metalness: 0.6,
        roughness: 0.3,
      });
      const fuselage = new THREE.Mesh(fuselageGeo, fuselageMat);
      group.add(fuselage);

      // Delta Wings
      const wingGeo = new THREE.BufferGeometry();
      const wingVertices = new Float32Array([
        0, 0, 1.2,
        4.0, 0, -1.5,
        -4.0, 0, -1.5,
      ]);
      wingGeo.setAttribute('position', new THREE.BufferAttribute(wingVertices, 3));
      wingGeo.computeVertexNormals();
      const wingMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(colorHex),
        side: THREE.DoubleSide,
      });
      const wings = new THREE.Mesh(wingGeo, wingMat);
      group.add(wings);

      // Vertical Tail Fin
      const finGeo = new THREE.BufferGeometry();
      const finVertices = new Float32Array([
        0, 0, -0.6,
        0, 1.4, -1.8,
        0, 0, -1.8,
      ]);
      finGeo.setAttribute('position', new THREE.BufferAttribute(finVertices, 3));
      finGeo.computeVertexNormals();
      const fin = new THREE.Mesh(finGeo, wingMat);
      group.add(fin);

      // Glowing Afterburner Thruster
      const thrusterGeo = new THREE.CylinderGeometry(0.3, 0.4, 0.8, 8);
      thrusterGeo.rotateX(Math.PI / 2);
      const thrusterMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
      const thruster = new THREE.Mesh(thrusterGeo, thrusterMat);
      thruster.position.set(0, 0, -2.2);
      group.add(thruster);

      // 3D Collision Proximity Warning Halo Bubble
      const bubbleGeo = new THREE.SphereGeometry(3.5, 16, 16);
      const bubbleMat = new THREE.MeshBasicMaterial({
        color: 0xef4444,
        transparent: true,
        opacity: 0,
        wireframe: true,
      });
      const warningBubble = new THREE.Mesh(bubbleGeo, bubbleMat);
      group.add(warningBubble);

      // Flight Trail Ribbon
      const trailMat = new THREE.LineBasicMaterial({
        color: new THREE.Color(colorHex),
        linewidth: 2,
        transparent: true,
        opacity: 0.6,
      });
      const trailGeo = new THREE.BufferGeometry();
      const trailLine = new THREE.Line(trailGeo, trailMat);
      scene.add(trailLine);

      scene.add(group);
      return { group, bodyMesh: fuselage, trailLine, warningBubble };
    };

    let animFrameId: number;

    const animate = () => {
      animFrameId = requestAnimationFrame(animate);

      const activePlayersList = Object.values(playersRef.current);

      // Check pairwise collisions across all planes
      const collisionIds = new Set<string>();
      for (let i = 0; i < activePlayersList.length; i++) {
        for (let j = i + 1; j < activePlayersList.length; j++) {
          const p1 = activePlayersList[i];
          const p2 = activePlayersList[j];
          const dx = p1.position.x - p2.position.x;
          const dy = p1.position.y - p2.position.y;
          const distNM = Math.hypot(dx, dy);
          const dz = Math.abs(p1.position.z - p2.position.z);

          if (distNM < 2.5 && dz < 1500) {
            collisionIds.add(p1.id);
            collisionIds.add(p2.id);
          }
        }
      }

      // Update plane models in 3D scene
      activePlayersList.forEach((player) => {
        let meshBundle = planeMeshes.get(player.id);
        if (!meshBundle) {
          meshBundle = createPlaneMesh(player.color);
          planeMeshes.set(player.id, meshBundle);
        }

        // Coordinate scaling: 1 NM ≈ 4 scene units, 1000 ft ≈ 1.2 height units
        const sceneX = player.position.x * 4;
        const sceneZ = -player.position.y * 4; // Y in math is -Z in Three.js
        const sceneY = Math.max(2, (player.position.z / 1000) * 1.4);

        // Smooth position interpolation
        meshBundle.group.position.lerp(new THREE.Vector3(sceneX, sceneY, sceneZ), 0.3);

        // Rotations: Heading (yaw), Pitch, Roll
        const headingRad = -(player.heading * Math.PI) / 180;
        const pitchRad = (player.pitch * Math.PI) / 180;
        const rollRad = (player.roll * Math.PI) / 180;

        meshBundle.group.rotation.set(0, 0, 0);
        meshBundle.group.rotateY(headingRad);
        meshBundle.group.rotateX(pitchRad);
        meshBundle.group.rotateZ(rollRad);

        // Flash collision warning bubble if conflict active
        const hasConflict = collisionIds.has(player.id);
        const bubbleMat = meshBundle.warningBubble.material as THREE.MeshBasicMaterial;
        if (hasConflict) {
          bubbleMat.opacity = 0.35 + Math.sin(Date.now() / 150) * 0.25;
        } else {
          bubbleMat.opacity = 0;
        }

        // Update trail line
        if (player.history.length > 1) {
          const trailPts = player.history.map(
            (p) => new THREE.Vector3(p.x * 4, Math.max(2, (p.z / 1000) * 1.4), -p.y * 4)
          );
          meshBundle.trailLine.geometry.setFromPoints(trailPts);
        }
      });

      // Remove stale planes
      const activeIds = new Set(activePlayersList.map((p) => p.id));
      for (const [id, bundle] of planeMeshes.entries()) {
        if (!activeIds.has(id)) {
          scene.remove(bundle.group);
          scene.remove(bundle.trailLine);
          planeMeshes.delete(id);
        }
      }

      // Master Camera Director Logic
      if (activePlayersList.length > 0) {
        if (cameraMode === 'MASTER_OVERVIEW') {
          // Compute bounding center of all planes
          let avgX = 0;
          let avgY = 0;
          let avgZ = 0;
          let maxSpread = 15;

          activePlayersList.forEach((p) => {
            const px = p.position.x * 4;
            const py = Math.max(2, (p.position.z / 1000) * 1.4);
            const pz = -p.position.y * 4;
            avgX += px;
            avgY += py;
            avgZ += pz;
          });

          avgX /= activePlayersList.length;
          avgY /= activePlayersList.length;
          avgZ /= activePlayersList.length;

          activePlayersList.forEach((p) => {
            const px = p.position.x * 4;
            const pz = -p.position.y * 4;
            const dist = Math.hypot(px - avgX, pz - avgZ);
            if (dist > maxSpread) maxSpread = dist;
          });

          const camDist = Math.max(50, maxSpread * 2.2);
          const targetCamPos = new THREE.Vector3(avgX, avgY + camDist * 0.6, avgZ + camDist * 0.9);
          camera.position.lerp(targetCamPos, 0.05);
          camera.lookAt(avgX, avgY, avgZ);
        } else if (cameraMode === 'ATC_TOWER') {
          // Fixed tower location looking at active dogfight
          camera.position.set(0, 35, 55);
          if (activePlayersList[0]) {
            const p = activePlayersList[0];
            camera.lookAt(p.position.x * 4, (p.position.z / 1000) * 1.4, -p.position.y * 4);
          }
        } else if (cameraMode === 'CHASE_LEADER') {
          const targetPlane =
            activePlayersList.find((p) => p.id === selectedPlayerId) || activePlayersList[0];
          if (targetPlane) {
            const targetX = targetPlane.position.x * 4;
            const targetY = Math.max(2, (targetPlane.position.z / 1000) * 1.4);
            const targetZ = -targetPlane.position.y * 4;
            const headingRad = ((90 - targetPlane.heading) * Math.PI) / 180;

            const chaseX = targetX - Math.cos(headingRad) * 22;
            const chaseZ = targetZ + Math.sin(headingRad) * 22;
            camera.position.lerp(new THREE.Vector3(chaseX, targetY + 8, chaseZ), 0.1);
            camera.lookAt(targetX, targetY + 2, targetZ);
          }
        } else if (cameraMode === 'TOP_DOWN') {
          camera.position.set(0, 160, 0);
          camera.lookAt(0, 0, 0);
        }
      }

      renderer.render(scene, camera);
    };

    animate();

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animFrameId);
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
    };
  }, [cameraMode, selectedPlayerId]);

  // Ref to always provide latest players state inside Three.js animate loop
  const playersRef = useRef(players);
  useEffect(() => {
    playersRef.current = players;
  }, [players]);

  const handleCopyLink = () => {
    navigator.clipboard.writeText(controllerUrl);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const activePlayersList = Object.values(players);

  // Compute any active collisions in room for the host radar warning board
  const activeClashes = useMemo(() => {
    const list: Array<{ p1: PlayerPlane; p2: PlayerPlane; distNM: number; dzFt: number }> = [];
    for (let i = 0; i < activePlayersList.length; i++) {
      for (let j = i + 1; j < activePlayersList.length; j++) {
        const p1 = activePlayersList[i];
        const p2 = activePlayersList[j];
        const dist = Math.hypot(p1.position.x - p2.position.x, p1.position.y - p2.position.y);
        const dz = Math.abs(p1.position.z - p2.position.z);
        if (dist <= 3.5 && dz <= 1800) {
          list.push({ p1, p2, distNM: Number(dist.toFixed(2)), dzFt: Math.round(dz) });
        }
      }
    }
    return list;
  }, [activePlayersList]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans select-none">
      {/* Top Banner Navigation Switcher */}
      <div className="bg-slate-900 border-b border-slate-800 px-6 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
        <div className="flex items-center gap-3">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="font-bold text-white uppercase tracking-wider font-display">
            SkyClash 3D: Multiplayer Flight Sim Host Arena
          </span>
          <span className="text-cyan-400 font-bold bg-cyan-950/80 px-2 py-0.5 rounded border border-cyan-800/80">
            Room: {roomId}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={onNavigateToSimulator}
            className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-lg border border-slate-700 font-bold transition-colors flex items-center gap-1.5 shadow"
          >
            <Plane className="w-3.5 h-3.5 text-cyan-400" />
            <span>Switch to AeroPredict Analytics Platform</span>
          </button>
          <button
            onClick={onOpenMobileControllerDirectly}
            className="px-3 py-1 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-black rounded-lg transition-colors flex items-center gap-1.5 shadow"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>Test Phone Controller in New Tab</span>
          </button>
        </div>
      </div>

      {/* Main Host Arena Grid */}
      <div className="flex-1 p-4 sm:p-6 max-w-[1720px] w-full mx-auto grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left Side: 3D Master Screen View (8 cols) */}
        <div className="lg:col-span-8 flex flex-col bg-slate-900/90 border-2 border-slate-800 rounded-2xl overflow-hidden shadow-2xl relative">
          {/* Master View Controls Bar */}
          <div className="bg-slate-950/90 border-b border-slate-800 p-3 px-4 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
            <div className="flex items-center gap-2">
              <span className="text-slate-400 font-bold">Master Camera:</span>
              <div className="bg-slate-900 border border-slate-700 rounded-lg p-0.5 flex">
                <button
                  onClick={() => setCameraMode('MASTER_OVERVIEW')}
                  className={`px-2.5 py-1 rounded transition-colors font-bold ${
                    cameraMode === 'MASTER_OVERVIEW'
                      ? 'bg-cyan-500 text-slate-950 font-black'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Tactical Overview
                </button>
                <button
                  onClick={() => setCameraMode('ATC_TOWER')}
                  className={`px-2.5 py-1 rounded transition-colors font-bold ${
                    cameraMode === 'ATC_TOWER'
                      ? 'bg-cyan-500 text-slate-950 font-black'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  ATC Tower
                </button>
                <button
                  onClick={() => setCameraMode('CHASE_LEADER')}
                  className={`px-2.5 py-1 rounded transition-colors font-bold ${
                    cameraMode === 'CHASE_LEADER'
                      ? 'bg-cyan-500 text-slate-950 font-black'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Chase Leader
                </button>
                <button
                  onClick={() => setCameraMode('TOP_DOWN')}
                  className={`px-2.5 py-1 rounded transition-colors font-bold ${
                    cameraMode === 'TOP_DOWN'
                      ? 'bg-cyan-500 text-slate-950 font-black'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Satellite Map
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => gameSocket.spawnBot()}
                className="px-3 py-1 bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg font-bold text-xs flex items-center gap-1.5 transition-colors shadow"
                title="Launch an automated sparring aircraft into the airspace"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+ Launch AI Drone</span>
              </button>
              <button
                onClick={() => gameSocket.resetRoom()}
                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-bold text-xs flex items-center gap-1 border border-slate-700"
                title="Reposition all planes"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* 3D WebGL Canvas Viewport */}
          <div ref={containerRef} className="flex-1 w-full min-h-[540px] relative bg-slate-950" />

          {/* Live Fleet Proximity Warning HUD Banner */}
          {activeClashes.length > 0 && (
            <div className="absolute top-16 left-4 right-4 bg-red-950/85 border-2 border-red-500 rounded-xl p-3 px-4 flex items-center justify-between gap-3 text-xs font-mono text-red-200 animate-pulse shadow-xl backdrop-blur-md">
              <div className="flex items-center gap-2.5">
                <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
                <span>
                  <strong className="text-white">AIRSPACE CLASH HAZARD DETECTED:</strong>{' '}
                  {activeClashes[0].p1.callsign} &amp; {activeClashes[0].p2.callsign} are converging! Separation:{' '}
                  <strong className="text-white">{activeClashes[0].distNM} NM</strong> · Vertical:{' '}
                  <strong className="text-white">{activeClashes[0].dzFt} FT</strong>. TCAS clash suggestions flashing on pilot mobile screens!
                </span>
              </div>
            </div>
          )}

          {/* Canvas Floating Legend */}
          <div className="absolute bottom-3 left-3 bg-slate-950/80 border border-slate-800 rounded-xl p-2 px-3 flex items-center gap-4 text-[11px] font-mono backdrop-blur-md">
            <span className="text-slate-400">Planes in Airspace: <strong className="text-white">{activePlayersList.length}</strong></span>
            <span className="text-slate-600">|</span>
            <span className="text-rose-400 font-bold">Red Halo = Active Threat Zone (&le; 2.5 NM)</span>
          </div>
        </div>

        {/* Right Side: QR Code Scanner & Mobile Join Dock (4 cols) */}
        <div className="lg:col-span-4 flex flex-col gap-5">
          {/* QR Code Join Card */}
          <div className="bg-slate-900/90 border-2 border-slate-800 rounded-2xl p-5 shadow-2xl flex flex-col items-center text-center">
            <div className="flex items-center gap-2 mb-2">
              <QrCode className="w-5 h-5 text-cyan-400" />
              <h3 className="text-sm font-black text-white tracking-wider uppercase font-display">
                Scan to Play on Mobile Phone
              </h3>
            </div>
            <p className="text-xs text-slate-300 font-mono mb-4">
              Scan this QR code with your mobile camera to launch the 3D cockpit flight controller. Steer, climb, dive, and dodge incoming planes!
            </p>

            {/* QR Code Visual Box */}
            <div className="p-3 bg-slate-950 rounded-2xl border-2 border-cyan-500/60 shadow-xl shadow-cyan-950/40 relative group mb-4">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt="Scan QR to Join Flight Simulator"
                  className="w-48 h-48 rounded-xl object-contain"
                />
              ) : (
                <div className="w-48 h-48 flex items-center justify-center text-xs text-slate-500">
                  Generating QR Code...
                </div>
              )}
            </div>

            {/* Direct Join Link & Copy Button */}
            <div className="w-full flex items-center gap-2 bg-slate-950 p-2 rounded-xl border border-slate-800 text-xs font-mono mb-3">
              <span className="truncate flex-1 text-slate-300 text-left px-1">
                {controllerUrl}
              </span>
              <button
                onClick={handleCopyLink}
                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-cyan-400 rounded-lg font-bold flex items-center gap-1 shrink-0 transition-colors"
                title="Copy link to clipboard"
              >
                {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{isCopied ? 'Copied!' : 'Copy'}</span>
              </button>
            </div>

            <div className="text-[11px] font-mono text-slate-400">
              Room Code: <strong className="text-cyan-300">{roomId}</strong> · No app download required!
            </div>
          </div>

          {/* Connected Pilots Roster */}
          <div className="bg-slate-900/90 border-2 border-slate-800 rounded-2xl p-4 shadow-2xl flex flex-col flex-1">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-cyan-400" />
                <h3 className="text-xs font-black uppercase text-white tracking-wider">
                  Connected Pilots Roster ({activePlayersList.length})
                </h3>
              </div>
              <span className="text-[10px] font-mono text-emerald-400 font-bold bg-emerald-950 px-2 py-0.5 rounded border border-emerald-800">
                LIVE 25Hz SYNC
              </span>
            </div>

            <div className="space-y-2 overflow-y-auto max-h-[260px] pr-1 scrollbar-thin">
              {activePlayersList.map((player) => (
                <div
                  key={player.id}
                  onClick={() => setSelectedPlayerId(player.id)}
                  className={`p-2.5 rounded-xl border text-xs font-mono cursor-pointer transition-all flex items-center justify-between ${
                    selectedPlayerId === player.id
                      ? 'bg-cyan-950/80 border-cyan-400 text-white'
                      : 'bg-slate-950/70 border-slate-800 text-slate-300 hover:border-slate-600'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className="w-3.5 h-3.5 rounded-full shrink-0 shadow-sm"
                      style={{ backgroundColor: player.color }}
                    />
                    <div>
                      <div className="font-bold flex items-center gap-1.5">
                        <span>{player.callsign}</span>
                        {player.isBot && (
                          <span className="text-[9px] bg-slate-800 text-slate-400 px-1.5 py-0.2 rounded font-semibold">
                            AI DRONE
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        FL{Math.round(player.position.z / 100)} · {Math.round(player.speed)}KT · H{Math.round(player.heading)}°
                      </div>
                    </div>
                  </div>

                  <span className="text-[10px] font-bold text-cyan-300 bg-slate-900 px-2 py-1 rounded border border-slate-700">
                    Thr: {Math.round(player.throttle)}%
                  </span>
                </div>
              ))}

              {activePlayersList.length === 0 && (
                <div className="p-4 text-center text-xs font-mono text-slate-500">
                  No active pilots yet. Scan QR code or click &quot;+ Launch AI Drone&quot; above!
                </div>
              )}
            </div>

            {/* Clash Warning Engine Info Note */}
            <div className="mt-auto pt-3 border-t border-slate-800/80 text-[10px] font-mono text-slate-400">
              <span className="text-cyan-300 font-bold">TCAS / FLARM Proximity:</span> Whenever planes enter within 3.0 NM, directional clash alerts and evasive suggestions flash automatically on their mobile phone screens.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
