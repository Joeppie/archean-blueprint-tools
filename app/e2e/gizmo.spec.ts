// gizmo.spec.ts — the P3 gizmo writeback pins (the legacy gizmatest
// philosophy: drive the REAL writeback functions, assert the file/data +
// live-scene consequences; no synthetic TGC pointer fights):
//  • the pivot = centre of the VISIBLE geometry (v0.167: off-origin real
//    geometry spins IN PLACE — the part origin ORBITS the pivot, constant
//    distance),
//  • a spin writes the file quaternion through the display-pose undo and
//    the reverse spin restores it,
//  • translate rides the file position exactly,
//  • the mode widget pops on a deliberate canvas part pick and re-modes,
//  • multi-grip RING continuity (the real-pointer sweep),
//  • subgrid selection carries NO gizmo (v0.170).
//
// v1.12.1 CHAIN LAW: five former tests shared ONE boot (ISW, edit mode,
// the parts list) — they run as ONE chained test over ONE boot, in the
// order attach → spin → translate → mode-widget (+sky close) → the
// mutating ring sweep LAST. Laws assert via expect.soft: a violation
// reports and the chain continues; only the boot/attach gates are hard.
// The two state-wall legs keep their own boots: DOLPHIN (subgrid select)
// and the poisoned-storage context (addInitScript).
import { expect, test, type Page } from '@playwright/test';

const ISW = '3812927875';
const DOLPHIN = '3417786605';

type Eng = {
  gizmoState(): { mode: string; ci: number };
  gizmoPivot(): [number, number, number] | null;
  gizmoRotateViewDeg(a: 'x' | 'y' | 'z', d: number): void;
  gizmoTranslateView(a: 'x' | 'y' | 'z', m: number): void;
  compViewPos(ci: number): { x: number; y: number; z: number } | null;
  select(ci: number): void;
  selectSub(bi: number): void;
  gizmoDragAxis(): string | null;
  ringScreenPoint(axis: 'x' | 'y' | 'z', deg?: number): { x: number; y: number } | null;
  blueprint: { data: { components: { orientation?: Record<string, number> }[] } } | null;
};

// Playwright serialises plain values, not functions — small op dispatcher.
function eng(op: string, arg: Record<string, unknown> = {}): (page: Page) => Promise<unknown> {
  return (page: Page) => page.evaluate(({ op, arg }) => {
    const w = window as unknown as { __ARCHEAN__?: { engine: Eng } };
    const e = w.__ARCHEAN__!.engine;
    const ci = (arg as { ci: number }).ci;
    switch (op) {
      case 'state': return e.gizmoState();
      case 'pivot': return e.gizmoPivot();
      case 'pos': return e.compViewPos(ci);
      case 'quat': return { ...e.blueprint!.data.components[ci].orientation! };
      case 'rot': e.gizmoRotateViewDeg(arg['a'] as 'x' | 'y' | 'z', arg['d'] as number); return null;
      case 'mov': e.gizmoTranslateView(arg['a'] as 'x' | 'y' | 'z', arg['m'] as number); return null;
      case 'sel': e.select(ci!); return null;
      case 'selsub': e.selectSub((arg as { bi: number }).bi); return null;
      case 'axis': return e.gizmoDragAxis();
      case 'ring': return e.ringScreenPoint(arg['a'] as 'x' | 'y' | 'z', (arg['deg'] as number) ?? 0);
    }
    return null;
  }, { op, arg });
}

async function openCraft(page: Page, id: string) {
  await page.goto(`/?craft=${id}`);
  await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
  await page.getByTestId('mode-edit').click();
}
const dist = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

// small quaternion math for the ring-drag continuity pins (file quats are
// plain serialisable objects through the Playwright boundary)
type Q = { w: number; x: number; y: number; z: number };
const qNorm = (q: Q) => Math.hypot(q.w, q.x, q.y, q.z);
const qMul = (a: Q, b: Q): Q => ({
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
});
const qInv = (q: Q): Q => ({ w: q.w, x: -q.x, y: -q.y, z: -q.z });
const qAngle = (q: Q) => 2 * Math.acos(Math.min(1, Math.abs(q.w)));
/** rotate a vector by q (q·v) */
const rotY = (q: Q, v: readonly number[]): number[] => {
  const { w, x, y, z } = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + y * tz - z * ty, v[1] + w * ty + z * tx - x * tz, v[2] + w * tz + x * ty - y * tx];
};

/** select the first part list row matching FILTER; returns its ci */
async function pickPart(page: Page, filter: string): Promise<number> {
  await page.getByTestId('ws-parts').click();   // v1.11: parts list = + Parts
  await page.getByTestId('parts-list').getByTestId('filter').fill(filter);
  const row = page.locator('[data-idx]').first();
  const ci = +(await row.getAttribute('data-idx'))!;
  await row.click();
  return ci;
}

test.describe('gizmo writeback @gizmo @slow', () => {
  const desktopOnly = () => test.skip(test.info().project.name !== 'chromium', 'desktop-only');

  test('the writeback chain: attach, pivot orbit + quat round-trip, translate, mode widget, ring continuity', async ({ page }) => {
    desktopOnly();
    // v1.12.1 chain budget: this ONE boot carries the former five tests'
    // work — the evaluate-per-event ring sweep on the hi-def ISW scene is
    // the heavy part (test.slow'd legs on their own). The chain budget is
    // the SUM of what the legs needed, not one leg's.
    test.setTimeout(280_000);
    await openCraft(page, ISW);

    await test.step('select attaches at the visible-geometry centre; a spin ORBITS the origin about it; the file quat turns and round-trips', async () => {
      const ci = await pickPart(page, 'aileron');
      expect(await eng('state')(page), 'the widget attached to the picked part').toMatchObject({ mode: 'rotate', ci });

      const pivot0 = (await eng('pivot')(page)) as [number, number, number];
      const pos0 = (await eng('pos', { ci })(page)) as { x: number; y: number; z: number };
      const q0 = (await eng('quat', { ci })(page)) as Record<string, number>;
      const view = (p: { x: number; y: number; z: number }) => [p.x, p.y, p.z];   // raw == view (v0.180)
      const r0 = dist(view(pos0), pivot0!);
      expect.soft(r0, 'an aileron origin sits OFF its visible bbox centre (non-vacuous orbit)').toBeGreaterThan(0.05);

      // Spin about a VIEW axis PERPENDICULAR to the lever arm pivot−origin:
      // a spin about an axis PARALLEL to the arm rotates the origin about
      // its own axis — zero displacement (the baked flat-plate aileron put
      // the arm exactly on ŷ, which silently de-vacuated the old hardcoded
      // 'y' spin).
      const arm = view(pos0).map((v, i) => v - pivot0![i]!);
      const ax = (['x', 'y', 'z'] as const)[
        arm[0]! ** 2 <= arm[1]! ** 2 && arm[0]! ** 2 <= arm[2]! ** 2 ? 0
          : arm[1]! ** 2 <= arm[2]! ** 2 ? 1 : 2];

      await eng('rot', { a: ax, d: 30, ci })(page);
      const pivot1 = (await eng('pivot')(page)) as [number, number, number];
      const pos1 = (await eng('pos', { ci })(page)) as { x: number; y: number; z: number };
      const q1 = (await eng('quat', { ci })(page)) as Record<string, number>;
      expect.soft(dist(view(pos1), pivot1), 'origin orbits the pivot at constant radius').toBeCloseTo(r0, 6);
      expect.soft(dist(view(pos1), view(pos0)), 'the origin actually MOVED').toBeGreaterThan(0.3 * r0);
      const dot = ['w', 'x', 'y', 'z'].reduce((s, k) => s + q1[k]! * q0[k]!, 0);
      expect.soft(dot, 'the saved quaternion turned').toBeLessThan(0.999);

      await eng('rot', { a: ax, d: -30, ci })(page);
      const pos2 = (await eng('pos', { ci })(page)) as { x: number; y: number; z: number };
      const q2 = (await eng('quat', { ci })(page)) as Record<string, number>;
      for (const k of ['x', 'y', 'z'] as const)
        expect.soft(pos2[k], `origin ${k} restored`).toBeCloseTo(pos0[k], 6);
      for (const k of ['w', 'x', 'y', 'z'])
        expect.soft(q2[k], `quat ${k} restored`).toBeCloseTo(q0[k]!, 9);
    });

    await test.step('translate rides the file position exactly', async () => {
      const ci = await pickPart(page, 'pilotseat');
      const p0 = (await eng('pos', { ci })(page)) as { x: number; y: number; z: number };
      await eng('mov', { a: 'x', m: 0.5, ci })(page);
      const p1 = (await eng('pos', { ci })(page)) as { x: number; y: number; z: number };
      expect.soft(p1.x, 'x rides +0.5').toBeCloseTo(p0.x + 0.5, 9);
      expect.soft(p1.y, 'y untouched').toBeCloseTo(p0.y, 9);
      await eng('mov', { a: 'x', m: -0.5, ci })(page);
      const p2 = (await eng('pos', { ci })(page)) as { x: number; y: number; z: number };
      expect.soft(p2.x, 'restore lands exactly').toBeCloseTo(p0.x, 9);
    });

    await test.step('the mode widget pops on a canvas part pick and re-modes the gizmo', async () => {
      const canvas = page.getByTestId('canvas');
      const box = (await canvas.boundingBox())!;
      // v1.10.6: PROBE a comp pixel (pickCell — the click's picker; the
      // widget opens on the comp AND block branches) instead of fixed
      // center ±8% offsets: canvas fractions are not aspect-stable.
      let spot: { x: number; y: number } | null = null;
      for (let i = 0; i < 30 && !spot; i++) {
        spot = await page.evaluate(() => {
          const c = document.querySelector('canvas')!;
          const r = c.getBoundingClientRect();
          const e = (window as unknown as { __ARCHEAN__?: { engine: { pendingReal: number;
            pickCell: (x: number, y: number) => { kind: string; ci: number; bi: number } | null } } }).__ARCHEAN__!.engine;
          if (e.pendingReal > 0) return null;
          for (let fy = 0.25; fy <= 0.85; fy += 0.03)
            for (let fx = 0.2; fx <= 0.8; fx += 0.03) {
              const h = e.pickCell(r.left + r.width * fx, r.top + r.height * fy);
              if (h && ((h.kind === 'comp' && h.ci >= 0) || h.bi >= 0)) return { x: fx, y: fy };
            }
          return null;
        });
        if (!spot) await page.waitForTimeout(300);
      }
      expect(spot, 'a part/block surface answers the pickCell click path').not.toBeNull();   // hard gate: the clicks below need it
      let picked = false;
      for (const [jx, jy] of [[0, 0], [0.004, 0.004], [-0.004, 0]]) {
        await canvas.click({ position: { x: box.width * (spot!.x + jx), y: box.height * (spot!.y + jy) } });
        if (await page.getByTestId('modebox').isVisible().catch(() => false)) { picked = true; break; }
      }
      expect.soft(picked, 'a deliberate canvas tap on the craft pops the mode widget').toBe(true);
      await page.getByTestId('mode-translate').click();
      expect.soft(((await eng('state')(page)) as { mode: string }).mode).toBe('translate');
      await page.getByTestId('mode-off').click();
      expect.soft(((await eng('state')(page)) as { mode: string }).mode).toBe('off');
      await page.getByTestId('mode-rotate').click();
      expect.soft(((await eng('state')(page)) as { mode: string }).mode).toBe('rotate');
      // close the widget + deselect with a SKY click (KNOWN ISSUE 12: an
      // open modebox shields the canvas the ring sweep aims at)
      await canvas.click({ position: { x: 4, y: 4 } });
      await expect(page.getByTestId('modebox')).toBeHidden();
    });

    await test.step('multi-grip RING drags keep spinning in unison (real pointer; the mutating step LAST)', async () => {
      const ci = await pickPart(page, 'aileron');
      const qGet = async () => (await eng('quat', { ci })(page)) as Q;
      const ring = async (deg: number) => (await eng('ring', { a: 'y', deg, ci })(page)) as { x: number; y: number } | null;

      // one REAL-pointer grip: aim the drawn Y ring, sweep `arc`° along the
      // circle frozen from the pose AT PRESS, sampling the FILE quaternion
      // every event (the shipped TGC writeback path, no synthetic shortcuts).
      const grip = async (arc: number) => {
        const p0 = await ring(0);
        if (!p0) { expect.soft(p0, 'a Y-ring grab point exists').not.toBeNull(); return null; }
        const path: { x: number; y: number }[] = [];
        for (let i = 1; i <= 10; i++) path.push((await ring(arc * i / 10))!);
        await page.mouse.move(p0.x, p0.y);
        await page.mouse.down();
        let prev = await qGet();
        let axis: string | null = null;
        const steps: number[] = [], signs: number[] = [];
        for (const p of path) {
          await page.mouse.move(p.x, p.y);
          if (axis === null) axis = (await eng('axis')(page)) as string | null;
          const q = await qGet();
          const d = qMul(q, qInv(prev));
          steps.push(qAngle(d));
          const n = rotY(prev, [0, 1, 0]);           // the part's LIVE local ŷ
          signs.push(Math.sign(d.x * n[0] + d.y * n[1] + d.z * n[2]));
          prev = q;
        }
        await page.mouse.up();
        return { axis, steps, signs, end: prev };
      };

      const q0 = await qGet();
      const g1 = await grip(38);
      if (g1) {
        expect.soft(g1.axis, 'the grip landed on the Y ring').toBe('Y');
        const a1 = qMul(g1.end, qInv(q0));
        expect.soft(qAngle(a1), 'grip 1 turned the part').toBeGreaterThan(0.05);
        expect.soft(Math.max(...g1.steps), 'no per-event pose pop').toBeLessThan(0.6);
        const s1 = g1.signs.find(s => s !== 0) ?? 0;
        expect.soft(s1, 'grip 1 actually spun (non-vacuous)').not.toBe(0);
        expect.soft(g1.signs.filter(s => s !== 0).every(s => s === s1), 'grip 1: one rotation direction').toBe(true);

        // re-grip: the grab point is recomputed from the ring's CURRENT
        // (rotated) pose — landing there and STILL picking 'Y' proves the
        // drawn ring plane followed the live pose (the v0.163
        // mouseDown-rebase contract)
        const g2 = await grip(38);
        if (g2) {
          expect.soft(g2.axis, 're-grip lands on the MOVED Y ring: the handle plane follows the live pose').toBe('Y');
          const a2 = qMul(g2.end, qInv(g1.end));
          expect.soft(qAngle(a2), 'grip 2 keeps spinning from wherever the part now is').toBeGreaterThan(0.05);
          expect.soft(a2.x * a1.x + a2.y * a1.y + a2.z * a1.z, 'grip 2 continues in the SAME direction').toBeGreaterThan(0);
          expect.soft(Math.abs(qNorm(g2.end) - 1), 'the file quaternion stays a unit quat (no multi-rotation noise)').toBeLessThan(1e-6);
          const n2 = g2.signs.find(s => s !== 0) ?? 0;
          expect.soft(g2.signs.filter(s => s !== 0).every(s => s === n2), 'grip 2: one rotation direction').toBe(true);
          expect.soft(n2, 'both grips spin the same way').toBe(s1);
        }
      }
    });
  });

  test('subgrid selection carries NO gizmo (v0.170: they ride their masters)', async ({ page }) => {
    desktopOnly();
    await openCraft(page, DOLPHIN);   // state wall: a different craft
    await page.getByTestId('ws-parts').click();   // v1.11: parts list = + Parts
    await page.getByTestId('parts-list').getByTestId('filter').fill('seat');
    await page.locator('[data-idx]').first().click();
    expect(((await eng('state')(page)) as { ci: number }).ci).toBeGreaterThanOrEqual(0);
    await eng('selsub', { bi: 4 })(page);
    expect(await eng('state')(page)).toMatchObject({ mode: 'off', ci: -1, shown: false });
  });

  // v1.5.1 user report: "GIZMO DOES NOT SHOW FOR EITHER BLOCKS OR COMPONENTS"
  // — TWO persistence traps: (a) the modebox ⊘ persisted gizmo-mode 'off',
  // and (b) the VIEW-MODE GATE persisted the ⚙ master 'archean-app-gizmo'
  // = '0' — closing a tab in View poisoned EVERY later session with a dead
  // gizmo while the mode popup kept showing (exactly what the user saw).
  // Both keys are now session-only: a fresh load lands with a VISIBLE
  // widget no matter what old storage says (the legacy keys are deleted).
  test('persisted ⊘ + poisoned ⚙ master never trap a fresh session — the gizmo shows again', async ({ page }) => {
    desktopOnly();   // state wall: addInitScript needs its own context
    await page.addInitScript(() => {
      localStorage.setItem('archean-app-gizmo-mode', 'off');
      localStorage.setItem('archean-app-gizmo', '0');
    });
    await page.goto(`/?craft=${ISW}`);
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
    await page.getByTestId('mode-edit').click();
    await page.evaluate(() => {
      const w = window as unknown as { __ARCHEAN__?: { engine: {
        blueprint: { data: { components: { type: string }[] } }; select: (ci: number) => void } } };
      const e = w.__ARCHEAN__!.engine;
      e.select(e.blueprint.data.components.findIndex((c) => c.type !== 'Build'));
    });
    const st = await page.evaluate(() => (window as unknown as {
      __ARCHEAN__?: { engine: { gizmoState: () => { mode: string; shown: boolean } } } }
    ).__ARCHEAN__!.engine.gizmoState());
    expect(st.mode, 'a persisted off is healed to the rotate default on load').toBe('rotate');
    expect(st.shown, 'the component widget is ON-SCREEN despite the persisted ⊘').toBe(true);
  });
});
