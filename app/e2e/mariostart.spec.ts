// mariostart.spec.ts — THE SEAT TOKEN (v1.17.1, we: "Super Mario won't
// launch … Pressing space doesn't start it using phone pixel 7").
// The Mario cabinet 3820116990 gates EVERY input on
// input_text(seat, 0) != "" — the seated player's identity token the
// in-game seat reports (the shim's user() = 'builder'). Our seat used to
// say nothing, so $seated stayed 0 and space/jump were ignored on every
// profile. THE FIX: the worldsim seat feed publishes PILOT_USER as ch0
// TEXT while the seat reads occupied. e2e-tier because the law is the
// live chain worldsim-row → setInputT → VM text channel → game logic,
// booted with the craft's real program (no fixture can fake the disks).
import { test, expect } from '@playwright/test';

const CRAFT = '3820116990';

test.describe('@mario THE SEAT TOKEN quick start', () => {
  test('a phone tap on the cockpit SPACE pad starts the game @device @slow', async ({ browser }) => {
    test.setTimeout(300_000);
    const ctx = await browser.newContext({ viewport: { width: 412, height: 880 }, hasTouch: true, isMobile: true });
    await ctx.addInitScript(() => {
      localStorage.setItem('archean-app-debug', '1');
      localStorage.setItem('archean-app-backdrop', 'none');
      localStorage.setItem('archean-worldsim', '');
      localStorage.setItem('archean-app-live', 'on');
    });
    const page = await ctx.newPage();
    await page.goto(`/?craft=${CRAFT}`);
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 120_000 });
    // the title caches its sprites one per cycle — inputs are ignored
    // until assetsready; wait for the game itself to say ready
    await page.waitForFunction(() => {
      const vs = (window as any).__ARCHEAN__.xenon.farm.pumps[0]?.vars;
      if (!vs) return false;
      for (const v of vs.values()) if (v.name === 'assetsready') return Number(v.v) === 1;
      return false;
    }, null, { timeout: 150_000 });
    // sit down: fly to the seat, VIEW-click, take 🕹
    const seatCi = await page.evaluate(() => (window as any).__ARCHEAN__.engine.blueprint
      .data.components.findIndex((c: any) => c.type === 'PilotSeat'));
    await page.evaluate((ci) => (window as any).__ARCHEAN__.engine.flyTo(ci), seatCi);
    await page.waitForTimeout(700);
    // the camera SETTLES after flyTo (~1 s); a phone view-click at the
    // centre calls for the seat, retrying a couple of screen heights —
    // same recipe the live probe verified (pick: {kind:comp, ci:seat})
    const canvas = page.locator('canvas').first();
    const sit = page.getByTestId('mode-sit');
    let sat = false;
    for (const y of [300, 440, 600, 380, 520]) {
      await page.evaluate((ci) => (window as any).__ARCHEAN__.engine.flyTo(ci), seatCi);
      await page.waitForTimeout(2200);              // let the flight settle
      await canvas.dispatchEvent('pointerdown', { clientX: 206, clientY: y, bubbles: true, isPrimary: true, pointerId: 1, button: 0, pointerType: 'mouse' });
      await canvas.dispatchEvent('pointerup', { clientX: 206, clientY: y, bubbles: true, isPrimary: true, pointerId: 1, button: 0, pointerType: 'mouse' });
      await page.waitForTimeout(900);
      if (await sit.isVisible().catch(() => false)) { sat = true; break; }
    }
    expect(sat, 'the seat offers 🕹 on a phone view-click').toBe(true);
    await sit.click();
    const win = page.getByTestId(`cockpit-window-${seatCi}`);
    await expect(win).toBeVisible({ timeout: 10_000 });
    // the seat must report its token: the game's occupancy lamp (light)
    // goes OUT exactly when $seated = 1 (the game writes 1 - $seated)
    await expect.poll(() => page.evaluate(() => {
      const v = (window as any).__ARCHEAN__.xenon.farm.bus.get('light', 0);
      return v === undefined || v === null || Number.isNaN(Number(v)) ? -1 : Number(v);
    }), { message: 'the seat publishes the player token (the game writes 1-$seated; 0 = seated)', timeout: 20_000 }).toBe(0);
    // ONE phone-real tap on the space keycap starts it: $mode 0 → 1
    const pad = page.locator('[data-testid^="cockpit-pad-"][data-testid$="-space"]').first();
    const pb = (await pad.boundingBox())!;
    expect(pb.width, 'thumb-sized space bar').toBeGreaterThanOrEqual(30);
    await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(500);
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => {
      const vs = (window as any).__ARCHEAN__.xenon.farm.pumps[0]?.vars;
      for (const v of vs?.values?.() ?? []) if (v.name === 'mode') return Number(v.v);
      return -1;
    }), { message: 'a space tap moves the title ($mode 0 → 1) — the game STARTS', timeout: 20_000 })
      .toBe(1);
    await ctx.close();
  });
});
