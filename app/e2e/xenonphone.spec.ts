// xenonphone.spec.ts — THE XENON IDE ON A PHONE (v1.13.32, we: "On mobile,
// opening code I can't read it, scroll through it, the bars and such should
// be collapsible sideways to make room, also scrolling should be possible to
// make it possible to use the coder"). E2E-TIER because: the laws are the
// touch viewport's LAYOUT (rail vs side-by-side split, fullscreen window)
// and the CodeMirror scroller's real scrollability + touch-action — jsdom
// has neither layout nor scrolling. Opt-IN to the pixel7 project (the phone
// laws are device-conditional, so the chromium leg SKIPs, L4 matrix law).
import { expect, test } from '@playwright/test';

const PLANE = '3294880085';

test.describe('Xenon IDE on the phone', () => {
  // Phone laws need the Pixel 7 project's viewport + touch (L4) — the
  // isMobile fixture is set by devices['Pixel 7'] only.
  test.skip(({ isMobile }) => !isMobile, 'phone law — pixel7 project only');

  test('the IDE collapses its bars sideways and the code scrolls @slow', async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto(`/?craft=${PLANE}`);
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 180_000 });
    await page.getByTestId('xenon-menu').click();
    await page.locator('[data-testid^="xenon-comp-"]').first().click();
    const ide = page.getByTestId('xenon-dialog');
    await expect(ide).toBeVisible({ timeout: 30_000 });

    // THE WINDOW IS FULLSCREEN (FloatingWindow fullNarrow — its header is
    // the window's first child; NO cursor-move on phones, not draggable)
    // and its title bar carries the debugger (phones have no F-keys):
    await expect(ide).toHaveCSS('position', 'fixed');
    const titlebar = ide.locator('> div').first();
    await expect(titlebar.locator('[data-testid="ide-stop"]')).toBeVisible();
    // the desktop-only menu-bar status text collapses away
    await expect(page.getByText(/CTRL\+S save\+reboot/)).toBeHidden();

    // COLLAPSED SIDE PANEL: the CODE pane owns (almost) the whole width —
    // the panel rides the right-edge RAIL, not a 50 % split.
    const rail = page.getByTestId('xenon-side-rail');
    await expect(rail).toBeVisible();
    const code = page.getByTestId('xenon-code-0');
    await expect(code).toBeVisible();
    const cb = await code.boundingBox();
    const vw = page.viewportSize()!.width;
    expect(cb!.width, `code pane ${cb?.width} of viewport ${vw}`).toBeGreaterThan(vw * 0.85);

    // the drawer opens from the rail on the tapped tab and CLOSES sideways
    await rail.getByTestId('xenon-rail-vars').click();
    await expect(page.getByTestId('xenon-globals-head')).toBeVisible();
    await page.getByTestId('xenon-side-close').click();
    await expect(rail).toBeVisible();

    // SCROLLING: the CodeMirror scroller overflows, takes a wheel/touch
    // pan, and its touch-action allows the finger
    const sc = page.locator('.cm-scroller');
    await expect(sc).toBeVisible();
    expect(await sc.evaluate(el => getComputedStyle(el).touchAction)).toContain('pan-y');
    expect(await sc.evaluate(el => el.scrollHeight - el.clientHeight)).toBeGreaterThan(40);
    await sc.boundingBox().then(b => page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height / 2));
    await page.mouse.wheel(0, 300);
    await expect
      .poll(() => sc.evaluate(el => el.scrollTop), { message: 'the code pans' })
      .toBeGreaterThan(0);

    // the title-bar debugger WORKS by touch: ⏹ parks (ON → OFF), ▶ runs
    await expect(page.getByTestId('xenon-on')).toHaveText('ON', { timeout: 60_000 });
    await titlebar.locator('[data-testid="ide-stop"]').click();
    await expect(page.getByTestId('xenon-on')).toHaveText('OFF', { timeout: 15_000 });
    await titlebar.locator('[data-testid="ide-run"]').click();
    await expect(page.getByTestId('xenon-on')).toHaveText('ON', { timeout: 60_000 });
    await page.keyboard.press('Escape');
  });
});
