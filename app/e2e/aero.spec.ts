// aero.spec.ts — the WIND TUNNEL (engine/aero.ts): the Wind mode tile opens
// the workspace, the multigrid solve CONVERGES with real streamlines over
// the collider shape field (blocks + occupancies), the direction buttons
// retarget the flow, and leaving the mode tears the tunnel down. Physics
// itself is pinned in depth in the pure vitest suite (aero.test.ts).
import { expect, test, type Page } from '@playwright/test';

const ISW = '3812927875';

type WindState = {
  on: boolean; running: boolean; converged: boolean; iters: number; res: number;
  lines: number; segments: number; voxel: number; solid: number;
  flow: number[]; report: { frontalArea: number; dragCd: number; liftArea: number } | null;
};
const wind = (page: Page) => page.evaluate(() =>
  (window as unknown as { __ARCHEAN__?: { wind: () => WindState } }).__ARCHEAN__!.wind());

async function waitConverged(page: Page, timeout = 40_000) {
  await expect(async () => {
    const s = await wind(page);
    expect(s.converged).toBe(true);
  }).toPass({ timeout, intervals: [250, 500] });
}

/** v1.11: there is NO side drawer anymore (we: "no more side panel") —
 *  everything the drawer held (catalog, parts list, inspector, Info, the
 *  flight/wind panels) lives in the always-visible bottom dock. */
async function setDrawer(_page: Page, _want = true) { /* no-op */ }

test.describe('wind tunnel @aero @slow', () => {
  test('Wind mode solves the field and draws streamlines', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto(`/?craft=${ISW}`);
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
    await page.getByTestId('mode-aero').click();
    await setDrawer(page, true);
    await expect(page.getByTestId('wind-flows')).toBeVisible();

    let s = await wind(page);
    expect(s.on).toBe(true);
    expect(s.solid).toBeGreaterThan(200);           // the collider field is real
    await waitConverged(page);
    s = await wind(page);
    expect(s.lines).toBeGreaterThan(20);            // streamlines drew
    expect(s.segments).toBeGreaterThan(s.lines);
    expect(s.report).not.toBeNull();
    expect(s.report!.frontalArea).toBeGreaterThan(0.5);
    expect(s.report!.dragCd).toBeGreaterThan(0);
    expect(s.report!.dragCd).toBeLessThanOrEqual(1);

    // retarget: wind from BELOW — the solve restarts and reconverges
    await page.getByTestId('wind-flow-up').click();
    await expect(async () => {
      const t = await wind(page);
      expect(t.flow).toEqual([0, -1, 0]);
      expect(t.converged).toBe(true);
      expect(t.lines).toBeGreaterThan(20);
    }).toPass({ timeout: 40_000, intervals: [300, 600] });

    // status panel reads live
    await expect(page.getByTestId('wind-status')).toContainText('converged');
    await setDrawer(page, false);

    // leaving the mode tears the tunnel down
    await page.getByTestId('mode-view').click();
    await expect.poll(() => wind(page).then(x => x.on)).toBe(false);
  });

  test('FLIGHT ANALYSIS: the shape-field forces section renders verdicts ' +
    'on a real craft (v1.16.11, engine/flightlab.ts)', async ({ page }) => {
    test.setTimeout(120_000);
    // the dolphin — a known-good glider shape in the corpus
    await page.goto(`/?craft=${ISW}`);
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
    await page.getByTestId('mode-aero').click();
    await expect(page.getByTestId('flight-sec')).toBeVisible({ timeout: 30_000 });
    // the analysis runs on the blueprint directly (no solve gate): a
    // verdict chip, a finite mass and a frontal area appear
    await expect(page.getByTestId('flight-verdict')).toBeVisible({ timeout: 60_000 });
    const verdict = (await page.getByTestId('flight-verdict').innerText())
      .trim().toLowerCase();          // ksp-btn renders upper-case
    expect(['pitch stable', 'pitch neutral', 'pitch unstable']).toContain(verdict);
    await expect(page.getByTestId('flight-margin')).toContainText('MAC');
    await expect(page.getByTestId('flight-stall')).toContainText(/m\/s|no wing/);
    await expect(page.getByTestId('flight-curve')).toBeVisible();
    // the speed field re-runs the census live (ρ + authority scale with it)
    await page.getByTestId('flight-speed').fill('200');
    await page.getByTestId('flight-speed').press('Enter');
    await expect(page.getByTestId('flight-authority')).toBeVisible();
  });
});
