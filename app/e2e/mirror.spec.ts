// mirror.spec.ts — ⇄ MIRRORED PLACEMENT: with the twin toggle on, a block
// click places the block AND its x-mirrored twin (mirrored cell about the
// file x = 0 plane + mirrored shape type), and a held catalog part places
// the twin COMPONENT at the mirrored position — the exact geometry the ⇄
// twin index pairs, so later edits propagate through the established path.
import { expect, test, type Page } from '@playwright/test';

/** v1.11 ONE LINGO: the mirror widget's axis chips ARE the toggle — arm
 *  mirrored placement across x deterministically (lit = pairs land). */
async function armMirror(page: Page, want = true) {
  const chip = page.getByTestId('mirw-x');
  const lit = (await chip.getAttribute('aria-pressed')) === 'true';
  if (lit !== want) await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', want ? 'true' : 'false');
}

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

/** v1.11: there is NO side drawer anymore (we: "no more side panel") —
 *  everything the drawer held (catalog, parts list, inspector, Info, the
 *  flight/wind panels) lives in the always-visible bottom dock. */
async function setDrawer(_page: Page, _want = true) { /* no-op */ }

test.describe('⇄ mirrored placement @place', () => {
  test('blocks: one click lands the block + its mirrored twin', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('gallery-new').click();
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
    await page.getByTestId('mode-edit').click();
    // v1.10.7: the flavor switch and the ⇄ twin row BOTH live in the
    // build-dock header now (the phone drawer no longer hosts any of it) —
    // the drawer's backdrop covers the dock while open, so every dock tap
    // happens with the drawer CLOSED.
    await page.getByTestId('ws-blocks').click();          // the PLACE flavor (dock header)
    await expect(page.getByTestId('mirw-x')).toBeVisible();
    await armMirror(page, true);

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
    await page.getByTestId('ws-edit').click();      // the EDIT flavor (dock header)
    await expect(page.getByTestId('block-edit')).toBeVisible();
  });

  test('catalog parts: the held part lands with a mirrored twin component', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('gallery-new').click();
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
    await page.getByTestId('mode-edit').click();
    // v1.10.7: PLACE flavor from the dock header (drawer closed), then the
    // drawer hosts ONLY the catalog (the parts catalogue is the panel's
    // PLACE flavor content — that is where the drawer stays useful).
    await page.getByTestId('ws-parts').click();         // v1.11: the catalog lives in + Parts
    await setDrawer(page, true);
    await page.getByTestId('catalog-dock').getByTestId('filter').fill('smallwheel');
    await page.getByTestId('catalog-item').first().click();
    await expect(page.getByTestId('place-hint')).toContainText('SmallWheel');
    await setDrawer(page, false);
    await armMirror(page, true);

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
