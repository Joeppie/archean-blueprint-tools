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

/** THE one raw quaternion law (v1.5.11, FORMAT §Handedness): the DISPLAY
 *  frame IS the FILE frame (v0.180 de-mirror) and the game places EVERY
 *  component — palette AND palette-less files alike — with the stored
 *  quaternion AS-IS, so this is the identity copy. Proof set: the game-built
 *  two-axis L/R dashboard craft (testdata/9000004001) meets its boards
 *  corner-to-corner flush ONLY under raw (the retired conjugate law speared
 *  [1] through the deck by 1.46 m); the two ISW-241 saves (2025 workshop +
 *  2026 palette re-save) keep BYTE-IDENTICAL orientations — no conversion
 *  ever happens across generations. The pre-v1.5.11 per-generation split
 *  (V2 conjugate / V1 raw) was a pre-v0.180 mirrored-chain artifact. */
export function toViewQuat(q: FileQuat): FileQuat { return { w: q.w, x: q.x, y: q.y, z: q.z }; }

export interface Block extends LatticeObj {
  type: number;
  material?: number;
  size_x: number; size_y: number; size_z: number;
  colors?: number[];
}

export interface Triangle {
  frame_x: number; frame_y: number; frame_z: number;
  colors?: number[];
  /** the game's per-triangle shading flag (Triangle.inc.glsl): absent/0 =
   *  flat geometric normals, 1 = smooth normals. In-game hull saves set it
   *  (3732302108: 174 of 241); hullify writes it per the SHADE option. */
  smooth?: number;
  /** v0_x … v2_z vertex lattice slots live here too (see hullfit). */
  [key: string]: unknown;
}

export interface BlueprintComponent {
  type: string;
  position: Vec3D;
  orientation: FileQuat;
  name?: string;
  /** player-authored floating label text (beats the INTERACT-type default) */
  alias?: string;
  colors?: Record<string, Partial<import('./palette').PaletteEntry>> | [number, number];
  data?: Record<string, unknown>;
  /** occupancy mirror records (array; first entry = footprint). Kept in sync
   *  with the type-255 entries in data.blocks on every save. */
  occupancies?: (LatticeObj & { size_x?: number; size_y?: number; size_z?: number })[];
  [key: string]: unknown;
}

/** One cable run: two component ports joined by axis-aligned segments. */
export interface PipeSegment {
  start: Vec3D;                       // FILE world space
  /** dir 0..5 = +x,+y,+z,−x,−y,−z */
  dir: number;
  length: number;
  // ---- per-segment style, serialized by the game (XenonViewer scene.js
  // buildPipes; FORMAT §pipes). r/g/b are LINEAR albedo like palette slots.
  /** colour 0..255 (blueprint.js default 128 when absent) */
  r?: number; g?: number; b?: number; a?: number;
  /** square cross-section (the item ducts); every other cable is a CYLINDER */
  box?: boolean;
  /** shiny pass: metalness + low roughness (fluid hoses ride `chrome`) */
  metal?: boolean; chrome?: boolean; glossy?: boolean;
  /** two-segment sag-chain cable (data/lv runs; segment[1] only marks the
   *  arrival point — its dir/length are meaningless, the game's own rule) */
  flexible?: boolean;
  rounded_caps?: boolean;
  striped?: boolean;
}

export interface Pipe {
  /** cable class: data | lowvoltage | highvoltage | fluid | item */
  type?: string;
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
  /** runtime-only GENERATION stamp (see isLegacyFile): true when the file AS
   *  ON DISK carried no palette. Lives on the live bp OBJECT only — never in
   *  the doc, so it can never reach a save. Since v1.5.11 it selects NO
   *  rotation law (there is only the raw one) — it keys the legacy palette
   *  resolution and the wheel-droop display gate. */
  __legacyQ?: boolean;
  [key: string]: unknown;
}

/**
 * v1 detection: the file AS ON DISK carried no `data.colors` (2024-25
 * corpus). That generation decides colour resolution (the built-in legacy
 * table (the built-in families + the v1.11.0 identity legacySlot seam) and
 * the wheel-droop display gate — nothing
 * else: since v1.5.11 BOTH generations place components with the raw stored
 * quaternion (see toViewQuat). normalize() embeds data.colors at open, so
 * the generation is stamped on the live bp (`__legacyQ`) by the Editor from
 * the file as read — re-deriving it from the converted object would make
 * every opened file read as v2. The stamp also cannot live in the doc: the
 * game round-trips every stored byte VERBATIM, so a runtime-only flag must
 * never reach a save (the orientation-rewrite bug class this mirrors:
 * ISW wheel-on-top, Jimmy's murals).
 */
export function isLegacyFile(bp: Blueprint): boolean {
  return bp.__legacyQ ?? bp.data.colors == null;
}

/**
 * Byte-identical saves. The game's writer distinguishes int-modelled fields
 * (written bare: "type":0, colors [3,3,…]) from double-modelled ones (written
 * float-style: "y":1.0, exponents two-digit: 1e-08) — a distinction plain JS
 * numbers CANNOT survive JSON.parse→stringify (the earlier regex approach
 * failed on 61/61 corpus files: it can tell values apart, not TYPES).
 * So the document keeps the ORIGINAL number literals: parseDoc
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
