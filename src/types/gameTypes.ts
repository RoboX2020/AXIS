export interface Vector3 {
  x: number; // Nautical Miles or relative units
  y: number; // Nautical Miles
  z: number; // Feet (altitude)
}

export interface PlayerPlane {
  id: string;
  callsign: string;
  color: string;
  position: Vector3;
  velocity: Vector3;
  heading: number; // 0..360 deg
  pitch: number; // -85..85 deg
  roll: number; // -180..180 deg
  speed: number; // Knots
  verticalSpeed: number; // FPM
  throttle: number; // 0..100%
  health: number; // 0..100
  isBot?: boolean;
  score: number;
  lastPing: number;
  history: Vector3[];
}

export interface PlayerControlInput {
  pitchInput: number; // -1 (dive) to +1 (pull up)
  rollInput: number; // -1 (bank left) to +1 (bank right)
  yawInput: number; // -1 (rudder left) to +1 (rudder right)
  throttleInput: number; // 0 to 100%
  airbrake?: boolean;
  afterburner?: boolean;
}

export type ClashSeverity = 'NONE' | 'ADVISORY' | 'WARNING' | 'CRITICAL';

export interface ClashWarning {
  hasThreat: boolean;
  severity: ClashSeverity;
  intruderId: string | null;
  intruderCallsign: string | null;
  distanceNM: number;
  verticalDeltaFt: number;
  timeToImpactSec: number;
  bearingDeg: number;
  suggestion: {
    action: string;
    description: string;
    targetVerticalSpeed?: number;
    targetHeadingDelta?: number;
    targetThrottle?: number;
  } | null;
}

export interface GameRoomState {
  roomId: string;
  players: Record<string, PlayerPlane>;
  hostId: string | null;
  timestamp: number;
}
