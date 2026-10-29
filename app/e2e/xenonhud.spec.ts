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
    await page.getByTestId('hud-side-beacons').click();
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

  // v1.14.1 P9 slice B/D — the HUD RUNTIME: ▶ boots the guide program on
  // the ABI-11 VM, its panel() surfaces BLIT live, its beacon() joins the
  // global scope and its per-cycle transmit lands in the relay Beacon
  // component's rx log (ci 114 listens on BADGER-GUIDE-UI-IN); the dock's
  // send form reaches the HUD's .data on BADGER-GUIDE-UI-OUT.
  // e2e-tier because: the law is VM → canvas pixels + cross-runtime radio
  // delivery — nothing below the browser can see it.
  test('the HUD runtime: live panels + the beacon loop into a component @slow', async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto(`/?craft=${BADGER}`);
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 120_000 });
    await page.getByTestId('xenon-menu').click();
    await page.getByTestId('xenon-hud-9').click();
    await expect(page.getByTestId('hud-dialog')).toBeVisible();
    await page.getByTestId('hud-run').click();
    await expect(page.getByTestId('hud-run-status')).toContainText('ON', { timeout: 30_000 });
    // the guide renders its ACTIVE scale-set (1× at this viewport — the
    // 0×/2× sets sit parked empty, the guide's own scaling law): sum the
    // lit pixels across every panel canvas.
    const canvas = page.getByTestId('hud-panel-canvas-1');
    await expect(canvas).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => page.evaluate(() => {
        let all = 0;
        for (const c of Array.from(document.querySelectorAll(
          '[data-testid^="hud-panel-canvas-"]'))) {
          const cv = c as HTMLCanvasElement;
          if (!cv.width) continue;
          const d = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data;
          for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 90) all++;
        }
        return all;
      }), { message: 'the HUD panel canvases paint', timeout: 30_000 })
      .toBeGreaterThan(1000);
    // the radio loop: the guide transmits on BADGER-GUIDE-UI-IN while it
    // is RECEIVING (the game's gate) — send to its rx first, the RELAY
    // Beacon component (ci 114, rx = BADGER-GUIDE-UI-IN) then logs echoes
    await page.getByTestId('hud-side-beacons').click();
    await expect(page.getByTestId('beacon-freq-BADGER-GUIDE-UI-OUT')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('beacon-freq-BADGER-GUIDE-UI-OUT').click();
    await page.getByTestId('beacon-data-form').fill('.g{1}.s{E2E}');
    await page.getByTestId('beacon-send').click();
    // delivery opens the guide's is_receiving window (2 s); a g{1}-packet
    // with a session passes its radio gate → it transmits its page packet
    // → the relay's log fills
    await expect(page.getByTestId('beacon-rx-count-beacon-114'))
      .toContainText(/([1-9]\d*) rx/, { timeout: 30_000 });
    // and the HUD's own radio is LIVE in the global scope (runtime-merged)
    await expect(page.getByTestId('beacon-part-hud-9-0')).toContainText('BADGER-GUIDE-UI-IN');
    // a fresh session key makes the guide answer immediately again
    await page.getByTestId('beacon-freq-BADGER-GUIDE-UI-OUT').click();
    await page.getByTestId('beacon-data-form').fill('.g{1}.s{E2E2}');
    await page.getByTestId('beacon-send').click();
    await expect(page.getByTestId('beacon-rx-count-beacon-114'))
      .toContainText(/([2-9]|\d\d) rx/, { timeout: 30_000 });
    await page.getByTestId('hud-stop').click();
    await expect(page.getByTestId('hud-run-status')).toContainText('off');
    await page.getByTestId('hud-close').click();
  });
});
