// CABLE fidelity pins (v1.8.1+, user: "the cables for the fluid look quite
// different in game … the gray circles on components that take fluid are the
// ones that it should connect to … round, not square"; v1.8.3: "Data cables
// should be thinner. And less round, item cables square."): round hoses,
// square where the file/kind says so (item ducts, the thin data bus), the
// file's per-kind colours, and cable ENDS that follow a moved part back onto
// its socket (sockets.ts law — the pure corpus proof lives in
// engine/__tests__/sockets.test.ts; this suite pins the RENDERED network
// through __ARCHEAN__.engine).
import { expect, test, type Page } from '@playwright/test';

const ISW = '3812927875';                    // fluid + data + lv + hv cables
const TRUCK = '3481322297';                  // Classic American Semi: all five kinds

interface PipeInfo {
  pipes: number; segs: number; joints: number; plugs: number; stale: number;
  round: number; square: number; metal: number; kinds: string[];
  style: Record<string, { r: number; g: number; b: number; box: boolean; metal: boolean;
    radius: number; half: number }>;
  leads: { checked: number; bad: number };
  ends: { a: number[]; b: number[] }[];
  /** v1.11.3 THE DRAPE LAW: runs re-draped + the drawn polylines */
  reroute: number;
  polys: number[][][];
}
const info = (page: Page) => page.evaluate(() => {
  const h = (window as unknown as {
    __ARCHEAN__?: { engine: { pipeInfo: () => PipeInfo } };
  }).__ARCHEAN__;
  return h ? h.engine.pipeInfo() : null;
});

async function openCables(page: Page, id: string) {
  await page.goto(`/?craft=${id}`);
  await expect.poll(async () => (await info(page))?.pipes, { timeout: 30_000 }).toBeGreaterThan(0);
}

test.describe('cables render like the game and plug into their sockets', () => {
  test('ISW: round hoses, per-kind colours, elbows, plugs — no item ducts', async ({ page }) => {
    await openCables(page, ISW);
    const i = (await info(page))!;
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
    expect(i.style.fluid!.r, 'the ISW (an older save) writes its hose nearly BLACK — the file colour is truth').toBeLessThan(0.1);
    expect(i.style.data!.box, 'v1.8.3: data draws square').toBe(true);
    expect(i.style.data!.half, 'v1.8.3: data draws THINNER').toBeLessThan(0.015);
    expect(i.style.data!.b, 'data sheath: the blue channel leads (navy family)').toBeGreaterThan(i.style.data!.r);
  });

  test('truck: the item ducts are the ONLY square species; stale tips re-seat', async ({ page }) => {
    await openCables(page, TRUCK);
    const i = (await info(page))!;
    expect(new Set(i.kinds), 'all five cable species on this craft')
      .toEqual(new Set(['data', 'lowvoltage', 'highvoltage', 'fluid', 'item']));
    expect(i.square, 'box-flagged item ducts stay square').toBeGreaterThan(0);
    // v1.11.3: re-draped stale runs draw their hung chains per KIND, so
    // the whole-craft round/square AGGREGATE shifts with the drape count —
    // the species law is the per-kind majority style rows below (item
    // square, HV/fluid round), not the raw bar count
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
    // the truck carries the user-moved parts whose cached tips left their
    // sockets (Dashboard/LowVoltageBattery tips 0.2-0.4 m off-axis) — the
    // renderer re-seats those onto the live sockets
    expect(i.stale, 'off-socket cached tips get re-seated').toBeGreaterThan(0);
    expect(i.stale, 'but only a minority of the 750 ends').toBeLessThan(i.pipes);
    expect(i.leads.checked, 'plugs with an axial lead exist').toBeGreaterThan(0);
    expect(i.leads.bad, 'even the re-seated ones plug ALONG the connector axis').toBe(0);
    // v1.11.3 THE DRAPE LAW: those stale runs are re-draped PHYSICALLY —
    // the cable hangs by its rest length between the live sockets
    expect(i.reroute, 'stale runs re-drape by the drape law').toBeGreaterThan(0);
    const dips: number[] = [];
    for (const poly of i.polys as number[][][]) {
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
    expect(Math.max(...dips), 'a hung cable dips below its chord (sag)')
      .toBeGreaterThan(0.02);
  });

  test('a moved part drags its cable ends back onto the sockets', async ({ page }) => {
    await openCables(page, ISW);
    const r = await page.evaluate(() => {
      const eng = (window as unknown as { __ARCHEAN__?: { engine: {
        pipeInfo: () => { ends: { a: number[]; b: number[] }[];
          leads: { checked: number; bad: number }; reroute: number };
        blueprint: { data: { components: { position: { x: number; y: number; z: number } }[];
          pipes?: { type?: string; a_component: number }[] } };
        rebuildPipes: () => void;
      } } }).__ARCHEAN__!.engine;
      const bp = eng.blueprint;
      const pi = bp.data.pipes!.findIndex(p => p.type === 'fluid');
      const ci = bp.data.pipes![pi]!.a_component;
      const before = eng.pipeInfo().ends[pi]!.a;
      // the game's own behaviour on move is RE-ROUTING at save; the editor
      // display instead re-seats the cached ends on the live sockets
      bp.data.components[ci]!.position.y += 1.5;
      eng.rebuildPipes();
      const after = eng.pipeInfo().ends[pi]!.a;
      const leads = eng.pipeInfo().leads;
      const rerouted = eng.pipeInfo().reroute;
      bp.data.components[ci]!.position.y -= 1.5;
      eng.rebuildPipes();
      const rest = eng.pipeInfo().ends[pi]!.a;
      const back = eng.pipeInfo().reroute;
      const d = (p: number[], q: readonly number[]) =>
        Math.hypot(p[0] - q[0]!, p[1] - q[1]!, p[2] - q[2]!);
      return { pi, moved: d([...before], after), restored: d([...before], rest),
        leads, rerouted, back };
    });
    expect(r.moved, 'the a-end rides the moved part (+1.5 m in y)').toBeGreaterThan(1.3);
    expect(r.moved, 'the a-end rides the moved part (+1.5 m in y)').toBeLessThan(1.7);
    expect(r.restored, 'restoring the part restores the cable end').toBeLessThan(1e-6);
    expect(r.leads.bad, 'the re-seated ends still connect ALONG the connector axis').toBe(0);
    expect(r.rerouted, 'v1.11.3: the moved part re-drapes its cables (they FOLLOW the connection)')
      .toBeGreaterThan(0);
    expect(r.back, 'restoring the part restores the recorded routes (no drape left behind)')
      .toBe(0);
  });
});
