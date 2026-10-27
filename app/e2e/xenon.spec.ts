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
    // the io bus speaks component ALIASES (the device table): the drill is
    // driven (the BUS side tab)
    await page.getByTestId('xenon-side-bus').click();
    await expect(page.locator('[data-testid="xenon-dialog"]').getByText('mining-drill').first())
      .toBeVisible({ timeout: 30_000 });
    // a NAMED screen from the blueprint (Dashboard 'pilot-screen' element 0,
    // 51×51 px) paints — the virtual screens bind at boot, no auto-screens
    await page.getByTestId('xenon-side-screens').click();
    const scr = page.locator('[data-testid="xenon-screen-pilot-screen#0"]');
    await expect(scr).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(4000);
    expect(await litPixels(page, '[data-testid="xenon-screen-pilot-screen#0"]')).toBeGreaterThan(20);
    // the biggest file (dashboard-art.xc, 7459 lines) renders WINDOWED —
    // v1.13.x retired the 1500-line view cap: every line is reachable,
    // none are rendered at once
    await page.locator('[data-testid^="xenon-tab-"]', { hasText: 'dashboard-art.xc' }).click();
    const view = page.getByTestId('xenon-code-view');
    await expect(view).toBeVisible();
    expect(Number(await view.getAttribute('data-lines'))).toBeGreaterThan(7000);
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
    // THE FIX: clicking the top-left "disp" button flips $disp — the click
    // lands while the SCREENS tab shows the surface; the vars tab reads back
    await page.getByTestId('xenon-screen-10#0').click({ position: { x: 2, y: 2 } });
    await page.getByTestId('xenon-side-vars').click();
    const dispRow = page.getByTestId('xenon-var-disp');
    await expect(dispRow).toBeVisible();
    await expect(dispRow).not.toContainText('1', { timeout: 8_000 });
    // the 3381670618 code validates clean (no red lines in the entry file)
    await page.getByTestId('xenon-tab-0').click();
    await expect(page.locator('[data-testid^="xenon-err-"]')).toHaveCount(0);
    // $var hover: the tooltip shows the CURRENT value
    const tok = page.locator('span.relative', { hasText: /^\$auto$/ }).first();
    await tok.hover();
    await expect(page.getByTestId('xenon-var-tip-auto')).toContainText('=');
    await page.keyboard.press('Escape');
  });

  test('the debugger: F9 breakpoint pauses, F10 steps one cycle, F8 resumes @slow', async ({ page }) => {
    // (we: "we should be able to set breakpoints and move through it with
    // the same keys as typical in intelIbrains IDE, so f10, f11?") — a step
    // is one 10 Hz computer cycle; a break pauses AT the cycle that touched
    // its line (XENON-DEBUG executed-line tracking).
    await page.goto(`/?craft=${CEP}`);
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 90_000 });
    await page.getByTestId('xenon-menu').click();
    await page.locator('[data-testid^="xenon-comp-"]').first().click();
    await expect(page.getByTestId('xenon-on')).toHaveText('ON', { timeout: 60_000 });
    await page.getByTestId('xenon-tab-0').click();
    // line 17 (output_number(8,0,...)) runs EVERY cycle — click its gutter
    const gutter = page.locator('[data-line="17"] span').first();
    await expect(gutter).toBeVisible();
    await gutter.click();
    await expect(page.getByTestId('xenon-bp-17')).toBeVisible();
    // the pump pauses at the cycle that touches the line
    const pill = page.getByTestId('xenon-paused');
    await expect(pill).toBeVisible({ timeout: 15_000 });
    await expect(pill).toContainText('17');
    const cycles = async () => Number(
      (await page.getByText(/cycles \d+ @ 10 Hz/).first().innerText()).match(/cycles (\d+)/)?.[1] ?? -1);
    const c0 = await cycles();
    await page.waitForTimeout(1200);
    expect(await cycles()).toBe(c0);                 // frozen while paused
    // F10 = exactly one computer cycle
    await page.keyboard.press('F10');
    await expect.poll(cycles, { timeout: 8_000 }).toBe(c0 + 1);
    await page.keyboard.press('F10');
    await expect.poll(cycles, { timeout: 8_000 }).toBe(c0 + 2);
    await expect(pill).toBeVisible();
    // F8 = resume: the break re-arms and cycles stream past the frozen step
    await page.keyboard.press('F8');
    await expect.poll(cycles, { timeout: 8_000 }).toBeGreaterThan(c0 + 2);
    await page.keyboard.press('Escape');
  });

  test('autosaves: a disk edit is shadowed, a reload loses it, Restore brings it back @slow', async ({ page }) => {
    // (we: "keep a shadow-copy of the current craft… Forget to save? No
    // problem… in the file menu, autosaves should show… with timestamp")
    test.setTimeout(180_000);
    await page.goto(`/?craft=${PLANE}`);
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 90_000 });
    await page.getByTestId('xenon-menu').click();
    await page.locator('[data-testid^="xenon-comp-"]').first().click();
    await expect(page.getByTestId('xenon-on')).toHaveText('ON', { timeout: 60_000 });
    // edit the disk (the marker rides the doc via the v1.6.1 mirror)
    await page.getByTestId('xenon-edit').click();
    const ta = page.getByTestId('xenon-code-edit');
    await expect(ta).toBeVisible();
    const src = await ta.inputValue();
    await ta.fill(src + '\n; autosave-pin marker\n');
    await page.getByTestId('xenon-save').click();
    await expect(page.getByTestId('xenon-on')).toHaveText('ON', { timeout: 60_000 });
    await page.keyboard.press('Escape');
    // tab-hiding fires the 20 s shadow immediately (visibilitychange hook)
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(800);
    await page.getByTestId('file-menu').click();
    await page.getByTestId('file-autosaves').click();
    const rows = page.locator('[data-testid^="autosave-row-"]');
    await expect(rows.first()).toBeVisible({ timeout: 10_000 });
    // RELOAD: the in-memory doc is gone — the shadow survives (IndexedDB)
    await page.reload();
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 90_000 });
    await page.getByTestId('file-menu').click();
    await page.getByTestId('file-autosaves').click();
    await expect(rows.first()).toBeVisible({ timeout: 10_000 });
    await page.locator('[data-testid^="autosave-restore-"]').first().click();
    // the restored doc carries the marker: the IDE shows it again
    await page.getByTestId('xenon-menu').click();
    await page.locator('[data-testid^="xenon-comp-"]').first().click();
    // the code view is VIRTUALIZED (windowed render) — scroll to the tail so
    // the appended marker line enters the DOM before asserting
    const codeBox = page.getByTestId('xenon-code-view');
    await expect(codeBox).toBeVisible({ timeout: 60_000 });
    await codeBox.evaluate(el => { el.scrollTop = el.scrollHeight; });
    await expect(page.getByTestId('xenon-code-0')).toContainText('autosave-pin marker', { timeout: 15_000 });
    await page.keyboard.press('Escape');
  });

  test('the IDE resolves io to component TYPES and channels to game MEANINGS @slow', async ({ page }) => {
    // (we: "the computer STILL does not resolve the component type of the
    // input, nor the meaning of the channels per input") — the meanings are
    // the game wiki's own tables (tools/extract_channels.py).
    await page.goto(`/?craft=${CEP}`);
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 90_000 });
    await page.getByTestId('xenon-menu').click();
    await page.locator('[data-testid^="xenon-comp-"]').first().click();
    await expect(page.getByTestId('xenon-on')).toHaveText('ON', { timeout: 60_000 });
    await page.getByTestId('xenon-side-bus').click();
    // the stick channel row names the cabled device AND its game function
    const seatRow = page.locator('label', { hasText: 'PilotSeat' }).filter({ hasText: 'Backward/Forward' });
    await expect(seatRow.first()).toBeVisible();
    await page.getByTestId('xenon-tab-nodes').click();
    await expect(page.locator('[data-testid^="xenon-chan-"]').first()).toBeVisible();
    await expect(
      page.locator('[data-testid^="xenon-chan-"]', { hasText: 'Backward/Forward' }).first()
    ).toBeVisible();

    // the Cede plane's NavInstrument outputs: ch 6 is Heading (0..360)
    await page.goto('/?craft=3381670618');
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 120_000 });
    await page.getByTestId('xenon-menu').click();
    await page.locator('[data-testid^="xenon-comp-"]').first().click();
    await expect(page.getByTestId('xenon-on')).toHaveText('ON', { timeout: 90_000 });
    await page.getByTestId('xenon-side-bus').click();
    const navRow = page.locator('label', { hasText: 'NavInstrument' }).filter({ hasText: 'Heading' });
    await expect(navRow.first()).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press('Escape');
  });

  test('IDE menus, single-row tab strip, and $/@/word AUTOCOMPLETE @slow', async ({ page }) => {
    await page.goto(`/?craft=${PLANE}`);
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 90_000 });
    await page.getByTestId('xenon-menu').click();
    await page.locator('[data-testid^="xenon-comp-"]').first().click();
    await expect(page.getByTestId('xenon-on')).toHaveText('ON', { timeout: 60_000 });
    // the menu bar: File / Run / Computer dropdowns (no flat 'Options ▸ run')
    await page.getByTestId('xmenu-run').click();
    await expect(page.getByTestId('run-step')).toBeVisible();
    await expect(page.getByTestId('run-pause')).toBeVisible();
    await page.getByTestId('run-step').click();                  // F10 path via the menu
    await page.getByTestId('xmenu-file').click();
    await expect(page.getByTestId('file-save')).toBeVisible();
    await page.keyboard.press('Escape');
    // ONE scrollable tab row (no wrap, actions never clipped)
    const strip = page.getByTestId('xenon-tabstrip');
    const bb = await strip.boundingBox();
    expect(bb!.height).toBeLessThan(46);
    await expect(page.getByTestId('xenon-edit')).toBeVisible();
    // autocomplete: '$' completes declared variables, words complete functions
    await page.getByTestId('xenon-edit').click();
    const ta = page.getByTestId('xenon-code-edit');
    await ta.click();
    await ta.press('Control+End');
    await ta.type('\nvar $zz_pitch_marker = input_', { delay: 25 });
    await expect(page.getByTestId('xenon-ac-popup')).toBeVisible();
    await expect(page.getByTestId('xenon-ac-popup')).toContainText('input_number');
    await page.keyboard.press('Enter');
    await expect(ta).toContainText('input_number(');
    await ta.type('  + $roll', { delay: 25 });
    await expect(page.getByTestId('xenon-ac-popup')).toContainText('$rollnum');
    await page.keyboard.press('Escape');
    // declared FUNCTION completion: '@' lists function @names declared on disk
    await ta.type('\n@fir', { delay: 25 });
    await expect(page.getByTestId('xenon-ac-popup')).toBeVisible();
    await page.keyboard.press('Escape');
    // discard the scratch edit (revert, no save)
    await page.getByTestId('xenon-edit-cancel').click();
    await page.keyboard.press('Escape');
  });

  test('the WORLDSIM: sensors fly the craft, $val overrides, program setworldsim @slow', async ({ page }) => {
    // (we: "worldsim should be global… sensors should have overrides, so
    // you can add or remove from the value, referred to as $val — e.g.
    // $val + 2 to an altitude sensor… at flight at 2000 metres, going 80
    // metres per second forward")
    test.setTimeout(240_000);
    await page.goto('/?craft=3381670618');
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 120_000 });
    await page.getByTestId('xenon-menu').click();
    await page.locator('[data-testid^="xenon-comp-"]').first().click();
    await expect(page.getByTestId('xenon-on')).toHaveText('ON', { timeout: 90_000 });
    await page.getByTestId('xenon-side-world').click();
    const alt = page.getByTestId('worldsim-row-navinstrument.altitude_meters_from_sea_level');
    await expect(alt).toBeVisible();
    // deterministic: pin the base to 2000, override with $val + 2 → 2002
    const base = page.getByTestId('worldsim-base-navinstrument.altitude_meters_from_sea_level');
    await base.fill('2000');
    const ov = page.getByTestId('worldsim-ov-navinstrument.altitude_meters_from_sea_level');
    await expect(ov).toBeVisible();                     // SENSOR rows carry $val
    await ov.fill('$val + 2');
    await expect(page.getByTestId('worldsim-val-navinstrument.altitude_meters_from_sea_level'))
      .toHaveText('2002.000', { timeout: 5_000 });
    // CONTROLS are grouped apart and carry NO $val input
    const seat = page.getByTestId('worldsim-row-pilotseat.backward_forward');
    await expect(seat).toBeVisible();
    await expect(seat.getByTestId('worldsim-ov-pilotseat.backward_forward'))
      .toHaveCount(0);
    // the firmware reads the overridden channel: input_number(4, 2) = 2002
    await page.getByTestId('xenon-edit').click();
    const ta = page.getByTestId('xenon-code-edit');
    await ta.click();
    await ta.press('Control+Home');
    await ta.type('print(text("alt: {}", input_number(4, 2)))\n', { delay: 6 });
    await page.getByTestId('xenon-save').click();
    await expect(page.getByTestId('xenon-on')).toHaveText('ON', { timeout: 90_000 });
    await page.getByTestId('xenon-side-console').click();
    await expect(page.getByTestId('xenon-log')).toContainText('alt: 2002', { timeout: 30_000 });
    // PROGRAM override via setworldsim wins over the expression
    await ta.click();
    await ta.press('Control+Home');
    await ta.type('setworldsim("navinstrument.altitude_meters_from_sea_level", 3000)\n', { delay: 6 });
    await page.getByTestId('xenon-save').click();
    await expect(page.getByTestId('xenon-on')).toHaveText('ON', { timeout: 90_000 });
    await page.getByTestId('xenon-side-world').click();
    await expect(alt).toContainText('program');
    await expect(page.getByTestId('worldsim-val-navinstrument.altitude_meters_from_sea_level'))
      .toHaveText('3000.000', { timeout: 5_000 });
    // the global store PERSISTS across crafts: the PLANE's World tab shows it
    await page.keyboard.press('Escape');
    await page.goto(`/?craft=${PLANE}`);
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 90_000 });
    await page.getByTestId('xenon-menu').click();
    await page.locator('[data-testid^="xenon-comp-"]').first().click();
    await expect(page.getByTestId('xenon-on')).toHaveText('ON', { timeout: 60_000 });
    await page.getByTestId('xenon-side-world').click();
    await expect(
      page.getByTestId('worldsim-name-navinstrument.altitude_meters_from_sea_level')
    ).toContainText('other craft');
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
