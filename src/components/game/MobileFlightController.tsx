import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';
import { PlayerPlane, PlayerControlInput, ClashWarning } from '../../types/gameTypes';
import { gameSocket } from '../../lib/gameSocket';
import {
  AlertOctagon,
  ArrowUp,
  ArrowDown,
  ArrowRight,
  ArrowLeft,
  Compass,
  Gauge,
  Flame,
  ShieldAlert,
  Zap,
  RotateCcw,
  CheckCircle2,
  Radio,
  Sliders,
} from 'lucide-react';

interface Props {
  roomId?: string;
  onExitToHost: () => void;
}

export const MobileFlightController: React.FC<Props> = ({
  roomId = 'sky-arena-1',
  onExitToHost,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Flight Telemetry States
  const [ownPlane, setOwnPlane] = useState<PlayerPlane | null>(null);
  const [allPlanes, setAllPlanes] = useState<Record<string, PlayerPlane>>({});
  const [clashWarning, setClashWarning] = useState<ClashWarning>({
    hasThreat: false,
    severity: 'NONE',
    intruderId: null,
    intruderCallsign: null,
    distanceNM: 99,
    verticalDeltaFt: 9999,
    timeToImpactSec: 99,
    bearingDeg: 0,
    suggestion: null,
  });

  // Flight Control Inputs
  const [pitchInput, setPitchInput] = useState<number>(0); // -1 (dive) to +1 (pull up)
  const [rollInput, setRollInput] = useState<number>(0); // -1 (left) to +1 (right)
  const [yawInput, setYawInput] = useState<number>(0);
  const [throttleInput, setThrottleInput] = useState<number>(75);
  const [afterburner, setAfterburner] = useState<boolean>(false);
  const [airbrake, setAirbrake] = useState<boolean>(false);

  // Virtual Joystick Touch Tracking
  const joystickBaseRef = useRef<HTMLDivElement | null>(null);
  const [joystickThumb, setJoystickThumb] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isJoystickActive, setIsJoystickActive] = useState<boolean>(false);

  // Connect as Player on Mount
  useEffect(() => {
    const savedPilotId = sessionStorage.getItem('pilot_id') || `pilot-${Math.random().toString(36).substring(2, 6)}`;
    sessionStorage.setItem('pilot_id', savedPilotId);

    gameSocket.connect('player', roomId, savedPilotId);

    const unsubscribe = gameSocket.onMessage((msg) => {
      if (msg.type === 'player_telemetry') {
        if (msg.ownPlane) setOwnPlane(msg.ownPlane);
        if (msg.allPlanes) setAllPlanes(msg.allPlanes);
        if (msg.clashWarning) setClashWarning(msg.clashWarning);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [roomId]);

  // Transmit Control Input at 30Hz
  useEffect(() => {
    const interval = setInterval(() => {
      gameSocket.sendControl({
        pitchInput,
        rollInput,
        yawInput,
        throttleInput,
        afterburner,
        airbrake,
      });
    }, 33);

    return () => clearInterval(interval);
  }, [pitchInput, rollInput, yawInput, throttleInput, afterburner, airbrake]);

  // Touch Joystick Handlers
  const handleTouchStart = (e: React.TouchEvent | React.MouseEvent) => {
    setIsJoystickActive(true);
    handleTouchMove(e);
  };

  const handleTouchMove = (e: React.TouchEvent | React.MouseEvent) => {
    if (!joystickBaseRef.current) return;
    const rect = joystickBaseRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;

    const deltaX = clientX - centerX;
    const deltaY = clientY - centerY;
    const maxRadius = rect.width / 2;

    const dist = Math.hypot(deltaX, deltaY);
    const clampedDist = Math.min(dist, maxRadius);
    const angle = Math.atan2(deltaY, deltaX);

    const thumbX = Math.cos(angle) * clampedDist;
    const thumbY = Math.sin(angle) * clampedDist;

    setJoystickThumb({ x: thumbX, y: thumbY });

    // Normalize: X is Roll (-1 to +1), Y is Pitch (pulling down is +pitch pull-up)
    const normRoll = thumbX / maxRadius;
    const normPitch = -(thumbY / maxRadius); // Inverted flight stick convention

    setRollInput(Number(normRoll.toFixed(2)));
    setPitchInput(Number(normPitch.toFixed(2)));
  };

  const handleTouchEnd = () => {
    setIsJoystickActive(false);
    setJoystickThumb({ x: 0, y: 0 });
    setRollInput(0);
    setPitchInput(0);
  };

  // Quick Action: Execute Flight Suggestion
  const handleExecuteSuggestion = () => {
    if (!clashWarning.suggestion) return;

    if (clashWarning.suggestion.targetVerticalSpeed !== undefined) {
      // Pull up or push down stick
      const targetVS = clashWarning.suggestion.targetVerticalSpeed;
      setPitchInput(targetVS > 0 ? 0.8 : -0.7);
    }
    if (clashWarning.suggestion.targetHeadingDelta !== undefined) {
      const deltaH = clashWarning.suggestion.targetHeadingDelta;
      setRollInput(deltaH > 0 ? 0.75 : -0.75);
    }
    if (clashWarning.suggestion.targetThrottle !== undefined) {
      setThrottleInput(clashWarning.suggestion.targetThrottle);
    }

    // Reset controls after 2.5s
    setTimeout(() => {
      setPitchInput(0);
      setRollInput(0);
    }, 2500);
  };

  // 3D Three.js Flight Canvas on Mobile
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || 360;
    const height = container.clientHeight || 240;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020617);
    scene.fog = new THREE.FogExp2(0x020617, 0.012);

    const camera = new THREE.PerspectiveCamera(55, width / height, 0.5, 1200);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // Lights
    const hemiLight = new THREE.HemisphereLight(0x38bdf8, 0x0f172a, 0.9);
    scene.add(hemiLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(20, 50, 30);
    scene.add(dirLight);

    // Ground Grid
    const grid = new THREE.GridHelper(160, 32, 0x0284c7, 0x1e293b);
    scene.add(grid);

    // Own Jet Mesh
    const jetGroup = new THREE.Group();
    const fuselageGeo = new THREE.ConeGeometry(0.7, 3.8, 8);
    fuselageGeo.rotateX(Math.PI / 2);
    const fuselageMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(ownPlane?.color || '#06b6d4'),
      metalness: 0.6,
      roughness: 0.3,
    });
    const fuselage = new THREE.Mesh(fuselageGeo, fuselageMat);
    jetGroup.add(fuselage);

    const wingGeo = new THREE.BufferGeometry();
    const wingVertices = new Float32Array([
      0, 0, 1.0,
      3.5, 0, -1.2,
      -3.5, 0, -1.2,
    ]);
    wingGeo.setAttribute('position', new THREE.BufferAttribute(wingVertices, 3));
    wingGeo.computeVertexNormals();
    const wing = new THREE.Mesh(wingGeo, fuselageMat);
    jetGroup.add(wing);

    const finGeo = new THREE.BufferGeometry();
    const finVertices = new Float32Array([
      0, 0, -0.4,
      0, 1.2, -1.5,
      0, 0, -1.5,
    ]);
    finGeo.setAttribute('position', new THREE.BufferAttribute(finVertices, 3));
    finGeo.computeVertexNormals();
    const fin = new THREE.Mesh(finGeo, fuselageMat);
    jetGroup.add(fin);

    scene.add(jetGroup);

    // Other Planes Meshes
    const otherMeshes: Map<string, THREE.Group> = new Map();

    let animFrameId: number;

    const animate = () => {
      animFrameId = requestAnimationFrame(animate);

      const p = ownPlaneRef.current;
      if (p) {
        // Update Own Jet Position & Attitude
        const posX = p.position.x * 4;
        const posZ = -p.position.y * 4;
        const posY = Math.max(2, (p.position.z / 1000) * 1.4);

        jetGroup.position.set(posX, posY, posZ);

        const headingRad = -(p.heading * Math.PI) / 180;
        const pitchRad = (p.pitch * Math.PI) / 180;
        const rollRad = (p.roll * Math.PI) / 180;

        jetGroup.rotation.set(0, 0, 0);
        jetGroup.rotateY(headingRad);
        jetGroup.rotateX(pitchRad);
        jetGroup.rotateZ(rollRad);

        // Chase Camera Following Own Aircraft
        const chaseDist = 18;
        const chaseHeight = 5.5;
        const headRad = ((90 - p.heading) * Math.PI) / 180;
        const camX = posX - Math.cos(headRad) * chaseDist;
        const camZ = posZ + Math.sin(headRad) * chaseDist;
        const camY = posY + chaseHeight;

        camera.position.lerp(new THREE.Vector3(camX, camY, camZ), 0.15);
        camera.lookAt(posX, posY + 1.2, posZ);

        // Update Other Planes in Sight
        const allList = Object.values(allPlanesRef.current);
        allList.forEach((other) => {
          if (other.id === p.id) return;
          let otherGroup = otherMeshes.get(other.id);
          if (!otherGroup) {
            otherGroup = new THREE.Group();
            const oFuselage = new THREE.Mesh(fuselageGeo, new THREE.MeshStandardMaterial({ color: new THREE.Color(other.color) }));
            otherGroup.add(oFuselage);
            scene.add(otherGroup);
            otherMeshes.set(other.id, otherGroup);
          }
          otherGroup.position.set(other.position.x * 4, Math.max(2, (other.position.z / 1000) * 1.4), -other.position.y * 4);
          otherGroup.rotation.set(0, 0, 0);
          otherGroup.rotateY(-(other.heading * Math.PI) / 180);
          otherGroup.rotateX((other.pitch * Math.PI) / 180);
          otherGroup.rotateZ((other.roll * Math.PI) / 180);
        });
      }

      renderer.render(scene, camera);
    };

    animate();

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix;
      renderer.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animFrameId);
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
    };
  }, []);

  const ownPlaneRef = useRef(ownPlane);
  useEffect(() => {
    ownPlaneRef.current = ownPlane;
  }, [ownPlane]);

  const allPlanesRef = useRef(allPlanes);
  useEffect(() => {
    allPlanesRef.current = allPlanes;
  }, [allPlanes]);

  const isCritical = clashWarning.severity === 'CRITICAL';
  const isWarning = clashWarning.severity === 'WARNING';
  const isAdvisory = clashWarning.severity === 'ADVISORY';

  return (
    <div
      className={`min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans select-none overflow-hidden touch-none transition-colors duration-200 ${
        isCritical ? 'ring-8 ring-red-500 animate-pulse bg-red-950/20' : isWarning ? 'ring-4 ring-amber-500' : ''
      }`}
    >
      {/* Top Mobile Cockpit Header */}
      <header className="bg-slate-900 border-b border-slate-800 p-2.5 px-4 flex items-center justify-between text-xs font-mono shadow-md">
        <div className="flex items-center gap-2">
          <span
            className="w-3 h-3 rounded-full shrink-0 shadow"
            style={{ backgroundColor: ownPlane?.color || '#06b6d4' }}
          />
          <div>
            <span className="font-black text-white">{ownPlane?.callsign || 'PILOT-01'}</span>
            <span className="text-[10px] text-slate-400 ml-1.5 hidden sm:inline">Room: {roomId}</span>
          </div>
        </div>

        {/* Real-Time Flight Instrumentation Readouts */}
        <div className="flex items-center gap-3 font-mono font-bold text-xs">
          <div className="text-center">
            <span className="text-[9px] text-slate-400 block">SPD</span>
            <span className="text-cyan-400">{Math.round(ownPlane?.speed || 360)} KT</span>
          </div>
          <div className="text-center">
            <span className="text-[9px] text-slate-400 block">ALT</span>
            <span className="text-emerald-400">{Math.round(ownPlane?.position.z || 12000)} FT</span>
          </div>
          <div className="text-center">
            <span className="text-[9px] text-slate-400 block">HDG</span>
            <span className="text-amber-400">{Math.round(ownPlane?.heading || 0)}°</span>
          </div>
        </div>

        <button
          onClick={onExitToHost}
          className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[10px] border border-slate-700 font-bold"
        >
          Exit
        </button>
      </header>

      {/* 3D Mobile Cockpit Viewport */}
      <div className="relative w-full h-[220px] sm:h-[280px] bg-slate-950 border-b border-slate-800 overflow-hidden">
        <div ref={containerRef} className="w-full h-full" />

        {/* HUD Pitch Ladder & Crosshair Overlay */}
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          <div className="w-16 h-16 border border-cyan-400/30 rounded-full flex items-center justify-center">
            <div className="w-2 h-2 bg-cyan-400 rounded-full" />
          </div>
          <div className="absolute top-2 left-2 text-[10px] font-mono text-cyan-400 bg-slate-950/70 px-1.5 py-0.5 rounded">
            PITCH: {Math.round(ownPlane?.pitch || 0)}° · ROLL: {Math.round(ownPlane?.roll || 0)}°
          </div>
        </div>
      </div>

      {/* ============================================================== */}
      {/* CLASH WARNING & PILOT SUGGESTION FLASHING PANEL (REQUESTED)    */}
      {/* ============================================================== */}
      <div className="px-3 py-2">
        <div
          className={`rounded-xl p-3 border text-xs font-mono transition-all duration-150 ${
            isCritical
              ? 'bg-red-950/90 border-red-500 text-red-100 shadow-xl shadow-red-950/50 animate-pulse ring-2 ring-red-400'
              : isWarning
              ? 'bg-amber-950/80 border-amber-500 text-amber-100 shadow-lg'
              : isAdvisory
              ? 'bg-cyan-950/60 border-cyan-700 text-cyan-200'
              : 'bg-slate-900/80 border-slate-800 text-slate-400'
          }`}
        >
          <div className="flex items-center justify-between font-black mb-1">
            <div className="flex items-center gap-1.5">
              {isCritical ? (
                <>
                  <AlertOctagon className="w-4 h-4 text-red-400 animate-spin" />
                  <span className="text-white font-extrabold tracking-wider">
                    CRITICAL CLASH WARNING: INTRUDER CLOSING!
                  </span>
                </>
              ) : isWarning ? (
                <>
                  <ShieldAlert className="w-4 h-4 text-amber-400" />
                  <span className="text-amber-300 font-extrabold tracking-wider">
                    TRAFFIC ADVISORY: INTRUDER IN AIRSPACE
                  </span>
                </>
              ) : isAdvisory ? (
                <>
                  <Radio className="w-4 h-4 text-cyan-400" />
                  <span>TRAFFIC DETECTED (CLEAR MARGIN)</span>
                </>
              ) : (
                <span>AIRSPACE NOMINAL · NO IMMINENT CLASH</span>
              )}
            </div>

            {clashWarning.hasThreat && (
              <span className="text-[10px] bg-black/60 px-2 py-0.5 rounded border border-white/20">
                DIST: <strong className="text-white">{clashWarning.distanceNM} NM</strong> · TTI: {clashWarning.timeToImpactSec}s
              </span>
            )}
          </div>

          {/* Dynamic Suggestion Box */}
          {clashWarning.suggestion ? (
            <div className="mt-2 pt-2 border-t border-white/15 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <div className="text-[10px] text-white/70 font-bold uppercase">
                  TCAS / FLARM PILOT SUGGESTION:
                </div>
                <div className="text-sm font-black text-white tracking-wide">
                  👉 {clashWarning.suggestion.action}
                </div>
                <div className="text-[10px] text-white/80">
                  {clashWarning.suggestion.description}
                </div>
              </div>

              {/* Quick Evasion Assist Button */}
              <button
                onClick={handleExecuteSuggestion}
                className="px-3.5 py-1.5 bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-black rounded-lg text-xs uppercase tracking-wider shadow-lg flex items-center justify-center gap-1.5 transition-transform active:scale-95 shrink-0"
              >
                <Zap className="w-3.5 h-3.5 fill-slate-950" />
                <span>Execute Suggestion</span>
              </button>
            </div>
          ) : (
            <div className="text-[10px] text-slate-500 mt-1">
              Continuously scanning 3D airspace for converging aircraft...
            </div>
          )}
        </div>
      </div>

      {/* Flight Simulator Controls Section */}
      <div className="flex-1 p-3 flex flex-col justify-end gap-3 max-w-lg mx-auto w-full">
        {/* Throttle & Rudder Bar */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 flex items-center justify-between gap-3 text-xs font-mono">
          {/* Throttle Controls */}
          <div className="flex-1 flex flex-col gap-1">
            <div className="flex justify-between text-[10px]">
              <span className="text-slate-400">THROTTLE: {Math.round(throttleInput)}%</span>
              <span className="text-cyan-400 font-bold">{afterburner ? 'AFTERBURNER' : 'NORMAL'}</span>
            </div>
            <input
              type="range"
              min="20"
              max="100"
              value={throttleInput}
              onChange={(e) => setThrottleInput(Number(e.target.value))}
              className="w-full accent-cyan-400 cursor-pointer h-2 bg-slate-950 rounded-lg"
            />
          </div>

          {/* Quick Boost & Airbrake */}
          <div className="flex items-center gap-1.5">
            <button
              onMouseDown={() => setAfterburner(true)}
              onMouseUp={() => setAfterburner(false)}
              onTouchStart={() => setAfterburner(true)}
              onTouchEnd={() => setAfterburner(false)}
              className={`p-2 rounded-lg font-bold text-[10px] flex items-center gap-1 transition-colors ${
                afterburner ? 'bg-orange-500 text-white' : 'bg-slate-800 text-orange-400'
              }`}
            >
              <Flame className="w-3.5 h-3.5" />
              <span>BOOST</span>
            </button>
          </div>
        </div>

        {/* Primary Flight Stick Joystick */}
        <div className="flex items-center justify-center py-1">
          <div
            ref={joystickBaseRef}
            onMouseDown={handleTouchStart}
            onMouseMove={handleTouchMove}
            onMouseUp={handleTouchEnd}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            className={`w-44 h-44 rounded-full border-4 relative flex items-center justify-center touch-none cursor-pointer transition-colors shadow-2xl ${
              isJoystickActive ? 'border-cyan-400 bg-cyan-950/40' : 'border-slate-700 bg-slate-900/80'
            }`}
          >
            {/* Crosshairs & Direction Indicators */}
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="w-full h-0.5 bg-slate-700/60" />
              <div className="absolute w-0.5 h-full bg-slate-700/60" />
            </div>

            <span className="absolute top-2 text-[9px] font-mono text-slate-500">PUSH DIVE</span>
            <span className="absolute bottom-2 text-[9px] font-mono text-slate-500">PULL CLIMB</span>
            <span className="absolute left-2 text-[9px] font-mono text-slate-500">BANK L</span>
            <span className="absolute right-2 text-[9px] font-mono text-slate-500">BANK R</span>

            {/* Draggable Stick Thumb */}
            <div
              className={`w-16 h-16 rounded-full border-2 flex items-center justify-center shadow-lg transition-transform ${
                isJoystickActive
                  ? 'bg-cyan-500 border-white text-slate-950 scale-110'
                  : 'bg-slate-700 border-slate-500 text-white'
              }`}
              style={{
                transform: `translate(${joystickThumb.x}px, ${joystickThumb.y}px)`,
              }}
            >
              <Sliders className="w-6 h-6" />
            </div>
          </div>
        </div>

        {/* Footer Guidance */}
        <div className="text-center text-[10px] font-mono text-slate-500 pb-1">
          Drag stick to pitch &amp; bank · Clash suggestions flash above whenever other aircraft converge
        </div>
      </div>
    </div>
  );
};
