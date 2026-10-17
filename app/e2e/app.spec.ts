// Phase-1 UI suite: SPA boots, lists the configured corpus, selecting a
// craft updates the panel — the same driving style the Phase-3 suites
// (select/gizmo/panels/subgrid, see REWRITE.md § Playwright) will use.
import { expect, test } from '@playwright/test';

test('app shell + corpus listing', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Archean inspector' })).toBeVisible();
  const rows = page.locator('[data-testid^="craft-"]');
  await expect(rows.first()).toBeVisible();
});

test('selecting a craft loads its blueprint summary', async ({ page }) => {
  await page.goto('/');
  const first = page.locator('[data-testid^="craft-"]').first();
  const id = (await first.getAttribute('data-testid'))!.replace('craft-', '');
  await first.click();
  const summary = page.getByTestId('bp-summary');
  await expect(summary).toContainText(/blocks=\d+ components=\d+/);
  await expect(page).toHaveURL(new RegExp(`craft=${id}`));
});

test('?craft= deep link selects directly', async ({ page }) => {
  await page.goto('/');
  const id = (await page.locator('[data-testid^="craft-"]').first()
    .getAttribute('data-testid'))!.replace('craft-', '');
  await page.goto(`/?craft=${id}`);
  await expect(page.getByTestId('bp-summary')).toContainText(/blocks=\d+/);
  await expect(page).toHaveURL(new RegExp(`craft=${id}`));
});

test('corpus endpoint serves the blueprint of a selected craft', async ({ request }) => {
  const listing = await (await request.get('/corpus/')).text();
  const ids = [...listing.matchAll(/href="(\d{6,})\/"/g)].map(m => m[1]!);
  expect(ids.length).toBeGreaterThan(0);
  const bp = await (await request.get(`/corpus/${ids[0]}/blueprint.json`)).json();
  expect(bp.data.blocks.length + bp.data.components.length).toBeGreaterThan(0);
});
