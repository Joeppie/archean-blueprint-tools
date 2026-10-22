// economy.test.ts — the VIEW ▸ Build cost math (engine/economy.ts): recipe
// unfold, the per-component tree, nested subgrid content, the STRUCTURAL items
// (blocks, hull triangles, cables, frames, struts), and the SHIPPED table
// (viewer/models/economy.json) against the game's own numbers.
//
// The pinned FluidPort numbers are the game's: Casing = 1000 g Iron,
// Connector = Wire (1 g Copper + Plastic) + Plastic (125 g Carbon +
// 125 g Silicon) — so one FluidPort = 1000 g Iron, 1 g Copper, 250 g Carbon,
// 250 g Silicon, and tools/game_data.py --selfcheck agrees on any craft.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Blueprint } from '../format';
import {
  buildCost, componentCosts, componentEntries, componentItemId, costNode, expandToRaw,
  isMassUnit, loadEconomy, materialName, OCCUPANCY_TYPE, requiredItems, structuralItems,
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

describe('economy — structural build cost (blocks, triangles, cables, frames, struts)', () => {
  const load = (id: string) => JSON.parse(readFileSync(
    new URL(`../../../../testdata/${id}/blueprint.json`, import.meta.url), 'utf8')) as Blueprint;
  const sheet = (data: Record<string, unknown>) => ({
    box_min: { x: 0, y: 0, z: 0 }, box_max: { x: 1, y: 1, z: 1 },
    data: { version: 2, blocks: [], components: [], ...data },
  }) as unknown as Blueprint;

  it('blocks bill their FULL cell rect, type-255 reservations bill nothing', () => {
    const bp = sheet({
      blocks: [
        { type: 3, material: 2, pos_x: 0, pos_y: 0, pos_z: 0, size_x: 1, size_y: 1, size_z: 2 },
        { type: OCCUPANCY_TYPE, material: 5, pos_x: 0, pos_y: 0, pos_z: 0, size_x: 9, size_y: 9, size_z: 9 },
      ],
    });
    const s = structuralItems(bp);
    // (1+1)(1+1)(2+1) = 12 steel cells — the occupancy record costs nothing
    expect(s.blocks['ARCHEAN_build.SteelBlock']).toMatchObject({ qty: 12, cells: 12 });
    expect(Object.keys(s.blocks)).toHaveLength(1);
  });

  it('cables bill per SEGMENT truncation (2 × 1.5 cm = 2 cm, not 3)', () => {
    const bp = sheet({
      pipes: [{ type: 'data', a_component: 0, a_port: 'a', b_component: 1, b_port: 'b',
        segments: [{ dir: 0, length: 0.015, start: { x: 0, y: 0, z: 0 } },
          { dir: 0, length: 0.015, start: { x: 0, y: 0, z: 0 } }] }],
    });
    const s = structuralItems(bp);
    expect(s.cables['ARCHEAN_build.DataCable']).toMatchObject({ qty: 2, runs: 1 });
    expect(s.cables['ARCHEAN_build.DataCable']!.metres).toBeCloseTo(0.03, 9);
    expect(requiredItems(ECON as never, bp)['ARCHEAN_build.DataCable']).toBe(2);
  });

  it('a hull triangle bills ceil(area·0.05 m ÷ cell volume) blocks, min 1', () => {
    // a unit square split in two: each half = 0.5 m² → 0.5·3.2 = 1.6 → 2 cells
    const tri = (pts: number[][]) => ({
      frame_x: 0, frame_y: 0, frame_z: 0, material: 2,
      v0_x: pts[0]![0], v0_y: pts[0]![1], v0_z: pts[0]![2],
      v1_x: pts[1]![0], v1_y: pts[1]![1], v1_z: pts[1]![2],
      v2_x: pts[2]![0], v2_y: pts[2]![1], v2_z: pts[2]![2],
    });
    const s = structuralItems(sheet({ triangles: [
      tri([[0, 0, 0], [4, 0, 0], [0, 4, 0]]),          // 0.5 m²
      tri([[0, 0, 0], [0, 0, 1], [0, 1, 0]]),          // 0.03125 m² → still 1
    ] }));
    const t = s.triangles['ARCHEAN_build.SteelBlock']!;
    expect(t.qty).toBe(3);                             // ceil(1.6) + ceil(0.1) = 2 + 1
    expect(t.tris).toBe(2);
    expect(t.area).toBeCloseTo(0.53125, 9);
  });

  it('frames bill one beam per LIT beam flag, struts their endpoint distance', () => {
    const bp = sheet({
      frames: [
        { frame_x: 0, frame_y: 0, frame_z: 0, beams: [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
        { frame_x: 1, frame_y: 0, frame_z: 0, beams: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
        { frame_x: 2, frame_y: 0, frame_z: 0, beams: [] },
      ],
      struts: [
        // modern files: METRES from the frame corner (a FRACTIONAL v0_x is the
        // dev probe's modern marker — an exact integer < 32 reads as legacy)
        { v0_x: 0.5, v0_y: 0, v0_z: 0, v1_x: 0.5, v1_y: 0, v1_z: 1 },
        { v0_x: 0.5, v0_y: 0, v0_z: 0, v1_x: 0.515, v1_y: 0, v1_z: 0 },
        // legacy files: lattice CELLS — 4 cells = 1 m
        { v0_x: 0, v0_y: 0, v0_z: 0, v1_x: 4, v1_y: 0, v1_z: 0 },
      ],
    });
    const s = structuralItems(bp);
    // 2 + 1 lit beams (an empty frame record bills nothing)
    expect(s.frames['ARCHEAN_build.SteelBeam']!.qty).toBe(3);
    // 1 m = 100 rods, 1.5 cm rounds UP to 2 rods (struts ceil, cables trunc),
    // and the legacy cell strut is the same 1 m rod run
    expect(s.struts['ARCHEAN_build.SteelRod']).toMatchObject({ qty: 202 });
    expect(s.struts['ARCHEAN_build.SteelRod']!.metres).toBeCloseTo(2.015, 9);
  });

  it('3732302108 — the deck + hull skin craft matches the game content list', () => {
    const bp = load('3732302108');
    const c = buildCost(ECON as never, bp);
    // blocks 157 Al + 1 Pb, triangles 248 Al + 9 Composite + 5 Glass
    expect(requiredItems(ECON as never, bp)).toMatchObject({
      'ARCHEAN_build.AluminiumBlock': 405,
      'ARCHEAN_build.LeadBlock': 1,
      'ARCHEAN_build.CompositeBlock': 9,
      'ARCHEAN_build.GlassBlock': 5,
      'ARCHEAN_build.DataCable': 7362,
      'ARCHEAN_build.LowVoltageCable': 5776,
      'ARCHEAN_build.HighVoltageCable': 1289,
      'ARCHEAN_build.FluidPipe': 390,
    });
    expect(c.blocks).toEqual({ records: 47, cells: 158, materials: 2 });
    expect(c.triangles.tris).toBe(241);
    expect(c.triangles.area).toBeCloseTo(34.461, 2);
    expect(c.cables.runs).toBe(110);
    expect(c.cables.metres).toBeCloseTo(150.639, 2);
    // the sections carry the same numbers the rows show (and a recipe chain)
    const blocks = c.sources.find(s => s.id === 'blocks')!;
    const aluminium = blocks.rows.find(r => r.item.endsWith('.AluminiumBlock'))!;
    expect(aluminium).toMatchObject({ qty: 157 });
    expect(aluminium.measure.cells).toBe(157);
    // an aluminium cell = one AluminiumBlock = 500 g Aluminium
    expect(aluminium.node.children.map(k => materialName(k.id))).toEqual(['Aluminium']);
    const cables = c.sources.find(s => s.id === 'cables')!;
    const data = cables.rows.find(r => r.item.endsWith('.DataCable'))!;
    expect(data.qty).toBe(7362);                        // item units = cm of cable
    expect(data.measure.metres).toBeCloseTo(74.849, 2); // … while the run is 74.8 m
    expect(data.measure.runs).toBeGreaterThan(0);
    // the craft total is parts + structure: Iron includes the block cells
    expect(c.total.raw['ARCHEAN_celestial.Iron']).toBeGreaterThan(400_000);
  });

  it('dolphin — 2058 composite cells, and 1 cm cable stubs charge no unit', () => {
    const bp = load('3417786605');
    const c = buildCost(ECON as never, bp);
    expect(c.blocks).toEqual({ records: 443, cells: 2060, materials: 2 });
    const comp = c.sources.find(s => s.id === 'blocks')!.rows
      .find(r => r.item.endsWith('.CompositeBlock'))!;
    expect(comp.qty).toBe(2058);
    // 73 runs / 5.58 m whose segments are 1 cm float32 stubs → trunc to 0
    expect(c.cables).toMatchObject({ runs: 73 });
    expect(c.cables.metres).toBeCloseTo(5.58, 2);
    expect(c.sources.find(s => s.id === 'cables')!.rows).toEqual([]);
    // dashboards are billed as their authoring tool, once (8 boards on board)
    const rows = c.rows.map(r => r.type);
    expect(rows).toContain('DashboardTool');
    expect(rows).not.toContain('Dashboard');
    expect(c.rows.find(r => r.type === 'DashboardTool')!.count).toBe(1);
  });

  it('frames and struts use the game’s own beam / rod rule on real crafts', () => {
    // 47 frame records carrying 493 lit beams (tools/game_data.py agrees)
    const framed = buildCost(ECON as never, load('3284539247'));
    expect(framed.structural.frames['ARCHEAN_build.SteelBeam']).toBe(493);
    // 18 struts, 75.39 m of rod — 7,548 rods at 1 cm each
    const strutted = buildCost(ECON as never, load('3803780241'));
    expect(strutted.structural.struts['ARCHEAN_build.SteelRod']).toBe(7548);
    const row = strutted.sources.find(s => s.id === 'struts')!.rows[0]!;
    expect(row.measure.metres).toBeCloseTo(75.393, 2);
    expect(row.node.children.map(k => materialName(k.id))).toEqual(['Iron']);
  });
});
