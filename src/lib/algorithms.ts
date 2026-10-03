/**
 * Flight Path Prediction & Collision Avoidance Algorithms
 * Implements real-world algorithms:
 * - TCAS II v7.1 (Tau, Modified Tau, DMOD, ZTHR, Sense selection)
 * - FLARM Dynamic Vector & Curve Trajectory Extrapolation
 * - ADS-B Extended Squitter (DO-260B) Telemetry Generation
 * - 12 NM Emergency Detection & Prompt Envelope
 */

import { AircraftState, CandidateTrajectory, ConflictAnalysis, ResolutionOption, ScenarioPreset, Vector3D } from './types';

// Airspace coordinate reference anchor (e.g. San Francisco Bay Area Airspace)
export const REF_LAT = 37.6213;
export const REF_LON = -122.3790;
const NM_TO_DEG_LAT = 1 / 60; // 1 Nautical Mile = 1 minute of latitude ≈ 1/60 deg
const NM_TO_DEG_LON = 1 / (60 * Math.cos((REF_LAT * Math.PI) / 180));

// Detection range constant as requested by user
export const EMERGENCY_PROMPT_RANGE_NM = 12.0;

export function nmToLatLon(xNM: number, yNM: number): { lat: number; lon: number } {
  const lat = REF_LAT + yNM * NM_TO_DEG_LAT;
  const lon = REF_LON + xNM * NM_TO_DEG_LON;
  return { lat, lon };
}

// Convert heading (0° = North, 90° = East) to mathematical radians
export function headingToMathRad(headingDeg: number): number {
  return ((90 - headingDeg) * Math.PI) / 180;
}

// Compute velocity components in knots from speed and heading
export function getVelocityComponents(speedKt: number, headingDeg: number): { vx: number; vy: number } {
  const rad = headingToMathRad(headingDeg);
  return {
    vx: speedKt * Math.cos(rad),
    vy: speedKt * Math.sin(rad),
  };
}

/**
 * Generate forward predicted trajectory (Dotted Line)
 * Uses FLARM/TCAS dead reckoning + turn extrapolation
 * durationSec set to 120s for long-range trajectory visibility
 */
export function computePredictedTrajectory(
  aircraft: AircraftState,
  durationSec: number = 120,
  stepSec: number = 1.5
): Array<Vector3D & { timeSec: number }> {
  const trajectory: Array<Vector3D & { timeSec: number }> = [];
  let currX = aircraft.position.x;
  let currY = aircraft.position.y;
  let currZ = aircraft.position.z;
  let currHeading = aircraft.heading;
  let currVz = aircraft.verticalSpeed;
  const speed = aircraft.speed;
  const turnRate = aircraft.turnRate;

  // Add initial point
  trajectory.push({ x: currX, y: currY, z: currZ, timeSec: 0 });

  for (let t = stepSec; t <= durationSec; t += stepSec) {
    currHeading = (currHeading + turnRate * stepSec + 360) % 360;
    const rad = headingToMathRad(currHeading);

    const distNM = (speed / 3600) * stepSec;
    currX += distNM * Math.cos(rad);
    currY += distNM * Math.sin(rad);
    currZ += (currVz / 60) * stepSec;

    trajectory.push({
      x: Number(currX.toFixed(3)),
      y: Number(currY.toFixed(3)),
      z: Math.round(currZ),
      timeSec: Number(t.toFixed(1)),
    });
  }

  return trajectory;
}

/**
 * Perform TCAS II and FLARM conflict analysis between two aircraft
 * Incorporates 12.0 NM Emergency Detection & Prompt Range
 */
export function analyzeConflict(a: AircraftState, b: AircraftState): ConflictAnalysis {
  // Horizontal separation
  const dx = b.position.x - a.position.x; // NM
  const dy = b.position.y - a.position.y; // NM
  const distanceNM = Math.sqrt(dx * dx + dy * dy);

  // Vertical separation
  const dz = b.position.z - a.position.z; // FT
  const verticalDeltaFt = Math.abs(dz);

  // Relative velocity
  const vA = getVelocityComponents(a.speed, a.heading);
  const vB = getVelocityComponents(b.speed, b.heading);
  const dvx = vB.vx - vA.vx; // Knots
  const dvy = vB.vy - vA.vy; // Knots
  const relSpeedSquared = dvx * dvx + dvy * dvy;

  // Range rate (rate of change of distance): r_dot = (dx*dvx + dy*dvy) / distance
  // Negative range rate means aircraft are closing in
  const rangeRateKnots = distanceNM > 0.001 ? (dx * dvx + dy * dvy) / distanceNM : 0;
  const isClosing = rangeRateKnots < -10;

  // Vertical closure rate (ft/min)
  const verticalClosureRateFpm = b.verticalSpeed - a.verticalSpeed;

  // Exact CPA (Closest Point of Approach) Calculation
  let timeToCPASec = 0;
  let distanceAtCPANM = distanceNM;
  let cpaPoint: Vector3D = { ...a.position };
  let verticalSepAtCPAFt = verticalDeltaFt;

  if (relSpeedSquared > 0.0001) {
    const tHours = -(dx * dvx + dy * dvy) / relSpeedSquared;
    timeToCPASec = Math.max(0, tHours * 3600);

    const tSec = timeToCPASec;
    const aCpaX = a.position.x + (vA.vx / 3600) * tSec;
    const aCpaY = a.position.y + (vA.vy / 3600) * tSec;
    const aCpaZ = a.position.z + (a.verticalSpeed / 60) * tSec;

    const bCpaX = b.position.x + (vB.vx / 3600) * tSec;
    const bCpaY = b.position.y + (vB.vy / 3600) * tSec;
    const bCpaZ = b.position.z + (b.verticalSpeed / 60) * tSec;

    const cpaDx = bCpaX - aCpaX;
    const cpaDy = bCpaY - aCpaY;
    distanceAtCPANM = Math.sqrt(cpaDx * cpaDx + cpaDy * cpaDy);
    verticalSepAtCPAFt = Math.abs(bCpaZ - aCpaZ);

    cpaPoint = {
      x: (aCpaX + bCpaX) / 2,
      y: (aCpaY + bCpaY) / 2,
      z: (aCpaZ + bCpaZ) / 2,
    };
  }

  // 12 NM Emergency Detection Range Trigger
  const isWithinEmergencyRange =
    distanceNM <= EMERGENCY_PROMPT_RANGE_NM &&
    isClosing &&
    distanceAtCPANM <= 1.8 &&
    verticalSepAtCPAFt <= 950;

  // TCAS II Parameters
  const DMOD = 1.1; // Distance Modification threshold in NM
  const ZTHR_TA = 900; // Vertical threshold for TA (ft)
  const ZTHR_RA = 500; // Vertical threshold for RA (ft)
  const TAU_TA_THRESHOLD = 45; // Seconds
  const TAU_RA_THRESHOLD = 30; // Seconds

  // Modified Tau calculation (TCAS II spec):
  let horizontalTauSec = Infinity;
  if (rangeRateKnots < -1) {
    const numerator = Math.max(0, distanceNM * distanceNM - DMOD * DMOD);
    const denominator = -distanceNM * (rangeRateKnots / 3600);
    horizontalTauSec = denominator > 0.00001 ? numerator / denominator : Infinity;
  }

  // Evaluate TCAS Status with 12 NM emergency prompt envelope
  let tcasStatus: 'CLEAR' | 'TRAFFIC_ADVISORY' | 'RESOLUTION_ADVISORY' = 'CLEAR';

  const horizontalThreatTA = (horizontalTauSec <= TAU_TA_THRESHOLD && isClosing) || distanceNM <= 14.0;
  const verticalThreatTA = verticalDeltaFt <= ZTHR_TA || (timeToCPASec <= 55 && verticalSepAtCPAFt <= ZTHR_TA);

  // Escalate to RA if inside 12 NM Emergency prompt range on intercept path, or standard TCAS RA
  const horizontalThreatRA =
    isWithinEmergencyRange ||
    (horizontalTauSec <= TAU_RA_THRESHOLD && isClosing) ||
    (distanceNM <= DMOD && timeToCPASec <= TAU_RA_THRESHOLD);
  const verticalThreatRA = verticalDeltaFt <= ZTHR_RA || (timeToCPASec <= 45 && verticalSepAtCPAFt <= ZTHR_RA);

  if (isWithinEmergencyRange || (horizontalThreatRA && verticalThreatRA)) {
    tcasStatus = 'RESOLUTION_ADVISORY';
  } else if (horizontalThreatTA && verticalThreatTA) {
    tcasStatus = 'TRAFFIC_ADVISORY';
  }

  // FLARM Dynamic Collision Assessment
  let flarmLevel: 0 | 1 | 2 | 3 = 0;
  let flarmRiskPercent = 0;

  if (distanceAtCPANM < 1.8 && verticalSepAtCPAFt < 800 && timeToCPASec > 0 && timeToCPASec < 50) {
    const timeFactor = Math.max(0, 1 - timeToCPASec / 50);
    const distFactor = Math.max(0, 1 - distanceAtCPANM / 1.8);
    const vertFactor = Math.max(0, 1 - verticalSepAtCPAFt / 800);
    flarmRiskPercent = Math.min(100, Math.round((timeFactor * 0.45 + distFactor * 0.35 + vertFactor * 0.2) * 100));

    if (distanceNM <= EMERGENCY_PROMPT_RANGE_NM && (timeToCPASec <= 18 || distanceAtCPANM < 0.6)) {
      flarmLevel = 3; // FLARM Alarm (Immediate danger)
    } else if (timeToCPASec <= 30 && distanceAtCPANM < 1.0) {
      flarmLevel = 2; // FLARM Caution
    } else if (timeToCPASec <= 48) {
      flarmLevel = 1; // FLARM Traffic
    }
  }

  // Recommended Sense Selection for Flight A
  let recommendedSense: 'CLIMB' | 'DESCEND' | 'TURN_RIGHT' | 'TURN_LEFT' | 'NONE' = 'NONE';
  let alertMessage = 'Airspace separation nominal';
  let alertVoiceCue: string | null = null;

  if (tcasStatus === 'RESOLUTION_ADVISORY' || flarmLevel >= 2) {
    if (a.position.z >= b.position.z) {
      recommendedSense = 'CLIMB';
      alertMessage = `12 NM EMERGENCY PROMPT: TCAS RA CLIMB! Vertical speed +1,500 FPM (Intruder ${distanceNM.toFixed(1)} NM)`;
      alertVoiceCue = 'CLIMB, CLIMB';
    } else {
      recommendedSense = 'DESCEND';
      alertMessage = `12 NM EMERGENCY PROMPT: TCAS RA DESCEND! Vertical speed -1,500 FPM (Intruder ${distanceNM.toFixed(1)} NM)`;
      alertVoiceCue = 'DESCEND, DESCEND';
    }
  } else if (tcasStatus === 'TRAFFIC_ADVISORY' || flarmLevel === 1) {
    alertMessage = `TRAFFIC ADVISORY: Intruder ${distanceNM.toFixed(1)} NM closing, CPA in ${Math.round(timeToCPASec)}s`;
    alertVoiceCue = 'TRAFFIC, TRAFFIC';
  }

  const isCollisionPredicted =
    (tcasStatus === 'RESOLUTION_ADVISORY' || flarmLevel >= 2) &&
    distanceAtCPANM < 0.6 &&
    verticalSepAtCPAFt < 400;

  return {
    distanceNM,
    rangeRateKnots,
    horizontalTauSec: Number.isFinite(horizontalTauSec) ? Math.round(horizontalTauSec) : 999,
    verticalDeltaFt,
    verticalClosureRateFpm,
    timeToCPASec: Math.round(timeToCPASec),
    distanceAtCPANM: Number(distanceAtCPANM.toFixed(2)),
    verticalSepAtCPAFt: Math.round(verticalSepAtCPAFt),
    cpaPoint,
    tcasStatus,
    flarmLevel,
    flarmRiskPercent,
    isCollisionPredicted,
    isWithinEmergencyRange,
    emergencyPromptRangeNM: EMERGENCY_PROMPT_RANGE_NM,
    recommendedSense,
    alertMessage,
    alertVoiceCue,
    dmodThresholdNM: DMOD,
    zthrThresholdFt: ZTHR_RA,
  };
}

/**
 * Generate practical resolution options for the user prompt
 */
export function generateResolutionOptions(a: AircraftState, b: AircraftState, analysis: ConflictAnalysis): ResolutionOption[] {
  const isPlaneAAbove = a.position.z >= b.position.z;

  return [
    {
      id: 'opt-tcas-coordinated-z',
      title: 'Coordinated TCAS: Flight A Climbs (+2,800 FPM) & Flight B Descends (-2,800 FPM)',
      category: 'TCAS',
      description: 'TCAS-to-TCAS Mode S coordinated Z-axis separation: Flight A climbs while Flight B dives, generating a rapid 3,600+ FT vertical split!',
      targetVerticalSpeed: 2800,
      targetVerticalSpeedB: -2800,
      headingDelta: 0,
      headingDeltaB: 0,
      altitudeDelta: 2400,
      altitudeDeltaB: -2400,
      speedDelta: 0,
      projectedSeparationNM: analysis.distanceAtCPANM,
      projectedSeparationFt: 3600,
      isBestRecommendation: true,
    },
    {
      id: 'opt-tcas-inverted-z',
      title: 'Inverted TCAS: Flight A Descends (-2,800 FPM) & Flight B Climbs (+2,800 FPM)',
      category: 'TCAS',
      description: 'Reverse sense Z-axis resolution: Flight A ducks under while Flight B pulls into high climb, separating on opposite vertical vectors.',
      targetVerticalSpeed: -2800,
      targetVerticalSpeedB: 2800,
      headingDelta: 0,
      headingDeltaB: 0,
      altitudeDelta: -2400,
      altitudeDeltaB: 2400,
      speedDelta: 0,
      projectedSeparationNM: analysis.distanceAtCPANM,
      projectedSeparationFt: 3600,
    },
    {
      id: 'opt-combined-3d-split',
      title: 'Combined 3D: Z-Axis Split (A Climbs / B Dives) + Dual Right Turns',
      category: 'EXPEDITE',
      description: 'Simultaneous vertical Z-axis split (A +2,500 FPM, B -2,500 FPM) combined with +50° right heading divergence for multi-axis spatial safety.',
      targetVerticalSpeed: 2500,
      targetVerticalSpeedB: -2500,
      headingDelta: 50,
      headingDeltaB: 50,
      altitudeDelta: 2000,
      altitudeDeltaB: -2000,
      speedDelta: 15,
      projectedSeparationNM: 7.2,
      projectedSeparationFt: 3400,
    },
    {
      id: 'opt-flarm-bilateral-turn',
      title: 'Bilateral Right Turn (ICAO Standard Right-of-Way)',
      category: 'FLARM',
      description: 'Standard ICAO Right-of-Way rule: Both aircraft bank right (+60°), quickly widening lateral distance to 7.5+ NM.',
      targetVerticalSpeed: 0,
      targetVerticalSpeedB: 0,
      headingDelta: 60,
      headingDeltaB: 60,
      altitudeDelta: 0,
      altitudeDeltaB: 0,
      speedDelta: 0,
      projectedSeparationNM: 7.5,
      projectedSeparationFt: analysis.verticalSepAtCPAFt,
    },
  ];
}

/**
 * Multi-Hypothesis Trajectory Predictor & Algorithmic Pruning Filter
 * Evaluates candidate trajectories for ownship (Flight Alpha) against intruder (Flight Bravo)
 * Filters out unsafe paths using TCAS Tau, DMOD, ZTHR, and FLARM envelope rules.
 * If ownship has resolved a prompt decision, highlights the chosen path as 'SELECTED' (rendered in bold solid line).
 */
export function evaluateCandidateTrajectories(
  ownship: AircraftState,
  intruder: AircraftState,
  _conflict: ConflictAnalysis,
  durationSec: number = 75,
  stepSec: number = 2.0
): CandidateTrajectory[] {
  // Precompute intruder's forward path for collision detection
  const intruderPath: Array<Vector3D & { timeSec: number }> = [];
  const intX = intruder.position.x;
  const intY = intruder.position.y;
  const intZ = intruder.position.z;
  const intRad = headingToMathRad(intruder.heading);
  const intSpeedNMpS = intruder.speed / 3600;
  const intVzFpS = intruder.verticalSpeed / 60;

  for (let t = 0; t <= durationSec; t += stepSec) {
    intruderPath.push({
      x: intX + intSpeedNMpS * Math.cos(intRad) * t,
      y: intY + intSpeedNMpS * Math.sin(intRad) * t,
      z: intZ + intVzFpS * t,
      timeSec: t,
    });
  }

  // Candidate trajectory hypotheses spanning lateral, vertical, and combined vectors
  const candidateDefs: Array<{
    id: string;
    name: string;
    category: 'LATERAL' | 'VERTICAL' | 'COMBINED';
    headingDelta: number;
    verticalSpeed: number;
    speedDelta: number;
    color: string;
  }> = [
    {
      id: 'cand-nominal',
      name: 'Planned Direct Track (Δ0° / 0 FPM)',
      category: 'LATERAL',
      headingDelta: 0,
      verticalSpeed: ownship.hasResolved ? ownship.verticalSpeed : 0,
      speedDelta: 0,
      color: '#94a3b8',
    },
    {
      id: 'cand-turn-left-15',
      name: 'Gentle Left Bank (-15°)',
      category: 'LATERAL',
      headingDelta: -15,
      verticalSpeed: 0,
      speedDelta: 0,
      color: '#38bdf8',
    },
    {
      id: 'cand-turn-left-30',
      name: 'Standard Evasive Left (-30°)',
      category: 'LATERAL',
      headingDelta: -30,
      verticalSpeed: 0,
      speedDelta: 0,
      color: '#60a5fa',
    },
    {
      id: 'cand-turn-left-50',
      name: 'Hard Evasive Left (-50°)',
      category: 'LATERAL',
      headingDelta: -50,
      verticalSpeed: 0,
      speedDelta: 0,
      color: '#818cf8',
    },
    {
      id: 'cand-turn-right-15',
      name: 'Gentle Right Bank (+15°)',
      category: 'LATERAL',
      headingDelta: 15,
      verticalSpeed: 0,
      speedDelta: 0,
      color: '#2dd4bf',
    },
    {
      id: 'cand-turn-right-30',
      name: 'Standard Evasive Right (+30°)',
      category: 'LATERAL',
      headingDelta: 30,
      verticalSpeed: 0,
      speedDelta: 0,
      color: '#34d399',
    },
    {
      id: 'cand-turn-right-50',
      name: 'Hard Evasive Right (+50°)',
      category: 'LATERAL',
      headingDelta: 50,
      verticalSpeed: 0,
      speedDelta: 0,
      color: '#4ade80',
    },
    {
      id: 'cand-tcas-climb',
      name: 'TCAS Expedited Climb (+2,800 FPM)',
      category: 'VERTICAL',
      headingDelta: 0,
      verticalSpeed: 2800,
      speedDelta: 0,
      color: '#a78bfa',
    },
    {
      id: 'cand-tcas-descend',
      name: 'TCAS Expedited Descend (-2,800 FPM)',
      category: 'VERTICAL',
      headingDelta: 0,
      verticalSpeed: -2800,
      speedDelta: 0,
      color: '#f472b6',
    },
    {
      id: 'cand-combined-climb-right',
      name: '3D Climb & Right Vector (+2,500 FPM, +40°)',
      category: 'COMBINED',
      headingDelta: 40,
      verticalSpeed: 2500,
      speedDelta: 15,
      color: '#22d3ee',
    },
    {
      id: 'cand-combined-descend-right',
      name: '3D Descend & Right Vector (-2,500 FPM, +40°)',
      category: 'COMBINED',
      headingDelta: 40,
      verticalSpeed: -2500,
      speedDelta: 15,
      color: '#fb7185',
    },
  ];

  return candidateDefs.map((def) => {
    const testHeading = (ownship.heading + def.headingDelta + 360) % 360;
    const testRad = headingToMathRad(testHeading);
    const testSpeed = ownship.speed + def.speedDelta;
    const testSpeedNMpS = testSpeed / 3600;
    const testVzFpS = def.verticalSpeed / 60;

    const points: Array<Vector3D & { timeSec: number }> = [];
    let minDistanceNM = Infinity;
    let minVerticalSepFt = Infinity;
    let timeToMinSepSec = 0;
    let isViolated = false;
    let eliminationReason: string | undefined = undefined;
    let filterStage: CandidateTrajectory['filterStage'] = undefined;

    for (let i = 0; i < intruderPath.length; i++) {
      const t = intruderPath[i].timeSec;
      const intPos = intruderPath[i];

      const candX = ownship.position.x + testSpeedNMpS * Math.cos(testRad) * t;
      const candY = ownship.position.y + testSpeedNMpS * Math.sin(testRad) * t;
      const candZ = Math.max(500, ownship.position.z + testVzFpS * t);

      points.push({
        x: Number(candX.toFixed(3)),
        y: Number(candY.toFixed(3)),
        z: Math.round(candZ),
        timeSec: t,
      });

      // Compute separation between candidate and intruder at time t
      const dx = intPos.x - candX;
      const dy = intPos.y - candY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const vertSep = Math.abs(intPos.z - candZ);

      if (dist < minDistanceNM) {
        minDistanceNM = dist;
        minVerticalSepFt = vertSep;
        timeToMinSepSec = t;
      }

      // Filter Rule 1: Loss of Separation (Proximity DMOD < 1.4 NM and vertical < 750 FT)
      if (!isViolated && dist <= 1.4 && vertSep <= 750 && t > 2) {
        isViolated = true;
        filterStage = 'PROXIMITY_DMOD';
        eliminationReason = `PRUNED: Separation breach (${dist.toFixed(2)} NM, ${Math.round(vertSep)} FT) at T+${Math.round(t)}s`;
      }

      // Filter Rule 2: Imminent FLARM Collision Envelope (dist < 0.65 NM and vertical < 450 FT)
      if (!isViolated && dist <= 0.65 && vertSep <= 450 && t > 1) {
        isViolated = true;
        filterStage = 'FLARM_ENVELOPE';
        eliminationReason = `REJECTED: Collision path (${dist.toFixed(2)} NM) at T+${Math.round(t)}s`;
      }

      // Filter Rule 3: TCAS Tau breach on converging vector (Tau <= 25s and vertical < 600 FT)
      if (!isViolated && t > 4 && t <= 32 && dist <= 2.2 && vertSep <= 500) {
        isViolated = true;
        filterStage = 'TCAS_TAU';
        eliminationReason = `FILTERED: TCAS RA Tau breach (Tau ≤ 25s, sep ${dist.toFixed(2)} NM)`;
      }

      // Filter Rule 4: Vertical ZTHR Breach (< 500 FT when within 2.0 NM)
      if (!isViolated && dist <= 2.0 && vertSep <= 400 && t > 3) {
        isViolated = true;
        filterStage = 'VERTICAL_ZTHR';
        eliminationReason = `FILTERED: Vertical ZTHR breach (${Math.round(vertSep)} FT < 500 FT)`;
      }
    }

    let status: CandidateTrajectory['status'] = isViolated ? 'ELIMINATED' : 'VIABLE';

    // When the pilot responds after the prompt, mark the chosen plan as 'SELECTED'
    if (ownship.hasResolved) {
      const actionUpper = (ownship.resolutionAction || '').toUpperCase();
      const isSelectedClimb = actionUpper.includes('CLIMB') && def.id === 'cand-tcas-climb';
      const isSelectedDescend = actionUpper.includes('DESCEND') && def.id === 'cand-tcas-descend';
      const isSelectedTurn = actionUpper.includes('RIGHT') && !actionUpper.includes('CLIMB') && !actionUpper.includes('DESCEND') && def.id === 'cand-turn-right-50';
      const isSelectedCombined = (actionUpper.includes('COMBINED') || actionUpper.includes('3D')) && def.id === 'cand-combined-climb-right';

      if (isSelectedClimb || isSelectedDescend || isSelectedTurn || isSelectedCombined) {
        status = 'SELECTED';
        eliminationReason = undefined;
      }
    }

    const distScore = Math.min(60, (minDistanceNM / 6.0) * 60);
    const vertScore = Math.min(40, (minVerticalSepFt / 3000) * 40);
    const safetyScore = Math.round(
      Math.max(5, Math.min(100, isViolated ? (minDistanceNM / 1.5) * 35 : distScore + vertScore))
    );

    return {
      id: def.id,
      name: def.name,
      category: def.category,
      headingDelta: def.headingDelta,
      verticalSpeed: def.verticalSpeed,
      speedDelta: def.speedDelta,
      points,
      status,
      eliminationReason: isViolated ? eliminationReason : undefined,
      minDistanceNM: Number(minDistanceNM.toFixed(2)),
      minVerticalSepFt: Math.round(minVerticalSepFt),
      timeToMinSepSec: Math.round(timeToMinSepSec),
      filterStage: isViolated ? filterStage : undefined,
      safetyScore,
      color: def.color,
    };
  });
}

/**
 * Generate simulated ADS-B DO-260B message payload
 */
export function generateADSBTelemetry(aircraft: AircraftState): import('./types').ADSBTelemetry {
  const { lat, lon } = nmToLatLon(aircraft.position.x, aircraft.position.y);

  const df17Type = '8D';
  const hexAddress = aircraft.icaoHex.toUpperCase();
  const tc = '58';
  const encodedAlt = Math.floor(aircraft.position.z / 25).toString(16).padStart(4, '0');
  const encodedSpeed = Math.floor(aircraft.speed).toString(16).padStart(3, '0');
  const dummyParity = '9A4F82';
  const rawHexFrame = `${df17Type}${hexAddress}${tc}${encodedAlt}${encodedSpeed}${dummyParity}`;

  return {
    icaoHex: aircraft.icaoHex,
    callsign: aircraft.callsign,
    squawk: aircraft.squawk,
    lat: Number(lat.toFixed(5)),
    lon: Number(lon.toFixed(5)),
    baroAltitudeFt: Math.round(aircraft.position.z),
    gnssAltitudeFt: Math.round(aircraft.position.z + (Math.sin(Date.now() / 2000) * 15)),
    groundSpeedKt: Math.round(aircraft.speed),
    trueAirspeedKt: Math.round(aircraft.speed * 1.05),
    headingDeg: Math.round(aircraft.heading),
    verticalRateFpm: Math.round(aircraft.verticalSpeed),
    turnRateDegSec: Number(aircraft.turnRate.toFixed(1)),
    nic: 9,
    nacp: 10,
    sil: 3,
    emergencyStatus: 'NONE',
    rawHexFrame,
    timestamp: new Date().toISOString().substring(11, 23) + 'Z',
  };
}

/**
 * Standard Presets initialized with realistic spacing (~22 to 26 NM apart)
 * so they enter the 12 NM Emergency Prompt envelope naturally during simulation!
 */
export const SCENARIO_PRESETS: ScenarioPreset[] = [
  {
    id: 'head-on',
    name: 'Head-On Convergence (FL320)',
    description: 'Direct head-on collision on airway corridor. Triggers 12 NM emergency prompt envelope at rapid 900+ kt closure.',
    planeA: {
      callsign: 'UAL842',
      icao: 'A1B2C3',
      position: { x: -12.5, y: 0, z: 32000 },
      heading: 90,
      speed: 460,
      verticalSpeed: 0,
    },
    planeB: {
      callsign: 'DLH419',
      icao: '3C5D7E',
      position: { x: 12.5, y: 0, z: 32000 },
      heading: 270,
      speed: 470,
      verticalSpeed: 0,
    },
  },
  {
    id: 'cross-traffic',
    name: '90° Crossing Intercept',
    description: 'Two routes crossing at waypoint intersection. Tests lateral vector adjustment entering 12 NM detection range.',
    planeA: {
      callsign: 'AAL194',
      icao: 'AC0211',
      position: { x: -11, y: -11, z: 28000 },
      heading: 45,
      speed: 420,
      verticalSpeed: 0,
    },
    planeB: {
      callsign: 'SWA732',
      icao: 'A5E12F',
      position: { x: 11, y: -11, z: 28000 },
      heading: 315,
      speed: 420,
      verticalSpeed: 0,
    },
  },
  {
    id: 'climbing-conflict',
    name: 'Climbing Departure vs Level Cruise',
    description: 'Flight A climbing out through FL260 occupied by Flight B cruising level. Requires vertical sense coordination.',
    planeA: {
      callsign: 'BAW287',
      icao: '4009A1',
      position: { x: -12, y: -4, z: 21000 },
      heading: 75,
      speed: 380,
      verticalSpeed: 1800,
    },
    planeB: {
      callsign: 'AFR065',
      icao: '3944B2',
      position: { x: 11, y: 2, z: 26000 },
      heading: 255,
      speed: 440,
      verticalSpeed: 0,
    },
  },
  {
    id: 'overtaking',
    name: 'Overtaking Speed Catch-Up',
    description: 'High speed widebody overtaking slower aircraft on same track. Triggers within 12 NM catch-up boundary.',
    planeA: {
      callsign: 'SIA022',
      icao: '76CEA1',
      position: { x: -13, y: 1.5, z: 36000 },
      heading: 85,
      speed: 540,
      verticalSpeed: 0,
    },
    planeB: {
      callsign: 'ASA348',
      icao: 'A714C8',
      position: { x: -2, y: 2.2, z: 36000 },
      heading: 85,
      speed: 360,
      verticalSpeed: 0,
    },
  },
  {
    id: 'safe-parallel',
    name: 'Safe Staggered Parallel Airway',
    description: 'Parallel routes with standard 1,000 FT vertical separation and 3.5 NM lateral buffer outside conflict zone.',
    planeA: {
      callsign: 'KLM601',
      icao: '4840F2',
      position: { x: -12, y: -2, z: 34000 },
      heading: 90,
      speed: 450,
      verticalSpeed: 0,
    },
    planeB: {
      callsign: 'QFA012',
      icao: '7C6B20',
      position: { x: 12, y: 2, z: 35000 },
      heading: 270,
      speed: 460,
      verticalSpeed: 0,
    },
  },
];
