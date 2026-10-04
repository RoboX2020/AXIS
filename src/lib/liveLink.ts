import type { AircraftState, ConflictAnalysis } from './types';

export interface LivePlane {
  id: 'A' | 'B';
  callsign: string;
  color: string;
  x: number; y: number; z: number; // NM, NM, FT
  heading: number; pitch: number; bank: number;
  speed: number; vs: number;
  action: string | null;
}
export interface LiveAdvisory {
  level: 'CLEAR' | 'TRAFFIC' | 'RESOLUTION';
  command: 'CLIMB' | 'DESCEND' | 'TURN_RIGHT' | 'TURN_LEFT' | 'NONE';
  text: string;
}
export interface LiveState {
  t: number;
  running: boolean;
  planes: LivePlane[];
  distanceNM: number;
  timeToCPASec: number;
  distanceAtCPANM: number;
  tcas: ConflictAnalysis['tcasStatus'];
  flarm: number;
  advisories: { A: LiveAdvisory; B: LiveAdvisory };
}

const opposite = (s: LiveAdvisory['command']): LiveAdvisory['command'] =>
  s === 'CLIMB' ? 'DESCEND' : s === 'DESCEND' ? 'CLIMB' : s;

const wording: Record<string, string> = {
  CLIMB: 'CLIMB, CLIMB',
  DESCEND: 'DESCEND, DESCEND',
  TURN_RIGHT: 'TURN RIGHT',
  TURN_LEFT: 'TURN LEFT',
  NONE: '',
};

export function buildLiveState(a: AircraftState, b: AircraftState, c: ConflictAnalysis, t: number, running: boolean): LiveState {
  const toPlane = (p: AircraftState): LivePlane => ({
    id: p.id, callsign: p.callsign, color: p.color,
    x: p.position.x, y: p.position.y, z: p.position.z,
    heading: p.heading, pitch: p.pitchAngle, bank: p.bankAngle,
    speed: p.speed, vs: p.verticalSpeed, action: p.resolutionAction,
  });
  const ra = c.recommendedSense !== 'NONE';
  const ta = c.tcasStatus === 'TRAFFIC_ADVISORY' || c.flarmLevel === 1;
  const level: LiveAdvisory['level'] = ra ? 'RESOLUTION' : ta ? 'TRAFFIC' : 'CLEAR';
  const mk = (cmd: LiveAdvisory['command']): LiveAdvisory => ({
    level, command: ra ? cmd : 'NONE',
    text: ra ? wording[cmd] : ta ? 'TRAFFIC, TRAFFIC' : 'CLEAR OF CONFLICT',
  });
  return {
    t, running, planes: [toPlane(a), toPlane(b)],
    distanceNM: c.distanceNM, timeToCPASec: c.timeToCPASec, distanceAtCPANM: c.distanceAtCPANM,
    tcas: c.tcasStatus, flarm: c.flarmLevel,
    advisories: { A: mk(c.recommendedSense), B: mk(opposite(c.recommendedSense)) },
  };
}

export function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const override = new URLSearchParams(location.search).get('server');
  return override ? override : `${proto}://${location.host}/ws`;
}
