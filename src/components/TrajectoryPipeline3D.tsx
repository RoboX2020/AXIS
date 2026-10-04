import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GripVertical, Layers } from 'lucide-react';
import { PathTreeViewport3D } from './PathTreeViewport3D';
import { PanelTab, PipelineArgumentsPanel } from './PipelineArgumentsPanel';
import {
  consolidate,
  DEFAULT_PIPELINE_ARGS,
  DEFAULT_RUNTIME_ARGS,
  generateTree,
  llmPrune,
  PipelineArgs,
  PipelineStage,
  RuntimeArgs,
  runtimeScore,
} from '../lib/trajectoryTree';

const SPLIT_KEY = 'axis.pipeline3d.split';
const SPLIT_MIN = 55;
const SPLIT_MAX = 85;

const STAGE_BADGE: Record<PipelineStage, { label: string; tone: string }> = {
  idle: { label: 'STANDBY', tone: 'bg-slate-800 text-slate-300 border-slate-600' },
  generating: { label: '① DIFFUSION GENERATING', tone: 'bg-cyan-950 text-cyan-300 border-cyan-600 animate-pulse' },
  generated: { label: '① PATHS GENERATED', tone: 'bg-cyan-950 text-cyan-300 border-cyan-700' },
  pruning: { label: '② LLM PRUNING', tone: 'bg-emerald-950 text-emerald-300 border-emerald-600 animate-pulse' },
  pruned: { label: '② LLM PRUNED', tone: 'bg-emerald-950 text-emerald-300 border-emerald-700' },
  consolidating: { label: '③ CONSOLIDATING', tone: 'bg-yellow-950 text-yellow-300 border-yellow-600 animate-pulse' },
  consolidated: { label: '③ TRAJECTORIES READY', tone: 'bg-yellow-950 text-yellow-300 border-yellow-700' },
  runtime: { label: '④ NN RUNTIME PRUNING', tone: 'bg-yellow-400 text-slate-950 border-yellow-200' },
};

const readSplit = () => {
  try {
    const v = Number(window.localStorage.getItem(SPLIT_KEY));
    if (v >= SPLIT_MIN && v <= SPLIT_MAX) return v;
  } catch {
    // storage unavailable
  }
  return 75;
};

const useIsDesktop = () => {
  const query = '(min-width: 1024px)';
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatch(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return match;
};

/**
 * Self-contained showcase of the AXIS trajectory pipeline. Independent of the live
 * two-aircraft simulation: every stage is driven from its own arguments panel.
 */
export const TrajectoryPipeline3D: React.FC = () => {
  const [draftArgs, setDraftArgs] = useState<PipelineArgs>(DEFAULT_PIPELINE_ARGS);
  const [args, setArgs] = useState<PipelineArgs>(DEFAULT_PIPELINE_ARGS);
  const [runtimeArgs, setRuntimeArgs] = useState<RuntimeArgs>(DEFAULT_RUNTIME_ARGS);
  const [stage, setStage] = useState<PipelineStage>('idle');
  const [tab, setTab] = useState<PanelTab>('PREFLIGHT');
  const [leftPct, setLeftPct] = useState<number>(readSplit);
  const isDesktop = useIsDesktop();
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const draggingSplit = useRef(false);
  const latestSplit = useRef(leftPct);

  // Debounce slider input → regenerate.
  useEffect(() => {
    if (draftArgs === args) return;
    const id = window.setTimeout(() => {
      setArgs(draftArgs);
      setStage('generated');
      setTab('PREFLIGHT');
    }, 250);
    return () => window.clearTimeout(id);
  }, [draftArgs, args]);

  const tree = useMemo(() => generateTree(args), [args]);
  const prune = useMemo(() => llmPrune(tree), [tree]);
  const consolidation = useMemo(() => consolidate(tree, prune), [tree, prune]);
  const runtime = useMemo(() => (stage === 'runtime' ? runtimeScore(consolidation, runtimeArgs) : null), [stage, consolidation, runtimeArgs]);

  const onAnimationDone = useCallback((finished: PipelineStage) => {
    setStage((cur) => {
      if (cur !== finished) return cur;
      if (finished === 'generating') return 'generated';
      if (finished === 'pruning') return 'pruned';
      if (finished === 'consolidating') {
        setTab('RUNTIME');
        return 'consolidated';
      }
      return cur;
    });
  }, []);

  // ── Resizable split ──
  const onSplitDown = (e: React.PointerEvent<HTMLDivElement>) => {
    draggingSplit.current = true;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // pointer already gone
    }
  };
  const onSplitMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingSplit.current || !bodyRef.current) return;
    const rect = bodyRef.current.getBoundingClientRect();
    const pct = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, ((e.clientX - rect.left) / rect.width) * 100));
    latestSplit.current = pct;
    setLeftPct(pct);
  };
  const onSplitUp = (e: React.PointerEvent<HTMLDivElement>) => {
    draggingSplit.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // capture already released
    }
    try {
      window.localStorage.setItem(SPLIT_KEY, latestSplit.current.toFixed(1));
    } catch {
      // storage unavailable
    }
  };

  const badge = STAGE_BADGE[stage];

  return (
    <div className="bg-slate-900/95 border-2 border-slate-700/80 rounded-2xl overflow-hidden shadow-2xl flex flex-col font-sans backdrop-blur-md">
      {/* Header */}
      <div className="bg-slate-950/90 border-b border-slate-800 p-3.5 px-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-cyan-950 border border-cyan-500/50 flex items-center justify-center text-cyan-400 shadow-lg shadow-cyan-950/50">
            <Layers className="w-4 h-4 stroke-[2.5]" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm font-black tracking-wider text-white uppercase font-display">
                AXIS 3D Trajectory Predictor &amp; Algorithmic Pruning Scope
              </h2>
              <span className="bg-cyan-900/60 text-cyan-300 text-[10px] font-mono font-bold px-2 py-0.5 rounded border border-cyan-700/60 uppercase">
                Diffusion → LLM → NN
              </span>
            </div>
            <p className="text-xs text-slate-400 font-mono">
              Pipeline executed when a TCAS Traffic Advisory is issued · Generate every reachable path · Prune infeasible hops · Pick the optimal escape at run-time
            </p>
          </div>
        </div>
        <span className={`text-[11px] font-mono font-black px-3 py-1 rounded-md border ${badge.tone}`}>{badge.label}</span>
      </div>

      {/* Body: 3D viewport | divider | arguments */}
      <div ref={bodyRef} className="flex flex-col lg:flex-row lg:h-[660px]">
        <div className="relative h-[480px] lg:h-full min-w-0" style={isDesktop ? { width: `${leftPct}%` } : undefined}>
          <PathTreeViewport3D
            tree={tree}
            prune={prune}
            consolidation={consolidation}
            runtime={runtime}
            stage={stage}
            onAnimationDone={onAnimationDone}
          />
        </div>

        <div
          role="separator"
          aria-orientation="vertical"
          aria-valuenow={Math.round(leftPct)}
          aria-valuemin={SPLIT_MIN}
          aria-valuemax={SPLIT_MAX}
          title="Drag to resize panels"
          onPointerDown={onSplitDown}
          onPointerMove={onSplitMove}
          onPointerUp={onSplitUp}
          className="hidden lg:flex w-1.5 shrink-0 cursor-col-resize items-center justify-center bg-slate-800 hover:bg-cyan-600/70 active:bg-cyan-500 transition-colors touch-none select-none"
        >
          <GripVertical className="w-3 h-3 text-slate-400 pointer-events-none" />
        </div>

        <div className="flex-1 min-w-0 lg:h-full border-t lg:border-t-0 border-slate-800">
          <PipelineArgumentsPanel
            tab={tab}
            onTabChange={setTab}
            args={draftArgs}
            onArgChange={(key, value) => setDraftArgs((prev) => ({ ...prev, [key]: value }))}
            runtimeArgs={runtimeArgs}
            onRuntimeArgChange={(key, value) => setRuntimeArgs((prev) => ({ ...prev, [key]: value }))}
            stage={stage}
            tree={tree}
            prune={prune}
            consolidation={consolidation}
            runtime={runtime}
            onGenerate={() => setStage('generating')}
            onPrune={() => setStage('pruning')}
            onExclude={() => setStage('consolidating')}
            onRunNN={() => setStage('runtime')}
            onReset={() => {
              setStage('idle');
              setRuntimeArgs(DEFAULT_RUNTIME_ARGS);
              setTab('PREFLIGHT');
            }}
          />
        </div>
      </div>
    </div>
  );
};
