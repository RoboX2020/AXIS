import React from 'react';
import { BrainCircuit, CheckCircle2, Cpu, Lock, Play, RotateCcw, Scissors, Sparkles, Star, Waves } from 'lucide-react';
import {
  Consolidation,
  PathTree,
  PipelineArgs,
  PipelineStage,
  PruneResult,
  RuntimeArgs,
  RuntimeResult,
} from '../lib/trajectoryTree';

export type PanelTab = 'PREFLIGHT' | 'RUNTIME';

interface Props {
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  args: PipelineArgs;
  onArgChange: <K extends keyof PipelineArgs>(key: K, value: PipelineArgs[K]) => void;
  runtimeArgs: RuntimeArgs;
  onRuntimeArgChange: <K extends keyof RuntimeArgs>(key: K, value: RuntimeArgs[K]) => void;
  stage: PipelineStage;
  tree: PathTree;
  prune: PruneResult;
  consolidation: Consolidation;
  runtime: RuntimeResult | null;
  onGenerate: () => void;
  onPrune: () => void;
  onExclude: () => void;
  onRunNN: () => void;
  onReset: () => void;
}

interface SliderProps {
  name: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  format?: (v: number) => string;
  disabled?: boolean;
  onChange: (v: number) => void;
}

const ArgSlider: React.FC<SliderProps> = ({ name, hint, value, min, max, step, unit, format, disabled, onChange }) => (
  <label className={`block ${disabled ? 'opacity-50' : ''}`}>
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[11px] font-mono font-bold text-cyan-300">{name}</span>
      <span className="text-xs font-mono font-bold text-white bg-slate-800 border border-slate-700 px-1.5 py-0.5 rounded">
        {format ? format(value) : value}
        {unit ? <span className="text-slate-400 font-normal"> {unit}</span> : null}
      </span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full mt-1 accent-cyan-400 cursor-pointer disabled:cursor-not-allowed"
    />
    <div className="text-[10px] text-slate-500 font-mono leading-snug">{hint}</div>
  </label>
);

const STAGE_ORDER: PipelineStage[] = ['idle', 'generating', 'generated', 'pruning', 'pruned', 'consolidating', 'consolidated', 'runtime'];
const stageIndex = (s: PipelineStage) => STAGE_ORDER.indexOf(s);

export const PipelineArgumentsPanel: React.FC<Props> = ({
  tab,
  onTabChange,
  args,
  onArgChange,
  runtimeArgs,
  onRuntimeArgChange,
  stage,
  tree,
  prune,
  consolidation,
  runtime,
  onGenerate,
  onPrune,
  onExclude,
  onRunNN,
  onReset,
}) => {
  const si = stageIndex(stage);
  const animating = stage === 'generating' || stage === 'pruning' || stage === 'consolidating';
  const runtimeUnlocked = stage === 'consolidated' || stage === 'runtime';

  const steps = [
    {
      icon: Waves,
      title: 'Diffusion path generation',
      detail: si >= stageIndex('generated') ? `${tree.segCount.toLocaleString()} segments · ${tree.theoreticalPaths.toLocaleString()} paths` : `${args.pathsPerHop}^${args.numberOfHops} candidate paths`,
      done: si >= stageIndex('generated'),
      active: stage === 'generating',
    },
    {
      icon: BrainCircuit,
      title: 'LLM-based pruning',
      detail: si >= stageIndex('pruned') ? `${prune.acceptedCount.toLocaleString()} accepted · ${prune.rejectedCount.toLocaleString()} rejected` : 'Turn radius · climb · descent · airframe',
      done: si >= stageIndex('pruned'),
      active: stage === 'pruning',
    },
    {
      icon: Scissors,
      title: 'Exclude & consolidate',
      detail: si >= stageIndex('consolidated') ? `${prune.acceptedLeaves.length} green paths → ${consolidation.K} trajectories` : 'k-means merge into 10–20 trajectories',
      done: si >= stageIndex('consolidated'),
      active: stage === 'consolidating',
    },
    {
      icon: Cpu,
      title: 'Runtime NN pruning',
      detail: stage === 'runtime' && runtime ? `${runtime.survivors.length} of ${consolidation.K} kept · optimal T${runtime.optimal + 1}` : 'Classifier keeps the best 8–10',
      done: stage === 'runtime',
      active: false,
    },
  ];

  const btn = (enabled: boolean, tone: string) =>
    `w-full px-3 py-2 rounded-lg text-xs font-mono font-bold flex items-center justify-center gap-2 transition-colors border ${
      enabled ? tone : 'bg-slate-900 border-slate-800 text-slate-600 cursor-not-allowed'
    }`;

  return (
    <div className="h-full flex flex-col bg-slate-950/95 text-slate-200">
      {/* Tabs */}
      <div className="flex border-b border-slate-800 text-xs font-mono font-bold">
        <button
          onClick={() => onTabChange('PREFLIGHT')}
          className={`flex-1 px-3 py-2.5 transition-colors ${tab === 'PREFLIGHT' ? 'bg-slate-900 text-cyan-300 border-b-2 border-cyan-400' : 'text-slate-400 hover:text-slate-200'}`}
        >
          Pre-flight args
        </button>
        <button
          onClick={() => onTabChange('RUNTIME')}
          className={`flex-1 px-3 py-2.5 transition-colors flex items-center justify-center gap-1.5 ${tab === 'RUNTIME' ? 'bg-slate-900 text-yellow-300 border-b-2 border-yellow-400' : 'text-slate-400 hover:text-slate-200'}`}
        >
          {!runtimeUnlocked && <Lock className="w-3 h-3" />}
          Run-time args
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {/* Stage stepper */}
        <ol className="flex flex-col gap-1.5">
          {steps.map((s, i) => (
            <li
              key={s.title}
              className={`flex items-start gap-2.5 rounded-lg border px-2.5 py-2 ${
                s.active ? 'border-cyan-500/70 bg-cyan-950/40' : s.done ? 'border-emerald-700/60 bg-emerald-950/20' : 'border-slate-800 bg-slate-900/40'
              }`}
            >
              <div
                className={`w-6 h-6 shrink-0 rounded-md flex items-center justify-center ${
                  s.done ? 'bg-emerald-500/20 text-emerald-300' : s.active ? 'bg-cyan-500/20 text-cyan-300 animate-pulse' : 'bg-slate-800 text-slate-500'
                }`}
              >
                {s.done ? <CheckCircle2 className="w-3.5 h-3.5" /> : <s.icon className="w-3.5 h-3.5" />}
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-bold text-slate-100">
                  {i + 1}. {s.title}
                </div>
                <div className="text-[10px] font-mono text-slate-400 truncate">{s.detail}</div>
              </div>
            </li>
          ))}
        </ol>

        {tab === 'PREFLIGHT' ? (
          <>
            <div className="flex flex-col gap-3.5">
              <ArgSlider name="paths_per_hop" hint="Strings fanned out from every node" value={args.pathsPerHop} min={2} max={10} step={1} disabled={animating} onChange={(v) => onArgChange('pathsPerHop', v)} />
              <ArgSlider name="number_of_hops" hint="Wavefront depth (hops ahead of the nose)" value={args.numberOfHops} min={1} max={6} step={1} disabled={animating} onChange={(v) => onArgChange('numberOfHops', v)} />
              <ArgSlider
                name="turning_radius"
                hint={`Tight → full hemisphere, wide → closed umbrella (cap ${tree.capDeg.toFixed(0)}°)`}
                value={args.turningRadiusNM}
                min={0.5}
                max={8}
                step={0.1}
                unit="NM"
                format={(v) => v.toFixed(1)}
                disabled={animating}
                onChange={(v) => onArgChange('turningRadiusNM', v)}
              />
              <ArgSlider name="aircraft_age" hint="Older airframes are derated" value={args.aircraftAgeYrs} min={0} max={35} step={1} unit="yrs" disabled={animating} onChange={(v) => onArgChange('aircraftAgeYrs', v)} />
              <ArgSlider name="aircraft_weight" hint="Gross weight vs MTOW" value={args.aircraftWeightPct} min={40} max={100} step={1} unit="% MTOW" disabled={animating} onChange={(v) => onArgChange('aircraftWeightPct', v)} />
              <ArgSlider name="max_climb_rate" hint="Aircraft spec — bounds climb angle" value={args.maxClimbRateFpm} min={1000} max={6000} step={100} unit="fpm" disabled={animating} onChange={(v) => onArgChange('maxClimbRateFpm', v)} />
              <ArgSlider
                name="max_load_factor"
                hint="Aircraft spec — bounds bank / turn rate"
                value={args.maxLoadFactorG}
                min={1.2}
                max={2.5}
                step={0.05}
                unit="g"
                format={(v) => v.toFixed(2)}
                disabled={animating}
                onChange={(v) => onArgChange('maxLoadFactorG', v)}
              />
            </div>

            <div className="text-[10px] font-mono text-slate-400 bg-slate-900/60 border border-slate-800 rounded-lg p-2 leading-relaxed">
              <div className="text-slate-300 font-bold mb-0.5">LLM envelope (derived)</div>
              max turn/hop {prune.limits.maxTurnDeg.toFixed(0)}° · max climb {prune.limits.maxClimbDeg.toFixed(0)}° · max descent {prune.limits.maxDescentDeg.toFixed(0)}°
              <br />
              theoretical {tree.theoreticalPaths.toLocaleString()} paths · rendered {tree.segCount.toLocaleString()} segments
              {tree.truncated && <span className="text-amber-400"> (deep hops sampled)</span>}
            </div>
          </>
        ) : runtimeUnlocked ? (
          <>
            <div className="flex flex-col gap-3.5">
              <ArgSlider name="weight" hint="Live gross weight" value={runtimeArgs.weightPct} min={40} max={100} step={1} unit="% MTOW" onChange={(v) => onRuntimeArgChange('weightPct', v)} />
              <ArgSlider name="age" hint="Airframe age / fatigue" value={runtimeArgs.ageYrs} min={0} max={35} step={1} unit="yrs" onChange={(v) => onRuntimeArgChange('ageYrs', v)} />
              <ArgSlider name="engine_health" hint="Lower health penalises climbs" value={runtimeArgs.engineHealthPct} min={40} max={100} step={1} unit="%" onChange={(v) => onRuntimeArgChange('engineHealthPct', v)} />
              <ArgSlider name="fuel_remaining" hint="Low fuel penalises long detours" value={runtimeArgs.fuelRemainingPct} min={5} max={100} step={1} unit="%" onChange={(v) => onRuntimeArgChange('fuelRemainingPct', v)} />
              <ArgSlider name="wind_shear" hint="Shear penalises steep descents" value={runtimeArgs.windShearKt} min={0} max={40} step={1} unit="kt" onChange={(v) => onRuntimeArgChange('windShearKt', v)} />
            </div>

            {stage === 'runtime' && runtime ? (
              <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-2.5">
                <div className="flex items-center justify-between text-[10px] font-mono mb-1.5">
                  <span className="text-yellow-300 font-bold uppercase tracking-wider">NN classifier ranking</span>
                  <span className="text-slate-400">stress {(runtime.stress * 100).toFixed(0)}%</span>
                </div>
                <div className="flex flex-col gap-1">
                  {runtime.ranked.map((idx) => {
                    const kept = runtime.survivors.includes(idx);
                    const optimal = idx === runtime.optimal;
                    return (
                      <div key={idx} className={`flex items-center gap-2 text-[10px] font-mono ${kept ? 'text-slate-200' : 'text-slate-600 line-through'}`}>
                        <span className={`w-7 ${optimal ? 'text-yellow-200 font-bold' : kept ? 'text-yellow-400' : ''}`}>T{idx + 1}</span>
                        <div className="flex-1 h-1.5 bg-slate-800 rounded overflow-hidden">
                          <div
                            className={`h-full rounded transition-all duration-300 ${optimal ? 'bg-yellow-200' : kept ? 'bg-yellow-500' : 'bg-slate-600'}`}
                            style={{ width: `${(runtime.scores[idx] * 100).toFixed(0)}%` }}
                          />
                        </div>
                        <span className="w-8 text-right">{runtime.scores[idx].toFixed(2)}</span>
                        {optimal ? <Star className="w-3 h-3 text-yellow-300 fill-yellow-300" /> : <span className="w-3" />}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="text-[11px] font-mono text-slate-400">Press “Run NN classifier” to rank the {consolidation.K} trajectories against these run-time values.</div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center text-center gap-2 py-8 text-slate-400">
            <Lock className="w-6 h-6 text-slate-600" />
            <div className="text-xs font-mono">Run-time arguments unlock after the rejected paths are excluded and the green paths are consolidated.</div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="border-t border-slate-800 p-3 grid grid-cols-2 gap-2">
        <button onClick={onGenerate} disabled={animating} className={btn(!animating, 'bg-cyan-500 border-cyan-400 text-slate-950 hover:bg-cyan-400')}>
          <Play className="w-3.5 h-3.5" />
          {si >= stageIndex('generated') ? 'Regenerate' : 'Generate paths'}
        </button>
        <button onClick={onPrune} disabled={stage !== 'generated'} className={btn(stage === 'generated', 'bg-emerald-600 border-emerald-400 text-white hover:bg-emerald-500')}>
          <BrainCircuit className="w-3.5 h-3.5" />
          Run LLM pruning
        </button>
        <button
          onClick={onExclude}
          disabled={stage !== 'pruned' || consolidation.K === 0}
          className={btn(stage === 'pruned' && consolidation.K > 0, 'bg-rose-600 border-rose-400 text-white hover:bg-rose-500')}
        >
          <Scissors className="w-3.5 h-3.5" />
          Exclude rejected paths
        </button>
        <button onClick={onRunNN} disabled={stage !== 'consolidated'} className={btn(stage === 'consolidated', 'bg-yellow-400 border-yellow-200 text-slate-950 hover:bg-yellow-300')}>
          <Sparkles className="w-3.5 h-3.5" />
          Run NN classifier
        </button>
        <button onClick={onReset} disabled={animating} className={`col-span-2 ${btn(!animating, 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700')}`}>
          <RotateCcw className="w-3.5 h-3.5" />
          Reset pipeline
        </button>
        {stage === 'pruned' && consolidation.K === 0 && (
          <div className="col-span-2 text-[10px] font-mono text-rose-300 text-center">No feasible paths — relax the envelope and regenerate.</div>
        )}
      </div>
    </div>
  );
};
