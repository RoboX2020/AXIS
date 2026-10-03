import { PlayerPlane, PlayerControlInput, ClashWarning, ClashSeverity } from '../types/gameTypes';

export const CALLSIGNS = [
  'VIPER-01',
  'PHANTOM-02',
  'EAGLE-03',
  'FALCON-04',
  'GHOST-05',
  'RAPTOR-06',
  'STRIKER-07',
  'HORNET-08',
];

export const COLORS = [
  '#06b6d4', // Cyan
  '#f59e0b', // Amber
  '#10b981', // Emerald
  '#ec4899', // Pink
  '#8b5cf6', // Violet
  '#ef4444', // Red
  '#3b82f6', // Blue
  '#14b8a6', // Teal
];

/**
 * Update single aircraft kinematics for a time step dtSec
 */
export function updatePlanePhysics(
  plane: PlayerPlane,
  input: PlayerControlInput,
  dtSec: number
): PlayerPlane {
  // 1. Throttle & Speed (Airspeed in knots)
  const targetThrottle = Math.max(0, Math.min(100, input.throttleInput));
  const throttleLerp = plane.throttle + (targetThrottle - plane.throttle) * Math.min(1, 3.0 * dtSec);

  // Speed ranges from 150 kts to 550 kts (plus afterburner boost up to 700 kts)
  const baseSpeed = 150 + (throttleLerp / 100) * 400;
  const speed = input.afterburner ? baseSpeed * 1.25 : input.airbrake ? baseSpeed * 0.75 : baseSpeed;

  // 2. Pitch Dynamics (Degrees: -60 to +60)
  // Pulling stick back (input > 0) pitches nose up
  const pitchRate = 28; // deg/sec at full deflection
  const targetPitch = Math.max(-60, Math.min(60, plane.pitch + input.pitchInput * pitchRate * dtSec));
  // Natural pitch stabilization towards 0 if no input
  const pitch =
    Math.abs(input.pitchInput) > 0.05
      ? targetPitch
      : plane.pitch * (1 - Math.min(1, 0.8 * dtSec));

  // 3. Roll / Bank Dynamics (Degrees: -75 to +75)
  const rollRate = 45; // deg/sec
  const targetRoll = Math.max(-75, Math.min(75, plane.roll + input.rollInput * rollRate * dtSec));
  const roll =
    Math.abs(input.rollInput) > 0.05
      ? targetRoll
      : plane.roll * (1 - Math.min(1, 1.2 * dtSec));

  // 4. Heading & Yaw (Coordinated turn from bank angle + rudder)
  // Standard turn rate: omega = (g * tan(roll)) / V
  const rollTurnRate = Math.tan((roll * Math.PI) / 180) * 12; // deg/sec
  const yawRate = input.yawInput * 18; // deg/sec rudder
  const totalTurnRate = rollTurnRate + yawRate;
  const heading = (plane.heading + totalTurnRate * dtSec + 360) % 360;

  // 5. Vertical Speed (FPM) derived from pitch and speed
  // Vertical speed = Speed (NM/h) * sin(pitch) * 6076 ft/NM / 60
  const pitchRad = (pitch * Math.PI) / 180;
  const verticalSpeed = speed * Math.sin(pitchRad) * 101.27; // FPM

  // 6. Integrate 3D Position
  const headingRad = ((90 - heading) * Math.PI) / 180;
  const horizontalSpeed = speed * Math.cos(pitchRad); // knots
  const distNM = (horizontalSpeed / 3600) * dtSec;

  const newX = plane.position.x + distNM * Math.cos(headingRad);
  const newY = plane.position.y + distNM * Math.sin(headingRad);
  // Altitude in Feet clamped between 800 ft (ground clearance) and 45,000 ft
  const newZ = Math.max(800, Math.min(45000, plane.position.z + (verticalSpeed / 60) * dtSec));

  // Maintain position history for flight trails
  const history = [...plane.history];
  if (history.length === 0 || Math.hypot(newX - history[history.length - 1].x, newY - history[history.length - 1].y) > 0.15) {
    history.push({ x: newX, y: newY, z: newZ });
    if (history.length > 25) history.shift();
  }

  return {
    ...plane,
    position: { x: newX, y: newY, z: newZ },
    velocity: {
      x: (distNM * Math.cos(headingRad)) / dtSec,
      y: (distNM * Math.sin(headingRad)) / dtSec,
      z: verticalSpeed / 60,
    },
    heading,
    pitch,
    roll,
    speed,
    verticalSpeed,
    throttle: throttleLerp,
    history,
  };
}

/**
 * Compute AI Drone / Bot flight behaviors to create an active dogfight / airspace environment
 */
export function updateBotAI(bot: PlayerPlane, allPlanes: PlayerPlane[], dtSec: number): PlayerControlInput {
  // Find nearest other plane
  let nearestDist = Infinity;
  let nearestPlane: PlayerPlane | null = null;

  for (const other of allPlanes) {
    if (other.id === bot.id) continue;
    const dx = other.position.x - bot.position.x;
    const dy = other.position.y - bot.position.y;
    const dist = Math.hypot(dx, dy);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearestPlane = other;
    }
  }

  // If another plane is close (under 3 NM), perform evasive or dogfight maneuvering
  if (nearestPlane && nearestDist < 3.0) {
    const dz = nearestPlane.position.z - bot.position.z;
    // If lower than intruder, dive or turn away
    const pitchInput = dz > 0 ? -0.4 : 0.5;
    const rollInput = 0.5; // evasive turn
    return {
      pitchInput,
      rollInput,
      yawInput: 0.2,
      throttleInput: 85,
    };
  }

  // Default gentle cruising patrol
  const time = Date.now() / 3000;
  return {
    pitchInput: Math.sin(time + bot.heading) * 0.15,
    rollInput: Math.cos(time * 0.7) * 0.25,
    yawInput: 0,
    throttleInput: 75,
  };
}

/**
 * Real-Time Collision / Clash Warning & Flight Suggestion Engine
 * Scans all other planes around `ownPlane` and generates clash warnings and suggestions
 */
export function computeClashWarning(ownPlane: PlayerPlane, allPlanes: PlayerPlane[]): ClashWarning {
  let closestDistNM = Infinity;
  let closestIntruder: PlayerPlane | null = null;
  let minTimeToImpact = Infinity;

  for (const other of allPlanes) {
    if (other.id === ownPlane.id) continue;

    const dx = other.position.x - ownPlane.position.x;
    const dy = other.position.y - ownPlane.position.y;
    const distNM = Math.hypot(dx, dy);
    const dz = Math.abs(other.position.z - ownPlane.position.z);

    // Relative closure rate (r_dot)
    const ownHeadingRad = ((90 - ownPlane.heading) * Math.PI) / 180;
    const otherHeadingRad = ((90 - other.heading) * Math.PI) / 180;

    const vxOwn = (ownPlane.speed / 3600) * Math.cos(ownHeadingRad);
    const vyOwn = (ownPlane.speed / 3600) * Math.sin(ownHeadingRad);
    const vxOther = (other.speed / 3600) * Math.cos(otherHeadingRad);
    const vyOther = (other.speed / 3600) * Math.sin(otherHeadingRad);

    const relVx = vxOther - vxOwn;
    const relVy = vyOther - vyOwn;
    const rangeRate = distNM > 0.01 ? (dx * relVx + dy * relVy) / distNM : 0; // NM/s

    // Time to closest point of approach
    let ttiSec = Infinity;
    if (rangeRate < -0.001) {
      ttiSec = -distNM / rangeRate;
    }

    if (distNM < closestDistNM) {
      closestDistNM = distNM;
      closestIntruder = other;
      minTimeToImpact = ttiSec;
    }
  }

  if (!closestIntruder || closestDistNM > 8.0) {
    return {
      hasThreat: false,
      severity: 'NONE',
      intruderId: null,
      intruderCallsign: null,
      distanceNM: closestDistNM === Infinity ? 99 : closestDistNM,
      verticalDeltaFt: 9999,
      timeToImpactSec: 999,
      bearingDeg: 0,
      suggestion: null,
    };
  }

  const dz = closestIntruder.position.z - ownPlane.position.z;
  const absDz = Math.abs(dz);

  // Relative bearing from own plane nose (0° straight ahead, +90° right, -90° left)
  const angleToOther = (Math.atan2(closestIntruder.position.y - ownPlane.position.y, closestIntruder.position.x - ownPlane.position.x) * 180) / Math.PI;
  const bearingFromNorth = (90 - angleToOther + 360) % 360;
  let relativeBearing = bearingFromNorth - ownPlane.heading;
  while (relativeBearing > 180) relativeBearing -= 360;
  while (relativeBearing < -180) relativeBearing += 360;

  // Determine Severity
  // CRITICAL: distance <= 1.2 NM and vertical separation <= 600 FT, or TTI <= 15s
  // WARNING: distance <= 3.0 NM and vertical separation <= 1,000 FT, or TTI <= 25s
  // ADVISORY: distance <= 5.5 NM
  let severity: ClashSeverity = 'NONE';
  if ((closestDistNM <= 1.2 && absDz <= 750) || (minTimeToImpact <= 14 && absDz <= 800)) {
    severity = 'CRITICAL';
  } else if ((closestDistNM <= 3.2 && absDz <= 1200) || (minTimeToImpact <= 28 && absDz <= 1200)) {
    severity = 'WARNING';
  } else if (closestDistNM <= 6.0 && absDz <= 2000) {
    severity = 'ADVISORY';
  }

  // Generate Flight Suggestion
  let suggestion: ClashWarning['suggestion'] = null;

  if (severity === 'CRITICAL' || severity === 'WARNING') {
    // TCAS vertical sense rule: if own plane is higher, climb; if lower, dive!
    if (ownPlane.position.z >= closestIntruder.position.z) {
      suggestion = {
        action: 'PULL UP / EXPEDITE CLIMB',
        description: `Climb immediately (+2,500 FPM). Intruder ${closestIntruder.callsign} is ${Math.round(absDz)} FT below!`,
        targetVerticalSpeed: 2500,
        targetThrottle: 95,
      };
    } else {
      suggestion = {
        action: 'PUSH DOWN / EXPEDITE DIVE',
        description: `Descend immediately (-2,200 FPM). Intruder ${closestIntruder.callsign} is ${Math.round(absDz)} FT above!`,
        targetVerticalSpeed: -2200,
        targetThrottle: 80,
      };
    }

    // If head-on or horizontal collision imminent, add lateral bank suggestion
    if (Math.abs(relativeBearing) < 45) {
      // Intruder is right in front
      suggestion = {
        action: 'HARD BREAK RIGHT (+45°)',
        description: `ICAO Standard Right-of-Way: Bank right sharply to clear head-on intercept with ${closestIntruder.callsign}!`,
        targetHeadingDelta: 45,
        targetVerticalSpeed: ownPlane.position.z >= closestIntruder.position.z ? 2000 : -2000,
        targetThrottle: 90,
      };
    } else if (relativeBearing > 0 && relativeBearing < 120) {
      // Intruder approaching from right (Starboard) -> Turn left
      suggestion = {
        action: 'BANK LEFT (-35°)',
        description: `Intruder on starboard at ${closestDistNM.toFixed(1)} NM. Bank left to increase separation.`,
        targetHeadingDelta: -35,
        targetVerticalSpeed: 1500,
      };
    } else if (relativeBearing < 0 && relativeBearing > -120) {
      // Intruder approaching from left (Port) -> Bank right
      suggestion = {
        action: 'BANK RIGHT (+35°)',
        description: `Intruder on port at ${closestDistNM.toFixed(1)} NM. Bank right to increase separation.`,
        targetHeadingDelta: 35,
        targetVerticalSpeed: 1500,
      };
    }
  }

  return {
    hasThreat: severity !== 'NONE',
    severity,
    intruderId: closestIntruder.id,
    intruderCallsign: closestIntruder.callsign,
    distanceNM: Number(closestDistNM.toFixed(2)),
    verticalDeltaFt: Math.round(absDz),
    timeToImpactSec: Number.isFinite(minTimeToImpact) ? Math.round(minTimeToImpact) : 99,
    bearingDeg: Math.round(relativeBearing),
    suggestion,
  };
}
