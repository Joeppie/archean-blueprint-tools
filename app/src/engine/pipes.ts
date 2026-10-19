// pipes.ts — cable/pipe geometry (data.pipes). PURE builder; scene.ts
// merges the tubes into ONE mesh + the endpoints into instanced spheres.
//
// FORMAT rule (AGENTS § Format facts): pipes are NOT straight chains —
// every segment anchors at its OWN `start` (joints carry 0.04-0.14 m
// offsets between seg[i].end and seg[i+1].start); accumulating dir·len
// drifts tubes off the cables (the v0.99 regression). The first/last
// segment ends ARE the world connector positions (the game writes cable
// tips at the part's VISIBLE socket).

import type { Pipe } from './format';

export type V3 = readonly [number, number, number];

/** an axis-aligned tube box: centre + full extent (view space) */
export interface PipeTube { center: V3; size: V3 }

/** one cable run's two world connector points (view space) */
export interface PipeEnds { a: V3; b: V3 }

/** which components a cable run joins (the data.pipes graph edges) */
export interface PipeLink { a: number; b: number }

export interface PipeNetwork {
  tubes: PipeTube[];
  ends: PipeEnds[];
  links: PipeLink[];
  /** per-pipe surge polyline (a-end → b-end, segment start/end pairs —
   *  the EXACT drawn cable path, joint zigzag included; legacy pipePolys) */
  polys: V3[][];
  pipes: number;
}

/** one cable run to animate a power-surge along, walkable FROM ci */
export interface SurgePath { pts: V3[]; cum: number[]; total: number; to: number }

/** dir 0..5 → +x,+y,+z,−x,−y,−z, raw frame == view frame (v0.180) */
const DIRS: readonly (V3 | undefined)[] = [
  [1, 0, 0], [0, 1, 0], [0, 0, 1], [-1, 0, 0], [0, -1, 0], [0, 0, -1],
];

/** non-axis tube thickness (legacy 0.022) and joint slack (legacy +0.01) */
const TUBE = 0.022;
const SLACK = 0.01;

export function buildPipes(pipes: readonly Pipe[] | undefined): PipeNetwork {
  const tubes: PipeTube[] = [];
  const ends: PipeEnds[] = [];
  const links: PipeLink[] = [];
  const polys: V3[][] = [];
  if (!pipes?.length) return { tubes, ends, links, polys, pipes: 0 };

  for (const p of pipes) {
    const first = p.segments[0];
    const last = p.segments[p.segments.length - 1];
    if (!first || !last) continue;
    let bEnd: V3 = [first.start.x, first.start.y, first.start.z];   // overwritten per seg
    const pts: V3[] = [];                                            // surge polyline
    for (const s of p.segments) {
      const d = DIRS[s.dir] ?? DIRS[0]!;
      const L = s.length + SLACK;
      const st: V3 = [s.start.x, s.start.y, s.start.z];
      bEnd = [st[0]! + d[0]! * s.length, st[1]! + d[1]! * s.length, st[2]! + d[2]! * s.length];
      pts.push(st, bEnd);
      tubes.push({
        center: [st[0]! + d[0]! * L / 2, st[1]! + d[1]! * L / 2, st[2]! + d[2]! * L / 2],
        size: [d[0] ? L : TUBE, d[1] ? L : TUBE, d[2] ? L : TUBE],
      });
    }
    ends.push({ a: [first.start.x, first.start.y, first.start.z], b: bEnd });
    links.push({ a: p.a_component, b: p.b_component });
    polys.push(pts);
  }
  return { tubes, ends, links, polys, pipes: pipes.length };
}

/** one straight segment's view-space length (V3s come from the SAME net) */
const segLen = (a: V3, b: V3) =>
  Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);

/** the cable runs that light up when component ci is selected: every pipe
 *  touching ci, walked AWAY from it (a b_component hit reverses the
 *  polyline — the bolt travels from the picked part's socket outward,
 *  legacy startSurges), with cumulative arc lengths for the travel lerp.
 *  Degenerate runs (polyline < 2 pts or < 0.05 m) never surge. */
export function surgePaths(net: PipeNetwork, ci: number): SurgePath[] {
  const out: SurgePath[] = [];
  for (let i = 0; i < net.links.length; i++) {
    const link = net.links[i], poly = net.polys[i];
    if (!link || !poly || poly.length < 2) continue;
    let pts: V3[], to: number;
    if (link.a === ci) { pts = poly; to = link.b; }
    else if (link.b === ci) { pts = poly.slice().reverse(); to = link.a; }
    else continue;
    const cum = [0];
    for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1]! + segLen(pts[k - 1]!, pts[k]!));
    const total = cum[cum.length - 1]!;
    if (total < 0.05) continue;
    out.push({ pts, cum, total, to });
  }
  return out;
}
