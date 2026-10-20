// Scene suite: the WebGL scene must DRAW (renderer.info draws>0), pick via
// raycast, and rebuild on craft switch — asserted through window.__ARCHEAN__
// (no pixels). Runs on desktop chromium and Pixel 7 emulation.
import { expect, test } from '@playwright/test';

async function openFirstCraft(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.locator('[data-testid^="card-"]').first().click();
  await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
}

test('scene loads, renders and self-reports SCENE PASS in the title', async ({ page }) => {
  await openFirstCraft(page);
  const stats = page.getByTestId('scene-stats');
  await expect(stats).toContainText(/blocks=[1-9]\d* tris=[1-9]\d*/);
  await expect(stats).toContainText(/draws=[1-9]\d*/);   // renderer actually issued draws
});

test('camera pick hits the craft at the frame centre', async ({ page }) => {
  await openFirstCraft(page);
  const hit = await page.evaluate(() => {
    const w = window as unknown as { __ARCHEAN__?: { pickProbe: () => { kind: string; point?: number[] } } };
    return w.__ARCHEAN__!.pickProbe();
  });
  expect(['block', 'comp']).toContain(hit.kind);
  expect(hit.point).toBeTruthy();
});

test('KSP camera cluster presets snap the eye to axis views and re-fit', async ({ page }) => {
  await openFirstCraft(page);
  const camPos = () => page.evaluate(() =>
    (window as unknown as { __ARCHEAN__?: { engine: { camPos: () => [number, number, number] } } })
      .__ARCHEAN__!.engine.camPos());
  const p0 = await camPos();
  const moved = (p: number[]) => Math.hypot(p[0]! - p0[0]!, p[1]! - p0[1]!, p[2]! - p0[2]!);
  await page.getByTestId('cam-top').click();
  expect(moved(await camPos()), 'top view moved the eye').toBeGreaterThan(1);
  await page.getByTestId('cam-front').click();
  expect(moved(await camPos()), 'front view moved the eye').toBeGreaterThan(1);
  await page.getByTestId('cam-side').click();
  expect(moved(await camPos()), 'side view moved the eye').toBeGreaterThan(1);
  await page.getByTestId('cam-fit').click();
  await expect.poll(camPos).toEqual(p0);                 // fit = the load framing
  await expect(page).toHaveTitle(/SCENE PASS/);
});

test('a real canvas tap routes through the pick path into the info chip', async ({ page }) => {
  await openFirstCraft(page);
  // v1.5 VIEW LOCK: VIEW picks nothing — the pick chip lives in the Edit mode
  await page.getByTestId('mode-edit').click();
  const canvas = page.getByTestId('canvas');
  const box = (await canvas.boundingBox())!;
  const pts = [[0, 0], [0.1, 0], [-0.1, 0], [0, 0.1], [0, -0.1]];
  let picked = false;
  for (const [dx, dy] of pts) {
    await canvas.click({ position: { x: box.width / 2 + dx * box.width / 2, y: box.height / 2 + dy * box.height / 2 } });
    picked = await page.getByTestId('pick-info').isVisible().catch(() => false);
    if (picked) break;
  }
  expect(picked, 'a centre tap must select geometry').toBe(true);
});

test('switching crafts rebuilds the scene (stats change, still renders)', async ({ page }) => {
  await openFirstCraft(page);
  const first = await page.getByTestId('scene-stats').textContent();
  await page.getByTestId('back-to-gallery').click();
  await page.locator('[data-testid^="card-"]').nth(1).click();
  await expect.poll(async () => {
    const s = await page.getByTestId('scene-stats').textContent();
    return s !== first && /draws=[1-9]\d*/.test(s ?? '');
  }, { timeout: 30_000 }).toBe(true);
});

// The DUS Stratolaunch (3509975859, "DHD-773"): 2 370 components. Streaming
// every part's real game model puts the scene at ~9 k geometries / 6.7 k draw
// calls — PERF.md's cliff, which phone GPUs do not survive (user report: the
// craft "fails to render on my mobile phone" while every other craft works).
// The heavy-craft tier keeps painted stand-ins: the phone must still DRAW it,
// at a bounded scene cost. Runs on both projects (desktop + Pixel 7).
test('giant craft renders within a phone budget (heavy tier)', async ({ page }) => {
  await page.goto('/?craft=3509975859');
  await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
  const st = await page.evaluate(() => {
    const w = window as unknown as { __ARCHEAN__?: { stats: () => Record<string, unknown> } };
    return w.__ARCHEAN__!.stats();
  });
  expect(st.comps).toBe(2370);
  expect(st.tier).toBe('lite');
  expect(Number(st.draws)).toBeGreaterThan(0);
  expect(Number(st.draws), 'no real-model fan-out on heavy craft').toBeLessThan(3000);
});
