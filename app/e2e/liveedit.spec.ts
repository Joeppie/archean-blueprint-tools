// liveedit.spec.ts — REAL-TIME data-driven re-render (v0.182 user ask):
// editing a component's data (Propeller twist, Aileron joint angle) in the
// inspector must update the part's OWN model immediately — through the panel
// wiring (edits.dataField + Engine.liveDataEdit), NOT a debounced full-scene
// reload. Pins: the liveDataEdit call lands (wrapped hook), reload() never
// fires during the gesture, and the REAL-model bbox follows the data.
import { expect, test, type Page } from '@playwright/test';

const PROP = '9000001024';       // matrix rest twin: 4 blades, r 1.2, pitch/twist 0
const AIL = '9000001001';        // matrix rest triple with an Aileron

type Box = { min: [number, number, number]; max: [number, number, number] };
type W = { __ARCHEAN__?: { engine: {
  compRealBox(ci: number): Box | null;
  select(ci: number): void;
  blueprint: { data: { components: { type: string }[] } } | null;
} } };

const spans = (b: Box) => [0, 1, 2].map(a => b.max[a] - b.min[a]);
const yspan = (b: Box) => b.max[1] - b.min[1];

async function openPart(page: Page, id: string, type: string): Promise<number> {
  test.setTimeout(60_000);
  await page.goto(`/?craft=${id}`);
  const find = () => page.evaluate((t) =>
    (window as unknown as W).__ARCHEAN__?.engine?.blueprint?.data.components
      .findIndex(c => c.type === t) ?? -2, type);
  await expect.poll(find, { timeout: 40_000 }).toBeGreaterThanOrEqual(0);
  const ci = await find();
  await expect.poll(() => page.evaluate((ci) =>
    (window as unknown as W).__ARCHEAN__?.engine?.compRealBox(ci) ?? null, ci),
  { timeout: 40_000, intervals: [250, 500, 1000] }).not.toBeNull();
  return ci;
}

/** instrument liveDataEdit + reload BEFORE touching the panel */
async function watchLive(page: Page) {
  await page.evaluate(() => {
    const e = (window as unknown as W).__ARCHEAN__!.engine as unknown as Record<string, any>;
    const w = window as unknown as Record<string, number>;
    w.__live = 0; w.__reload = 0;
    const live = e.liveDataEdit.bind(e), reload = e.reload.bind(e);
    e.liveDataEdit = (ci: number) => { w.__live!++; live(ci); };
    e.reload = () => { w.__reload!++; reload(); };
  });
}
const counters = (page: Page) => page.evaluate(() => {
  const w = window as unknown as Record<string, number>;
  return { live: w.__live ?? 0, reload: w.__reload ?? 0 };
});

/** real-pointer label scrub on the inspector DATA-section row `key` (Δ px) */
async function scrub(page: Page, key: string, px: number) {
  const label = page.locator('section', { hasText: 'Component data' }).getByTestId(`row-s-${key}`);
  await label.scrollIntoViewIfNeeded();
  await expect(label).toBeInViewport();
  const bb = (await label.boundingBox())!;
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 4; i++) await page.mouse.move(bb.x + bb.width / 2 + (px * i) / 4, bb.y + bb.height / 2);
  await page.mouse.up();
}

const boxOf = (page: Page, ci: number) => page.evaluate((ci) =>
  (window as unknown as W).__ARCHEAN__!.engine.compRealBox(ci)!, ci);

test.describe('live data edits re-render the part (no reload)', () => {
  const desktopOnly = () => test.skip(test.info().project.name !== 'chromium', 'desktop-only');

  test('Propeller twist edit grows the generated blade surface immediately', async ({ page }) => {
    desktopOnly();
    const ci = await openPart(page, PROP, 'Propeller');
    await watchLive(page);
    const b0 = await boxOf(page, ci);
    await page.getByTestId('mode-edit').click();                // data rows are Edit-mode only
    await page.getByTestId('filter').fill('propeller');
    await page.locator('[data-idx]').first().click();         // select → inspector
    const twistRow = page.locator('section', { hasText: 'Component data' }).getByTestId('row-n-twist');
    await twistRow.scrollIntoViewIfNeeded();
    await twistRow.fill('10');                                // matrix deflected law: twist 10 spreads the blades axially
    const { live, reload } = await counters(page);
    expect(live, 'the panel routed the edit to liveDataEdit').toBeGreaterThan(0);
    expect(reload, 'NO full-scene reload for a data edit').toBe(0);
    // pitch rotates the section in YZ: the disc-normal spread must GROW live
    const s0 = spans(b0).sort((x, y) => x - y), s1 = spans(await boxOf(page, ci)).sort((x, y) => x - y);
    expect(s1[0] - s0[0], `out-of-plane spread grew ${(s1[0] - s0[0]).toFixed(2)} m`).toBeGreaterThan(0.15);
  });

  test('Aileron joint-angle scrub deflects the flap on the live model', async ({ page }) => {
    desktopOnly();
    const ci = await openPart(page, AIL, 'Aileron');
    await watchLive(page);
    const b0 = await boxOf(page, ci);                          // flat plate: thin y
    await page.getByTestId('mode-edit').click();                // data rows are Edit-mode only
    await page.getByTestId('filter').fill('aileron');
    await page.locator('[data-idx]').first().click();
    await scrub(page, 'angle', 120);                           // 120 px ≈ +6° (0.05/px)
    const { live, reload } = await counters(page);
    expect(live, 'the panel routed the edit to liveDataEdit').toBeGreaterThan(0);
    expect(reload, 'NO full-scene reload for a data edit').toBe(0);
    const b1 = await boxOf(page, ci);
    const bad = await page.evaluate((ci) => {
      const e = (window as unknown as W).__ARCHEAN__!.engine as any;
      const out: string[] = [];
      const roots = (e['compRoots'] as Map<number, any[]> | undefined)?.get(ci) ?? [];
      e.scene.updateMatrixWorld(true);
      roots.forEach((r: any, ri: number) => {
        r.traverse((o: any) => {
          const mw = o.matrixWorld.elements;
          if (!mw.every(Number.isFinite)) out.push(`MW-NaN r${ri} ${o.type} ${o.name || ''} mw=${mw.map(x => +x.toFixed(2))}`);
          const g = o.geometry as any;
          if (g) { g.computeBoundingBox?.(); if (!Number.isFinite(g.boundingBox?.min?.x ?? 0)) out.push(`GEO-NaN r${ri} ${o.type} v=${g.attributes?.position?.count}`); }
        });
      });
      return out.slice(0, 8);
    }, ci);
    expect(bad, 'NaN transforms in the scene').toEqual([]);
    expect(yspan(b1), `flap deflected: y-span ${yspan(b1).toFixed(3)} > rest ${yspan(b0).toFixed(3)}`)
      .toBeGreaterThan(yspan(b0) + 0.05);
  });
});
