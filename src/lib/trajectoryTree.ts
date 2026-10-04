/**
 * AXIS Trajectory Pipeline — pure, seeded logic (no three.js).
 *
 * Stage 1  Diffusion-based maximum path generation: every node fans out
 *          `paths_per_hop` children on a spherical cap (umbrella → hemisphere)
 *          for `number_of_hops` hops, i.e. paths_per_hop ^ number_of_hops leaves.
 * Stage 2  LLM-based pruning: kinematic + airframe rules accept / reject every
 *          hop-to-hop segment (rejections propagate to descendants).
 * Stage 3  Consolidation: accepted leaf paths are clustered (k-means) into
 *          10–20 representative trajectories.
 * Stage 4  Runtime NN pruning: a small logistic "classifier" ranks those
 *          trajectories against live aircraft health and keeps 8–10.
 *
 * Scene frame: +X lateral (starboard), +Y up, +Z forward (aircraft nose).
 */

export type PipelineStage =
  | 'idle'
  | 'generating'
  | 'generated'
  | 'pruning'
  | 'pruned'
  | 'consolidating'
  | 'consolidated'
  | 'runtime';

export interface PipelineArgs {
  pathsPerHop: number; // 2–10
  numberOfHops: number; // 1–6
  turningRadiusNM: number; // 0.5–8
  aircraftAgeYrs: number; // 0–35
  aircraftWeightPct: number; // 40–100 % MTOW
  maxClimbRateFpm: number; // 1000–6000
  maxLoadFactorG: number; // 1.2–2.5
}

export interface RuntimeArgs {
  weightPct: number; // 40–100 % MTOW
  ageYrs: number; // 0–35
  engineHealthPct: number; // 40–100
  fuelRemainingPct: number; // 5–100
  windShearKt: number; // 0–40
}

export const DEFAULT_PIPELINE_ARGS: PipelineArgs = {
  pathsPerHop: 5,
  numberOfHops: 4,
  turningRadiusNM: 2.5,
  aircraftAgeYrs: 12,
  aircraftWeightPct: 75,
  maxClimbRateFpm: 3000,
  maxLoadFactorG: 1.5,
};

export const DEFAULT_RUNTIME_ARGS: RuntimeArgs = {
  weightPct: 75,
  ageYrs: 12,
  engineHealthPct: 100,
  fuelRemainingPct: 60,
  windShearKt: 0,
};

/** Scene units travelled per hop (chord length of one segment). */
export const HOP_LENGTH = 6;
/** Sample points per segment (incl. both endpoints) used for rendering. */
export const SEGMENT_SAMPLES = 8;
/** Max segments generated per hop before deeper hops are subsampled. */
export const MAX_SEGMENTS_PER_HOP = 8000;
/** Nose position of the aircraft model (root of the tree). */
export const ROOT_POSITION: [number, number, number] = [0, 0, 2.5];

const SEED = 0xa715;
const DEG = 180 / Math.PI;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type V3 = [number, number, number];
const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Generation cap half-angle: tight radius → near-full hemisphere, wide radius → closed umbrella. */
export function capHalfAngleDeg(turningRadiusNM: number): number {
  return clamp(130 / (1 + (turningRadiusNM - 0.5) * 0.6), 12, 88);
}

/** Unit directions spread on a spherical cap of half-angle `theta` around `axis`. */
function capDirections(axis: V3, n: number, theta: number, azOffset: number): V3[] {
  const helper: V3 = Math.abs(axis[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
  const right = norm(cross(helper, axis)); // lateral basis
  const up = cross(axis, right); // vertical-ish basis

  const dirs: V3[] = [];
  let m = n;
  if (n % 2 === 1) {
    dirs.push(axis);
    m = n - 1;
  }
  // Mirrored pairs (az, az + π) whose opening angle grows toward the cap rim,
  // sweeping the azimuth so the fan reads as an umbrella / hemisphere in 3D.
  const pairs = m / 2;
  for (let j = 0; j < pairs; j++) {
    const alpha = theta * (0.4 + (0.6 * (j + 1)) / pairs);
    const az = azOffset + (j * Math.PI) / pairs;
    const ca = Math.cos(alpha);
    const sa = Math.sin(alpha);
    for (const side of [1, -1]) {
      const cz = Math.cos(az) * side;
      const sz = Math.sin(az) * side;
      dirs.push(
        norm([
          ca * axis[0] + sa * (cz * right[0] + sz * up[0]),
          ca * axis[1] + sa * (cz * right[1] + sz * up[1]),
          ca * axis[2] + sa * (cz * right[2] + sz * up[2]),
        ])
      );
    }
  }
  return dirs;
}

const headingDeg = (d: V3) => Math.atan2(d[0], d[2]) * DEG;
const climbDeg = (d: V3) => Math.asin(clamp(d[1], -1, 1)) * DEG;
const wrapDeg = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;

export interface PathTree {
  args: PipelineArgs;
  hops: number;
  nodeCount: number;
  segCount: number; // == nodeCount - 1; segment i ends at node i + 1
  nodePos: Float32Array; // nodeCount * 3
  nodeDir: Float32Array; // nodeCount * 3
  nodeParent: Int32Array; // -1 for root
  nodeHop: Uint8Array;
  /** Bezier samples, segCount * SEGMENT_SAMPLES * 3. */
  segPoints: Float32Array;
  /** Horizontal heading change vs parent (deg, abs). */
  segTurnDeg: Float32Array;
  /** Climb (+) / descent (−) angle of the child direction (deg). */
  segClimbDeg: Float32Array;
  /** Heading of child relative to the initial course (deg, abs). */
  segCourseDevDeg: Float32Array;
  /** Segments of hop h occupy [hopSegStart[h-1], hopSegStart[h]); hopSegStart[0] = 0. */
  hopSegStart: number[];
  leafNodes: number[]; // nodes at the final hop
  theoreticalPaths: number;
  theoreticalSegments: number;
  truncated: boolean;
  capDeg: number;
}

export function generateTree(args: PipelineArgs): PathTree {
  const rng = mulberry32(SEED ^ (args.pathsPerHop * 131 + args.numberOfHops * 977));
  const n = Math.round(args.pathsPerHop);
  const H = Math.round(args.numberOfHops);
  const theta = capHalfAngleDeg(args.turningRadiusNM) / DEG;
  const forward: V3 = [0, 0, 1];

  // Count nodes first so typed arrays can be allocated exactly.
  const hopNodeCounts: number[] = [1];
  let truncated = false;
  for (let h = 1; h <= H; h++) {
    const parents = hopNodeCounts[h - 1];
    const expandable = Math.min(parents, Math.floor(MAX_SEGMENTS_PER_HOP / n));
    if (expandable < parents) truncated = true;
    hopNodeCounts.push(expandable * n);
  }
  const nodeCount = hopNodeCounts.reduce((a, b) => a + b, 0);
  const segCount = nodeCount - 1;

  const nodePos = new Float32Array(nodeCount * 3);
  const nodeDir = new Float32Array(nodeCount * 3);
  const nodeParent = new Int32Array(nodeCount).fill(-1);
  const nodeHop = new Uint8Array(nodeCount);
  const segPoints = new Float32Array(segCount * SEGMENT_SAMPLES * 3);
  const segTurnDeg = new Float32Array(segCount);
  const segClimbDeg = new Float32Array(segCount);
  const segCourseDevDeg = new Float32Array(segCount);
  const hopSegStart: number[] = [0];

  nodePos.set(ROOT_POSITION, 0);
  nodeDir.set(forward, 0);

  let prevStart = 0;
  let prevEnd = 1; // node index range of the previous hop
  let next = 1;
  for (let h = 1; h <= H; h++) {
    const parentCount = prevEnd - prevStart;
    const expandable = hopNodeCounts[h] / n;
    // Evenly spread subset of parents when over budget.
    const stride = parentCount / expandable;
    for (let e = 0; e < expandable; e++) {
      const p = prevStart + Math.floor(e * stride);
      const pPos: V3 = [nodePos[p * 3], nodePos[p * 3 + 1], nodePos[p * 3 + 2]];
      const pDir: V3 = [nodeDir[p * 3], nodeDir[p * 3 + 1], nodeDir[p * 3 + 2]];
      // Fan axis leans back toward the original course so the wavefront keeps advancing.
      const axis = norm([pDir[0] + forward[0], pDir[1] + forward[1], pDir[2] + forward[2]]);
      const azOffset = (rng() - 0.5) * 0.6;
      const dirs = capDirections(h === 1 ? forward : axis, n, theta, azOffset);

      const half = HOP_LENGTH / 2;
      const ctrl: V3 = [pPos[0] + pDir[0] * half, pPos[1] + pDir[1] * half, pPos[2] + pDir[2] * half];
      for (const d of dirs) {
        const c = next++;
        const end: V3 = [ctrl[0] + d[0] * half, ctrl[1] + d[1] * half, ctrl[2] + d[2] * half];
        nodePos.set(end, c * 3);
        nodeDir.set(d, c * 3);
        nodeParent[c] = p;
        nodeHop[c] = h;

        const s = c - 1;
        for (let k = 0; k < SEGMENT_SAMPLES; k++) {
          const t = k / (SEGMENT_SAMPLES - 1);
          const a = (1 - t) * (1 - t);
          const b = 2 * (1 - t) * t;
          const cc = t * t;
          const o = (s * SEGMENT_SAMPLES + k) * 3;
          segPoints[o] = a * pPos[0] + b * ctrl[0] + cc * end[0];
          segPoints[o + 1] = a * pPos[1] + b * ctrl[1] + cc * end[1];
          segPoints[o + 2] = a * pPos[2] + b * ctrl[2] + cc * end[2];
        }
        segTurnDeg[s] = Math.abs(wrapDeg(headingDeg(d) - headingDeg(pDir)));
        segClimbDeg[s] = climbDeg(d);
        segCourseDevDeg[s] = Math.abs(wrapDeg(headingDeg(d)));
      }
    }
    hopSegStart.push(next - 1);
    prevStart = prevEnd;
    prevEnd = next;
  }

  const leafNodes: number[] = [];
  for (let i = prevStart; i < prevEnd; i++) leafNodes.push(i);

  let theoreticalSegments = 0;
  for (let h = 1; h <= H; h++) theoreticalSegments += Math.pow(n, h);

  return {
    args,
    hops: H,
    nodeCount,
    segCount,
    nodePos,
    nodeDir,
    nodeParent,
    nodeHop,
    segPoints,
    segTurnDeg,
    segClimbDeg,
    segCourseDevDeg,
    hopSegStart,
    leafNodes,
    theoreticalPaths: Math.pow(n, H),
    theoreticalSegments,
    truncated,
    capDeg: theta * DEG,
  };
}

// ───────────────────────── Stage 2: LLM-based pruning ─────────────────────────

export const SEG_PENDING = 0;
export const SEG_ACCEPTED = 1;
export const SEG_REJECTED = 2;

export type RejectReason = 'NONE' | 'TURN_RADIUS' | 'CLIMB_LIMIT' | 'DESCENT_LIMIT' | 'COURSE_REVERSAL' | 'LLM_JUDGEMENT' | 'PARENT_REJECTED';
export const REJECT_REASONS: RejectReason[] = ['NONE', 'TURN_RADIUS', 'CLIMB_LIMIT', 'DESCENT_LIMIT', 'COURSE_REVERSAL', 'LLM_JUDGEMENT', 'PARENT_REJECTED'];

export interface PruneLimits {
  maxTurnDeg: number;
  maxClimbDeg: number;
  maxDescentDeg: number;
  maxCourseDevDeg: number;
}

/** Airframe envelope used by the (simulated) LLM pruner. */
export function pruneLimits(args: PipelineArgs): PruneLimits {
  const weightFactor = 1.15 - 0.4 * ((args.aircraftWeightPct - 40) / 60); // heavy → less agile
  const ageFactor = 1 - 0.3 * (args.aircraftAgeYrs / 35); // old airframe → derated
  const gFactor = 0.85 + ((args.maxLoadFactorG - 1.2) / 1.3) * 0.5;
  return {
    maxTurnDeg: capHalfAngleDeg(args.turningRadiusNM) * 1.35 * gFactor * weightFactor * ageFactor,
    maxClimbDeg: (8 + 40 * (args.maxClimbRateFpm / 6000)) * weightFactor * ageFactor,
    maxDescentDeg: 40,
    maxCourseDevDeg: 110,
  };
}

export interface PruneResult {
  status: Uint8Array; // per segment: SEG_ACCEPTED | SEG_REJECTED
  reason: Uint8Array; // index into REJECT_REASONS
  limits: PruneLimits;
  acceptedLeaves: number[]; // leaf node indices whose full path is accepted
  acceptedCount: number;
  rejectedCount: number;
}

export function llmPrune(tree: PathTree): PruneResult {
  const rng = mulberry32(SEED ^ 0x5eed);
  const limits = pruneLimits(tree.args);
  const status = new Uint8Array(tree.segCount);
  const reason = new Uint8Array(tree.segCount);
  let acceptedCount = 0;

  for (let s = 0; s < tree.segCount; s++) {
    const parentNode = tree.nodeParent[s + 1];
    const parentSeg = parentNode - 1; // -1 for root
    let r: RejectReason = 'NONE';
    const turn = tree.segTurnDeg[s];
    const climb = tree.segClimbDeg[s];
    const borderline =
      turn > limits.maxTurnDeg * 0.85 ||
      climb > limits.maxClimbDeg * 0.85 ||
      -climb > limits.maxDescentDeg * 0.85;

    if (parentSeg >= 0 && status[parentSeg] === SEG_REJECTED) r = 'PARENT_REJECTED';
    else if (tree.segCourseDevDeg[s] > limits.maxCourseDevDeg) r = 'COURSE_REVERSAL';
    else if (turn > limits.maxTurnDeg) r = 'TURN_RADIUS';
    else if (climb > limits.maxClimbDeg) r = 'CLIMB_LIMIT';
    else if (-climb > limits.maxDescentDeg) r = 'DESCENT_LIMIT';
    else if (borderline && rng() < 0.3) r = 'LLM_JUDGEMENT';

    reason[s] = REJECT_REASONS.indexOf(r);
    status[s] = r === 'NONE' ? SEG_ACCEPTED : SEG_REJECTED;
    if (r === 'NONE') acceptedCount++;
  }

  const acceptedLeaves = tree.leafNodes.filter((node) => status[node - 1] === SEG_ACCEPTED);
  return {
    status,
    reason,
    limits,
    acceptedLeaves,
    acceptedCount,
    rejectedCount: tree.segCount - acceptedCount,
  };
}

// ───────────────────────── Stage 3: consolidation ─────────────────────────

/** Points in a full root→leaf polyline. */
export const polylineLength = (hops: number) => hops * (SEGMENT_SAMPLES - 1) + 1;

/** Writes the root→leaf polyline of `leaf` into `out` at `offset` (in floats). */
function writeLeafPolyline(tree: PathTree, leaf: number, out: Float32Array, offset: number) {
  const chain: number[] = [];
  for (let node = leaf; node > 0; node = tree.nodeParent[node]) chain.push(node - 1);
  chain.reverse();
  let o = offset;
  chain.forEach((seg, i) => {
    for (let k = i === 0 ? 0 : 1; k < SEGMENT_SAMPLES; k++) {
      const src = (seg * SEGMENT_SAMPLES + k) * 3;
      out[o++] = tree.segPoints[src];
      out[o++] = tree.segPoints[src + 1];
      out[o++] = tree.segPoints[src + 2];
    }
  });
}

export interface TrajectoryFeatures {
  totalTurnDeg: number;
  maxClimbDeg: number;
  maxDescentDeg: number;
  lateralOffset: number; // |x| at path end (scene units)
  verticalOffset: number; // y at path end
  pathLength: number;
}

export interface Consolidation {
  K: number;
  pointsPerPath: number;
  centroids: Float32Array[]; // K polylines
  features: TrajectoryFeatures[];
  clusterSize: number[];
  /** Subsample of accepted leaf paths used for the merge animation. */
  memberPolylines: Float32Array; // members * pointsPerPath * 3
  memberCluster: Int32Array;
  memberCount: number;
}

const MAX_MERGE_MEMBERS = 2500;

function polylineFeatures(poly: Float32Array, pts: number): TrajectoryFeatures {
  let totalTurn = 0;
  let maxClimb = 0;
  let maxDescent = 0;
  let length = 0;
  let prevHeading: number | null = null;
  for (let i = 1; i < pts; i++) {
    const dx = poly[i * 3] - poly[(i - 1) * 3];
    const dy = poly[i * 3 + 1] - poly[(i - 1) * 3 + 1];
    const dz = poly[i * 3 + 2] - poly[(i - 1) * 3 + 2];
    const seg = Math.hypot(dx, dy, dz) || 1e-6;
    length += seg;
    const climb = Math.asin(clamp(dy / seg, -1, 1)) * DEG;
    maxClimb = Math.max(maxClimb, climb);
    maxDescent = Math.max(maxDescent, -climb);
    const hdg = Math.atan2(dx, dz) * DEG;
    if (prevHeading !== null) totalTurn += Math.abs(wrapDeg(hdg - prevHeading));
    prevHeading = hdg;
  }
  return {
    totalTurnDeg: totalTurn,
    maxClimbDeg: maxClimb,
    maxDescentDeg: maxDescent,
    lateralOffset: Math.abs(poly[(pts - 1) * 3]),
    verticalOffset: poly[(pts - 1) * 3 + 1],
    pathLength: length,
  };
}

export function consolidate(tree: PathTree, prune: PruneResult): Consolidation {
  const rng = mulberry32(SEED ^ 0xc1);
  const pts = polylineLength(tree.hops);
  const leaves = prune.acceptedLeaves;

  // Members for k-means + merge animation (evenly subsampled if huge).
  const stride = Math.max(1, leaves.length / MAX_MERGE_MEMBERS);
  const members: number[] = [];
  for (let i = 0; i < leaves.length && members.length < MAX_MERGE_MEMBERS; i += stride) {
    members.push(leaves[Math.floor(i)]);
  }
  const M = members.length;
  const memberPolylines = new Float32Array(M * pts * 3);
  members.forEach((leaf, i) => writeLeafPolyline(tree, leaf, memberPolylines, i * pts * 3));

  const K = M < 10 ? M : clamp(M, 10, 20);
  const memberCluster = new Int32Array(M);
  if (K === 0) {
    return { K: 0, pointsPerPath: pts, centroids: [], features: [], clusterSize: [], memberPolylines, memberCluster, memberCount: 0 };
  }

  // Feature vector: node position at each hop (every SEGMENT_SAMPLES-1 points).
  const D = tree.hops * 3;
  const feat = new Float32Array(M * D);
  for (let i = 0; i < M; i++) {
    for (let h = 1; h <= tree.hops; h++) {
      const p = (i * pts + h * (SEGMENT_SAMPLES - 1)) * 3;
      feat[i * D + (h - 1) * 3] = memberPolylines[p];
      feat[i * D + (h - 1) * 3 + 1] = memberPolylines[p + 1];
      feat[i * D + (h - 1) * 3 + 2] = memberPolylines[p + 2];
    }
  }
  const dist2 = (i: number, c: Float32Array, j: number) => {
    let d = 0;
    for (let k = 0; k < D; k++) {
      const v = feat[i * D + k] - c[j * D + k];
      d += v * v;
    }
    return d;
  };

  // k-means++ initialisation
  const centers = new Float32Array(K * D);
  centers.set(feat.subarray(0, D), 0);
  const minD = new Float64Array(M).fill(Infinity);
  for (let c = 1; c < K; c++) {
    let sum = 0;
    for (let i = 0; i < M; i++) {
      minD[i] = Math.min(minD[i], dist2(i, centers, c - 1));
      sum += minD[i];
    }
    let target = rng() * sum;
    let pick = M - 1;
    for (let i = 0; i < M; i++) {
      target -= minD[i];
      if (target <= 0) {
        pick = i;
        break;
      }
    }
    centers.set(feat.subarray(pick * D, pick * D + D), c * D);
  }

  for (let iter = 0; iter < 20; iter++) {
    let changed = false;
    for (let i = 0; i < M; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < K; c++) {
        const d = dist2(i, centers, c);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (memberCluster[i] !== best || iter === 0) changed = true;
      memberCluster[i] = best;
    }
    const counts = new Int32Array(K);
    centers.fill(0);
    for (let i = 0; i < M; i++) {
      counts[memberCluster[i]]++;
      for (let k = 0; k < D; k++) centers[memberCluster[i] * D + k] += feat[i * D + k];
    }
    for (let c = 0; c < K; c++) {
      if (counts[c] === 0) {
        // Re-seed an empty cluster with a random member.
        const pick = Math.floor(rng() * M);
        centers.set(feat.subarray(pick * D, pick * D + D), c * D);
      } else {
        for (let k = 0; k < D; k++) centers[c * D + k] /= counts[c];
      }
    }
    if (!changed) break;
  }

  // Centroid polylines = mean of member polylines, so the merge animation lands exactly on them.
  const centroids: Float32Array[] = Array.from({ length: K }, () => new Float32Array(pts * 3));
  const clusterSize = new Array<number>(K).fill(0);
  for (let i = 0; i < M; i++) {
    const c = memberCluster[i];
    clusterSize[c]++;
    const base = i * pts * 3;
    for (let k = 0; k < pts * 3; k++) centroids[c][k] += memberPolylines[base + k];
  }
  centroids.forEach((poly, c) => {
    const n = Math.max(1, clusterSize[c]);
    for (let k = 0; k < poly.length; k++) poly[k] /= n;
  });

  return {
    K,
    pointsPerPath: pts,
    centroids,
    features: centroids.map((poly) => polylineFeatures(poly, pts)),
    clusterSize,
    memberPolylines,
    memberCluster,
    memberCount: M,
  };
}

// ───────────────────────── Stage 4: runtime NN pruning ─────────────────────────

export interface RuntimeResult {
  /** Trajectory indices, best first. */
  ranked: number[];
  survivors: number[];
  optimal: number;
  scores: number[]; // 0–1 classifier confidence per trajectory
  stress: number; // 0–1 normalised distance from nominal
  survivorTarget: number;
}

/** 0 at nominal, 1 at the most adverse settings. */
export function runtimeStress(rt: RuntimeArgs): number {
  const n = DEFAULT_RUNTIME_ARGS;
  const weight = Math.max(0, rt.weightPct - n.weightPct) / (100 - n.weightPct);
  const age = Math.max(0, rt.ageYrs - n.ageYrs) / (35 - n.ageYrs);
  const engine = (n.engineHealthPct - rt.engineHealthPct) / (n.engineHealthPct - 40);
  const fuel = Math.max(0, n.fuelRemainingPct - rt.fuelRemainingPct) / (n.fuelRemainingPct - 5);
  const shear = rt.windShearKt / 40;
  const terms = [weight, age, engine, fuel, shear].map((t) => clamp(t, 0, 1));
  // Dominated by the worst factor, nudged up by the rest.
  const worst = Math.max(...terms);
  const mean = terms.reduce((a, b) => a + b, 0) / terms.length;
  return clamp(worst * 0.7 + mean * 0.6, 0, 1);
}

export function runtimeScore(con: Consolidation, rt: RuntimeArgs): RuntimeResult {
  const stress = runtimeStress(rt);
  // Seed from the (rounded) runtime state so ties break "randomly" but reproducibly.
  const rng = mulberry32(
    SEED ^ (Math.round(rt.weightPct) * 7 + Math.round(rt.ageYrs) * 131 + Math.round(rt.engineHealthPct) * 1009 + Math.round(rt.fuelRemainingPct) * 7919 + Math.round(rt.windShearKt) * 104729)
  );

  // Runtime state, each normalised to 0–1 (1 = most adverse).
  const engine = clamp((100 - rt.engineHealthPct) / 60, 0, 1);
  const heavy = clamp((rt.weightPct - 40) / 60, 0, 1);
  const old = clamp(rt.ageYrs / 35, 0, 1);
  const lowFuel = clamp(1 - rt.fuelRemainingPct / 100, 0, 1);
  const shear = clamp(rt.windShearKt / 40, 0, 1);

  // Single-layer logistic "classifier". A Traffic Advisory means the intruder sits on the
  // current course, so separation from that course is rewarded while each manoeuvre type
  // is penalised according to what the live aircraft can afford right now:
  //   weak engine → avoid climbs · wind shear → avoid descents · heavy / old → avoid turns
  //   low fuel → avoid long detours.
  const hops = Math.max(1, (con.pointsPerPath - 1) / (SEGMENT_SAMPLES - 1));
  const baseLength = HOP_LENGTH * hops;
  const wClimb = 0.4 + 2.2 * engine + 0.8 * heavy;
  const wDescent = 0.4 + 2.2 * shear;
  const wTurn = 0.3 + 1.6 * heavy * heavy + 0.8 * old * old;
  const wLength = 0.2 + 2.0 * lowFuel;

  const scores = con.features.map((f) => {
    const separation = Math.min(1, Math.hypot(f.lateralOffset, f.verticalOffset) / (baseLength * 0.25));
    const z =
      1 +
      4 * separation -
      wClimb * (Math.max(0, f.maxClimbDeg) / 30) -
      wDescent * (f.maxDescentDeg / 30) -
      wTurn * (f.totalTurnDeg / 90) -
      wLength * (Math.max(0, f.pathLength - baseLength) / (baseLength * 0.5)) +
      (rng() - 0.5) * 0.3;
    return 1 / (1 + Math.exp(-z));
  });

  const ranked = scores.map((_, i) => i).sort((a, b) => scores[b] - scores[a]);
  const survivorTarget = Math.min(con.K, Math.round(10 - 2 * stress));
  const survivors = ranked.slice(0, survivorTarget);
  return { ranked, survivors, optimal: ranked[0] ?? -1, scores, stress, survivorTarget };
}
