import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { wsUrl } from '../lib/liveLink';
import type { LiveState, LivePlane } from '../lib/liveLink';

const FT_PER_NM = 6076.12;
type Pick = 'A' | 'B';

function makeJet(color: string) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, 0.6, 12), mat);
  body.rotation.x = Math.PI / 2;
  g.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.14, 12), mat);
  nose.rotation.x = -Math.PI / 2; nose.position.z = -0.37;
  g.add(nose);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.012, 0.16), mat);
  wing.position.z = 0.02; g.add(wing);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.15, 0.1), mat);
  tail.position.set(0, 0.07, 0.26); g.add(tail);
  const stab = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.01, 0.07), mat);
  stab.position.z = 0.26; g.add(stab);
  return g;
}

function angDiff(a: number, b: number) {
  let d = b - a;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

export function PhoneCockpit() {
  const params = new URLSearchParams(location.search);
  const room = (params.get('room') || '').toUpperCase();
  const mount = useRef<HTMLDivElement>(null);
  const [pick, setPick] = useState<Pick | null>(null);
  const [view, setView] = useState<'cockpit' | 'chase'>('cockpit');
  const [status, setStatus] = useState<'connecting' | 'live' | 'error'>('connecting');
  const [error, setError] = useState('');
  const [live, setLive] = useState<LiveState | null>(null);
  const latest = useRef<LiveState | null>(null);
  const pickRef = useRef<Pick | null>(null);
  const drag = useRef({ yaw: 0, pitch: 0 });
  const gyro = useRef<{ on: boolean; q: THREE.Quaternion | null; base: number | null }>({ on: false, q: null, base: null });
  const [gyroOn, setGyroOn] = useState(false);
  const [gyroMsg, setGyroMsg] = useState('');
  const viewRef = useRef(view);
  pickRef.current = pick;
  viewRef.current = view;

  // Socket
  useEffect(() => {
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let fatal = false;
    const connect = () => {
      const ws = new WebSocket(wsUrl());
      ws.onopen = () => ws.send(JSON.stringify({ type: 'join', room }));
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.type === 'state') { latest.current = m.state; setLive(m.state); setStatus('live'); }
        if (m.type === 'error') { setStatus('error'); setError(m.error); }
      };
      ws.onclose = () => { if (!closed && !fatal) { setStatus('connecting'); timer = setTimeout(connect, 2000); } };
    };
    connect();
    return () => { closed = true; clearTimeout(timer); };
  }, [room]);

  // Haptics on resolution advisory
  const level = live && pick ? live.advisories[pick].level : 'CLEAR';
  useEffect(() => {
    if (level === 'RESOLUTION' && navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 300]);
  }, [level]);

  // Touch/mouse drag to look around
  useEffect(() => {
    const el = mount.current;
    if (!pick || !el) return;
    let last: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => { last = { x: e.clientX, y: e.clientY }; };
    const move = (e: PointerEvent) => {
      if (!last) return;
      drag.current.yaw -= (e.clientX - last.x) * 0.006;
      drag.current.pitch = Math.max(-1.5, Math.min(1.5, drag.current.pitch - (e.clientY - last.y) * 0.006));
      last = { x: e.clientX, y: e.clientY };
    };
    const up = () => { last = null; };
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [pick]);

  // Gyro look-around (needs a real phone + permission on iOS)
  useEffect(() => {
    if (!gyroOn) { gyro.current.on = false; return; }
    const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
    const handler = (e: DeviceOrientationEvent) => {
      if (e.alpha == null || e.beta == null || e.gamma == null) return;
      const d = Math.PI / 180;
      const orient = ((window.screen.orientation?.angle ?? (window as any).orientation ?? 0) as number) * d;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(e.beta * d, e.alpha * d, -e.gamma * d, 'YXZ'));
      q.multiply(q1);
      q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -orient));
      gyro.current.q = q;
      gyro.current.on = true;
    };
    window.addEventListener('deviceorientation', handler);
    return () => { window.removeEventListener('deviceorientation', handler); gyro.current.on = false; };
  }, [gyroOn]);

  const toggleGyro = async () => {
    if (gyroOn) { setGyroOn(false); setGyroMsg(''); return; }
    try {
      const DOE = (window as any).DeviceOrientationEvent;
      if (DOE && typeof DOE.requestPermission === 'function') {
        const r = await DOE.requestPermission();
        if (r !== 'granted') { setGyroMsg('Motion access denied. Drag to look around.'); return; }
      }
      gyro.current.base = null; gyro.current.q = null;
      drag.current = { yaw: 0, pitch: 0 };
      setGyroOn(true);
      setGyroMsg('Gyro on. Move your phone to look around.');
      setTimeout(() => setGyroMsg(''), 3000);
    } catch { setGyroMsg('Gyro not available here. Drag to look around.'); }
  };
  const recenter = () => { drag.current = { yaw: 0, pitch: 0 }; gyro.current.base = null; };

  // 3D scene
  useEffect(() => {
    if (!pick || !mount.current) return;
    const el = mount.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#7ab8ee');
    scene.fog = new THREE.Fog('#a9d1f5', 8, 60);
    const camera = new THREE.PerspectiveCamera(70, 1, 0.02, 120);
    camera.rotation.order = 'YXZ';
    scene.add(new THREE.HemisphereLight('#ffffff', '#2a4d7a', 1.1));
    const sun = new THREE.DirectionalLight('#ffffff', 1.2);
    sun.position.set(5, 10, 3); scene.add(sun);

    const sea = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: '#1d4f86', roughness: 1 }));
    sea.rotation.x = -Math.PI / 2; scene.add(sea);
    const grid = new THREE.GridHelper(400, 200, '#3d7ab8', '#2b629f');
    grid.position.y = 0.01; scene.add(grid);

    // Clouds for a sense of speed/depth
    const cloudMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55 });
    for (let i = 0; i < 70; i++) {
      const c = new THREE.Mesh(new THREE.SphereGeometry(0.5 + Math.random() * 0.9, 8, 6), cloudMat);
      c.scale.y = 0.35;
      c.position.set((Math.random() - 0.5) * 120, 2.2 + Math.random() * 1.0, (Math.random() - 0.5) * 120);
      scene.add(c);
    }

    const jets: Record<Pick, THREE.Group> = { A: makeJet('#06b6d4'), B: makeJet('#f59e0b') };
    scene.add(jets.A, jets.B);
    // Always-visible marker on the other plane so it can be spotted at 12 NM
    const markerMat = new THREE.SpriteMaterial({ color: '#ff3b30', transparent: true, opacity: 0.9, depthTest: false });
    const marker = new THREE.Sprite(markerMat);
    scene.add(marker);

    const smooth: Record<Pick, { x: number; y: number; z: number; h: number; p: number; b: number } | null> = { A: null, B: null };
    const target = (p: LivePlane) => ({ x: p.x, y: p.z / FT_PER_NM, z: -p.y, h: p.heading, p: p.pitch, b: p.bank });

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.fov = w / h < 1 ? 85 : 70;
      camera.updateProjectionMatrix();
    };
    resize();
    window.addEventListener('resize', resize);

    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const s = latest.current;
      if (s) {
        for (const p of s.planes) {
          const t = target(p);
          const cur = smooth[p.id];
          if (!cur) smooth[p.id] = t;
          else {
            const k = 0.35;
            cur.x += (t.x - cur.x) * k; cur.y += (t.y - cur.y) * k; cur.z += (t.z - cur.z) * k;
            cur.h += angDiff(cur.h, t.h) * k; cur.p += (t.p - cur.p) * k; cur.b += (t.b - cur.b) * k;
          }
        }
      }
      for (const id of ['A', 'B'] as Pick[]) {
        const c = smooth[id];
        if (!c) continue;
        const j = jets[id];
        j.position.set(c.x, c.y, c.z);
        j.rotation.order = 'YXZ';
        j.rotation.set((c.p * Math.PI) / 180, (-c.h * Math.PI) / 180, (-c.b * Math.PI) / 180);
      }
      const me = pickRef.current!;
      const other: Pick = me === 'A' ? 'B' : 'A';
      const m = smooth[me], o = smooth[other];
      if (m) {
        const chase = viewRef.current === 'chase';
        jets[me].visible = chase;
        const qPlane = new THREE.Quaternion().setFromEuler(new THREE.Euler((m.p * Math.PI) / 180, (-m.h * Math.PI) / 180, (-m.b * Math.PI) / 180, 'YXZ'));
        const fwd = new THREE.Vector3(Math.sin((m.h * Math.PI) / 180), 0, -Math.cos((m.h * Math.PI) / 180));
        if (chase) {
          camera.position.set(m.x - fwd.x * 1.4, m.y + 0.35, m.z - fwd.z * 1.4);
          // orbit around the jet with drag
          const off = new THREE.Vector3(-fwd.x * 1.4, 0.35, -fwd.z * 1.4).applyAxisAngle(new THREE.Vector3(0, 1, 0), drag.current.yaw);
          camera.position.set(m.x + off.x, m.y + off.y, m.z + off.z);
          camera.lookAt(m.x, m.y, m.z);
        } else {
          camera.position.set(m.x + fwd.x * 0.1, m.y + 0.03, m.z + fwd.z * 0.1);
          // 360 look-around: drag and/or phone gyro, relative to the aircraft nose
          const qLook = new THREE.Quaternion().setFromEuler(new THREE.Euler(drag.current.pitch, drag.current.yaw, 0, 'YXZ'));
          if (gyro.current.on && gyro.current.q) {
            const g = gyro.current;
            if (g.base === null) g.base = new THREE.Euler().setFromQuaternion(g.q!, 'YXZ').y;
            const unyaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -g.base);
            qLook.multiply(unyaw.multiply(g.q!.clone()));
          }
          camera.quaternion.copy(qPlane.multiply(qLook));
        }
        if (o) {
          marker.position.set(o.x, o.y, o.z);
          const d = marker.position.distanceTo(camera.position);
          marker.scale.setScalar(Math.max(0.15, d * 0.035));
        }
      }
      renderer.render(scene, camera);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, [pick]);

  // ---------- UI ----------
  if (!room) {
    return <Center><p className="text-lg">No room in this link. Scan the QR code on the host screen.</p></Center>;
  }
  if (status === 'error') {
    return <Center><p className="text-lg font-bold">{error}</p><button className="mt-4 px-5 py-3 bg-blue-600 rounded-xl font-bold" onClick={() => location.reload()}>Retry</button></Center>;
  }
  if (!pick) {
    return (
      <Center>
        <div className="text-xs font-mono tracking-widest text-blue-300">AXIS · ROOM {room}</div>
        <h1 className="text-2xl font-black mt-1">Choose your aircraft</h1>
        <p className="text-slate-400 text-sm mt-1 mb-6">{status === 'live' ? 'Connected. Simulation feed is live.' : 'Connecting to host...'}</p>
        {(['A', 'B'] as Pick[]).map((id) => {
          const p = live?.planes.find((x) => x.id === id);
          return (
            <button key={id} onClick={() => setPick(id)}
              className="w-full max-w-xs mb-3 px-5 py-5 rounded-2xl font-black text-black text-lg"
              style={{ background: id === 'A' ? '#06b6d4' : '#f59e0b' }}>
              {id === 'A' ? 'Flight Alpha' : 'Flight Bravo'}
              <div className="text-sm font-mono font-bold opacity-70">{p ? p.callsign : id}</div>
            </button>
          );
        })}
      </Center>
    );
  }

  const me = live?.planes.find((p) => p.id === pick);
  const adv = live?.advisories[pick];
  const ra = adv?.level === 'RESOLUTION';
  const ta = adv?.level === 'TRAFFIC';
  const arrow = adv?.command === 'CLIMB' ? '▲' : adv?.command === 'DESCEND' ? '▼' : '';

  return (
    <div className="fixed inset-0 bg-black overflow-hidden select-none" style={{ touchAction: 'none' }}>
      <div ref={mount} className="absolute inset-0" />

      {/* HUD */}
      <div className="absolute inset-0 pointer-events-none font-mono text-white" style={{ textShadow: '0 0 4px #000' }}>
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 border-2 border-lime-300/80 rounded-full" />
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 bg-lime-300 rounded-full" />
        <div className="absolute top-2 left-3 text-xs leading-5">
          <div className="font-black" style={{ color: pick === 'A' ? '#06b6d4' : '#f59e0b' }}>{me?.callsign ?? '...'}</div>
          <div>SPD {me ? Math.round(me.speed) : '--'} KT</div>
          <div>ALT {me ? Math.round(me.z).toLocaleString() : '--'} FT</div>
        </div>
        <div className="absolute top-2 right-3 text-xs leading-5 text-right">
          <div>HDG {me ? String(Math.round(me.heading) % 360).padStart(3, '0') : '---'}°</div>
          <div>VS {me ? (me.vs >= 0 ? '+' : '') + Math.round(me.vs) : '--'}</div>
          <div>TRAFFIC {live ? live.distanceNM.toFixed(1) : '--'} NM</div>
        </div>
        {live && !live.running && (
          <div className="absolute bottom-32 left-1/2 -translate-x-1/2 text-xs bg-black/60 px-3 py-1 rounded">SIM PAUSED</div>
        )}
      </div>

      {/* Advisory */}
      <div className="absolute left-0 right-0 top-16 flex flex-col items-center pointer-events-none px-3">
        {ra && (
          <div className="animate-pulse rounded-2xl px-6 py-3 text-center bg-red-600 border-4 border-white shadow-2xl">
            <div className="text-4xl font-black text-white leading-none">{arrow} {adv!.text}</div>
            <div className="text-xs font-mono text-white/90 mt-1">
              {live && Number.isFinite(live.timeToCPASec) && live.timeToCPASec > 0 ? `Closest approach in ${Math.round(live.timeToCPASec)}s · ` : ''}
              traffic {live?.distanceNM.toFixed(1)} NM
            </div>
          </div>
        )}
        {ta && (
          <div className="rounded-2xl px-5 py-2 text-center bg-amber-500 border-2 border-white text-black font-black text-2xl">
            {adv!.text}
          </div>
        )}
        {!ra && me?.action && (
          <div className="mt-2 rounded-lg px-3 py-1 bg-emerald-600/90 text-white text-xs font-bold">EXECUTING: {me.action}</div>
        )}
      </div>

      {gyroMsg ? <div className="absolute left-1/2 -translate-x-1/2 bottom-28 text-xs bg-black/70 text-white px-3 py-1 rounded pointer-events-none">{gyroMsg}</div> : null}
      <div className="absolute left-3 right-3 bottom-16 flex justify-center gap-2">
        <button className="px-3 py-1.5 rounded-lg bg-black/60 border border-white/30 text-white text-xs font-bold" onClick={toggleGyro}>{gyroOn ? 'Gyro: ON' : 'Use gyro'}</button>
        <button className="px-3 py-1.5 rounded-lg bg-black/60 border border-white/30 text-white text-xs font-bold" onClick={recenter}>Recenter</button>
        <span className="px-2 py-1.5 text-[11px] text-white/80 self-center" style={{ textShadow: '0 0 4px #000' }}>Drag to look around 360°</span>
      </div>

      {/* Controls */}
      <div className="absolute bottom-3 left-3 right-3 flex justify-between gap-2">
        <button className="px-4 py-2 rounded-xl bg-black/60 border border-white/30 text-white text-sm font-bold" onClick={() => setPick(pick === 'A' ? 'B' : 'A')}>
          Switch to {pick === 'A' ? 'Bravo' : 'Alpha'}
        </button>
        <button className="px-4 py-2 rounded-xl bg-black/60 border border-white/30 text-white text-sm font-bold" onClick={() => setView(view === 'cockpit' ? 'chase' : 'cockpit')}>
          {view === 'cockpit' ? 'Tail view' : 'Cockpit view'}
        </button>
        <button className="px-4 py-2 rounded-xl bg-black/60 border border-white/30 text-white text-sm font-bold" onClick={() => setPick(null)}>
          Change
        </button>
      </div>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6 text-center">{children}</div>;
}
