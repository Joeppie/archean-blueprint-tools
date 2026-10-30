// items.test.ts — ITEMS ON BELTS (v1.16.10 WP6): the drill mines while
// ANCHORED, items hop the touching-AABB link graph (conduits span up to
// the 0.75 m Jimmy leaves between drill and junction), the crusher
// processes, containers store AND publish their content as the wiki's
// key-value text on the data port. Fixture 9000009070 (the ITEM BENCH);
// Jimmy's Adventure 3334698274 = the real crafter installation census.
import { describe, expect, test } from 'vitest';
import { ItemSim } from '../itemsim';
import { testdataText } from './harness';
import type { Blueprint } from '../format';

const bench = () => JSON.parse(testdataText('9000009070')!) as Blueprint;
const ciOf = (bp: Blueprint, alias: string) =>
  (bp.data.components as { alias?: string }[]).findIndex(c => c.alias === alias);

describe('the ITEM BENCH link graph — @Items', () => {
  test('the chains wire by touching AABBs (the 0.75 m conduit gap included)', () => {
    const sim = new ItemSim();
    sim.load(bench(), null);
    const pair = (a: string, b: string) => sim.links.find(l => {
      const x = sim.nodes[l.a]!.alias, y = sim.nodes[l.b]!.alias;
      return (x === a && y === b) || (x === b && y === a);
    });
    expect(pair('drill', 'jx'), 'the Jimmy-shaped 0.75 gap').toBeTruthy();
    expect(pair('crush', 'jx')).toBeTruthy();
    expect(pair('crush', 'ore-A')).toBeTruthy();
    expect(pair('belt-1', 'belt-2')).toBeTruthy();
    expect(pair('belt-2', 'ore-B')).toBeTruthy();
    // the bare belt row has NO path to a source: nothing flows in B
    expect(pair('drill', 'belt-1')).toBeFalsy();
  });
});

describe('the ITEM BENCH flow — @Items', () => {
  test('the anchored drill mines Rock and the crusher feeds container A', () => {
    const bp = bench();
    const sim = new ItemSim();
    sim.load(bp, null);
    const kv: [string, number, string][] = [];
    for (let i = 0; i < 25 * 8; i++)                 // 8 s at 25 Hz
      sim.step(0.04, (a, c, t) => kv.push([a, c, t]));
    const c = sim.census();
    expect(c.mined).toBeGreaterThan(20);             // LV rate: 10/s
    const oreA = c.containers.find(x => x.alias === 'ore-A');
    expect(oreA, 'container A empty').toBeTruthy();
    // the drill path runs THROUGH the crusher: rock arrives crushed
    expect(oreA!.counts.CrushedRock ?? 0).toBeGreaterThan(0);
    // the wiki Container law: the content is published as .item{count} KV
    const last = kv.filter(r => r[0] === 'ore-A').pop();
    expect(last?.[2], `kv rows: ${kv.length}`).toMatch(/\.CrushedRock\{\d+\}/);
  });
  test('an unanchored craft stops the drill (wiki MiningDrill.md)', () => {
    const bp = bench();
    (bp.data as { components: { type: string }[] }).components =
      (bp.data as { components: { type: string }[] }).components
        .filter(c => c.type !== 'GroundAnchor');
    const sim = new ItemSim();
    sim.load(bp, null);
    for (let i = 0; i < 25 * 8; i++) sim.step(0.04);
    expect(sim.census().mined).toBe(0);
  });
  test('the data gate closes the drill (ch0 = 0)', () => {
    const bp = bench();
    const sim = new ItemSim();
    sim.load(bp, null);
    sim.write(ciOf(bp, 'drill'), 0, 0);
    for (let i = 0; i < 25 * 8; i++) sim.step(0.04);
    expect(sim.census().mined).toBe(0);
  });
  test('an unpowered craft stops the drill too', () => {
    const bp = bench();
    const sim = new ItemSim();
    sim.load(bp, new Set());
    for (let i = 0; i < 25 * 8; i++) sim.step(0.04);
    expect(sim.census().mined).toBe(0);
  });
  test('the flying items render-snapshot sits along the links', () => {
    const sim = new ItemSim();
    sim.load(bench(), null);
    for (let i = 0; i < 25 * 3; i++) sim.step(0.04);
    const snap = sim.snapshot();
    expect(snap.length).toBeGreaterThan(0);
    expect(snap[0]!.item).toMatch(/Rock/);
  });
});

describe("Jimmy's crafter installation — the real chain", () => {
  // Jimmy's item network is authored with `item`-type CABLES (port names
  // item_output/item1/item-in/item-out.NNN): the drill pushes into
  // Container#27, 27 feeds ItemJunction#25, the junction fans out to the
  // Crusher#55, the Crafter#28 and ItemConveyor#54 (→ the crusher too).
  const linkOf = (sim: ItemSim, a: string, b: string) =>
    sim.links.find(l => {
      const x = `${sim.nodes[l.a]!.ci}:${sim.nodes[l.a]!.ci === 0 ? '' : ''}`;
      void x;
      const ai = sim.nodes[l.a]!, bi = sim.nodes[l.b]!;
      return (a === `${ai.type}#${ai.ci}` && b === `${bi.type}#${bi.ci}`)
        || (b === `${ai.type}#${ai.ci}` && a === `${bi.type}#${bi.ci}`);
    });
  test('the item cables wire the chain, directions from the port names', () => {
    const sim = new ItemSim();
    sim.load(JSON.parse(testdataText('3334698274')!) as Blueprint, null);
    const drill = linkOf(sim, 'MiningDrill#19', 'Container#27');
    expect(drill, 'drill --item_output--> container 27').toBeTruthy();
    expect(drill!.pipe).toBe(true);
    // the cable a:drill item_output -> b:container item1 = a pushes
    const aIsDrill = sim.nodes[drill!.a]!.type === 'MiningDrill';
    expect(aIsDrill ? drill!.dir === 'ab' : drill!.dir === 'ba').toBe(true);
    expect(linkOf(sim, 'Container#27', 'ItemJunction#25')?.pipe).toBe(true);
    expect(linkOf(sim, 'ItemJunction#25', 'Crafter#28')?.pipe).toBe(true);
    expect(linkOf(sim, 'ItemJunction#25', 'Crusher#55')?.pipe).toBe(true);
    expect(linkOf(sim, 'ItemJunction#25', 'ItemConveyor#54')?.pipe).toBe(true);
    expect(linkOf(sim, 'ItemConveyor#54', 'Crusher#55')?.pipe).toBe(true);
    expect(sim.census().sources).toBe(1);
  });
  test('Jimmy mines: the drill is HV-cabled, anchored — it RUNS', () => {
    const bp = JSON.parse(testdataText('3334698274')!) as Blueprint;
    const sim = new ItemSim();
    sim.load(bp, null);
    for (let i = 0; i < 25 * 20; i++) sim.step(0.04);
    const c = sim.census();
    expect(c.mined).toBeGreaterThan(100);            // 100/s HV drill (20 s)
    const ore = c.containers.find(x => x.alias === '' && x.ci === 27)
      ?? c.containers.find(x => x.ci === 27);
    expect(ore, 'rocks pile into container 27').toBeTruthy();
    expect(ore!.counts.Rock ?? 0).toBeGreaterThan(0);
  });
});
