// mirror-mismatch.spec.ts — the v1.8.0 UNIFORM MIRROR RULE's FAUX-MIRROR
// screen (user rule): selecting an item mirrors EVERY edit onto its twin —
// position, rotation, shape, colour, material, delete — blocks AND components.
// A mirror-position partner that DIFFERS in a regarded property is a mirror-
// conflicting faux-mirror: it must be flagged — a RED overlay/box plus a ⚠
// popup naming what differs (engine twinWarnState → the Viewport's twin-warn
// card; blockTwinIssues / compPaintDiff are the pure screens, unit-pinned in
// blocks.test.ts / sym.test.ts).
import { expect, test, type Page } from '@playwright/test';

type Hl = { bi: number; twin: number; issues?: string[] } | null;

const highlight = (page: Page) => page.evaluate(() =>
  (window as unknown as { __ARCHEAN__?: { blockHighlight: () => Hl } }
  ).__ARCHEAN__!.blockHighlight());

const twinWarn = (page: Page) => page.evaluate(() =>
  (window as unknown as { __ARCHEAN__?: { twinWarn: () => { text: string; x: number; y: number } | null } }
  ).__ARCHEAN__!.twinWarn());

const compsLen = (page: Page) => page.evaluate(() =>
  (window as unknown as { __ARCHEAN__?: { engine: { blueprint: {
    data: { components: unknown[] } } } } }).__ARCHEAN__!.engine.blueprint.data.components.length);

async function setDrawer(page: Page, want: boolean) {
  if (await page.evaluate(() => window.innerWidth >= 768)) return;
  const aside = page.getByTestId('panel-aside');
  const vis = await aside.isVisible().catch(() => false);
  if (vis !== want) await page.getByTestId('toggle-panels').click();
  if (want) await expect(aside).toBeVisible();
}

test.describe('faux-mirror screen: mismatches are flagged, not silent @place', () => {
  test('block pair: a material-divergent twin flags ⚠ (popup + red panel row)', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'desktop-only');
    await page.goto('/');
    await page.getByTestId('gallery-new').click();
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
    await page.getByTestId('mode-blocks').click();
    await page.getByTestId('tooltab-place').click();
    await page.getByTestId('block-mirror').click();        // ⇄ twin ON: place the pair
    let click: { x: number; y: number } | null = null;
    for (let i = 0; i < 40 && !click; i++) {
      click = await page.evaluate(() => {
        const c = document.querySelector('canvas')!;
        const r = c.getBoundingClientRect();
        const e = (window as unknown as { __ARCHEAN__?: { engine: { pendingReal: number;
          pickCell: (x: number, y: number) => { bi: number } | null } } }).__ARCHEAN__!.engine;
        if (e.pendingReal > 0) return null;
        for (let fy = 0.5; fy <= 0.78; fy += 0.02)
          for (let fx = 0.28; fx <= 0.72; fx += 0.02) {
            const h = e.pickCell(r.left + r.width * fx, r.top + r.height * fy);
            if (h && h.bi >= 0) return { x: fx, y: fy };
          }
        return null;
      });
      if (!click) await page.waitForTimeout(300);
    }
    expect(click).not.toBeNull();
    const box = (await page.getByTestId('canvas').boundingBox())!;
    const px = box.x + box.width * click!.x, py = box.y + box.height * click!.y;
    await page.mouse.click(px, py);                        // place the mirrored pair
    await page.waitForTimeout(600);
    await page.getByTestId('tooltab-edit').click();
    await page.mouse.click(px, py);                        // select the placed block
    let hl = await highlight(page);
    expect(hl, 'the placed block is selected').not.toBeNull();
    expect(hl!.twin, 'a true twin is propable').toBeGreaterThanOrEqual(0);
    expect(hl!.issues ?? [], 'a fresh ⇄ pair has no conflict').toEqual([]);

    // BREAK the mirror behind the UI: the twin takes a different MATERIAL.
    await page.evaluate((i) => {
      (window as unknown as { __ARCHEAN__?: { engine: { blueprint: {
        data: { blocks: { material?: number }[] } } } } }).__ARCHEAN__!.engine
        .blueprint.data.blocks[i]!.material = 1;          // Concrete vs Composite
    }, hl!.twin);
    await page.mouse.click(box.x + box.width * 0.04, box.y + box.height * 0.04);  // sky: deselect
    await expect.poll(() => highlight(page), { timeout: 4000 }).toBeNull();
    await page.mouse.click(px, py);                        // re-select: issues recompute
    hl = await highlight(page);
    expect(hl).not.toBeNull();
    expect((hl!.issues ?? []).join(', ')).toMatch(/material Composite ≠ Concrete/);
    await expect(page.getByTestId('block-twin')).toContainText(/⚠ mirror conflict/);
    // the ⚠ popup (250 ms poll): a triangle + the diff text, anchored at the twin
    await expect.poll(async () => (await twinWarn(page))?.text ?? '', { timeout: 5000 })
      .toMatch(/material Composite ≠ Concrete/);
    const w = await twinWarn(page);
    expect(w, 'the engine popup state is live').not.toBeNull();
    expect(w!.text).toMatch(/material Composite ≠ Concrete/);
    await expect(page.getByTestId('twin-warn')).toContainText('⚠');
    await expect(page.getByTestId('twin-warn')).toContainText(/material Composite ≠ Concrete/);
  });

  test('component pair: a painted-apart twin flags ⚠', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'desktop-only');
    await page.goto('/');
    await page.getByTestId('gallery-new').click();
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
    await page.getByTestId('mode-edit').click();
    await setDrawer(page, true);
    await page.getByTestId('mode-blocks').click();         // flip the shared twin switch
    await page.getByTestId('block-mirror').click();
    await page.getByTestId('mode-edit').click();
    await page.getByTestId('tooltab-place').click();
    await page.getByTestId('filter').fill('smallwheel');
    await page.getByTestId('catalog-item').first().click();
    await expect(page.getByTestId('place-hint')).toContainText('SmallWheel');
    await setDrawer(page, false);
    const before = await compsLen(page);
    const canvas = page.getByTestId('canvas');
    const box = (await canvas.boundingBox())!;
    for (const [fx, fy] of [[0.5, 0.62], [0.5, 0.55], [0.5, 0.68], [0.45, 0.6]]) {
      await canvas.click({ position: { x: box.width * fx, y: box.height * fy } });
      await page.waitForTimeout(350);
      if ((await compsLen(page)) > before) break;
    }
    expect(await compsLen(page)).toBeGreaterThan(before);  // pair landed
    const pairAt = (await compsLen(page)) - 2;
    // BREAK the pair's appearance: paint ONLY the self side (direct data edit;
    // the live 🎨 path paints twins together — that is the uniform rule)
    await page.evaluate((i) => {
      const c = (window as unknown as { __ARCHEAN__?: { engine: { blueprint: {
        data: { components: { colors?: unknown }[] } } } } }).__ARCHEAN__!.engine
        .blueprint.data.components[i]!;
      c.colors = { color1: { r: 255, g: 0, b: 0, opacity: 15, roughness: 0, metallic: 0 } };
    }, pairAt);
    await page.evaluate((i) =>
      (window as unknown as { __ARCHEAN__?: { engine: { select: (ci: number) => void } } }
      ).__ARCHEAN__!.engine.select(i), pairAt);
    await expect.poll(() => twinWarn(page), { timeout: 5000 }).not.toBeNull();
    const w = await twinWarn(page);
    expect(w!.text).toMatch(/SmallWheel\[\d+\] ↔ twin \[\d+\]: .*colour1 differs/);
    await expect(page.getByTestId('twin-warn')).toContainText(/colour1 differs/);
  });
});
