// sockets.ts — where a cable REALLY plugs in (pure, no THREE).
//
// THE ANCHOR LAW (v1.8.1, measured over the whole corpus — 18 407 recorded
// pipe endpoints in 57 files, tangential residual median 0.000 m, p95 ≤ 0.01):
// a `.ini` [ADAPTER] sits in the engine CONTENT frame; the FILE-frame world
// position of the socket is
//
//     at   = position + R(qraw) · (a.x, a.z, −a.y)
//     axis = R(qraw) · (M·ẑ mapped the same way),  M = Rz(rz)·Ry(ry)·Rx(rx)
//
// with the orientation quaternion stored in the file AS-IS (the v1.5.11 raw
// law — one law for both generations). The stub axis M·ẑ is the direction
// the connector points OUT of the part: every recorded cable tip lies on
// this axis (tangent ≈ 0), pushed out 0..0.135 m along it. This is the way
// to "determine where they go in": the round grey sockets visible on the
// models ARE the adapters, and the .ini gives their exact pose.
//
// Caches lie: data.pipes stores the route the game built at save time, so a
// part moved afterwards leaves the tips behind. plugAnchor() keeps a fresh
// recorded tip (it is the truth of how deep the plug sits) but re-seats an
// endpoint that has drifted off its socket beyond STALE_R — standing it at
// least one cable radius off the face on the live socket (v1.8.2).
//
// FORMAT §pipes carries the normative write-up; pipes.test.ts + sockets.test.ts
// pin it, and the e2e pipe spec proves the rendered ends.

import { qRot } from './compparts';
import type { Pipe, Vec3D } from './format';
import type { FlatEntry } from './subgrid';
import type { ModelManifest } from './models';

export type V3 = readonly [number, number, number];
export type WireKind = 'data' | 'lowvoltage' | 'highvoltage' | 'fluid' | 'item';

/** a socket's live world pose (file == view frame, v0.180) */
export interface SocketAnchor {
  at: V3;
  /** outward stub axis (unit, file frame): the direction a cable leaves the part */
  axis: V3;
  kind: WireKind;
  /** v1.11.5 THE HARNESS ATTACH (we: "it goes to the OLD position of that
   *  pivot, rather than its actual current one"): set when the port's part
   *  lives in a SUBGRID and resolves at its DISPLAY pose — the rigid
   *  file▸display transform of the owning group. The recorded cable tip is
   *  RIGIDLY ATTACHED to the part: plugAnchor transforms the tip by the
   *  same motion, so the cable rides the door CONTINUOUSLY (the 0.45 m
   *  re-seat band is a cache-repair rule for top-level parts; a harness
   *  that snapped only when the door swung far enough read as "connected
   *  to the old spot"). */
  attach?: { t: V3; q: readonly [number, number, number, number] };
}

/** the two sockets a pipe run plugs into (null = unresolvable: no manifest,
 *  stale component index or unknown port name — keep the recorded end) */
export interface PipeSockets { a: SocketAnchor | null; b: SocketAnchor | null }

/** a recorded tip further than this from its socket is a stale cache, not a
 *  seating offset (comptest's 0.35 m model-surface tolerance + stub margin) */
export const STALE_R = 0.45;
/** a tip this far OFF the stub axis is not seated either (the game writes
 *  tips ON the axis: corpus p95 tangent 0.000 m; user-moved parts leave
 *  lateral drift like the 0.40 m Dashboard tip on 3481322297) */
export const TAN_MAX = 0.15;
/** how far OUT along the stub a re-anchored tip may sit (corpus fresh files:
 *  0..0.135 m; the game never writes a plug a full stub away) */
export const TIP_MAX = 0.135;
const TIP_DEF = 0.05;

/** the game's per-kind cable radius (corpus census: data/lowvoltage 0.02,
 *  highvoltage 0.04, fluid 0.045, item 0.08) — the fallback when a pipe
 *  record omits `radius` */
export const KIND_RADIUS: Record<string, number> = {
  data: 0.02, lowvoltage: 0.02, highvoltage: 0.04, fluid: 0.045, item: 0.08,
};

const KINDS = new Set<string>(Object.keys(KIND_RADIUS));

const ID = { w: 1, x: 0, y: 0, z: 0 };

/** .ini rotation triple (degrees) acting on ẑ — M = Rz(rz)·Ry(ry)·Rx(rx),
 *  the engine's ZYX euler order (AGENTS §Component models; arbitrated by the
 *  multi-axis adapters — 114 of 330 — landing tangents at 0.000 m). */
function stubDirContent(rx: number, ry: number, rz: number): V3 {
  const d = Math.PI / 180;
  const cx = Math.cos(rx * d), sx = Math.sin(rx * d);
  const cy = Math.cos(ry * d), sy = Math.sin(ry * d);
  const cz = Math.cos(rz * d), sz = Math.sin(rz * d);
  // (Rz·Ry·Rx)·(0,0,1) — third column of the product
  return [cz * sy * cx + sz * sx, sz * sy * cx - cz * sx, cy * cx];
}

/** content → file vector map (the same C the real-model basis group uses):
 *  (x, y, z)content → (x, z, −y)file */
const contentToFile = (v: V3): V3 => [v[0], v[2], -v[1]];

/** one adapter's live socket pose on a component at its stored pose */
export function adapterSocket(
  pos: Vec3D, orientation: { w: number; x: number; y: number; z: number } | undefined,
  a: { type: string; position: [number, number, number]; rotation: [number, number, number] },
): SocketAnchor {
  const q = orientation ?? ID;
  const off = qRot(q, contentToFile(a.position));
  const ax = qRot(q, contentToFile(stubDirContent(a.rotation[0], a.rotation[1], a.rotation[2])));
  const n = Math.hypot(ax[0], ax[1], ax[2]) || 1;
  return {
    at: [pos.x + off[0], pos.y + off[1], pos.z + off[2]],
    axis: [ax[0] / n, ax[1] / n, ax[2] / n],
    kind: (KINDS.has(a.type) ? a.type : 'data') as WireKind,
  };
}

/** the manifest adapter with this exact port name (`.ini` names are stored
 *  verbatim, `.001` suffixes included) */
export function manifestAdapter(manifest: ModelManifest | null, type: string, port: string) {
  const ads = manifest?.[type]?.adapters;
  if (!ads) return null;
  return ads.find(a => a.name === port) ?? null;
}

/** Resolve both ends of every pipe to their sockets. Index-aligned with the
 *  pipe list; an entry is null when nothing is resolvable at all. Endpoints
 *  resolve through the FLATTENED component list (data.pipes keys, AGENTS
 *  §Subgrids / edit.ts pruneCompRefs). */
export function pipeSockets(
  pipes: readonly Pipe[] | undefined, flat: readonly FlatEntry[],
  manifest: ModelManifest | null,
): (PipeSockets | null)[] {
  if (!pipes?.length) return [];
  return pipes.map(p => {
    const side = (ci: number, port: string): SocketAnchor | null => {
      const e = flat[ci];
      const c = e?.comp;
      if (!c) return null;
      const a = manifestAdapter(manifest, c.type, port);
      if (!a) return null;
      const sock = adapterSocket(c.position, c.orientation, a);
      // v1.11.5: a display-pose entry (subgrid part) carries the rigid
      // attach transform for the recorded tip (see SocketAnchor.attach)
      const att = (e as { attach?: { t: V3; q: readonly [number, number, number, number] } }).attach;
      return att ? { ...sock, attach: att } : sock;
    };
    const a = side(p.a_component, p.a_port);
    const b = side(p.b_component, p.b_port);
    return a || b ? { a, b } : null;
  });
}

/** Where an end is DRAWN and in which direction the wire leaves it.
 *
 *  THE DIRECTION RULE (v1.8.2, user: "the wire must always connect in the
 *  right direction ONTO/FROM the connector and the radius of the wire is
 *  the minimum distance it must continue in the same direction as the
 *  connector"): the bar touching a connector runs along the connector's
 *  stub axis and continues straight for at least the cable's own lead
 *  (2× the cable radius) before the route may bend — the plug tip itself
 *  sits at least one cable radius out of the socket, so the plug is visible
 *  ON the circle. Measured: the game's fresh routes already leave along the
 *  axis (median dot(seg0 dir, stub axis) +0.97..+1.000 over 17 815 fresh
 *  ends) — for them the lead bar is collinear and the rule costs nothing;
 *  it bites exactly where the cached route came loose from the part.
 *
 *  Fresh ⇔ within STALE_R of the socket AND within TAN_MAX of the stub
 *  axis: the recorded tip is kept verbatim (it encodes how deep the plug
 *  was seated). A stale end re-seats on the socket, keeping an in-band
 *  [0, TIP_MAX] recorded depth (garbage → TIP_DEF), never closer than one
 *  cable radius. */
export interface Plug {
  /** the drawn connection point (plug tip, on the stub axis) */
  tip: V3;
  /** how far OUT along the stub the tip sits — the recorded seating depth
   *  when fresh; ≥ radius (the plug must stand off the face visibly) */
  depth: number;
  /** how far the wire runs STRAIGHT along the stub before it may bend */
  lead: number;
  stale: boolean;
}

/** q · p · q⁻¹ (unit q as [w,x,y,z]) */
function rotQ(q: readonly [number, number, number, number], p: V3): V3 {
  const [w, x, y, z] = q;
  // t = 2·(q_vec × p); p' = p + w·t + q_vec × t
  const tx = 2 * (y * p[2] - z * p[1]), ty = 2 * (z * p[0] - x * p[2]), tz = 2 * (x * p[1] - y * p[0]);
  return [
    p[0] + w * tx + (y * tz - z * ty),
    p[1] + w * ty + (z * tx - x * tz),
    p[2] + w * tz + (x * ty - y * tx),
  ];
}

export function plugAnchor(recorded: V3, s: SocketAnchor | null, radius: number): Plug {
  if (!s) return { tip: recorded, depth: 0, lead: 0, stale: false };
  // v1.11.5: a subgrid part's tip rides the part (attach transform first)
  let rec = recorded;
  if (s.attach) {
    const r = rotQ(s.attach.q, recorded);
    rec = [r[0] + s.attach.t[0], r[1] + s.attach.t[1], r[2] + s.attach.t[2]];
  }
  const dx = rec[0] - s.at[0], dy = rec[1] - s.at[1], dz = rec[2] - s.at[2];
  const proj = dx * s.axis[0] + dy * s.axis[1] + dz * s.axis[2];
  const tan = Math.hypot(dx - proj * s.axis[0], dy - proj * s.axis[1], dz - proj * s.axis[2]);
  if (tan <= TAN_MAX && Math.hypot(dx, dy, dz) <= STALE_R) {
    return { tip: rec, depth: Math.max(proj, 0), lead: 2 * radius, stale: false };
  }
  const seat = proj > 0 && proj <= TIP_MAX ? proj : TIP_DEF;
  const depth = Math.max(seat, radius);
  return {
    tip: [s.at[0] + s.axis[0] * depth, s.at[1] + s.axis[1] * depth, s.at[2] + s.axis[2] * depth],
    depth,
    lead: 2 * radius,
    stale: true,
  };
}
