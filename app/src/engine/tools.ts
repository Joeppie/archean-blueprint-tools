// tools.ts — the TOOLS menu's model layer (v1.7, pure — no THREE, no DOM).
// Three families live here:
//  • MATERIALS: the game's 0..6 build materials (Block/Triangle `material`,
//    FORMAT §blocks; game MaterialProperties.hh densities). Appearance is
//    NOT here — the palette slots carry it (glass/metal FINISHES are colours,
//    the material is what the block IS: mass, thermal, build cost).
//  • Custom RGB paints: the picker's "new palette slot" path (allocateSlot /
//    paletteSlotNode) and the "nearest existing colour" snap (nearestSlot).
//  • The batch tools: replaceAll (faces or materials) and hullify — replace
//    a craft's blocks by the hull TRIANGLES that precisely cover their
//    OUTSIDE surface (the exact culled-cell coverage of cull.ts glued into
//    merged coplanar pieces: the block silhouette survives, the inner
//    borders die, each piece keeps its outside face's colour + material).
//
// All mutations keep bp as the live view; the CALLER mirrors into the doc
// (writeBlockDoc / writeBlockMaterial / docArray* + docFromValue — the
// established block/wire batch idiom) and reloads through Editor.sceneChanged.

import type { Blueprint, Block, Triangle } from './format';
import { CELL, CELLS_PER_FRAME } from './format';
import { culledBlocksSolids } from './cull';
import { OCCUPANCY_TYPE } from './blockshapes';
import { DEFAULT_PALETTE, resolveColor, type FilePalette, type ResolvedColor } from './palette';

// ---------------------------------------------------------------- MATERIALS

/** Index = the file's `material` value. Names per FORMAT §blocks
 *  (composite, concrete, steel, aluminium, glass, lead, titanium); the game
 *  table also carries a Frame variant stored as -1 — never in blueprints. */
export const MATERIALS = [
  'Composite', 'Concrete', 'Steel', 'Aluminium', 'Glass', 'Lead', 'Titanium',
] as const;

/** kg per 0.25 m CELL CUBE per material (game MaterialProperties.hh via
 *  FORMAT §Mass model) — the hullify mass estimate. */
export const MATERIAL_DENSITY = [0.25, 10, 1, 0.5, 1, 150, 0.6] as const;

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
 *  ARE paintable (they just cannot be redefined), so they participate. */
export function nearestSlot(palette: FilePalette | null | undefined, c: Rgb255): number | null {
  let best = -1, bestD = Infinity;
  for (let s = 0; s < 256; s++) {
    const fileE = palette?.[s];
    const e = fileE ?? DEFAULT_PALETTE[s];
    if (!e || typeof e !== 'object') continue;
    const d = rgbDist(c, { r: e.r ?? 255, g: e.g ?? 255, b: e.b ?? 255 });
    if (d < bestD) { bestD = d; best = s; }
  }
  return best < 0 ? null : best;
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

/** A NEW custom-slot palette entry with the picked RGB, opacity at its
 *  default FULL 15 and a matte-ish finish (the picker's shade sliders are
 *  the palette rows' job, not this one). */
export function paletteSlotNode(c: Rgb255): ResolvedColor {
  return { r: c.r, g: c.g, b: c.b, opacity: 15, roughness: 4, metallic: 0 };
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
// blocks ▸ hull triangles. THE BASIS: cull.ts already computes exactly the
// surface the game shows — full faces cut cell-by-cell against the
// face grid (interior walls die, translucent neighbours keep what they
// cover), partial faces dying under full coverage or as interior
// partitions. We take those surviving pieces IN CELL COORDINATES, regroup
// them by (plane, colour, material) and stitch coplanar neighbours from
// DIFFERENT blocks into merged rectangles: the outer silhouette survives
// exactly, the block borders inside the hull die. Each merged piece keeps
// the colour its outside faces carried (inside faces were culled away, so
// the consensus IS the outside colour) and its source block's material.
//
// The triangles land on the cell-CORNER lattice: world = (g − 6)·CELL, the
// stored split f = floorDiv(gmin, 12), v = g − 12f (the game's 0..31 window
// — corpus-verified, FORMAT §Triangles; a rectangle is SPLIT until every
// piece fits that 12-aligned window). Existing triangles/struts are kept;
// type-255 occupancy mirrors STAY (they are component reservations, not
// geometry — the same rule as block delete); Build-subgrid blocks live in the
// NESTED blueprint lists and stay blocks (reported as `subBlocks`).

type G3 = [number, number, number];
const gcd2 = (a: number, b: number): number => (b ? gcd2(b, a % b) : Math.abs(a));
const normKey = (n: G3): string => n.join(',');

/** Integer plane (n | c) of a non-degenerate tri, n canonical (first
 *  nonzero component positive, divided by gcd). */
function planeOf(g: G3[]): { n: G3; c: number } | null {
  const e1: G3 = [g[1]![0] - g[0]![0], g[1]![1] - g[0]![1], g[1]![2] - g[0]![2]];
  const e2: G3 = [g[2]![0] - g[0]![0], g[2]![1] - g[0]![1], g[2]![2] - g[0]![2]];
  const n: G3 = [
    e1[1] * e2[2] - e1[2] * e2[1],
    e1[2] * e2[0] - e1[0] * e2[2],
    e1[0] * e2[1] - e1[1] * e2[0],
  ];
  if (!n[0] && !n[1] && !n[2]) return null;
  const g0 = gcd2(gcd2(n[0], n[1]), n[2]);
  let [nx, ny, nz] = [n[0] / g0, n[1] / g0, n[2] / g0];
  if (nx < 0 || (nx === 0 && ny < 0) || (nx === 0 && ny === 0 && nz < 0)) { nx = -nx; ny = -ny; nz = -nz; }
  const nn: G3 = [nx, ny, nz];
  return { n: nn, c: nx * g[0]![0] + ny * g[0]![1] + nz * g[0]![2] };
}

/** The in-plane integer lattice basis (u, v) of a canonical normal — chosen
 *  ALIGNED with the block shapes' face edges (so every piece rasterises to
 *  whole grid cells; a generic unimodular search finds skewed bases whose
 *  cells cut the pieces apart — the first attempt's bug). Rules per normal
 *  FORM (all block shapes produce axis, 2-component diagonal and 3-component
 *  corner/pyramid slants), each pair with |u×v| = |n| = the plane lattice's
 *  fundamental area (so the basis spans the whole lattice, every lattice
 *  point has integer grid coordinates):
 *    • axis  n = e_k            ▸ u, v = the other two unit axes
 *    • 2-comp n (nonzero p < q)  ▸ u = (n_q at p, −n_p at q), v = e_third
 *      (the slope slant's own diagonal + its flat direction)
 *    • 3-comp n = (a,b,c)        ▸ u = (n_y, −n_x, 0), v = (0, n_z, −n_y)
 *      (the corner/pyramid slant triangle's two edge directions) */
function planeBasis(n: G3): { u: G3; v: G3; flip: boolean } | null {
  const nz = [n[0], n[1], n[2]].filter(x => x !== 0).length;
  let u: G3, v: G3;
  const AXES: G3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  if (nz === 1) {
    const k = n[0] !== 0 ? 0 : n[1] !== 0 ? 1 : 2;
    u = AXES[(k + 1) % 3]!; v = AXES[(k + 2) % 3]!;
  } else if (nz === 2) {
    const idx = [0, 1, 2].filter(a => n[a] !== 0) as [number, number];
    const r = [0, 1, 2].find(a => n[a] === 0)!;
    u = [0, 0, 0] as G3; u[idx[0]] = n[idx[1]]!; u[idx[1]] = -n[idx[0]]!;
    v = AXES[r]!;
  } else if (nz === 3) {
    u = [n[1], -n[0], 0]; v = [0, n[2], -n[1]];
  } else return null;
  const cr: G3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const n2 = n[0] * n[0] + n[1] * n[1] + n[2] * n[2];
  const cross2 = cr[0] * cr[0] + cr[1] * cr[1] + cr[2] * cr[2];
  if (cross2 !== n2) return null;                    // not the fundamental area
  const k = (cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2]) / n2;
  if (k !== 1 && k !== -1) return null;
  return { u, v, flip: k < 0 };                      // u×v = ±n
}

interface HullPiece { g: [G3, G3, G3]; slot: number; material: number }

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
  /** triangles per axis-span > 31 cells (never emitted; the game's 5-bit
   *  lattice window cannot store them) */
  skipped: number;
  reason?: string;
}

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

/** Preview the conversion without touching bp. */
export function hullifyPreview(bp: Blueprint): HullifyResult {
  return hullifyCore(bp, false);
}

/** Convert bp IN PLACE: remove every geometry block, append the covering
 *  hull triangles (existing triangles stay). Returns the report; ok=false
 *  (+reason) leaves bp untouched. */
export function hullifyApply(bp: Blueprint): HullifyResult {
  return hullifyCore(bp, true);
}

function hullifyCore(bp: Blueprint, apply: boolean): HullifyResult {
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
  // Re-derive the SURVIVING surface in cell-corner lattice coordinates.
  // cull's world space is (g − 6)·CELL exactly, so g = round(p/CELL + 6).
  const culled = culledBlocksSolids(blocks, palette, legacy);
  const materialOf = (src: number | undefined): number =>
    src == null ? 0 : blocks[src]?.material ?? 0;

  const pieces: HullPiece[] = [];
  for (const t of culled.tris) {
    const g = t.tri.map(p => [
      Math.round(p[0] / CELL + 6), Math.round(p[1] / CELL + 6), Math.round(p[2] / CELL + 6),
    ] as G3) as [G3, G3, G3];
    pieces.push({ g, slot: t.slot, material: materialOf(t.src) });
  }

  // Regroup by (plane, colour, material); stitch coplanar pieces into
  // rectangles on the plane's integer lattice, re-wound to the canonical n.
  const groups = new Map<string, HullPiece[]>();
  const planeInfo = new Map<string, { n: G3; c: number }>();
  for (const p of pieces) {
    const pl = planeOf(p.g);
    if (!pl) continue;
    const key = `${normKey(pl.n)}|${pl.c}|${p.slot}|${p.material}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(p);
    planeInfo.set(key, pl);
  }

  const newTris: Triangle[] = [];
  let skipped = 0;
  for (const [key, list] of groups) {
    const pl = planeInfo.get(key)!;
    const basis = planeBasis(pl.n);
    const p0 = basis ? planeOrigin(pl.n, pl.c) : null;
    const slot = list[0]!.slot, material = list[0]!.material;
    const emitPiecesRaw = (): void => {
      for (const p of list) {
        const enc = encodeTri(p.g, p.slot, p.material);
        if (enc) newTris.push(enc); else skipped++;
      }
    };
    if (!basis || !p0) { emitPiecesRaw(); continue; }
    const { u: bu, v: bv, flip: bFlip } = basis;
    const origin = p0;
    // rasterise the pieces onto the plane's (i,j) lattice and stitch merged
    // rectangles — this is where different blocks' faces GLUE together.
    const cells = new Map<string, true>();
    let uvOk = true;
    for (const p of list) {
      const uv = p.g.map(g => triUV(g, p0, basis.u, basis.v));
      if (uv.some(x => !x)) { uvOk = false; break; }
      rasterTri(cells, uv[0]!, uv[1]!, uv[2]!);
    }
    // CONSISTENCY GUARD: each grid cell carries area |n| (lattice units), so
    // the marked cells must cover exactly the pieces' area. A face whose
    // edges do not align with the chosen basis would mark a partial/extra
    // cell — then the group is emitted piece-by-piece instead of merged
    // (still exact, just less glued).
    const nLen = Math.sqrt(pl.n[0] ** 2 + pl.n[1] ** 2 + pl.n[2] ** 2);
    const pieceArea = list.reduce((s, p) => s + triAreaCells(p.g), 0);
    if (!uvOk || Math.abs(cells.size * nLen - pieceArea) > 1e-6) { emitPiecesRaw(); continue; }
    for (const r of stitchRects(cells)) emitRect(r);

    /** One merged grid rectangle ▸ two triangles, SPLIT until every piece
     *  fits the game's per-axis 0..31 vertex window (a giant's 40-cell deck
     *  is a strip of prisms, never one un-storable triangle). */
    function emitRect(r: { i: number; j: number; w: number; h: number }): void {
      const cornersOf = (rr: typeof r) => {
        const c = [
          gridPoint(rr.i, rr.j, origin, bu, bv),
          gridPoint(rr.i + rr.w, rr.j, origin, bu, bv),
          gridPoint(rr.i + rr.w, rr.j + rr.h, origin, bu, bv),
          gridPoint(rr.i, rr.j + rr.h, origin, bu, bv),
        ] as [G3, G3, G3, G3];
        return bFlip ? [c[3]!, c[2]!, c[1]!, c[0]!] : c;
      };
      const c = cornersOf(r);
      // the game stores v = g − 12·frame in 5 BITS (0..31): a piece fits iff
      // SOME 12-aligned window [12f, 12f+31] contains every vertex coordinate
      // per axis — a 26-cell span straddling a boundary has NO such f.
      const fits = ([0, 1, 2] as const).every(ax => {
        const lo = Math.min(c[0]![ax], c[1]![ax], c[2]![ax], c[3]![ax]);
        const hi = Math.max(c[0]![ax], c[1]![ax], c[2]![ax], c[3]![ax]);
        return Math.floor(lo / CELLS_PER_FRAME) >= Math.ceil((hi - 31) / CELLS_PER_FRAME);
      });
      if (!fits) {
        if (r.w >= r.h && r.w >= 2) {
          const a = Math.ceil(r.w / 2);
          emitRect({ ...r, w: a }); emitRect({ ...r, i: r.i + a, w: r.w - a });
        } else if (r.h >= 2) {
          const a = Math.ceil(r.h / 2);
          emitRect({ ...r, h: a }); emitRect({ ...r, j: r.j + a, h: r.h - a });
        } else { skipped++; }
        return;
      }
      for (const t of [[c[0]!, c[1]!, c[2]!], [c[2]!, c[3]!, c[0]!]] as [G3, G3, G3][]) {
        if (!windOk(t, pl.n)) { skipped++; continue; }
        const enc = encodeTri(t, slot, material);
        if (enc) newTris.push(enc); else skipped++;
      }
    }
  }

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

/** A lattice point p0 with n·p0 = c — the plane's grid origin. The plane's
 *  lattice points are EXACTLY p0 + span_Z(u, v) when n is primitive and
 *  |u×v| = |n|; an offset plane (x+z = 29 under n=(1,0,1)) contains NO
 *  multiple of n, so the origin must be solved, not assumed. Each axis pair
 *  runs the extended gcd, the third axis stays 0. */
function planeOrigin(n: G3, c: number): G3 | null {
  const pairs: [number, number][] = [[0, 1], [0, 2], [1, 2]];
  for (const [a, b] of pairs) {
    const eg = extGcd(n[a]!, n[b]!);
    if (!eg) continue;
    const [g, xa, xb] = eg;
    if (g <= 0 || c % g !== 0) continue;
    const p: G3 = [0, 0, 0];
    p[a] = xa * (c / g);
    p[b] = xb * (c / g);
    if (n[0] * p[0] + n[1] * p[1] + n[2] * p[2] === c) return p;
  }
  return null;
}

/** extended gcd: [g, x, y] with a·x + b·y = g > 0. */
function extGcd(a: number, b: number): [number, number, number] | null {
  if (a === 0 && b === 0) return null;
  let [oldR, r] = [Math.abs(a), Math.abs(b)];
  let [oldS, s] = [1, 0];
  let [oldT, t] = [0, 1];
  while (r !== 0) {
    const q = Math.floor(oldR / r);
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
    [oldT, t] = [t, oldT - q * t];
  }
  return [oldR, oldS * (a < 0 ? -1 : 1), oldT * (b < 0 ? -1 : 1)];
}

/** (i, j) grid cell ▸ lattice point: p0 + i·u + j·v (integral by design). */
function gridPoint(i: number, j: number, p0: G3, u: G3, v: G3): G3 {
  return [
    p0[0] + i * u[0] + j * v[0],
    p0[1] + i * u[1] + j * v[1],
    p0[2] + i * u[2] + j * v[2],
  ];
}

/** (i, j) of a lattice point on the plane: solve d = g − p0 = i·u + j·v.
 *  u, v, d are all ⊥ n, so any non-degenerate axis pair of the 2×2 system
 *  solves it — try all three, verify the round trip exactly. */
function triUV(g: G3, p0: G3, u: G3, v: G3): [number, number] | null {
  const d: G3 = [g[0] - p0[0], g[1] - p0[1], g[2] - p0[2]];
  const pairs: [number, number][] = [[0, 1], [0, 2], [1, 2]];
  for (const [a, b] of pairs) {
    const det = u[a]! * v[b]! - u[b]! * v[a]!;
    if (!det) continue;
    const i = (d[a]! * v[b]! - d[b]! * v[a]!) / det;
    const j = (u[a]! * d[b]! - u[b]! * d[a]!) / det;
    if (Math.abs(i - Math.round(i)) > 1e-6 || Math.abs(j - Math.round(j)) > 1e-6) continue;
    const g2 = gridPoint(Math.round(i), Math.round(j), p0, u, v);
    if (g2[0] === g[0] && g2[1] === g[1] && g2[2] === g[2]) return [Math.round(i), Math.round(j)];
  }
  return null;
}

/** Mark the unit grid cells inside lattice triangle (a,b,c) (half-open). */
function rasterTri(cells: Map<string, true>, a: [number, number], b: [number, number], c: [number, number]): void {
  const key = (i: number, j: number) => `${i},${j}`;
  const inTri = (x: number, y: number): boolean => {
    const s = (p: [number, number], q: [number, number]) =>
      (x - p[0]) * (q[1] - p[1]) - (y - p[1]) * (q[0] - p[0]);
    const d1 = s(a, b), d2 = s(b, c), d3 = s(c, a);
    const neg = (d1 < 0 || d2 < 0 || d3 < 0), pos = (d1 > 0 || d2 > 0 || d3 > 0);
    if (neg && pos) return false;
    // half-open on the top/left edges so adjacent tris do not double-count
    return !(d1 === 0 && (b[0] - a[0]) * (x - a[0]) + (b[1] - a[1]) * (y - a[1]) < 0)
      && !(d2 === 0 && (c[0] - b[0]) * (x - b[0]) + (c[1] - b[1]) * (y - b[1]) < 0);
  };
  const i0 = Math.floor(Math.min(a[0], b[0], c[0])), i1 = Math.ceil(Math.max(a[0], b[0], c[0]));
  const j0 = Math.floor(Math.min(a[1], b[1], c[1])), j1 = Math.ceil(Math.max(a[1], b[1], c[1]));
  for (let i = i0; i < i1; i++)
    for (let j = j0; j < j1; j++)
      if (inTri(i + 0.5, j + 0.5)) cells.set(key(i, j), true);
}

/** Greedy maximal-rectangle cover of a sparse cell set (cull.ts's stitch). */
function stitchRects(cells: Map<string, true>): { i: number; j: number; w: number; h: number }[] {
  if (!cells.size) return [];
  let iMin = Infinity, jMin = Infinity, iMax = -Infinity, jMax = -Infinity;
  for (const k of cells.keys()) {
    const [i, j] = k.split(',').map(Number) as [number, number];
    iMin = Math.min(iMin, i); jMin = Math.min(jMin, j);
    iMax = Math.max(iMax, i); jMax = Math.max(jMax, j);
  }
  const W = iMax - iMin + 1, H = jMax - jMin + 1;
  const free = new Uint8Array(W * H);
  for (const k of cells.keys()) {
    const [i, j] = k.split(',').map(Number) as [number, number];
    free[(i - iMin) * H + (j - jMin)] = 1;
  }
  const out: { i: number; j: number; w: number; h: number }[] = [];
  for (let i = 0; i < W; i++)
    for (let j = 0; j < H; j++) {
      if (!free[i * H + j]) continue;
      let h = 1; while (j + h < H && free[i * H + j + h] === 1) h++;
      let w = 1;
      grow: while (i + w < W) { for (let k = 0; k < h; k++) if (free[(i + w) * H + j + k] !== 1) break grow; w++; }
      out.push({ i: iMin + i, j: jMin + j, w, h });
      for (let di = 0; di < w; di++) for (let dj = 0; dj < h; dj++) free[(i + di) * H + j + dj] = 0;
    }
  return out;
}

/** Does the tri wind along the canonical normal (cross · n > 0)? */
function windOk(t: [G3, G3, G3], n: G3): boolean {
  const e1: G3 = [t[1]![0] - t[0]![0], t[1]![1] - t[0]![1], t[1]![2] - t[0]![2]];
  const e2: G3 = [t[2]![0] - t[0]![0], t[2]![1] - t[0]![1], t[2]![2] - t[0]![2]];
  const cr: G3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  return cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] > 0;
}

/** Store a lattice tri: f = floorDiv(min, 12), v = g − 12f in the game's
 *  0..31 window (5-bit vertices, Triangle.inc.glsl). All five colour faces
 *  carry the block's palette slot (front/back/side walls = the same paint).
 *  null = a vertex outside the 0..31 window even after the frame shift
 *  (span > 31 cells — the game cannot store it). */
function encodeTri(g: [G3, G3, G3], slot: number, material: number): Triangle | null {
  const t = { colors: [slot, slot, slot, slot, slot], material } as unknown as Record<string, unknown> as Triangle;
  const o = t as unknown as Record<string, number>;
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
  return t;
}
