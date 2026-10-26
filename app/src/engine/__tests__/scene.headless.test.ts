// THE HEADLESS PROBE TIER (docs/TEST-PYRAMID.md Phase 1, v1.12.1): the
// "does it RENDER in the right place" class, on plain node — the real
// Engine, the real open funnel, the real testdata crafts, the real model
// atlas from disk, no canvas (Engine.setVirtualViewport). Every law here
// is transcribed from an e2e spec whose browser cost the law does not
// need; those legs retire in this commit (L5). Pixel laws (surge sprites,
// overlay restore, day-light rig) stay e2e — this file never claims them.
import { describe, expect, test } from 'vitest';
import { openCraft, withRealModels } from './harness';
import type { Engine } from '../scene';
import type { Blueprint } from '../format';

type Box = { min: [number, number, number]; max: [number, number, number] };
const cIs = (bp: Blueprint, re: RegExp): number[] =>
  bp.data.components.map((c, ci) => (re.test(c.type) ? ci : -1)).filter((i) => i >= 0);
const center = (b: Box): [number, number, number] =>
  [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];

describe('wheels hang below their mounts (was wheels.spec @models @slow)', () => {
  test('modern ISW: front caster hangs, rear pair unchanged', async () => {
    const e = openCraft('3812927875');
    const bp = e.blueprint!;
    const cis = cIs(bp, /^SmallWheel$/);
    expect(cis.length).toBe(3);
    await withRealModels(e, cis);
    const boxes = cis.map((ci) => e.compRealBox(ci)!);
    const front = boxes.find((b) => b.max[1] > 1.0 && Math.abs(center(b)[0]) < 0.5)!;
    // hanging: apex stays at the mount — NO 1.705 stick-up (the v1.11
    // retirement regression, transcribed verbatim from wheels.spec)
    expect(front.max[1], `front caster top ${front.max[1]} (sticking-up regression > 1.14)`).toBeLessThan(1.14);
    expect(front.min[1], 'front caster reaches toward the ground').toBeLessThan(0.4);
    for (const r of boxes.filter((b) => b !== front)) {
      expect(r.min[1], `rear caster bottom ${r.min[1]}`).toBeCloseTo(0.188, 2);
      expect(r.max[1], `rear caster top ${r.max[1]}`).toBeCloseTo(0.999, 2);
    }
  }, 120_000);
  test('legacy semi truck: build pose kept (droop OFF for raw-quat files)', async () => {
    const e = openCraft('3481322297');
    const cis = cIs(e.blueprint!, /^BigWheel$/);
    expect(cis.length).toBeGreaterThan(0);
    await withRealModels(e, cis);
    for (const ci of cis) {
      const b = e.compRealBox(ci)!;
      expect(b.min[1], `truck BigWheel bottom ${b.min[1]}`).toBeCloseTo(-1.941, 2);
      expect(b.max[1], `truck BigWheel top ${b.max[1]}`).toBeCloseTo(0.065, 2);
    }
  }, 120_000);
});

describe('nested subgrids render (was subride.spec @subgrid)', () => {
  test('a SUBGRID OF A SUBGRID renders — file census === rendered census', () => {
    const e = openCraft('3308603448', { atlas: null });
    const comps = e.blueprint!.data.components as unknown as {
      type?: string; data?: { blocks?: unknown[]; components?: never[]; triangles?: unknown[] } }[];
    let parts = 0;
    const walk = (list: { type?: string; data?: { components?: never[] } }[]) => {
      for (const c of list) {
        if (c.type === 'Build') walk((c.data?.components ?? []) as typeof list);
        else parts++;
      }
    };
    for (const c of comps) if (c.type === 'Build') walk((c.data?.components ?? []) as never[]);
    const groups = comps.filter((c) => c.type === 'Build'
      && ((c.data?.blocks?.length ?? 0) + (c.data?.components?.length ?? 0) + (c.data?.triangles?.length ?? 0)) > 0).length;
    expect(parts, 'the file nests deep content (wheels two Builds deep)').toBeGreaterThanOrEqual(30);
    const st = e.subStats();
    expect(st.parts, 'EVERY nested part renders, at any depth').toBe(parts);
    expect(st.groups, 'one group per top-level Build with content').toBe(groups);
  });
});

describe('x-ray fixture census (P7.3a: was the truck wire legs @slow)', () => {
  test('every fixture cable occludes, deterministically (fixture law)', () => {
    const e = openCraft('9000007001', { atlas: null });
    // the census's mesh-level cheap reject reads geometry bounding boxes
    // that three lazily computes/expands on first use — the priming pass
    // settles the graph, the pins then assert the SETTLED-state law.
    for (let i = 0; i < 2; i++) for (const pi of [0, 1, 2, 3]) e.xrayCutsFor(pi);
    const cuts = [0, 1, 2, 3].map((pi) => e.xrayCutsFor(pi));
    // the fixture (REWRITE §P7.3a): pipes 0/1/3 run BEHIND the wall, pipe 2
    // is the designed NEGATIVE (x-clear, floating). Exact counts follow the
    // fit camera; the law is: positives occlude, the negative is the min.
    const cut = (pi: number): number => cuts[pi]!;
    for (const pi of [0, 1, 3])
      expect(cut(pi), `pipe ${pi} (behind the wall) occludes from the fit view`).toBeGreaterThan(0);
    expect(cut(2), 'the x-clear floating pipe is the census min').toBe(Math.min(...cuts));
    expect(cut(2)).toBeLessThan(cut(0));
  });
  test('the one-way input pipe flows one way (v1.11.7 law, node tier)', () => {
    const e = openCraft('9000007001', { atlas: null });
    expect(e.pipeFlowDir(1), 'Battery → LVJ lowvoltage-INPUT flows ab').toBe('ab');
    expect(e.pipeFlowDir(0), 'a junction-out ↔ junction-out pair is undirected').toBe('both');
  });
});

describe('pick routing (was scene.spec + select.spec canvas legs)', () => {
  test("a part's projected pixel picks THAT component (the spec's probe law)", () => {
    const e = openCraft('3812927875', { atlas: null });
    const cis = cIs(e.blueprint!, /^(PilotSeat|Propeller)$/);
    expect(cis.length).toBeGreaterThan(0);
    for (const ci of cis) {
      const p = e.blueprint!.data.components[ci]!.position as unknown as { x: number; y: number; z: number };
      const sp = e.screenPoint(p.x, p.y, p.z);
      expect(sp, `part ${ci} projects into the virtual pad`).not.toBeNull();
      const hit = e.pickAt(sp![0], sp![1]);
      expect(hit.kind, `part ${ci}'s pixel answers comp`).toBe('comp');
      expect(hit.ci).toBe(ci);
    }
  });
  test('pickCell answers a structural face, pickAt a part (merged pick law)', () => {
    const e = openCraft('3732302108', { atlas: null });   // gantry: decks + parts
    let cell: ReturnType<Engine['pickCell']> = null;
    for (let y = 100; y <= 500 && !cell; y += 100)
      for (let x = 100; x <= 700 && !cell; x += 100)
        cell = e.pickCell(x, y);
    expect(cell, 'the gantry presents a pickable surface from the fit view').not.toBeNull();
    expect(['block', 'tri', 'comp', 'sub', 'ground']).toContain(cell!.kind);
  });
});

describe('symmetry twins sit mirrored (was sym.spec geometry, @slow)', () => {
  test('ISW SmallWheel pair: world boxes mirror across x', async () => {
    const e = openCraft('3812927875');
    const cis = cIs(e.blueprint!, /^SmallWheel$/);
    await withRealModels(e, cis);
    const boxes = cis.map((ci) => e.compRealBox(ci)!);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = center(boxes[i]!), b = center(boxes[j]!);
        if (Math.abs(a[0]) < 0.5) continue;                     // centreline wheel
        if (Math.abs(a[0] + b[0]) < 0.05 && Math.abs(a[1] - b[1]) < 0.05
          && Math.abs(a[2] - b[2]) < 0.05) return;              // a mirrored pair exists
      }
    }
    expect(false, 'ISW carries at least one x-mirrored SmallWheel pair').toBe(true);
  }, 120_000);
});
