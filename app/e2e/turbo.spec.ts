// turbo.spec.ts — TURBO ×4 (v1.16.13, the user: "we need a turbo button for
// xenoncode so it runs at 4x speed temporarily; this makes debugging easier
// and even our tests could run faster"): the pump cadence 25 → 100 Hz with
// the shim's virtual dt frozen at 40 ms — the program's own clock
// (time/tick/timer sections, animations) advances 4× per real second
// (emulator turbo, NOT a finer dt). Buttons: the IDE title ⚡, the ▣ SCREENS
// dock ⚡ (farm-wide), the Xenon menu ⚡, the HUD IDE ⚡. Session-only: a
// re-booted pump runs 1×. The IDE's data-cycles attribute (10 Hz notify
// cadence) is the rate observable; margins keep loaded runners honest.
import { test, expect, type Page, type Locator } from '@playwright/test';

const PLANE = '3294880085';

async function openIde(page: Page): Promise<Locator> {
  await page.goto(`/?craft=${PLANE}`);
  await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 60_000 });
  await page.getByTestId('xenon-menu').click();
  await page.locator('[data-testid^="xenon-comp-"]').first().click();
  const chip = page.getByTestId('xenon-mode');
  await expect(chip).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() => chip.getAttribute('data-cycles').then(v => +(v ?? '0')),
      { timeout: 40_000, message: 'the pump boots and cycles' })
    .toBeGreaterThan(3);
  return chip;
}

async function delta(chip: Locator, ms: number): Promise<number> {
  const a = +(await chip.getAttribute('data-cycles') ?? '0');
  await new Promise(r => setTimeout(r, ms));
  const b = +(await chip.getAttribute('data-cycles') ?? '0');
  return b - a;
}

test.describe('@turbo @ui TURBO ×4', () => {
  test('the IDE ⚡ quadruples the cycle rate; the menu mirrors it', async ({ page }) => {
    test.setTimeout(150_000);
    const chip = await openIde(page);
    const base = await delta(chip, 1500);
    expect(base, 'baseline 25 Hz keeps cycling').toBeGreaterThanOrEqual(15);
    expect(base, 'baseline is not pre-turboed').toBeLessThan(60);
    await page.getByTestId('ide-turbo').click();
    await expect(chip).toHaveAttribute('data-turbo', '1');
    const fast = await delta(chip, 1500);
    expect(fast, `turbo ≈4× (${base} → ${fast})`).toBeGreaterThan(base * 2.2);
    // the Xenon menu mirrors the farm-wide state (label only — no click).
    // Desktop-only affordance: the phone TopBar menu renders Item hints
    // inline (label+hint concatenate), the mirror law is the desktop row.
    if ((page.viewportSize()?.width ?? 0) >= 768) {
      await page.getByTestId('xenon-menu').click();
      await expect(page.getByTestId('xenon-menu-turbo')).toContainText('RUNNING');
      await page.getByTestId('xenon-menu').click();   // TOGGLE closed (Escape
      // is the IDE's key; the TopBar menu closes on its button/outside click)
    }
    // off again (session toggle, not a latch)
    await page.getByTestId('ide-turbo').click();
    await expect(chip).toHaveAttribute('data-turbo', '0');
    const back = await delta(chip, 1500);
    expect(back, 'off returns to ~25 Hz').toBeLessThan(60);
  });

  test('the ▣ SCREENS dock ⚡ toggles every running pump', async ({ page }) => {
    test.setTimeout(150_000);
    // the ▣ top-bar row lives in the phone overflow menu — the farm-wide
    // law is platform-neutral, one project proves it
    test.skip((page.viewportSize()?.width ?? 0) < 768, 'desktop TopBar dock row');
    const chip = await openIde(page);
    await page.getByTestId('screens-btn').click();
    await expect(page.getByTestId('screens-dock')).toBeVisible();
    await page.getByTestId('screens-turbo').click();
    await expect(chip).toHaveAttribute('data-turbo', '1');
    const fast = await delta(chip, 1500);
    expect(fast, 'the dock turbo drives the IDE pump too').toBeGreaterThan(60);
    await page.getByTestId('screens-turbo').click();
    await expect(chip).toHaveAttribute('data-turbo', '0');
  });
});
