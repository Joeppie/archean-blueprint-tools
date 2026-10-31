// scannersim.test.ts — THE SCANNER SIM (v1.16.24, we: "the ore scanner
// needs to return somewhat OK results, so that it doesnt seem completely
// gibberish what it sends"). The wiki laws (mining/OreScanner.md,
// navigation/TerrainScanner.md): distance in on ch, ONE TICK later the
// answer on the same channel; the ore answer is the `.Al{0.1500}…` KV text
// whose fractions sum to 1 (mining.md §Rock Composition); the terrain
// answer is an altitude NUMBER; stable distances answer IDENTICALLY (the
// wiki asks programs to keep them consistent — the game measures, it does
// not reroll).
import { describe, expect, test } from 'vitest';
import { ScannerSim, altitudeAt, compositionAt } from '../scannersim';

const bp = (types: string[]) =>
  ({ data: { components: types.map(t => ({ type: t })) } }) as never;

describe('ScannerSim — the wiki scan laws', () => {
  test('unregistered types take no scans', () => {
    const sim = new ScannerSim();
    sim.load(bp(['Lamp']));
    sim.write(0, 0, 10);
    expect(sim.step()).toEqual([]);
  });
  test('the tick that sees a distance answers it; stable stays silent', () => {
    // the wiki's one-tick delay: the program writes at cycle N, the scan
    // answers that same step, the reply lands in the pumps' inputs for
    // cycle N+1 — input_text at N reads the PREVIOUS tick's distance.
    const sim = new ScannerSim();
    sim.load(bp(['OreScanner']));
    sim.write(0, 0, 10);
    expect(sim.step()).toHaveLength(1);
    expect(sim.step()).toEqual([]);             // unchanged distance: silence
  });
  test('OreScanner: one .Sym{0.xxxx} per element, fractions sum to ONE', () => {
    const sim = new ScannerSim();
    sim.load(bp(['OreScanner']));
    sim.write(0, 3, 40);
    const r = sim.step();
    expect(r).toHaveLength(1);
    expect(r[0]!.ci).toBe(0);
    expect(r[0]!.ch).toBe(3);
    const text = String(r[0]!.value);
    const parts = text.match(/\.[A-Za-z]{1,2}\{0\.\d{4}\}/g) ?? [];
    expect(parts.length).toBeGreaterThanOrEqual(2);
    expect(text).toBe(parts.join(''));         // nothing else in the text
    const sum = parts.reduce((a, p) => a + Number(/\{([\d.]+)\}/.exec(p)![1]), 0);
    expect(sum).toBeCloseTo(1, 6);
    // the symbols are mining.md's element table
    for (const p of parts)
      expect(['Al', 'C', 'Cr', 'Cu', 'Au', 'F', 'Fe', 'Pb', 'Ni', 'Si',
        'Ag', 'Sn', 'Ti', 'W', 'U', 'Ch']).toContain(p.slice(1, p.indexOf('{')));
  });
  test('a distance change re-answers; ≤0 stops the scan', () => {
    const sim = new ScannerSim();
    sim.load(bp(['OreScanner']));
    sim.write(0, 0, 40);
    expect(sim.step()).toHaveLength(1);
    sim.write(0, 0, 60);
    expect(sim.step()).toHaveLength(1);
    sim.write(0, 0, 60);                        // same distance: silent
    expect(sim.step()).toEqual([]);
    sim.write(0, 0, 0);                         // ≤0 = no scan asked
    expect(sim.step()).toEqual([]);
    sim.write(0, 0, 60);
    expect(sim.step()).toHaveLength(1);         // re-armed
  });
  test('the ore field is a FIELD, not a reroll: stable per deposit cell', () => {
    const a = compositionAt(5, 100);
    expect(compositionAt(5, 105)).toBe(a);      // same ~12 m cell
    expect(compositionAt(5, 100)).toBe(a);      // re-asking is stable
    expect(compositionAt(5, 400)).not.toBe(a);  // far ground differs
    expect(compositionAt(6, 100)).not.toBe(a);  // another location differs
  });
  test('TerrainScanner answers an altitude NUMBER, smooth in the distance', () => {
    const sim = new ScannerSim();
    sim.load(bp(['TerrainScanner']));
    sim.write(0, 0, 50);
    const r = sim.step();
    expect(typeof r[0]!.value).toBe('number');
    expect(Math.abs(r[0]!.value as number)).toBeLessThan(300);
    // the ground is continuous: a 1 m step never jumps a metre
    let max = 0;
    for (let d = 0; d < 600; d++)
      max = Math.max(max, Math.abs(altitudeAt(2, d + 1) - altitudeAt(2, d)));
    expect(max).toBeLessThan(3);
  });
  test('clear() forgets the distances (a craft swap re-scans fresh)', () => {
    const sim = new ScannerSim();
    sim.load(bp(['OreScanner']));
    sim.write(0, 0, 40);
    sim.step();
    sim.clear();
    sim.write(0, 0, 40);
    expect(sim.step()).toHaveLength(1);         // answers again after clear
  });
});
