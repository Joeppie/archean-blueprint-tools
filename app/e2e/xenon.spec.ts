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
    // — behind a WORK-IN-PROGRESS disclaimer (our rule 2026-10-27)
    await page.getByTestId('xenon-menu').click();
    await expect(page.getByTestId('xenon-wip')).toContainText('Work in progress');
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

    // io bus: the program's output_number targets stream in (the side
    // panel's BUS tab — v1.13.x side-panel batch)
    await page.getByTestId('xenon-side-bus').click();
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
    // (the side panel's CONSOLE tab — v1.13.x tabbed side panel)
    await page.getByTestId('xenon-side-console').click();
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
    // the 16k-line main.xc renders WINDOWED (v1.13.x: the view cap is
    // retired — every line is reachable, none are rendered at once)
    const view = page.getByTestId('xenon-code-view');
    await expect(view).toBeVisible();
    expect(Number(await view.getAttribute('data-lines'))).toBeGreaterThan(10_000);
    // the Vars side tab lists the firmware's globals (the Badger's $tick-like
    // state): the panel renders ≥ 1 variable row
    await page.getByTestId('xenon-side-vars').click();
    await expect(page.locator('[data-testid^="xenon-var-"]').first()).toBeVisible({ timeout: 15_000 });
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
    await page.waitForTimeout(800);                        // layout + fit
    // the DOM node cards render (v1.13.x: cards are DOM, wires are SVG —
    // values are readable, which a canvas never was)
    expect(await page.locator('[data-testid^="xenon-node-"]:not([data-testid^="xenon-nodeval-"])').count())
      .toBeGreaterThan(5);
    // the code tab of the SAME program validates clean
    await page.getByTestId('xenon-tab-0').click();
    await expect(page.locator('[data-testid^="xenon-err-"]')).toHaveCount(0);
    await page.keyboard.press('Escape');
  });

  test('node cards show the LIVE values read from components @slow', async ({ page }) => {
    // (we: "make nodes show the actual value read from their components")
    // the shim reports every input_number read per cycle; the io-addressed
    // InputNode card prints the last value ITS channel delivered.
    await page.goto(`/?craft=${CEP}`);
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 90_000 });
    await page.getByTestId('xenon-menu').click();
    await page.locator('[data-testid^="xenon-comp-"]').first().click();
    const tab = page.getByTestId('xenon-tab-nodes');
    await expect(tab).toBeVisible();
    await tab.click();
    // find an InputNode card's io/channel from the DOM, drive THAT slider
    const ioCh = await page.evaluate(() => {
      for (const el of document.querySelectorAll('[data-testid^="xenon-node-"]')) {
        const m = /io (\d+)\s+ch (\d+)/.exec(el.textContent ?? '');
        if (m) return { io: +m[1]!, ch: +m[2]! };
      }
      return null;
    });
    expect(ioCh).not.toBeNull();
    await page.getByTestId('xenon-side-bus').click();          // sliders live on the BUS tab
    const slider = page.getByTestId(`xenon-in-${ioCh!.io}-${ioCh!.ch}`);
    await slider.evaluate((el: HTMLInputElement, v: string) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, '0.6');
    await expect
      .poll(async () => page.evaluate(() => {
        return [...document.querySelectorAll('[data-testid^="xenon-nodeval-"]')]
          .map(e => e.textContent?.trim() ?? '').join('|');
      }), { timeout: 10_000 })
      .toContain('0.600');
    await page.keyboard.press('Escape');
  });

  test('craft 3381670618: the reported craft boots, renders its dashboard, buttons work, vars read back @slow', async ({ page }) => {
    // the reported craft: its program used `if $screen.button_rect(...)` —
    // the VOID button_rect made the WHOLE program uncompilable (v1.13.x
    // fix: button_rect/button return 1 when clicked, per computer.md).
    test.setTimeout(180_000);
    await page.goto('/?craft=3381670618');
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 120_000 });
    await page.getByTestId('xenon-menu').click();
    await page.locator('[data-testid^="xenon-comp-"]').first().click();
    await expect(page.getByTestId('xenon-on')).toHaveText('ON', { timeout: 60_000 });
    await expect(page.getByText(/is running…/)).toBeVisible();
    // the io-10 Dashboard surface is registered at the ELEMENT size (146×66)
    const scr = page.locator('[data-testid="xenon-screen-10#0"]');
    await expect(scr).toBeVisible();
    expect(await scr.evaluate(el => (el as HTMLCanvasElement).width)).toBe(146);
    await page.waitForTimeout(1500);
    expect(await litPixels(page, '[data-testid="xenon-screen-10#0"]')).toBeGreaterThan(10);
    // THE FIX: clicking the top-left "disp" button flips $disp (vars panel)
    await page.getByTestId('xenon-side-vars').click();
    const dispRow = page.getByTestId('xenon-var-disp');
    await expect(dispRow).toBeVisible();
    const before = (await dispRow.innerText()).match(/-?\d+(\.\d+)?/g)?.pop();
    await page.getByTestId('xenon-screen-10#0').click({ position: { x: 2, y: 2 } });
    await expect(dispRow).not.toContainText(before ?? 'NOVAL', { timeout: 8_000 });
    // the 3381670618 code validates clean (no red lines in the entry file)
    await page.getByTestId('xenon-tab-0').click();
    await expect(page.locator('[data-testid^="xenon-err-"]')).toHaveCount(0);
    // $var hover: the tooltip shows the CURRENT value
    const tok = page.locator('span.relative', { hasText: /^\$auto$/ }).first();
    await tok.hover();
    await expect(page.locator('span.var-fade, .absolute.text-\[\#8fd48f\]').first()).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('the ▣ Screens bottom tab shows dashboards + virtual surfaces @slow', async ({ page }) => {
    // (we: "open the screens in the bottom tab using a screen button on top
    // (only visible if the craft has dashboards) … a tab for normal and
    // virtual ones")
    await page.goto(`/?craft=${BADGER}`);
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 180_000 });
    const btn = page.getByTestId('screens-btn');
    await expect(btn).toBeVisible();                              // Badger HAS dashboards
    await btn.click();
    const dock = page.getByTestId('screens-dock');
    await expect(dock).toBeVisible();
    // the Dashboards tab: a real surface paints (pilot-screen)
    await expect(page.getByTestId('screens-tab-dash')).toBeVisible();
    await expect(page.locator('[data-testid^="screens-cell-"]')).not.toHaveCount(0, { timeout: 60_000 });
    // the Virtual tab: the Badger composes out of virtualscreen() buffers
    await page.getByTestId('screens-tab-virtual').click();
    await expect(page.locator('[data-testid^="screens-cell-virtual#"]').first())
      .toBeVisible({ timeout: 30_000 });
    await page.getByTestId('screens-close').click();
    await expect(dock).toHaveCount(0);
  });
});
