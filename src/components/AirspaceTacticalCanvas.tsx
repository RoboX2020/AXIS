import React, { useRef, useEffect, useState, useCallback } from 'react';
import { AircraftState, CandidateTrajectory, ScenarioPreset } from '../lib/types';
import { SCENARIO_PRESETS, EMERGENCY_PROMPT_RANGE_NM } from '../lib/algorithms';
import { Compass, Move, RotateCw, Play, RotateCcw, AlertTriangle, CheckCircle2, ShieldAlert } from 'lucide-react';

interface Props {
  planeA: AircraftState;
  planeB: AircraftState;
  onChangePlaneA: (updates: Partial<AircraftState>) => void;
  onChangePlaneB: (updates: Partial<AircraftState>) => void;
  onLoadScenario: (scenario: ScenarioPreset) => void;
  activeScenarioId: string;
  isSimulating: boolean;
  tcasStatus: 'CLEAR' | 'TRAFFIC_ADVISORY' | 'RESOLUTION_ADVISORY';
  candidateTrajectories?: CandidateTrajectory[];
}

export const AirspaceTacticalCanvas: React.FC<Props> = ({
  planeA,
  planeB,
  onChangePlaneA,
  onChangePlaneB,
  onLoadScenario,
  activeScenarioId,
  isSimulating,
  tcasStatus,
  candidateTrajectories,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [selectedPlane, setSelectedPlane] = useState<'A' | 'B'>('A');
  const [dragMode, setDragMode] = useState<'position' | 'heading' | null>(null);
  const [hoveredPlane, setHoveredPlane] = useState<'A' | 'B' | null>(null);

  // Airspace spans ±22 Nautical Miles
  const MAP_RANGE_NM = 22;

  // Coordinate transforms
  const nmToCanvas = useCallback(
    (xNM: number, yNM: number, width: number, height: number) => {
      const scale = Math.min(width, height) / (MAP_RANGE_NM * 2);
      return {
        cx: width / 2 + xNM * scale,
        cy: height / 2 - yNM * scale,
      };
    },
    []
  );

  const canvasToNm = useCallback(
    (cx: number, cy: number, width: number, height: number) => {
      const scale = Math.min(width, height) / (MAP_RANGE_NM * 2);
      return {
        xNM: (cx - width / 2) / scale,
        yNM: -(cy - height / 2) / scale,
      };
    },
    []
  );

  // Render tactical high-visibility 2D radar display
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const center = { x: width / 2, y: height / 2 };
    const radius = Math.min(width, height) / 2 - 10;
    const scale = Math.min(width, height) / (MAP_RANGE_NM * 2);

    // Clear
    ctx.clearRect(0, 0, width, height);

    // Radar circular background (Deep aerospace dark navy)
    ctx.fillStyle = '#030712';
    ctx.fillRect(0, 0, width, height);

    // Radial gradient glow
    const grad = ctx.createRadialGradient(center.x, center.y, 5, center.x, center.y, radius);
    grad.addColorStop(0, '#0c1b33');
    grad.addColorStop(0.7, '#070f1e');
    grad.addColorStop(1, '#030712');

    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = '#1e3a5f';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Standard Range rings (5 NM, 10 NM, 15 NM, 20 NM)
    const rings = [5, 10, 15, 20];
    rings.forEach((rNM) => {
      const rPx = rNM * scale;
      ctx.beginPath();
      ctx.arc(center.x, center.y, rPx, 0, Math.PI * 2);
      ctx.strokeStyle = '#1e293b';
      ctx.setLineDash([3, 4]);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#64748b';
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillText(`${rNM} NM`, center.x + 4, center.y - rPx + 12);
    });

    // 12 NM Emergency Detection Range Ring (Prominently highlighted as requested!)
    const r12Px = EMERGENCY_PROMPT_RANGE_NM * scale;
    ctx.beginPath();
    ctx.arc(center.x, center.y, r12Px, 0, Math.PI * 2);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    // 12 NM Label Badge
    ctx.fillStyle = '#ef4444';
    ctx.font = 'bold 10px "JetBrains Mono", monospace';
    ctx.fillText('12 NM EMERGENCY PROMPT BOUNDARY', center.x - 90, center.y - r12Px - 6);

    // Crosshairs
    ctx.beginPath();
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.moveTo(center.x, center.y - radius);
    ctx.lineTo(center.x, center.y + radius);
    ctx.moveTo(center.x - radius, center.y);
    ctx.lineTo(center.x + radius, center.y);
    ctx.stroke();

    // Compass Headings
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('000° N', center.x, center.y - radius + 15);
    ctx.fillText('090° E', center.x + radius - 24, center.y);
    ctx.fillText('180° S', center.x, center.y + radius - 15);
    ctx.fillText('270° W', center.x - radius + 24, center.y);

    // Draw Aircraft Function
    const drawAircraft = (plane: AircraftState, isCurrentSelected: boolean) => {
      const pos = nmToCanvas(plane.position.x, plane.position.y, width, height);
      const headingRad = ((plane.heading - 90) * Math.PI) / 180;
      const isAlpha = plane.id === 'A';
      const mainColor = isAlpha ? '#3b82f6' : '#ffffff';
      const glowColor = isAlpha ? 'rgba(59, 130, 246, 0.4)' : 'rgba(255, 255, 255, 0.4)';

      // Flight history trail
      if (plane.history.length > 1) {
        ctx.beginPath();
        plane.history.forEach((pt, i) => {
          const cPt = nmToCanvas(pt.x, pt.y, width, height);
          if (i === 0) ctx.moveTo(cPt.cx, cPt.cy);
          else ctx.lineTo(cPt.cx, cPt.cy);
        });
        ctx.strokeStyle = isAlpha ? 'rgba(59, 130, 246, 0.55)' : 'rgba(255, 255, 255, 0.55)';
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }

      // Predicted Dotted Trajectory Lines & Candidate Fan
      if (isAlpha && candidateTrajectories && candidateTrajectories.length > 0 && !plane.hasResolved) {
        // Render multiple candidate trajectories
        candidateTrajectories.forEach((cand) => {
          ctx.beginPath();
          cand.points.forEach((pt, i) => {
            const cPt = nmToCanvas(pt.x, pt.y, width, height);
            if (i === 0) ctx.moveTo(cPt.cx, cPt.cy);
            else ctx.lineTo(cPt.cx, cPt.cy);
          });

          if (cand.status === 'ELIMINATED') {
            ctx.strokeStyle = 'rgba(239, 68, 68, 0.8)'; // Dotted Red for eliminated
            ctx.lineWidth = 1.5;
            ctx.setLineDash([3, 4]);
          } else {
            ctx.strokeStyle = '#60a5fa'; // Dotted Blue for viable
            ctx.lineWidth = 2.0;
            ctx.setLineDash([5, 4]);
          }
          ctx.stroke();
          ctx.setLineDash([]);
        });
      } else if (plane.predictedTrajectory.length > 0) {
        ctx.beginPath();
        plane.predictedTrajectory.forEach((pt, i) => {
          const cPt = nmToCanvas(pt.x, pt.y, width, height);
          if (i === 0) ctx.moveTo(cPt.cx, cPt.cy);
          else ctx.lineTo(cPt.cx, cPt.cy);
        });
        ctx.strokeStyle = plane.hasResolved && isAlpha ? '#ffffff' : mainColor;
        ctx.lineWidth = plane.hasResolved && isAlpha ? 5 : 2;
        if (!plane.hasResolved || !isAlpha) {
          ctx.setLineDash([4, 4]);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Decided Route Line (Bold solid line as requested)
      if (plane.decidedRoute.length > 1) {
        ctx.beginPath();
        plane.decidedRoute.forEach((pt, i) => {
          const cPt = nmToCanvas(pt.x, pt.y, width, height);
          if (i === 0) ctx.moveTo(cPt.cx, cPt.cy);
          else ctx.lineTo(cPt.cx, cPt.cy);
        });
        ctx.strokeStyle = '#ffffff'; // Bold solid white line
        ctx.lineWidth = 5.0;
        ctx.stroke();
      }

      // Aircraft Position Highlight
      ctx.beginPath();
      ctx.arc(pos.cx, pos.cy, 14, 0, Math.PI * 2);
      ctx.fillStyle = isCurrentSelected ? glowColor : 'transparent';
      ctx.fill();

      // Heading vector arrow
      const vectorLen = 42;
      const arrowTip = {
        x: pos.cx + vectorLen * Math.cos(headingRad),
        y: pos.cy + vectorLen * Math.sin(headingRad),
      };

      ctx.beginPath();
      ctx.moveTo(pos.cx, pos.cy);
      ctx.lineTo(arrowTip.x, arrowTip.y);
      ctx.strokeStyle = mainColor;
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // Direction handle head (interactive for dragging heading)
      ctx.beginPath();
      ctx.arc(arrowTip.x, arrowTip.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = mainColor;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Jet icon
      ctx.save();
      ctx.translate(pos.cx, pos.cy);
      ctx.rotate(headingRad + Math.PI / 2);

      ctx.beginPath();
      ctx.moveTo(0, -11);
      ctx.lineTo(3.5, -2);
      ctx.lineTo(12, 3);
      ctx.lineTo(12, 5);
      ctx.lineTo(2.5, 2.5);
      ctx.lineTo(2.5, 8);
      ctx.lineTo(6, 11);
      ctx.lineTo(6, 12);
      ctx.lineTo(0, 11);
      ctx.lineTo(-6, 12);
      ctx.lineTo(-6, 11);
      ctx.lineTo(-2.5, 8);
      ctx.lineTo(-2.5, 2.5);
      ctx.lineTo(-12, 5);
      ctx.lineTo(-12, 3);
      ctx.lineTo(-3.5, -2);
      ctx.closePath();
      ctx.fillStyle = mainColor;
      ctx.fill();
      ctx.restore();

      // ADS-B Data Block label with high visibility
      ctx.font = '11px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';

      const tagX = pos.cx + 16;
      const tagY = pos.cy - 18;
      ctx.fillStyle = 'rgba(6, 15, 30, 0.92)';
      ctx.strokeStyle = mainColor;
      ctx.lineWidth = 1.5;
      ctx.fillRect(tagX - 4, tagY - 4, 88, 44);
      ctx.strokeRect(tagX - 4, tagY - 4, 88, 44);

      ctx.fillStyle = mainColor;
      ctx.font = 'bold 11px "JetBrains Mono", monospace';
      ctx.fillText(plane.callsign, tagX, tagY);

      ctx.fillStyle = '#cbd5e1';
      ctx.font = '10px "JetBrains Mono", monospace';
      const fl = Math.round(plane.position.z / 100);
      const vsArrow = plane.verticalSpeed > 200 ? '↑' : plane.verticalSpeed < -200 ? '↓' : '→';
      ctx.fillText(`FL${fl} ${vsArrow} ${Math.round(plane.heading)}°`, tagX, tagY + 14);
      ctx.fillText(`${Math.round(plane.speed)} KT`, tagX, tagY + 26);
    };

    drawAircraft(planeB, selectedPlane === 'B');
    drawAircraft(planeA, selectedPlane === 'A');

    // Flashing canvas border if in alert
    if (tcasStatus === 'RESOLUTION_ADVISORY') {
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 4;
      ctx.strokeRect(2, 2, width - 4, height - 4);
    } else if (tcasStatus === 'TRAFFIC_ADVISORY') {
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 3;
      ctx.strokeRect(2, 2, width - 4, height - 4);
    }
  }, [planeA, planeB, selectedPlane, nmToCanvas, tcasStatus]);

  // Pointer interactions
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isSimulating) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const cy = ((e.clientY - rect.top) / rect.height) * canvas.height;

    const checkHit = (p: AircraftState) => {
      const pPos = nmToCanvas(p.position.x, p.position.y, canvas.width, canvas.height);
      const headingRad = ((p.heading - 90) * Math.PI) / 180;
      const arrowTip = {
        x: pPos.cx + 42 * Math.cos(headingRad),
        y: pPos.cy + 42 * Math.sin(headingRad),
      };

      const distHeadingHandle = Math.hypot(cx - arrowTip.x, cy - arrowTip.y);
      if (distHeadingHandle < 16) return 'heading';

      const distPos = Math.hypot(cx - pPos.cx, cy - pPos.cy);
      if (distPos < 26) return 'position';

      return null;
    };

    const hitA = checkHit(planeA);
    const hitB = checkHit(planeB);

    if (hitA) {
      setSelectedPlane('A');
      setDragMode(hitA);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } else if (hitB) {
      setSelectedPlane('B');
      setDragMode(hitB);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const cy = ((e.clientY - rect.top) / rect.height) * canvas.height;

    if (!dragMode) {
      const posA = nmToCanvas(planeA.position.x, planeA.position.y, canvas.width, canvas.height);
      const posB = nmToCanvas(planeB.position.x, planeB.position.y, canvas.width, canvas.height);
      if (Math.hypot(cx - posA.cx, cy - posA.cy) < 26) setHoveredPlane('A');
      else if (Math.hypot(cx - posB.cx, cy - posB.cy) < 26) setHoveredPlane('B');
      else setHoveredPlane(null);
      return;
    }

    const currentPlane = selectedPlane === 'A' ? planeA : planeB;
    const updateFn = selectedPlane === 'A' ? onChangePlaneA : onChangePlaneB;

    if (dragMode === 'position') {
      const { xNM, yNM } = canvasToNm(cx, cy, canvas.width, canvas.height);
      const clampedX = Math.max(-20, Math.min(20, Number(xNM.toFixed(2))));
      const clampedY = Math.max(-20, Math.min(20, Number(yNM.toFixed(2))));

      updateFn({
        position: { ...currentPlane.position, x: clampedX, y: clampedY },
        startPosition: { ...currentPlane.startPosition, x: clampedX, y: clampedY },
        history: [{ x: clampedX, y: clampedY, z: currentPlane.position.z }],
      });
    } else if (dragMode === 'heading') {
      const pos = nmToCanvas(currentPlane.position.x, currentPlane.position.y, canvas.width, canvas.height);
      const angleRad = Math.atan2(cy - pos.cy, cx - pos.cx);
      let angleDeg = Math.round((angleRad * 180) / Math.PI + 90);
      if (angleDeg < 0) angleDeg += 360;
      angleDeg = angleDeg % 360;

      updateFn({
        heading: angleDeg,
        initialHeading: angleDeg,
      });
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    setDragMode(null);
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const currentPlane = selectedPlane === 'A' ? planeA : planeB;
  const currentUpdateFn = selectedPlane === 'A' ? onChangePlaneA : onChangePlaneB;

  return (
    <div className={`bg-black rounded-xl p-4 flex flex-col h-full shadow-2xl transition-all duration-300 ${
      tcasStatus === 'RESOLUTION_ADVISORY'
        ? 'border-2 border-red-500 shadow-[0_0_35px_rgba(239,68,68,0.3)]'
        : 'border border-blue-900/60'
    }`}>
      {/* Header & Scenario Selection */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3 border-b border-blue-900/40 pb-3">
        <div>
          <div className="text-xs font-mono uppercase tracking-wider text-blue-400 font-bold">
            Tactical Airspace Map
          </div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <span>2D Airspace &amp; Route Configurator</span>
            {isSimulating && (
              <span className="text-xs font-mono text-blue-300 bg-blue-950 border border-blue-600 px-2 py-0.5 rounded font-bold">
                SIMULATION LIVE
              </span>
            )}
            {tcasStatus === 'RESOLUTION_ADVISORY' && (
              <span className="text-xs font-mono text-red-300 bg-red-950 border border-red-500 px-2 py-0.5 rounded font-bold animate-pulse">
                ⚠ RA ALERT
              </span>
            )}
          </h2>
        </div>

        {/* Preset Selector */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-300 font-mono font-bold">Scenario:</span>
          <select
            value={activeScenarioId}
            onChange={(e) => {
              const sc = SCENARIO_PRESETS.find((s) => s.id === e.target.value);
              if (sc) onLoadScenario(sc);
            }}
            disabled={isSimulating}
            className="bg-neutral-950 border border-neutral-700 text-xs font-semibold text-white rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          >
            {SCENARIO_PRESETS.map((sc) => (
              <option key={sc.id} value={sc.id}>
                {sc.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Main Interactive Radar Area */}
      <div className="relative flex-1 min-h-[350px] flex items-center justify-center bg-black rounded-xl overflow-hidden border border-blue-950">
        <canvas
          ref={canvasRef}
          width={580}
          height={580}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className={`w-full max-w-[520px] aspect-square ${
            isSimulating ? 'cursor-default' : 'cursor-crosshair'
          } select-none touch-none`}
        />

        {/* Floating Instruction / Status Overlay */}
        <div className="absolute top-2.5 left-2.5 bg-black/90 backdrop-blur-md border border-blue-900/60 rounded-lg px-3 py-1.5 text-xs font-mono text-white pointer-events-none shadow-lg">
          {!isSimulating ? (
            <div>
              <span className="text-blue-400 font-bold">● Drag plane</span> to position ·{' '}
              <span className="text-white font-bold">● Drag arrow</span> for heading
            </div>
          ) : (
            <div className="flex items-center gap-2 text-blue-300 font-bold">
              <span className="w-2 h-2 rounded-full bg-blue-500 animate-ping" />
              Tracking ADS-B live transponders
            </div>
          )}
        </div>

        {/* 12 NM Emergency Prompt Range callout tag */}
        <div className="absolute top-2.5 right-2.5 bg-blue-950/90 border border-blue-600/80 rounded-lg px-2.5 py-1 text-[11px] font-mono text-blue-200 pointer-events-none shadow">
          12 NM Emergency Prompt Active
        </div>

        {/* Plane Selector Tabs on Radar */}
        <div className="absolute bottom-2.5 left-2.5 flex items-center gap-1.5 bg-black/90 backdrop-blur-md p-1.5 rounded-xl border border-blue-900/60 shadow-xl">
          <button
            onClick={() => setSelectedPlane('A')}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
              selectedPlane === 'A'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <span className="w-2.5 h-2.5 rounded-full bg-blue-400" />
            Flight A ({planeA.callsign})
          </button>
          <button
            onClick={() => setSelectedPlane('B')}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
              selectedPlane === 'B'
                ? 'bg-white text-black font-black shadow-md'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <span className="w-2.5 h-2.5 rounded-full bg-white border border-black" />
            Flight B ({planeB.callsign})
          </button>
        </div>
      </div>

      {/* Selected Aircraft Control Sliders */}
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 bg-neutral-950 rounded-xl border border-neutral-800 text-xs">
        {/* Heading */}
        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between text-slate-300 font-mono font-bold">
            <span>Heading:</span>
            <span className="text-blue-400">{Math.round(currentPlane.heading)}°</span>
          </div>
          <input
            type="range"
            min="0"
            max="359"
            value={Math.round(currentPlane.heading)}
            disabled={isSimulating}
            onChange={(e) => {
              const val = Number(e.target.value);
              currentUpdateFn({ heading: val, initialHeading: val });
            }}
            className="accent-blue-500 h-2 bg-neutral-800 rounded-lg cursor-pointer disabled:opacity-40"
          />
        </div>

        {/* Altitude */}
        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between text-slate-300 font-mono font-bold">
            <span>Altitude:</span>
            <span className="text-blue-400">{currentPlane.position.z.toLocaleString()} FT</span>
          </div>
          <input
            type="range"
            min="5000"
            max="41000"
            step="500"
            value={currentPlane.position.z}
            disabled={isSimulating}
            onChange={(e) => {
              const val = Number(e.target.value);
              currentUpdateFn({
                position: { ...currentPlane.position, z: val },
                startPosition: { ...currentPlane.startPosition, z: val },
              });
            }}
            className="accent-blue-500 h-2 bg-neutral-800 rounded-lg cursor-pointer disabled:opacity-40"
          />
        </div>

        {/* Speed */}
        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between text-slate-300 font-mono font-bold">
            <span>Ground Speed:</span>
            <span className="text-blue-400">{Math.round(currentPlane.speed)} KT</span>
          </div>
          <input
            type="range"
            min="200"
            max="580"
            step="10"
            value={Math.round(currentPlane.speed)}
            disabled={isSimulating}
            onChange={(e) => {
              const val = Number(e.target.value);
              currentUpdateFn({ speed: val, initialSpeed: val });
            }}
            className="accent-blue-500 h-2 bg-neutral-800 rounded-lg cursor-pointer disabled:opacity-40"
          />
        </div>

        {/* Vertical Speed */}
        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between text-slate-300 font-mono font-bold">
            <span>Vertical Rate:</span>
            <span
              className={
                currentPlane.verticalSpeed > 0
                  ? 'text-blue-400 font-bold'
                  : currentPlane.verticalSpeed < 0
                  ? 'text-red-400 font-bold'
                  : 'text-white font-bold'
              }
            >
              {currentPlane.verticalSpeed > 0 ? '+' : ''}
              {Math.round(currentPlane.verticalSpeed)} FPM
            </span>
          </div>
          <input
            type="range"
            min="-3000"
            max="3000"
            step="200"
            value={Math.round(currentPlane.verticalSpeed)}
            disabled={isSimulating}
            onChange={(e) => {
              const val = Number(e.target.value);
              currentUpdateFn({ verticalSpeed: val, initialVerticalSpeed: val });
            }}
            className="accent-blue-500 h-2 bg-neutral-800 rounded-lg cursor-pointer disabled:opacity-40"
          />
        </div>
      </div>
    </div>
  );
};
