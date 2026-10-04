import React from 'react';
import { ConflictAnalysis, ResolutionOption, AircraftState } from '../lib/types';
import { AlertOctagon, ArrowUpRight, CheckCircle2, ShieldAlert, Navigation, Compass, ArrowUp, ArrowDown } from 'lucide-react';

interface Props {
  isOpen: boolean;
  conflict: ConflictAnalysis;
  planeA: AircraftState;
  planeB: AircraftState;
  options: ResolutionOption[];
  onSelectOption: (option: ResolutionOption) => void;
  onDismiss: () => void;
  hasResolved: boolean;
}

export const ConflictResolutionModal: React.FC<Props> = ({
  isOpen,
  conflict,
  planeA,
  planeB,
  options,
  onSelectOption,
  onDismiss,
  hasResolved,
}) => {
  if (!isOpen) return null;

  const isRA = conflict.tcasStatus === 'RESOLUTION_ADVISORY' || conflict.isWithinEmergencyRange;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      <div
        className={`w-full max-w-2xl bg-slate-900 border rounded-2xl shadow-2xl overflow-hidden ${
          isRA ? 'border-red-500 ring-4 ring-red-500/30' : 'border-amber-500 ring-4 ring-amber-500/30'
        }`}
      >
        {/* Top Warning Header with 12 NM Emergency Prompt Mention */}
        <div
          className={`p-4 flex items-center justify-between text-white ${
            isRA
              ? 'bg-gradient-to-r from-red-600 via-rose-600 to-red-700'
              : 'bg-gradient-to-r from-amber-600 via-yellow-600 to-amber-700 text-slate-950'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl ${isRA ? 'bg-red-950/60' : 'bg-amber-950/40'}`}>
              <AlertOctagon className="w-7 h-7 animate-pulse" />
            </div>
            <div>
              <div className="text-xs font-mono font-black tracking-widest uppercase opacity-95">
                {isRA ? '12 NM EMERGENCY PROMPT DETECTION ENVELOPE' : 'FLARM / TCAS CONFLICT ENVELOPE'}
              </div>
              <h2 className="text-lg font-black tracking-tight">
                Pilot Decision Required: Conflict Predicted for {planeA.callsign}
              </h2>
            </div>
          </div>

          <div className="text-right font-mono bg-black/40 px-3 py-1.5 rounded-xl border border-white/20">
            <div className="text-[10px] font-bold opacity-80">TIME TO CPA</div>
            <div className="text-xl font-black">{conflict.timeToCPASec}s</div>
          </div>
        </div>

        {/* Conflict Parameters & Situation Summary */}
        <div className="p-4 bg-slate-950/90 border-b border-slate-800 text-xs font-mono text-slate-300 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-2.5 bg-slate-900 rounded-xl border border-red-500/40">
            <div className="text-slate-400 text-[10px] font-bold">EMERGENCY RANGE</div>
            <div className="text-base font-black text-red-400">{conflict.distanceNM.toFixed(2)} NM</div>
            <div className="text-[10px] text-red-300 font-semibold">&le; 12.0 NM Threshold</div>
          </div>

          <div className="p-2.5 bg-slate-900 rounded-xl border border-slate-800">
            <div className="text-slate-400 text-[10px] font-bold">PREDICTED CPA DIST</div>
            <div className="text-base font-black text-red-400">{conflict.distanceAtCPANM} NM</div>
            <div className="text-[10px] text-slate-400">Min safe: 1.5 NM</div>
          </div>

          <div className="p-2.5 bg-slate-900 rounded-xl border border-slate-800">
            <div className="text-slate-400 text-[10px] font-bold">VERTICAL DELTA</div>
            <div className="text-base font-black text-amber-400">{Math.round(conflict.verticalDeltaFt)} FT</div>
            <div className="text-[10px] text-slate-400">At CPA: {conflict.verticalSepAtCPAFt} FT</div>
          </div>

          <div className="p-2.5 bg-slate-900 rounded-xl border border-slate-800">
            <div className="text-slate-400 text-[10px] font-bold">MODIFIED TAU (&tau;)</div>
            <div className="text-base font-black text-cyan-400">{conflict.horizontalTauSec}s</div>
            <div className="text-[10px] text-slate-400">Closure: {Math.round(conflict.rangeRateKnots)} KT</div>
          </div>
        </div>

        {/* Prompt Statement */}
        <div className="px-5 pt-4 pb-2">
          <p className="text-xs text-slate-200 font-medium">
            Select a resolution maneuver. The system will execute coordinated TCAS / FLARM vector adjustments on the <strong className="text-cyan-300">Z-axis (one climbs, one dives)</strong>, immediately eliminate discarded candidates on the <strong className="text-cyan-400">2D Tactical Airspace Map</strong>, lock the chosen path in a <strong className="text-emerald-400 underline font-bold">bold solid line</strong>, and render the executed route in the 3D visualizer:
          </p>
        </div>

        {/* Options List */}
        <div className="p-5 pt-2 flex flex-col gap-2.5 max-h-[320px] overflow-y-auto">
          {options.map((opt) => (
            <div
              key={opt.id}
              className={`p-3.5 rounded-xl border transition-all text-left flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
                opt.isBestRecommendation
                  ? 'bg-cyan-950/40 border-cyan-400 hover:bg-cyan-950/60 shadow-lg'
                  : 'bg-slate-800/60 border-slate-700 hover:bg-slate-800 hover:border-slate-500'
              }`}
            >
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  {opt.isBestRecommendation && (
                    <span className="text-[10px] font-mono font-bold bg-cyan-500 text-slate-950 px-2 py-0.5 rounded shadow">
                      RECOMMENDED RESOLUTION
                    </span>
                  )}
                  <span className="text-[10px] font-mono text-slate-300 font-bold uppercase">
                    [{opt.category}]
                  </span>
                </div>
                <h4 className="text-sm font-bold text-white">{opt.title}</h4>
                <p className="text-xs text-slate-300 mt-0.5">{opt.description}</p>

                {/* Projected Separation metrics */}
                <div className="mt-2 flex items-center gap-3 text-[11px] font-mono text-slate-300">
                  <span>
                    Proj. Dist: <strong className="text-emerald-400 font-bold">{opt.projectedSeparationNM} NM</strong>
                  </span>
                  <span>·</span>
                  <span>
                    Proj. Alt Sep: <strong className="text-emerald-400 font-bold">{opt.projectedSeparationFt} FT</strong>
                  </span>
                </div>
              </div>

              <button
                onClick={() => onSelectOption(opt)}
                className={`px-4 py-2.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1.5 shadow-md ${
                  opt.isBestRecommendation
                    ? 'bg-cyan-400 hover:bg-cyan-300 text-slate-950 ring-2 ring-cyan-400/50'
                    : 'bg-slate-700 hover:bg-slate-600 text-white'
                }`}
              >
                <span>Execute Maneuver</span>
                <ArrowUpRight className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-slate-950 border-t border-slate-800 flex items-center justify-between">
          <div className="text-[11px] font-mono text-slate-400">
            Emergency Detection Boundary &le; 12.0 NM · ICAO Resolution Modeling
          </div>
          <button
            onClick={onDismiss}
            className="px-3.5 py-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors font-mono"
          >
            Maintain Current Course (Test Collision)
          </button>
        </div>
      </div>
    </div>
  );
};
