// sym.ts pins: the MIRROR MASK classification (v0.166 — x/y/z symmetry all
// compose, on-plane axes are EQUAL, drift kills the pair), the 5 cm
// auto-disable window, and the MIRROR-TWIN MOTION quaternion rule
// (spin along a mirror normal PRESERVED, tangential FLIPPED — the red-axis
// wheel bug of v0.165 must stay dead).
import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { compPaintDiff, mirrorQuat, symAllowed, symMaskAt, symTwinIndex } from '../sym';
import type { Blueprint, BlueprintComponent, Vec3D } from '../format';
import { corpusDir } from '../../../tools/vite-corpus.ts';

const p = (x: number, y: number, z: number): Vec3D => ({ x, y, z });
const comp = (type: string, position: Vec3D): BlueprintComponent => ({
  type, position, orientation: { w: 1, x: 0, y: 0, z: 0 },
});

describe('mask classification', () => {
  test('x-mirror (the game’s left-right) = mask 1; y and z own bits', () => {
    expect(symMaskAt(p(1, 2, 3), p(-1, 2, 3), 0.011)).toBe(1);
    expect(symMaskAt(p(1, 2, 3), p(1, -2, 3), 0.011)).toBe(2);
    expect(symMaskAt(p(1, 2, 3), p(1, 2, -3), 0.011)).toBe(4);
  });
  test('two mirrored axes = twist, three = point symmetry', () => {
    expect(symMaskAt(p(1, 2, 3), p(-1, -2, 3), 0.011)).toBe(3);
    expect(symMaskAt(p(1, 2, 3), p(-1, -2, -3), 0.011)).toBe(7);
  });
  test('on-plane axes classify EQUAL (a centreline part is its own twin there)', () => {
    expect(symMaskAt(p(0, 2, 3), p(0, 2, -3), 0.011)).toBe(4);
    expect(symMaskAt(p(0, 0, 0), p(0, 0, 0), 0.011)).toBe(0);   // nothing mirrored at all
  });
  test('drift: neither equal nor mirrored ⇒ NO pair', () => {
    expect(symMaskAt(p(1, 2, 3), p(-1.1, 2, 3), 0.011)).toBe(0);
    expect(symMaskAt(p(1, 2, 3), p(-1, 2.2, 3), 0.011)).toBe(0);
  });
});

describe('pair index + auto-disable', () => {
  const comps = [comp('SmallWheel', p(3.125, 0, 1)), comp('SmallWheel', p(-3.125, 0, 1)),
                 comp('Lamp', p(3.125, 0, 1))];
  test('same-type pairs only, both directions', () => {
    const idx = symTwinIndex(comps);
    expect(idx.get(0)?.map(t => [t.j, t.mask])).toEqual([[1, 1]]);
    expect(idx.get(1)?.map(t => [t.j, t.mask])).toEqual([[0, 1]]);
    expect(idx.get(2)).toBeUndefined();            // the Lamp sits ON the plane: no mirror mate
  });
  test('propagation dies > 5 cm drift and revives on restore', () => {
    const idx = symTwinIndex(comps);
    expect(symAllowed(idx, true, comps, 0).length).toBe(1);
    comps[1]!.position.x -= 0.08;                  // drift the twin 8 cm
    expect(symAllowed(idx, true, comps, 0)).toEqual([]);
    comps[1]!.position.x += 0.08;
    expect(symAllowed(idx, true, comps, 0).length).toBe(1);
    expect(symAllowed(idx, false, comps, 0)).toEqual([]);   // the switch arg (the Engine now always passes true)
  });
});

describe('mirror-twin motion (md = det(S)·S·dq)', () => {
  const q = { w: 0.5, x: 0.5, y: 0.5, z: 0.5 };
  test('x-mirror pair: x spin PRESERVED, y/z FLIP — the red-axis wheel rule', () => {
    expect(mirrorQuat(q, 1)).toEqual({ w: 0.5, x: 0.5, y: -0.5, z: -0.5 });
  });
  test('y-mirror pair: y preserved, x/z flip', () => {
    expect(mirrorQuat(q, 2)).toEqual({ w: 0.5, x: -0.5, y: 0.5, z: -0.5 });
  });
  test('two axes compose to the R180 twist; point symmetry ⇒ plain delta', () => {
    expect(mirrorQuat(q, 3)).toEqual({ w: 0.5, x: -0.5, y: -0.5, z: 0.5 });
    expect(mirrorQuat(q, 7)).toEqual(q);
  });
});

describe.skipIf(!existsSync(corpusDir()))('corpus twins', () => {
  test('dolphin twin tail doors hinge on the SmallHinge pair at x=±1.125', () => {
    const bp = JSON.parse(readFileSync(`${corpusDir()}/3417786605/blueprint.json`, 'utf8')) as Blueprint;
    const idx = symTwinIndex(bp.data.components);
    const hinges = bp.data.components
      .map((c, i) => ({ c, i })).filter(({ c }) => c.type === 'SmallHinge');
    expect(hinges.length).toBeGreaterThanOrEqual(2);
    const pair = hinges.find(({ i }) => (idx.get(i) ?? []).some(t => t.mask & 1));
    expect(pair, 'an x-mirror SmallHinge pair exists').toBeTruthy();
  });

});

describe('v1.8.0 UNIFORM MIRROR RULE: compPaintDiff (faux-mirror paint screen)', () => {
  const spec = (r: number) => ({ r, g: 0, b: 0, opacity: 15, roughness: 0, metallic: 0 });
  test('both unpainted, or identical dicts/PAIRS → consistent', () => {
    expect(compPaintDiff(undefined, undefined)).toEqual([]);
    expect(compPaintDiff({ color1: spec(1) } as never, { color1: spec(1) } as never)).toEqual([]);
    expect(compPaintDiff([48, 52] as never, [48, 52] as never)).toEqual([]);
  });
  test('colour1 r differs → the label names colour1 only', () => {
    expect(compPaintDiff({ color1: spec(1), color2: spec(2) } as never,
      { color1: spec(5), color2: spec(2) } as never)).toEqual(['colour1 differs']);
  });
  test('v1 slot pairs differ → generic paint issue', () => {
    expect(compPaintDiff([48, 52] as never, [48, 53] as never)).toEqual(['paint differs']);
  });
  test('one side painted, the other not → paint issue', () => {
    expect(compPaintDiff({ color1: spec(1) } as never, undefined)).toEqual(['paint differs']);
  });
});
