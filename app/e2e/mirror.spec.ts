// mirror.spec.ts — ⇄ MIRRORED PLACEMENT: with the twin toggle on, a block
// click places the block AND its x-mirrored twin (mirrored cell about the
// file x = 0 plane + mirrored shape type), and a held catalog part places
// the twin COMPONENT at the mirrored position — the exact geometry the ⇄
// twin index pairs, so later edits propagate through the established path.
import { expect, test, type Page } from '@playwright/test';

type Blk = { frame_x?: number; pos_x: number; size_x: number; type: number };
const blocksOf = (page: Page) => page.evaluate(() => {
  const w = window as unknown as { __ARCHEAN__?: { engine: { blueprint: {
    data: { blocks: Blk[] } } } } };
  return w.__ARCHEAN__!.engine.blueprint.data.blocks;
});
const compsOf = (page: Page) => page.evaluate(() => {
  const w = window as unknown as { __ARCHEAN__?: { engine: { blueprint: {
    data: { components: { type: string; position: { x: number; y: number; z: number } }[] } } } } };
  return w.__ARCHEAN__!.engine.blueprint.data.components;
});
const cellX = (b: Blk) => (b.frame_x ?? 0) * 12 + b.pos_x;

/** the parts panel is a drawer under md: open/close it on phones only */
async function setDrawer(page: Page, want: boolean) {
  if (await page.evaluate(() => window.innerWidth >= 768)) return;
  const aside = page.getByTestId('panel-aside');
  const vis = await aside.isVisible().catch(() => false);
  if (vis !== want) await page.getByTestId('toggle-panels').click();
  if (want) await expect(aside).toBeVisible();
}

test.describe('⇄ mirrored placement @place', () => {
  test('blocks: one click lands the block + its mirrored twin', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('gallery-new').click();
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
    await page.getByTestId('mode-edit').click();
    // v1.10.6: the flavor switch lives in the drawer, the ⇄ twin row in the
    // build-dock — on phones the open drawer's backdrop covers the dock, so
    // the mirror switch is clicked with the drawer CLOSED.
    await setDrawer(page, true);
    await page.getByTestId('tooltab-place').click();          // v1.5: the PLACE flavor
    await setDrawer(page, false);
    await expect(page.getByTestId('block-mirror')).toBeVisible();
    await page.getByTestId('block-mirror').click();          // twin ON (persisted)
    await expect(page.getByTestId('block-mirror')).toContainText('twin ON');

    const before = (await blocksOf(page)).length;
    const canvas = page.getByTestId('canvas');
    const box = (await canvas.boundingBox())!;
    // v0.183: PROBE for a clickable block face (engine.pickCell) instead of
    // hardcoded fractions — with the real models deterministically loaded
    // (no more loading lottery) the old pixels sat under the seat mesh.
    // v1.10.6: the grid widened (0.15..0.88) — the build-dock shortens the
    // phone canvas, the fit deck band moves with it.
    let click: { x: number; y: number } | null = null;
    for (let i = 0; i < 40 && !click; i++) {
      click = await page.evaluate(() => {
        const c = document.querySelector('canvas')!;
        const r = c.getBoundingClientRect();
        const e = (window as unknown as { __ARCHEAN__?: { engine: { pendingReal: number; pickCell: (x: number, y: number) => { bi: number } | null } } }).__ARCHEAN__!.engine;
        if (e.pendingReal > 0) return null;
        for (let fy = 0.3; fy <= 0.88; fy += 0.02)
          for (let fx = 0.15; fx <= 0.85; fx += 0.02) {
            const h = e.pickCell(r.left + r.width * fx, r.top + r.height * fy);
            if (h && h.bi >= 0) return { x: fx, y: fy };
          }
        return null;
      });
      if (!click) await page.waitForTimeout(300);
    }
    expect(click, 'a deck block face is clickable once real models land').not.toBeNull();
    await canvas.click({ position: { x: box.width * click!.x, y: box.height * click!.y } });
    await page.waitForTimeout(300);
    const after = await blocksOf(page);
    expect(after.length, 'ONE click placed the block AND its twin').toBe(before + 2);
    const [self, twin] = after.slice(-2);
    // twin footprint: [c, c+size+1) mirrored to [12−c−(size+1), 12−c) =
    // start 11−c−size about the world x = 0 plane (cell coord 6 — the
    // corpus twin census arbitrates; v1.4.0 fixed the old 10−c−size,
    // a pre-v0.180 corner-convention leftover half a cell off the plane)
    expect(cellX(twin!)).toBe(11 - cellX(self!) - self!.size_x);
    expect(twin!.size_x).toBe(self!.size_x);
    expect(twin!.type).not.toBe(255);
    // mirror is a closed involution on the placed type
    await setDrawer(page, true);
    await page.getByTestId('tooltab-edit').click();      // the EDIT sub-tab edits
    await expect(page.getByTestId('block-edit')).toBeVisible();
  });

  test('catalog parts: the held part lands with a mirrored twin component', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('gallery-new').click();
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
    await page.getByTestId('mode-edit').click();
    await setDrawer(page, true);
    await page.getByTestId('tooltab-place').click();       // v1.4 PLACE tab = catalog
    await page.getByTestId('filter').fill('smallwheel');
    await page.getByTestId('catalog-item').first().click();
    await expect(page.getByTestId('place-hint')).toContainText('SmallWheel');
    await setDrawer(page, false);
    // v1.10.6: the ⇄ twin row is in the build-dock (backdrop-free with the
    // drawer closed)
    await page.getByTestId('block-mirror').click();        // shared twin switch
    await expect(page.getByTestId('block-mirror')).toContainText('twin ON');

    const before = (await compsOf(page)).length;
    const canvas = page.getByTestId('canvas');
    const box = (await canvas.boundingBox())!;
    // v1.10.6: probe a deck-face pixel (engine.pickCell) like the block test
    // — the build-dock shortens the phone canvas and the old hardcoded
    // fractions (tuned to the full-height canvas) landed on empty space.
    let spot: { x: number; y: number } | null = null;
    for (let i = 0; i < 30 && !spot; i++) {
      spot = await page.evaluate(() => {
        const c = document.querySelector('canvas')!;
        const r = c.getBoundingClientRect();
        const e = (window as unknown as { __ARCHEAN__?: { engine: { pendingReal: number;
          pickCell: (x: number, y: number) => { bi: number } | null } } }).__ARCHEAN__!.engine;
        if (e.pendingReal > 0) return null;
        for (let fy = 0.3; fy <= 0.88; fy += 0.02)
          for (let fx = 0.15; fx <= 0.85; fx += 0.02) {
            const h = e.pickCell(r.left + r.width * fx, r.top + r.height * fy);
            if (h && h.bi >= 0) return { x: fx, y: fy };
          }
        return null;
      });
      if (!spot) await page.waitForTimeout(300);
    }
    expect(spot, 'a deck face answers pickCell').not.toBeNull();
    await canvas.click({ position: { x: box.width * spot!.x, y: box.height * spot!.y } });
    await page.waitForTimeout(500);
    const after = await compsOf(page);
    expect(after.length, 'ONE click placed the part AND its twin').toBe(before + 2);
    const a = after[after.length - 2]!, b = after[after.length - 1]!;
    expect(a.type).toBe('SmallWheel');
    expect(b.type).toBe('SmallWheel');
    // the twin sits at the MIRRORED position (⇄ mask-bit-1 geometry)
    expect(b.position.x).toBeCloseTo(-a.position.x, 3);
    expect(b.position.y).toBeCloseTo(a.position.y, 3);
    expect(b.position.z).toBeCloseTo(a.position.z, 3);
  });
});
