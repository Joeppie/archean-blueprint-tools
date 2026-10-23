// tools.ts — the TOOLS menu's model layer (v1.7, pure — no THREE, no DOM).
// Three families live here:
//  • MATERIALS: the game's 0..6 build materials (Block/Triangle `material`,
//    FORMAT §blocks; game MaterialProperties.hh densities). Appearance is
//    NOT here — the palette slots carry it (glass/metal FINISHES are colours,
//    the material is what the block IS: mass, thermal, build cost).
//  • Custom RGB paints: the picker's "new palette slot" path (allocateSlot /
//    paletteSlotNode) and the "nearest existing colour" snap (nearestSlot).
//  • The batch tools: replaceAll (faces or materials) and hullify — replace
//    a craft's blocks by the hull TRIANGLES that ARE their own OUTSIDE
//    faces (v1.5.1 face-exact rule: every triangle takes the BLOCK SHAPE'S
//    own face corners; a border shared precisely and fully between two
//    adjacent blocks emits nothing — cull.ts's interior-wall coverage).
//
// All mutations keep bp as the live view; the CALLER mirrors into the doc
// (writeBlockDoc / writeBlockMaterial / docArray* + docFromValue — the
// established block/wire batch idiom) and reloads through Editor.sceneChanged.

import type { Blueprint, Block, Triangle } from './format';
import { CELL, CELLS_PER_FRAME } from './format';
import {
  blkCell, blkSpan, buildFaceGrid, cellM, cellQuad, faceCovered, faceFootprint,
  faceKey, forEachFaceCell,
} from './cull';
import {
  getBlockFaceDirections, getBlockFaces, getBlockPoints, isFullFace, OCCUPANCY_TYPE,
} from './blockshapes';
import { DEFAULT_PALETTE, resolveColor, type FilePalette, type ResolvedColor } from './palette';

// ---------------------------------------------------------------- MATERIALS

/** Index = the file's `material` value. Names per FORMAT §blocks
 *  (composite, concrete, steel, aluminium, glass, lead, titanium); the game
 *  table also carries a Frame variant stored as -1 — never in blueprints. */
export const MATERIALS = [
  'Composite', 'Concrete', 'Steel', 'Aluminium', 'Glass', 'Lead', 'Titanium',
] as const;

/** kg per 0.25 m CELL CUBE per material (game MaterialProperties.hh via
 *  FORMAT §Mass model) — the hullify mass estimate. Home of the table is
 *  engine/mass.ts (the mass model); re-exported for the tools/latsphere. */
export { MATERIAL_DENSITY } from './mass';
import { MATERIAL_DENSITY } from './mass';

export const MATERIAL_HINT =
  'Material = what the block IS in the game (mass, heat, build cost). The '
  + 'APPEARANCE (glass / metal / colour) comes from the PALETTE slots, not '
  + 'from here — repainting never changes the material.';

export const materialName = (m: number | undefined): string =>
  MATERIALS[m ?? 0] ?? `Material ${m}`;

// ------------------------------------------------------------ RGB helpers

export interface Rgb255 { r: number; g: number; b: number }

/** "#rrggbb" (case-insensitive, # optional) → 0..255 triple, null = malformed. */
export function parseHexColor(hex: string): Rgb255 | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export const hexColor = (c: Rgb255): string =>
  '#' + [c.r, c.g, c.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');

/** Distance between two LINEAR albedos (the raw 0..255 triples the engine
 *  feeds its shaders — the picker compares exactly what is DRAWN). */
const rgbDist = (a: Rgb255, b: Rgb255): number =>
  (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2;

/** Nearest OCCUPIED palette slot (file palette first, built-ins fill the
 *  gaps; empty/magenta-marker slots skipped). Engine-reserved slots 0..10
 *  ARE paintable (they just cannot be redefined), so they participate.
 *  v1.7.3: with a FINISH (`shade`), the search PREFERS slots carrying that
 *  shading family — "≈ nearest" means nearest with the SAME finish; only
 *  when no slot wears it does it fall back to the plain colour distance. */
export function nearestSlot(palette: FilePalette | null | undefined, c: Rgb255,
  shade?: PaintShade): number | null {
  const scan = (only: boolean): number => {
    let best = -1, bestD = Infinity;
    for (let s = 0; s < 256; s++) {
      const fileE = palette?.[s];
      const e = fileE ?? DEFAULT_PALETTE[s];
      if (!e || typeof e !== 'object') continue;
      if (only && !sameShade(e, shade!)) continue;
      const d = rgbDist(c, { r: e.r ?? 255, g: e.g ?? 255, b: e.b ?? 255 });
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  };
  const hit = shade ? scan(true) : scan(false);
  if (hit >= 0) return hit;
  if (!shade) return null;                    // unfiltered scan missed = no slots at all
  const fb = scan(false);                     // no slot wears that finish — plain nearest
  return fb < 0 ? null : fb;
}

/** The palette's free indices, engine-reserved 0..10 excluded: a slot is
 *  free when neither the file palette nor the built-in table owns it (it
 *  resolves to the magenta MISSING_SLOT marker). */
export function freePaletteSlots(palette: FilePalette | null | undefined): number[] {
  const free: number[] = [];
  for (let s = 11; s < 256; s++) {
    const c = resolveColor(palette ?? null, s, false);
    if (c.r === 255 && c.g === 0 && c.b === 255 && c.opacity === 15 && c.roughness === 4 && c.metallic === 0)
      free.push(s);
  }
  return free;
}

/** The next free slot, null when the palette is full. */
export function allocateSlot(palette: FilePalette | null | undefined): number | null {
  for (let s = 11; s < 256; s++) {
    const e = palette?.[s] ?? DEFAULT_PALETTE[s];
    if (!e || typeof e !== 'object') return s;
  }
  return null;
}

/** A palette slot's SHADING spec (the finish, not the hue): what the game's
 *  four finish families carry uniformly across their 17 colours. */
export interface PaintShade { opacity: number; roughness: number; metallic: number }

/** The four FINISHES, exactly the shading the game's palette families carry
 *  (palette.ts LEGACY_GROUPS: matte roughness 7, polished roughness 0,
 *  metal metallic 1, tinted glass opacity 2). The sphere tool's paint
 *  control writes a NEW slot — or snaps to a nearest slot — WITH this spec,
 *  so the picked finish is what the game's shaders see. */
export const PAINT_FINISHES: { id: string; label: string; spec: PaintShade }[] = [
  { id: 'matte', label: 'matte', spec: { opacity: 15, roughness: 7, metallic: 0 } },
  { id: 'polished', label: 'polished', spec: { opacity: 15, roughness: 0, metallic: 0 } },
  { id: 'metal', label: 'metal', spec: { opacity: 15, roughness: 0, metallic: 1 } },
  { id: 'glass', label: 'glass', spec: { opacity: 2, roughness: 0, metallic: 0 } },
];

export const paintFinish = (id: string | undefined): { id: string; label: string; spec: PaintShade } =>
  PAINT_FINISHES.find(f => f.id === id) ?? PAINT_FINISHES[0]!;

/** Same finish family? metallic + roughness exact, glassiness (opacity < 8,
 *  the FORMAT's "glass" line) as a class — the family rows vary opacity a
 *  little within the class, the FINISH is what must agree. */
const sameShade = (e: { opacity?: number; roughness?: number; metallic?: number }, s: PaintShade): boolean =>
  (e.metallic ?? 0) === s.metallic && (e.roughness ?? 0) === s.roughness
  && ((e.opacity ?? 15) < 8) === (s.opacity < 8);

/** A NEW custom-slot palette entry with the picked RGB and FINISH (default:
 *  opacity FULL and the old matte-ish 4/0 spec — the palette rows' sliders
 *  stay the fine-tune path). v1.7.3: paint tools pass the family spec. */
export function paletteSlotNode(c: Rgb255, shade?: PaintShade): ResolvedColor {
  return { r: c.r, g: c.g, b: c.b,
    opacity: shade?.opacity ?? 15, roughness: shade?.roughness ?? 4, metallic: shade?.metallic ?? 0 };
}

// ------------------------------------------------------------- REPLACE ALL

export type ReplaceTarget = 'colors' | 'material';

/** A source option in the picker dropdowns: a label + the predicate a block's
 *  face slot / material must satisfy + (family colour ops) an optional
 *  in-family mapping instead of a constant destination. */
export interface ReplaceSource {
  id: string;
  label: string;
  /** face-slot test (colors target) */
  slot?: (slot: number) => boolean;
  /** material test (material target) */
  material?: (m: number) => boolean;
  /** for colour families: map a source slot to its destination (same index
   *  within the destination family); absent ⇒ the tool's dest constant. */
  map?: (slot: number) => number;
}

const FAMILY_DEFS: [string, number, number][] = [
  ['matte', 40, 56], ['polished', 84, 100], ['metal', 128, 144], ['glass', 172, 188],
];

/** Family sources for the colour target: one family, or the two
 *  metallic-LOOKING families the user calls "metal" (engine chrome 5..10 +
 *  the metal family). DEST families are the four colour ones (mapTo). */
export function replaceSources(target: ReplaceTarget): ReplaceSource[] {
  if (target === 'material') {
    return MATERIALS.map((label, m) => ({ id: `m${m}`, label, material: (x: number) => x === m }));
  }
  const fam = (name: string, lo: number, hi: number, toLo: number, toHi: number): ReplaceSource => ({
    id: name,
    label: `${name} (${lo}..${hi})`,
    slot: (s) => s >= lo && s <= hi,
    map: toLo === lo ? undefined : (s) => toLo + (s - lo) % (toHi - toLo + 1),
  });
  const out: ReplaceSource[] = [
    { id: 'all', label: 'every colour' },
    ...FAMILY_DEFS.map(([n, lo, hi]) => fam(n, lo, hi, lo, hi)),
    {
      id: 'metallook', label: 'metal chrome (engine slots 5..10 + metal family)',
      slot: (s) => (s >= 5 && s <= 10) || (s >= 128 && s <= 144),
    },
  ];
  return out;
}

/** Destination options (colour target): the four families as a whole (the
 *  in-family index mapping keeps each colour's HUE, only the finish changes
 *  — "replace all metal by glass" makes steel-grey into glass-grey), plus
 *  every engine/built-in head colour as a constant. */
export function replaceColorDests(): { id: string; label: string; slot: (s: number) => number }[] {
  const out = FAMILY_DEFS.map(([n, , , ]) => ({
    id: n, label: `the ${n} family (keep each colour, change the finish)`, slot: (s: number) => s,
  }));
  out.push(
    { id: 'hull', label: 'slot 51 — hull chrome', slot: () => 51 },
    { id: 'white', label: 'slot 0 — white', slot: () => 0 },
    { id: 'clear', label: 'slot 4 — CLEAR GLASS', slot: () => 4 },
  );
  return out;
}

export interface ReplaceCensus {
  blocks: number;      // geometry blocks touched (type-255 mirrors excluded)
  faces: number;       // face slots rewritten (colors target) / 0
}

const isTargetBlock = (b: Block): boolean => b.type !== OCCUPANCY_TYPE;

/** face-slot census + colour replace read b.colors; `b.material` reads
 *  through the Triangle-style index signature (`unknown`), so reads go
 *  through this helper. */
export const blockMaterial = (b: Block): number => (b.material as number | undefined) ?? 0;

/** Preview a replace-all without touching anything. */
export function replaceCensus(bp: Blueprint, src: ReplaceSource, target: ReplaceTarget): ReplaceCensus {
  const res: ReplaceCensus = { blocks: 0, faces: 0 };
  for (const b of bp.data.blocks ?? []) {
    if (!isTargetBlock(b)) continue;
    if (target === 'material') {
      if (src.material?.(blockMaterial(b)) === true) res.blocks++;
      continue;
    }
    let hits = 0;
    for (const c of b.colors ?? [])
      if (typeof c === 'number' && (src.slot ? src.slot(c) : true)) hits++;
    if (hits) { res.blocks++; res.faces += hits; }
  }
  return res;
}

/** Mutate bp: every matching face slot / material becomes the destination.
 *  `destSlot` maps a MATCHED source slot to its new slot; `destMaterial` is
 *  the constant material. Returns the same census replaceCensus reports.
 *  Type-255 occupancy mirrors are NEVER touched (occupancies stay in sync). */
export function replaceAll(
  bp: Blueprint, src: ReplaceSource, target: ReplaceTarget,
  destSlot?: (s: number) => number, destMaterial?: number,
): ReplaceCensus {
  const res: ReplaceCensus = { blocks: 0, faces: 0 };
  for (const b of bp.data.blocks ?? []) {
    if (!isTargetBlock(b)) continue;
    if (target === 'material') {
      if (src.material?.(blockMaterial(b)) === true && destMaterial != null && b.material !== destMaterial) {
        b.material = destMaterial;
        res.blocks++;
      }
      continue;
    }
    const colors = b.colors;
    if (!colors) continue;
    let touched = false;
    for (let i = 0; i < colors.length; i++) {
      const c = colors[i];
      if (typeof c !== 'number') continue;
      if (!(src.slot ? src.slot(c) : true)) continue;
      let to: number;
      if (src.map) to = src.map(c);
      else if (destSlot) to = destSlot(c);
      else continue;
      to = Math.max(0, Math.min(255, Math.round(to)));
      if (to !== c) { colors[i] = to; res.faces++; touched = true; }
    }
    if (touched) res.blocks++;
  }
  return res;
}

// --------------------------------------------------------------- HULLIFY
// blocks ▸ hull triangles — FACE-EXACT (v1.5.1 rewrite; the old lattice-
// stitch pass butchered the ISW-241 wing: rasterising a slope profile's
// diagonal edge into grid cells + stitching maximal rectangles preserved
// the TOTAL AREA (its only guard) while shifting a third of the surface
// off the actual faces). THE RULE (user): a triangle's corners are the
// BLOCK SHAPE'S OWN face corners — a square block face is its two
// triangles, a wedge side is its one triangle. Nothing is merged or
// rasterised: coplanar neighbours each keep their own faces (the game
// draws stored triangles as closed 0.05 m prisms, so the internal seams
// are invisible). The ONLY culling is adjacency, with cull.ts's exact
// interior-wall rules:
//  • FULL faces cut cell-by-cell against cull's face grid — a cell whose
//    border is shared PRECISELY and FULLY with a neighbouring block's face
//    (opaque faces are culled by opaque entries only) emits nothing; a
//    fully free face emits its whole block-shape polygon; a partly
//    covered one emits the free cells' own quads (2 tris each).
//  • PARTIAL (slant/profile) faces die when a same-footprint face appears
//    twice — two blocks sharing that border precisely = an interior
//    partition (glued slope-to-slope), never a triangle (also cull's rule;
//    coincident footprints touch there by construction).
// Block sizes are ≤ 15 cells (corpus), so every raw face spans ≤ 16 cells
// and fits the game's per-axis 0..31 vertex window — encodeTri rejecting
// one is a `skipped` report, never a silent reshape.
// Triangles land on the cell-corner lattice: world = (g − 6)·CELL, stored
// split f = floorDiv(gmin, 12), v = g − 12f (FORMAT §Triangles).
// Existing triangles/struts are kept; type-255 occupancy mirrors STAY
// (component reservations, not geometry — the same rule as block delete);
// Build-subgrid blocks live in the nested blueprint lists and stay blocks
// (reported as `subBlocks`).

type G3 = [number, number, number];

const EMPTY_HULL: HullifyResult = {
  ok: false, blocksRemoved: 0, keptOcc: 0, trisAdded: 0, trisKept: 0, subBlocks: 0,
  massRemoved: 0, massAdded: 0, skipped: 0,
};

const triAreaCells = (g: G3[]): number => {
  const e1: G3 = [g[1]![0] - g[0]![0], g[1]![1] - g[0]![1], g[1]![2] - g[0]![2]];
  const e2: G3 = [g[2]![0] - g[0]![0], g[2]![1] - g[0]![1], g[2]![2] - g[0]![2]];
  const cr: G3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  return Math.sqrt(cr[0] * cr[0] + cr[1] * cr[1] + cr[2] * cr[2]) / 2;
};

export interface HullifyResult {
  ok: boolean;
  /** geometry blocks removed / occupancy mirrors kept */
  blocksRemoved: number;
  keptOcc: number;
  trisAdded: number;
  /** existing hull triangles preserved */
  trisKept: number;
  /** blocks inside Build subgrids (left as blocks — separate nested lists) */
  subBlocks: number;
  /** est. kg of the removed blocks vs the new triangles (mass model, FORMAT) */
  massRemoved: number;
  massAdded: number;
  /** faces the 0..31 vertex window could not store (never silently reshaped) */
  skipped: number;
  reason?: string;
}

/** Which way the generated triangles' winding faces (v1.5.7 user rule:
 *  "all triangles are precisely the wrong way around … but want to keep it
 *  as an option for their directionality"). 'inward' = the v1↔v2 swap of
 *  the face's authored winding; 'outward' = keep the block face's own
 *  winding (front = the RH cross points away from the solid), the v1.5.6
 *  behaviour, kept selectable. v1.5.9 EPISTEMIC NOTE: the winding is the
 *  GAME's front-side choice (Triangle.inc.glsl GetNormal = the winding
 *  cross); our viewer renders both directions identically (closed prism,
 *  one colour on all five faces), and the in-game BEVEL the v1.5.7 note
 *  attributed to the winding is the per-triangle FLAT-normal default —
 *  see HullifyShade below. Corpus census: game-AUTHORED triangles read
 *  OUTWARD under the centroid heuristic.
 *  v1.5.12 RE-ARBITRATION (user's in-game A/B, the sanctioned arbiter): the
 *  user's in-game-TRI-AUTHORED craft (Triangle_Trial = corpus fixture
 *  9000006001) carries three triangles the game's own tool snapped onto a
 *  corner block, and ALL THREE wind OUTWARD (winding normal away from the
 *  solid — pinned in tools.test.ts GAME-CONVENTION). The same user loaded
 *  our then-default (inward + smooth:1) conversion of that very craft
 *  ("corneronia") in game: "deformed and terrible", while the game's own
 *  triangles look right. The default is now 'outward' — exactly what the
 *  game's triangle authoring emits; 'inward' stays selectable. */
export type HullifyWind = 'inward' | 'outward';
export const HULLIFY_WIND_DEFAULT: HullifyWind = 'outward';

/** Surface-shading the generated triangles ask the GAME for (v1.5.9).
 *  The game's Triangle struct (Triangle.inc.glsl) carries a per-triangle
 *  `smooth` flag: "0 = flat/geometric normals (default), 1 = smooth
 *  normals". The in-game-authored gantry save 3732302108 sets smooth:1 on
 *  174 of its 241 hull triangles — its skin reads as one continuous sheet;
 *  a skin without the flag is flat-shaded per prism FACE, which is the
 *  beveled look the user sees in-game for EVERY converted hull (winding-
 *  independent — the v1.5.7 "inward fixes the bevel" reading is superseded:
 *  winding flips which side is front, not the shading). 'smooth' writes
 *  smooth:1 on every NEW triangle (existing kept verbatim); 'flat' writes
 *  no key (the pre-v1.5.9 files).
 *  v1.5.12 DEFAULT FLIP (user's in-game A/B): the game's own freshly
 *  authored triangles (fixture 9000006001, all three) carry NO smooth key
 *  — flat shading — and the user's verdict is that the game's flat-snap
 *  triangles look right while our smooth:1-converted hull reads "deformed"
 *  in game (the game adjusts/welds triangles where the smooth flag asks it
 *  to match neighbours; on a faceted block hull that bulges the prisms).
 *  The default is now 'flat' = what the game's own authoring emits; the
 *  smooth option stays for sheet-like hulls (3732302108's convention). */
export type HullifyShade = 'smooth' | 'flat';
export const HULLIFY_SHADE_DEFAULT: HullifyShade = 'flat';

export interface HullifyOptions { wind?: HullifyWind; shade?: HullifyShade }

/** Preview the conversion without touching bp. */
export function hullifyPreview(bp: Blueprint, opts: HullifyOptions = {}): HullifyResult {
  return hullifyCore(bp, false, opts.wind ?? HULLIFY_WIND_DEFAULT,
    opts.shade ?? HULLIFY_SHADE_DEFAULT);
}

/** Convert bp IN PLACE: remove every geometry block, append the covering
 *  hull triangles (existing triangles stay). Returns the report; ok=false
 *  (+reason) leaves bp untouched. */
export function hullifyApply(bp: Blueprint, opts: HullifyOptions = {}): HullifyResult {
  return hullifyCore(bp, true, opts.wind ?? HULLIFY_WIND_DEFAULT,
    opts.shade ?? HULLIFY_SHADE_DEFAULT);
}

function hullifyCore(bp: Blueprint, apply: boolean, wind: HullifyWind, shade: HullifyShade): HullifyResult {
  const blocks = bp.data.blocks ?? [];
  const geometry = blocks.filter(b => b.type !== OCCUPANCY_TYPE);
  if (!geometry.length) return { ...EMPTY_HULL, reason: 'the craft has no blocks to convert' };
  // Subgrid builds (doors/hatches) carry their blocks in the NESTED blueprint
  // lists, which this rewrite does not touch — the top-level hull still
  // converts cleanly (components and the composite_builds indices stay put),
  // so it is a WARNING in the preview, not a refusal.
  const subBlocks = (bp.data.components ?? []).reduce(
    (n, c) => n + (((c as unknown as { data?: { blocks?: unknown[] } }).data?.blocks)?.length ?? 0), 0);

  // the cull's transparency asymmetry needs the file's palette generation:
  // the APP always sees a NORMALIZED (palette-bearing) bp, raw v1 files
  // (tests, tools/) resolve slots through the legacy table.
  const palette = bp.data.colors ?? null;
  const legacy = palette == null;

  // world ▸ cell-corner lattice g (world = (g − 6)·CELL, exact multiples)
  const toG = (p: readonly [number, number, number]): G3 =>
    [Math.round(p[0] / CELL + 6), Math.round(p[1] / CELL + 6), Math.round(p[2] / CELL + 6)];
  const ptsOf = (b: Block): [number, number, number][] => {
    const c = blkCell(b), s = blkSpan(b);
    return getBlockPoints(b.type,
      [cellM(c[0]), cellM(c[1]), cellM(c[2])],
      [s[0] * CELL, s[1] * CELL, s[2] * CELL]);
  };

  // Interior-partition census over the PARTIAL faces (cull's rule): two
  // blocks presenting the SAME face footprint share that border precisely.
  const fpCount = new Map<string, number>();
  for (const b of blocks) {
    if (b.type === OCCUPANCY_TYPE) continue;
    const pts = ptsOf(b);
    const trisOf = getBlockFaces(b.type);
    const dirs = getBlockFaceDirections(b.type);
    for (let f = 0; f < trisOf.length; f++) {
      const dir = dirs[f];
      if (dir && isFullFace(b.type, f)) continue;
      const fp = faceFootprint(pts, trisOf[f]!);
      fpCount.set(fp, (fpCount.get(fp) ?? 0) + 1);
    }
  }

  const faces = buildFaceGrid(blocks, palette, legacy);
  const newTris: Triangle[] = [];
  let skipped = 0;

  blocks.forEach((b, index) => {
    if (b.type === OCCUPANCY_TYPE) return;
    const material = b.material ?? 0;
    const pts = ptsOf(b);
    const trisOf = getBlockFaces(b.type);
    const dirs = getBlockFaceDirections(b.type);
    for (let f = 0; f < trisOf.length; f++) {
      const slot = b.colors?.[f] ?? b.colors?.[0] ?? 0;
      const opaque = resolveColor(palette, slot, legacy).opacity >= 15;
      /** emit the block-shape face polygon (its own corners) as triangles,
       *  wound per the chosen direction (swap = the v1↔v2 reversal) */
      const emitPoly = (idx: readonly number[]): void => {
        const g = idx.map(i => toG(pts[i]!));
        for (let t = 0; t + 2 < g.length; t += 3) {
          const tri: [G3, G3, G3] = wind === 'outward'
            ? [g[t]!, g[t + 1]!, g[t + 2]!] : [g[t]!, g[t + 2]!, g[t + 1]!];
          const enc = encodeTri(tri, slot, material, shade === 'smooth');
          if (enc) newTris.push(enc); else skipped++;
        }
      };
      const dir = dirs[f];
      if (dir && isFullFace(b.type, f)) {
        // per-cell adjacency coverage (cull's exact rule): a face cell dies
        // when ANOTHER block presents a face cell on the same border
        // (opaque faces only against opaque entries — transparency asymmetry).
        const axis = dir[0] ? 0 : dir[1] ? 1 : 2;
        const min = blkCell(b), sz = blkSpan(b);
        const u = (axis + 1) % 3, v = (axis + 2) % 3;
        const cov = new Uint8Array(sz[u]! * sz[v]!);
        let covCount = 0;
        forEachFaceCell(b, dir, (cell) => {
          const entry = faces.get(faceKey(cell[0]!, cell[1]!, cell[2]!, axis));
          if (entry?.some(e => e.block !== index && (!opaque || e.opaque))) {
            cov[(cell[u]! - min[u]!) * sz[v]! + (cell[v]! - min[v]!)] = 1;
            covCount++;
          }
        });
        const total = sz[u]! * sz[v]!;
        if (covCount === total) continue;              // border shared fully ▸ nothing
        if (!covCount) { emitPoly(trisOf[f]!); continue; }   // the block's own face corners
        for (let i = 0; i < sz[u]!; i++)
          for (let j = 0; j < sz[v]!; j++) {
            if (cov[i * sz[v]! + j]) continue;
            const cell: G3 = [0, 0, 0];
            cell[axis] = dir[axis]! > 0 ? min[axis]! + sz[axis]! - 1 : min[axis]! - 1;
            cell[u] = min[u]! + i; cell[v] = min[v]! + j;
            const q = cellQuad(cell, axis, dir).map(p => toG(p)) as [G3, G3, G3, G3];
            for (const t of [[q[0]!, q[1]!, q[2]!], [q[2]!, q[3]!, q[0]!]] as [G3, G3, G3][]) {
              const tri: [G3, G3, G3] = wind === 'outward'
                ? t : [t[0]!, t[2]!, t[1]!];
              const enc = encodeTri(tri, slot, material, shade === 'smooth');
              if (enc) newTris.push(enc); else skipped++;
            }
          }
        continue;
      }
      if (faceCovered(faces, b, index, dir, opaque)) continue;   // interior wall
      if ((fpCount.get(faceFootprint(pts, trisOf[f]!)) ?? 0) > 1) continue; // glued pair
      emitPoly(trisOf[f]!);
    }
  });

  // mass estimate (FORMAT §Mass model)
  let massRemoved = 0;
  for (const b of geometry) {
    const rect = (b.size_x + 1) * (b.size_y + 1) * (b.size_z + 1);
    const dens = MATERIAL_DENSITY[b.material ?? 0] ?? 1;
    massRemoved += rect * dens * (b.type === 0 ? 1 : 0.5);
  }
  let massAdded = 0;
  for (const t of newTris) {
    const o = t as unknown as Record<string, number | number[]>;
    const gv = (k: string): number => o[k] as number;
    const g = [0, 1, 2].map(i => [
      gv(`v${i}_x`) + 12 * (t.frame_x ?? 0),
      gv(`v${i}_y`) + 12 * (t.frame_y ?? 0),
      gv(`v${i}_z`) + 12 * (t.frame_z ?? 0),
    ] as G3);
    const mat = (o['material'] as number | undefined) ?? 0;
    massAdded += triAreaCells(g) * CELL * CELL * 0.05 / (CELL ** 3)
      * (MATERIAL_DENSITY[mat] ?? 1);
  }

  const res: HullifyResult = {
    ok: true,
    blocksRemoved: geometry.length,
    keptOcc: blocks.length - geometry.length,
    trisAdded: newTris.length,
    trisKept: (bp.data.triangles ?? []).length,
    subBlocks,
    massRemoved, massAdded, skipped,
  };
  if (!apply || !newTris.length) return apply ? { ...res, ok: newTris.length > 0 } : res;

  // in-place bp rewrite: drop geometry blocks, append the triangles
  bp.data.blocks = blocks.filter(b => b.type === OCCUPANCY_TYPE);
  bp.data.triangles = [...(bp.data.triangles ?? []), ...newTris];
  return res;
}

/** Store a lattice tri: f = floorDiv(min, 12), v = g − 12f in the game's
 *  0..31 window (5-bit vertices, Triangle.inc.glsl). All five colour faces
 *  carry the block's palette slot (front/back/side walls = the same paint).
 *  null = a vertex outside the 0..31 window even after the frame shift
 *  (span > 31 cells — the game cannot store it). */
function encodeTri(g: [G3, G3, G3], slot: number, material: number, smooth: boolean): Triangle | null {
  // The game's Triangle struct (Triangle.inc.glsl) has a per-triangle
  // smooth flag (0 = flat/geometric normals = default, 1 = smooth normals);
  // its own hull saves carry "smooth":1 right after `material` — spelled the
  // same here (frame_*/v* keys are appended after, as before).
  const t = smooth
    ? { colors: [slot, slot, slot, slot, slot], material, smooth: 1 }
    : { colors: [slot, slot, slot, slot, slot], material };
  const o = t as unknown as Record<string, unknown> as Record<string, number>;
  const AX = [0, 1, 2] as const;
  for (const ax of AX) {
    const name = 'xyz'[ax]!;
    const min = Math.min(g[0]![ax], g[1]![ax], g[2]![ax]);
    const f = Math.floor(min / CELLS_PER_FRAME);
    o[`frame_${name}`] = f;
    for (const i of AX) {
      const v = g[i]![ax] - 12 * f;
      if (v < 0 || v > 31) return null;
      o[`v${i}_${name}`] = v;
    }
  }
  return t as unknown as Triangle;
}
