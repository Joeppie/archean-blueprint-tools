// Palette resolution pins (legacy (no-palette) files must resolve the built-in
// families WITHOUT a file palette — the "purple blocks" regression).
import { describe, expect, test } from 'vitest';
import { DEFAULT_PALETTE, type FilePalette, legacySlot, resolveColor, slotAlpha } from '../palette';

describe('built-in palette', () => {
  test('has 256 slots', () => expect(DEFAULT_PALETTE.length).toBe(256));
  test('v1 matte family resolves without a file palette', () => {
    expect(resolveColor(null, 48)).toMatchObject({ r: 1, g: 8, b: 1 });     // matte dark green
    expect(resolveColor(null, 53)).toMatchObject({ r: 16, g: 255, b: 255 }); // matte cyan
  });
  test('v1 family bases remap +4/+8/+12 (polished/metal/glass)', () => {
    expect(legacySlot(80)).toBe(84); expect(legacySlot(96)).toBe(100);
    expect(legacySlot(120)).toBe(128); expect(legacySlot(136)).toBe(144);
    expect(legacySlot(160)).toBe(172); expect(legacySlot(176)).toBe(188);
    expect(legacySlot(40)).toBe(40);   // matte never moved
    expect(legacySlot(11)).toBe(11);
  });
  test('legacy indices resolve real colours, not the magenta marker', () => {
    const polished = resolveColor(null, 80, true);
    expect(polished).toMatchObject({ r: 255, g: 255, b: 255, roughness: 0, metallic: 0 });
    const glass = resolveColor(null, 160, true);
    expect(glass).toMatchObject({ opacity: 0 });          // clear glass
    // v2-base glass slot 174 (grey, opacity 5) — and the SAME index legacy-
    // remapped to 186 lands on the family's orange head entry
    expect(resolveColor(null, 174)).toMatchObject({ opacity: 5, r: 128, g: 128, b: 128 });
    expect(resolveColor(null, 186)).toMatchObject({ opacity: 2, r: 255, g: 64, b: 16 });
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
  test('glass alpha: opacity<15 ⇒ (opacity+1)/16', () => {
    expect(slotAlpha(resolveColor(null, 4))).toBe(1 / 16);   // clear glass slot 4
    expect(slotAlpha(resolveColor(null, 1))).toBe(1);        // opaque
  });
});
