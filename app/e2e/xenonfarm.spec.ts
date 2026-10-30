// xenonfarm.spec.ts — the COMPUTER FARM end to end (v1.15.0 P9 slice C;
// we: "multiple computers running at the same time … communicate over
// their inputs/outputs … vital to test Chip's ChipOS"). Fixture: the
// INTERCOM BENCH (tools/make_farm_test.py → 9000009010): 'post' transmits
// on beacon frequency INTERCOM and pulses the shared lamp; 'listen' hears
// the radio (radio-led row) and mirrors the lamp channel (mirror row).
// E2E-TIER because: two REAL VMs cycling together on one page over the
// shared bus — nothing below the browser has two pumps.
import { expect, test } from '@playwright/test';

const FARM = '9000009010';

test.describe('Xenon computer farm @ui', () => {
  // [pixel7] opted out (AGENTS Backlog "Phone farm windows", v1.15.3 known
  // red): two cascading IDE windows do not fit the 412-px viewport — the
  // v1.13.32 phone IDE predates the multi-window farm; the backlog's phone
  // multi-window UX design re-tabs this leg. The law is not a device law:
  // the chromium leg owns it (matrix opt-out per L4, not a sleep-patch).
  test('two computers co-run; the beacon radio and the io bus cross them @slow', async ({ page, isMobile }) => {
    test.skip(isMobile, 'phone multi-window backlog family (v1.15.3 known red)');
    test.setTimeout(240_000);
    await page.goto(`/?craft=${FARM}`);
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 120_000 });

    // window A: 'post' boots
    await page.getByTestId('xenon-menu').click();
    await page.getByTestId('xenon-comp-0').click();
    await expect(page.getByTestId('xenon-on')).toHaveText('ON', { timeout: 90_000 });

    // window B: 'listen' boots — BOTH stay ON (slice C: no mutual kill)
    await page.getByTestId('xenon-menu').click();
    await page.getByTestId('xenon-comp-1').click();
    await expect(page.getByTestId('xenon-dialog')).toHaveCount(2);
    await expect(page.getByTestId('xenon-on')).toHaveText(['ON', 'ON'], { timeout: 90_000 });

    // the farm audit: two VMs, both cycling (poll: B booted moments ago)
    const farm = await page.evaluate(() => (window as any).__XENON__().farm);
    expect(farm.length).toBe(2);
    await expect
      .poll(() => page.evaluate(() =>
        (window as any).__XENON__().farm.every((f: { cycles: number }) => f.cycles > 20)),
        { message: 'both VMs cycling', timeout: 30_000 })
      .toBeTruthy();

    // B's bus tab: the RADIO crossed from A (radio-led row) and the io
    // bus crossed (mirror row — B's program saw A's lamp write)
    await page.getByTestId('xenon-side-bus').nth(1).click();
    const busRows = page.locator('[data-testid^="xenon-bus-"]');
    await expect(busRows.filter({ hasText: 'radio-led' }).first())
      .toBeVisible({ timeout: 60_000 });
    await expect(busRows.filter({ hasText: 'mirror' }).first())
      .toBeVisible({ timeout: 60_000 });

    // closing ONE window leaves the SISTER running (independent VMs)
    await page.locator('[data-testid="xenon-close"]').first().click();
    await expect(page.getByTestId('xenon-dialog')).toHaveCount(1);
    await expect(page.getByTestId('xenon-on')).toHaveText('ON', { timeout: 30_000 });
    await page.keyboard.press('Escape');
  });

  test('a dock-only deep-link load feeds the 3-D faces (FARM-MOUNT LAW) @slow', async ({ page }) => {
    // e2e-tier because: the law is a REAL scene texture fed by a REAL farm
    // pump booted by the dock's own effect AFTER the 3-D hook effect
    // mounted on an EMPTY farm — the v1.15.0 Space-Invaders regression
    // (the gallery PLAYABLE card path: no Xenon IDE window is ever opened,
    // the craft's physical screens stayed gray while the dock painted).
    test.setTimeout(240_000);
    await page.goto('/?craft=3294880085&dash=trimsdash%230');
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 120_000 });
    // the dock's zoom window opens by itself (the deep link) — the pump
    // runs and its canvases blit (that half never broke)
    await expect(page.getByTestId('screens-cell-trimsdash#0-fullcanvas'))
      .toBeVisible({ timeout: 120_000 });
    // THE LAW: the pump created after the effect mounted carries the
    // cycle hook → the scene's face texture is pushed EVERY cycle
    await expect
      .poll(() => page.evaluate(() =>
        (window as any).__ARCHEAN__.engine.pushCounts.get('trimsdash#0') ?? 0),
        { message: 'the dock-booted farm pump pushes the 3-D face', timeout: 60_000 })
      .toBeGreaterThan(20);
  });
});
