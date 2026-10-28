// Two-stage UX suite: gallery landing → editor → back, deep links, and the
// corpus endpoints — runs on BOTH projects (desktop chromium + Pixel 7).
import { expect, test } from '@playwright/test';

async function firstCraftId(page: import('@playwright/test').Page): Promise<string> {
  await page.goto('/');
  return (await page.locator('[data-testid^="card-"]').first()
    .getAttribute('data-testid'))!.replace('card-', '');
}

test('gallery landing shows the craft cards', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('brand-accent')).toBeVisible();
  await expect(page.getByTestId('gallery-sub')).toContainText(/crafts from the configured blueprint folder/);
  await expect(page.locator('[data-testid^="card-"]').first()).toBeVisible();
});

test('the app IS the site: legacy viewer only as a small END-of-gallery link', async ({ page, request }) => {
  await page.goto('/');
  const legacy = page.getByTestId('legacy-link');
  await expect(legacy).toBeVisible();
  await expect(legacy).toHaveCSS('font-size', '11px');   // deliberately small + muted
  // pointed to the BACK: it sits AFTER the last craft card in the DOM
  const order = await page.evaluate(() => [...document.querySelectorAll('[data-testid], footer [data-testid]')]
    .map(e => e.getAttribute('data-testid'))
    .filter(t => t?.startsWith('card-') || t === 'legacy-link'));
  expect(order.at(-1)).toBe('legacy-link');
  await expect(legacy).toHaveAttribute('href', 'viewer/index.html');
  // and the target resolves (dev plugin /viewer/ route; Pages repo root)
  expect((await request.get('/viewer/index.html')).status()).toBe(200);
});

test('card click enters the editor and renders the craft', async ({ page }) => {
  const id = await firstCraftId(page);
  await page.locator(`[data-testid="card-${id}"]`).click();
  await expect(page).toHaveURL(new RegExp(`craft=${id}`));
  await expect(page.getByTestId('editor-title')).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
});

test('back button returns to the gallery', async ({ page }) => {
  const id = await firstCraftId(page);
  await page.locator(`[data-testid="card-${id}"]`).click();
  await expect(page.getByTestId('editor-title')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('back-to-gallery').click();
  await expect(page.getByTestId('gallery')).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test('?craft= deep link opens the editor directly', async ({ page }) => {
  const id = await firstCraftId(page);
  await page.goto(`/?craft=${id}`);
  await expect(page.getByTestId('editor-title')).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
});

test('the PLAYABLE row: two in-craft arcade clips, click boots the game fullscreen @ui', async ({ page }) => {
  test.slow();   // two full craft boots + a VM reboot chained in one test
  // v1.13.8 (we: "Add those to the library on top in a little segment of
  // their own" + webm clips): the gallery's own segment for the two crafts
  // that ARE games; clicking a card = the ?craft&dash deep link → the game
  // screen opens FULLSCREEN in the editor.
  await page.goto('/');
  const row = page.getByTestId('playable');
  await expect(row).toBeVisible();
  await expect(row.getByTestId('playable-3820116990')).toBeVisible();
  await expect(row.getByTestId('playable-3288012440')).toBeVisible();
  // the cards carry the in-craft webm clips (autoplay loop, < 250 KiB)
  await expect(row.locator('video[src*="invaders.webm"]')).toHaveCount(1);
  await expect(row.locator('video[src*="mario.webm"]')).toHaveCount(1);
  // click the arcade card → editor + the game screen's zoom window opens
  await page.getByTestId('playable-3288012440').click();
  await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 60_000 });
  await expect(page).toHaveURL(/craft=3288012440&dash=main%230/);
  await expect(page.getByTestId('screens-cell-main#0-overlay')).toBeVisible({ timeout: 60_000 });
  // BACK TO THE GALLERY RESETS THE SIM (we: "going back to the gallery
  // DOESNT properly reset the entire sim, which it must if we can open
  // directly to a screen"): the pump (VM, surfaces, buzzers) must close on
  // unmount, so re-entering the deep link boots a FRESH title screen
  await page.getByText('✕ close').first().click();   // the zoom overlay
  await page.getByTestId('back-to-gallery').click(); // covers the top bar
  await expect
    .poll(() => page.evaluate(() => (window as any).__XENON__?.()?.status ?? 'gone'),
      { timeout: 10_000 })
    .toBe('idle');
  // and the game reboots CLEAN on a second entry: a RESUMED session would
  // carry the old title state; the fresh VM's program sits in its intro
  // (Invaders' main_state = 0; the title-rise screen)
  await page.getByTestId('playable-3288012440').click();
  await expect(page.getByTestId('screens-cell-main#0-overlay')).toBeVisible({ timeout: 90_000 });
  await expect
    .poll(() => page.evaluate(() => {
      const x = (window as any).__XENON__?.();
      return x && typeof x.vars === 'function' ? String(x.vars()?.main_state ?? '') : '?';
    }), { timeout: 60_000 })
    .toBe('0');
});

test('corpus endpoint serves the blueprint of a selected craft', async ({ request }) => {
  const listing = await (await request.get('/corpus/')).text();
  const ids = [...listing.matchAll(/href="(\d{6,})\/"/g)].map(m => m[1]!);
  expect(ids.length).toBeGreaterThan(0);
  const bp = await (await request.get(`/corpus/${ids[0]}/blueprint.json`)).json();
  expect(bp.data.blocks.length + bp.data.components.length).toBeGreaterThan(0);
});

test('model manifest + workshop names are served', async ({ request }) => {
  const man = await (await request.get('/models/manifest.json')).json();
  expect(Object.keys(man).length).toBeGreaterThan(50);
  expect(man.SmallWheel.colliders.length).toBeGreaterThan(0);
  const ws = await (await request.get('/workshop.json')).json();
  expect(Object.keys(ws).length).toBeGreaterThan(0);
});
