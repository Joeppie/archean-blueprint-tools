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

export interface PipeNetwork {
  tubes: PipeTube[];
  ends: PipeEnds[];
  pipes: number;
}

/** dir 0..5 → +x,+y,+z,−x,−y,−z, in VIEW space (z-mirrored) */
const DIRS: readonly (V3 | undefined)[] = [
  [1, 0, 0], [0, 1, 0], [0, 0, -1], [-1, 0, 0], [0, -1, 0], [0, 0, 1],
];

/** non-axis tube thickness (legacy 0.022) and joint slack (legacy +0.01) */
const TUBE = 0.022;
const SLACK = 0.01;

export function buildPipes(pipes: readonly Pipe[] | undefined): PipeNetwork {
  const tubes: PipeTube[] = [];
  const ends: PipeEnds[] = [];
  if (!pipes?.length) return { tubes, ends, pipes: 0 };

  for (const p of pipes) {
    const first = p.segments[0];
    const last = p.segments[p.segments.length - 1];
    if (!first || !last) continue;
    let bEnd: V3 = [first.start.x, first.start.y, -first.start.z];   // overwritten per seg
    for (const s of p.segments) {
      const d = DIRS[s.dir] ?? DIRS[0]!;
      const L = s.length + SLACK;
      const st: V3 = [s.start.x, s.start.y, -s.start.z];
      bEnd = [st[0]! + d[0]! * s.length, st[1]! + d[1]! * s.length, st[2]! + d[2]! * s.length];
      tubes.push({
        center: [st[0]! + d[0]! * L / 2, st[1]! + d[1]! * L / 2, st[2]! + d[2]! * L / 2],
        size: [d[0] ? L : TUBE, d[1] ? L : TUBE, d[2] ? L : TUBE],
      });
    }
    ends.push({ a: [first.start.x, first.start.y, -first.start.z], b: bEnd });
  }
  return { tubes, ends, pipes: pipes.length };
}
