// pipes.ts — cable/pipe geometry (data.pipes). PURE builder; scene.ts
// merges the segments into one mesh per material pass + the plugs and the
// connector-endpoint markers.
//
// FORMAT rules (v1.8.1, transcribed from the game client through the dev's
// XenonViewer scene.js buildPipes + the corpus flag census; FORMAT §pipes):
//  • Pipes are NOT straight chains — every segment anchors at its OWN
//    `start` (joints carry 0.04-0.14 m offsets); accumulating dir·len drifts
//    tubes off the cables (the v0.99 regression).
//  • A cable is a CYLINDER of the pipe's `radius`, square only where the
//    segment carries the `box` flag (the item ducts). Data/HV/fluid hoses
//    are round — the file says so (only item sets box:true).
//  • Every segment carries its own colour (r/g/b, LINEAR like palette slots)
//    and material flags (metal/chrome → shiny pass).
//  • Direction changes close with a SPHERE of the cable radius (two butt
//    cylinders leave a notch); the LAST segment is stored reversed (it
//    points from the b-adapter back into the path), which only matters for
//    that test.
//  • A FLEXIBLE pair is not two segments: segment[0] carries the cable's
//    length + colour (its dir is meaningless), segment[1] only marks the
//    arrival point (zero length). Drawn as a sagging parabolic chain.
//  • The first/last segment ends ARE the connector positions — while they
//    still sit on their socket (sockets.ts). A stale cached tip (the part
//    moved) re-anchors to the live socket so the cable plugs into the round
//    grey circle the model shows, as the game redraws it on save.
//  • The client adds a black COLLAR at every cable end (not serialised) —
//    drawn here as `plugs`, round like the cable, square for box ducts.

import type { Pipe } from './format';
import { endAnchor, KIND_RADIUS, type PipeSockets, type V3 } from './sockets';

export type { V3 } from './sockets';

/** one drawn cable bar: endpoints (view space), cross-section, style */
export interface CableSeg {
  a: V3; b: V3;
  radius: number;
  /** square cross-section (item ducts); false = cylinder */
  box: boolean;
  /** LINEAR rgb, 0..1 (per-segment file colour, palette law) */
  color: readonly [number, number, number];
  /** shiny material pass (segment metal/chrome) */
  metal: boolean;
  kind: string;
}

/** elbow sphere closing a direction change */
export interface PipeJoint { at: V3; radius: number; color: CableSeg['color'] }

/** the client's black end collar (a plug seat), oriented along the cable */
export interface PipePlug { at: V3; axis: V3; radius: number; box: boolean }

/** one cable run's two world connector points (view space) */
export interface PipeEnds { a: V3; b: V3 }

/** which components a cable run joins (the data.pipes graph edges) */
export interface PipeLink { a: number; b: number }

export interface PipeNetwork {
  segs: CableSeg[];
  joints: PipeJoint[];
  plugs: PipePlug[];
  ends: PipeEnds[];
  links: PipeLink[];
  /** per-pipe surge polyline (a-end → b-end; the EXACT drawn cable path,
   *  joint zigzag / sag chain included; legacy pipePolys) */
  polys: V3[][];
  pipes: number;
  /** ends the recorded cache left off its socket (re-anchored, sockets.ts) */
  stale: number;
}

/** one straight segment's view-space length (V3s come from the SAME net) */
const segLen = (a: V3, b: V3) =>
  Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);

/** one cable run to animate a power-surge along, walkable FROM ci */
export interface SurgePath { pts: V3[]; cum: number[]; total: number; to: number }

/** dir 0..5 → +x,+y,+z,−x,−y,−z, raw frame == view frame (v0.180) */
const DIRS: readonly (V3 | undefined)[] = [
  [1, 0, 0], [0, 1, 0], [0, 0, 1], [-1, 0, 0], [0, -1, 0], [0, 0, -1],
];

/** blueprint.js's fallback colour for segments without r/g/b */
const DEF_COLOR = [128 / 255, 128 / 255, 128 / 255] as const;

const segColor = (s: Pipe['segments'][number]): CableSeg['color'] =>
  s.r === undefined && s.g === undefined && s.b === undefined
    ? DEF_COLOR
    : [(s.r ?? 128) / 255, (s.g ?? 128) / 255, (s.b ?? 128) / 255];

/** unit vector a→b, safe on degenerate bars */
function unit(a: V3, b: V3): V3 {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const n = Math.hypot(dx, dy, dz) || 1;
  return [dx / n, dy / n, dz / n];
}

/** the game's own sag-chain sampling of a flexible cable (XenonViewer
 *  flexibleCable): parabola pinned at the ends, sag 0 when taut, chunk
 *  count from the slack-to-radius ratio. */
function sagChain(from: V3, to: V3, length: number, radius: number): V3[] {
  const dist = segLen(from, to);
  if (dist < 1e-4) return [from, to];
  const slack = Math.max(0, (length || 0) / dist - 1);
  const sag = dist * Math.sqrt((3 * slack) / 8);
  const count = sag < radius
    ? 1
    : Math.min(64, Math.max(2, Math.round(4 * Math.sqrt((length || 0) / radius / 12))));
  const pts: V3[] = [];
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    pts.push([
      from[0] + (to[0] - from[0]) * t,
      from[1] + (to[1] - from[1]) * t - (sag > 0 ? 4 * sag * t * (1 - t) : 0),
      from[2] + (to[2] - from[2]) * t,
    ]);
  }
  return pts;
}

/**
 * Build the drawable network. `sockets` (sockets.ts pipeSockets) optionally
 * resolves each run's two adapters to their live socket poses — recorded
 * tips that drifted off their socket (a moved part) re-anchor there.
 */
export function buildPipes(
  pipes: readonly Pipe[] | undefined,
  sockets?: readonly (PipeSockets | null)[] | undefined,
): PipeNetwork {
  const segs: CableSeg[] = [];
  const joints: PipeJoint[] = [];
  const plugs: PipePlug[] = [];
  const ends: PipeEnds[] = [];
  const links: PipeLink[] = [];
  const polys: V3[][] = [];
  const net: PipeNetwork = { segs, joints, plugs, ends, links, polys, pipes: 0, stale: 0 };
  if (!pipes?.length) return net;
  net.pipes = 0;

  pipes.forEach((p, pi) => {
    const first = p.segments[0];
    const last = p.segments[p.segments.length - 1];
    if (!first || !last) return;
    const radius = p.radius ?? KIND_RADIUS[p.type ?? 'data'] ?? 0.02;
    const kind = p.type ?? 'data';
    const sock = sockets?.[pi] ?? null;
    const recA: V3 = [first.start.x, first.start.y, first.start.z];
    const dl = DIRS[last.dir] ?? DIRS[0]!;
    const recB: V3 = [last.start.x + dl[0] * last.length,
      last.start.y + dl[1] * last.length, last.start.z + dl[2] * last.length];
    const endA = endAnchor(recA, sock?.a ?? null);
    const endB = endAnchor(recB, sock?.b ?? null);
    if (endA !== recA) net.stale++;                    // off-socket tips get re-seated
    if (endB !== recB) net.stale++;

    // ---- flexible pair: ONE sagging cable, not two segments --------------
    if (p.segments.length === 2 && first.flexible && last.flexible) {
      const color = segColor(first);
      const metal = !!first.metal || !!first.chrome;
      const box = !!first.box;
      const pts = sagChain(endA, endB, first.length, radius);
      let prev = pts[0]!;
      for (let i = 1; i < pts.length; i++) {
        segs.push({ a: prev, b: pts[i]!, radius, box, color, metal, kind });
        if (i < pts.length - 1) joints.push({ at: pts[i]!, radius, color });
        prev = pts[i]!;
      }
      ends.push({ a: endA, b: endB });
      links.push({ a: p.a_component, b: p.b_component });
      polys.push(pts);
      plugs.push(
        { at: endA, axis: unit(pts[0]!, pts[1]!), radius, box },
        { at: endB, axis: unit(pts[pts.length - 1]!, pts[pts.length - 2]!), radius, box },
      );
      return;
    }

    // ---- rigid routed cable ----------------------------------------------
    let barEnd: V3 = endA;                          // overwritten per seg
    const pts: V3[] = [];
    p.segments.forEach((s, si) => {
      const d = DIRS[s.dir] ?? DIRS[0]!;
      const st: V3 = si === 0 ? endA
        : [s.start.x, s.start.y, s.start.z];
      const raw: V3 = [s.start.x + d[0] * s.length, s.start.y + d[1] * s.length,
        s.start.z + d[2] * s.length];
      barEnd = si === p.segments.length - 1 ? endB : raw;
      pts.push(st, barEnd);
      segs.push({
        a: st, b: barEnd, radius, box: !!s.box,
        color: segColor(s), metal: !!s.metal || !!s.chrome, kind,
      });
      // elbow: a direction change closes with a sphere of the cable radius.
      // The LAST segment is stored reversed (it points from the b-adapter
      // back into the path) → its useful direction is the opposite.
      const next = p.segments[si + 1];
      if (next) {
        const nd = si + 2 === p.segments.length ? (next.dir + 3) % 6 : next.dir;
        if (nd !== s.dir) joints.push({ at: raw, radius, color: segColor(s) });
      }
    });
    ends.push({ a: endA, b: barEnd });
    links.push({ a: p.a_component, b: p.b_component });
    polys.push(pts);
    const s0 = p.segments[0]!, sn = p.segments[p.segments.length - 1]!;
    const d0 = DIRS[s0.dir] ?? DIRS[0]!, dn = DIRS[sn.dir] ?? DIRS[0]!;
    plugs.push(
      { at: endA, axis: [-d0[0], -d0[1], -d0[2]], radius, box: !!s0.box },
      { at: endB, axis: dn, radius, box: !!sn.box },
    );
  });
  net.pipes = pipes.length;
  return net;
}

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
