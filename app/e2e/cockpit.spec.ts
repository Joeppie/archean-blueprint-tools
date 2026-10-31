// cockpit.spec.ts — THE COCKPIT WINDOW (v1.16.14, the user: "'sit' in
// cockpits (simultaneously with others) which opens a small control window
// that allow us to send all inputs (and lock sending inputs using a
// button; …; a checkbox sets repeat, pressing a button keeps it pressed
// in that case …); also 1-0 should be on there as these are 'aux'
// channels"). The Space Invaders arcade (3288012440) is the seat corpus:
// a PilotSeat cabled to the computer, stick channels + the aux ladder.
// The VIEW-click code access rides the same widget (⌨ on computers/HUDs).
import { test, expect } from '@playwright/test';

const CRAFT = '9000009091';   // the SEAT BENCH: seat→aileron direct

test.describe('@cockpit @ui THE COCKPIT WINDOW', () => {
  test('⌨ on the view-click; 🕹 sits; pads send, repeat latches, the lock mutes the keyboard',
    async ({ page }) => {
      test.setTimeout(240_000);
      test.slow();   // @slow: real cockpit plumbing on a corpus craft
      await page.goto(`/?craft=${CRAFT}`);
      await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 60_000 });

      // boot the seat's computer (the pump binds the seat channels)
      await page.getByTestId('xenon-menu').click();
      const item = page.locator('[data-testid^="xenon-comp-"]').first();
      await expect(item).toBeVisible();
      await item.click();
      const chip = page.getByTestId('xenon-mode');
      await expect
        .poll(() => chip.getAttribute('data-cycles').then(v => +(v ?? '0')),
          { timeout: 40_000 })
        .toBeGreaterThan(3);
      // keep the FARM alive across the IDE close (live=off law: the VMs
      // close with the LAST IDE window AND the Screens tab) — the cockpit
      // window needs the pump's worldsim rows
      await page.getByTestId('screens-btn').click();
      await expect(page.getByTestId('screens-dock')).toBeVisible({ timeout: 15_000 });
      await page.getByTestId('xenon-close').click();

      // fly to the PilotSeat, VIEW-click it → the action widget carries ⌨
      // for computers/HUDs and 🕹 for the seat (view stays inspect-only)
      const seatCi = await page.evaluate(() => {
        const bp = (window as any).__ARCHEAN__.engine.blueprint;
        return bp.data.components.findIndex((c: any) => c.type === 'PilotSeat');
      });
      expect(seatCi).toBeGreaterThanOrEqual(0);
      await page.evaluate((ci) => (window as any).__ARCHEAN__.engine.flyTo(ci), seatCi);
      await page.waitForTimeout(600);
      const canvas = page.locator('canvas').first();
      const box = await canvas.boundingBox();
      expect(box).toBeTruthy();
      await canvas.click({ position: { x: box!.width / 2, y: box!.height / 2 } });
      const sit = page.getByTestId('mode-sit');
      await expect(sit, 'the seat widget offers 🕹 (view click, inspect-only)')
        .toBeVisible({ timeout: 5_000 });
      await sit.click();

      const win = page.getByTestId(`cockpit-window-${seatCi}`);
      await expect(win).toBeVisible();
      // the seat's channels laid out (label prefix `PilotSeat · `)
      const rollVal = page.getByTestId('cockpit-val-roll');
      await expect(rollVal, 'the seat publishes a roll channel')
        .toBeVisible({ timeout: 10_000 });

      // REPEAT + pad click LATCHES: E (roll +) keeps sending 1
      await page.getByTestId(`cockpit-repeat-${seatCi}`).check();
      const padE = page.getByTestId('cockpit-pad-pilotseat-e');
      await expect(padE).toBeVisible();
      await padE.dispatchEvent('pointerdown');
      await expect
        .poll(() => rollVal.evaluate(el => (el as HTMLElement).style.width),
          { timeout: 5_000, message: 'a latched pad sends +1' })
        .toBe('50%');
      // (the aileron check runs while ROLL is still latched — see below)
      // NOSE WHEEL STEERING (we: "nor qe on its nosewheel"): steering rides
      // the Left/Right channel — D latched feeds the wheel's Steer channel
      // (two seat cables land Accelerate then Steer on the wheel port)
      const padD = page.getByTestId('cockpit-pad-pilotseat-d');
      await padD.dispatchEvent('pointerdown');           // latch Left/Right +1
      const wheelCi = await page.evaluate(() => {
        const bp = (window as any).__ARCHEAN__.engine.blueprint;
        return bp.data.components.findIndex((c: any) => c.type === 'SmallWheel');
      });
      expect(wheelCi).toBeGreaterThanOrEqual(0);
      await expect
        .poll(() => page.evaluate((ci) =>
          (window as any).__ARCHEAN__.engine.simVisualState(ci).steer, wheelCi),
        { timeout: 5_000, message: 'the nose wheel takes the Steer channel' })
        .toBeGreaterThan(0.5);
      await padD.dispatchEvent('pointerdown');           // unlatch
      // RCS FIRING (we: "RCS and aileron inputs … dont visually result in
      // actions"): the seat's Yaw cable drives a nozzle — the proxy glows
      const padL = page.getByTestId('cockpit-pad-pilotseat-l');
      await padL.dispatchEvent('pointerdown');           // latch Yaw +1
      const rcsCi = await page.evaluate(() => {
        const bp = (window as any).__ARCHEAN__.engine.blueprint;
        return bp.data.components.findIndex((c: any) => c.type === 'RCS');
      });
      expect(rcsCi).toBeGreaterThanOrEqual(0);
      await expect
        .poll(() => page.evaluate((ci) =>
          (window as any).__ARCHEAN__.engine.simVisualState(ci).glow, rcsCi),
        { timeout: 5_000, message: 'the cabled nozzle fires (proxy glow)' })
        .toBeGreaterThan(0.2);
      await padL.dispatchEvent('pointerdown');           // unlatch

      // the aux ladder: digit pads 1..0 are on the window (keyboard row)
      await expect(page.getByTestId('cockpit-pad-pilotseat-digit1')).toBeVisible();
      await expect(page.getByTestId('cockpit-pad-pilotseat-digit0')).toBeVisible();
      // THE SEAT→SURFACE CABLE (v1.16.15, we: "im sending to an aileron,
      // but I dont see effect"): this bench cables the seat's ROLL channel
      // straight to an Aileron — the latched Q above must have swung it
      const ailCi = await page.evaluate(() => {
        const bp = (window as any).__ARCHEAN__.engine.blueprint;
        return bp.data.components.findIndex((c: any) => c.type === 'Aileron');
      });
      expect(ailCi).toBeGreaterThanOrEqual(0);
      const swing = await page.evaluate(([ci, jn]) =>
        (window as any).__ARCHEAN__.jointPoseQ(ci, jn) as number[] | null,
      [ailCi, 'joint'] as const);
      expect(swing, 'the seat channel deflected the cabled aileron').toBeTruthy();
      const deg = (2 * Math.acos(Math.min(1, Math.abs(swing![0]!))) * 180) / Math.PI;
      expect(deg, `aileron deflected ${deg.toFixed(1)}°`).toBeGreaterThan(20);

      await padE.dispatchEvent('pointerdown');           // unlatch ROLL
      await expect
        .poll(() => rollVal.evaluate(el => (el as HTMLElement).style.width),
          { timeout: 5_000, message: 'the second click releases' })
        .toBe('0%');

      // 🔒 LOCK: the keyboard sends nothing while locked…
      await page.getByTestId(`cockpit-lock-${seatCi}`).check();
      await page.locator('body').click({ position: { x: 5, y: 5 } });
      await page.keyboard.down('e');
      await page.waitForTimeout(350);
      expect(await rollVal.evaluate(el => (el as HTMLElement).style.width)).toBe('0%');
      await page.keyboard.up('e');
      // …and sends the stick (down = +1, up = centers) when unlocked
      await page.getByTestId(`cockpit-lock-${seatCi}`).uncheck();
      await page.keyboard.down('e');
      await expect
        .poll(() => rollVal.evaluate(el => (el as HTMLElement).style.width),
          { timeout: 5_000, message: 'unlocked keyboard sends +1' })
        .toBe('50%');
      await page.keyboard.up('e');
      await expect
        .poll(() => rollVal.evaluate(el => (el as HTMLElement).style.width),
          { timeout: 5_000, message: 'release centers the stick' })
        .toBe('0%');
    });
});
