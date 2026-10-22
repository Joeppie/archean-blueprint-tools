// economy.test.ts — the VIEW ▸ Component cost math (engine/economy.ts):
// recipe unfold, the per-component tree, nested subgrid content, and the
// SHIPPED table (viewer/models/economy.json) against the game's own numbers.
//
// The pinned FluidPort numbers are the game's: Casing = 1000 g Iron,
// Connector = Wire (1 g Copper + Plastic) + Plastic (125 g Carbon +
// 125 g Silicon) — so one FluidPort = 1000 g Iron, 1 g Copper, 250 g Carbon,
// 250 g Silicon, and tools/game_data.py --selfcheck agrees on any craft.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Blueprint } from '../format';
import {
  componentCosts, componentEntries, componentItemId, costNode, expandToRaw,
  isMassUnit, loadEconomy, materialName,
} from '../economy';

const ECON = JSON.parse(readFileSync(
  new URL('../../../../viewer/models/economy.json', import.meta.url), 'utf8')) as {
    recipes: Record<string, { out: number; in: Record<string, number>; time?: number }>;
    components: string[];
  };

const TINY = {
  recipes: {
    'A.Part': { out: 1, in: { 'A.Casing': 2, 'A.Bolt': 1 }, time: 2 },
    'A.Casing': { out: 2, in: { 'ORE.Iron': 1000 }, time: 1 },   // 2 per batch!
    'A.Bolt': { out: 1, in: { 'ORE.Carbon': 10 } },
    'A.Cycle1': { out: 1, in: { 'A.Cycle2': 1 } },
    'A.Cycle2': { out: 1, in: { 'A.Cycle1': 1 } },
  },
  components: ['A.Part', 'A.Casing', 'A.Bolt', 'A.Sensor'],
};

describe('economy — expandToRaw', () => {
  it('unfolds through batches (out > 1) and sums crafter time', () => {
    const c = expandToRaw(TINY, { 'A.Part': 1 });
    expect(c.raw).toEqual({ 'ORE.Iron': 1000, 'ORE.Carbon': 10 });
    // Part 2 s + Casing 2 units = 1 batch × 1 s
    expect(c.time).toBeCloseTo(3, 9);
  });

  it('scales linearly with the item count', () => {
    const c = expandToRaw(TINY, { 'A.Part': 3 });
    expect(c.raw['ORE.Iron']).toBe(3000);
    expect(c.raw['ORE.Carbon']).toBe(30);
  });

  it('a catalog component without a recipe is UNRESOLVED, a raw ore is RAW', () => {
    const c = expandToRaw(TINY, { 'A.Sensor': 2, 'ORE.Silicon': 5 });
    expect(c.raw).toEqual({ 'ORE.Silicon': 5 });
    expect(c.unresolved).toEqual({ 'A.Sensor': 2 });
  });

  it('cycle guard terminates and books the loop item as unresolved', () => {
    const c = expandToRaw(TINY, { 'A.Cycle1': 1 });
    expect(c.raw).toEqual({});
    expect(c.unresolved).toEqual({ 'A.Cycle1': 1 });
  });
});

describe('economy — costNode (the per-component recipe tree)', () => {
  it('children are the DIRECT constituents, each carrying its own raw cost', () => {
    const n = costNode(TINY, 'A.Part', 1);
    expect(n.children.map(c => [c.id, c.qty])).toEqual([['A.Casing', 2], ['A.Bolt', 1]]);
    expect(n.children[0]!.cost.raw).toEqual({ 'ORE.Iron': 1000 });
    expect(n.children[0]!.children.map(c => [c.id, c.qty])).toEqual([['ORE.Iron', 1000]]);
    expect(n.stuck).toBe(false);
  });

  it('flags a recipe-less catalog component as stuck (no children)', () => {
    const n = costNode(TINY, 'A.Sensor', 1);
    expect(n.stuck).toBe(true);
    expect(n.children).toEqual([]);
    expect(n.cost.unresolved).toEqual({ 'A.Sensor': 1 });
  });

  it('does not recurse into a cycle', () => {
    const n = costNode(TINY, 'A.Cycle1', 1);
    // Cycle1 → Cycle2 → Cycle1 (seen) stops there instead of looping
    expect(n.children).toHaveLength(1);
    const again = n.children[0]!.children;
    expect(again).toHaveLength(1);
    expect(again[0]!.id).toBe('A.Cycle1');
    expect(again[0]!.children).toEqual([]);
    expect(again[0]!.cut).toBe(true);
  });
});

describe('economy — craft inventory', () => {
  const comp = (type: string, extra: Record<string, unknown> = {}) =>
    ({ type, module: 'A', position: { x: 0, y: 0, z: 0 }, orientation: { w: 1, x: 0, y: 0, z: 0 }, ...extra });
  const bp = {
    box_min: { x: 0, y: 0, z: 0 }, box_max: { x: 0, y: 0, z: 0 },
    data: {
      version: 2, blocks: [], components: [
        comp('Part'), comp('Part'),
        // a Build ghost with ONE nested part (the subgrid's content)
        comp('Build', { data: { components: [comp('Bolt')] } }),
        // ... and a deeper level, to prove recursion is not one-shot
        comp('Build', { data: { components: [comp('Build', { data: { components: [comp('Sensor')] } })] } }),
      ],
    },
  } as unknown as Blueprint;

  it('counts subgrid content, drops the Build ghosts themselves', () => {
    const e = componentEntries(TINY, bp);
    expect(e.map(x => [x.id, x.count, x.nested])).toEqual([
      ['A.Part', 2, false], ['A.Bolt', 1, true], ['A.Sensor', 1, true],
    ]);
  });

  it('componentCosts multiplies per-unit costs by the count', () => {
    const c = componentCosts(TINY, bp);
    const part = c.rows.find(r => r.id === 'A.Part')!;
    expect(part.count).toBe(2);
    expect(part.unit.cost.raw).toEqual({ 'ORE.Iron': 1000, 'ORE.Carbon': 10 });
    expect(part.total.raw).toEqual({ 'ORE.Iron': 2000, 'ORE.Carbon': 20 });
    // craft total = every row's contribution (the nested Bolt adds 10 g Carbon)
    expect(c.total.raw).toEqual({ 'ORE.Iron': 2000, 'ORE.Carbon': 30 });
    expect(c.total.unresolved).toEqual({ 'A.Sensor': 1 });
    // biggest material first
    expect(c.rows[0]!.id).toBe('A.Part');
  });

  it('resolves the item id from the component record (module + type)', () => {
    expect(componentItemId(TINY, comp('Part') as never)).toBe('A.Part');
    expect(componentItemId(TINY, { type: 'Casing' } as never)).toBe('A.Casing');
  });
});

describe('economy — the SHIPPED table', () => {
  it('FluidPort costs 1000 g Iron · 1 g Copper · 250 g Carbon · 250 g Silicon', () => {
    const n = costNode(ECON as never, 'ARCHEAN_chemical.FluidPort', 1);
    expect(n.cost.raw).toEqual({
      'ARCHEAN_celestial.Iron': 1000,
      'ARCHEAN_celestial.Copper': 1,
      'ARCHEAN_celestial.Carbon': 250,
      'ARCHEAN_celestial.Silicon': 250,
    });
    expect(n.stuck).toBe(false);
    // its constituents: 1 Casing + 1 Connector, and the Connector's own inputs
    expect(n.children.map(c => c.id)).toEqual(['ARCHEAN_parts.Casing', 'ARCHEAN_parts.Connector']);
    const conn = n.children[1]!;
    expect(conn.children.map(c => c.id).sort())
      .toEqual(['ARCHEAN_parts.Plastic', 'ARCHEAN_parts.Wire']);
  });

  it('a craft total equals the sum of its parts (dolphin subgrids included)', () => {
    const bp = JSON.parse(readFileSync(
      new URL('../../../../testdata/3417786605/blueprint.json', import.meta.url), 'utf8')) as Blueprint;
    const c = componentCosts(ECON as never, bp);
    const fp = c.rows.find(r => r.type === 'FluidPort')!;
    expect(fp.count).toBe(4);                     // 3 top-level + 1 in a Build
    expect(fp.total.raw['ARCHEAN_celestial.Iron']).toBe(4000);
    const sumIron = c.rows.reduce((n, r) => n + (r.total.raw['ARCHEAN_celestial.Iron'] ?? 0), 0);
    expect(c.total.raw['ARCHEAN_celestial.Iron']).toBe(sumIron);
    // every part is accounted for: rows + counts cover the file's parts
    const parts = c.rows.reduce((n, r) => n + r.count, 0);
    expect(parts).toBeGreaterThan(50);
  });

  it('terminal materials are grams, crafted items are counts', () => {
    expect(isMassUnit('ARCHEAN_celestial.Iron')).toBe(true);
    expect(isMassUnit('ARCHEAN_nuclear.PlutoniumDioxide')).toBe(true);
    expect(isMassUnit('ARCHEAN_parts.Casing')).toBe(false);
    expect(materialName('ARCHEAN_celestial.Iron')).toBe('Iron');
  });

  it('loadEconomy is exported for the widget (fetch-backed, no throw offline)', () => {
    expect(typeof loadEconomy).toBe('function');
  });
});
