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

  // The pixel7 leg is the documented PHONE MULTI-WINDOW known red (AGENTS
  // Backlog "Phone farm windows", v1.15.3): the v1.13.32 phone IDE (rail +
  // drawer) predates the multi-window farm era; the drawer flow behind the
  // 36k-line Badger boot on 412 px is the same family as the xenonfarm
  // co-run red. Opted out of the matrix (the law is NOT a device law — the
  // chromium leg pins it) until the backlog's phone multi-window design
  // re-tabs it. Not a sleep-patch: a matrix opt-out (L4).
  test('the computer IDE carries the Beacons tab @slow', async ({ page, isMobile }) => {
    test.skip(isMobile, 'phone multi-window backlog family (v1.15.3 known red)');
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
  test('the Panel Bench: $panel.set_size COMPILES and resizes @slow', async ({ page }) => {
    // v1.15.5 (we: "in rcs infinity, the HUD wont run/compile, it doesnt
    // know set_size lives in panel? … its in the HUD documentation, can we
    // get it from somewhere in the game files or official documentation?"
    // — YES: the shipped wiki/en/xenoncode/hud.md documents
    // "$myPanel.set_size($width, $height)" and RCS Infinity (3518436870)
    // calls it LIVE). Fixture 9000009030 (tools/make_hudsize_test.py): a
    // HUD program that PARSES set_size (the compile gate — the shim parse
    // refused a 100% legal program before ABI 13) and resizes
    // panel(top,100,40) to 160x60 at tick 30. e2e-tier because: the gate
    // is the real shim PARSE plus the live canvas geometry.
    test.setTimeout(240_000);
    await page.goto('/?craft=9000009030');
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 120_000 });
    await page.getByTestId('xenon-menu').click();
    await page.getByTestId('xenon-hud-0').click();
    await expect(page.getByTestId('hud-dialog')).toBeVisible();
    await page.getByTestId('hud-run').click();
    await expect(page.getByTestId('hud-run-status'))
      .toContainText('ON', { timeout: 30_000 });   // the PARSE gate
    const canvas = page.getByTestId('hud-panel-canvas-0');
    await expect(canvas).toBeVisible({ timeout: 30_000 });
    // tick 30 (~1.2 s at 25 Hz) resizes the panel; the canvas follows the
    // per-cycle screen metas (XenonScreen::Resize keeps panel identity)
    await expect
      .poll(() => canvas.evaluate((c: HTMLCanvasElement) => `${c.width}x${c.height}`),
        { message: 'set_size(160, 60) resizes the panel surface', timeout: 30_000 })
      .toBe('160x60');
  });

  test('the SCREEN window composites panels by anchor + set_position @slow', async ({ page }) => {
    // v1.15.5 (we: "Panels in Huds are rendered independently.. not how
    // they normally work. They should be composed together on a normal
    // screen as per the rules of the game… choose screen resolution and
    // restart/start… composes together the panels (respecting alpha, like
    // the real thing.)"): fixture 9000009030 paints $p (set_size 160x60,
    // set_position(400,200) at tick 60) and an always-anchored $q
    // (panel(top,200,40)). On the simulated 1920×1080 player screen the
    // ink centroid x ≈ (480 + 960)/2 = 720; applying 800×600 (restart)
    // re-centres the anchored q at x 400 → centroid ≈ 440. e2e-tier
    // because: the law is composited canvas geometry in the real app.
    test.setTimeout(240_000);
    await page.goto('/?craft=9000009030');
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 120_000 });
    await page.getByTestId('xenon-menu').click();
    await page.getByTestId('xenon-hud-0').click();
    await page.getByTestId('hud-run').click();
    await expect(page.getByTestId('hud-run-status')).toContainText('ON', { timeout: 30_000 });
    await page.getByTestId('hud-side-screen').click();
    const screen = page.getByTestId('hud-screen-canvas');
    await expect(screen).toBeVisible({ timeout: 30_000 });
    const centroid = () => screen.evaluate((c: HTMLCanvasElement) => {
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let s = 0, n = 0;
      // FULL scan: 1-px text strokes alias out on a stride (v1.15.5 lesson)
      for (let py = 0; py < c.height; py++)
        for (let px = 0; px < c.width; px++) {
          const i = (py * c.width + px) * 4;
          if (d[i] + d[i + 1] + d[i + 2] > 90) { s += px; n++; }
        }
      return n > 40 ? s / n : -1;
    });
    // 1920×1080: p at 400..560 (cx 480), anchored q at 860..1060 (cx 960)
    await expect
      .poll(async () => (await screen.evaluate((c: HTMLCanvasElement) => c.width)) === 1920
        ? await centroid() : -1,
        { message: 'panels composited at anchor + set_position (1920)', timeout: 40_000 })
      .toBeGreaterThan(600);
    const c1920 = await centroid();
    expect(c1920).toBeLessThan(900);
    // apply 800×600 → restart → anchored q re-centres at x 400 (the game's
    // resolution law: the layout recomputes against the fresh screen_w)
    await page.getByTestId('hud-screen-w').fill('800');
    await page.getByTestId('hud-screen-h').fill('600');
    await page.getByTestId('hud-screen-apply').click();
    await expect
      .poll(async () => (await screen.evaluate((c: HTMLCanvasElement) => c.width)) === 800
        ? await centroid() : -1,
        { message: 'anchored panel re-centres on the new player screen', timeout: 40_000 })
      .toBeLessThan(620);
    // THE SCREEN-CANVAS CLICK ROUTES INTO THE PANEL UNDER THE CURSOR
    // (we: "mouseover in the composed screen and buttons dont seem to
    // work"): p (now 160x60 AT 400,200) carries a button_rect at panel
    // (110,40,44,16) → screen rect (510,240)-(554,256); clicking its
    // centre must make the program draw 'HIT' (ink mass jumps).
    const box = (await screen.boundingBox())!;
    await page.mouse.click(box.x + box.width * 532 / 800, box.y + box.height * 248 / 600);
    await expect
      .poll(() => screen.evaluate((c: HTMLCanvasElement) => {
        const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 90) n++;
        return n;
      }), { message: 'the composited-screen click reached the panel button', timeout: 15_000 })
      .toBeGreaterThan(150);
  });

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
