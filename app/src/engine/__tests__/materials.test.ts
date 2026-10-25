// materials.ts pins: the LINEAR-albedo rule, the metal/rough/alpha clamps,
// the v1 slot-PAIR component paints, the fixed-material LINEAR factors, and
// the single envMapIntensity rule (only metal reflects the studio env).
import { describe, expect, test } from 'vitest';
import {
  componentPaint, envIntensity, nodeMaterialSpec, pbr, pbrKey, srgbHexToLinear,
} from '../materials';

describe('pbr', () => {
  test('r/g/b are LINEAR albedo: 255→1, never sRGB-decoded', () => {
    const s = pbr({ r: 255, g: 128, b: 0, opacity: 15 });
    expect(s.color).toEqual([1, 128 / 255, 0]);
  });

  test('metal = metallic ? 1 − roughness/7 : 0 (painted metal stays diffuse)', () => {
    expect(pbr({ r: 0, g: 0, b: 0, metallic: 1, roughness: 0 }).metal).toBe(1);
    expect(pbr({ r: 0, g: 0, b: 0, metallic: 1, roughness: 7 }).metal).toBe(0);
    expect(pbr({ r: 0, g: 0, b: 0, metallic: 0, roughness: 0 }).metal).toBe(0);
  });

  test('roughness floor 0.03; glass alpha (op+1)/16', () => {
    expect(pbr({ r: 0, g: 0, b: 0, roughness: 0 }).rough).toBeCloseTo(0.03, 10);
    expect(pbr({ r: 0, g: 0, b: 0, opacity: 2 }).opacity).toBeCloseTo(3 / 16, 10);
    expect(pbr({ r: 0, g: 0, b: 0, opacity: 15 }).opacity).toBe(1);
  });

  test('envMapIntensity: 1 for EVERY surface (v1.11.0 sky-env parity)', () => {
    // XenonViewer's pbrMaterial (js/scene.js) never sets envMapIntensity —
    // its PMREM'd day-sky environment reads on all materials at intensity 1.
    expect(envIntensity(1)).toBe(1);
    expect(envIntensity(0.5)).toBe(1);
    expect(envIntensity(0)).toBe(1);
  });

  test('pbrKey merges equal specs and splits different metals', () => {
    const a = pbr({ r: 9, g: 9, b: 9, metallic: 1, roughness: 0 });
    const b = pbr({ r: 9, g: 9, b: 9, metallic: 1, roughness: 0 });
    const c = pbr({ r: 9, g: 9, b: 9, metallic: 0, roughness: 0 });
    expect(pbrKey(a)).toBe(pbrKey(b));
    expect(pbrKey(a)).not.toBe(pbrKey(c));
  });
});

describe('srgbHexToLinear', () => {
  test('matches THREE.Color(hex) semantics: mid-grey ≈ 0.2158, white stays 1', () => {
    expect(srgbHexToLinear(0xffffff)).toEqual([1, 1, 1]);
    expect(srgbHexToLinear(0x808080)[0]).toBeCloseTo(0.2158, 3);
    expect(srgbHexToLinear(0x0000ff)).toEqual([0, 0, 1]);
  });
});

describe('componentPaint', () => {
  test('v2 dict fills only the fields the file sets (defaults: polished white)', () => {
    const s = componentPaint({ color1: { r: 10 } }, 'color1', null, false);
    expect(s.color[0]).toBeCloseTo(10 / 255, 10);
    expect(s.color[1]).toBe(1);                       // g/b default 255
    expect(s.metal).toBe(0);                          // color1 default metallic 0
  });

  test('color2 default = matte grey METAL (204, roughness 7): metal collapses to 0', () => {
    const s = componentPaint(undefined, 'color2', null, false);
    expect(s.color[0]).toBeCloseTo(204 / 255, 10);
    expect(s.metal).toBe(0);                          // metallic 1, roughness 7 → 1−7/7
    expect(s.rough).toBe(1);
  });

  test('v1 array colours are [color1, color2] PALETTE SLOT pairs (identity law)', () => {
    // polished family row 0 = polished white (metallic 0, roughness 0):
    // the v1 index IS 80 — the built-in table carries the families at the
    // v1 bases (XenonViewer js/palette.js; the +4/+8/+12 remap retired)
    const s = componentPaint([40, 80], 'color2', null, true);
    expect(s.color[0]).toBeCloseTo(1, 10);
    expect(s.metal).toBe(0);
    expect(s.rough).toBeCloseTo(0.03, 10);
    const t = componentPaint([40, 120], 'color1', null, true);
    expect(t.color).toEqual([1, 1, 1]);
    expect(t.rough).toBe(1);                          // matte: roughness 7
    expect(t.metal).toBe(0);
  });

  test('fallback hex (sRGB) only for a fully unpainted named material', () => {
    const s = componentPaint(undefined, 'Material.003', null, false, 0x1a1a1a);
    expect(s.metal).toBe(0.5);
    expect(s.rough).toBeCloseTo(0.55, 10);
    expect(s.color[0]).toBeCloseTo(srgbHexToLinear(0x1a1a1a)[0]!, 10);
  });
});

describe('nodeMaterialSpec', () => {
  const comp = { type: 'Wheel', position: { x: 0, y: 0, z: 0 }, orientation: { w: 1, x: 0, y: 0, z: 0 } };

  test('fixed material uses its LINEAR baseColorFactor straight (tire 0.013 black)', () => {
    const s = nodeMaterialSpec(comp, 'tire', { tire: { color: [0.0134, 0.0134, 0.0134], metal: 0, rough: 0.5 } }, null, false);
    expect(s.color).toEqual([0.0134, 0.0134, 0.0134]);
    expect(s.rough).toBeCloseTo(0.5, 10);
    expect(s.metal).toBe(0);
  });

  test('BLEND glass keeps its alpha; missing table entry falls back to MAT_FIX', () => {
    const s = nodeMaterialSpec(comp, 'glass', undefined, null, false);
    expect(s.opacity).toBeCloseTo(0.4, 10);
    expect(s.color[1]).toBeCloseTo(0.84, 10);
  });

  test('painted color1/color2 route through the component paint', () => {
    const painted = { ...comp, colors: { color1: { r: 255, g: 0, b: 0 } } };
    const s = nodeMaterialSpec(painted, 'color1', { color1: { color: [0.8, 0.8, 0.8] } }, null, false);
    expect(s.color).toEqual([1, 0, 0]);               // paint BEATS the table
  });

  test('unknown material name → neutral stand-in (0x8d949e, half metal)', () => {
    const s = nodeMaterialSpec(comp, 'nonexistent', {}, null, false);
    expect(s.metal).toBe(0.5);
    expect(s.color[0]).toBeCloseTo(srgbHexToLinear(0x8d949e)[0]!, 10);
  });
});
