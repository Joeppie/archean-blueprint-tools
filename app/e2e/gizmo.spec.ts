// gizmo.spec.ts — the P3 gizmo writeback pins (the legacy gizmatest
// philosophy: drive the REAL writeback functions, assert the file/data +
// live-scene consequences; no synthetic TGC pointer fights):
//  • the pivot = centre of the VISIBLE geometry (v0.167: off-origin real
//    geometry spins IN PLACE — the part origin ORBITS the pivot, constant
//    distance),
//  • a spin writes the file quaternion through the display-pose undo and
//    the reverse spin restores it,
//  • translate rides the file position exactly,
//  • subgrid selection carries NO gizmo (v0.170),
//  • the mode widget pops on a deliberate canvas part pick.
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

test.describe('gizmo writeback', () => {
  const desktopOnly = () => test.skip(test.info().project.name !== 'chromium', 'desktop-only');

  test('select attaches at the visible-geometry centre; a spin ORBITS the origin about it and saves an exact quat', async ({ page }) => {
    desktopOnly();
    await openCraft(page, ISW);
    await page.getByTestId('filter').fill('aileron');
    const row = page.locator('[data-idx]').first();
    const ci = +(await row.getAttribute('data-idx'))!;
    await row.click();

    expect(await eng('state')(page)).toEqual({ mode: 'rotate', ci });

    const pivot0 = (await eng('pivot')(page)) as [number, number, number];
    const pos0 = (await eng("pos", { ci })(page)) as { x: number; y: number; z: number };
    const q0 = (await eng('quat', { ci })(page)) as Record<string, number>;
    const view = (p: { x: number; y: number; z: number }) => [p.x, p.y, p.z];   // raw == view (v0.180)
    const r0 = dist(view(pos0), pivot0!);
    expect(r0, 'an aileron origin sits OFF its visible bbox centre (non-vacuous orbit)').toBeGreaterThan(0.05);

    await eng('rot', { a: 'y', d: 30, ci })(page);
    const pivot1 = (await eng('pivot')(page)) as [number, number, number];
    const pos1 = (await eng("pos", { ci })(page)) as { x: number; y: number; z: number };
    const q1 = (await eng('quat', { ci })(page)) as Record<string, number>;
    expect(dist(view(pos1), pivot1), 'origin orbits the pivot at constant radius').toBeCloseTo(r0, 6);
    expect(dist(view(pos1), view(pos0)), 'the origin actually MOVED').toBeGreaterThan(0.01);
    const dot = ['w', 'x', 'y', 'z'].reduce((s, k) => s + q1[k]! * q0[k]!, 0);
    expect(dot, 'the saved quaternion turned').toBeLessThan(0.999);

    await eng('rot', { a: 'y', d: -30, ci })(page);
    const pos2 = (await eng("pos", { ci })(page)) as { x: number; y: number; z: number };
    const q2 = (await eng('quat', { ci })(page)) as Record<string, number>;
    for (const k of ['x', 'y', 'z'] as const) expect(pos2[k]).toBeCloseTo(pos0[k], 6);
    for (const k of ['w', 'x', 'y', 'z']) expect(q2[k]).toBeCloseTo(q0[k]!, 9);
  });

  test('translate rides the file position exactly', async ({ page }) => {
    desktopOnly();
    await openCraft(page, ISW);
    await page.getByTestId('filter').fill('pilotseat');
    const row = page.locator('[data-idx]').first();
    const ci = +(await row.getAttribute('data-idx'))!;
    await row.click();
    const p0 = (await eng("pos", { ci })(page)) as { x: number; y: number; z: number };
    await eng('mov', { a: 'x', m: 0.5, ci })(page);
    const p1 = (await eng("pos", { ci })(page)) as { x: number; y: number; z: number };
    expect(p1.x).toBeCloseTo(p0.x + 0.5, 9);
    expect(p1.y).toBeCloseTo(p0.y, 9);
    await eng('mov', { a: 'x', m: -0.5, ci })(page);
    const p2 = (await eng("pos", { ci })(page)) as { x: number; y: number; z: number };
    expect(p2.x).toBeCloseTo(p0.x, 9);
  });

  test('subgrid selection carries NO gizmo (v0.170: they ride their masters)', async ({ page }) => {
    desktopOnly();
    await openCraft(page, DOLPHIN);
    await page.getByTestId('filter').fill('seat');
    await page.locator('[data-idx]').first().click();
    expect(((await eng('state')(page)) as { ci: number }).ci).toBeGreaterThanOrEqual(0);
    await eng('selsub', { bi: 4 })(page);
    expect(await eng('state')(page)).toEqual({ mode: 'off', ci: -1 });
  });

  test('the mode widget pops on a canvas part pick and re-modes the gizmo', async ({ page }) => {
    desktopOnly();
    await openCraft(page, ISW);
    const canvas = page.getByTestId('canvas');
    const box = (await canvas.boundingBox())!;
    const pts = [[0, 0], [0.08, 0], [-0.08, 0], [0, 0.08], [0, -0.08], [0.16, 0.05]];
    let picked = false;
    for (const [dx, dy] of pts) {
      await canvas.click({ position: { x: box.width / 2 + dx * box.width, y: box.height / 2 + dy * box.height } });
      if (await page.getByTestId('modebox').isVisible().catch(() => false)) { picked = true; break; }
    }
    expect(picked, 'a deliberate canvas tap on the craft pops the mode widget').toBe(true);
    await page.getByTestId('mode-translate').click();
    expect(((await eng('state')(page)) as { mode: string }).mode).toBe('translate');
    await page.getByTestId('mode-off').click();
    expect(((await eng('state')(page)) as { mode: string }).mode).toBe('off');
    await page.getByTestId('mode-rotate').click();
    expect(((await eng('state')(page)) as { mode: string }).mode).toBe('rotate');
  });
});
