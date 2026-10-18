// sym.spec.ts — the ⇄ twin-propagation pins through the REAL write paths:
//  • a slider position edit moves the mirrored twin by the flipped delta
//    (x pair → −dx) and the twin co-selects with its own golden box,
//  • a rotation edit turns the twin's FILE quaternion (mirror-twin motion),
//  • drift > 5 cm auto-disables, restoring the pair revives it (v0.166),
//  • a joint-angle slider moves BOTH twin masters in unison and ⟲ restores
//    the pair (v0.176, XYQ twin doors authored 24.3°/24.3°),
//  • the mirror-plane option round-trips.
import { expect, test, type Page } from '@playwright/test';

const ISW = '3812927875';
const XYQ = '3803780241';

type Eng = {
  select(ci: number): void;
  setFilePosAxis(ci: number, ax: 'x' | 'y' | 'z', v: number): void;
  setSymOn(on: boolean): void;
  twinPairsOf(ci: number): { j: number; mask: number }[];
  symState(): { on: boolean; mirrorX: boolean; active: boolean };
  setSymOn(on: boolean): void;
  getOptions(): Record<string, boolean>;
  blueprint: { data: { components: { position: { x: number; y: number; z: number }; data?: Record<string, unknown> }[] } } | null;
};
function eng(op: string, arg: Record<string, unknown> = {}): (page: Page) => Promise<unknown> {
  return (page: Page) => page.evaluate(({ op, arg }) => {
    const w = window as unknown as { __ARCHEAN__?: { engine: Eng } };
    const e = w.__ARCHEAN__!.engine;
    const ci = (arg as { ci: number }).ci;
    switch (op) {
      case 'opts': return e.getOptions();
      case 'sym': return e.symState();
      case 'twins': return e.twinPairsOf(ci);
      case 'pos': return { ...e.blueprint!.data.components[ci].position };
      case 'posOf': return { ...e.blueprint!.data.components[(arg as { ci: number }).ci].position };
      case 'angle': return e.blueprint!.data.components[ci]?.data?.['angle'] ?? null;
      case 'setx': e.setFilePosAxis(ci, 'x', (arg as { v: number }).v); return null;
      case 'symon': e.setSymOn(!!(arg as { on: boolean }).on); return null;
    }
    return null;
  }, { op, arg });
}

async function openCraft(page: Page, id: string) {
  await page.goto(`/?craft=${id}`);
  await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
  await page.getByTestId('mode-edit').click();
}

test.describe('symmetry twins', () => {
  const desktopOnly = () => test.skip(test.info().project.name !== 'chromium', 'desktop-only');

  test('slider move propagates the mirrored delta to the twin; drift auto-disables', async ({ page }) => {
    desktopOnly();
    await openCraft(page, ISW);
    await page.getByTestId('filter').fill('aileron');
    const rows = page.locator('[data-idx]');
    const n = await rows.count();
    let ci = -1, twin = -1;
    for (let i = 0; i < n; i++) {
      const cand = +(await rows.nth(i).getAttribute('data-idx'))!;
      const pairs = (await eng('twins', { ci: cand })(page)) as { j: number; mask: number }[];
      if (pairs.some(p2 => p2.mask & 1)) { ci = cand; twin = pairs.find(p2 => p2.mask & 1)!.j; break; }
    }
    expect(ci, 'ISW carries an x-mirror aileron pair').toBeGreaterThanOrEqual(0);
    await page.locator(`[data-idx="${ci}"]`).click();
    expect((await eng('sym')(page)) as { active: boolean }).toMatchObject({ active: true, mirrorX: true });

    const x0 = (await eng('posOf', { ci: twin })(page)) as { x: number };
    const selfPos = (await eng('pos', { ci })(page)) as { x: number };
    await page.getByTestId('row-n-x').fill(String(selfPos.x + 0.5));
    await expect.poll(async () => ((await eng('posOf', { ci: twin })(page)) as { x: number }).x)
      .toBeCloseTo(x0.x - 0.5, 9);                       // mirrored: the twin moves -x

    // a SYMMETRIC edit keeps the pair aligned; breaking symmetry (⇄ off +
    // solo move) drifts it → the >5 cm auto-disable kills propagation, and
    // realigning revives the pair (v0.166)
    expect(((await eng('twins', { ci })(page)) as unknown[]).length).toBeGreaterThan(0);
    await eng('symon', { on: false, ci: 0 })(page);
    await eng('setx', { ci, v: selfPos.x + 0.38 })(page);      // solo drift
    await eng('symon', { on: true, ci: 0 })(page);
    expect(((await eng('twins', { ci })(page)) as unknown[]).length).toBe(0);
    await eng('symon', { on: false, ci: 0 })(page);
    await eng('setx', { ci, v: selfPos.x })(page);             // both halves
    await eng('setx', { ci: twin, v: x0.x })(page);            // back on the plane
    await eng('symon', { on: true, ci: 0 })(page);
    expect(((await eng('twins', { ci })(page)) as unknown[]).length).toBeGreaterThan(0);
    // self + twin are back at their file-authoring poses
    expect(((await eng('pos', { ci })(page)) as { x: number }).x).toBeCloseTo(selfPos.x, 9);
  });

  test('XYQ twin door hinges move in UNISON on one joint slider, ⟲ restores both', async ({ page }) => {
    desktopOnly();
    await openCraft(page, XYQ);
    await page.getByTestId('ltab-sub').click();
    const secs = page.locator('[data-testid^="sec-b"]');
    const n = await secs.count();
    const jointRow = page.getByTestId('row-n-joint angle (°)');
    let found = false;
    for (let i = 0; i < n && !found; i++) {
      await secs.nth(i).click();
      const row = page.locator('[data-b]').first();
      if (!(await row.count())) continue;
      await row.click();
      found = !!(await jointRow.count());
    }
    expect(found, 'a subgrid names its hinge master with a joint slider').toBe(true);

    // every SmallHinge with a stored angle: the twin pair shares 24.3°
    const hinges = await page.evaluate(() => {
      const w = window as unknown as { __ARCHEAN__?: { engine: { blueprint: { data: { components: { type: string; data?: { angle?: number } }[] } } } } };
      return w.__ARCHEAN__!.engine.blueprint!.data.components
        .map((c, i) => ({ i, a: c.data && typeof c.data.angle === 'number' ? c.data.angle : null }))
        .filter((h, _i, all) => h.a !== null && all.length > 0);
    });
    const withAngle = hinges.filter(h => h.a !== null);
    expect(withAngle.length, 'XYQ keeps its two twin hinges in the file').toBeGreaterThanOrEqual(2);

    await jointRow.fill('34.3');
    await expect.poll(async () => {
      const hs = await page.evaluate(() => {
        const w = window as unknown as { __ARCHEAN__?: { engine: { blueprint: { data: { components: { data?: { angle?: number } }[] } } } } };
        return w.__ARCHEAN__!.engine.blueprint!.data.components.filter(c => typeof c.data?.angle === 'number').map(c => c.data!.angle);
      });
      return hs.every(a => Math.abs((a as number) - 34.3) < 0.15);
    }, { timeout: 5000 }).toBe(true);                           // BOTH twins ride to 34.3

    await page.getByTestId('row-x-joint angle (°)').click();
    await expect.poll(async () => {
      const hs = await page.evaluate(() => {
        const w = window as unknown as { __ARCHEAN__?: { engine: { blueprint: { data: { components: { data?: { angle?: number } }[] } } } } };
        return w.__ARCHEAN__!.engine.blueprint!.data.components.filter(c => typeof c.data?.angle === 'number').map(c => Math.abs(c.data!.angle as number));
      });
      return hs.every(a => Math.abs(a - 24.3) < 0.15);
    }, { timeout: 5000 }).toBe(true);
  });

  test('mirror-plane option round-trips through the engine', async ({ page }) => {
    desktopOnly();
    await openCraft(page, ISW);
    await page.getByTestId('toggle-options').click();   // options live in the ⚙ popover now
    const cb = page.getByTestId('opt-mirror');
    await expect(cb).toBeChecked();
    await cb.uncheck();
    expect(((await eng('opts')(page)) as Record<string, boolean>).mirror).toBe(false);
    await cb.check();
    expect(((await eng('opts')(page)) as Record<string, boolean>).mirror).toBe(true);
  });
});
