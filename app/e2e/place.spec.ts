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
    data: { components: { type: string; position: { x: number; y: number; z: number };
      orientation?: { w: number; x: number; y: number; z: number } }[] } } } } };
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

test.describe('KSP modes & catalog placement @place', () => {
  test('mode tiles: blocks / wire / flight / edit each show their workspace', async ({ page }) => {
    await page.goto(`/?craft=${ISW}`);
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
    // v1.10.7: TopBar tiles + the dock header flavor switch are all clicked
    // with the drawer CLOSED (its backdrop covers the dock on phones); the
    // drawer opens only for the parts-list / inspector phase at the end.
    await page.getByTestId('mode-edit').click();
    await page.getByTestId('tooltab-place').click();       // the brush lives in PLACE (dock header)
    await expect(page.getByTestId('block-brush')).toBeVisible();
    await expect(page.getByTestId('blocksub-tris')).toBeVisible();   // + triangles submode
    await page.getByTestId('mode-wire').click();
    await expect(page.getByTestId('wire-census')).toBeVisible();
    // FLIGHT/analysis panels live in the side panel = the drawer on phones
    await setDrawer(page, true);
    await page.getByTestId('mode-flight').click();
    await expect(page.getByTestId('flight-prop')).toBeVisible();
    await setDrawer(page, false);
    await page.getByTestId('mode-edit').click();
    await page.getByTestId('tooltab-edit').click();        // the flavor is shared, set it back
    await setDrawer(page, true);
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

    await page.getByTestId('tooltab-place').click();       // v1.4: the catalog IS the PLACE tab (dock header)
    await setDrawer(page, true);
    await expect(page.getByTestId('catalog-list')).toBeVisible();
    await page.getByTestId('filter').fill('smallwheel');
    await page.getByTestId('catalog-item').first().click();
    await expect(page.getByTestId('place-hint')).toContainText('SmallWheel');
    await setDrawer(page, false);                    // the held part goes onto the craft

    // v1.4: holding a part DOCKS A GHOST on the craft (placement works like
    // the blocks constructor ghost — engine-side state, no pixels)
    const hbox = (await page.getByTestId('canvas').boundingBox())!;
    await page.mouse.move(hbox.x + hbox.width * 0.5, hbox.y + hbox.height * 0.6);
    await expect.poll(() => page.evaluate(() =>
      (window as unknown as { __ARCHEAN__?: { compGhost: () => { type: string } | null } }
      ).__ARCHEAN__!.compGhost()?.type ?? null), { timeout: 3000 }).toBe('SmallWheel');

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

    // v1.4: the selected part DELETES from the inspector (bp splice + doc
    // mirror together; the scene rebuild drops it)
    await page.getByTestId('comp-delete').click();
    await expect.poll(() => compsOf(page).then(c => c.length), { timeout: 8000 }).toBe(before);
    await expect(page.getByTestId('inspector')).toHaveCount(0);

    // Esc drops the held part; the next click then selects, it does NOT stack
    await page.getByTestId('catalog-item').first().click();
    await expect(page.getByTestId('place-hint')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('place-hint')).toHaveCount(0);
    await setDrawer(page, false);
    await canvas.click({ position: { x: box.width * 0.5, y: box.height * 0.62 } });
    await page.waitForTimeout(350);
    expect((await compsOf(page)).length).toBe(before);
  });

  // v1.5.6 — the "zeppelin TiltSensor.json 404 storm" fix: the root-absolute
  // '/models' + '/atlas' candidates (vite DEV aliases) ESCAPED the Pages
  // project prefix, so EVERY model + the manifest walked 8–16 failed requests
  // before the layout-exact route hit. ZERO atlas-tree failures is the pin.
  test('atlas loads with ZERO 404 noise (no root-absolute prefix escape)', async ({ page }) => {
    const bad: string[] = [];
    page.on('response', r => {
      const p = new URL(r.url()).pathname;
      if (r.status() >= 400 && (/\/models\//.test(p) || /\/atlas\//.test(p)))
        bad.push(`${r.status()} ${p}`);
    });
    await page.goto(`/?craft=${ISW}`);
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
    await page.waitForTimeout(2500);     // let the real-model fan-out run too
    expect(bad).toEqual([]);
  });

  test('the placement ghost is the REAL model; a smear-drag lands it with its BACK on the drag', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('gallery-new').click();
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
    await page.getByTestId('mode-edit').click();
    await page.getByTestId('tooltab-place').click();       // dock header (drawer closed)
    await setDrawer(page, true);
    await page.getByTestId('filter').fill('smallwheel');
    await page.getByTestId('catalog-item').first().click();
    await setDrawer(page, false);

    const hbox = (await page.getByTestId('canvas').boundingBox())!;
    const cx = hbox.x + hbox.width * 0.5, cy = hbox.y + hbox.height * 0.6;
    await page.mouse.move(cx, cy);
    await expect.poll(() => page.evaluate(() =>
      (window as unknown as { __ARCHEAN__?: { compGhost: () => { type: string } | null } }
      ).__ARCHEAN__!.compGhost()?.type ?? null), { timeout: 5000 }).toBe('SmallWheel');
    // v1.5.6: the ghost is a translucent MODEL, not the collider-box stand-in
    // (which only shows while that type streams): template-shared meshes.
    await expect.poll(() => page.evaluate(() =>
      (window as unknown as { __ARCHEAN__?: { compGhostReal: () => boolean } }
      ).__ARCHEAN__!.compGhostReal()), { timeout: 10_000 }).toBe(true);

    const before = (await compsOf(page)).length;
    // press-drag-release: the press PINS (no instant place), the drag smears
    // the ghost along the hull and aims its BACK (+z) along the travel
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) await page.mouse.move(cx + i * 16, cy + i * 3, { steps: 2 });
    await page.mouse.up();
    await expect.poll(() => compsOf(page).then(c => c.length), { timeout: 8000 })
      .toBe(before + 1);
    const q = (await compsOf(page)).slice(-1)[0]!.orientation!;
    // a PURE world-ŷ yaw: x/z stay 0, y is a real turn, the quat is unit
    expect(Math.abs(q.x)).toBeLessThan(1e-6);
    expect(Math.abs(q.z)).toBeLessThan(1e-6);
    expect(Math.abs(q.y)).toBeGreaterThan(0.05);
    expect(Math.hypot(q.w, q.x, q.y, q.z)).toBeCloseTo(1, 5);
  });

  test('PLACE catalog renders a live 3D preview per row, one-by-one; hover spins', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('gallery-new').click();
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
    await page.getByTestId('mode-edit').click();
    await page.getByTestId('tooltab-place').click();       // dock header (drawer closed)
    await setDrawer(page, true);
    await expect(page.getByTestId('catalog-list')).toBeVisible();
    // rows trickle previews in (one geometry per idle slice, decimated
    // twins): after a moment several <img> tiles carry a real rendered part
    const painted = () => page.evaluate(() =>
      [...document.querySelectorAll('img[data-testid^="thumb-"]')]
        .filter(el => (el as HTMLImageElement).src.length > 300).length);
    await expect.poll(painted, { timeout: 30_000, intervals: [500, 1000] })
      .toBeGreaterThan(3);
    // hovering a painted preview ANIMATES it: consecutive frames differ
    const idx = await page.evaluate(() => [...document.querySelectorAll('img[data-testid^="thumb-"]')]
      .findIndex(el => (el as HTMLImageElement).src.length > 300));
    const first = page.locator('img[data-testid^="thumb-"]').nth(idx);
    const tb = (await first.boundingBox())!;
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
    await expect.poll(async () => {
      const a = await first.evaluate(el => (el as HTMLImageElement).src);
      await page.waitForTimeout(300);
      const b = await first.evaluate(el => (el as HTMLImageElement).src);
      return a !== b && a.length > 1200;
    }, { timeout: 10_000 }).toBe(true);
  });
});
