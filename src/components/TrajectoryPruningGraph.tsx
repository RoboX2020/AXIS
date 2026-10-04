import React, { useState, useMemo } from 'react';
import { AircraftState, CandidateTrajectory, ConflictAnalysis, Vector3D } from '../lib/types';
import {
  Layers,
  ZoomIn,
  ZoomOut,
  Crosshair,
  Filter,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from 'lucide-react';

interface Props {
  planeA: AircraftState;
  planeB: AircraftState;
  conflict: ConflictAnalysis;
  candidates: CandidateTrajectory[];
  isSimulating: boolean;
}

export const TrajectoryPruningGraph: React.FC<Props> = ({
  planeA,
  planeB,
  conflict,
  candidates,
  isSimulating: _isSimulating,
}) => {
  const [viewMode, setViewMode] = useState<'LATERAL' | 'VERTICAL' | 'DUAL'>('LATERAL');
  const [showEliminated, setShowEliminated] = useState<boolean>(true);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [zoomScale, setZoomScale] = useState<number>(1.0);
  const [centerOnPlaneA, setCenterOnPlaneA] = useState<boolean>(true);

  // SVG coordinate transformation calculations
  const width = 800;
  const height = 480;
  const cx = width / 2;
  const cy = height / 2;
  const pxPerNM = 14 * zoomScale;

  const originX = centerOnPlaneA ? planeA.position.x : (planeA.position.x + planeB.position.x) / 2;
  const originY = centerOnPlaneA ? planeA.position.y : (planeA.position.y + planeB.position.y) / 2;

  const worldToSvg = (xNM: number, yNM: number) => {
    return {
      x: cx + (xNM - originX) * pxPerNM,
      y: cy - (yNM - originY) * pxPerNM,
    };
  };

  const posA = worldToSvg(planeA.position.x, planeA.position.y);
  const posB = worldToSvg(planeB.position.x, planeB.position.y);

  // Filter breakdown counts
  const viableCount = candidates.filter((c) => c.status === 'VIABLE' || c.status === 'SELECTED').length;
  const eliminatedCount = candidates.filter((c) => c.status === 'ELIMINATED').length;
  const selectedCandidate = candidates.find((c) => c.status === 'SELECTED');

  const activeCandidate = useMemo(() => {
    if (selectedCandidateId) {
      return candidates.find((c) => c.id === selectedCandidateId) || null;
    }
    return selectedCandidate || null;
  }, [selectedCandidateId, candidates, selectedCandidate]);

  const rangeRings = [2, 5, 10, 12];

  // Helper to construct SVG path d string
  const buildSvgPath = (pts: Array<Vector3D>) => {
    if (pts.length === 0) return '';
    return pts
      .map((p, idx) => {
        const pt = worldToSvg(p.x, p.y);
        return `${idx === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
      })
      .join(' ');
  };

  const buildVerticalPath = (pts: Array<Vector3D & { timeSec: number }>) => {
    if (pts.length === 0) return '';
    return pts
      .map((p, idx) => {
        const x = 60 + (p.timeSec / 75) * 700;
        // Calibrated centered around 14,000 FT (Span: 6,000 FT to 22,000 FT)
        const y = 220 - ((p.z - 6000) / 16000) * 200;
        return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
  };

  const isEmergencyRA = (conflict.tcasStatus === 'RESOLUTION_ADVISORY' || conflict.isWithinEmergencyRange) && !planeA.hasResolved;
  const isTA = conflict.tcasStatus === 'TRAFFIC_ADVISORY' && !planeA.hasResolved;

  return (
    <div className={`bg-black border-2 rounded-2xl overflow-hidden shadow-2xl flex flex-col font-sans backdrop-blur-md transition-all duration-300 ${
      isEmergencyRA
        ? 'border-red-500 ring-4 ring-red-500/70 shadow-[0_0_55px_rgba(239,68,68,0.55)] animate-pulse'
        : isTA
        ? 'border-blue-400 ring-2 ring-blue-500/40 shadow-[0_0_30px_rgba(59,130,246,0.35)]'
        : 'border-blue-900/60 shadow-blue-950/40'
    }`}>
      {/* 2D GRAPH DEDICATED FLASHING ALERT SYSTEM */}
      {isEmergencyRA && (
        <div className="bg-red-950/95 border-b-2 border-red-500 px-5 py-3 flex flex-wrap items-center justify-between gap-3 text-xs font-mono text-white animate-pulse shadow-2xl">
          <div className="flex items-center gap-3">
            <span className="w-3.5 h-3.5 rounded-full bg-red-500 animate-ping inline-block shadow-lg" />
            <span className="text-white font-black tracking-wider text-sm uppercase">
              ⚠ TCAS RESOLUTION ADVISORY — CLASH IMMINENT (≤ 12.0 NM ENVELOPE)
            </span>
            <span className="bg-red-900 border border-red-400 text-white font-extrabold px-2.5 py-0.5 rounded text-xs shadow">
              DIST: {conflict.distanceNM.toFixed(2)} NM · CLOSURE: {Math.round(conflict.rangeRateKnots)} KT · TTI: {Math.round(conflict.timeToCPASec)}s
            </span>
          </div>
          <div className="text-red-200 font-bold text-xs bg-red-900/60 px-3 py-1 rounded border border-red-500/50">
            PRUNING FILTER ACTIVE: RED PATHS ELIMINATED · SELECT RESOLUTION TO EXECUTE BOLD PATH
          </div>
        </div>
      )}

      {isTA && (
        <div className="bg-blue-950/90 border-b border-blue-500 px-5 py-2.5 flex items-center justify-between gap-3 text-xs font-mono text-white shadow-xl">
          <div className="flex items-center gap-2.5 font-bold">
            <span className="w-3 h-3 rounded-full bg-blue-400 animate-pulse inline-block" />
            <span className="text-blue-300 font-black tracking-wider uppercase">
              TRAFFIC ADVISORY — INTRUDER WITHIN SURVEILLANCE ENVELOPE
            </span>
            <span className="bg-blue-900/80 border border-blue-500/60 text-white px-2 py-0.5 rounded text-xs">
              RANGE: {conflict.distanceNM.toFixed(2)} NM | CLOSURE: {Math.round(conflict.rangeRateKnots)} KT
            </span>
          </div>
          <span className="text-blue-200 font-semibold text-[11px] hidden md:inline">
            MONITORING CONFLICT TRAJECTORIES · CANDIDATES EVALUATING
          </span>
        </div>
      )}

      {/* Scope Header */}
      <div className="bg-black/95 border-b border-blue-900/40 p-3.5 px-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-950 border border-blue-500/60 flex items-center justify-center text-blue-400 shadow-lg shadow-blue-950/50">
            <Layers className="w-4 h-4 stroke-[2.5]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-black tracking-wider text-white uppercase font-display">
                AXIS 2D Trajectory Predictor &amp; Algorithmic Pruning Scope
              </h2>
              <span className="bg-blue-900/60 text-blue-300 text-[10px] font-mono font-bold px-2 py-0.5 rounded border border-blue-700/60 uppercase">
                DO-260B / TCAS II v7.1
              </span>
            </div>
            <p className="text-xs text-slate-300 font-mono">
              Evaluates multi-hypothesis trajectory vectors at every moment · Filters unsafe paths · Locks final bold trajectory upon decision
            </p>
          </div>
        </div>

        {/* View mode buttons & toggles */}
        <div className="flex items-center gap-2">
          {/* View Mode Toggle */}
          <div className="bg-neutral-900 border border-neutral-700 rounded-lg p-0.5 flex text-xs font-mono font-bold">
            <button
              onClick={() => setViewMode('LATERAL')}
              className={`px-2.5 py-1 rounded transition-colors ${
                viewMode === 'LATERAL'
                  ? 'bg-blue-600 text-white font-black shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Lateral (X-Y)
            </button>
            <button
              onClick={() => setViewMode('VERTICAL')}
              className={`px-2.5 py-1 rounded transition-colors ${
                viewMode === 'VERTICAL'
                  ? 'bg-blue-600 text-white font-black shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Profile (Z vs T)
            </button>
            <button
              onClick={() => setViewMode('DUAL')}
              className={`px-2.5 py-1 rounded transition-colors ${
                viewMode === 'DUAL'
                  ? 'bg-blue-600 text-white font-black shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Dual Split
            </button>
          </div>

          {/* Toggle Eliminated Paths */}
          <button
            onClick={() => setShowEliminated((prev) => !prev)}
            className={`px-2.5 py-1 text-xs font-mono font-bold rounded-lg border flex items-center gap-1.5 transition-colors ${
              showEliminated
                ? 'bg-red-950/60 border-red-600/70 text-red-300'
                : 'bg-neutral-800 border-neutral-700 text-slate-400 hover:text-white'
            }`}
            title="Toggle display of pruned/eliminated trajectory lines"
          >
            <Filter className="w-3.5 h-3.5" />
            <span>{showEliminated ? 'Show Pruned (ON)' : 'Pruned (Hidden)'}</span>
          </button>

          {/* Zoom controls */}
          <div className="flex items-center gap-1 bg-neutral-900 border border-neutral-700 rounded-lg p-0.5">
            <button
              onClick={() => setZoomScale((z) => Math.min(2.5, z + 0.2))}
              className="p-1 text-slate-400 hover:text-white rounded hover:bg-neutral-800"
              title="Zoom In"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setZoomScale((z) => Math.max(0.6, z - 0.2))}
              className="p-1 text-slate-400 hover:text-white rounded hover:bg-neutral-800"
              title="Zoom Out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setCenterOnPlaneA((c) => !c)}
              className={`p-1 rounded ${
                centerOnPlaneA ? 'text-blue-400 bg-blue-950 border border-blue-600' : 'text-slate-400 hover:text-white'
              }`}
              title="Center on Flight Alpha"
            >
              <Crosshair className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Live Pruning Status HUD Banner */}
      <div className="bg-slate-950 border-b border-slate-800/80 px-5 py-2.5 flex flex-wrap items-center justify-between gap-4 text-xs font-mono">
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-2">
            <span className="text-slate-400">Hypotheses Evaluated:</span>
            <span className="font-bold text-white bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
              {candidates.length} Candidate Vectors
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-emerald-400 font-bold flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Viable: {viableCount}
            </span>
            <span className="text-slate-600">|</span>
            <span className="text-rose-400 font-bold flex items-center gap-1">
              <XCircle className="w-3.5 h-3.5" />
              Eliminated: {eliminatedCount}
            </span>
          </div>
        </div>

        {/* Status of Prompt & Resolution */}
        <div>
          {planeA.hasResolved ? (
            <span className="bg-emerald-950 border border-emerald-500 text-emerald-300 font-black px-3 py-1 rounded-md flex items-center gap-1.5 animate-pulse shadow-md">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              FINAL TRAJECTORY LOCKED &amp; EXECUTING (SOLID BOLD LINE)
            </span>
          ) : conflict.isWithinEmergencyRange || conflict.tcasStatus === 'RESOLUTION_ADVISORY' ? (
            <span className="bg-rose-950 border border-rose-500 text-rose-300 font-black px-3 py-1 rounded-md flex items-center gap-1.5 animate-pulse shadow-md">
              <AlertTriangle className="w-4 h-4 text-rose-400" />
              DECISION ENVELOPE ACTIVE · AWAITING PILOT TRAJECTORY PROMPT SELECTION
            </span>
          ) : (
            <span className="bg-cyan-950 border border-cyan-700/60 text-cyan-300 font-semibold px-2.5 py-1 rounded-md">
              FILTER ACTIVE: Continually scanning 11 forward trajectories at 2.0s increments
            </span>
          )}
        </div>
      </div>

      {/* Main Graph Body */}
      <div className="grid grid-cols-1 xl:grid-cols-12 flex-1">
        {/* Graph Canvas / SVG Viewport */}
        <div className="xl:col-span-8 relative bg-slate-950 p-2 overflow-hidden flex flex-col items-center justify-center min-h-[460px]">
          {/* LATERAL VIEW OR DUAL VIEW */}
          {(viewMode === 'LATERAL' || viewMode === 'DUAL') && (
            <div className={`w-full relative ${viewMode === 'DUAL' ? 'h-[250px]' : 'h-[460px]'}`}>
              <svg
                viewBox={`0 0 ${width} ${height}`}
                className="w-full h-full select-none"
                style={{ background: 'radial-gradient(ellipse at center, #091322 0%, #030712 100%)' }}
              >
                <defs>
                  {/* Grid Pattern */}
                  <pattern id="tactical-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                    <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1e293b" strokeWidth="0.8" opacity="0.6" />
                  </pattern>

                  {/* Glow Filters */}
                  <filter id="glow-cyan" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="3" result="blur" />
                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                  </filter>
                  <filter id="glow-bold-active" x="-30%" y="-30%" width="160%" height="160%">
                    <feGaussianBlur stdDeviation="5" result="blur" />
                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                  </filter>

                  {/* Direction Arrow Markers */}
                  <marker id="arrow-cyan" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M 0 1 L 10 5 L 0 9 z" fill="#06b6d4" />
                  </marker>
                  <marker id="arrow-amber" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M 0 1 L 10 5 L 0 9 z" fill="#f59e0b" />
                  </marker>
                  <marker id="arrow-bold-final" viewBox="0 0 12 12" refX="6" refY="6" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                    <path d="M 0 0 L 12 6 L 0 12 z" fill="#10b981" />
                  </marker>
                </defs>

                {/* Tactical Airspace Grid */}
                <rect width={width} height={height} fill="url(#tactical-grid)" />

                {/* Range Rings around Plane A */}
                {rangeRings.map((rNM) => {
                  const radiusPx = rNM * pxPerNM;
                  const is12NM = rNM === 12;
                  return (
                    <g key={`ring-${rNM}`}>
                      <circle
                        cx={posA.x}
                        cy={posA.y}
                        r={radiusPx}
                        fill="none"
                        stroke={is12NM ? '#f43f5e' : '#334155'}
                        strokeWidth={is12NM ? 1.8 : 0.8}
                        strokeDasharray={is12NM ? '6 4' : '3 3'}
                        opacity={is12NM ? 0.85 : 0.45}
                      />
                      <text
                        x={posA.x + radiusPx + 3}
                        y={posA.y - 3}
                        fill={is12NM ? '#f43f5e' : '#64748b'}
                        fontSize="9"
                        fontFamily="monospace"
                        fontWeight={is12NM ? 'bold' : 'normal'}
                      >
                        {rNM} NM {is12NM ? 'EMERGENCY PROMPT ENVELOPE' : ''}
                      </text>
                    </g>
                  );
                })}

                {/* 1.5 NM Conflict Protection Zone around Plane B */}
                <circle
                  cx={posB.x}
                  cy={posB.y}
                  r={1.5 * pxPerNM}
                  fill="#ef4444"
                  fillOpacity="0.12"
                  stroke="#ef4444"
                  strokeWidth="1.5"
                  strokeDasharray="4 2"
                />

                {/* Plane A History Track */}
                {planeA.history.length > 1 && (
                  <path
                    d={buildSvgPath(planeA.history)}
                    fill="none"
                    stroke="#0891b2"
                    strokeWidth="1.5"
                    strokeDasharray="2 3"
                    opacity="0.5"
                  />
                )}

                {/* Plane B History Track */}
                {planeB.history.length > 1 && (
                  <path
                    d={buildSvgPath(planeB.history)}
                    fill="none"
                    stroke="#d97706"
                    strokeWidth="1.5"
                    strokeDasharray="2 3"
                    opacity="0.5"
                  />
                )}

                {/* Plane B Forward Extrapolated Path */}
                {planeB.predictedTrajectory.length > 1 && (
                  <path
                    d={buildSvgPath(planeB.predictedTrajectory)}
                    fill="none"
                    stroke="#f59e0b"
                    strokeWidth="2.2"
                    strokeDasharray="5 4"
                    opacity="0.8"
                    markerEnd="url(#arrow-amber)"
                  />
                )}

                {/* CANDIDATE TRAJECTORIES: ELIMINATED PATHS (DOTTED RED) */}
                {showEliminated &&
                  candidates
                    .filter((c) => c.status === 'ELIMINATED')
                    .map((cand) => {
                      const vIdx = Math.min(
                        cand.points.length - 1,
                        Math.max(1, Math.round(cand.timeToMinSepSec / 2))
                      );
                      const failPt = worldToSvg(cand.points[vIdx].x, cand.points[vIdx].y);
                      const isHovered = selectedCandidateId === cand.id;

                      return (
                        <g
                          key={cand.id}
                          className="cursor-pointer transition-opacity"
                          onClick={() => setSelectedCandidateId(cand.id)}
                          opacity={isHovered ? 1.0 : planeA.hasResolved ? 0.35 : 0.75}
                        >
                          <path
                            d={buildSvgPath(cand.points)}
                            fill="none"
                            stroke="#f43f5e"
                            strokeWidth={isHovered ? 2.5 : 1.6}
                            strokeDasharray="4 4"
                          />
                          <g transform={`translate(${failPt.x}, ${failPt.y})`}>
                            <circle r={isHovered ? 8 : 6} fill="#881337" stroke="#f43f5e" strokeWidth="1.5" />
                            <path
                              d="M -3.5 -3.5 L 3.5 3.5 M 3.5 -3.5 L -3.5 3.5"
                              stroke="#ffffff"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                            />
                          </g>
                          {isHovered && (
                            <g transform={`translate(${failPt.x + 10}, ${failPt.y - 10})`}>
                              <rect
                                x="0"
                                y="-14"
                                width="220"
                                height="28"
                                rx="4"
                                fill="#0f172a"
                                stroke="#f43f5e"
                                strokeWidth="1.2"
                              />
                              <text x="8" y="4" fill="#fda4af" fontSize="9.5" fontFamily="monospace" fontWeight="bold">
                                {cand.eliminationReason || 'ELIMINATED BY TCAS/FLARM'}
                              </text>
                            </g>
                          )}
                        </g>
                      );
                    })}

                {/* CANDIDATE TRAJECTORIES: VIABLE PATHS (DOTTED CYAN/GREEN) */}
                {candidates
                  .filter((c) => c.status === 'VIABLE')
                  .map((cand) => {
                    const lastPt = worldToSvg(
                      cand.points[cand.points.length - 1].x,
                      cand.points[cand.points.length - 1].y
                    );
                    const isHovered = selectedCandidateId === cand.id;

                    return (
                      <g
                        key={cand.id}
                        className="cursor-pointer"
                        onClick={() => setSelectedCandidateId(cand.id)}
                        opacity={isHovered ? 1.0 : planeA.hasResolved ? 0.3 : 0.85}
                      >
                        <path
                          d={buildSvgPath(cand.points)}
                          fill="none"
                          stroke={cand.color || '#06b6d4'}
                          strokeWidth={isHovered ? 3.0 : 2.0}
                          strokeDasharray="5 4"
                          filter="url(#glow-cyan)"
                        />
                        <circle
                          cx={lastPt.x}
                          cy={lastPt.y}
                          r={isHovered ? 5 : 3.5}
                          fill={cand.color || '#06b6d4'}
                          stroke="#ffffff"
                          strokeWidth="1"
                        />
                        <text
                          x={lastPt.x + 6}
                          y={lastPt.y + 3}
                          fill="#a5f3fc"
                          fontSize="9"
                          fontFamily="monospace"
                          fontWeight="bold"
                        >
                          {cand.minDistanceNM} NM
                        </text>
                      </g>
                    );
                  })}

                {/* FINAL EXECUTED TRAJECTORY AFTER PROMPT (BOLDED SOLID LINE) */}
                {planeA.hasResolved && (
                  <g filter="url(#glow-bold-active)">
                    {planeA.decidedRoute.length > 1 && (
                      <path
                        d={buildSvgPath(planeA.decidedRoute)}
                        fill="none"
                        stroke="#10b981"
                        strokeWidth="5.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    )}

                    {planeA.predictedTrajectory.length > 1 && (
                      <path
                        d={buildSvgPath(planeA.predictedTrajectory)}
                        fill="none"
                        stroke="#10b981"
                        strokeWidth="4.5"
                        markerEnd="url(#arrow-bold-final)"
                      />
                    )}

                    {planeA.predictedTrajectory.slice(0, 8).map((p, idx) => {
                      if (idx % 2 !== 0) return null;
                      const pt = worldToSvg(p.x, p.y);
                      return (
                        <circle
                          key={`bold-bead-${idx}`}
                          cx={pt.x}
                          cy={pt.y}
                          r="4"
                          fill="#ffffff"
                          stroke="#059669"
                          strokeWidth="2"
                        />
                      );
                    })}

                    {planeA.predictedTrajectory.length > 4 && (
                      <g
                        transform={`translate(${worldToSvg(planeA.predictedTrajectory[4].x, planeA.predictedTrajectory[4].y).x + 12}, ${
                          worldToSvg(planeA.predictedTrajectory[4].x, planeA.predictedTrajectory[4].y).y - 12
                        })`}
                      >
                        <rect
                          x="0"
                          y="-16"
                          width="240"
                          height="24"
                          rx="4"
                          fill="#064e3b"
                          stroke="#34d399"
                          strokeWidth="1.5"
                          className="animate-pulse"
                        />
                        <text x="8" y="1" fill="#ecfdf5" fontSize="10" fontFamily="monospace" fontWeight="900">
                          FINAL EXECUTED TRAJECTORY
                        </text>
                      </g>
                    )}
                  </g>
                )}

                {/* Plane A Icon & Callout */}
                <g transform={`translate(${posA.x}, ${posA.y})`}>
                  <g transform={`rotate(${planeA.heading})`}>
                    <path
                      d="M 0 -14 L 11 10 L 0 6 L -11 10 Z"
                      fill="#06b6d4"
                      stroke="#ffffff"
                      strokeWidth="1.8"
                    />
                  </g>
                  <circle r="4" fill="#ffffff" />
                  <g transform="translate(14, -14)">
                    <rect x="0" y="0" width="105" height="34" rx="4" fill="#082f49" stroke="#0ea5e9" strokeWidth="1" opacity="0.9" />
                    <text x="6" y="14" fill="#38bdf8" fontSize="10" fontFamily="monospace" fontWeight="bold">
                      {planeA.callsign}
                    </text>
                    <text x="6" y="27" fill="#bae6fd" fontSize="9" fontFamily="monospace">
                      FL{Math.round(planeA.position.z / 100)} · {Math.round(planeA.speed)}KT
                    </text>
                  </g>
                </g>

                {/* Plane B Icon & Callout */}
                <g transform={`translate(${posB.x}, ${posB.y})`}>
                  <g transform={`rotate(${planeB.heading})`}>
                    <path
                      d="M 0 -14 L 11 10 L 0 6 L -11 10 Z"
                      fill="#f59e0b"
                      stroke="#ffffff"
                      strokeWidth="1.8"
                    />
                  </g>
                  <circle r="4" fill="#ffffff" />
                  <g transform="translate(14, -14)">
                    <rect x="0" y="0" width="105" height="34" rx="4" fill="#451a03" stroke="#f59e0b" strokeWidth="1" opacity="0.9" />
                    <text x="6" y="14" fill="#fbbf24" fontSize="10" fontFamily="monospace" fontWeight="bold">
                      {planeB.callsign}
                    </text>
                    <text x="6" y="27" fill="#fef3c7" fontSize="9" fontFamily="monospace">
                      FL{Math.round(planeB.position.z / 100)} · {Math.round(planeB.speed)}KT
                    </text>
                  </g>
                </g>
              </svg>
            </div>
          )}

          {/* VERTICAL PROFILE VIEW (Altitude Z vs Time/Distance) */}
          {(viewMode === 'VERTICAL' || viewMode === 'DUAL') && (
            <div className={`w-full relative ${viewMode === 'DUAL' ? 'h-[210px] border-t border-slate-800' : 'h-[460px]'}`}>
              <div className="absolute top-2 left-3 z-10 text-[10px] font-mono text-blue-300 font-bold bg-black/90 px-2 py-0.5 rounded border border-blue-800">
                VERTICAL ALTITUDE PROFILE (DEFAULT FL140 / 14,000 FT CENTERED)
              </div>
              <svg
                viewBox="0 0 800 240"
                className="w-full h-full select-none"
                style={{ background: '#000000' }}
              >
                {/* Horizontal Altitude Grid Lines (Centered at 14,000 FT) */}
                {[8000, 11000, 14000, 17000, 20000].map((altFt) => {
                  const y = 220 - ((altFt - 6000) / 16000) * 200;
                  const isDefaultAlt = altFt === 14000;
                  return (
                    <g key={`alt-grid-${altFt}`}>
                      <line
                        x1="50"
                        y1={y}
                        x2="780"
                        y2={y}
                        stroke={isDefaultAlt ? '#3b82f6' : '#1e293b'}
                        strokeWidth={isDefaultAlt ? 1.5 : 0.8}
                        strokeDasharray={isDefaultAlt ? undefined : '3 3'}
                      />
                      <text
                        x="45"
                        y={y + 3}
                        textAnchor="end"
                        fill={isDefaultAlt ? '#60a5fa' : '#64748b'}
                        fontSize="9"
                        fontFamily="monospace"
                        fontWeight={isDefaultAlt ? 'bold' : 'normal'}
                      >
                        FL{altFt / 100} {isDefaultAlt ? '· FL140 (14,000 FT)' : ''}
                      </text>
                    </g>
                  );
                })}

                {/* Time Axis Grid */}
                {[0, 15, 30, 45, 60, 75].map((sec) => {
                  const x = 60 + (sec / 75) * 700;
                  return (
                    <g key={`time-grid-${sec}`}>
                      <line x1={x} y1="20" x2={x} y2="220" stroke="#1e293b" strokeWidth="0.8" />
                      <text x={x} y="235" textAnchor="middle" fill="#64748b" fontSize="9" fontFamily="monospace">
                        T+{sec}s
                      </text>
                    </g>
                  );
                })}

                {/* Candidate Trajectories in Vertical Profile */}
                {candidates.map((cand) => {
                  const isElim = cand.status === 'ELIMINATED';
                  const isSel = cand.status === 'SELECTED';
                  if (isElim && !showEliminated && !isSel) return null;

                  return (
                    <path
                      key={`vert-path-${cand.id}`}
                      d={buildVerticalPath(cand.points)}
                      fill="none"
                      stroke={isSel ? '#ffffff' : isElim ? '#ef4444' : '#60a5fa'}
                      strokeWidth={isSel ? 5.0 : isElim ? 1.5 : 2.0}
                      strokeDasharray={isSel ? undefined : isElim ? '4 4' : '5 3'}
                      opacity={isSel ? 1.0 : planeA.hasResolved ? 0.35 : 0.85}
                    />
                  );
                })}

                {/* Intruder Plane B Vertical Path */}
                {planeB.predictedTrajectory.length > 1 && (
                  <path
                    d={buildVerticalPath(planeB.predictedTrajectory.slice(0, 40))}
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth="2.5"
                    strokeDasharray="4 3"
                    opacity={0.8}
                  />
                )}

                {/* Ownship Initial Point */}
                <circle
                  cx="60"
                  cy={220 - ((planeA.position.z - 6000) / 16000) * 200}
                  r="6"
                  fill="#3b82f6"
                  stroke="#ffffff"
                  strokeWidth="2"
                />

                {/* Intruder Initial Point */}
                <circle
                  cx="60"
                  cy={220 - ((planeB.position.z - 6000) / 16000) * 200}
                  r="6"
                  fill="#ffffff"
                  stroke="#3b82f6"
                  strokeWidth="2"
                />
              </svg>
            </div>
          )}

          {/* Canvas Floating Legend */}
          <div className="absolute bottom-3 left-3 bg-black/90 border border-blue-900/60 rounded-xl p-2.5 px-3 flex flex-wrap items-center gap-4 text-[11px] font-mono backdrop-blur-md shadow-2xl pointer-events-none">
            <div className="flex items-center gap-1.5">
              <span className="w-5 h-0.5 border-t-2 border-dashed border-blue-400" />
              <span className="text-blue-300">Viable Dotted Path</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-5 h-0.5 border-t-2 border-dashed border-red-500" />
              <span className="text-red-400">Eliminated / Pruned Path</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-5 h-1 bg-white rounded-full shadow-[0_0_8px_#ffffff]" />
              <span className="text-white font-bold">Bold Executed Trajectory</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-4 h-0.5 border-t-2 border-dashed border-white" />
              <span className="text-white">{planeB.callsign} Projected Path</span>
            </div>
          </div>
        </div>

        {/* Pruning Algorithmic Feed & Hypotheses Drawer */}
        <div className="xl:col-span-4 bg-black border-t xl:border-t-0 xl:border-l border-blue-900/60 p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black uppercase text-white tracking-wider flex items-center gap-2">
              <Filter className="w-3.5 h-3.5 text-blue-400" />
              <span>Algorithmic Pruning Table</span>
            </h3>
            <span className="text-[11px] font-mono text-slate-300">
              <strong className="text-blue-400">{viableCount}</strong> Safe / <strong className="text-red-400">{eliminatedCount}</strong> Pruned
            </span>
          </div>

          {/* Active / Inspected Candidate Detail Box */}
          {activeCandidate && (
            <div
              className={`p-3 rounded-xl border text-xs font-mono transition-all ${
                activeCandidate.status === 'SELECTED'
                  ? 'bg-emerald-950/70 border-emerald-500 text-emerald-200'
                  : activeCandidate.status === 'ELIMINATED'
                  ? 'bg-rose-950/60 border-rose-600/80 text-rose-200'
                  : 'bg-cyan-950/60 border-cyan-500/70 text-cyan-200'
              }`}
            >
              <div className="flex items-center justify-between font-bold text-white mb-1">
                <span>{activeCandidate.name}</span>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded font-black uppercase ${
                    activeCandidate.status === 'SELECTED'
                      ? 'bg-emerald-500 text-slate-950'
                      : activeCandidate.status === 'ELIMINATED'
                      ? 'bg-rose-600 text-white'
                      : 'bg-cyan-500 text-slate-950'
                  }`}
                >
                  {activeCandidate.status === 'SELECTED'
                    ? 'FINAL EXECUTED PATH'
                    : activeCandidate.status}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px] mt-2 pt-2 border-t border-white/10">
                <div>
                  <span className="text-slate-400">Min Separation:</span>{' '}
                  <strong className="text-white">{activeCandidate.minDistanceNM} NM</strong>
                </div>
                <div>
                  <span className="text-slate-400">Vert Clearance:</span>{' '}
                  <strong className="text-white">{activeCandidate.minVerticalSepFt} FT</strong>
                </div>
                <div>
                  <span className="text-slate-400">Time to CPA:</span>{' '}
                  <strong className="text-white">T+{activeCandidate.timeToMinSepSec}s</strong>
                </div>
                <div>
                  <span className="text-slate-400">Safety Margin:</span>{' '}
                  <strong className="text-white">{activeCandidate.safetyScore}%</strong>
                </div>
              </div>

              {activeCandidate.eliminationReason && (
                <div className="mt-2 text-[11px] text-rose-300 bg-rose-900/40 p-2 rounded border border-rose-700/60">
                  <strong>Elimination Reason:</strong> {activeCandidate.eliminationReason}
                </div>
              )}
            </div>
          )}

          {/* List of Candidate Trajectories */}
          <div className="flex-1 overflow-y-auto max-h-[320px] space-y-1.5 pr-1 scrollbar-thin">
            {candidates.map((cand) => {
              const isSelected = cand.status === 'SELECTED';
              const isEliminated = cand.status === 'ELIMINATED';

              return (
                <div
                  key={cand.id}
                  onClick={() => setSelectedCandidateId(cand.id)}
                  className={`p-2.5 rounded-lg border text-xs font-mono cursor-pointer transition-all flex items-center justify-between ${
                    isSelected
                      ? 'bg-emerald-950 border-emerald-400 text-emerald-200 shadow-md ring-1 ring-emerald-400'
                      : selectedCandidateId === cand.id
                      ? 'bg-slate-800 border-cyan-400 text-white'
                      : isEliminated
                      ? 'bg-slate-900/80 border-slate-800 text-slate-400 hover:border-rose-700/60'
                      : 'bg-slate-900/80 border-slate-800 text-slate-200 hover:border-cyan-600/60'
                  }`}
                >
                  <div className="flex items-center gap-2 overflow-hidden">
                    <span
                      className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                        isSelected
                          ? 'bg-emerald-400 shadow-[0_0_6px_#10b981]'
                          : isEliminated
                          ? 'bg-rose-500'
                          : 'bg-cyan-400'
                      }`}
                    />
                    <div className="truncate">
                      <div className="font-bold truncate text-[11px]">{cand.name}</div>
                      <div className="text-[10px] text-slate-400">
                        {isEliminated ? (
                          <span className="text-rose-400 font-semibold">{cand.filterStage || 'PRUNED'}</span>
                        ) : (
                          <span>CPA {cand.minDistanceNM} NM · {cand.minVerticalSepFt} FT</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <span
                    className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded shrink-0 ${
                      isSelected
                        ? 'bg-emerald-400 text-slate-950 font-black'
                        : isEliminated
                        ? 'bg-rose-950 text-rose-300 border border-rose-800'
                        : 'bg-cyan-950 text-cyan-300 border border-cyan-800'
                    }`}
                  >
                    {isSelected ? 'BOLD FINAL' : isEliminated ? 'PRUNED' : 'VIABLE'}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Filtering Engine Summary */}
          <div className="bg-slate-900/90 rounded-xl p-2.5 border border-slate-800 text-[10px] font-mono text-slate-400 space-y-1">
            <div className="text-slate-300 font-bold">ACTIVE FILTER ENGINE (4-STAGE PIPELINE):</div>
            <div>1. Proximity DMOD: Reject if horizontal dist ≤ 1.4 NM &amp; ΔZ ≤ 750 FT</div>
            <div>2. Imminent FLARM Envelope: Reject if dist ≤ 0.65 NM</div>
            <div>3. TCAS Modified Tau: Filter if Tau ≤ 25s converging</div>
            <div>4. Vertical ZTHR: Filter if vertical gap &lt; 500 FT near CPA</div>
          </div>
        </div>
      </div>
    </div>
  );
};
