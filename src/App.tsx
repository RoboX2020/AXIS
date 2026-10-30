// ============================================================================
// App.tsx - the whole simulation's conductor.
//
// Owns the two aircraft and the clock: every animation frame it moves the
// planes a step, asks algorithms.ts "are they in danger yet?" and updates
// every screen element (2D radar canvas, 3D visualizer, cockpit, telemetry
// panels). When planes get within the 12 NM emergency envelope it opens
// the Pilot Decision Prompter (ConflictResolutionModal); the maneuver you
// pick is applied to the planes here.
// Everything you see is a child component of App; this file holds the
// shared state they all read.
// ============================================================================
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
import { TrajectoryPipeline3D } from './components/TrajectoryPipeline3D';
import { CockpitDisplay } from './components/CockpitDisplay';
import { TelemetryPanel } from './components/TelemetryPanel';
import { SimulationControls } from './components/SimulationControls';
import { ConflictResolutionModal } from './components/ConflictResolutionModal';
import { Plane, ShieldAlert, Radio, AlertOctagon, HelpCircle, CheckCircle2, RefreshCw, Zap, Crosshair } from 'lucide-react';

export default function App() {
  const [activeScenarioId, setActiveScenarioId] = useState<string>('head-on');
  const initialPreset = SCENARIO_PRESETS[0];

  // Aircraft A State (Flight Alpha - Electric Blue) - Default 14,000 FT
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
      color: '#3b82f6',
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

  // Aircraft B State (Flight Bravo - Titanium White) - Default 14,000 FT
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
      color: '#ffffff',
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

  // --- Derived conflict data (recomputed whenever a plane moves) ---
  // Run the full conflict analysis (algorithms.ts) on the CURRENT positions of both
  // planes. Because planeA/planeB are React state, every physics tick re-renders
  // this component and this line runs again with fresh positions - so `conflict`
  // always describes "right now", never a stale moment.
  const conflict = analyzeConflict(planeA, planeB);
  // Build the 3 menu options (climb+turn / descend+turn / turn only) the pilot will
  // be offered if a Resolution Advisory fires. Also fresh every render.
  const resolutionOptions = generateResolutionOptions(planeA, planeB, conflict);

  // Evaluate the 8 escape-trajectory candidates (trajectoryTree.ts). useMemo caches
  // the result: React only re-runs the expensive evaluation when one of the listed
  // inputs actually changed, instead of on every single render (this component also
  // re-renders for UI-only reasons like opening a panel, which shouldn't redo math).
  const candidateTrajectories = useMemo<CandidateTrajectory[]>(() => {
    return evaluateCandidateTrajectories(planeA, planeB, conflict);
  }, [planeA, planeB, conflict]);

  // Recompute the forward "dotted line" predictions whenever either plane's motion
  // changes. The projections look 120 simulated seconds ahead at 1.5 s resolution.
  // NOTE the dependency list below names individual fields (position, heading, speed)
  // instead of the whole planeA/planeB objects - so purely visual state changes (like
  // the history array growing) don't trigger a wasteful recompute.
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

  // Play cockpit audio alerts - but only at the MOMENT the threat level CHANGES,
  // not on every tick while it stays the same. The `lastSoundPlayed` ref remembers
  // which alert is already sounding; without it, the "RESOLUTION ADVISORY" voice
  // would restart 20 times per second for the whole emergency.
  useEffect(() => {
    const isRA = conflict.tcasStatus === 'RESOLUTION_ADVISORY' || conflict.isWithinEmergencyRange;
    if (isRA) {
      // Most urgent: a Resolution Advisory (or the even-closer 12 NM emergency range).
      // Play it only if it isn't the alert already playing.
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

  // Decide when to pop the escape-maneuver prompter (the pilot decision point).
  useEffect(() => {
    // Prompt when ANY of the three warning systems says the situation is serious:
    //   - TCAS issued a Resolution Advisory (the planes WILL get too close), or
    //   - they're already inside the emergency 12 NM envelope, or
    //   - the drone-style FLARM risk gauge hit level 2 (out of 3).
    const shouldPrompt =
      (conflict.tcasStatus === 'RESOLUTION_ADVISORY' ||
        conflict.isWithinEmergencyRange ||
        conflict.flarmLevel >= 2) &&
      // ...but only once per conflict (the latch ref flips to true after prompting
      // and is only reset when a scenario is loaded/reset), and only if the pilot
      // hasn't already resolved this conflict.
      !hasPromptedForThisConflict.current &&
      !planeA.hasResolved;

    if (isSimulating && shouldPrompt) {
      // Latch the "already prompted" flag BEFORE opening, so the next tick can't
      // queue a second copy of the modal.
      hasPromptedForThisConflict.current = true;
      setIsPromptOpen(true);
      // Auto-pause the simulation so the pilot has unlimited time to decide
      // (unless the user disabled that in settings).
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

  // === THE PHYSICS ENGINE ===
  // This is the simulation's heartbeat: a timer that fires every 50 real milliseconds
  // and moves both planes forward by one step. Everything visual (aircraft positions,
  // trails, the conflict analysis, the 3D scene) flows out of the state written here.
  useEffect(() => {
    // Paused? Don't even start the timer.
    if (!isSimulating) return;

    const intervalMs = 50;
    // How many SIMULATED seconds pass per tick: 0.05 s at 1x speed, scaled up by the
    // speed slider (at 8x, one real second covers 8 simulated seconds).
    const simDtSec = (intervalMs / 1000) * simSpeed;

    const interval = setInterval(() => {
      setSimTimeSec((prev) => prev + simDtSec);

      // --- Move Plane A one step ---
      setPlaneA((currA) => {
        // Start from the current values; each block below may adjust them.
        let newHeading = currA.heading;
        let newTurnRate = 0;
        let newBankAngle = 0;
        let newVerticalSpeed = currA.verticalSpeed;

        // STEERING: if an escape maneuver set a target heading, steer towards it.
        if (targetFlightPlanA.current.targetHeading !== null) {
          const targetH = targetFlightPlanA.current.targetHeading;
          let diff = targetH - newHeading;
          // Compass headings wrap around: 10 deg to 350 deg is a 20 deg LEFT turn,
          // not a 340 deg right turn. These two loops fold the difference into
          // (-180, +180] so the plane always turns the SHORT way round the compass.
          while (diff < -180) diff += 360;
          while (diff > 180) diff -= 360;

          if (Math.abs(diff) > 0.5) {
            // Still off-target: turn at 8.5 deg/s (a hard evasive rate) in the
            // correct direction. min(...) prevents overshooting the target on the
            // final tick; the +360 % 360 keeps the result in 0-359.
            const turnStep = 8.5 * simDtSec;
            const turnDir = Math.sign(diff);
            newTurnRate = turnDir * 8.5;
            newBankAngle = turnDir * 35; // Sharp 35-degree evasive bank
            newHeading = (newHeading + turnDir * Math.min(Math.abs(diff), turnStep) + 360) % 360;
          } else {
            // Close enough (within half a degree): snap to the target, level the
            // wings, and clear the steering order so we fly straight from here.
            newHeading = targetH;
            newTurnRate = 0;
            newBankAngle = 0;
            targetFlightPlanA.current.targetHeading = null;
          }
        }

        // VERTICAL STEERING: same idea for climb/descent - ramp the vertical speed
        // towards the ordered value at up to 850 ft/min per simulated second (a
        // strong but plausible vertical acceleration), instead of jumping instantly.
        if (targetFlightPlanA.current.targetVerticalSpeed !== null) {
          const targetVS = targetFlightPlanA.current.targetVerticalSpeed;
          const vsDiff = targetVS - newVerticalSpeed;
          if (Math.abs(vsDiff) > 50) {
            newVerticalSpeed += Math.sign(vsDiff) * Math.min(Math.abs(vsDiff), 850 * simDtSec);
          } else {
            newVerticalSpeed = targetVS;
          }
        }

        // MOVE: split "speed along a compass heading" into north/east components
        // (NM per hour), scale by the step time to get NM moved this tick, and add
        // to the position. Altitude comes from vertical speed (ft/min scaled to the
        // step), floored at 1,000 ft so a plane can never sink into the ground.
        const vA = getVelocityComponents(currA.speed, newHeading);
        const newX = currA.position.x + (vA.vx / 3600) * simDtSec;
        const newY = currA.position.y + (vA.vy / 3600) * simDtSec;
        const newZ = Math.max(1000, currA.position.z + (newVerticalSpeed / 60) * simDtSec);

        const newPos = { x: newX, y: newY, z: newZ };
        const { lat, lon } = nmToLatLon(newX, newY);
        // Nose attitude for the 3D model: roughly proportional to climb rate,
        // clamped to -12..+15 deg so the model never points absurdly up or down.
        const pitchAngle = Math.max(-12, Math.min(15, newVerticalSpeed / 250));

        // The DECIDED route only starts recording after the pilot has picked an
        // escape maneuver - it is the "what we actually flew after deciding" trail,
        // drawn as a solid line in the 3D view to contrast with the pre-decision path.
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
          // Keep the last 180 breadcrumbs (about 9 simulated seconds at 20 ticks/s)
          // as the fading smoke trail behind the plane.
          history: [...currA.history.slice(-180), { ...newPos }],
          decidedRoute: updatedDecidedRoute,
        };
      });

      // --- Move Plane B one step ---
      // IDENTICAL physics to Plane A (same steering, vertical ramp, and movement
      // math as commented above), just reading Plane B's own state and flight plan.
      // During a coordinated TCAS resolution its orders are the OPPOSITE of A's
      // (A climbs while B dives) - that coordination is set up in
      // handleSelectResolutionOption, not here.
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

      // Log one row for the separation-over-time chart: keep only the last 90
      // points (the chart shows the most recent window, not the whole run).
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

    // Cleanup: if the component re-renders (e.g. speed changed) or unmounts,
    // stop the old timer before a new one is created - otherwise timers would
    // stack up and the simulation would run multiple steps per tick.
    return () => clearInterval(interval);
  }, [isSimulating, simSpeed, conflict.distanceNM, planeA.position.z, planeB.position.z, simTimeSec]);

  // Load Scenario Preset
  // Load a ready-made scenario (head-on, crossing...): reset both planes to the preset positions and restart the clock.
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
  // Put both planes back where they started and clear the conflict state.
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
  // Advance the simulation one time step (used by the play/pause stepping control).
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
  // The user picked an escape maneuver in the prompter: apply its climb/turn to the planes and mark the conflict resolved.
  const handleSelectResolutionOption = (option: ResolutionOption) => {
    setIsPromptOpen(false);

    // Translate the chosen option's relative changes ("turn +30 deg", "climb at
    // +2,800 ft/min") into ABSOLUTE targets for Flight A. A delta of 0 means "no
    // change on that axis", which we store as null so the physics loop skips it.
    // (+360) % 360 keeps the compass target in the 0-359 range.
    const targetHeadingA =
      option.headingDelta !== 0 ? (planeA.heading + option.headingDelta + 360) % 360 : null;
    const targetVerticalSpeedA = option.targetVerticalSpeed !== 0 ? option.targetVerticalSpeed : null;

    targetFlightPlanA.current = {
      targetHeading: targetHeadingA,
      targetVerticalSpeed: targetVerticalSpeedA,
      targetAltitude: option.altitudeDelta !== 0 ? planeA.position.z + option.altitudeDelta : null,
      maneuverStartTime: simTimeSec,
    };

    // Flight B gets a COORDINATED response, like real TCAS: the two aircraft's
    // systems talk to each other so one climbs while the other descends, doubling
    // the vertical separation rate.
    const targetHeadingB =
      // If the option specifies a separate heading change for B, apply it;
      // otherwise B keeps its current heading (only A turns).
      option.headingDeltaB !== undefined && option.headingDeltaB !== 0
        ? (planeB.heading + option.headingDeltaB + 360) % 360
        : null;
    const targetVerticalSpeedB =
      // Priority: (1) an explicit vertical order for B if the option carries one,
      // (2) otherwise the OPPOSITE of A's climb/descent (the coordination rule -
      // note the minus sign), (3) nothing if A isn't changing altitude either.
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

    // Mark Flight A resolved: hasResolved makes the physics loop start recording
    // the "decided route" trail from this exact position (see the tick loop above).
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

    // Reassure the pilot audibly and resume the simulation so we can watch the
    // chosen maneuver physically play out.
    avionicsAudio.playClearOfConflict();
    setIsSimulating(true);
  };

  // Silence or re-enable the cockpit voice alerts.
  const handleToggleMute = () => {
    setIsAudioMuted((prev) => {
      const next = !prev;
      avionicsAudio.isMuted = next;
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col font-sans">
      {/* High-Visibility Navigation Top Bar - AXIS Airspace eXecution & Intercept System */}
      <header className="flex items-center justify-between px-6 py-3.5 border-b border-blue-900/60 bg-black/95 backdrop-blur-md sticky top-0 z-40 shadow-2xl">
        {/* Zone 1: Wordmark */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-600/35 border border-blue-400/40">
            <Crosshair className="w-6 h-6 text-white stroke-[2.5]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl font-black tracking-tight text-white font-display">
                AXIS
              </span>
              <span className="text-[11px] font-mono text-blue-400 font-black uppercase tracking-widest bg-blue-950/90 border border-blue-700/60 px-2 py-0.5 rounded">
                FL140 (14,000 FT)
              </span>
            </div>
            <span className="text-xs font-mono text-blue-300 font-bold hidden md:inline">
              Airspace eXecution &amp; Intercept System · TCAS II &amp; FLARM Engine
            </span>
          </div>
        </div>

        {/* Zone 2: Navigation Links */}
        <nav className="hidden lg:flex items-center gap-6 text-xs font-bold text-slate-300">
          <a href="#3d-visualizer" className="hover:text-blue-400 transition-colors">
            3D Spatial Visualizer
          </a>
          <a href="#pruning-scope" className="hover:text-blue-400 text-blue-400 font-extrabold transition-colors">
            3D Trajectory Predictor &amp; Pruning Scope
          </a>
          <a href="#tactical-map" className="hover:text-blue-400 transition-colors">
            2D Tactical Configurator
          </a>
          <a href="#cockpit-cdti" className="hover:text-blue-400 transition-colors">
            Cockpit CDTI &amp; TCAS VSI
          </a>
          <a href="#telemetry-feed" className="hover:text-blue-400 transition-colors">
            ADS-B Telemetry Data
          </a>
        </nav>

        {/* Zone 3: Actions & Status Indicator */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => handleLoadScenario(SCENARIO_PRESETS[0])}
            className="px-3.5 py-1.5 text-xs font-bold text-white bg-neutral-900 hover:bg-neutral-800 rounded-lg transition-colors flex items-center gap-1.5 border border-neutral-700 shadow"
            title="Reset to Head-On Conflict scenario (FL140)"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Reset Scenario</span>
          </button>

          <div
            className={`px-3 py-1.5 text-xs font-mono font-bold rounded-lg border flex items-center gap-2 shadow-md ${
              conflict.tcasStatus === 'RESOLUTION_ADVISORY' || conflict.isWithinEmergencyRange
                ? 'bg-blue-950 text-white border-blue-500 shadow-blue-950/60'
                : conflict.tcasStatus === 'TRAFFIC_ADVISORY'
                ? 'bg-neutral-900 text-blue-300 border-blue-700'
                : 'bg-neutral-950 text-slate-300 border-neutral-800'
            }`}
          >
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                conflict.tcasStatus === 'RESOLUTION_ADVISORY' || conflict.isWithinEmergencyRange
                  ? 'bg-blue-400'
                  : conflict.tcasStatus === 'TRAFFIC_ADVISORY'
                  ? 'bg-blue-300'
                  : 'bg-slate-400'
              }`}
            />
            <span>
              {conflict.isWithinEmergencyRange
                ? 'EMERGENCY: ≤ 12 NM ENVELOPE'
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

        {/* AXIS 3D Trajectory Predictor & Algorithmic Pruning Scope (independent of the live simulation) */}
        <div id="pruning-scope" className="w-full flex flex-col shadow-2xl scroll-mt-20">
          <TrajectoryPipeline3D />
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
      <footer className="mt-8 border-t border-neutral-800 px-6 py-4 bg-black text-center text-xs font-mono text-slate-400">
        AXIS: Airspace eXecution &amp; Intercept System · Tactical Flight Trajectory Prediction &amp; TCAS II v7.1 Avoidance Engine · Default Flight Level FL140 (14,000 FT)
      </footer>
    </div>
  );
}
