// palette.ts — the game's built-in 256-slot block palette + colour resolution.
// TS port of viewer/palette.js (v0.178). Source: the game's BlockShapes.hh via
// the developer's XenonViewer (NOTICE.md §2). GPL-3.0, see LICENSE/NOTICE.
//
// Entry layout: {r,g,b, opacity 0..15, roughness 0..7, metallic 0|1}.
// The game's shaders use vec3(r,g,b)/255 DIRECTLY as linear albedo (no sRGB
// decode — only textures get ReverseGamma), so colours resolve to linear.
// Slots 0..10 are engine-reserved: the blueprint file cannot redefine them.

export interface PaletteEntry {
  r: number; g: number; b: number;
  /** 0..15; <8 = glass; alpha = (opacity+1)/16 when < 15 */
  opacity: number;
  /** 0..7 */
  roughness: number;
  /** 0 | 1 */
  metallic: number;
}

/** A file palette: sparse array of 256 slots (holes/nulls allowed). */
export type FilePalette = (Partial<PaletteEntry> | null | undefined)[];

export const DEFAULT_PALETTE: (PaletteEntry | null)[] = [
  { r: 255, g: 255, b: 255, opacity: 15, roughness: 0, metallic: 0 },
  { r: 64, g: 64, b: 64, opacity: 15, roughness: 7, metallic: 0 },
  { r: 128, g: 140, b: 170, opacity: 15, roughness: 5, metallic: 1 },
  { r: 204, g: 204, b: 204, opacity: 15, roughness: 7, metallic: 1 },
  { r: 255, g: 255, b: 255, opacity: 0, roughness: 0, metallic: 0 },      // clear glass
  { r: 200, g: 200, b: 200, opacity: 15, roughness: 1, metallic: 1 },
  { r: 200, g: 180, b: 155, opacity: 15, roughness: 5, metallic: 1 },
  { r: 200, g: 80, b: 16, opacity: 15, roughness: 0, metallic: 1 },
  { r: 0, g: 0, b: 0, opacity: 15, roughness: 7, metallic: 0 },
  { r: 100, g: 24, b: 8, opacity: 15, roughness: 1, metallic: 1 },
  { r: 255, g: 255, b: 255, opacity: 15, roughness: 0, metallic: 1 },
];

// Legacy (v1-format) built-in colour groups. v1 blueprint files carry NO
// data.colors palette — block faces and v1 component colours ([slot,slot]
// index pairs) reference this built-in table directly. Four 17-colour
// families, one per finish: rows [r,g,b,opacity,roughness,metallic].
const LEGACY_GROUPS: Record<number, number[][]> = {
  40: [   // matte
    [255,255,255,15,7,0],[16,16,16,15,7,0],[0,0,0,15,7,0],[96,16,16,15,7,0],
    [32,2,2,15,7,0],[12,1,1,15,7,0],[16,96,16,15,7,0],[2,16,2,15,7,0],
    [1,8,1,15,7,0],[16,16,96,15,7,0],[2,2,32,15,7,0],[1,1,12,15,7,0],
    [255,255,16,15,7,0],[16,255,255,15,7,0],[255,64,16,15,7,0],[64,16,255,15,7,0],
    [255,16,255,15,7,0]],
  84: [   // polished
    [255,255,255,15,0,0],[16,16,16,15,0,0],[0,0,0,15,0,0],[96,16,16,15,0,0],
    [48,4,4,15,0,0],[16,1,1,15,0,0],[16,96,16,15,0,0],[2,32,2,15,0,0],
    [1,8,1,15,0,0],[16,16,96,15,0,0],[4,4,48,15,0,0],[1,1,16,15,0,0],
    [255,255,16,15,0,0],[16,255,255,15,0,0],[255,64,16,15,0,0],[64,16,255,15,0,0],
    [255,16,255,15,0,0]],
  128: [  // metal
    [255,255,255,15,0,1],[64,64,64,15,0,1],[4,4,4,15,0,1],[96,32,32,15,0,1],
    [64,8,8,15,0,1],[16,1,1,15,0,1],[32,96,32,15,0,1],[2,32,2,15,0,1],
    [1,8,1,15,0,1],[32,32,96,15,0,1],[8,8,64,15,0,1],[1,1,16,15,0,1],
    [255,160,16,15,0,1],[16,255,255,15,0,1],[255,64,16,15,0,1],[64,16,255,15,0,1],
    [255,16,255,15,0,1]],
  172: [  // tinted glass (opacity 2 ⇒ alpha 3/16; entry 0 clear, entry 2 op 5)
    [255,255,255,0,0,0],[200,200,200,2,0,0],[128,128,128,5,0,0],[255,128,128,2,0,0],
    [255,16,16,2,0,0],[32,4,4,2,0,0],[128,255,128,2,0,0],[16,255,16,2,0,0],
    [4,32,4,2,0,0],[128,128,255,2,0,0],[16,16,255,2,0,0],[4,4,32,2,0,0],
    [255,255,16,2,0,0],[16,255,255,2,0,0],[255,64,16,2,0,0],[64,16,255,2,0,0],
    [255,16,255,2,0,0]],
};
for (const base of Object.keys(LEGACY_GROUPS))
  LEGACY_GROUPS[+base].forEach((v, k) => {
    DEFAULT_PALETTE[+base + k] = { r: v[0]!, g: v[1]!, b: v[2]!, opacity: v[3]!, roughness: v[4]!, metallic: v[5]! };
  });
while (DEFAULT_PALETTE.length < 256) DEFAULT_PALETTE.push(null);

// v1 (2024-25, palette-less) blueprints index the finish families FOUR slots
// below the v2 (BlockShapes.hh) bases — v2 inserted 4 new head colours per
// family. v1 polished = 80..96, metal = 120..136, glass = 160..176; unmapped,
// those indices fall in the empty gaps below each family and render as the
// magenta missing-slot marker (the 'purple blocks on old crafts' report).
// Matte 40..56 is identical in both generations — it never went purple.
export function legacySlot(i: number): number {
  if (i >= 80 && i <= 96) return i + 4;      // -> polished 84..100
  if (i >= 120 && i <= 136) return i + 8;    // -> metal 128..144
  if (i >= 160 && i <= 176) return i + 12;   // -> glass 172..188
  return i;
}

/** Fully-resolved albedo slot (LINEAR r/g/b 0-255 + shading params). */
export interface ResolvedColor extends PaletteEntry {}

/** magenta marker flags a fully missing slot (an all-purple craft = missing built-in group) */
export const MISSING_SLOT: ResolvedColor =
  { r: 255, g: 0, b: 255, opacity: 15, roughness: 4, metallic: 0 };

/**
 * Resolve a palette slot. Slots 0..10 always use the built-in entries (the
 * game's reader re-imposes them); file entries fall back to the built-in.
 * legacy=true applies the v1 family-base remap (see legacySlot).
 */
export function resolveColor(palette: FilePalette | null | undefined, index: number, legacy = false): ResolvedColor {
  const i = (legacy ? legacySlot(index) : index) | 0;
  const c = (i <= 10 ? undefined : palette?.[i]) ?? DEFAULT_PALETTE[i];
  if (!c || typeof c !== 'object') return MISSING_SLOT;
  return {
    r: c.r ?? 255, g: c.g ?? 255, b: c.b ?? 255,
    opacity: c.opacity ?? 15, roughness: c.roughness ?? 0, metallic: c.metallic ?? 0,
  };
}

/** Is the resolved slot transparent? alpha = (opacity+1)/16 when opacity < 15. */
export function slotAlpha(c: ResolvedColor): number {
  return c.opacity >= 15 ? 1 : (c.opacity + 1) / 16;
}
