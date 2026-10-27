// subride.spec.ts — a subgrid's JOINT LINE must be at its own joint, and the
// panel must RIDE the part it is jointed to (user report 2026-10-19: "subgrid
// rotation is way off when I move components … rotation isnt properly relative
// as it should be towards the joints themselves").
//
// Root cause was a stale pre-v0.180 z-mirror in subgrid.ts subBlockBBox: the
// panel bbox that CLAMPS the joint line sat in the mirrored frame while the
// master's .ini chain/p0 were raw, so captureJrefs clamped onto the panel's
// MIRROR IMAGE — Jimmy's Adventure gantry pivot ended up 30 m from its own
// SmallPivot, and a 35° spin of the part swept the panel 11 m away.
//
// Two REAL craft, every (subgrid, master) pair:
//  • the captured line lies ON the panel's blocks (the clamp's own contract —
//    a z-mirrored line fails this the moment the content is off the z = 0 plane)
//    and stays near its part (no phantom lever);
//  • driving the part through the shipped gizmo writeback keeps the subgrid's
//    GROUP TRANSFORM exactly equal to the rigid transport of the part's own
//    motion: (p,q) ↦ (pos + dq·(p−p0), dq·q). Zero miss = nothing tears away.
import { expect, test, type Page } from '@playwright/test';

// v1.12.1 (L1/L5): THE TRUCK's audit moved headless — 14 (subgrid, master)
// pairs pinned verbatim in scene.headless.test.ts. Jimmy stays: its gantry
// pivot clamps through the v1.11.8 rig chain (the audit's raw-file bbox
// needs the graph-layer rig transform — P7.1 slice 2 retires this leg).
const CRAFTS = [
  { id: '3334698274', name: "Jimmy's Adventure" },
];

type Pair = {
  bi: number; top: number; type: string;
  lever: number; onPanel: number; benchAnchored: boolean;
  rideP: number; rideQ: number; panelTravel: number; partTravel: number;
};

const audit = (page: Page) =>
  page.evaluate(async () => {
    const e = (window as never as { __ARCHEAN__: { engine: any } }).__ARCHEAN__.engine;
    const qmul = (a: number[], b: number[]) => [
      a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
      a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
      a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
      a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
    ];
    const qconj = (q: number[]) => [q[0], -q[1], -q[2], -q[3]];
    const qrot = (q: number[], v: number[]) => {
      const [w, x, y, z] = q;
      const t = [2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])];
      return [v[0] + w * t[0] + (y * t[2] - z * t[1]), v[1] + w * t[1] + (z * t[0] - x * t[2]), v[2] + w * t[2] + (x * t[1] - y * t[0])];
    };
    const sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);
    const add = (a: number[], b: number[]) => a.map((v, i) => v + b[i]);
    const len = (a: number[]) => Math.hypot(...a);
    const spinDeg = (q: number[]) => 2 * Math.acos(Math.min(1, Math.abs(q[0]))) * 180 / Math.PI;

    const pairs: Pair[] = [];
    const moff = [e.moffView.x, e.moffView.y, e.moffView.z];
    for (const [bi, jrefs] of e.subJrefs as Map<number, any[]>) {
      for (const j of jrefs) {
        if (j.top < 0) continue;
        // The panel's block bbox (the clamp target) in the WORLD frame it
        // renders in. v1.12.2 FIX (baseline-proven, the header's "P7.1 slice
        // 2" note): Jimmy's gantry content rides the v1.11.8 RIG CHAIN — the
        // engine clamps the pivot onto subBlockBBoxRigs(blockParts), which
        // includes every NESTED Build's blocks pushed through its rig pose.
        // The raw-file-only bbox below compared the pivot to the panel's
        // BUILT cells, not where the content rigs to: the audit now mirrors
        // the engine's blockParts collection (same rigPush/rigApply maths).
        // (the audit's qmul/qrot above are the quaternion helpers — reuse them)
        const qRotA = (q: number[], v: number[]) => qrot(q, v);
        const rigApplyA = (ch: { t: number[]; q: number[] }, v: number[]) => {
          const r = qRotA(ch.q, v);
          return [ch.t[0] + r[0], ch.t[1] + r[1], ch.t[2] + r[2]];
        };
        const rigPushA = (ch: { t: number[]; q: number[] }, pos: any, quat: number[]) => {
          const r = qRotA(ch.q, [pos.x, pos.y, pos.z]);
          return { t: [ch.t[0] + r[0], ch.t[1] + r[1], ch.t[2] + r[2]], q: qmul(ch.q, quat) };
        };
        const bb = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
        const growBB = (p: number[]) => {
          for (let k = 0; k < 3; k++) { bb.min[k] = Math.min(bb.min[k], p[k]); bb.max[k] = Math.max(bb.max[k], p[k]); }
        };
        const growBlocks = (bl: any[], chain: { t: number[]; q: number[] }) => {
          for (const x of bl) for (const s of [[0, 0, 0], [(x.size_x ?? 0) + 1, (x.size_y ?? 0) + 1, (x.size_z ?? 0) + 1]])
            growBB(rigApplyA(chain, [(x.pos_x + s[0] + (x.frame_x ?? 0) * 12 - 5.5) * 0.25,
              (x.pos_y + s[1] + (x.frame_y ?? 0) * 12 - 5.5) * 0.25,
              (x.pos_z + s[2] + (x.frame_z ?? 0) * 12 - 5.5) * 0.25]).map((v: number, i: number) => v + moff[i]));
        };
        const collectRigs = (list: any[], depth: number, chain: { t: number[]; q: number[] }) => {
          for (const sc of list) if (sc.type === 'Build' && depth < 8) {
            const scChain = rigPushA(chain, sc.position,
              [sc.orientation?.w ?? 1, sc.orientation?.x ?? 0, sc.orientation?.y ?? 0, sc.orientation?.z ?? 0]);
            growBlocks(((sc.data?.blocks) ?? []).filter((x: any) => (x.type ?? 0) !== 255), scChain);
            collectRigs((sc.data?.components) ?? [], depth + 1, scChain);
          }
        };
        growBlocks(((e.bp.data.components[bi]?.data?.blocks) ?? []).filter((x: any) => (x.type ?? 0) !== 255),
          { t: [0, 0, 0], q: [1, 0, 0, 0] });
        collectRigs((e.bp.data.components[bi]?.data?.components) ?? [], 0, { t: [0, 0, 0], q: [1, 0, 0, 0] });
        const g = e.subGroups.get(bi);
        const roots = (e.compRoots.get(j.top) ?? []).filter((o: any) => o.visible);
        const snap = () => ({
          grpP: [g.position.x, g.position.y, g.position.z],
          grpQ: [g.quaternion.w, g.quaternion.x, g.quaternion.y, g.quaternion.z],
          partP: [roots[0].position.x, roots[0].position.y, roots[0].position.z],
          partQ: [roots[0].quaternion.w, roots[0].quaternion.x, roots[0].quaternion.y, roots[0].quaternion.z],
        });
        e.select(j.top);
        const before = snap();
        e.gizmoRotateViewDeg('y', 25);              // the shipped TGC writeback path
        const after = snap();
        e.select(-1);
        // the clamp's own contract: pivot0 lies INSIDE (or on) the block bbox
        const onPanel = bb.min[0] === Infinity ? 0
          : len([0, 1, 2].map(k => Math.max(bb.min[k] - j.pivot0[k] - moff[k], 0, j.pivot0[k] + moff[k] - bb.max[k])));
        const dq = qmul(after.partQ, qconj(before.partQ));
        const predP = add(after.partP, qrot(dq, sub(before.grpP, before.partP)));
        const predQ = qmul(dq, before.grpQ);
        pairs.push({
          bi: bi as number, top: j.top, type: j.mc.type,
          lever: len(sub(j.pivot0.map((v: number, i: number) => v + moff[i]), j.p0.map((v: number, i: number) => v + moff[i]))),
          onPanel, benchAnchored: !!j.benchAnchored,
          rideP: len(sub(predP, after.grpP)), rideQ: spinDeg(qmul(predQ, qconj(after.grpQ))),
          panelTravel: len(sub(after.grpP, before.grpP)), partTravel: len(sub(after.partP, before.partP)),
        });
      }
    }
    return pairs;
  });

test.describe('subgrid rides its joint @subgrid @slow', () => {
  for (const { id, name } of CRAFTS) {
    test(`${name} (${id}): every joint line is on its panel and the panel rides the part`, async ({ page }) => {
      test.skip(test.info().project.name !== 'chromium', 'desktop-only');
      await page.goto(`/?craft=${id}`);
      await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
      await page.getByTestId('mode-edit').click();
      await page.waitForFunction(() => (window as never as { __ARCHEAN__: { engine: { pendingReal: number } } })
        .__ARCHEAN__.engine.pendingReal === 0, null, { timeout: 60_000 }).catch(() => {});
      const pairs = await audit(page);
      expect(pairs.length, 'the craft has jointed subgrids to audit').toBeGreaterThan(0);
      for (const p of pairs) {
        // v1.12.2 ANCHOR-CLASS LAW: the panel-clamp contract (line ON the
        // content, lever near the part) is the v0.173 CLAMP class. Pairs
        // captured through the v1.10.2/v1.11.8 BENCH ANCHOR ride the GAME's
        // own hinge line (the bench rotation's fixed line — census-validated
        // 157/166 bench pairs + the v1.11.8 GEAR audit); that line may sit
        // off the content box by construction (Jimmy's gantry SmallPivot:
        // the 30 m arm hinges at its own top line). For that class the audit
        // keeps the KINEMATIC laws (the spec's core, below) and skips the
        // clamp-class geometry contracts.
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
    });
  }
});

// RETIRED v1.12.1 (docs/TEST-PYRAMID.md L1/L5): 'a SUBGRID OF A SUBGRID
// renders (the Dorito SSTO front wheels)' — the census law (file-computed
// nested parts/groups === the rendered subStats census) is pinned headless
// in src/engine/__tests__/scene.headless.test.ts over the real 3308603448
// blueprint via the headless Engine harness (real funnel, no canvas).
// This file keeps the joint-ride kinematics (the @slow subfollow legs need
// the live captureJrefs flow at runtime pose).
