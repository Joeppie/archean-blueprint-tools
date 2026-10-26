// THE HEADLESS PROBE TIER (docs/TEST-PYRAMID.md Phase 1, v1.12.1): the
// "does it RENDER in the right place" class, on plain node — the real
// Engine, the real open funnel, the real testdata crafts, the real model
// atlas from disk, no canvas (Engine.setVirtualViewport). Every law here
// is transcribed from an e2e spec whose browser cost the law does not
// need; those legs retire in this commit (L5). Pixel laws (surge sprites,
// overlay restore, day-light rig) stay e2e — this file never claims them.
import { describe, expect, test } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { manifestOnly, openCraft, openCraftOpt, withRealModels } from './harness';
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

describe('generated propeller (was propeller.spec @models @slow @Propeller)', () => {
  const propSpans = async (id: string): Promise<number[]> => {
    const e = openCraft(id);
    const ci = cIs(e.blueprint!, /^Propeller$/)[0]!;
    await withRealModels(e, [ci]);
    const b = e.compRealBox(ci)!;
    return ([0, 1, 2] as const).map((a) => b.max[a] - b.min[a]).sort((x, y) => x - y);
  };
  test('rest twin: generated r = 1.2 m disc, flat (hub-thin smallest axis)', async () => {
    const s = await propSpans('9000001024');
    expect(s[1], `mid span ${s[1]} (template: 1.76)`).toBeGreaterThan(2.2);
    expect(s[2], `max span ${s[2]} (2r = 2.4 + chord)`).toBeGreaterThan(2.2);
    expect(s[0], `min span ${s[0]} (hub+tilt cone)`).toBeLessThan(1.4);
    expect(s[0], `min span ${s[0]} (hub not lost)`).toBeGreaterThan(0.1);
  }, 120_000);
  test('deflected twin: twist/pitch spread the surface OUT OF PLANE beyond the rest twin', async () => {
    const sR = await propSpans('9000001024');
    const sD = await propSpans('9000002024');
    expect(sD[2], 'deflected keeps the disc diameter').toBeGreaterThan(2.2);
    expect(sD[2], 'deflected disc diameter ≈ rest').toBeLessThan(sR[2]! + 0.6);
    expect(sD[0]! - sR[0]!,
      'out-of-plane spread grew (twist/pitch → data drives geometry)').toBeGreaterThan(0.5);
  }, 120_000);
});

// SOLO fixtures (one part per craft) live ONLY in the resolved blueprint
// corpus (env ARCHEAN_BLUEPRINTS > blueprints.conf > testdata) — pins SKIP
// cleanly where the corpus is absent, per the §Blueprint folder rule.
describe('content basis C·chain·C⁻¹ on solo fixtures (was asset-space.spec @models @slow)', () => {
  const spansOf = async (id: string, type: string): Promise<number[] | null> => {
    const e = openCraftOpt(id);
    if (!e) return null;
    const ci = cIs(e.blueprint!, new RegExp(`^${type}$`))[0];
    if (ci === undefined) throw new Error(`solo fixture ${id} has no ${type}`);
    await withRealModels(e, [ci]);
    const b = e.compRealBox(ci)!;
    return [0, 1, 2].map((a) => b.max[a]! - b.min[a]!);
  };
  test('ActiveRadiator: slab spans X·Y, thin Z', async (ctx) => {
    const s = await spansOf('9000003001', 'ActiveRadiator');
    if (s === null) ctx.skip();
    expect(s![0]!, `x ${s![0]}`).toBeGreaterThan(0.9);
    expect(s![1]!, `y ${s![1]} (baked-file frame: 0.72 — slab tipped)`).toBeGreaterThan(0.9);
    expect(s![2]!, `z ${s![2]} (raw-file frame: 0.72)`).toBeLessThan(0.55);
  }, 120_000);
  test('Aileron: wing plate spans X·Z, thin Y', async (ctx) => {
    const s = await spansOf('9000003002', 'Aileron');
    if (s === null) ctx.skip();
    expect(s![0]!, `x ${s![0]}`).toBeGreaterThan(0.9);
    expect(s![1]!, `y ${s![1]} (raw: 0.48 / baked-file: 1.01)`).toBeLessThan(0.4);
    expect(s![2]!, `z ${s![2]} (raw 0.76 / baked 0.48)`).toBeGreaterThan(0.9);
  }, 120_000);
  test('TrashCan: drum along Y at identity mount', async (ctx) => {
    const s = await spansOf('9000003102', 'TrashCan');
    if (s === null) ctx.skip();
    expect(s![1]!, `y ${s![1]} (baked-file: 0.5 tipped)`).toBeGreaterThan(0.65);
    expect(s![2]!, `z ${s![2]} (baked-file: 0.72)`).toBeLessThan(0.6);
  }, 120_000);
  test('ToggleButton: lever stack thin X/Y, +0.37 along Z', async (ctx) => {
    const s = await spansOf('9000003100', 'ToggleButton');
    if (s === null) ctx.skip();
    expect(s![0]!, `x ${s![0]}`).toBeLessThan(0.3);
    expect(s![1]!, `y ${s![1]} (raw: 0.44)`).toBeLessThan(0.32);
    expect(s![2]!, `z ${s![2]} (raw: 0.63)`).toBeGreaterThan(0.25);
    expect(s![2]!, `z ${s![2]} (raw: 0.63)`).toBeLessThan(0.5);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// THE JOINT-RIDE AUDIT — verbatim port of subride.spec's page.evaluate body
// (was @subgrid @slow, 2 crafts × 2 projects): the shipped TGC writeback
// path is fully programmatic (gizmoProxy + gizmoWriteback), so the whole
// (subgrid, master) pair audit runs on the headless Engine.
type Pair = {
  bi: number; top: number; type: string;
  lever: number; onPanel: number;
  rideP: number; rideQ: number; panelTravel: number; partTravel: number;
};

function subrideAudit(e: Engine): Pair[] {
  const eng = e as unknown as {
    moffView: { x: number; y: number; z: number };
    bp: Blueprint;
    gizmoCi: number;
    gizmoProxy: { quaternion: import('three').Quaternion; position: import('three').Vector3 };
    captureGesture(ci: number): void;
    gizmoWriteback(): void;
    subJrefs: Map<number, { top: number; pivot0: number[]; p0: number[]; mc: { type: string } }[]>;
    subGroups: Map<number, { position: { x: number; y: number; z: number }; quaternion: { w: number; x: number; y: number; z: number } }>;
    compRoots: Map<number, { visible: boolean; position: { x: number; y: number; z: number }; quaternion: { w: number; x: number; y: number; z: number } }[]>;
    select(ci: number): void;
  };
  const qmul = (a: number[], b: number[]) => [
    a[0]! * b[0]! - a[1]! * b[1]! - a[2]! * b[2]! - a[3]! * b[3]!,
    a[0]! * b[1]! + a[1]! * b[0]! + a[2]! * b[3]! - a[3]! * b[2]!,
    a[0]! * b[2]! - a[1]! * b[3]! + a[2]! * b[0]! + a[3]! * b[1]!,
    a[0]! * b[3]! + a[1]! * b[2]! - a[2]! * b[1]! + a[3]! * b[0]!,
  ];
  const qconj = (q: number[]) => [q[0]!, -q[1]!, -q[2]!, -q[3]!];
  const qrot = (q: number[], v: number[]) => {
    const [w, x, y, z] = q as [number, number, number, number];
    const t = [2 * (y! * v[2]! - z! * v[1]!), 2 * (z! * v[0]! - x! * v[2]!), 2 * (x! * v[1]! - y! * v[0]!)];
    return [v[0]! + w! * t[0]! + (y! * t[2]! - z! * t[1]!), v[1]! + w! * t[1]! + (z! * t[0]! - x! * t[2]!), v[2]! + w! * t[2]! + (x! * t[1]! - y! * t[0]!)];
  };
  const sub = (a: number[], b: number[]) => a.map((v, i) => v! - b[i]!);
  const add = (a: number[], b: number[]) => a.map((v, i) => v! + b[i]!);
  const len = (a: number[]) => Math.hypot(...a);
  const spinDeg = (q: number[]) => 2 * Math.acos(Math.min(1, Math.abs(q[0]!))) * 180 / Math.PI;

  const pairs: Pair[] = [];
  const moff = [eng.moffView.x, eng.moffView.y, eng.moffView.z];
  for (const [bi, jrefs] of eng.subJrefs) {
    for (const j of jrefs) {
      if (j.top < 0) continue;
      // the panel's block bbox (the clamp target) in the WORLD frame it renders in
      const bl = ((eng.bp.data.components[bi]?.data?.blocks as { type?: number; pos_x: number; pos_y: number; pos_z: number; size_x?: number; size_y?: number; size_z?: number; frame_x?: number; frame_y?: number; frame_z?: number }[] | undefined) ?? [])
        .filter((x) => (x.type ?? 0) !== 255);
      const bb = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
      for (const x of bl) for (const s of [[0, 0, 0], [(x.size_x ?? 0) + 1, (x.size_y ?? 0) + 1, (x.size_z ?? 0) + 1]]) {
        const p = [(x.pos_x + s[0]! + (x.frame_x ?? 0) * 12 - 5.5) * 0.25 + moff[0]!,
          (x.pos_y + s[1]! + (x.frame_y ?? 0) * 12 - 5.5) * 0.25 + moff[1]!,
          (x.pos_z + s[2]! + (x.frame_z ?? 0) * 12 - 5.5) * 0.25 + moff[2]!];
        for (let k = 0; k < 3; k++) { bb.min[k] = Math.min(bb.min[k]!, p[k]!); bb.max[k] = Math.max(bb.max[k]!, p[k]!); }
      }
      const g = eng.subGroups.get(bi)!;
      const roots = (eng.compRoots.get(j.top) ?? []).filter((o) => o.visible);
      const snap = () => ({
        grpP: [g.position.x, g.position.y, g.position.z],
        grpQ: [g.quaternion.w, g.quaternion.x, g.quaternion.y, g.quaternion.z],
        partP: [roots[0]!.position.x, roots[0]!.position.y, roots[0]!.position.z],
        partQ: [roots[0]!.quaternion.w, roots[0]!.quaternion.x, roots[0]!.quaternion.y, roots[0]!.quaternion.z],
      });
      eng.select(j.top);
      const before = snap();
      // the browser's TGC attach keeps gizmoProxy AT the part's pose at
      // gesture start; headless, select() refuses the attach (no TGC
      // instance), so rebase the proxy and drive the SAME three calls
      // gizmoRotateViewDeg makes: captureGesture → premultiply → writeback
      const rp = eng.gizmoProxy;
      rp.quaternion.copy(roots[0]!.quaternion);
      eng.gizmoCi = j.top;
      eng.captureGesture(j.top);
      rp.quaternion.premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 25 * Math.PI / 180));
      eng.gizmoWriteback();
      eng.gizmoCi = -1;
      const after = snap();
      // the clamp's own contract: pivot0 lies INSIDE (or on) the block bbox
      const onPanel = bb.min[0] === Infinity ? 0
        : len([0, 1, 2].map(k => Math.max(bb.min[k]! - j.pivot0[k]! - moff[k]!, 0, j.pivot0[k]! + moff[k]! - bb.max[k]!)));
      const dq = qmul(after.partQ, qconj(before.partQ));
      const predP = add(after.partP, qrot(dq, sub(before.grpP, before.partP)));
      const predQ = qmul(dq, before.grpQ);
      pairs.push({
        bi: bi as number, top: j.top, type: j.mc.type,
        lever: len(sub(j.pivot0.map((v, i) => v + moff[i]!) as number[], j.p0.map((v, i) => v + moff[i]!) as number[])),
        onPanel,
        rideP: len(sub(predP, after.grpP)), rideQ: spinDeg(qmul(predQ, qconj(after.grpQ))),
        panelTravel: len(sub(after.grpP, before.grpP)), partTravel: len(sub(after.partP, before.partP)),
      });
    }
  }
  return pairs;
}

describe('subgrid rides its joint (was subride.spec @subgrid @slow)', () => {
  // THE TRUCK audits fully headless (14 pairs). Jimmy's Adventure STAYS
  // e2e for now: its gantry SmallPivot (sub#6 m#167) clamps pivot0 through
  // the v1.11.8 RIG chain (subBlockBBoxRigs), and the audit's raw-file
  // block bbox misses the rig transform → 1.50 m vs the <0.6 law. P7.1
  // slice 2 (rig-aware audit bbox in the graph layer) retires that leg.
  for (const { id, name } of [
    { id: '3481322297', name: 'Classic American Semi Truck' },
  ]) {
    test(`${name} (${id}): every joint line is on its panel and the panel rides the part`, () => {
      const e = openCraft(id, { atlas: manifestOnly() });   // .ini joints, no gltf fan
      (e as unknown as { setGizmoEnabled(on: boolean): void }).setGizmoEnabled(true);  // the EDIT mode wiring the Editor applies
      const pairs = subrideAudit(e);
      expect(pairs.length, 'the craft has jointed subgrids to audit').toBeGreaterThan(0);
      for (const p of pairs) {
        expect(p.onPanel, `sub#${p.bi} (${p.type} m#${p.top}): the joint line lies on its own panel content (a z-mirrored clamp line floats off it)`)
          .toBeLessThan(0.6);
        expect(p.lever, `sub#${p.bi} (${p.type} m#${p.top}): the joint line belongs to its part (no phantom lever)`)
          .toBeLessThan(3);
        expect(p.rideP, `sub#${p.bi} (${p.type} m#${p.top}): spinning the part keeps the panel rigidly attached (position)`)
          .toBeLessThan(0.02);
        expect(p.rideQ, `sub#${p.bi} (${p.type} m#${p.top}): … and (rotation)`)
          .toBeLessThan(0.5);
        expect(p.panelTravel, `sub#${p.bi}: the panel actually MOVED with the part`).toBeGreaterThan(0);
      }
    }, 120_000);
  }
});
