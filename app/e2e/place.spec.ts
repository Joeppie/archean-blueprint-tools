// place.spec.ts — the KSP editor contract: the main MODE tiles each drive
// their workspace panel, and the parts CATALOG places a brand-new component
// onto the craft (bp + doc mirror, dirty flag, auto-select after the scene
// reload). Like KSP, one click places ONE part (the hand empties) and Esc
// drops the held part before anything else. Mobile-safe: below 768 px the
// parts panel is a drawer — it is opened for panel work and closed again
// before canvas taps (it would intercept them).
import { expect, test, type Page } from '@playwright/test';

const ISW = '3812927875';

const compsOf = (page: Page) => page.evaluate(() => {
  const w = window as unknown as { __ARCHEAN__?: { engine: { blueprint: {
    data: { components: { type: string; position: { x: number; y: number; z: number } }[] } } } } };
  return w.__ARCHEAN__!.engine.blueprint.data.components;
});

/** the parts panel is a drawer under md: open/close it on phones only */
async function setDrawer(page: Page, want: boolean) {
  if (await page.evaluate(() => window.innerWidth >= 768)) return;
  const aside = page.getByTestId('panel-aside');
  const vis = await aside.isVisible().catch(() => false);
  if (vis !== want) await page.getByTestId('toggle-panels').click();
  if (want) await expect(aside).toBeVisible();
}

test.describe('KSP modes & catalog placement', () => {
  test('mode tiles: blocks / wire / flight / edit each show their workspace', async ({ page }) => {
    await page.goto(`/?craft=${ISW}`);
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
    await setDrawer(page, true);
    await page.getByTestId('mode-blocks').click();
    await expect(page.getByTestId('block-brush')).toBeVisible();
    await expect(page.getByTestId('blocksub-tris')).toBeVisible();   // + triangles submode
    await page.getByTestId('mode-wire').click();
    await expect(page.getByTestId('wire-census')).toBeVisible();
    await page.getByTestId('mode-flight').click();
    await expect(page.getByTestId('flight-prop')).toBeVisible();
    await page.getByTestId('mode-edit').click();
    await page.getByTestId('filter').fill('smallwheel');
    await page.locator('[data-idx]').first().click();
    await expect(page.getByTestId('inspector')).toContainText('SmallWheel[');
    await expect(page.getByTestId('row-n-x')).toBeEnabled();         // edit unlocks the fields
  });

  test('catalog: hold a SmallWheel, click the deck, the part lands and selects', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('gallery-new').click();
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
    await page.getByTestId('mode-edit').click();
    const before = (await compsOf(page)).length;

    await setDrawer(page, true);
    await page.getByTestId('ltab-catalog').click();
    await expect(page.getByTestId('catalog-list')).toBeVisible();
    await page.getByTestId('filter').fill('smallwheel');
    await page.getByTestId('catalog-item').first().click();
    await expect(page.getByTestId('place-hint')).toContainText('SmallWheel');
    await setDrawer(page, false);                    // the held part goes onto the craft

    const canvas = page.getByTestId('canvas');
    const box = (await canvas.boundingBox())!;
    for (const [fx, fy] of [[0.5, 0.62], [0.5, 0.55], [0.5, 0.68], [0.45, 0.6], [0.55, 0.6]]) {
      await canvas.click({ position: { x: box.width * fx, y: box.height * fy } });
      await page.waitForTimeout(350);
      if ((await compsOf(page)).length > before) break;
    }
    const after = await compsOf(page);
    expect(after.length, 'a SmallWheel was placed on the deck').toBe(before + 1);
    const nc = after[after.length - 1]!;
    expect(nc.type).toBe('SmallWheel');
    expect([nc.position.x, nc.position.y, nc.position.z].every(Number.isFinite)).toBe(true);
    // KSP: one click places ONE part — the hand empties, hint goes away
    await expect(page.getByTestId('place-hint')).toHaveCount(0);
    await expect(page.getByTestId('save-btn')).toContainText('●');
    // the fresh part auto-selects once the scene reload landed
    await setDrawer(page, true);
    await expect(page.getByTestId('inspector')).toContainText('SmallWheel[', { timeout: 8000 });

    // Esc drops the held part; the next click then selects, it does NOT stack
    await page.getByTestId('catalog-item').first().click();
    await expect(page.getByTestId('place-hint')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('place-hint')).toHaveCount(0);
    await setDrawer(page, false);
    await canvas.click({ position: { x: box.width * 0.5, y: box.height * 0.62 } });
    await page.waitForTimeout(350);
    expect((await compsOf(page)).length).toBe(before + 1);
  });
});
