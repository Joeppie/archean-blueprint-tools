// subgrid.ts — the composite_builds JOIN decode + the subgrid joint kinematics.
// PURE (no THREE, no DOM): scene.ts feeds it live poses and applies the
// resulting group transforms; vitest pins it against the corpus fixtures.
//
// Decoded semantics (AGENTS §Subgrids, FORMAT.md; legacy v0.154–v0.177):
//  • BOTH composite_builds indices — `component` (master) AND `slaveBuildId` —
//    are FLATTENED component indices in the dev readBuild order: nested
//    content numbers BEFORE its Build, recursively. Reading the master index
//    top-level is a systematic off-by-(nested-prefix) shift onto static junk.
//  • A subgrid group's BASE is the IDENTITY: nested data.blocks/components sit
//    at the PARENT's absolute grid coords. Build.position/orientation is the
//    builder's bench ghost, applied on top only as a display offset (never an
//    origin) — composing it under absolute content double-offsets it.
//  • The joint chain rides on top of the base: spin/slide about the BUILD-
//    CAPTURED joint line, then the master's RIGID pose delta rides the whole
//    thing (X' = p0 + dq·(X−p0) + (p−p0), dq = q·q0⁻¹) — identity while the
//    master sits at its built pose, so the load display is bit-identical.
//
// THE PANEL LAW (v1.10.2, 2026-10-24 — replaces the v0.174-177 empirical
// triad rule): the panel spins about the world line through the axle pivot
// with DIRECTION  R(q_master)·C·ê  (C = Rx(−90) content basis: êx→x̂,
// êy→−ẑ, êz→+ŷ), by data.angle DEGREES. This is byte-proven: 157 of 166
// (subgrid, master) pairs across the corpus carry the game's own baked panel
// transform in Build.orientation, and the rotation part of that transform is
// EXACTLY this law applied to data.angle (tools/bench_census.py; the 9
// residual mismatches are mirror twins whose sign the game's physics mirrored
// at save — see bakedAngle below). The old law R(q)·qAxle·ê + the panel-span
// triad was an empirical fit: it happens to agree wherever mounts are upright
// or the pin×span proxy lands on the part line, but the bench census scores
// it 0/18 collinear on rotated mounts — the Badger (3326372833) cockpit door
// (SmallPivot mounted Rz(∓90)) swung as a drawbridge about x̂ while the game
// hinges it about the fore–aft ẑ line through the pivot (bench exact).
// qAxle (the .ini axle-node euler) is NOT in the law — exact 157 vs 9.
// The slide key maps the same way (êx is C-invariant, so every LinearTrack
// pin is byte-identical).
//
// bakedAngle (v1.10.2): Build.orientation is the GAME's saved panel pose.
// Where it is a rotation, its signed angle about the law axis becomes the
// angle the group renders at (exact incl. the game's mirrored-twin sign
// flips, e.g. XYQ door 2) and further data.angle edits apply as DELTAS from
// the authored angle: effective = baked + (live − authored). Identity bench
// ⇒ baked = authored ⇒ pure joint(live) — every historic no-bench behaviour
// is untouched, and on the 157 exact pairs baked == live == bench angle, so
// the load display is the game's own transform. Build.POSITION is never
// trusted (construction-ghost offsets up to 23 m — v0.168 stands); only the
// rotation part of the bench is.

import type { Blueprint, BlueprintComponent, Block, FileQuat } from './format';
import { CELL, CELLS_PER_FRAME } from './format';
import { fileToViewQuat, qAxisAngle, qMul, qRot, type V3 } from './compparts';
import type { ModelManifest } from './models';

// ---------------------------------------------------------------- flattening

export interface FlatEntry {
  comp: BlueprintComponent;
  /** top-level components[] index when the comp is top-level, else -1 */
  top: number;
  /** doc path to this component (['data','components',i, …]) */
  path: (string | number)[];
}

/** dev readBuild order: for every component, recurse into a Build's nested
 *  components FIRST, then push — nested content numbers before its Build. */
export function flattenComponents(bp: Blueprint): FlatEntry[] {
  const out: FlatEntry[] = [];
  const topIdx = new Map<BlueprintComponent, number>();
  bp.data.components.forEach((c, i) => topIdx.set(c, i));
  const rec = (list: BlueprintComponent[], path: (string | number)[]) => {
    list.forEach((c, i) => {
      const p = [...path, i] as (string | number)[];
      const sub = c.data?.['components'] as BlueprintComponent[] | undefined;
      if (c.type === 'Build' && sub?.length) rec(sub, [...p, 'data', 'components']);
      out.push({ comp: c, top: topIdx.get(c) ?? -1, path: p });
    });
  };
  rec(bp.data.components, ['data', 'components']);
  return out;
}

/** Map: top-level Build index → its decoded master entries (a subgrid may
 *  carry more than one; an entry with mc === null is a deleted editor ref). */
export interface SubMasterEntry {
  /** raw flattened index the composite_builds entry names */
  component: number;
  mc: BlueprintComponent | null;
  /** top-level index of the master when it is top-level, else -1 */
  top: number;
  /** doc path to the master (nested masters included), undefined when gone */
  mcPath?: (string | number)[];
}

export function subMasterEntries(bp: Blueprint): Map<number, SubMasterEntry[]> {
  const flat = flattenComponents(bp);
  const byBuild = new Map<number, SubMasterEntry[]>();
  for (const e of bp.data.composite_builds ?? []) {
    const bcEntry = flat[e.slaveBuildId];
    if (!bcEntry || bcEntry.comp.type !== 'Build') continue;
    const m = flat[e.component];
    const ent: SubMasterEntry = {
      component: e.component,
      mc: m?.comp ?? null,
      top: m?.top ?? -1,
      mcPath: m?.path,
    };
    // v1.11.6: a join whose slave is a NESTED Build rides the HOSTING
    // top-level group's joint chain (path[2] = the top-level ancestor) —
    // landing-gear subassemblies animate with their bay (the Dorito
    // front wheels). Depth-1 entries keep their own key.
    const bi = bcEntry.top >= 0 ? bcEntry.top
      : bcEntry.path && bcEntry.path.length > 3 ? bcEntry.path[2] as number : -1;
    if (bi < 0) continue;
    if (!byBuild.has(bi)) byBuild.set(bi, []);
    byBuild.get(bi)!.push(ent);
  }
  return byBuild;
}

// ------------------------------------------------------------ joint chain

const UNIT: Record<'x' | 'y' | 'z', V3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

export interface JointChain {
  /** view-space spin axis */
  axis: V3;
  /** view-space slide axis */
  slide: V3;
  /** view-space axle pivot (the PART's hinge point, unclamped) */
  pivot: V3;
}

const DEG = Math.PI / 180;
const qInv = (q: FileQuat): FileQuat => ({ w: q.w, x: -q.x, y: -q.y, z: -q.z });

/** THE PANEL LAW (v1.10.2): the .ini joint key ê expressed in the part
 *  frame = engine content basis C = Rx(−90) applied to the key: file→content
 *  (x,y,z)→(x,z,−y), so êx→x̂, êy→−ẑ, êz→+ŷ. The world spin direction is
 *  R(q_master)·C·ê — byte-proven on 157/166 corpus pairs by
 *  tools/bench_census.py (the game's own baked Build.orientation equals
 *  qAxisAngle(this, data.angle)). The êx column is C-INVARIANT, which is why
 *  every historic Aileron/LinearTrack x-key pin rides this change unchanged. */
export const CONTENT_KEY: Record<'x' | 'y' | 'z', V3> = {
  x: [1, 0, 0], y: [0, 0, -1], z: [0, 1, 0],
};
const vSub = (a: V3, b: V3): V3 => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
const vAdd = (a: V3, b: V3): V3 => [a[0]! + b[0]!, a[1]! + b[1]!, a[2]! + b[2]!];
const vScale = (a: V3, s: number): V3 => [a[0]! * s, a[1]! * s, a[2]! * s];
const vNorm = (a: V3): V3 => {
  const l = Math.hypot(a[0]!, a[1]!, a[2]!) || 1;
  return [a[0]! / l, a[1]! / l, a[2]! / l];
};

/** Euler ZYX in DEGREES → unit quaternion (the .ini/gltf placement order). */
export function eulerZYX(rx: number, ry: number, rz: number): FileQuat {
  const qx = qAxisAngle([1, 0, 0], rx * DEG);
  const qy = qAxisAngle([0, 1, 0], ry * DEG);
  const qz = qAxisAngle([0, 0, 1], rz * DEG);
  return qMul(qz, qMul(qy, qx));                      // Rz∘Ry∘Rx
}

/** The master's live joint line: spin/slide axes + axle pivot (view space).
 *  THE PANEL LAW (v1.10.2): axis = R(q)·C·ê (see CONTENT_KEY + the file
 *  header; bench-census-exact 157/166), slide maps the same way. The axle
 *  node's authored euler is NOT part of the line (bench-exact 157 vs 9).
 *  null = the type has no .ini [JOINT] (static host: dashboards, RTGs, lamps).
 *  NOTE Lamp/SpotLight carry angle fields (light AIM) but joints:[] — the
 *  joint drive must not fire on them, which the joints[0] test guarantees. */
export function jointChain(
  mc: BlueprintComponent, manifest: ModelManifest | null,
): JointChain | null {
  const jn = manifest?.[mc.type]?.joints?.[0];
  if (!jn) return null;
  const mq = fileToViewQuat(mc.orientation ?? { w: 1, x: 0, y: 0, z: 0 });
  const axis = vNorm(qRot(mq, CONTENT_KEY[jn.axis ?? 'x']));
  const slide = vNorm(qRot(mq, CONTENT_KEY[jn.slide ?? jn.axis ?? 'x']));
  const pivot = vAdd(
    qRot(mq, [jn.position[0]!, jn.position[1]!, jn.position[2]!] as V3),   // raw local (v0.180)
    [mc.position.x, mc.position.y, mc.position.z],
  );
  return { axis, slide, pivot };
}

// ----------------------------------------------------- THE PLATE LAW v2 (v1.10.2)
// A part model's .ini node chain hangs under the engine CONTENT BASIS C =
// Rx(−90) (file (x,y,z) → content (x,z,−y); FORMAT §Component VERTEX SPACE).
// THE PANEL LAW (v1.10.2, file header + jointChain) turns the panel about
// R(q)·C·ê, so the part's OWN slave plate must turn about the SAME line:
//   rotation: v = baseQ⁻¹ · ê    (node space, right-multiplied: the world
//                                   chain R(q)·C·baseQ·v collapses to R(q)·C·ê)
//   slide:    d = ê              (the node position lives in the C-group
//                                   space: R(q)·C·d ≡ R(q)·C·ê)
// For ê = x̂ every map is the identity column, so every historic x-axis pin
// (Aileron flap, LinearTrack slide) is byte-identical. (v1.9.0's formulas
// conjugated C toward the OLD panel law R(q)·baseQ·ê — superseded together
// with that law by the corpus bench census, tools/bench_census.py.)
// Measured live with app/tools/plateprobe.mjs / rudderprobe.mjs.

/** The axle-node LOCAL rotation axis whose WORLD line equals the panel law
 *  R(q)·C·ê (see THE PLATE LAW header). baseQ = the axle's authored .ini
 *  rotation (eulerZYX of its rotation keys). */
export function jointNodeAxis(baseQ: FileQuat, axis: 'x' | 'y' | 'z'): V3 {
  return vNorm(qRot(qInv(baseQ), UNIT[axis]));
}

/** The axle-node position (C-group space) direction whose WORLD line equals
 *  the panel slide law R(q)·C·ê. */
export function jointNodeSlide(_baseQ: FileQuat, axis: 'x' | 'y' | 'z'): V3 {
  return [...UNIT[axis]] as V3;
}

// ---------------------------------------------------------- panel bbox + jref

export interface SubBBox { min: V3; max: V3 }

/** View-space bbox of the subgrid's NON-255 blocks (nested content sits at
 *  parent-absolute cells; occupancy mirrors sit AT the master → excluded).
 *  null = parts-only subgrid (empty block list).
 *  RAW == VIEW (v0.180): this box is the CLAMP TARGET for the joint line in
 *  captureJrefs, so it must live in the same frame as jointChain()'s pivot and
 *  JRef.p0. The pre-v0.180 z-mirror here made the clamp grab the panel's
 *  MIRROR IMAGE: Jimmy's Adventure gantry pivot clamped to z=+15.9 while its
 *  SmallPivot sits at z=−14.4 — a 30 m phantom lever, so rotating the part
 *  swept the panel 11 m ("subgrid rotation is way off when I move components
 *  … rotation isnt properly relative … towards the joints themselves"). */
export function subBlockBBox(blocks: Block[] | undefined): SubBBox | null {
  let min: V3 | null = null, max: V3 | null = null;
  const grow = (p: V3) => {
    if (!min || !max) { min = [p[0]!, p[1]!, p[2]!]; max = [p[0]!, p[1]!, p[2]!]; return; }
    const m: V3 = min, x: V3 = max;
    min = [Math.min(m[0]!, p[0]!), Math.min(m[1]!, p[1]!), Math.min(m[2]!, p[2]!)];
    max = [Math.max(x[0]!, p[0]!), Math.max(x[1]!, p[1]!), Math.max(x[2]!, p[2]!)];
  };
  for (const b of blocks ?? []) {
    if ((b.type ?? 0) === 255) continue;
    for (const s of [[0, 0, 0], [b.size_x + 1, b.size_y + 1, b.size_z + 1]] as const) {
      grow([
        (b.pos_x + s[0] + (b.frame_x ?? 0) * CELLS_PER_FRAME - 5.5) * CELL,
        (b.pos_y + s[1] + (b.frame_y ?? 0) * CELLS_PER_FRAME - 5.5) * CELL,
        (b.pos_z + s[2] + (b.frame_z ?? 0) * CELLS_PER_FRAME - 5.5) * CELL,
      ]);
    }
  }
  return min && max ? { min: min as V3, max: max as V3 } : null;
}

/** Build-captured joint line for ONE (subgrid, master) pair — captured once
 *  per load (legacy userData.jref), replayed by subJointPose as the master's
 *  angle/slide/pose change. */
export interface JRef {
  mc: BlueprintComponent;
  /** doc path to the master (for editing its data.angle / data.pos) */
  mcPath: (string | number)[] | undefined;
  /** top-level components[] index of the master when top-level, else -1
   *  (the hinge UI + joint sliders only edit through this index) */
  top: number;
  /** master pose at capture (view, pre-moff) — the rigid-delta anchor */
  p0: V3; q0: FileQuat;
  /** the CAPTURED joint line: pivot clamped onto the panel bbox, axis/slide
   *  by THE PANEL LAW R(q)·C·ê (v1.10.2) */
  pivot0: V3; axis0: V3; slide0: V3;
  /** the master's data at capture — edits render as DELTAS from it */
  authoredAngle: number; authoredSlide: number;
  /** the angle the game itself displays at load: the signed angle of the
   *  Build's baked orientation (bench pose) about axis0, else authoredAngle.
   *  Only the FIRST JRef of a Build carries a non-authored bake (one bench
   *  pose describes one composite transform). */
  bakedAngle: number;
}

export function captureJrefs(
  entries: SubMasterEntry[], bb: SubBBox | null, manifest: ModelManifest | null,
  bench: FileQuat | null = null, benchPos: V3 | null = null,
): JRef[] {
  const out: JRef[] = [];
  // bench orientation → signed angle about a unit line direction (v1.10.2:
  // the game's saved panel pose; its TRANSLATION stays untrusted ghost noise)
  const benchAngleAbout = (axis: V3): { deg: number; rotated: boolean } => {
    if (!bench) return { deg: 0, rotated: false };
    let { w, x, y, z } = bench;
    if (w < 0) { w = -w; x = -x; y = -y; z = -z; }
    const s = Math.hypot(x, y, z);
    if (s < 1e-6) return { deg: 0, rotated: false };
    const dot = (x * axis[0]! + y * axis[1]! + z * axis[2]!) / s;
    return { deg: 2 * Math.atan2(s, w) / DEG * Math.sign(dot || 1), rotated: true };
  };
  // the bench rotation's fixed line (v1.10.2): a 2-D rotation about an axis
  // through c ⟺ rotation about the same axis + translation (I−R)·c. Where a
  // LAW-EXACT bench is present this recovers the GAME's own hinge line.
  const benchFixedPoint = (): V3 | null => {
    if (!bench) return null;
    let { w, x, y, z } = bench;
    if (w < 0) { w = -w; x = -x; y = -y; z = -z; }
    const s = Math.hypot(x, y, z);
    if (s < 1e-6 || !benchPos) return null;
    // solve (I − R(q))·c = −t least-squares with a ridge along the axis
    const R: [V3, V3, V3] = [
      [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
      [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
      [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ];
    const A = R.map((row, i) => row.map((v, k) => v - (i === k ? 1 : 0)));
    const t = benchPos;
    const N = [0, 1, 2].map(i => [0, 1, 2].map(j =>
      A[0]![i]! * A[0]![j]! + A[1]![i]! * A[1]![j]! + A[2]![i]! * A[2]![j]! + 1e-9 * (i === j ? 1 : 0)));
    const r = [0, 1, 2].map(i => -(A[0]![i]! * t[0]! + A[1]![i]! * t[1]! + A[2]![i]! * t[2]!));
    // Gaussian elimination (3×3, ridge-regularised ⇒ invertible)
    const M = N.map((row, i) => [...row, r[i]!]);
    for (let col = 0; col < 3; col++) {
      let piv = col;
      for (let rr = col + 1; rr < 3; rr++) if (Math.abs(M[rr]![col]!) > Math.abs(M[piv]![col]!)) piv = rr;
      [M[col], M[piv]] = [M[piv]!, M[col]!];
      for (let rr = 0; rr < 3; rr++) {
        if (rr === col) continue;
        const f = M[rr]![col]! / M[col]![col]!;
        for (let cc = col; cc < 4; cc++) M[rr]![cc]! -= f * M[col]![cc]!;
      }
    }
    return [M[0]![3]! / M[0]![0]!, M[1]![3]! / M[1]![1]!, M[2]![3]! / M[2]![2]!];
  };
  for (const e of entries) {
    const mc = e.mc;
    if (!mc) continue;
    const j0 = jointChain(mc, manifest);
    if (!j0) continue;                                 // static host: no joint term
    const p0: V3 = [mc.position.x, mc.position.y, mc.position.z];
    const q0 = fileToViewQuat(mc.orientation ?? { w: 1, x: 0, y: 0, z: 0 });
    const authoredAngle = typeof mc.data?.['angle'] === 'number' ? (mc.data['angle'] as number) : 0;
    const authoredSlide = typeof mc.data?.['pos'] === 'number' ? (mc.data['pos'] as number) : 0;
    let pivot0 = j0.pivot;
    if (bb) {                                          // panel: clamp the line onto the content
      const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
      pivot0 = [
        clamp(j0.pivot[0], bb.min[0], bb.max[0]),
        clamp(j0.pivot[1], bb.min[1], bb.max[1]),
        clamp(j0.pivot[2], bb.min[2], bb.max[2]),
      ];
    }
    // parts-only subgrids (no blocks) ride the UNCLAMPED axle — the Badger's
    // triangle skins proved the game's hinge line sits on the part's own
    // law line there (bench line offset 0.000 m).
    let bakedAngle = authoredAngle;
    if (out.length === 0) {
      const b = benchAngleAbout(j0.axis);
      if (b.rotated) bakedAngle = b.deg;               // the GAME's saved pose
      // v1.10.2 bench-anchored pivot: on a LAW-EXACT bench the game's hinge
      // line is the bench's fixed line — ride it (within 1 m; a larger gap =
      // a construction-site ghost, not a panel pose, so the raw axle line
      // stays). The line's direction is the law axis; only the perpendicular
      // anchor is taken from the bench, the raw pivot's along-line coord is
      // kept for stability (it is a free coordinate on the line anyway).
      if (!bb) {
        const c = benchFixedPoint();
        if (c) {
          const a = j0.axis;
          const w = [pivot0[0]! - c[0]!, pivot0[1]! - c[1]!, pivot0[2]! - c[2]!];
          const par = w[0]! * a[0]! + w[1]! * a[1]! + w[2]! * a[2]!;
          const perp = Math.hypot(w[0]! - par * a[0]!, w[1]! - par * a[1]!, w[2]! - par * a[2]!);
          if (perp < 1) {
            pivot0 = [
              pivot0[0]! - (w[0]! - par * a[0]!),
              pivot0[1]! - (w[1]! - par * a[1]!),
              pivot0[2]! - (w[2]! - par * a[2]!),
            ];
          }
        }
      }
    }
    out.push({
      mc, mcPath: e.mcPath, top: e.top, p0, q0,
      pivot0, axis0: j0.axis, slide0: j0.slide,
      authoredAngle, authoredSlide, bakedAngle,
    });
  }
  return out;
}

// ------------------------------------------------------------- joint pose

export interface SubPose { p: V3; q: FileQuat }

/** Compose the subgrid group pose: identity base ∘ joint chain ∘ rigid ride.
 *  `states` = the live per-JRef data (master's data.angle in DEGREES /
 *  data.pos in metres + the master's CURRENT view-space pose — edits to the
 *  master's file pose flow through these and ride the whole subgrid in
 *  unison). The spin angle is the game's own delta model (v1.10.2): the
 *  panel rides `bakedAngle` (the angle the GAME saved/displayed) and every
 *  data.angle edit moves it by the DELTA from the authored value, so a load
 *  lands exactly on the game's pose (bench-exact) while sliders keep the
 *  live-drag feel. Pure: mutates nothing. */
export function subJointPose(
  base: SubPose, jrefs: JRef[],
  states: { angle: number; slide: number; pos: V3; quat: FileQuat }[],
): SubPose {
  let p: V3 = [...base.p];
  let q: FileQuat = { ...base.q };
  jrefs.forEach((r, i) => {
    const st = states[i];
    if (!st) return;
    const aDeg = r.bakedAngle + (st.angle - r.authoredAngle);
    const s = st.slide;
    if (aDeg) {
      const R = qAxisAngle(r.axis0, aDeg * DEG);
      p = vAdd(qRot(R, vSub(p, r.pivot0)), r.pivot0);
      q = qMul(R, q);                                  // premultiply: world-space spin
    }
    if (s) p = vAdd(p, vScale(r.slide0, s));
    // rigid riding: dq = q·q0⁻¹ about the master's capture-time origin
    const dq = qMul(st.quat, qInv(r.q0));
    p = vAdd(vAdd(qRot(dq, vSub(p, r.p0)), r.p0), vSub(st.pos, r.p0));
    q = qMul(dq, q);
  });
  return { p, q };
}

/** Live joint state read from the master's file data + CURRENT pose.
 *  Lamp/SpotLight 'angle' (aim) never reaches here — no .ini joint ⇒ no JRef. */
export function masterJointState(mc: BlueprintComponent) {
  return {
    angle: typeof mc.data?.['angle'] === 'number' ? (mc.data['angle'] as number) : 0,
    slide: typeof mc.data?.['pos'] === 'number' ? (mc.data['pos'] as number) : 0,
    pos: [mc.position.x, mc.position.y, mc.position.z] as V3,
    quat: fileToViewQuat(mc.orientation ?? { w: 1, x: 0, y: 0, z: 0 }),
  };
}
