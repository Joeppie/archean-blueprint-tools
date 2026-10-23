// CABLE fidelity pins (v1.8.1, user: "the cables for the fluid look quite
// different in game … the gray circles on components that take fluid are the
// ones that it should connect to … round, not square"): round cross-sections
// except the box-flagged item ducts, the file's per-kind colours, and cable
// ENDS that follow a moved part back onto its socket (sockets.ts law — the
// pure corpus proof lives in engine/__tests__/sockets.test.ts; this suite
// pins the RENDERED network through __ARCHEAN__.engine).
import { expect, test, type Page } from '@playwright/test';

const ISW = '3812927875';                    // fluid + data + lv + hv cables
const TRUCK = '3481322297';                  // Classic American Semi: all five kinds

interface PipeInfo {
  pipes: number; segs: number; joints: number; plugs: number; stale: number;
  round: number; square: number; metal: number; kinds: string[];
  style: Record<string, { r: number; g: number; b: number; box: boolean; metal: boolean; radius: number }>;
  leads: { checked: number; bad: number };
  ends: { a: number[]; b: number[] }[];
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
    expect(i.round, 'every drawn bar is a CYLINDER (no item pipes on the ISW)').toBe(i.segs);
    expect(i.square).toBe(0);
    expect(i.joints, 'elbow spheres close the direction changes').toBeGreaterThan(0);
    expect(i.plugs, 'one black collar per cable end').toBe(2 * i.pipes);
    expect(i.leads.checked, 'plugs with an axial lead exist').toBeGreaterThan(0);
    expect(i.leads.bad, 'every leaded bar touches its connector ALONG the axis').toBe(0);
    expect(i.kinds).toContain('fluid');
    expect(i.style.fluid!.radius).toBeCloseTo(0.045, 4);
    expect(i.style.fluid!.box, 'the fluid hose is ROUND').toBe(false);
    expect(i.style.fluid!.metal, 'ISW fluid cables ride the file chrome flag').toBe(true);
    expect(i.style.fluid!.r, 'the ISW (an older save) writes its hose nearly BLACK — the file colour is truth').toBeLessThan(0.1);
    expect(i.style.data!.box, 'data stays its recorded cross-section').toBe(false);
    expect(i.style.data!.b, 'data sheath: the blue channel leads (navy family)').toBeGreaterThan(i.style.data!.r);
  });

  test('truck: the item ducts are the ONLY square species; stale tips re-seat', async ({ page }) => {
    await openCables(page, TRUCK);
    const i = (await info(page))!;
    expect(new Set(i.kinds), 'all five cable species on this craft')
      .toEqual(new Set(['data', 'lowvoltage', 'highvoltage', 'fluid', 'item']));
    expect(i.square, 'box-flagged item ducts stay square').toBeGreaterThan(0);
    expect(i.round, 'HV and fluid are ROUND').toBeGreaterThan(i.square);
    expect(i.style.item!.box).toBe(true);
    expect(i.style.item!.metal, 'item ducts ride the file metal flag').toBe(true);
    expect(i.style.item!.radius).toBeCloseTo(0.08, 4);
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
  });

  test('a moved part drags its cable ends back onto the sockets', async ({ page }) => {
    await openCables(page, ISW);
    const r = await page.evaluate(() => {
      const eng = (window as unknown as { __ARCHEAN__?: { engine: {
        pipeInfo: () => { ends: { a: number[]; b: number[] }[] };
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
      bp.data.components[ci]!.position.y -= 1.5;
      eng.rebuildPipes();
      const rest = eng.pipeInfo().ends[pi]!.a;
      const d = (p: number[], q: readonly number[]) =>
        Math.hypot(p[0] - q[0]!, p[1] - q[1]!, p[2] - q[2]!);
      return { pi, moved: d([...before], after), restored: d([...before], rest), leads };
    });
    expect(r.moved, 'the a-end rides the moved part (+1.5 m in y)').toBeGreaterThan(1.3);
    expect(r.moved, 'the a-end rides the moved part (+1.5 m in y)').toBeLessThan(1.7);
    expect(r.restored, 'restoring the part restores the cable end').toBeLessThan(1e-6);
    expect(r.leads.bad, 'the re-seated ends still connect ALONG the connector axis').toBe(0);
  });
});
