// xenonhud.spec.ts — HUD blocks + the beacon radio scope (v1.14.0 P9 slice
// A; we: "allow us to edit the code for at least HUDs that are contained
// within a HUD block … make beacons into a seperate tab for computers/huds
// as well, so the globally known scope can be understood … There should
// also be a beacons menu, under xenoncode"). E2E-TIER because: the laws are
// the live DOM over the real blueprint — the HUD IDE saves into the
// craft-baked data.xc_files through the doc path, the radio scope lists the
// craft's REAL beacon frequencies, and a send lands in a listener's log.
// Fixture: the Badger (3326372833) — its HudController (ci 9) carries the
// 999-line guide program with beacon("BADGER-GUIDE-UI-IN","BADGER-GUIDE-UI-
// OUT") and Beacon ci 69 listens on BGR-D60167AC42520437045ED627.
import { expect, test } from '@playwright/test';

const BADGER = '3326372833';

test.describe('HUD blocks + beacon radio @ui', () => {
  test('the HUD IDE edits + saves the block; the beacon scope sends @slow', async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto(`/?craft=${BADGER}`);
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 120_000 });
    await page.getByTestId('xenon-menu').click();
    await page.getByTestId('xenon-hud-9').click();
    const hud = page.getByTestId('hud-dialog');
    await expect(hud).toBeVisible();
    await expect(page.getByTestId('hud-tab-0')).toContainText('main.xc');
    const cm = hud.locator('.cm-content');
    // CM renders the VIEWPORT only (the 999-line file is windowed) — the
    // head text proves the right program opened; the deep beacon() literal
    // is asserted through the beacon scope's frequency chips below.
    await expect(cm).toContainText('pilot-guide', { timeout: 15_000 });

    // edit + save INTO the HUD block (doc path; byte-safe data.xc_files)
    await cm.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n; v114 beacon e2e marker', { delay: 15 });
    await expect(page.getByTestId('hud-dirty')).toContainText('1 unsaved');
    await page.getByTestId('hud-save').click();
    await expect(page.getByTestId('hud-dirty')).toContainText('saved');

    // the beacon scope inside the HUD IDE: the craft's real radio map
    await expect(page.getByTestId('beacon-freq-BGR-D60167AC42520437045ED627')).toBeVisible();
    await expect(page.getByTestId('beacon-freq-BADGER-GUIDE-UI-IN')).toBeVisible();
    // send onto a frequency a Beacon component LISTENS on → its log
    await page.getByTestId('beacon-freq-BGR-D60167AC42520437045ED627').click();
    await page.getByTestId('beacon-data-form').fill('.e2e{1}');
    await page.getByTestId('beacon-send').click();
    await expect(page.getByTestId('beacon-rx-count-beacon-69')).toContainText('1 rx');
    // the avatarsim sensors (a HUD's get("avatar_sensor_*") pool)
    await expect(page.getByTestId('avatarsim-row-avatar_sensor_speed')).toContainText('80.00');

    // close + reopen: the comment persisted in the LIVE blueprint (scroll
    // the fresh editor to its end — CM only renders the viewport)
    await page.getByTestId('hud-close').click();
    await page.getByTestId('xenon-menu').click();
    await page.getByTestId('xenon-hud-9').click();
    const cm2 = page.getByTestId('hud-dialog').locator('.cm-content');
    await expect(cm2).toContainText('pilot-guide', { timeout: 15_000 });
    await cm2.click();
    await page.keyboard.press('Control+End');
    await expect(cm2).toContainText('v114 beacon e2e marker', { timeout: 15_000 });
    await page.getByTestId('hud-close').click();

    // 📡 the Beacon dock, from the XenonCode menu (the global-scope window)
    await page.getByTestId('xenon-menu').click();
    await page.getByTestId('xenon-beacons').click();
    await expect(page.getByTestId('beacon-dock')).toBeVisible();
    await expect(page.getByTestId('beacon-part-beacon-69')).toContainText('BGR');
    await page.getByTestId('beacon-close').click();
  });

  test('the computer IDE carries the Beacons tab @slow', async ({ page }) => {
    test.setTimeout(150_000);
    await page.goto(`/?craft=${BADGER}`);
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 120_000 });
    await page.getByTestId('xenon-menu').click();
    await page.locator('[data-testid^="xenon-comp-"]').first().click();
    await expect(page.getByTestId('xenon-dialog')).toBeVisible();
    await page.getByTestId('xenon-side-beacons').click();
    await expect(page.getByTestId('beacon-freqs')).toBeVisible();
    // the HUD program is a LISTENER in the global scope (intercomputer view)
    await expect(page.getByTestId('beacon-part-hud-9-0')).toContainText('pilot-guide');
    await page.keyboard.press('Escape');
  });
});
