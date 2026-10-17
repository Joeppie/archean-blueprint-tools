// format.ts — Archean blueprint.json core types + grid/colour maths.
// TS port of the format facts pinned in AGENTS.md / FORMAT.md (v0.178).
// Everything here is pure — no THREE, no DOM — which makes it the vitest
// layer of the rewrite (and the future WASM seam's data model).

/** 1 grid cell = 0.25 m. */
export const CELL = 0.25;
/** cells per frame: a frame unit is 3.0 m. */
export const CELLS_PER_FRAME = 12;
export const FRAME = CELLS_PER_FRAME * CELL;   // 3.0 m

export interface Vec3D { x: number; y: number; z: number }

/** Unity left-handed quaternion as stored in the file. */
export interface FileQuat { w: number; x: number; y: number; z: number }

/** A hull-lattice positioned object: pos_* ∈ 0..12, frame_* in 3 m units. */
export interface LatticeObj {
  pos_x: number; pos_y: number; pos_z: number;
  frame_x?: number; frame_y?: number; frame_z?: number;
}

/** world = (pos − 5.5)·CELL + frame·FRAME. −z is the nose (corpus craft). */
export function worldCoord(o: LatticeObj, ax: 'x' | 'y' | 'z'): number {
  return (o[`pos_${ax}`] - 5.5) * CELL + (o[`frame_${ax}`] ?? 0) * FRAME;
}

/** File (right-handed world) → viewer display space: z-mirrored position. */
export function toViewPos(p: Vec3D): Vec3D { return { x: p.x, y: p.y, z: -p.z }; }

/** File → view quaternion for palette-bearing (modern, v108+) files. */
export function toViewQuatModern(q: FileQuat): FileQuat { return { w: q.w, x: q.x, y: q.y, z: -q.z }; }

/** File → view quaternion for palette-less legacy files (RAW-R(q) convention). */
export function toViewQuatLegacy(q: FileQuat): FileQuat { return { w: q.w, x: -q.x, y: -q.y, z: q.z }; }

/** Inverse of toViewQuatModern: view → FILE quaternion (modern files). */
export const fromViewQuatModern = toViewQuatModern;   // involutive
/** Inverse of toViewQuatLegacy: view → FILE quaternion (legacy files). */
export const fromViewQuatLegacy = toViewQuatLegacy;   // involutive

/**
 * Unity LH → right-handed renderer: conjugate {w,−x,−y,−z} before mirroring.
 * (Verified against data.pipes endpoints: 0.000 m under R(q*).)
 */
export function unityConjugate(q: FileQuat): FileQuat { return { w: q.w, x: -q.x, y: -q.y, z: -q.z }; }

export interface Block extends LatticeObj {
  type: number;
  size_x: number; size_y: number; size_z: number;
  colors?: number[];
}

export interface Triangle {
  frame_x: number; frame_y: number; frame_z: number;
  colors?: number[];
  /** v0_x … v2_z vertex lattice slots live here too (see hullfit). */
  [key: string]: unknown;
}

export interface BlueprintComponent {
  type: string;
  position: Vec3D;
  orientation: FileQuat;
  name?: string;
  colors?: Record<string, Partial<import('./palette').PaletteEntry>> | [number, number];
  data?: Record<string, unknown>;
  occupancies?: LatticeObj & { size_x?: number; size_y?: number; size_z?: number };
  [key: string]: unknown;
}

/** One cable run: two component ports joined by axis-aligned segments. */
export interface PipeSegment {
  start: Vec3D;                       // FILE world space
  /** dir 0..5 = +x,+y,+z,−x,−y,−z */
  dir: number;
  length: number;
}

export interface Pipe {
  a_component: number;
  a_port: string;
  b_component: number;
  b_port: string;
  radius?: number;
  segments: PipeSegment[];
}

export interface BlueprintData {
  version: number;
  alias?: string;
  blocks: Block[];
  components: BlueprintComponent[];
  triangles?: Triangle[];
  pipes?: Pipe[];
  /** v2 palette (256 slots); v1 files carry NONE → built-in legacy palette. */
  colors?: import('./palette').FilePalette;
  composite_builds?: { component: number; slaveBuildId: number }[];
  [key: string]: unknown;
}

export interface Blueprint {
  version?: number;
  author?: string;
  box_min: Vec3D;
  box_max: Vec3D;
  data: BlueprintData;
  [key: string]: unknown;
}

/**
 * v1 detection: palette-less files (2024-25 corpus) resolve colours from the
 * built-in legacy table AND store rotations RAW (the LEGACY_Q split).
 */
export function isLegacyFile(bp: Blueprint): boolean {
  return bp.data.colors == null;
}

/**
 * Byte-identical saves. The game's writer distinguishes int-modelled fields
 * (written bare: "type":0, colors [3,3,…]) from double-modelled ones (written
 * float-style: "y":1.0, exponents two-digit: 1e-08) — a distinction plain JS
 * numbers CANNOT survive JSON.parse→stringify (the earlier regex approach
 * failed on 61/61 corpus files: it can tell values apart, not TYPES).
 * So the document keeps the ORIGINAL number literals: parseBlueprintDoc
 * stores each number's raw text; emit() reproduces it byte-for-byte, and an
 * EDITED number reuses the raw literal's style (has '.'/e ⇒ float form,
 * else bare int). The old viewer's Python-side rule
 * json.dumps(separators=(',',':'), ensure_ascii=False) is the same contract:
 * compact separators, key order preserved, unicode raw, int/float split kept.
 */
export function parseBlueprint(text: string): Blueprint {
  return JSON.parse(text) as Blueprint;
}

/** Integer cell coordinate of a lattice slot (mirror-index keys). */
export function cellCoord(o: LatticeObj, ax: 'x' | 'y' | 'z'): number {
  return Math.round(worldCoord(o, ax) / CELL);
}

/**
 * Per-frame integer grid key (PERF.md rule #8: never string keys).
 * base-8192 packing of signed cell coords, view space.
 */
export function cellKeyV(x: number, y: number, z: number): number {
  return ((x + 4096) * 8192 + (y + 4096)) * 8192 + (z + 4096);
}
