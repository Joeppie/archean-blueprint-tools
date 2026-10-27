// THE HEADLESS PROBE TIER (docs/TEST-PYRAMID.md Phase 1, v1.12.1): the
// "does it RENDER in the right place" class, on plain node — the real
// Engine, the real open funnel, the real testdata crafts, the real model
// atlas from disk, no canvas (Engine.setVirtualViewport). Every law here
// is transcribed from an e2e spec whose browser cost the law does not
// need; those legs retire in this commit (L5). Pixel laws (surge sprites,
// overlay restore, day-light rig) stay e2e — this file never claims them.
import { describe, expect, test } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { sphereSkinTris } from '../latsphere';
import { diskAtlas, manifestOnly, openCraft, openCraftOpt, virtualControls, withRealModels } from './harness';
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

// ---------------------------------------------------------------------------
// THE CABLE RENDER LAW — ported from pipes.spec (whole spec was pipeInfo()
// probes; the pure maths already lives in pipes.test.ts/sockets.test.ts).
interface PipeInfo {
  pipes: number; segs: number; joints: number; plugs: number; stale: number;
  round: number; square: number; metal: number; kinds: string[];
  style: Record<string, { r: number; g: number; b: number; box: boolean; metal: boolean;
    radius: number; half: number } | undefined>;
  leads: { checked: number; bad: number };
  ends: { a: number[]; b: number[] }[];
  reroute: number; draped: number; polys: number[][][];
}
type PipeEngine = {
  pipeInfo(): PipeInfo;
  blueprint: Blueprint;
  rebuildPipes(): void;
  syncSubJoints(): void;
};
const pipes = (id: string): PipeEngine =>
  (openCraft(id, { atlas: manifestOnly() }) as unknown) as PipeEngine;

describe('cables render like the game and plug into their sockets (was pipes.spec)', () => {
  test('ISW: round hoses, per-kind colours, elbows, plugs — no item ducts', () => {
    const i = pipes('3812927875').pipeInfo();
    expect(i.pipes).toBeGreaterThanOrEqual(20);
    expect(i.square, 'the data bus draws as the thin square species').toBeGreaterThan(0);
    expect(i.round, 'fluid and HV stay round hoses').toBeGreaterThan(0);
    expect(i.round + i.square, 'every bar has exactly one cross-section').toBe(i.segs);
    expect(i.joints, 'elbow spheres close the direction changes').toBeGreaterThan(0);
    expect(i.plugs, 'one black collar per cable end').toBe(2 * i.pipes);
    expect(i.leads.checked, 'plugs with an axial lead exist').toBeGreaterThan(0);
    expect(i.leads.bad, 'every leaded bar touches its connector ALONG the axis').toBe(0);
    expect(i.kinds).toContain('fluid');
    expect(i.style.fluid!.radius).toBeCloseTo(0.045, 4);
    expect(i.style.fluid!.box, 'the fluid hose is ROUND').toBe(false);
    expect(i.style.fluid!.metal, 'ISW fluid cables ride the file chrome flag').toBe(true);
    expect(i.style.fluid!.r, 'the ISW (an older save) writes its hose nearly BLACK').toBeLessThan(0.1);
    expect(i.style.data!.box, 'v1.8.3: data draws square').toBe(true);
    expect(i.style.data!.half, 'v1.8.3: data draws THINNER').toBeLessThan(0.015);
    expect(i.style.data!.b, 'data sheath: the blue channel leads (navy family)')
      .toBeGreaterThan(i.style.data!.r);
  });
  test('truck: the item ducts are the ONLY square species; stale tips re-seat; flex hangs', () => {
    const i = pipes('3481322297').pipeInfo();
    expect(new Set(i.kinds), 'all five cable species on this craft')
      .toEqual(new Set(['data', 'lowvoltage', 'highvoltage', 'fluid', 'item']));
    expect(i.square, 'box-flagged item ducts stay square').toBeGreaterThan(0);
    expect(i.round, 'HV and fluid hoses draw round').toBeGreaterThan(0);
    expect(i.style.item!.box).toBe(true);
    expect(i.style.item!.metal, 'item ducts ride the file metal flag').toBe(true);
    expect(i.style.item!.radius).toBeCloseTo(0.08, 4);
    expect(i.style.item!.half, 'item ducts keep their full section').toBeCloseTo(0.08, 4);
    expect(i.style.data!.box, 'data: square').toBe(true);
    expect(i.style.data!.half, 'data: thinner than its file radius').toBeLessThan(0.015);
    expect(i.style.fluid!.r, 'this craft writes its fluid hoses WHITE').toBeGreaterThan(0.9);
    expect(i.style.fluid!.metal, 'fluid hoses ride the chrome flag into the shiny pass').toBe(true);
    expect(i.style.highvoltage!.box, 'HV cable is round').toBe(false);
    expect(i.style.highvoltage!.r, 'file colour: orange HV cable').toBeGreaterThan(0.9);
    expect(i.stale, 'off-socket cached tips get re-seated').toBeGreaterThan(0);
    expect(i.stale, 'but only a minority of the ends').toBeLessThan(i.pipes);
    expect(i.leads.checked).toBeGreaterThan(0);
    expect(i.leads.bad, 'even the re-seated ones plug ALONG the connector axis').toBe(0);
    expect(i.draped, 'flex pairs hang on this craft').toBeGreaterThanOrEqual(40);
    const dips: number[] = [];
    for (const poly of i.polys) {
      if (poly.length < 4) continue;
      const A = poly[0]!, B = poly[poly.length - 1]!;
      const dx = B[0]! - A[0]!, dz = B[2]! - A[2]!;
      let worst = 0;
      for (let k = 1; k < poly.length - 1; k++) {
        const t = ((poly[k]![0]! - A[0]!) * dx + (poly[k]![2]! - A[2]!) * dz) / (dx * dx + dz * dz || 1);
        worst = Math.max(worst, A[1]! + t * (B[1]! - A[1]!) - poly[k]![1]!);
      }
      dips.push(worst);
    }
    expect(Math.max(...dips), 'a hung cable dips below its chord (sag)').toBeGreaterThan(0.02);
  });
  test('a moved part drags its cable ends back onto the sockets', () => {
    const eng = pipes('3812927875');
    const bp = eng.blueprint;
    const pi = bp.data.pipes!.findIndex((p) => p.type === 'fluid')!;
    const ci = bp.data.pipes![pi]!.a_component;
    const before = eng.pipeInfo().ends[pi]!.a;
    // the game RE-ROUTES at save; the display re-seats cached ends on the
    // live sockets
    bp.data.components[ci]!.position.y += 1.5;
    eng.rebuildPipes();
    const after = eng.pipeInfo().ends[pi]!.a;
    const leads = eng.pipeInfo().leads;
    const seated = eng.pipeInfo().stale;
    bp.data.components[ci]!.position.y -= 1.5;
    eng.rebuildPipes();
    const rest = eng.pipeInfo().ends[pi]!.a;
    const back = eng.pipeInfo().stale;
    const d = (p: number[], q: number[]) => Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!);
    const moved = d([...before], after);
    expect(moved, 'the a-end rides the moved part (+1.5 m in y)').toBeGreaterThan(1.3);
    expect(moved, 'the a-end rides the moved part (+1.5 m in y)').toBeLessThan(1.7);
    expect(d([...before], rest), 'restoring the part restores the cable end').toBeLessThan(1e-6);
    expect(leads.bad, 'the re-seated ends still connect ALONG the connector axis').toBe(0);
    expect(seated, 'the moved (rigid) cable end re-seats on the live socket').toBeGreaterThan(0);
    expect(back, 'restoring the part leaves nothing re-seated behind').toBe(0);
  });
  test('a DOOR HARNESS hangs from the door\u2019s LIVE pose (v1.11.5)', () => {
    const eng = pipes('3803780241');
    const bp = eng.blueprint;
    // the engine's flat order: nested content BEFORE its Build (the
    // `index >= topCount` shortcut is the trap — a rigid top cable)
    const flat: { data?: { angle?: number }; type?: string }[] = [];
    const isNested: boolean[] = [];
    for (const c of bp.data.components) {
      const inner = (c as { data?: { components?: Record<string, never>[] } }).data?.components;
      if (c.type === 'Build' && inner)
        for (const c2 of inner) { flat.push(c2); isNested.push(true); }
      flat.push(c as { data?: { angle?: number }; type?: string }); isNested.push(false);
    }
    const pi = bp.data.pipes!.findIndex((p) =>
      isNested[p.a_component ?? -1] || isNested[p.b_component ?? -1])!;
    const side = (isNested[bp.data.pipes![pi]!.a_component ?? -1] ? 'a' : 'b') as 'a' | 'b';
    const end = () => eng.pipeInfo().ends[pi]![side];
    const d = (p: number[], q: number[]) =>
      Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!);
    const before = end();
    let moved = 0, leadsBad = -1, restored = 1;
    for (const j of bp.data.composite_builds ?? []) {
      const m = flat[j.component] as { data?: { angle?: number } } | undefined;
      if (typeof m?.data?.angle !== 'number') continue;
      const a0 = m.data.angle;
      m.data.angle = a0 + 40;                            // swing the door
      eng.syncSubJoints();
      eng.rebuildPipes();
      const dd = d(before, end());
      if (dd > 0.15) {
        moved = dd;
        leadsBad = eng.pipeInfo().leads.bad;
        m.data.angle = a0;
        eng.syncSubJoints();
        eng.rebuildPipes();
        restored = d(before, end());
        break;
      }
      m.data.angle = a0;
    }
    expect(pi, 'the craft has cables into its subgrid parts').toBeGreaterThanOrEqual(0);
    expect(eng.pipeInfo().draped, 'the harness runs hang (flex pairs)').toBeGreaterThan(0);
    expect(moved, 'the harness end rides the swung door').toBeGreaterThan(0.15);
    expect(leadsBad, 'it plugs ALONG the moved connector axis').toBe(0);
    expect(restored, 'closing the door restores the harness exactly').toBeLessThan(1e-6);
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
// (subgrid, master) pair audit runs on the headless Engine. v1.12.4 (P7.1
// slice 2): the panel bbox mirrors the ENGINE's blockParts collection —
// every NESTED Build's blocks pushed through its v1.11.8 rig pose (the e2e
// audit's rigApplyA/rigPushA maths) — and the JRef's `benchAnchored` flag
// carries the v1.12.2 ANCHOR-CLASS LAW; Jimmy's last e2e leg retired (L5).
type Pair = {
  bi: number; top: number; type: string;
  lever: number; onPanel: number; benchAnchored: boolean;
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
    subJrefs: Map<number, {
      top: number; pivot0: number[]; p0: number[]; benchAnchored?: boolean; mc: { type: string };
    }[]>;
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
  // the rig maths of the engine's blockParts collection (subgrid.ts
  // rigPush/rigApply — the e2e audit's rigApplyA/rigPushA, verbatim)
  type Chain = { t: number[]; q: number[] };
  const rigApply = (ch: Chain, v: number[]) => {
    const r = qrot(ch.q, v);
    return [ch.t[0]! + r[0]!, ch.t[1]! + r[1]!, ch.t[2]! + r[2]!];
  };
  const rigPush = (ch: Chain, pos: { x: number; y: number; z: number }, quat: number[]) => {
    const r = qrot(ch.q, [pos.x, pos.y, pos.z]);
    return { t: [ch.t[0]! + r[0]!, ch.t[1]! + r[1]!, ch.t[2]! + r[2]!], q: qmul(ch.q, quat) };
  };
  type Blk = { type?: number; pos_x: number; pos_y: number; pos_z: number;
    size_x?: number; size_y?: number; size_z?: number;
    frame_x?: number; frame_y?: number; frame_z?: number };
  // The panel's block bbox (the clamp target) in the WORLD frame it renders
  // in — the RIG-AWARE version (P7.1 slice 2): the subgrid's own blocks at
  // identity PLUS every NESTED Build's blocks pushed through its rig pose
  // (Jimmy's gantry content rides rigs; the raw-file bbox compares the BUILT
  // cells, not where the content rigs to — the 1.50 m vs < 0.6 m false red
  // the e2e leg's header documented). Mirrors subBlockBBoxRigs(blockParts).
  const panelBBox = (bi: number) => {
    const bb = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    const growBB = (p: number[]) => {
      for (let k = 0; k < 3; k++) { bb.min[k] = Math.min(bb.min[k]!, p[k]!); bb.max[k] = Math.max(bb.max[k]!, p[k]!); }
    };
    const growBlocks = (bl: Blk[], chain: Chain) => {
      for (const x of bl) for (const s of [[0, 0, 0], [(x.size_x ?? 0) + 1, (x.size_y ?? 0) + 1, (x.size_z ?? 0) + 1]])
        growBB(rigApply(chain, [(x.pos_x + s[0]! + (x.frame_x ?? 0) * 12 - 5.5) * 0.25,
          (x.pos_y + s[1]! + (x.frame_y ?? 0) * 12 - 5.5) * 0.25,
          (x.pos_z + s[2]! + (x.frame_z ?? 0) * 12 - 5.5) * 0.25]).map((v, i) => v + moff[i]!));
    };
    const collectRigs = (list: Record<string, any>[], depth: number, chain: Chain) => {
      for (const sc of list) if (sc.type === 'Build' && depth < 8) {
        const scChain = rigPush(chain, sc.position,
          [sc.orientation?.w ?? 1, sc.orientation?.x ?? 0, sc.orientation?.y ?? 0, sc.orientation?.z ?? 0]);
        growBlocks((((sc.data?.blocks) ?? []).filter((x: Blk) => (x.type ?? 0) !== 255)), scChain);
        collectRigs((sc.data?.components) ?? [], depth + 1, scChain);
      }
    };
    const selfData = eng.bp.data.components[bi]?.data as
      { blocks?: Blk[]; components?: Record<string, any>[] } | undefined;
    growBlocks(((selfData?.blocks ?? []).filter((x) => (x.type ?? 0) !== 255)),
      { t: [0, 0, 0], q: [1, 0, 0, 0] });
    collectRigs(selfData?.components ?? [], 0, { t: [0, 0, 0], q: [1, 0, 0, 0] });
    return bb;
  };
  for (const [bi, jrefs] of eng.subJrefs) {
    for (const j of jrefs) {
      if (j.top < 0) continue;
      const bb = panelBBox(bi);
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
        onPanel, benchAnchored: !!j.benchAnchored,
        rideP: len(sub(predP, after.grpP)), rideQ: spinDeg(qmul(predQ, qconj(after.grpQ))),
        panelTravel: len(sub(after.grpP, before.grpP)), partTravel: len(sub(after.partP, before.partP)),
      });
    }
  }
  return pairs;
}

describe('subgrid rides its joint (was subride.spec @subgrid @slow)', () => {
  // THE TRUCK audits fully headless (14 pairs); Jimmy's Adventure joined at
  // v1.12.4 (P7.1 slice 2: the rig-aware bbox above + the ANCHOR-CLASS LAW
  // retire the last e2e leg — the gantry SmallPivot's line is the GAME's
  // bench-fixed line, 1.5 m off the content box BY DESIGN, captured through
  // the v1.11.8 rig chain).
  for (const { id, name } of [
    { id: '3481322297', name: 'Classic American Semi Truck' },
    { id: '3334698274', name: "Jimmy's Adventure" },
  ]) {
    test(`${name} (${id}): every joint line is on its panel and the panel rides the part`, () => {
      const e = openCraft(id, { atlas: manifestOnly() });   // .ini joints, no gltf fan
      (e as unknown as { setGizmoEnabled(on: boolean): void }).setGizmoEnabled(true);  // the EDIT mode wiring the Editor applies
      const pairs = subrideAudit(e);
      expect(pairs.length, 'the craft has jointed subgrids to audit').toBeGreaterThan(0);
      for (const p of pairs) {
        // v1.12.2 ANCHOR-CLASS LAW (retired from the e2e verbatim): pairs
        // captured through the v1.10.2/v1.11.8 BENCH ANCHOR ride the GAME's
        // own hinge line; that line may sit off the content box BY
        // CONSTRUCTION — the clamp contracts are for the clamp class, the
        // KINEMATIC laws below are the guarantee for both.
        if (!p.benchAnchored) {
          expect(p.onPanel, `sub#${p.bi} (${p.type} m#${p.top}): the joint line lies on its own panel content (a z-mirrored clamp line floats off it)`)
            .toBeLessThan(0.6);
          expect(p.lever, `sub#${p.bi} (${p.type} m#${p.top}): the joint line belongs to its part (no phantom lever)`)
            .toBeLessThan(3);
        }
        expect(p.rideP, `sub#${p.bi} (${p.type} m#${p.top}): spinning the part keeps the panel rigidly attached (position)`)
          .toBeLessThan(0.02);
        expect(p.rideQ, `sub#${p.bi} (${p.type} m#${p.top}): … and (rotation)`)
          .toBeLessThan(0.5);
        expect(p.panelTravel, `sub#${p.bi}: the panel actually MOVED with the part`).toBeGreaterThan(0);
      }
    }, 120_000);
  }
});

describe('camera cluster + keepView (was scene.spec + undo.spec, v1.12.5)', () => {
  const dist = (a: [number, number, number], b: [number, number, number]) =>
    Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  test('KSP cluster presets snap the eye to axis views; fit() = the load framing', () => {
    // scene.spec's law verbatim: top/front/side each MOVE the eye > 1 m and
    // cam-fit re-applies the EXACT load framing (the e2e's toEqual(p0)).
    // The eye-snap formulas are Engine math; the passive virtualControls
    // stands in for attach()'s OrbitControls (a target holder here).
    const e = openCraft('3812927875', { atlas: manifestOnly() });
    virtualControls(e);
    const p0 = e.camPos();
    e.viewPreset('top');
    expect(dist(e.camPos(), p0), 'top view moved the eye').toBeGreaterThan(1);
    e.viewPreset('front');
    expect(dist(e.camPos(), p0), 'front view moved the eye').toBeGreaterThan(1);
    e.viewPreset('side');
    expect(dist(e.camPos(), p0), 'side view moved the eye').toBeGreaterThan(1);
    e.viewPreset('fit');
    const pf = e.camPos();
    for (let k = 0; k < 3; k++) expect(pf[k]!).toBeCloseTo(p0[k]!, 6);
  });

  test('load(keepView=true) keeps the eye; a craft swap re-frames (undo v1.5.10 law)', () => {
    // undo.spec 'Ctrl+Z keeps the camera' engine half: the Editor passes
    // keepView=true for undo/redo bp-swaps (applyHistory) and false on a
    // craft swap — the eye drift across an undo must stay < 0.05 m (the
    // e2e bound), the swap re-frames to the exact load framing.
    const e = openCraft('3812927875', { atlas: manifestOnly() });
    virtualControls(e);
    const p0 = e.camPos();
    e.viewPreset('top');
    const p1 = e.camPos();
    expect(dist(p1, p0), 'the orbit-off must be non-vacuous').toBeGreaterThan(0.5);
    const bp = e.blueprint!;
    e.load(bp, null, true);
    expect(dist(e.camPos(), p1), 'undo must not move the camera').toBeLessThan(0.05);
    // a craft swap (keepView false) RE-FRAMES: the eye leaves the preset
    // pose and lands on the load framing (the exact-fit equality is test
    // 1's law; a re-load's fit may see a ~0.01 m settled bbox)
    e.load(bp, null, false);
    const pf = e.camPos();
    expect(dist(pf, p1), 'the swap re-frames the view').toBeGreaterThan(1);
    expect(dist(pf, p0), 'the re-frame is the load framing').toBeLessThan(0.05);
  });
});

describe('placement ghost lattice law (was sphereskin ⟲ e2e, v1.12.5)', () => {
  test('⟲ quarter-turn swaps the skin spans on the lattice; the data rides it', () => {
    // Engine.clusterGhostRotate — the law the ghost label's ⟲ row drives:
    // a +90° world-axis turn about the integer bbox pivot swaps the two
    // perpendicular spans EXACTLY (the lattice stores quarter-turns); the
    // ghost DATA (what ✔ Build writes — paired in tooldoc 'the commit
    // writes the GHOST payload verbatim') carries the turned records.
    const e = openCraft('9000005001', { atlas: manifestOnly() });
    const plan = sphereSkinTris({ rx: 2, ry: 1, rz: 1, profile: 'ellipsoid' },
      { slot: 51, material: 0, smooth: false });
    e.setClusterGhost(null, 0x7dffcf, plan, null);
    const st0 = e.clusterGhostState();
    expect(st0).not.toBeNull();
    expect(st0!.tris).toBe(plan.length);
    const spans = (bb: NonNullable<ReturnType<typeof e.clusterGhostState>>['bb']) =>
      bb![0].map((v, k) => bb![1][k]! - v!);
    const s0 = spans(st0!.bb);
    expect(s0[0], 'rx 2 m: long along x').toBeGreaterThan(s0[2]!);
    expect(e.clusterGhostRotate('y')).toBe(true);
    const st1 = e.clusterGhostState();
    expect(st1!.turns).toBe(1);
    expect(spans(st1!.bb)).toEqual([s0[2], s0[1], s0[0]]);   // exact x ↔ z swap
    // the LIVE data (Build's source) is the turned skin — record count kept
    expect(e.clusterGhostData().triangles.length).toBe(plan.length);
    // a whole-cell drag rides the offset, the spans stay (the big-balloon
    // drag half of the retired leg; area preservation: splitface NEVER-DROPS)
    expect(e.clusterGhostShift([0, 0, 5])).toBe(true);
    const st2 = e.clusterGhostState()!;
    expect(st2.offset).toEqual([0, 0, 5]);
    expect(spans(st2.bb)).toEqual(spans(st1!.bb).map((v, k) => v + ([0, 0, 0][k] as number)));
  });
});

describe('selection surges + label chips (was select.spec, v1.12.5)', () => {
  test('a component selection fires ONE surge per connected pipe and every bolt lands', () => {
    // select.spec's law verbatim (legacy selftest surges=true at the viewer
    // tier): the MAX-DEGREE component of ISW's cable graph; one pulse per
    // connected pipe, each with a real far end, riding only real (≥ 5 cm)
    // runs, ≥ 550 ms, additive + depthTest OFF, a source blip; pumping
    // stepSurges with synthetic time drives every pulse to its arrival
    // (no render pump, no wall-clock race). Deselect clears the board.
    const e = openCraft('3812927875', { atlas: manifestOnly() });
    const pipes = e.blueprint!.data.pipes ?? [];
    const cnt: Record<number, number> = {};
    for (const p of pipes) {
      cnt[p.a_component] = (cnt[p.a_component] ?? 0) + 1;
      cnt[p.b_component] = (cnt[p.b_component] ?? 0) + 1;
    }
    let ci = -1; let deg = 0;
    for (const [k, v] of Object.entries(cnt)) if (v > deg) { ci = +k; deg = v; }
    expect(ci, 'the corpus craft must carry a cable graph').toBeGreaterThan(0);
    e.select(ci);
    const s = e.surgeState();
    expect(s.links, 'the drawn cable graph exists').toBeGreaterThan(0);
    expect(s.surges.length, 'one pulse per connected pipe').toBe(deg);
    for (const p of s.surges) {
      expect(p.to, 'every pulse has a real far component').toBeGreaterThanOrEqual(0);
      expect(p.total, 'pulses only ride real (>= 5 cm) cable runs').toBeGreaterThan(0.05);
      expect(p.dur).toBeGreaterThanOrEqual(550);
    }
    expect(s.additiveNoDepth, 'pulses render additive with depthTest off').toBe(true);
    expect(s.sourceBlip, 'a source blip marks the picked part').toBe(true);
    // pump the pulse clock: exactly one arrival blip per pulse
    const step = (t: number) =>
      (e as unknown as { stepSurges(now: number): void }).stepSurges(t);
    const t0 = performance.now();
    for (let k = 1; k <= 40; k++) step(t0 + k * 200);
    const done = e.surgeState();
    expect(done.surges.length).toBe(0);
    expect(done.arrivals, 'every bolt landed on its far component').toBe(deg);
    // deselect (Esc path = engine.select(-1)) clears everything
    e.select(-1);
    const cleared = e.surgeState();
    expect(cleared.surges.length).toBe(0);
    expect(cleared.flashes).toBe(0);
    expect(cleared.arrivals).toBe(0);
  }, 60_000);

  test('label chips ride INTERACT/aliased parts — opt-in, OFF by default', () => {
    // select.spec's labels law: the census (INTERACT types / aliases), the
    // OFF default, the ⚙ option lighting every chip, chips stable (shown +
    // aliased) while a labelled part moves, and the option off empties it.
    // The checkbox ▸ setOption wiring is pinned at the jsdom tier.
    const e = openCraft('3812927875', { atlas: manifestOnly() });
    const off = e.labelState();
    expect(off.total, 'INTERACT types (dash/button/seat/beacon…) exist').toBeGreaterThan(0);
    expect(off.shown, 'labels OFF by default (legacy user rule)').toBe(0);
    expect(off.on).toBe(false);
    e.setOption('labels', true);
    const on = e.labelState();
    expect(on.on).toBe(true);
    expect(on.shown, 'every label chip becomes visible').toBe(on.total);
    const i = e.blueprint!.data.components.findIndex(c =>
      (c.alias ?? '').trim() || ['PilotSeat', 'Beacon', 'Dashboard'].includes(c.type));
    expect(i).toBeGreaterThanOrEqual(0);
    const y0 = e.blueprint!.data.components[i]!.position.y;
    e.setFilePosAxis(i, 'y', y0 + 1.0);
    const moved = e.labelState();
    expect(moved.shown, 'labels stay visible while the part moves').toBe(moved.total);
    expect(moved.aliased, 'the alias-chip count is stable').toBe(off.aliased);
    e.setFilePosAxis(i, 'y', y0);
    e.setOption('labels', false);
    expect(e.labelState().shown).toBe(0);
  }, 60_000);
});

describe('view-option exclusivity + mirror-axis twin liveness (was views/phoneux, v1.12.5)', () => {
  test('hull ⇄ wireframe stay mutually exclusive through setOption (legacy excl=true)', () => {
    // the engine half of phoneux's 'w key' pin: the KEY wiring is pinned at
    // the jsdom tier (editor.dom), the exclusivity law is right here —
    // lighting the wireframe darkens the hull solids, and vice versa.
    const e = openCraft('3812927875', { atlas: manifestOnly() });
    expect(e.getOptions().hull).toBe(true);
    e.setOption('wire', true);
    expect(e.getOptions().wire).toBe(true);
    expect(e.getOptions().hull, 'a lit wireframe forces the hull OFF').toBe(false);
    e.setOption('hull', true);
    expect(e.getOptions().hull).toBe(true);
    expect(e.getOptions().wire, 'relighting the hull darkens the wireframe').toBe(false);
  });

  test('MIRROR ONE AXIS AT A TIME: twin pairs live on the SESSION axis only', () => {
    // views.spec '⚙ mirror axis' engine law (v1.11.1): ISW's pair propagates
    // under x, goes DORMANT under z, WAKES back on x, and ⊘ OFF disables the
    // session plane entirely (the row wiring + localStorage are pinned at the
    // jsdom tier / by the engine's own persistence).
    const e = openCraft('3812927875', { atlas: manifestOnly() });
    let pairCi = -1;
    for (let i = 0; i < e.blueprint!.data.components.length; i++)
      if (e.twinPairsOf(i).length) { pairCi = i; break; }
    expect(pairCi, 'ISW carries a live twin pair under the default x axis')
      .toBeGreaterThanOrEqual(0);
    e.setMirrorAxis('z');
    expect(e.twinPairsOf(pairCi).length, 'the x pair is DORMANT under session z').toBe(0);
    e.setMirrorAxis('x');
    expect(e.twinPairsOf(pairCi).length, 'switching the axis back WAKES the pair')
      .toBeGreaterThanOrEqual(1);
    e.setMirrorAxis('off');
    expect(e.twinPairsOf(pairCi).length, '⊘ OFF disables the session mirror').toBe(0);
    e.setMirrorAxis('x');
    expect(e.twinPairsOf(pairCi).length, 'the axis is a FULL round-trip home').toBeGreaterThanOrEqual(1);
  });
});

describe('live data edits re-render the part (was liveedit.spec @live, v1.12.5)', () => {
  const spans = (b: Box) => [0, 1, 2].map(a => b.max[a]! - b.min[a]!);

  test('Propeller twist edit grows the generated blade surface immediately (no reload)', async () => {
    // liveedit.spec's law at the engine tier: the MATRIX rest twin
    // (9000001024: 4 blades, r 1.2, twist 0) with its REAL streamed model;
    // data.twist 0 ▸ 10 through liveDataEdit (the panel routes edits here —
    // Inspector wiring pinned at the jsdom tier) rebuilds the generated
    // blade geometry IN PLACE: the disc-normal (smallest) span grows > 0.15 m
    // and the load counter (stats().loads = reload()) never moves.
    const e = openCraft('9000001024', { atlas: diskAtlas() });
    const ci = cIs(e.blueprint!, /^Propeller$/)[0]!;
    await withRealModels(e, [ci]);
    const l0 = (e as unknown as { loadCount: number }).loadCount;
    const b0 = e.compRealBox(ci)!;
    const comp = e.blueprint!.data.components[ci]!;
    (comp.data as Record<string, number>).twist = 10;
    e.liveDataEdit(ci);
    // the live rebuild rides a promise chain the browser flushes in the
    // render loop; headless, await it directly
    await (e as unknown as { liveEdits: Map<number, Promise<void>> }).liveEdits.get(ci);
    const b1 = e.compRealBox(ci)!;
    const s0 = spans(b0).sort((x, y) => x - y);
    const s1 = spans(b1).sort((x, y) => x - y);
    expect(s1[0]! - s0[0]!, `out-of-plane spread grew ${(s1[0]! - s0[0]!).toFixed(2)} m`)
      .toBeGreaterThan(0.15);
    expect((e as unknown as { loadCount: number }).loadCount, 'NO full-scene reload for a data edit')
      .toBe(l0);
  }, 60_000);

  test('Aileron joint-angle deflection rides the live model; transforms stay finite', async () => {
    // the Aileron flap (9000001001 rest twin, flat plate thin in y): the
    // joint-angle edit + liveDataEdit deflects the flap (y-span grows > 0.05)
    // and no NaN matrix/geometry appears in the rebuilt tree (the v0.182
    // quat-backing corruption guard).
    const e = openCraft('9000001001', { atlas: diskAtlas() });
    const ci = cIs(e.blueprint!, /^Aileron$/)[0]!;
    await withRealModels(e, [ci]);
    const l0 = (e as unknown as { loadCount: number }).loadCount;
    const b0 = e.compRealBox(ci)!;
    const comp = e.blueprint!.data.components[ci]!;
    const d = (comp.data ??= {}) as Record<string, number>;
    // the scrub's real end point: 120 px × range(±45°)/400 px ≈ +27°
    d.angle = (d.angle ?? 0) + 27;
    e.liveDataEdit(ci);
    await (e as unknown as { liveEdits: Map<number, Promise<void>> }).liveEdits.get(ci);
    const b1 = e.compRealBox(ci)!;
    const y0 = b0.max[1] - b0.min[1];
    const y1 = b1.max[1] - b1.min[1];
    expect(y1, `flap deflected: y-span ${y1.toFixed(3)} > rest ${y0.toFixed(3)}`)
      .toBeGreaterThan(y0 + 0.05);
    expect((e as unknown as { loadCount: number }).loadCount).toBe(l0);
    // NaN sweep over the part's real tree (the e2e's MW-NaN/GEO-NaN scan)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const roots: any[] = (e as unknown as { compRoots: Map<number, any[]> }).compRoots.get(ci) ?? [];
    const bad: string[] = [];
    for (const r of roots) r.traverse((o: any) => {
      const mw = o.matrixWorld?.elements as number[] | undefined;
      if (mw && !mw.every(Number.isFinite)) bad.push(`MW-NaN ${o.type ?? '?'}`);
      const g = o.geometry as { computeBoundingBox?(): void; boundingBox?: { min?: { x?: number } } } | undefined;
      if (g?.computeBoundingBox) {
        g.computeBoundingBox();
        if (!Number.isFinite(g.boundingBox?.min?.x ?? 0)) bad.push('GEO-NaN');
      }
    });
    expect(bad, 'NaN transforms in the scene').toEqual([]);
  }, 60_000);
});
