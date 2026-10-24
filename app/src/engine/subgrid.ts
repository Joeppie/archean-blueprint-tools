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
//    CAPTURED joint line (pivot clamped onto the panel bbox = the content edge
//    line nearest the master; the AXIS is the hinge kinematic triad: edge-
//    mounted hinges swing on their pin, face-mounted ones on pin×span; pivot/
//    track panels along their longest dimension), then the master's RIGID pose
//    delta rides the whole thing (X' = p0 + dq·(X−p0) + (p−p0), dq = q·q0⁻¹) —
//    identity while the master sits at its built pose, so the load display is
//    bit-identical.
// EPISTEMIC STATUS: the axis rules are an EMPIRICAL FIT to user-confirmed
// in-game motions (dolphin/XYQ/truck/gantry pins), not format semantics — the
// format stores NO kinematic fields for the join.

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
    const bi = bcEntry.top;
    if (bi < 0) continue;                              // nested Build: unused host
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
const vSub = (a: V3, b: V3): V3 => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
const vAdd = (a: V3, b: V3): V3 => [a[0]! + b[0]!, a[1]! + b[1]!, a[2]! + b[2]!];
const vScale = (a: V3, s: number): V3 => [a[0]! * s, a[1]! * s, a[2]! * s];
const vNorm = (a: V3): V3 => {
  const l = Math.hypot(a[0]!, a[1]!, a[2]!) || 1;
  return [a[0]! / l, a[1]! / l, a[2]! / l];
};
const vCross = (a: V3, b: V3): V3 => [
  a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!,
];
const vDot = (a: V3, b: V3) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

/** Euler ZYX in DEGREES → unit quaternion (the .ini/gltf placement order). */
export function eulerZYX(rx: number, ry: number, rz: number): FileQuat {
  const qx = qAxisAngle([1, 0, 0], rx * DEG);
  const qy = qAxisAngle([0, 1, 0], ry * DEG);
  const qz = qAxisAngle([0, 0, 1], rz * DEG);
  return qMul(qz, qMul(qy, qx));                      // Rz∘Ry∘Rx
}

/** The master's live joint line: spin/slide axes + axle pivot (view space).
 *  null = the type has no .ini [JOINT] (static host: dashboards, RTGs, lamps).
 *  NOTE Lamp/SpotLight carry angle fields (light AIM) but joints:[] — the
 *  joint drive must not fire on them, which the joints[0] test guarantees. */
export function jointChain(
  mc: BlueprintComponent, manifest: ModelManifest | null,
): JointChain | null {
  const jn = manifest?.[mc.type]?.joints?.[0];
  if (!jn) return null;
  const qAxle = eulerZYX(jn.rotation[0]!, jn.rotation[1]!, jn.rotation[2]!);
  const mq = fileToViewQuat(mc.orientation ?? { w: 1, x: 0, y: 0, z: 0 });
  const axis = vNorm(qRot(mq, qRot(qAxle, UNIT[jn.axis ?? 'x'])));
  const slide = vNorm(qRot(mq, qRot(qAxle, UNIT[jn.slide ?? jn.axis ?? 'x'])));
  const pivot = vAdd(
    qRot(mq, [jn.position[0]!, jn.position[1]!, jn.position[2]!] as V3),   // raw local (v0.180)
    [mc.position.x, mc.position.y, mc.position.z],
  );
  return { axis, slide, pivot };
}

// ------------------------------------------------- THE PLATE LAW (v1.9.0)
// A part model's .ini node chain hangs under the engine CONTENT BASIS C =
// Rx(−90) (file (x,y,z) → content (x,z,−y); FORMAT §Component VERTEX SPACE).
// The subgrid PANEL law (jointChain — the in-game-pinned axis for EVERY
// corpus hinge: dolphin car-doors, XYQ, truck flaps, gantry) rotates the
// panel about the world line R(q)·qAxle·ê with the .ini axis key ê read in
// the part-local FILE frame. The part's OWN slave plate must turn about the
// SAME line — rotating the axle node about the raw key ê inside the C basis
// instead spins it about R(q)·C·ê (v1.9.0: the balloon's rudder
// plate rolled about the fore–aft axis like a PROPELLER while its panel
// yawned correctly about the vertical). Measured live with
// app/tools/plateprobe.mjs / rudderprobe.mjs. Conjugating C out of the
// node-local axis lands the plate on the panel's line:
//   rotation: v = baseQ⁻¹ · C⁻¹ · baseQ · ê   (node space, right-multiplied)
//   slide:    d = C⁻¹ · baseQ · ê             (node position = parent space)
// For ê = x̂ the content basis is INVARIANT (C·x̂ = x̂), so every historic
// x-axis pin (Aileron flap, LinearTrack slide) is byte-identical.
const C_INV: FileQuat = { w: Math.SQRT1_2, x: Math.SQRT1_2, y: 0, z: 0 }; // Rx(+90)

/** The axle-node LOCAL rotation axis whose WORLD line equals the panel law
 *  R(q)·baseQ·ê (see THE PLATE LAW header). baseQ = the axle's authored .ini
 *  rotation (eulerZYX of its rotation keys). */
export function jointNodeAxis(baseQ: FileQuat, axis: 'x' | 'y' | 'z'): V3 {
  return vNorm(qRot(qMul(qInv(baseQ), qMul(C_INV, baseQ)), UNIT[axis]));
}

/** The axle-node position (parent-space) direction whose WORLD line equals
 *  the panel slide law R(q)·baseQ·ê. */
export function jointNodeSlide(baseQ: FileQuat, axis: 'x' | 'y' | 'z'): V3 {
  return vNorm(qRot(qMul(C_INV, baseQ), UNIT[axis]));
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
  /** the CAPTURED joint line: pivot clamped onto the panel bbox, axis per the
   *  kinematic-triad rule, slide along the panel's longest dimension */
  pivot0: V3; axis0: V3; slide0: V3;
}

export function captureJrefs(
  entries: SubMasterEntry[], bb: SubBBox | null, manifest: ModelManifest | null,
): JRef[] {
  const out: JRef[] = [];
  for (const e of entries) {
    const mc = e.mc;
    if (!mc) continue;
    const j0 = jointChain(mc, manifest);
    if (!j0) continue;                                 // static host: no joint term
    const p0: V3 = [mc.position.x, mc.position.y, mc.position.z];
    const q0 = fileToViewQuat(mc.orientation ?? { w: 1, x: 0, y: 0, z: 0 });
    if (!bb) {                                          // parts-only: ride the axle
      out.push({ mc, mcPath: e.mcPath, top: e.top, p0, q0, pivot0: j0.pivot, axis0: j0.axis, slide0: j0.slide });
      continue;
    }
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    const pivot0: V3 = [
      clamp(j0.pivot[0], bb.min[0], bb.max[0]),
      clamp(j0.pivot[1], bb.min[1], bb.max[1]),
      clamp(j0.pivot[2], bb.min[2], bb.max[2]),
    ];
    // panel axis rule (v0.175-177, empirical fit): span d = longest bbox dim;
    // EDGE-mounted hinge (content along its pin, |pin·d|≈1) swings ON THE PIN;
    // FACE-mounted hinge (|pin·d| small — the dolphin skin fins) swings on the
    // THIRD axis pin×span (mirror-antisymmetric cross ⇒ twins fold symmetric);
    // pivots/tracks keep the longest dimension.
    const sx = bb.max[0]! - bb.min[0]!, sy = bb.max[1]! - bb.min[1]!, sz = bb.max[2]! - bb.min[2]!;
    const k = sx >= sy && sx >= sz ? 0 : sy >= sz ? 1 : 2;
    const d: V3 = [k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0];
    const axis0 = mc.type === 'SmallHinge' && Math.abs(vDot(j0.axis, d)) < 0.7071
      ? vNorm(vCross(j0.axis, d))
      : d;
    out.push({ mc, mcPath: e.mcPath, top: e.top, p0, q0, pivot0, axis0, slide0: d });
  }
  return out;
}

// ------------------------------------------------------------- joint pose

export interface SubPose { p: V3; q: FileQuat }

/** Compose the subgrid group pose: identity base ∘ joint chain ∘ rigid ride.
 *  `states` = the live per-JRef data (master's data.angle in DEGREES /
 *  data.pos in metres + the master's CURRENT view-space pose — edits to the
 *  master's file pose flow through these and ride the whole subgrid in
 *  unison). Pure: mutates nothing. */
export function subJointPose(
  base: SubPose, jrefs: JRef[],
  states: { angle: number; slide: number; pos: V3; quat: FileQuat }[],
): SubPose {
  let p: V3 = [...base.p];
  let q: FileQuat = { ...base.q };
  jrefs.forEach((r, i) => {
    const st = states[i];
    if (!st) return;
    const a = st.angle * DEG, s = st.slide;
    if (a) {
      const R = qAxisAngle(r.axis0, a);
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
