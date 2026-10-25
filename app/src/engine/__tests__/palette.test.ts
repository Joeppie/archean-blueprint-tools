// Palette resolution pins. The built-in table + the (now retired) index law
// are TRANSCRIBED from the dev's XenonViewer js/palette.js +
// js/blueprint.js resolvePaletteColor (fetched 2026-10-25, NOTICE §2):
// engine slots 0..10, then FOUR contiguous 17-colour families at bases
// 40 (matte), 80 (polished), 120 (metal), 160 (tinted glass); every slot
// beyond 176 is empty (magenta marker when referenced). The v1.5.11
// "+4/+8/+12 legacySlot" remap is retired (identity) — it plugged a
// transcription offset of THIS port's table (families at 84/128/172) and
// shifted every palette-carrying file's built-in reads. The slot values
// pinned below are the REAL paints of the corpus crafts they regressed on:
// 3481322297 "Classic American Semi Truck" (cab = polished 85) and
// 3326372833 "Chip's Badger" (file-palette custom slots).
import { describe, expect, test } from 'vitest';
import { DEFAULT_PALETTE, type FilePalette, legacySlot, resolveColor, slotAlpha } from '../palette';

describe('built-in palette (XenonViewer js/palette.js transcription)', () => {
  test('has 256 slots', () => expect(DEFAULT_PALETTE.length).toBe(256));
  test('families sit at bases 40/80/120/160 — no legacy index remap', () => {
    expect(legacySlot(80)).toBe(80); expect(legacySlot(96)).toBe(96);
    expect(legacySlot(120)).toBe(120); expect(legacySlot(136)).toBe(136);
    expect(legacySlot(160)).toBe(160); expect(legacySlot(176)).toBe(176);
    expect(legacySlot(40)).toBe(40);
    expect(legacySlot(11)).toBe(11);
  });
  test('matte family (base 40) resolves without a file palette', () => {
    expect(resolveColor(null, 48)).toMatchObject({ r: 1, g: 8, b: 1 });     // matte dark green
    expect(resolveColor(null, 53)).toMatchObject({ r: 16, g: 255, b: 255 }); // matte cyan
  });
  test('the truck cab: polished slot 85 = the deep candy red [16,1,1]', () => {
    // 3481322297: 246 block faces paint slot 85; the "doesn't render red
    // properly" report rendered it navy [16,16,96] through the shifted
    // family (85 → 89). Both generations must read the SAME [16,1,1].
    for (const legacy of [true, false])
      expect(resolveColor(null, 85, legacy)).toMatchObject({ r: 16, g: 1, b: 1, roughness: 0, metallic: 0 });
    expect(resolveColor(null, 80)).toMatchObject({ r: 255, g: 255, b: 255 }); // polished white head
    expect(resolveColor(null, 92)).toMatchObject({ r: 255, g: 255, b: 16 });  // polished yellow
  });
  test('metal family (base 120) — the truck chrome 121/122', () => {
    expect(resolveColor(null, 121)).toMatchObject({ r: 64, g: 64, b: 64, metallic: 1 });
    expect(resolveColor(null, 122)).toMatchObject({ r: 4, g: 4, b: 4, metallic: 1 });
    expect(resolveColor(null, 120)).toMatchObject({ r: 255, g: 255, b: 255, metallic: 1 });
  });
  test('glass family (base 160) — the truck windows slot 162', () => {
    expect(resolveColor(null, 160)).toMatchObject({ r: 255, g: 255, b: 255, opacity: 0 }); // clear
    expect(resolveColor(null, 162)).toMatchObject({ r: 128, g: 128, b: 128, opacity: 5 }); // grey glass
    expect(resolveColor(null, 176)).toMatchObject({ r: 255, g: 16, b: 255, opacity: 2 });  // family tail
  });
  test("beyond the families the built-in is EMPTY — dev's null gaps, not entries", () => {
    // v1.5.11-era table carried family TAILS into 97..100/137..144/177..188;
    // XenonViewer leaves them null → the magenta marker.
    for (const i of [97, 100, 137, 144, 177, 188, 200])
      expect(resolveColor(null, i)).toMatchObject({ r: 255, g: 0, b: 255 });
  });
  test('legacy flag is a no-op for colour (v1.11.0 identity remap)', () => {
    for (const i of [2, 3, 41, 48, 82, 85, 90, 92, 121, 122, 162])   // the truck census
      expect(resolveColor(null, i, true)).toEqual(resolveColor(null, i, false));
  });
  test('missing slot = magenta marker', () => {
    expect(resolveColor(null, 200)).toMatchObject({ r: 255, g: 0, b: 255 });
  });
  test('slots 0..10 are engine-reserved (file palette cannot redefine them)', () => {
    const file: FilePalette = Array.from({ length: 256 }, () => null);
    file[1] = { r: 1, g: 2, b: 3 };
    expect(resolveColor(file, 1)).toMatchObject({ r: 64, g: 64, b: 64 });
  });
  test('file slots win above 10, partial entries fill defaults', () => {
    const file: FilePalette = Array.from({ length: 256 }, () => null);
    file[42] = { r: 10 };
    expect(resolveColor(file, 42)).toEqual({ r: 10, g: 255, b: 255, opacity: 15, roughness: 0, metallic: 0 });
  });
  test("the Badger's file palette: custom slot 11 is its paint, cleared 12 is the marker", () => {
    // 3326372833 (Chip): the TOP palette defines 0..11 + 13 + 41 + 42, slot
    // 12 is `0` (CLEARED) and unreferenced at top level — the DOORS live in
    // nested Build data whose OWN palette defines slot 12 = deep red; the
    // pink-door bug was the engine resolving nested faces against the
    // top-level palette (fixed by per-build palette scoping in scene.ts).
    const file: FilePalette = Array.from({ length: 256 }, () => null);
    file[11] = { r: 32, g: 2, b: 2, opacity: 15, roughness: 7, metallic: 0 };
    expect(resolveColor(file, 11)).toMatchObject({ r: 32, g: 2, b: 2, roughness: 7 });
    expect(resolveColor(file, 12)).toMatchObject({ r: 255, g: 0, b: 255 });   // cleared, built-in 12 null
    const doorPal: FilePalette = Array.from({ length: 256 }, () => null);
    doorPal[12] = { r: 32, g: 2, b: 2, opacity: 15, roughness: 7, metallic: 0 };
    expect(resolveColor(doorPal, 12)).toMatchObject({ r: 32, g: 2, b: 2 });   // scoped palette → red doors
  });
  test('glass alpha: opacity<15 ⇒ (opacity+1)/16', () => {
    expect(slotAlpha(resolveColor(null, 4))).toBe(1 / 16);   // clear glass slot 4
    expect(slotAlpha(resolveColor(null, 1))).toBe(1);        // opaque
  });
});
