import React from 'react';
import { Play, Pause, RotateCcw, FastForward, Volume2, VolumeX, ShieldAlert, Sparkles, AlertOctagon } from 'lucide-react';
import { EMERGENCY_PROMPT_RANGE_NM } from '../lib/algorithms';

interface Props {
  isSimulating: boolean;
  onToggleSimulate: () => void;
  onStepForward: () => void;
  onReset: () => void;
  simSpeed: number;
  onChangeSpeed: (speed: number) => void;
  simTimeSec: number;
  autoPauseOnRA: boolean;
  onToggleAutoPause: () => void;
  hasCollisionRisk: boolean;
  onOpenDecisionPrompt: () => void;
  hasResolved: boolean;
  isAudioMuted: boolean;
  onToggleMute: () => void;
  currentDistanceNM: number;
}

export const SimulationControls: React.FC<Props> = ({
  isSimulating,
  onToggleSimulate,
  onStepForward,
  onReset,
  simSpeed,
  onChangeSpeed,
  simTimeSec,
  autoPauseOnRA,
  onToggleAutoPause,
  hasCollisionRisk,
  onOpenDecisionPrompt,
  hasResolved,
  isAudioMuted,
  onToggleMute,
  currentDistanceNM,
}) => {
  const isInside12NM = currentDistanceNM <= EMERGENCY_PROMPT_RANGE_NM;

  return (
    <div className="bg-black border border-blue-900/60 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3 shadow-2xl">
      {/* Primary Play/Pause/Reset Group */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={onToggleSimulate}
          className={`px-4 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 transition-all shadow-lg ${
            isSimulating
              ? 'bg-blue-600 hover:bg-blue-500 text-white ring-2 ring-blue-400/50'
              : 'bg-white hover:bg-slate-100 text-black font-black ring-2 ring-white/50'
          }`}
        >
          {isSimulating ? (
            <>
              <Pause className="w-4 h-4 fill-current stroke-[2.5]" />
              <span>PAUSE SIMULATION</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-current stroke-[2.5]" />
              <span>RUN LIVE SIMULATION</span>
            </>
          )}
        </button>

        <button
          onClick={onStepForward}
          disabled={isSimulating}
          className="px-3.5 py-2.5 bg-neutral-900 hover:bg-neutral-800 text-white disabled:opacity-40 rounded-xl text-xs font-mono font-bold transition-colors border border-neutral-700 shadow"
          title="Step +1 second forward"
        >
          Step +1s
        </button>

        <button
          onClick={onReset}
          className="px-3.5 py-2.5 bg-neutral-900 hover:bg-neutral-800 text-slate-200 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 border border-neutral-700 shadow"
          title="Reset to initial trajectory start points"
        >
          <RotateCcw className="w-4 h-4" />
          <span>Reset</span>
        </button>

        {/* Speed Selector */}
        <div className="flex items-center gap-1 p-1 bg-neutral-950 rounded-xl border border-neutral-800">
          {[0.5, 1, 2, 4].map((spd) => (
            <button
              key={spd}
              onClick={() => onChangeSpeed(spd)}
              className={`px-2.5 py-1 text-xs font-mono font-bold rounded-lg transition-all ${
                simSpeed === spd
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {spd}x
            </button>
          ))}
        </div>
      </div>

      {/* Middle: Sim Elapsed Time & 12 NM Status Badge */}
      <div className="flex items-center gap-3.5 text-xs font-mono flex-wrap">
        <div className="flex items-center gap-2 bg-neutral-950 px-3 py-1.5 rounded-lg border border-neutral-800">
          <span className="text-slate-400 font-bold">TIME:</span>
          <span className="text-blue-400 font-black tabular-nums text-sm">
            T+{simTimeSec.toFixed(1)}s
          </span>
        </div>

        {/* 12 NM Emergency Detection Range Indicator */}
        <div
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold transition-all ${
            isInside12NM
              ? 'bg-blue-950 text-blue-200 border-blue-500 shadow-md shadow-blue-950/50'
              : 'bg-neutral-950 text-slate-300 border-neutral-800'
          }`}
        >
          <ShieldAlert className="w-4 h-4 text-blue-400" />
          <span>
            {isInside12NM
              ? 'INSIDE 12 NM EMERGENCY PROMPT ZONE'
              : `RANGE: ${currentDistanceNM.toFixed(1)} NM (12 NM ALERT ZONE)`}
          </span>
        </div>

        {/* Conflict Decision Trigger Button */}
        <button
          onClick={onOpenDecisionPrompt}
          className={`px-4 py-2 rounded-xl text-xs font-black font-mono flex items-center gap-2 transition-all shadow-lg ${
            hasCollisionRisk || isInside12NM
              ? 'bg-blue-600 hover:bg-blue-500 text-white ring-2 ring-white/50'
              : hasResolved
              ? 'bg-neutral-800 text-white border border-neutral-700'
              : 'bg-neutral-900 hover:bg-neutral-800 text-white border border-neutral-700'
          }`}
        >
          <AlertOctagon className="w-4 h-4" />
          <span>
            {hasCollisionRisk || isInside12NM
              ? '⚠️ PILOT DECISION REQUIRED (12 NM)'
              : hasResolved
              ? '✓ DECISION EXECUTED (OPEN NEW)'
              : 'PROMPT PILOT DECISION'}
          </span>
        </button>
      </div>

      {/* Right: Audio & Auto-pause switches */}
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 cursor-pointer select-none text-xs font-mono font-bold text-slate-300 bg-neutral-950 px-2.5 py-1.5 rounded-lg border border-neutral-800">
          <input
            type="checkbox"
            checked={autoPauseOnRA}
            onChange={onToggleAutoPause}
            className="rounded bg-neutral-800 border-neutral-600 text-blue-500 focus:ring-0 w-4 h-4 cursor-pointer"
          />
          <span>Auto-Pause at 12 NM / RA</span>
        </label>

        <button
          onClick={onToggleMute}
          className={`p-2.5 rounded-xl border text-xs font-bold transition-all shadow ${
            !isAudioMuted
              ? 'bg-blue-950 text-blue-300 border-blue-700'
              : 'bg-neutral-900 text-slate-400 border-neutral-700'
          }`}
          title={isAudioMuted ? 'Unmute cockpit audio alerts' : 'Mute cockpit audio alerts'}
        >
          {isAudioMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
};
