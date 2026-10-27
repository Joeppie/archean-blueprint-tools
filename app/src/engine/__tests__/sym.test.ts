// sym.ts pins: the MIRROR MASK classification (v0.166 — x/y/z symmetry all
// compose, on-plane axes are EQUAL, drift kills the pair), the 5 cm
// auto-disable window, and the MIRROR-TWIN MOTION quaternion rule
// (spin along a mirror normal PRESERVED, tangential FLIPPED — the red-axis
// wheel bug of v0.165 must stay dead).
import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { compPaintDiff, craftMirrorMask, mirrorQuat, symAllowed, symMaskAt, symTwinIndex } from '../sym';
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
  test('v1.12.2 fuzz: the inlined per-type scan ≡ the symMaskAt reference (30 seeds)', () => {
    // the rewrite (BOOT COST: allocation-free Float64 loop) must reproduce
    // the reference scan EXACTLY — per direction, mask and push ORDER — on
    // adversarial positions: exact mirrors, sub-eps jitter, on-plane coords,
    // drift, eps-boundary values, shared positions, same-type crowds.
    const naive = (comps: BlueprintComponent[]) => {
      const out = new Map<number, { j: number; mask: number }[]>();
      const byType = new Map<string, number[]>();
      comps.forEach((c, i) => {
        const l = byType.get(c.type); if (l) l.push(i); else byType.set(c.type, [i]);
      });
      for (const idxs of byType.values())
        for (const i of idxs)
          for (const j of idxs)
            if (j !== i) {
              const m = symMaskAt(comps[i]!.position, comps[j]!.position, 0.011);
              if (m) {
                const l = out.get(i);
                if (l) l.push({ j, mask: m }); else out.set(i, [{ j, mask: m }]);
              }
            }
      return out;
    };
    for (let seed = 1; seed <= 30; seed++) {
      let t = seed * 2654435761 >>> 0;
      const rnd = () => ((t = (t * 1664525 + 1013904223) >>> 0) / 4294967296);
      const types = ['SmallWheel', 'Lamp', 'Aileron', 'Build'];
      const kinds = [0, 1, 2, 3, 4, 5, 6, 7];
      const comps: BlueprintComponent[] = [];
      const n = 3 + Math.floor(rnd() * 25);
      for (let i = 0; i < n; i++) {
        const k = kinds[Math.floor(rnd() * 8)]!;
        const q = (v: number) => Math.round(v / 0.25) * 0.25;
        const x = q((rnd() - 0.5) * 8), y = q((rnd() - 0.5) * 4), z = q((rnd() - 0.5) * 8);
        const jz = (v: number) => v + (rnd() - 0.5) * (k >= 4 ? 0.021 : 0.001); // jitter around eps
        const pos: Vec3D =
          k === 0 ? p(x, y, z) :                    // plain lattice
          k === 1 ? p(-x + 0, y, z) :               // x-mirror twin
          k === 2 ? p(x, -y, z) :                   // y-mirror twin
          k === 3 ? p(-x, -y, -z) :                 // point twin
          k === 4 ? p(jz(-x), y, z) :               // eps-boundary x mirror
          k === 5 ? p(0, y, z) :                    // on-plane
          k === 6 ? p(x + 0.05, y, z) :             // drifted twin
          p(0, 0, 0);                               // shared centre
        comps.push(comp(types[Math.floor(rnd() * 4)]!, pos));
      }
      expect(symTwinIndex(comps)).toEqual(naive(comps));
    }
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

describe('v1.5.21 craftMirrorMask (settable mirror axis)', () => {
  const comp2 = (type: string, position: Vec3D, mirrorAxis?: number): BlueprintComponent =>
    ({ type, position, orientation: { w: 1, x: 0, y: 0, z: 0 }, ...(mirrorAxis ? { mirrorAxis } : {}) } as BlueprintComponent);
  test('geometric pairs feed the mask (y-pair ⇒ bit 2, NOT x)', () => {
    const comps = [comp2('SmallWheel', p(0, 1, 3)), comp2('SmallWheel', p(0, -1, 3))];
    expect(craftMirrorMask(comps, symTwinIndex(comps))).toBe(2);
  });
  test('the game mirrorAxis FIELD (0=none, 1=x, 2=y, 3=z) adds axes', () => {
    const comps = [comp2('Crate', p(1, 0, 0), 3)];          // declares z
    expect(craftMirrorMask(comps, symTwinIndex(comps))).toBe(4);
    expect(craftMirrorMask([comp2('Crate', p(1, 0, 0), 0)], new Map())).toBe(0);
  });
  test('union: pairs ∪ declared fields', () => {
    const comps = [comp2('SmallWheel', p(3, 0, 1)), comp2('SmallWheel', p(-3, 0, 1)),
                   comp2('Crate', p(0, 0, 2), 2)];          // x pair + declared y
    expect(craftMirrorMask(comps, symTwinIndex(comps))).toBe(1 | 2);
  });
});
