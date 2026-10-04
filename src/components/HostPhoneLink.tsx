import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Smartphone } from 'lucide-react';
import type { AircraftState, ConflictAnalysis } from '../lib/types';
import { buildLiveState, wsUrl } from '../lib/liveLink';

interface Props {
  planeA: AircraftState;
  planeB: AircraftState;
  conflict: ConflictAnalysis;
  simTimeSec: number;
  isSimulating: boolean;
}

function newRoom() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

/** Host-screen panel: shows a QR code and streams live sim state to phones in the room. */
export function HostPhoneLink({ planeA, planeB, conflict, simTimeSec, isSimulating }: Props) {
  const [room] = useState(newRoom);
  const [viewers, setViewers] = useState(0);
  const [connected, setConnected] = useState(false);
  const [joinUrl, setJoinUrl] = useState('');
  const [qr, setQr] = useState('');
  const [big, setBig] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const latest = useRef({ planeA, planeB, conflict, simTimeSec, isSimulating });
  latest.current = { planeA, planeB, conflict, simTimeSec, isSimulating };

  // Build the join URL (on localhost, swap in the LAN address so phones can reach it)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let base = location.origin;
      if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
        try {
          const r = await fetch('/api/lan');
          const { ips } = await r.json();
          if (ips?.[0]) base = `${location.protocol}//${ips[0]}:${location.port}`;
        } catch { /* keep origin */ }
      }
      const server = new URLSearchParams(location.search).get('server');
      const url = `${base}/?view=phone&room=${room}${server ? `&server=${encodeURIComponent(server)}` : ''}`;
      const png = await QRCode.toDataURL(url, { margin: 1, width: 720, color: { dark: '#000000', light: '#ffffff' } });
      if (!cancelled) { setJoinUrl(url); setQr(png); }
    })();
    return () => { cancelled = true; };
  }, [room]);

  // Host connection with auto-reconnect
  useEffect(() => {
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      const ws = new WebSocket(wsUrl());
      wsRef.current = ws;
      ws.onopen = () => { setConnected(true); ws.send(JSON.stringify({ type: 'host', room })); };
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.type === 'viewers' || m.type === 'hosted') setViewers(m.viewers);
      };
      ws.onclose = () => { setConnected(false); if (!closed) timer = setTimeout(connect, 2000); };
    };
    connect();
    return () => { closed = true; clearTimeout(timer); wsRef.current?.close(); };
  }, [room]);

  // Publish state ~15 Hz
  useEffect(() => {
    const id = setInterval(() => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const l = latest.current;
      ws.send(JSON.stringify({ type: 'state', state: buildLiveState(l.planeA, l.planeB, l.conflict, l.simTimeSec, l.isSimulating) }));
    }, 66);
    return () => clearInterval(id);
  }, []);

  return (
    <section id="phone-link" className="rounded-xl border border-blue-900/60 bg-neutral-950 p-4 flex flex-col sm:flex-row items-center gap-5">
      <div className="bg-white p-2 rounded-lg shrink-0">
        {qr ? <img src={qr} alt="Scan to fly from your phone" className="w-40 h-40" /> : <div className="w-40 h-40" />}
        <button onClick={() => setBig(true)} className="mt-2 w-full text-xs font-bold text-black border border-black/30 rounded-md py-1 hover:bg-black/5">
          Enlarge QR
        </button>
      </div>
      {big && (
        <div className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center p-6 cursor-pointer" onClick={() => setBig(false)}>
          <div className="bg-white p-4 rounded-2xl">
            <img src={qr} alt="Large QR code" style={{ width: 'min(80vh, 90vw)', height: 'min(80vh, 90vw)' }} />
          </div>
          <div className="mt-4 text-white font-mono text-sm">Room {room} · tap anywhere to close</div>
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-blue-300 font-black uppercase tracking-widest text-xs">
          <Smartphone className="w-4 h-4" /> Phone cockpit
        </div>
        <h3 className="text-lg font-black mt-1">Scan to see the sim from the cockpit</h3>
        <p className="text-sm text-slate-300 mt-1">
          Pick Alpha or Bravo on your phone. You get a live first-person view while the simulation runs, with that
          pilot&apos;s collision warning (one is told to climb, the other to descend).
        </p>
        <div className="mt-2 font-mono text-xs text-slate-400 break-all">
          Room <span className="text-white font-bold">{room}</span> · {connected ? 'live' : 'connecting...'} · {viewers} phone{viewers === 1 ? '' : 's'} connected
        </div>
        {joinUrl && <div className="mt-1 font-mono text-[11px] text-slate-500 break-all">{joinUrl}</div>}
      </div>
    </section>
  );
}
