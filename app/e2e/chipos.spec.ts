// chipos.spec.ts — THE APPKIT BUS end to end (v1.16.10 WP1, we: "ChipOS's
// Tetris is offered to a ChipOS main installation … it should be able to
// read the appkit widget, and the tetris application should consequently
// become available in the computer"). Fixture: the CHIPOS BENCH
// (tools/make_chipos_test.py → 9000009050) — the REAL ChipOS v0.41b OS,
// App TETRIS, App HELLO (+ EarthNAV) on one MiniRouter bench.
// E2E-TIER because: four REAL VMs auto-booted with the craft on one page,
// the appkit protocol crossing pumps over the shared bus, and the results
// surface in the IDE bus rows the builder reads.
import { expect, test } from '@playwright/test';

const BENCH = '9000009050';

test.describe('ChipOS appkit ecosystem @ChipOS', () => {
  test('the apps auto-boot and their manifests cross the bus to ChipOS @slow', async ({ page, isMobile }) => {
    test.skip(isMobile, 'desktop farm windows (xenonfarm family)');
    test.setTimeout(300_000);
    await page.goto(`/?craft=${BENCH}`);
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 180_000 });

    // The auto-boot ran with the craft (LIVE default on, the bench grid
    // powers every computer). Open the chipos window — the OS VM.
    await page.getByTestId('xenon-menu').click();
    await page.getByTestId('xenon-comp-0').click();
    await expect(page.getByTestId('xenon-on')).toHaveText('ON', { timeout: 120_000 });

    // Open TETRIS (app-1): its bus tab shows the manifest riding out on
    // the "chipos" channel — the appkit's offer to the main installation.
    await page.getByTestId('xenon-menu').click();
    await page.getByTestId('xenon-comp-1').click();
    const dialogs = page.getByTestId('xenon-dialog');
    await expect(dialogs).toHaveCount(2);
    await expect(page.getByTestId('xenon-on')).toHaveText(['ON', 'ON'], { timeout: 120_000 });
    await page.getByTestId('xenon-side-bus').nth(1).click();
    const busRows = page.locator('[data-testid^="xenon-bus-"]');
    await expect(busRows.filter({ hasText: '.kit{' }).filter({ hasText: 'TETRIS' }).first())
      .toBeVisible({ timeout: 60_000 });

    // chipos's bus tab: the OS answers the net — its relay assert lands
    // (db_assert drives "LV Switch" ON after the 3 s scan)
    await page.getByTestId('xenon-side-bus').nth(0).click();
    await expect(busRows.filter({ hasText: 'LV Switch' }).first())
      .toBeVisible({ timeout: 60_000 });

    // THE REGISTRY's engine room: the OS VM keeps cycling beside the
    // app VM (the appkit scan/heartbeat law runs on the 25 Hz clock)
    const reg: string[] = await page.evaluate(() => {
      const farm = (window as any).__XENON__().farm;
      return farm.map((f: { comp: string; cycles: number }) => `${f.comp}:${f.cycles}`);
    });
    expect(reg.length, 'chipos + tetris (+ hello, + earthnav) co-run').toBeGreaterThanOrEqual(2);
    expect(reg.some(r => /^chipos:\d{20,}$/.test(r)), `farm cycles: ${reg}`).toBeTruthy();
  });

  test('the power flow chip reads the bench grid @ui', async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto(`/?craft=${BENCH}`);
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 180_000 });
    // battery + RTG grid: the chip rides the header
    const chip = page.getByTestId('energy-chip');
    await expect(chip).toBeVisible({ timeout: 60_000 });
    await expect(chip).toContainText('🔋100%');
    await chip.click();
    const panel = page.getByTestId('energy-panel');
    await expect(panel).toContainText('RTG');
    await expect(panel).toContainText('MiniComputer');
  });
});
