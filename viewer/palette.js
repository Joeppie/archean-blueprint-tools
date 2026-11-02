// palette.js — the game's built-in 256-slot block palette + colour resolution.
// Transcribed from the game's BlockShapes.hh (same source the developer's
// XenonViewer generates its palette.js from — see NOTICE.md §2).
//
// Entry layout: {r,g,b, opacity 0..15, roughness 0..7, metallic 0|1}.
// The game's shaders use vec3(r,g,b)/255 DIRECTLY as linear albedo (no sRGB
// decode — only textures get ReverseGamma), so colours resolve to linear.
// Slots 0..10 are engine-reserved: the blueprint file cannot redefine them.

export const DEFAULT_PALETTE = [
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
// The built-in finish families. v1 blueprint files carry NO data.colors
// palette — block faces and v1 component colours ([slot,slot] index pairs)
// reference this built-in table directly (23 of our 24 testdata files are
// v1; without these groups every block resolves to the magenta missing-slot
// sentinel — user: "most of the blocks are purple").
// Four CONTIGUOUS 17-colour families (white, greys, 3×red, 3×green, 3×blue,
// yellow, cyan, orange, violet, magenta), one per finish, at bases
// 40 (matte), 80 (polished), 120 (metal), 160 (tinted glass); every other
// slot of the 256 is empty (null ⇒ the magenta marker when referenced).
// Bases transcribed verbatim from the dev's XenonViewer js/palette.js,
// fetched 2026-10-25 (generated from BlockShapes.hh; NOTICE.md §2 porting
// terms): its non-null ranges are exactly 0..10 + 40..56 + 80..96 +
// 120..136 + 160..176, and its resolvePaletteColor (js/blueprint.js:85)
// applies NO index remap at all. (This port once sat the families at
// 40/84/128/172 and paired that with a "+4/+8/+12 legacySlot" index remap
// (v1.5.11) — the composition resolved v1 files identically, but every
// PALETTE-CARRYING file reading built-in slots 84..96/128..144/172..188
// fell into the family shifted, and the v1.10.2 slot-12 diagnosis grew out
// of that table. v1.11.0 aligns the table to the dev's, remap retired.)
const FAMILY_ROWS = {
  40: [   // matte (the heavy-slot dashboard/mosaic crafts live here)
    [255,255,255,15,7,0],[16,16,16,15,7,0],[0,0,0,15,7,0],[96,16,16,15,7,0],
    [32,2,2,15,7,0],[12,1,1,15,7,0],[16,96,16,15,7,0],[2,16,2,15,7,0],
    [1,8,1,15,7,0],[16,16,96,15,7,0],[2,2,32,15,7,0],[1,1,12,15,7,0],
    [255,255,16,15,7,0],[16,255,255,15,7,0],[255,64,16,15,7,0],[64,16,255,15,7,0],
    [255,16,255,15,7,0]],
  80: [   // polished (v1 "Classic American Semi Truck" cab = slot 85,
          // the deep candy red [16,1,1])
    [255,255,255,15,0,0],[16,16,16,15,0,0],[0,0,0,15,0,0],[96,16,16,15,0,0],
    [48,4,4,15,0,0],[16,1,1,15,0,0],[16,96,16,15,0,0],[2,32,2,15,0,0],
    [1,8,1,15,0,0],[16,16,96,15,0,0],[4,4,48,15,0,0],[1,1,16,15,0,0],
    [255,255,16,15,0,0],[16,255,255,15,0,0],[255,64,16,15,0,0],[64,16,255,15,0,0],
    [255,16,255,15,0,0]],
  120: [  // metal
    [255,255,255,15,0,1],[64,64,64,15,0,1],[4,4,4,15,0,1],[96,32,32,15,0,1],
    [64,8,8,15,0,1],[16,1,1,15,0,1],[32,96,32,15,0,1],[2,32,2,15,0,1],
    [1,8,1,15,0,1],[32,32,96,15,0,1],[8,8,64,15,0,1],[1,1,16,15,0,1],
    [255,160,16,15,0,1],[16,255,255,15,0,1],[255,64,16,15,0,1],[64,16,255,15,0,1],
    [255,16,255,15,0,1]],
  160: [  // tinted glass (opacity 2 ⇒ alpha 3/16; entry 0 clear, entry 2 op 5)
    [255,255,255,0,0,0],[200,200,200,2,0,0],[128,128,128,5,0,0],[255,128,128,2,0,0],
    [255,16,16,2,0,0],[32,4,4,2,0,0],[128,255,128,2,0,0],[16,255,16,2,0,0],
    [4,32,4,2,0,0],[128,128,255,2,0,0],[16,16,255,2,0,0],[4,4,32,2,0,0],
    [255,255,16,2,0,0],[16,255,255,2,0,0],[255,64,16,2,0,0],[64,16,255,2,0,0],
    [255,16,255,2,0,0]],
};
for (const base in FAMILY_ROWS)
  FAMILY_ROWS[base].forEach((v, k) => DEFAULT_PALETTE[+base + k] =
    { r: v[0], g: v[1], b: v[2], opacity: v[3], roughness: v[4], metallic: v[5] });
for (let i = DEFAULT_PALETTE.length; i < 256; i++) DEFAULT_PALETTE.push(null);

/**
 * Resolve a palette slot to {r,g,b,opacity,roughness,metallic}.
 * Slots 0..10 always use the built-in entries (the game's reader re-imposes
 * them); file entries fall back to the built-in, and a magenta marker flags
 * a fully missing slot. The shape mirrors the dev's resolvePaletteColor
 * (XenonViewer js/blueprint.js:85-100) — one law, no index remap.
 * The legacy flag is a NO-OP for colour since v1.11.0 (see legacySlot).
 */
// v1.11.0: IDENTITY. The XenonViewer js/palette.js table (fetched 2026-10-25,
// generated from BlockShapes.hh) carries the families AT THE v1 BASES
// (polished 80..96, metal 120..136, glass 160..176) — there is only ONE
// built-in table generation and js/blueprint.js resolvePaletteColor applies
// no remap to any file. The old +4/+8/+12 shift (v1.5.11) existed to plug a
// transcription offset in THIS port's table (families at 84/128/172) and
// cancelled out for v1 files — while palette-carrying files reading built-in
// slots 84..96/128..144/172..188 rendered family-shifted colours. With the
// table aligned to the dev's, resolution needs no remap and the legacy flag
// keys ONLY the wheel-droop display gate (v1.5.11) from here on.
export function legacySlot(i) { return i; }
export function resolveColor(palette, index, legacy = false) {
  const i = (legacy ? legacySlot(index) : index) | 0;
  const c = (i <= 10 ? null : palette?.[i]) || DEFAULT_PALETTE[i] || palette?.[i];
  if (!c || typeof c !== 'object') return { r: 255, g: 0, b: 255, opacity: 15, roughness: 4, metallic: 0 };
  return {
    r: c.r ?? 255, g: c.g ?? 255, b: c.b ?? 255,
    opacity: c.opacity ?? 15, roughness: c.roughness ?? 0, metallic: c.metallic ?? 0,
  };
}
