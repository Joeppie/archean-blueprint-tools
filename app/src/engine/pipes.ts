// pipes.ts — cable/pipe geometry (data.pipes). PURE builder; scene.ts
// merges the segments into one mesh per material pass + the plugs and the
// connector-endpoint markers.
//
// FORMAT rules (v1.8.1, transcribed from the game client through the dev's
// XenonViewer scene.js buildPipes + the corpus flag census; FORMAT §pipes):
//  • Pipes are NOT straight chains — every segment anchors at its OWN
//    `start` (joints carry 0.04-0.14 m offsets); accumulating dir·len drifts
//    tubes off the cables (the v0.99 regression).
//  • A cable is a CYLINDER of the pipe's `radius`, square where the segment
//    carries the `box` flag (the item ducts) — and the DATA kind draws as a
//    thin square bus (KIND_SECTION, v1.8.3 user override; the FILE stays
//    truth, this is the viewport read). Data/HV/fluid hoses
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
//  • THE DIRECTION RULE (v1.8.2, user: "the wire must always connect in the
//    right direction ONTO/FROM the connector and the radius of the wire is
//    the minimum distance it must continue in the same direction as the
//    connector"): the bar touching a connector runs ALONG the connector's
//    stub axis for a lead of 2× the cable radius before the route may bend
//    (elbow sphere at the bend), and a re-seated plug tip stands at least
//    one cable radius off the face. The game agrees — measured, its fresh
//    routes leave along the axis (median dot +0.97..1.0 over 17 815 fresh
//    ends), so for fresh files the lead bar is collinear and free.
//  • The client adds a black COLLAR at every cable end (not serialised) —
//    drawn here as `plugs`, round like the cable, square for box ducts.

import type { Pipe } from './format';
import { KIND_RADIUS, plugAnchor, type PipeSockets, type V3 } from './sockets';

export type { V3 } from './sockets';

/** per-kind DISPLAY cross-section override (v1.8.3, user: "Data cables
 *  should be thinner. And less round, item cables square."): the DATA bus
 *  draws as a thin SQUARE ribbon at 60% of its file radius — the user's
 *  earlier ruling "for data and small power cables square is fine" — while
 *  every other kind keeps the file's own shape (round default, square only
 *  under the segment `box` flag, which in the whole corpus is the item
 *  ducts alone). The FILE radius stays the physical truth (cost/length
 *  math); this is purely how the bus reads in the viewport. */
export const KIND_SECTION: Record<string, { box: boolean; scale: number }> = {
  data: { box: true, scale: 0.6 },
};

/** one drawn cable bar: endpoints (view space), cross-section, style */
export interface CableSeg {
  a: V3; b: V3;
  /** the pipe's recorded radius (the plug/collar scale) */
  radius: number;
  /** DRAWN half-extent of the cross-section: `radius` for the file's own
   *  shapes, scaled for the thin data bus (KIND_SECTION) */
  half: number;
  /** square cross-section (item ducts + the drawn-as-bus data); false = cylinder */
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
export interface PipePlug {
  at: V3; axis: V3; radius: number; half: number; box: boolean;
  /** true when the plug sits on a resolved socket AND its axial lead was
   *  laid (checkLeads audits exactly these ends) */
  led: boolean;
}

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
  /** DRAWN half-extent per net run (hover-pick tolerance, v1.10.1) */
  radii: number[];
  /** which data.pipes index each net run came from (degenerate entries are
   *  skipped by the builder, so polys index ≠ pipe index without this) */
  piOf: number[];
  pipes: number;
  /** ends the recorded cache left off its socket (re-anchored, sockets.ts) */
  stale: number;
  /** v1.11.3: runs whose ends were STALE and re-draped (a part moved) */
  reroute: number;
  /** v1.11.4: runs drawn by THE DRAPE LAW (catenary between the live
   *  plugs) — every resolved run hangs as the game's live rope; runs with
   *  an unresolvable end are drawn as the recorded polyline */
  draped: number;
}

/** one straight segment's view-space length (V3s come from the SAME net) */
const segLen = (a: V3, b: V3) =>
  Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);

/** THE DRAPE LAW (v1.11.3, we: "flexible cables should simulate physics
 *  … hang/sag depending on how tight they are … sag then depends on how
 *  overstretched they are for their actual length"): the run between two
 *  plug necks is a CATENARY — the physical hanging-cable curve — solved on
 *  the exact lattice the file speaks:
 *   · `length` is the cable's REST length (the file's Σ segment lengths /
 *     a flexible pair's length field). If the span between `from` and `to`
 *     needs more than that, the cable is TAUT: one straight bar (an
 *     overstretched run renders as straight as the game draws it).
 *   · With slack S = L/dist − 1 the run hangs: the vertical plane through
 *     the two points carries the classic y(x) = a·cosh((x−xm)/a)+c solved
 *     for the arc constraint 2a·sinh(dh/2a) = √(L²−dv²) (bisection; dh =
 *     horizontal separation, dv = height difference — a vertical cable has
 *     dh 0 and hangs STRAIGHT, no side-bow, which the old chord-offset
 *     parabola got wrong). Sag grows monotonically with overstretch; the
 *     deepest point sits below the chord by a·(cosh … ) — measured.
 *  Sampling density follows the slack-to-radius ratio (the XenonViewer
 *  chunk law). Exported: the rerouted-cable drape uses it, the pins test
 *  it (pipes.test 'THE DRAPE LAW'). */
export function drapeChain(from: V3, to: V3, length: number, radius: number): V3[] {
  const dist = segLen(from, to);
  if (dist < 1e-4) return [from, to];
  const L = length || 0;
  const dv = to[1] - from[1];
  if (L <= dist * (1 + 1e-9) || L <= Math.abs(dv)) return [from, to];   // taut
  const dx = to[0] - from[0], dz = to[2] - from[2];
  const dh = Math.hypot(dx, dz);
  if (dh < 1e-6) return [from, to];                    // vertical: hangs straight
  const target = Math.sqrt(L * L - dv * dv);           // arc constraint f(a)
  const f = (a: number) => 2 * a * Math.sinh(dh / (2 * a)) - target;
  let lo = dh / 700, hi = dh;                          // f(lo) > 0 ≥ f(hi·k)
  for (let k = 0; k < 60 && f(hi) > 0; k++) hi *= 2;
  if (f(hi) > 0) return [from, to];                    // numeric safety → taut
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) lo = mid; else hi = mid;
  }
  const a = (lo + hi) / 2;
  const u = Math.atanh(Math.max(-0.999999, Math.min(0.999999, dv / L)));
  const xm = (dh - 2 * a * u) / 2;                     // catenary vertex offset
  const c = -a * Math.cosh(xm / a);                    // y(0) = 0
  const ux = dx / dh, uz = dz / dh;
  const slack = L / dist - 1;
  const count = Math.min(48, Math.max(4,
    Math.round(4 * Math.sqrt((L / radius) / 12)) || 4, Math.round(8 * Math.sqrt(slack))));
  const pts: V3[] = [];
  for (let i = 0; i <= count; i++) {
    const x = (i / count) * dh;
    const y = a * Math.cosh((x - xm) / a) + c;         // ≤ 0 between the ends
    pts.push([from[0] + ux * x, from[1] + y, from[2] + uz * x]);
  }
  pts[0] = [from[0], from[1], from[2]];
  pts[pts.length - 1] = [to[0], to[1], to[2]];         // exact plug lands
  return pts;
}

/** the cable's REST length from the file: a flexible pair carries it in
 *  segment[0].length, a routed run is the sum of its segment lengths. */
export function restLength(p: Pipe): number {
  let L = 0;
  for (const s of p.segments) L += s.length;
  return L;
}

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

/** one cable run to animate a power-surge along, walkable FROM ci */
export interface SurgePath { pts: V3[]; cum: number[]; total: number; to: number }

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
  const radii: number[] = [];
  const piOf: number[] = [];
  const net: PipeNetwork = { segs, joints, plugs, ends, links, polys, radii, piOf, pipes: 0, stale: 0, reroute: 0, draped: 0 };
  if (!pipes?.length) return net;
  net.pipes = 0;

  pipes.forEach((p, pi) => {
    const first = p.segments[0];
    const last = p.segments[p.segments.length - 1];
    if (!first || !last) return;
    const radius = p.radius ?? KIND_RADIUS[p.type ?? 'data'] ?? 0.02;
    const kind = p.type ?? 'data';
    const sec = KIND_SECTION[kind] ?? { box: false, scale: 1 };
    const half = radius * sec.scale;             // DRAWN half-extent (thin data bus)
    const sock = sockets?.[pi] ?? null;
    const recA: V3 = [first.start.x, first.start.y, first.start.z];
    const dl = DIRS[last.dir] ?? DIRS[0]!;
    const recB: V3 = [last.start.x + dl[0] * last.length,
      last.start.y + dl[1] * last.length, last.start.z + dl[2] * last.length];
    const plugA = plugAnchor(recA, sock?.a ?? null, radius);
    const plugB = plugAnchor(recB, sock?.b ?? null, radius);
    if (plugA.stale) net.stale++;                    // off-socket tips get re-seated
    if (plugB.stale) net.stale++;
    const tipA = plugA.tip, tipB = plugB.tip;
    const axisA = sock?.a?.axis ?? null, axisB = sock?.b?.axis ?? null;
    const n = p.segments.length;
    const sts = p.segments.map(s => [s.start.x, s.start.y, s.start.z] as V3);
    const raws = p.segments.map((s, si) => {
      const d = DIRS[s.dir] ?? DIRS[0]!;
      return [sts[si]![0] + d[0] * s.length, sts[si]![1] + d[1] * s.length,
        sts[si]![2] + d[2] * s.length] as V3;
    });

    // ---- THE DIRECTION RULE (sockets.ts Plug): the bar touching the
    // connector runs along its stub axis for a LEAD of 2× the cable radius
    // (clamped to the first hop, so the neck never overshoots the route).
    // Game-equivalent for fresh files (their first hop leaves along the
    // axis — median dot +0.97..1.0 measured) and the fix where the cache
    // came loose.
    const along = (v: V3, ax: V3, d: number): V3 =>
      [v[0] + ax[0] * d, v[1] + ax[1] * d, v[2] + ax[2] * d];
    const dist = (a: V3, b: V3) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const isFlex = n === 2 && !!first.flexible && !!last.flexible;
    // the next ROUTE point after each plug tip (for the lead clamp and the
    // outward test); a flexible pair has no meaningful dirs, its chain runs
    // tip to tip
    const nextA = isFlex || n === 1 ? tipB : raws[0]!;
    const nextB = isFlex || n === 1 ? tipA : sts[n - 1]!;
    const hopA = dist(tipA, nextA);
    const hopB = dist(tipB, nextB);
    // a lead only makes sense when the route leaves the plug OUTWARD,
    // sideways or shallow — never when the stale cache dives back INTO the
    // part through the socket (beyond ~105° the neck would fold the wire
    // onto itself; there a straight lead-in is the honest picture)
    const outward = (from: V3, to: V3, ax: V3) => {
      const L = dist(from, to);
      return L < 1e-6 ? false : ((to[0] - from[0]) * ax[0] + (to[1] - from[1]) * ax[1]
        + (to[2] - from[2]) * ax[2]) / L >= -0.25;
    };
    const leadA = axisA && plugA.lead > 1e-9 && hopA > 1e-6
      && outward(tipA, nextA, axisA) ? Math.min(plugA.lead, hopA) : 0;
    const leadB = axisB && plugB.lead > 1e-9 && hopB > 1e-6
      && outward(tipB, nextB, axisB) ? Math.min(plugB.lead, hopB) : 0;
    const neckA = axisA && leadA > 0 ? along(tipA, axisA, leadA) : null;
    const neckB = axisB && leadB > 0 ? along(tipB, axisB, leadB) : null;

    // ---- flexible pair: ONE hanging cable, not two segments --------------
    if (isFlex) {
      net.draped++;
      const color = segColor(first);
      const metal = !!first.metal || !!first.chrome;
      const box = !!first.box || sec.box;
      const pts = drapeChain(neckA ?? tipA, neckB ?? tipB, first.length, radius);
      if (neckA) {
        segs.push({ a: tipA, b: neckA, radius, half, box, color, metal, kind });
        joints.push({ at: neckA, radius: half, color });      // the bend leaves the axis here
      }
      let prev = pts[0]!;
      for (let i = 1; i < pts.length; i++) {
        segs.push({ a: prev, b: pts[i]!, radius, half, box, color, metal, kind });
        if (i < pts.length - 1) joints.push({ at: pts[i]!, radius: half, color });
        prev = pts[i]!;
      }
      if (neckB) {
        segs.push({ a: neckB, b: tipB, radius, half, box, color, metal, kind });
        joints.push({ at: neckB, radius: half, color });
      }
      ends.push({ a: tipA, b: tipB });
      links.push({ a: p.a_component, b: p.b_component });
      polys.push([
        tipA, ...(neckA ? [neckA] : []), ...pts.slice(1, -1),
        ...(neckB ? [neckB] : []), tipB,
      ]);
      radii.push(half); piOf.push(pi);
      plugs.push(
        { at: tipA, axis: axisA ?? unit(neckA ?? tipA, pts[1] ?? tipB), radius, half, box, led: !!neckA },
        { at: tipB, axis: axisB ?? unit(neckB ?? tipB, pts[pts.length - 2] ?? tipA), radius, half, box, led: !!neckB },
      );
      return;
    }

    // ---- rigid routed cable ----------------------------------------------
    const s0 = p.segments[0]!, sn = p.segments[n - 1]!;
    // v1.11.4 THE DRAPE LAW applies to EVERY cable with both sockets live
    // (we: "the cables dont seem to hang" on 3308603448): in game, cables
    // are live ropes — the file's waypoints are the BUILDER'S CACHE (axis-
    // aligned bars tiling the route), and the game DISPLAYS them sagging by
    // their length. The viewport therefore draws the physical curve for
    // fresh runs too: rest length (Σ segment lengths + the joint zigzag
    // the drawn path walks) hangs as a CATENARY between the plug necks
    // (tips + 2r axial leads, socket law untouched); rest length ≤ span ⇒
    // TAUT straight. Runs with an unresolvable end keep the recorded
    // polyline (a drape connects to where the cable PHYSICALLY connects —
    // an unresolvable end is a tip we only know from the cache).
    // Style = the LONGEST recorded segment's (a run's segment[0] is often
    // the black sheath stub — the hung cable must not wear it).
    if (sock?.a && sock?.b) {
      net.draped++;
      if (plugA.stale || plugB.stale) net.reroute++;
      // the drawn cable length is what the file's route WALKS: the segments
      // plus the joint zigzag between chained starts — that total is the
      // rope the game hangs (the Σ length alone under-counts the slack on
      // multi-segment runs; a flexible pair's length field is exact).
      let walked = restLength(p);
      for (let si = 0; si < n - 1; si++) walked += segLen(raws[si]!, sts[si + 1]!);
      const pts = drapeChain(neckA ?? tipA, neckB ?? tipB, walked - leadA - leadB,
        radius);
      let big = s0;
      for (const s of p.segments) if (s.length > big.length) big = s;
      const color = segColor(big);
      const metal = !!big.metal || !!big.chrome;
      const box = !!big.box || sec.box;
      if (neckA) {
        segs.push({ a: tipA, b: neckA, radius, half, box, color, metal, kind });
        joints.push({ at: neckA, radius: half, color });
      }
      let prev = pts[0]!;
      for (let i = 1; i < pts.length; i++) {
        segs.push({ a: prev, b: pts[i]!, radius, half, box, color, metal, kind });
        if (i < pts.length - 1) joints.push({ at: pts[i]!, radius: half, color });
        prev = pts[i]!;
      }
      if (neckB) {
        segs.push({ a: neckB, b: tipB, radius, half, box, color, metal, kind });
        joints.push({ at: neckB, radius: half, color });
      }
      ends.push({ a: tipA, b: tipB });
      links.push({ a: p.a_component, b: p.b_component });
      polys.push([
        tipA, ...(neckA ? [neckA] : []), ...pts.slice(1, -1),
        ...(neckB ? [neckB] : []), tipB,
      ]);
      radii.push(half); piOf.push(pi);
      plugs.push(
        { at: tipA, axis: axisA ?? unit(neckA ?? tipA, pts[1] ?? tipB), radius, half, box, led: !!neckA },
        { at: tipB, axis: axisB ?? unit(neckB ?? tipB, pts[pts.length - 2] ?? tipA), radius, half, box, led: !!neckB },
      );
      return;
    }
    if (neckA) {
      segs.push({ a: tipA, b: neckA, radius, half, box: !!s0.box || sec.box,
        color: segColor(s0), metal: !!s0.metal || !!s0.chrome, kind });
      joints.push({ at: neckA, radius: half, color: segColor(s0) });
    }
    const pts: V3[] = [tipA];
    if (neckA) pts.push(neckA);
    p.segments.forEach((s, si) => {
      const a: V3 = si === 0 ? (neckA ?? tipA) : sts[si]!;
      const b: V3 = si === n - 1 ? (neckB ?? tipB) : raws[si]!;
      pts.push(b);
      segs.push({
        a, b, radius, half, box: !!s.box || sec.box,
        color: segColor(s), metal: !!s.metal || !!s.chrome, kind,
      });
      // elbow: a direction change closes with a sphere of the cable radius.
      // The LAST segment is stored reversed (it points from the b-adapter
      // back into the path) → its useful direction is the opposite.
      const next = p.segments[si + 1];
      if (next) {
        const nd = si + 2 === n ? (next.dir + 3) % 6 : next.dir;
        if (nd !== s.dir) joints.push({ at: raws[si]!, radius: half, color: segColor(s) });
        pts.push(sts[si + 1]!);                          // the drawn joint zigzag
      }
    });
    if (neckB) {
      segs.push({ a: neckB, b: tipB, radius, half, box: !!sn.box || sec.box,
        color: segColor(sn), metal: !!sn.metal || !!sn.chrome, kind });
      joints.push({ at: neckB, radius: half, color: segColor(sn) });
      pts.push(tipB);                    // pts already ends at neckB
    }
    ends.push({ a: tipA, b: tipB });
    links.push({ a: p.a_component, b: p.b_component });
    polys.push(pts);
    radii.push(half); piOf.push(pi);
    const d0 = DIRS[s0.dir] ?? DIRS[0]!, dn = DIRS[sn.dir] ?? DIRS[0]!;
    plugs.push(
      { at: tipA, axis: axisA ?? [-d0[0], -d0[1], -d0[2]], radius, half,
        box: !!s0.box || sec.box, led: !!neckA },
      { at: tipB, axis: axisB ?? dn, radius, half,
        box: !!sn.box || sec.box, led: !!neckB },
    );
  });
  net.pipes = pipes.length;
  return net;
}

/** distance from a ray (origin o, UNIT direction dd) to the segment a—b,
 *  closest-points solution with t ≥ 0 and s ∈ [0, 1] clamps. */
function raySegDist(o: V3, dd: V3, a: V3, b: V3): number {
  const ux = o[0] - a[0], uy = o[1] - a[1], uz = o[2] - a[2];   // o − a
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const ab2 = abx * abx + aby * aby + abz * abz;
  const abd = abx * dd[0] + aby * dd[1] + abz * dd[2];
  const du = dd[0] * ux + dd[1] * uy + dd[2] * uz;
  const abdu = abx * ux + aby * uy + abz * uz;
  let t: number, s: number;
  const det = ab2 - abd * abd;                       // |ab|²·|dd|² − (ab·dd)²
  if (ab2 < 1e-12) { t = Math.max(0, -du); s = 0; }
  else if (det < 1e-9) { s = 0; t = Math.max(0, -du); }
  else {
    t = (-du * ab2 + abd * abdu) / det;
    s = (abdu - abd * du) / det;
    s = s < 0 ? 0 : s > 1 ? 1 : s;
    // with s clamped, the ray's best t re-projects (a + s·ab) − o onto dd
    const qx = a[0] + s * abx - o[0], qy = a[1] + s * aby - o[1], qz = a[2] + s * abz - o[2];
    t = Math.max(0, qx * dd[0] + qy * dd[1] + qz * dd[2]);
  }
  t = Math.max(0, t);
  const cx = ux + t * dd[0] - s * abx, cy = uy + t * dd[1] - s * aby, cz = uz + t * dd[2] - s * abz;
  return Math.hypot(cx, cy, cz);
}

/**
 * HOVER-PICK A CABLE (v1.10.1, user: "on mouse-over of a cable, it should
 * tell us where things are going"): the NET RUN whose polyline passes
 * closest to the ray, when that distance is within the cable's drawn
 * half-extent plus a `tol` finger margin. Returns the NET index (map to a
 * data.pipes index with net.piOf) and the residual distance.
 */
export function pipeAt(net: PipeNetwork, o: V3, dd: V3,
  tol = 0.05): { i: number; dist: number } | null {
  let bi = -1, bd = Infinity;
  net.polys.forEach((poly, i) => {
    const lim = tol + (net.radii[i] ?? 0.02);
    for (let k = 1; k < poly.length; k++) {
      const dseg = raySegDist(o, dd, poly[k - 1]!, poly[k]!);
      if (dseg < bd && dseg <= lim) { bd = dseg; bi = i; break; }
    }
  });
  return bi < 0 ? null : { i: bi, dist: bd };
}

/** audit the DIRECTION RULE on the drawn network: every leaded plug must
 *  have a bar at its tip running ALONG the socket axis (a-end leaving it,
 *  b-end entering it). Pure so the pin can run headless and in the browser. */
export function checkLeads(net: PipeNetwork): { checked: number; bad: number } {
  let checked = 0, bad = 0;
  net.plugs.forEach((pl, i) => {
    if (!pl.led) return;
    checked++;
    const isA = i % 2 === 0;
    let ok = false;
    for (const s of net.segs) {
      const p = isA ? s.a : s.b;
      if (Math.hypot(p[0] - pl.at[0], p[1] - pl.at[1], p[2] - pl.at[2]) >= 1e-9) continue;
      const src = isA ? s.b : s.a;                          // the bar's far end
      const L = Math.hypot(src[0] - pl.at[0], src[1] - pl.at[1], src[2] - pl.at[2]);
      if (L < 1e-9) continue;
      const dot = ((src[0] - pl.at[0]) * pl.axis[0] + (src[1] - pl.at[1]) * pl.axis[1]
        + (src[2] - pl.at[2]) * pl.axis[2]) / L;
      // the lead stands OUTWARD from the tip on BOTH ends: the a-wire leaves
      // along +axis, the b-wire arrives FROM the neck above (travels −axis).
      // An incidental route bar touching the same point does not count —
      // the plug needs AN axial bar, so any axial bar satisfies the rule.
      if (dot >= 0.999) { ok = true; break; }
    }
    if (!ok) bad++;
  });
  return { checked, bad };
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
