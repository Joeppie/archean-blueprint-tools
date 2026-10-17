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

test('card click enters the editor and renders the craft', async ({ page }) => {
  const id = await firstCraftId(page);
  await page.locator(`[data-testid="card-${id}"]`).click();
  await expect(page).toHaveURL(new RegExp(`craft=${id}`));
  await expect(page.getByTestId('editor-title')).toBeVisible();
  await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
});

test('back button returns to the gallery', async ({ page }) => {
  const id = await firstCraftId(page);
  await page.locator(`[data-testid="card-${id}"]`).click();
  await expect(page.getByTestId('editor-title')).toBeVisible();
  await page.getByTestId('back-to-gallery').click();
  await expect(page.getByTestId('gallery')).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test('?craft= deep link opens the editor directly', async ({ page }) => {
  const id = await firstCraftId(page);
  await page.goto(`/?craft=${id}`);
  await expect(page.getByTestId('editor-title')).toBeVisible();
  await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
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
