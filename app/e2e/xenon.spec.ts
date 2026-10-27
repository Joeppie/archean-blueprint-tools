// xenon.spec.ts — the Xenon IDE (v1.13 batch: "in the menu add Xenon …
// list all computers … pop-up with its code that looks like it does in-game",
// "display using the screen and HD screen that a craft may have", "code that
// has nodes should also render"). E2E-TIER because the laws live in the
// browser: the dev's XenonCode interpreter boots as WASM, runs the craft's
// own program, and its XenonScreen framebuffer reaches canvas pixels; the
// #NODES graph paints on canvas. Pure helpers (tokenizer, #NODES parse,
// channel detection, blueprint extraction) are vitest-pinned —
// src/engine/__tests__/xenoncode.test.ts.
//
// Fixtures: Just-Plane-Easy (3294880085, screen("TrimsDash",0) → the
// Dashboard's 50×25 HdScreen element) and the Cheap Exploration Plane
// (3327182790, pure #NODES flight-control program, no screens).
import { expect, test } from '@playwright/test';

const PLANE = '3294880085';
const CEP = '3327182790';
const BADGER = '3326372833';

async function litPixels(page: import('@playwright/test').Page, selector: string): Promise<number> {
  return page.evaluate(sel => {
    const c = document.querySelector(sel) as HTMLCanvasElement | null;
    if (!c || !c.width) return -1;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 90) lit++;
    return lit;
  }, selector);
}

test.describe('Xenon IDE @ui', () => {
  test('the craft computer boots on the dev WASM: code, tabs, screens, bus, inputs @slow', async ({ page }) => {
    await page.goto(`/?craft=${PLANE}`);
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 90_000 });

    // Xenon ▾ lists the MiniComputer (only menu tile for programmable crafts)
    await page.getByTestId('xenon-menu').click();
    const item = page.locator('[data-testid^="xenon-comp-"]').first();
    await expect(item).toBeVisible();
    await item.click();

    // the in-game-style IDE
    const dlg = page.getByTestId('xenon-dialog');
    await expect(dlg).toBeVisible();
    await expect(dlg).toContainText('XenonCode IDE');
    await expect(page.getByText(`Program '${'FirstFlight'}' loaded`)).toBeVisible();
    await expect(page.getByText(/is running…/)).toBeVisible();
    await expect(page.getByTestId('xenon-on')).toHaveText('ON');

    // tabs = the blueprint's .xc files; the code pane is line-numbered code
    await expect(page.getByTestId('xenon-tab-0')).toContainText('FirstFlight.main.xc');
    await expect(page.getByTestId('xenon-tab-1')).toContainText('functions.xc');
    const code = page.getByTestId('xenon-code-0');
    await expect(code).toContainText('storage var $rollnum');
    await expect(code).toContainText('output_number(');
    // validation: the shipped program parses clean — no red lines
    await expect(page.locator('[data-testid^="xenon-err-"]')).toHaveCount(0);

    // the Dashboard HdScreen ("TrimsDash", 0) is registered at 51×26 and the
    // running program paints its readout lines into the canvas
    const screen = page.locator('[data-testid="xenon-screen-trimsdash#0"]');
    await expect(screen).toBeVisible();
    await page.waitForTimeout(2500);                       // a few 10 Hz cycles
    expect(await litPixels(page, '[data-testid="xenon-screen-trimsdash#0"]')).toBeGreaterThan(50);

    // io bus: the program's output_number targets stream in
    await expect(page.getByText('PitchControlJunction').first()).toBeVisible();
    await expect(page.getByText('Engine').first()).toBeVisible();

    // the stick is an EXTERNAL NUMERIC: raise the elevator channel and the
    // PitchControlJunction bus value follows (latest row ≠ 0 within ~2 s)
    const pitch = page.getByTestId('xenon-in-11-1');
    await pitch.evaluate((el: HTMLInputElement) => {
      // React's range dedupe: set via the NATIVE value setter, then dispatch
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      set.call(el, '0.8');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect
      .poll(async () => page.evaluate(() => {
        const rows = [...document.querySelectorAll('[data-testid="xenon-dialog"] .contents')];
        const r = rows.find(x => x.textContent?.includes('PitchControlJunction'));
        return r ? parseFloat(r.querySelector('.tabular-nums')!.textContent!) : 0;
      }), { timeout: 10_000 })
      .toBeLessThan(-0.3);                                 // output = -(stick + trim)

    // Esc closes
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('xenon-dialog')).toHaveCount(0);
  });

  test('the Badger boots: 57 files, named screens, alias io bus, capped view @slow', async ({ page }) => {
    test.setTimeout(240_000);                                // 36k lines compile on wasm
    const t0 = Date.now();
    await page.goto(`/?craft=${BADGER}`);
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 180_000 });
    await page.getByTestId('xenon-menu').click();
    await page.locator('[data-testid^="xenon-comp-"]').first().click();
    const dlg = page.getByTestId('xenon-dialog');
    await expect(dlg).toBeVisible();
    // the firmware boots on the dev VM — the prints prove the program RUNS
    await expect(page.getByTestId('xenon-log')).toContainText('Smart Quad is ready', { timeout: 180_000 });
    console.log(`badger boot+init: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    await expect(page.getByText(/is running…/)).toBeVisible();
    // tabs: 57 files wrap across the tab row
    await expect(page.getByTestId('xenon-tab-0')).toBeVisible();
    await expect(page.getByTestId('xenon-tab-56')).toBeVisible();
    // the io bus speaks component ALIASES (the device table): the drill is driven
    await expect(page.locator('[data-testid="xenon-dialog"]').getByText('mining-drill').first())
      .toBeVisible({ timeout: 30_000 });
    // a NAMED screen from the blueprint (Dashboard 'pilot-screen' element 0,
    // 51×51 px) paints — the virtual screens bind at boot, no auto-screens
    const scr = page.locator('[data-testid="xenon-screen-pilot-screen#0"]');
    await expect(scr).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(4000);
    expect(await litPixels(page, '[data-testid="xenon-screen-pilot-screen#0"]')).toBeGreaterThan(20);
    // the 16k-line main.xc renders capped, not frozen
    await expect(page.getByText(/view is capped/)).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('the node-authored program renders its #NODES graph @slow', async ({ page }) => {
    await page.goto(`/?craft=${CEP}`);
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 90_000 });
    await page.getByTestId('xenon-menu').click();
    await page.locator('[data-testid^="xenon-comp-"]').first().click();
    const tab = page.getByTestId('xenon-tab-nodes');
    await expect(tab).toContainText('nodes');              // counter on the tab
    expect(await tab.innerText()).toMatch(/nodes \(\d+\)/);
    await tab.click();
    const cv = page.getByTestId('xenon-nodes');
    await expect(cv).toBeVisible();
    await page.waitForTimeout(800);                        // draw + fit
    // the canvas paints node cards + wires (not a blank fill)
    const lit = await litPixels(page, '[data-testid="xenon-nodes"]');
    expect(lit).toBeGreaterThan(2000);
    // the code tab of the SAME program validates clean
    await page.getByTestId('xenon-tab-0').click();
    await expect(page.locator('[data-testid^="xenon-err-"]')).toHaveCount(0);
    await page.keyboard.press('Escape');
  });
});
