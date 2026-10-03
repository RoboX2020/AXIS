import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { AircraftState, CandidateTrajectory, ConflictAnalysis, ResolutionOption, ScenarioPreset, Vector3D } from './lib/types';
import {
  SCENARIO_PRESETS,
  computePredictedTrajectory,
  analyzeConflict,
  generateResolutionOptions,
  evaluateCandidateTrajectories,
  nmToLatLon,
  getVelocityComponents,
  EMERGENCY_PROMPT_RANGE_NM,
} from './lib/algorithms';
import { avionicsAudio } from './lib/soundEffects';
import { AirspaceTacticalCanvas } from './components/AirspaceTacticalCanvas';
import { AeroVisualizer3D } from './components/AeroVisualizer3D';
import { TrajectoryPruningGraph } from './components/TrajectoryPruningGraph';
import { CockpitDisplay } from './components/CockpitDisplay';
import { TelemetryPanel } from './components/TelemetryPanel';
import { SimulationControls } from './components/SimulationControls';
import { ConflictResolutionModal } from './components/ConflictResolutionModal';
import { HostGameArena } from './components/game/HostGameArena';
import { MobileFlightController } from './components/game/MobileFlightController';
import { Plane, ShieldAlert, Radio, AlertOctagon, HelpCircle, CheckCircle2, RefreshCw, Zap, Gamepad2 } from 'lucide-react';

export default function App() {
  // Webapp Mode Switcher (AeroPredict Analytics vs SkyClash Multiplayer Host vs Mobile Flight Controller)
  type PageMode = 'simulation' | 'game' | 'controller';
  const [pageMode, setPageMode] = useState<PageMode>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const mode = params.get('mode');
      if (mode === 'controller') return 'controller';
      if (mode === 'game') return 'game';
    }
    return 'simulation';
  });

  const roomId = useMemo(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return params.get('room') || 'sky-arena-1';
    }
    return 'sky-arena-1';
  }, []);

  const handleSwitchPage = (mode: PageMode) => {
    setPageMode(mode);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (mode === 'simulation') {
        url.searchParams.delete('mode');
      } else {
        url.searchParams.set('mode', mode);
      }
      window.history.pushState({}, '', url.toString());
    }
  };

  const [activeScenarioId, setActiveScenarioId] = useState<string>('head-on');
  const initialPreset = SCENARIO_PRESETS[0];

  // Aircraft A State (Flight Alpha - Cyan)
  const [planeA, setPlaneA] = useState<AircraftState>(() => {
    const latLon = nmToLatLon(initialPreset.planeA.position.x, initialPreset.planeA.position.y);
    return {
      id: 'A',
      callsign: initialPreset.planeA.callsign,
      icaoHex: initialPreset.planeA.icao,
      squawk: '4521',
      model: 'Boeing 787-9 Dreamliner',
      position: { ...initialPreset.planeA.position },
      startPosition: { ...initialPreset.planeA.position },
      heading: initialPreset.planeA.heading,
      initialHeading: initialPreset.planeA.heading,
      speed: initialPreset.planeA.speed,
      initialSpeed: initialPreset.planeA.speed,
      verticalSpeed: initialPreset.planeA.verticalSpeed,
      initialVerticalSpeed: initialPreset.planeA.verticalSpeed,
      turnRate: 0,
      bankAngle: 0,
      pitchAngle: 0,
      color: '#06b6d4',
      lat: latLon.lat,
      lon: latLon.lon,
      history: [{ ...initialPreset.planeA.position }],
      decidedRoute: [],
      predictedTrajectory: [],
      hasResolved: false,
      resolutionAction: null,
      selectedPlan: null,
    };
  });

  // Aircraft B State (Flight Bravo - Amber)
  const [planeB, setPlaneB] = useState<AircraftState>(() => {
    const latLon = nmToLatLon(initialPreset.planeB.position.x, initialPreset.planeB.position.y);
    return {
      id: 'B',
      callsign: initialPreset.planeB.callsign,
      icaoHex: initialPreset.planeB.icao,
      squawk: '1200',
      model: 'Airbus A350-900',
      position: { ...initialPreset.planeB.position },
      startPosition: { ...initialPreset.planeB.position },
      heading: initialPreset.planeB.heading,
      initialHeading: initialPreset.planeB.heading,
      speed: initialPreset.planeB.speed,
      initialSpeed: initialPreset.planeB.speed,
      verticalSpeed: initialPreset.planeB.verticalSpeed,
      initialVerticalSpeed: initialPreset.planeB.verticalSpeed,
      turnRate: 0,
      bankAngle: 0,
      pitchAngle: 0,
      color: '#f59e0b',
      lat: latLon.lat,
      lon: latLon.lon,
      history: [{ ...initialPreset.planeB.position }],
      decidedRoute: [],
      predictedTrajectory: [],
      hasResolved: false,
      resolutionAction: null,
      selectedPlan: null,
    };
  });

  // Simulation Controls & Loop State
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [simSpeed, setSimSpeed] = useState<number>(1);
  const [simTimeSec, setSimTimeSec] = useState<number>(0);
  const [autoPauseOnRA, setAutoPauseOnRA] = useState<boolean>(true);
  const [isAudioMuted, setIsAudioMuted] = useState<boolean>(false);

  // Target flight plan for Flight A upon pilot decision
  const targetFlightPlanA = useRef<{
    targetHeading: number | null;
    targetVerticalSpeed: number | null;
    targetAltitude: number | null;
    maneuverStartTime: number | null;
  }>({
    targetHeading: null,
    targetVerticalSpeed: null,
    targetAltitude: null,
    maneuverStartTime: null,
  });

  // Target flight plan for Flight B (Coordinated opposite Z-axis maneuver: climb vs descend!)
  const targetFlightPlanB = useRef<{
    targetHeading: number | null;
    targetVerticalSpeed: number | null;
    targetAltitude: number | null;
    maneuverStartTime: number | null;
  }>({
    targetHeading: null,
    targetVerticalSpeed: null,
    targetAltitude: null,
    maneuverStartTime: null,
  });

  // Conflict state
  const [isPromptOpen, setIsPromptOpen] = useState<boolean>(false);
  const hasPromptedForThisConflict = useRef<boolean>(false);
  const lastSoundPlayed = useRef<string | null>(null);

  // History tracking
  const [timeHistory, setTimeHistory] = useState<
    Array<{
      timeSec: number;
      distanceNM: number;
      altA: number;
      altB: number;
    }>
  >([]);

  // Calculate live conflict metrics
  const conflict = analyzeConflict(planeA, planeB);
  const resolutionOptions = generateResolutionOptions(planeA, planeB, conflict);

  // Compute multi-hypothesis candidate trajectories and dynamic algorithmic filtering
  const candidateTrajectories = useMemo<CandidateTrajectory[]>(() => {
    return evaluateCandidateTrajectories(planeA, planeB, conflict);
  }, [planeA, planeB, conflict]);

  // Compute forward predicted trajectories (Dotted Lines) with long 120s range
  useEffect(() => {
    const trajA = computePredictedTrajectory(planeA, 120, 1.5);
    const trajB = computePredictedTrajectory(planeB, 120, 1.5);
    setPlaneA((prev) => ({ ...prev, predictedTrajectory: trajA }));
    setPlaneB((prev) => ({ ...prev, predictedTrajectory: trajB }));
  }, [
    planeA.position.x,
    planeA.position.y,
    planeA.position.z,
    planeA.heading,
    planeA.speed,
    planeA.verticalSpeed,
    planeA.turnRate,
    planeB.position.x,
    planeB.position.y,
    planeB.position.z,
    planeB.heading,
    planeB.speed,
    planeB.verticalSpeed,
    planeB.turnRate,
  ]);

  // Audio Alerts on status change
  useEffect(() => {
    const isRA = conflict.tcasStatus === 'RESOLUTION_ADVISORY' || conflict.isWithinEmergencyRange;
    if (isRA) {
      if (lastSoundPlayed.current !== 'RA') {
        avionicsAudio.playResolutionAdvisory();
        lastSoundPlayed.current = 'RA';
      }
    } else if (conflict.tcasStatus === 'TRAFFIC_ADVISORY') {
      if (lastSoundPlayed.current !== 'TA') {
        avionicsAudio.playTrafficAdvisory();
        lastSoundPlayed.current = 'TA';
      }
    } else {
      if (lastSoundPlayed.current === 'RA' || lastSoundPlayed.current === 'TA') {
        avionicsAudio.playClearOfConflict();
      }
      lastSoundPlayed.current = null;
    }
  }, [conflict.tcasStatus, conflict.isWithinEmergencyRange]);

  // Emergency 12 NM Prompt Trigger
  useEffect(() => {
    const shouldPrompt =
      (conflict.tcasStatus === 'RESOLUTION_ADVISORY' ||
        conflict.isWithinEmergencyRange ||
        conflict.flarmLevel >= 2) &&
      !hasPromptedForThisConflict.current &&
      !planeA.hasResolved;

    if (isSimulating && shouldPrompt) {
      hasPromptedForThisConflict.current = true;
      setIsPromptOpen(true);
      if (autoPauseOnRA) {
        setIsSimulating(false);
      }
    }
  }, [
    conflict.tcasStatus,
    conflict.isWithinEmergencyRange,
    conflict.flarmLevel,
    isSimulating,
    autoPauseOnRA,
    planeA.hasResolved,
  ]);

  // Main Simulation Physics Tick Loop
  useEffect(() => {
    if (!isSimulating) return;

    const intervalMs = 50;
    const simDtSec = (intervalMs / 1000) * simSpeed;

    const interval = setInterval(() => {
      setSimTimeSec((prev) => prev + simDtSec);

      // --- Update Plane A ---
      setPlaneA((currA) => {
        let newHeading = currA.heading;
        let newTurnRate = 0;
        let newBankAngle = 0;
        let newVerticalSpeed = currA.verticalSpeed;

        if (targetFlightPlanA.current.targetHeading !== null) {
          const targetH = targetFlightPlanA.current.targetHeading;
          let diff = targetH - newHeading;
          while (diff < -180) diff += 360;
          while (diff > 180) diff -= 360;

          if (Math.abs(diff) > 0.5) {
            const turnStep = 8.5 * simDtSec;
            const turnDir = Math.sign(diff);
            newTurnRate = turnDir * 8.5;
            newBankAngle = turnDir * 35; // Sharp 35-degree evasive bank
            newHeading = (newHeading + turnDir * Math.min(Math.abs(diff), turnStep) + 360) % 360;
          } else {
            newHeading = targetH;
            newTurnRate = 0;
            newBankAngle = 0;
            targetFlightPlanA.current.targetHeading = null;
          }
        }

        if (targetFlightPlanA.current.targetVerticalSpeed !== null) {
          const targetVS = targetFlightPlanA.current.targetVerticalSpeed;
          const vsDiff = targetVS - newVerticalSpeed;
          if (Math.abs(vsDiff) > 50) {
            newVerticalSpeed += Math.sign(vsDiff) * Math.min(Math.abs(vsDiff), 850 * simDtSec);
          } else {
            newVerticalSpeed = targetVS;
          }
        }

        const vA = getVelocityComponents(currA.speed, newHeading);
        const newX = currA.position.x + (vA.vx / 3600) * simDtSec;
        const newY = currA.position.y + (vA.vy / 3600) * simDtSec;
        const newZ = Math.max(1000, currA.position.z + (newVerticalSpeed / 60) * simDtSec);

        const newPos = { x: newX, y: newY, z: newZ };
        const { lat, lon } = nmToLatLon(newX, newY);
        const pitchAngle = Math.max(-12, Math.min(15, newVerticalSpeed / 250));

        const updatedDecidedRoute = currA.hasResolved
          ? [...currA.decidedRoute, { ...newPos }]
          : [];

        return {
          ...currA,
          position: newPos,
          heading: newHeading,
          verticalSpeed: newVerticalSpeed,
          turnRate: newTurnRate,
          bankAngle: newBankAngle,
          pitchAngle,
          lat,
          lon,
          history: [...currA.history.slice(-180), { ...newPos }],
          decidedRoute: updatedDecidedRoute,
        };
      });

      // --- Update Plane B (Coordinated kinematics: turns, banks, dives/climbs opposite to Plane A) ---
      setPlaneB((currB) => {
        let newHeading = currB.heading;
        let newTurnRate = 0;
        let newBankAngle = 0;
        let newVerticalSpeed = currB.verticalSpeed;

        if (targetFlightPlanB.current.targetHeading !== null) {
          const targetH = targetFlightPlanB.current.targetHeading;
          let diff = targetH - newHeading;
          while (diff < -180) diff += 360;
          while (diff > 180) diff -= 360;

          if (Math.abs(diff) > 0.5) {
            const turnStep = 8.5 * simDtSec;
            const turnDir = Math.sign(diff);
            newTurnRate = turnDir * 8.5;
            newBankAngle = turnDir * 35;
            newHeading = (newHeading + turnDir * Math.min(Math.abs(diff), turnStep) + 360) % 360;
          } else {
            newHeading = targetH;
            newTurnRate = 0;
            newBankAngle = 0;
            targetFlightPlanB.current.targetHeading = null;
          }
        }

        if (targetFlightPlanB.current.targetVerticalSpeed !== null) {
          const targetVS = targetFlightPlanB.current.targetVerticalSpeed;
          const vsDiff = targetVS - newVerticalSpeed;
          if (Math.abs(vsDiff) > 50) {
            newVerticalSpeed += Math.sign(vsDiff) * Math.min(Math.abs(vsDiff), 850 * simDtSec);
          } else {
            newVerticalSpeed = targetVS;
          }
        }

        const vB = getVelocityComponents(currB.speed, newHeading);
        const newX = currB.position.x + (vB.vx / 3600) * simDtSec;
        const newY = currB.position.y + (vB.vy / 3600) * simDtSec;
        const newZ = Math.max(1000, currB.position.z + (newVerticalSpeed / 60) * simDtSec);
        const newPos = { x: newX, y: newY, z: newZ };
        const { lat, lon } = nmToLatLon(newX, newY);
        const pitchAngle = Math.max(-12, Math.min(15, newVerticalSpeed / 250));

        const updatedDecidedRoute = currB.hasResolved
          ? [...currB.decidedRoute, { ...newPos }]
          : [];

        return {
          ...currB,
          position: newPos,
          heading: newHeading,
          verticalSpeed: newVerticalSpeed,
          turnRate: newTurnRate,
          bankAngle: newBankAngle,
          pitchAngle,
          lat,
          lon,
          history: [...currB.history.slice(-180), { ...newPos }],
          decidedRoute: updatedDecidedRoute,
        };
      });

      // Record separation point
      setTimeHistory((prev) => [
        ...prev.slice(-90),
        {
          timeSec: Number(simTimeSec.toFixed(1)),
          distanceNM: Number(conflict.distanceNM.toFixed(2)),
          altA: Math.round(planeA.position.z),
          altB: Math.round(planeB.position.z),
        },
      ]);
    }, intervalMs);

    return () => clearInterval(interval);
  }, [isSimulating, simSpeed, conflict.distanceNM, planeA.position.z, planeB.position.z, simTimeSec]);

  // Load Scenario Preset
  const handleLoadScenario = useCallback((preset: ScenarioPreset) => {
    setActiveScenarioId(preset.id);
    setIsSimulating(false);
    setSimTimeSec(0);
    hasPromptedForThisConflict.current = false;
    lastSoundPlayed.current = null;
    targetFlightPlanA.current = {
      targetHeading: null,
      targetVerticalSpeed: null,
      targetAltitude: null,
      maneuverStartTime: null,
    };
    targetFlightPlanB.current = {
      targetHeading: null,
      targetVerticalSpeed: null,
      targetAltitude: null,
      maneuverStartTime: null,
    };
    setTimeHistory([]);

    const latLonA = nmToLatLon(preset.planeA.position.x, preset.planeA.position.y);
    setPlaneA({
      id: 'A',
      callsign: preset.planeA.callsign,
      icaoHex: preset.planeA.icao,
      squawk: '4521',
      model: 'Boeing 787-9 Dreamliner',
      position: { ...preset.planeA.position },
      startPosition: { ...preset.planeA.position },
      heading: preset.planeA.heading,
      initialHeading: preset.planeA.heading,
      speed: preset.planeA.speed,
      initialSpeed: preset.planeA.speed,
      verticalSpeed: preset.planeA.verticalSpeed,
      initialVerticalSpeed: preset.planeA.verticalSpeed,
      turnRate: 0,
      bankAngle: 0,
      pitchAngle: 0,
      color: '#06b6d4',
      lat: latLonA.lat,
      lon: latLonA.lon,
      history: [{ ...preset.planeA.position }],
      decidedRoute: [],
      predictedTrajectory: [],
      hasResolved: false,
      resolutionAction: null,
      selectedPlan: null,
    });

    const latLonB = nmToLatLon(preset.planeB.position.x, preset.planeB.position.y);
    setPlaneB({
      id: 'B',
      callsign: preset.planeB.callsign,
      icaoHex: preset.planeB.icao,
      squawk: '1200',
      model: 'Airbus A350-900',
      position: { ...preset.planeB.position },
      startPosition: { ...preset.planeB.position },
      heading: preset.planeB.heading,
      initialHeading: preset.planeB.heading,
      speed: preset.planeB.speed,
      initialSpeed: preset.planeB.speed,
      verticalSpeed: preset.planeB.verticalSpeed,
      initialVerticalSpeed: preset.planeB.verticalSpeed,
      turnRate: 0,
      bankAngle: 0,
      pitchAngle: 0,
      color: '#f59e0b',
      lat: latLonB.lat,
      lon: latLonB.lon,
      history: [{ ...preset.planeB.position }],
      decidedRoute: [],
      predictedTrajectory: [],
      hasResolved: false,
      resolutionAction: null,
      selectedPlan: null,
    });
  }, []);

  // Reset Simulation to Start Points
  const handleReset = useCallback(() => {
    setIsSimulating(false);
    setSimTimeSec(0);
    hasPromptedForThisConflict.current = false;
    lastSoundPlayed.current = null;
    targetFlightPlanA.current = {
      targetHeading: null,
      targetVerticalSpeed: null,
      targetAltitude: null,
      maneuverStartTime: null,
    };
    targetFlightPlanB.current = {
      targetHeading: null,
      targetVerticalSpeed: null,
      targetAltitude: null,
      maneuverStartTime: null,
    };
    setTimeHistory([]);

    setPlaneA((curr) => ({
      ...curr,
      position: { ...curr.startPosition },
      heading: curr.initialHeading,
      speed: curr.initialSpeed,
      verticalSpeed: curr.initialVerticalSpeed,
      turnRate: 0,
      bankAngle: 0,
      pitchAngle: 0,
      history: [{ ...curr.startPosition }],
      decidedRoute: [],
      hasResolved: false,
      resolutionAction: null,
      selectedPlan: null,
    }));

    setPlaneB((curr) => ({
      ...curr,
      position: { ...curr.startPosition },
      heading: curr.initialHeading,
      speed: curr.initialSpeed,
      verticalSpeed: curr.initialVerticalSpeed,
      turnRate: 0,
      bankAngle: 0,
      pitchAngle: 0,
      history: [{ ...curr.startPosition }],
      decidedRoute: [],
      hasResolved: false,
      resolutionAction: null,
      selectedPlan: null,
    }));
  }, []);

  // Step Forward (+1s)
  const handleStepForward = useCallback(() => {
    setSimTimeSec((prev) => prev + 1);
    setPlaneA((currA) => {
      const vA = getVelocityComponents(currA.speed, currA.heading);
      const newX = currA.position.x + vA.vx / 3600;
      const newY = currA.position.y + vA.vy / 3600;
      const newZ = Math.max(1000, currA.position.z + currA.verticalSpeed / 60);
      const newPos = { x: newX, y: newY, z: newZ };
      return {
        ...currA,
        position: newPos,
        history: [...currA.history, { ...newPos }],
        decidedRoute: currA.hasResolved ? [...currA.decidedRoute, { ...newPos }] : [],
      };
    });

    setPlaneB((currB) => {
      const vB = getVelocityComponents(currB.speed, currB.heading);
      const newX = currB.position.x + vB.vx / 3600;
      const newY = currB.position.y + vB.vy / 3600;
      const newZ = Math.max(1000, currB.position.z + currB.verticalSpeed / 60);
      const newPos = { x: newX, y: newY, z: newZ };
      return {
        ...currB,
        position: newPos,
        history: [...currB.history, { ...newPos }],
      };
    });
  }, []);

  // Execute Chosen Resolution Option from Prompt (Coordinates both Plane A and Plane B)
  const handleSelectResolutionOption = (option: ResolutionOption) => {
    setIsPromptOpen(false);

    // Flight A maneuvers
    const targetHeadingA =
      option.headingDelta !== 0 ? (planeA.heading + option.headingDelta + 360) % 360 : null;
    const targetVerticalSpeedA = option.targetVerticalSpeed !== 0 ? option.targetVerticalSpeed : null;

    targetFlightPlanA.current = {
      targetHeading: targetHeadingA,
      targetVerticalSpeed: targetVerticalSpeedA,
      targetAltitude: option.altitudeDelta !== 0 ? planeA.position.z + option.altitudeDelta : null,
      maneuverStartTime: simTimeSec,
    };

    // Coordinated Flight B maneuvers (Z-axis complementary: if Flight A climbs, Flight B dives!)
    const targetHeadingB =
      option.headingDeltaB !== undefined && option.headingDeltaB !== 0
        ? (planeB.heading + option.headingDeltaB + 360) % 360
        : null;
    const targetVerticalSpeedB =
      option.targetVerticalSpeedB !== undefined
        ? option.targetVerticalSpeedB
        : option.targetVerticalSpeed !== 0
        ? -option.targetVerticalSpeed
        : null;

    targetFlightPlanB.current = {
      targetHeading: targetHeadingB,
      targetVerticalSpeed: targetVerticalSpeedB,
      targetAltitude: option.altitudeDeltaB !== undefined ? planeB.position.z + option.altitudeDeltaB : null,
      maneuverStartTime: simTimeSec,
    };

    setPlaneA((prev) => ({
      ...prev,
      hasResolved: true,
      resolutionAction: option.title,
      selectedPlan: option.title,
      decidedRoute: [{ ...prev.position }],
    }));

    setPlaneB((prev) => ({
      ...prev,
      hasResolved: true,
      resolutionAction: targetVerticalSpeedB
        ? targetVerticalSpeedB < 0
          ? 'COORDINATED TCAS: DESCEND (-2,800 FPM)'
          : 'COORDINATED TCAS: CLIMB (+2,800 FPM)'
        : 'COORDINATED HEADING DIVERGENCE',
      selectedPlan: option.title,
      decidedRoute: [{ ...prev.position }],
    }));

    avionicsAudio.playClearOfConflict();
    setIsSimulating(true);
  };

  const handleToggleMute = () => {
    setIsAudioMuted((prev) => {
      const next = !prev;
      avionicsAudio.isMuted = next;
      return next;
    });
  };

  // Render Mobile Phone Flight Controller View
  if (pageMode === 'controller') {
    return (
      <MobileFlightController
        roomId={roomId}
        onExitToHost={() => handleSwitchPage('game')}
      />
    );
  }

  // Render 3D Multiplayer Game Host Screen View
  if (pageMode === 'game') {
    return (
      <HostGameArena
        roomId={roomId}
        onNavigateToSimulator={() => handleSwitchPage('simulation')}
        onOpenMobileControllerDirectly={() => handleSwitchPage('controller')}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Suite Navigation Switcher */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-950 to-slate-900 border-b border-cyan-500/30 px-6 py-2 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
        <div className="flex items-center gap-2">
          <span className="text-slate-400 font-bold uppercase tracking-wider">AeroPredict Suite:</span>
          <div className="flex items-center gap-1 bg-slate-900 border border-slate-700 rounded-lg p-0.5">
            <button
              onClick={() => handleSwitchPage('simulation')}
              className={`px-3 py-1 rounded-md font-bold transition-all flex items-center gap-1.5 ${
                pageMode === 'simulation'
                  ? 'bg-cyan-500 text-slate-950 font-black shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Plane className="w-3.5 h-3.5" />
              <span>ADS-B &amp; TCAS Predictor</span>
            </button>
            <button
              onClick={() => handleSwitchPage('game')}
              className="px-3 py-1 rounded-md font-bold transition-all flex items-center gap-1.5 text-amber-300 hover:bg-slate-800"
            >
              <Gamepad2 className="w-3.5 h-3.5 text-amber-400" />
              <span className="font-extrabold">🎮 SkyClash: Multiplayer 3D Game (Host &amp; Phone)</span>
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => handleSwitchPage('game')}
            className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-bold underline decoration-cyan-500/50"
          >
            <span>Host Screen: Display QR Code for Mobile Players &rarr;</span>
          </button>
        </div>
      </div>

      {/* High-Visibility Navigation Top Bar Contract */}
      <header className="flex items-center justify-between px-6 py-3.5 border-b border-slate-700/80 bg-slate-950/90 backdrop-blur-md sticky top-0 z-40 shadow-lg">
        {/* Zone 1: Wordmark */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-400 via-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/25">
            <Radio className="w-5 h-5 text-slate-950 stroke-[2.5]" />
          </div>
          <div>
            <span className="text-lg font-black tracking-tight text-white font-display">
              AeroPredict
            </span>
            <span className="text-xs font-mono text-cyan-300 font-bold ml-2 hidden md:inline">
              ADS-B Trajectory Prediction &amp; TCAS/FLARM Resolution
            </span>
          </div>
        </div>

        {/* Zone 2: Navigation Links */}
        <nav className="hidden lg:flex items-center gap-6 text-xs font-bold text-slate-300">
          <a href="#3d-visualizer" className="hover:text-cyan-400 transition-colors">
            3D Spatial Visualizer
          </a>
          <a href="#pruning-scope" className="hover:text-cyan-400 text-cyan-400 font-extrabold transition-colors">
            2D Trajectory Predictor &amp; Pruning Scope
          </a>
          <a href="#tactical-map" className="hover:text-cyan-400 transition-colors">
            2D Tactical Configurator
          </a>
          <a href="#cockpit-cdti" className="hover:text-cyan-400 transition-colors">
            Cockpit CDTI &amp; TCAS VSI
          </a>
          <a href="#telemetry-feed" className="hover:text-cyan-400 transition-colors">
            ADS-B Telemetry Data
          </a>
        </nav>

        {/* Zone 3: Actions & 12 NM Alert Status */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => handleLoadScenario(SCENARIO_PRESETS[0])}
            className="px-3.5 py-1.5 text-xs font-bold text-slate-100 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors flex items-center gap-1.5 border border-slate-700 shadow"
            title="Reset to Head-On Conflict scenario"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Head-On Intercept</span>
          </button>

          <div
            className={`px-3 py-1.5 text-xs font-mono font-black rounded-lg border flex items-center gap-2 shadow-md ${
              conflict.tcasStatus === 'RESOLUTION_ADVISORY' || conflict.isWithinEmergencyRange
                ? 'bg-red-600 text-white animate-pulse border-white'
                : conflict.tcasStatus === 'TRAFFIC_ADVISORY'
                ? 'bg-amber-500 text-slate-950 font-bold border-amber-300'
                : 'bg-emerald-950 text-emerald-300 border-emerald-600'
            }`}
          >
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                conflict.tcasStatus === 'RESOLUTION_ADVISORY' || conflict.isWithinEmergencyRange
                  ? 'bg-white'
                  : conflict.tcasStatus === 'TRAFFIC_ADVISORY'
                  ? 'bg-slate-950'
                  : 'bg-emerald-400'
              }`}
            />
            <span>
              {conflict.isWithinEmergencyRange
                ? 'EMERGENCY: &le; 12 NM RA'
                : `TCAS: ${conflict.tcasStatus}`}
            </span>
          </div>
        </div>
      </header>

      {/* Main Simulation Workspace */}
      <main className="flex-1 p-4 sm:p-6 max-w-[1650px] w-full mx-auto flex flex-col gap-5">
        {/* Simulation Control Bar */}
        <SimulationControls
          isSimulating={isSimulating}
          onToggleSimulate={() => setIsSimulating((prev) => !prev)}
          onStepForward={handleStepForward}
          onReset={handleReset}
          simSpeed={simSpeed}
          onChangeSpeed={setSimSpeed}
          simTimeSec={simTimeSec}
          autoPauseOnRA={autoPauseOnRA}
          onToggleAutoPause={() => setAutoPauseOnRA((prev) => !prev)}
          hasCollisionRisk={conflict.tcasStatus === 'RESOLUTION_ADVISORY' || conflict.flarmLevel >= 2}
          onOpenDecisionPrompt={() => setIsPromptOpen(true)}
          hasResolved={planeA.hasResolved}
          isAudioMuted={isAudioMuted}
          onToggleMute={handleToggleMute}
          currentDistanceNM={conflict.distanceNM}
        />

        {/* Resolution Confirmed Feedback Alert Banner */}
        {(planeA.hasResolved || planeB.hasResolved) && (
          <div className="bg-emerald-950/80 border-2 border-emerald-500 rounded-xl p-3.5 px-4 flex items-center justify-between gap-3 text-xs font-mono text-emerald-100 shadow-lg">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              <span>
                <strong className="text-white">COORDINATED TCAS RESOLUTION EXECUTED:</strong> {planeA.callsign} &amp; {planeB.callsign} separating on opposite Z-axis trajectories (one climbs, one dives). Both executed paths rendered as <strong className="text-white underline">solid grey routes</strong>!
              </span>
            </div>
            <div className="text-emerald-300 font-bold whitespace-nowrap bg-emerald-900/60 px-3 py-1 rounded-lg border border-emerald-700">
              Vertical Split: {Math.abs(Math.round(planeA.position.z - planeB.position.z))} FT · CPA Dist: {conflict.distanceAtCPANM} NM
            </div>
          </div>
        )}

        {/* Primary Stage: 3D Visualizer & 2D Tactical Airspace Map */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 min-h-[520px]">
          {/* 3D Visualizer (7 columns on desktop) */}
          <div id="3d-visualizer" className="lg:col-span-7 flex flex-col shadow-2xl">
            <AeroVisualizer3D
              planeA={planeA}
              planeB={planeB}
              conflict={conflict}
              isSimulating={isSimulating}
            />
          </div>

          {/* 2D Interactive Tactical Canvas (5 columns on desktop) */}
          <div id="tactical-map" className="lg:col-span-5 flex flex-col shadow-2xl">
            <AirspaceTacticalCanvas
              planeA={planeA}
              planeB={planeB}
              onChangePlaneA={(updates) => setPlaneA((prev) => ({ ...prev, ...updates }))}
              onChangePlaneB={(updates) => setPlaneB((prev) => ({ ...prev, ...updates }))}
              onLoadScenario={handleLoadScenario}
              activeScenarioId={activeScenarioId}
              isSimulating={isSimulating}
              tcasStatus={conflict.tcasStatus}
              candidateTrajectories={candidateTrajectories}
            />
          </div>
        </div>

        {/* 2D Live Trajectory Predictor & Algorithmic Pruning Scope Showcase */}
        <div id="pruning-scope" className="w-full flex flex-col shadow-2xl scroll-mt-20">
          <TrajectoryPruningGraph
            planeA={planeA}
            planeB={planeB}
            conflict={conflict}
            candidates={candidateTrajectories}
            isSimulating={isSimulating}
          />
        </div>

        {/* Secondary Deck: Cockpit Display & ADS-B Telemetry Feed */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 min-h-[400px]">
          {/* Cockpit CDTI & TCAS VSI (5 columns on desktop) */}
          <div id="cockpit-cdti" className="lg:col-span-5 flex flex-col shadow-2xl">
            <CockpitDisplay ownship={planeA} intruder={planeB} conflict={conflict} />
          </div>

          {/* ADS-B Mock Data & Calculations Telemetry (7 columns on desktop) */}
          <div id="telemetry-feed" className="lg:col-span-7 flex flex-col shadow-2xl">
            <TelemetryPanel
              planeA={planeA}
              planeB={planeB}
              conflict={conflict}
              timeHistory={timeHistory}
            />
          </div>
        </div>
      </main>

      {/* Pilot Decision Prompt Modal with 12 NM Emergency Envelope */}
      <ConflictResolutionModal
        isOpen={isPromptOpen}
        conflict={conflict}
        planeA={planeA}
        planeB={planeB}
        options={resolutionOptions}
        onSelectOption={handleSelectResolutionOption}
        onDismiss={() => setIsPromptOpen(false)}
        hasResolved={planeA.hasResolved}
      />

      {/* Footer */}
      <footer className="mt-8 border-t border-slate-800 px-6 py-4 bg-slate-950 text-center text-xs font-mono text-slate-400">
        AeroPredict Flight Trajectory Simulation Engine · 12.0 NM Emergency Detection Envelope · FAA TCAS II v7.1 Modified Tau &amp; FLARM Non-Linear Trajectory Algorithms
      </footer>
    </div>
  );
}
