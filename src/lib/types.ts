/**
 * Flight Path Prediction & Collision Avoidance Types
 */

export interface Vector3D {
  x: number; // Nautical Miles (NM)
  y: number; // Nautical Miles (NM)
  z: number; // Altitude in Feet (FT)
}

export interface AircraftState {
  id: 'A' | 'B';
  callsign: string;
  icaoHex: string;
  squawk: string;
  model: string;
  position: Vector3D;
  startPosition: Vector3D;
  heading: number; // Degrees 0..360
  initialHeading: number;
  speed: number; // Knots (Ground Speed)
  initialSpeed: number;
  verticalSpeed: number; // Feet per minute (FPM)
  initialVerticalSpeed: number;
  turnRate: number; // Degrees per second
  bankAngle: number; // Degrees roll for 3D realism
  pitchAngle: number; // Degrees pitch for 3D realism
  color: string;
  lat: number;
  lon: number;
  history: Vector3D[];
  decidedRoute: Vector3D[]; // Solid line trajectory taken/decided
  predictedTrajectory: Array<Vector3D & { timeSec: number }>; // Dotted projected path
  hasResolved: boolean;
  resolutionAction: string | null;
  selectedPlan: string | null;
}

export interface ADSBTelemetry {
  icaoHex: string;
  callsign: string;
  squawk: string;
  lat: number;
  lon: number;
  baroAltitudeFt: number;
  gnssAltitudeFt: number;
  groundSpeedKt: number;
  trueAirspeedKt: number;
  headingDeg: number;
  verticalRateFpm: number;
  turnRateDegSec: number;
  nic: number;
  nacp: number;
  sil: number;
  emergencyStatus: 'NONE' | 'GENERAL' | 'RADIO_FAIL' | 'UNLAWFUL';
  rawHexFrame: string;
  timestamp: string;
}

export type TCASStatus = 'CLEAR' | 'TRAFFIC_ADVISORY' | 'RESOLUTION_ADVISORY';
export type FLARMLevel = 0 | 1 | 2 | 3;

export interface ConflictAnalysis {
  distanceNM: number;
  rangeRateKnots: number;
  horizontalTauSec: number;
  verticalDeltaFt: number;
  verticalClosureRateFpm: number;
  timeToCPASec: number;
  distanceAtCPANM: number;
  verticalSepAtCPAFt: number;
  cpaPoint: Vector3D;
  tcasStatus: TCASStatus;
  flarmLevel: FLARMLevel;
  flarmRiskPercent: number;
  isCollisionPredicted: boolean;
  isWithinEmergencyRange: boolean; // Triggers when within 12 NM emergency prompt boundary
  emergencyPromptRangeNM: number; // Set to 12.0 NM as specified
  recommendedSense: 'CLIMB' | 'DESCEND' | 'TURN_RIGHT' | 'TURN_LEFT' | 'NONE';
  alertMessage: string;
  alertVoiceCue: string | null;
  dmodThresholdNM: number;
  zthrThresholdFt: number;
}

export interface ResolutionOption {
  id: string;
  title: string;
  category: 'TCAS' | 'FLARM' | 'LATERAL' | 'EXPEDITE';
  description: string;
  targetVerticalSpeed: number; // Plane A target vertical speed (FPM)
  targetVerticalSpeedB?: number; // Plane B coordinated target vertical speed (e.g. opposite sense)
  headingDelta: number; // Plane A heading adjustment (deg)
  headingDeltaB?: number; // Plane B heading adjustment (deg)
  altitudeDelta: number;
  altitudeDeltaB?: number;
  speedDelta: number;
  projectedSeparationNM: number;
  projectedSeparationFt: number;
  isBestRecommendation?: boolean;
}

export interface CandidateTrajectory {
  id: string;
  name: string;
  category: 'LATERAL' | 'VERTICAL' | 'COMBINED';
  headingDelta: number; // deg
  verticalSpeed: number; // FPM
  speedDelta: number; // knots
  points: Array<Vector3D & { timeSec: number }>;
  status: 'VIABLE' | 'ELIMINATED' | 'SELECTED';
  eliminationReason?: string;
  minDistanceNM: number;
  minVerticalSepFt: number;
  timeToMinSepSec: number;
  filterStage?: 'PROXIMITY_DMOD' | 'TCAS_TAU' | 'VERTICAL_ZTHR' | 'FLARM_ENVELOPE';
  safetyScore: number; // 0 to 100
  color: string;
}

export interface ScenarioPreset {
  id: string;
  name: string;
  description: string;
  planeA: {
    callsign: string;
    icao: string;
    position: Vector3D;
    heading: number;
    speed: number;
    verticalSpeed: number;
  };
  planeB: {
    callsign: string;
    icao: string;
    position: Vector3D;
    heading: number;
    speed: number;
    verticalSpeed: number;
  };
}
