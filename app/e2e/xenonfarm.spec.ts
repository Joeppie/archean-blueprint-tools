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
  test('two computers co-run; the beacon radio and the io bus cross them @slow', async ({ page }) => {
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
});
