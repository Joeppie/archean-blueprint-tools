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
    const pairs = sim.links.map(l =>
      [sim.nodes[l.a]!.alias, sim.nodes[l.b]!.alias].sort().join('|'));
    expect(pairs).toContain('drill|jx');            // the Jimmy-shaped 0.75 gap
    expect(pairs).toContain('crush|jx');
    expect(pairs).toContain('crush|ore-A');
    expect(pairs).toContain('belt-1|belt-2');
    expect(pairs).toContain('belt-2|ore-B');
    // the bare belt row has NO path to a source: nothing flows in B
    expect(pairs).not.toContain('drill|belt-1');
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
  test('the crawl: drill, junction, crusher, containers and the crafter link', () => {
    const bp = JSON.parse(testdataText('3334698274')!) as Blueprint;
    const sim = new ItemSim();
    sim.load(bp, null);
    const pairs = sim.links.map(l => {
      const a = sim.nodes[l.a]!, b = sim.nodes[l.b]!;
      return [`${a.type}#${a.ci}`, `${b.type}#${b.ci}`].sort().join('|');
    });
    // the crafter touches container 27; 27 touches the junction
    expect(pairs).toContain('Container#27|Crafter#28');
    expect(pairs).toContain('Container#27|ItemJunction#25');
    expect(pairs).toContain('ItemJunction#25|MiningDrill#19');
    expect(sim.census().sources).toBe(1);
  });
  test('Jimmy mines: the drill runs (anchored craft, powered census on)', () => {
    const bp = JSON.parse(testdataText('3334698274')!) as Blueprint;
    const sim = new ItemSim();
    sim.load(bp, null);
    for (let i = 0; i < 25 * 20; i++) sim.step(0.04);
    const c = sim.census();
    expect(c.mined).toBeGreaterThan(50);             // 10/s LV drill
    const withItems = c.containers.filter(x => Object.keys(x.counts).length);
    expect(withItems.length).toBeGreaterThan(0);     // the mosaic fills
  });
});
