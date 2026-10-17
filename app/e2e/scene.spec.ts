// Headless render suite: the WebGL scene must actually DRAW (draws>0 via
// renderer.info), fit the camera to the craft, and pick — the same contract
// the legacy perf/selftest pins cover, asserted through window.__ARCHEAN__
// instead of pixels. Chromium here renders via SwiftShader — no GPU flags.
import { expect, test } from '@playwright/test';

test('scene loads, renders and self-reports SCENE PASS in the title', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/SCENE PASS blocks=\d+ tris=\d+/, { timeout: 30_000 });
  const stats = page.getByTestId('scene-stats');
  await expect(stats).toContainText(/blocks=[1-9]\d* tris=[1-9]\d*/);
  await expect(stats).toContainText(/draws=[1-9]\d*/);   // renderer actually issued draws
});

test('camera pick hits the craft (block or comp proxy) at the frame centre', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
  const hit = await page.evaluate(() => {
    const w = window as unknown as { __ARCHEAN__?: { pickProbe: () => { kind: string; point?: number[] } } };
    return w.__ARCHEAN__!.pickProbe();
  });
  expect(['block', 'comp']).toContain(hit.kind);
  expect(hit.point).toBeTruthy();
});

test('a real canvas click routes through the pick path into the panel', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
  const canvas = page.getByTestId('canvas');
  const box = (await canvas.boundingBox())!;
  // sweep a small cross at the framed centre until a click lands on the body
  const pts = [[0, 0], [0.1, 0], [-0.1, 0], [0, 0.1], [0, -0.1]];
  let picked = false;
  for (const [dx, dy] of pts) {
    await canvas.click({ position: { x: box.width / 2 + dx * box.width / 2, y: box.height / 2 + dy * box.height / 2 } });
    picked = await page.getByTestId('pick-info').isVisible().catch(() => false);
    if (picked) break;
  }
  expect(picked, 'a centre click must select geometry (pick-info row shows)').toBe(true);
});

test('switching crafts rebuilds the scene (stats change, still renders)', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
  const first = await page.getByTestId('scene-stats').textContent();
  const rows = page.locator('[data-testid^="craft-"]');
  await rows.nth(1).click();
  await expect.poll(async () => {
    const s = await page.getByTestId('scene-stats').textContent();
    return s !== first && /draws=[1-9]\d*/.test(s ?? '');
  }, { timeout: 30_000 }).toBe(true);
});
