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
// Chip Patton's 'PKC-385' (workshop 3820116990): a XenonCode SUPER MARIO
// BROS. game — PilotSeat 'gamer-chair' input, 8 Buzzer components for the
// 8-bit music, six HdScreen surfaces. The playtest target of v1.13.2.
const MARIO = '3820116990';

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
    await page.waitForTimeout(2500);                       // a few 25 Hz cycles
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
    expect(await scr.evaluate(el => (el as HTMLCanvasElement).width)).toBe(870)   // 145-unit element at the 6 px-per-unit screen scale;
    await page.waitForTimeout(1500);
    expect(await litPixels(page, '[data-testid="xenon-screen-10#0"]')).toBeGreaterThan(10);
    // THE FIX: clicking the top-left "disp" button flips $disp — v1.13.2:
    // clicking the thumbnail opens its ZOOM WINDOW, and the button press
    // lands on the 1:1 fullscreen canvas (the VM law lives there now); the
    // vars tab reads the flip back
    await page.getByTestId('xenon-screen-10#0').click();
    const full = page.getByTestId('xenon-cell-10#0-fullcanvas');
    await expect(full).toBeVisible();
    const fb = (await full.boundingBox())!;
    await full.click({ position: { x: fb.width * 4 / 870, y: fb.height * 4 / 396 } });
    await page.getByTestId('xenon-cell-10#0-fullexit').click();
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
    // is one 25 Hz computer cycle; a break pauses AT the cycle that touched
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
      (await page.getByText(/cycles \d+ @ 25 Hz/).first().innerText()).match(/cycles (\d+)/)?.[1] ?? -1);
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
    await ta.type('\n@sel', { delay: 25 });
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
    await ta.waitFor();
    {
      const cur = await ta.inputValue();
      const at = cur.indexOf('update');
      await ta.fill(cur.slice(0, at + 6) + '\n\tprint(text("alt: {}", input_number(4, 2)))\n' + cur.slice(at + 6));
    }
    await page.getByTestId('xenon-save').click();
    await expect(page.getByTestId('xenon-on')).toHaveText('ON', { timeout: 90_000 });
    await page.getByTestId('xenon-side-console').click();
    await expect(page.getByTestId('xenon-log')).toContainText('alt: 2002', { timeout: 30_000 });
    // PROGRAM override via setworldsim wins over the expression
    await page.getByTestId('xenon-edit').click();
    await ta.waitFor();
    {
      const cur = await ta.inputValue();
      const at = cur.indexOf('update');
      await ta.fill(cur.slice(0, at + 6)
        + '\n\tsetworldsim("navinstrument.altitude_meters_from_sea_level", 3000)\n'
        + cur.slice(at + 6));
    }
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

  test('IDE windows drag, resize, reopen on-screen; screens zoom; phones go fullscreen @slow', async ({ page, browser }) => {
    // (we: "the computer and dashboard pop up windows should be things that
    // we can freely move around and even resize… if moved off screen,
    // re-opening fixes… I need to be able to zoom in on dashboard screens…
    // screens that are too large for phone should full-screen entirely")
    test.setTimeout(180_000);
    await page.goto(`/?craft=${PLANE}`);
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 90_000 });
    await page.getByTestId('screens-btn').click();
    const dock = page.getByTestId('screens-dock');
    await expect(dock).toBeVisible();
    // DRAG by the title bar — UP-LEFT, so the SE grips get viewport room:
    // the dock's initial width sits AT the min(1100, 96 vw) cap on a
    // 1280-px viewport, and a right-drag would push its SE corner OUTSIDE
    // the window (the mouse events land on nothing — the v1.13.2 red)
    const b0 = (await dock.boundingBox())!;
    await page.mouse.move(b0.x + 120, b0.y + 14);
    await page.mouse.down();
    await page.mouse.move(b0.x - 150, b0.y - 150, { steps: 8 });
    await page.mouse.up();
    const b1 = (await dock.boundingBox())!;
    expect(b1.x).toBeLessThan(b0.x - 100);
    expect(b1.y).toBeLessThan(b0.y - 100);
    // RESIZE by the SE corner: BOTH axes grow. Aim at the GRIP CENTRE
    // (8 px in): the dock is rounded-lg + overflow-hidden, and a 2-px-in
    // point lies OUTSIDE the rounded clip — pointerdown then lands on the
    // page, not the grip (the v1.13.2 red; this @slow leg had not run in
    // CI since batch 7 added it at a 1440-px viewport)
    await page.mouse.move(b1.x + b1.width - 8, b1.y + b1.height - 8);
    await page.mouse.down();
    await page.mouse.move(b1.x + b1.width + 142, b1.y + b1.height + 72, { steps: 6 });
    await page.mouse.up();
    const b2 = (await dock.boundingBox())!;
    expect(b2.width).toBeGreaterThan(b1.width + 80);
    expect(b2.height).toBeGreaterThan(b1.height + 40);
    // close + REOPEN: the session position persists (and off-screen rects
    // reopen at their initial spot - unit-pinned in bestRect)
    await page.getByTestId('screens-close').click();
    await page.getByTestId('screens-btn').click();
    const b3 = (await dock.boundingBox())!;
    expect(Math.abs(b3.x - b2.x)).toBeLessThan(4);
    // ZOOM the trims surface: fullscreen, + / −, pan by scroll
    const cell = page.getByTestId('screens-cell-trimsdash#0');
    await expect(cell).toBeVisible();
    await page.getByTestId('screens-cell-trimsdash#0-full').click();
    await expect(page.getByTestId('screens-cell-trimsdash#0-overlay')).toBeVisible();
    const zoom = page.getByTestId('screens-cell-trimsdash#0-zoom');
    await expect(zoom).toHaveText('100%');
    const cvFit = (await page.getByTestId('screens-cell-trimsdash#0-fullcanvas').boundingBox())!;
    await page.getByTestId('screens-cell-trimsdash#0-zoomin').click();
    await page.getByTestId('screens-cell-trimsdash#0-zoomin').click();
    await expect(zoom).toHaveText('156%');
    const cvZoom = (await page.getByTestId('screens-cell-trimsdash#0-fullcanvas').boundingBox())!;
    expect(cvZoom.width).toBeGreaterThan(cvFit.width * 1.4);
    await page.getByTestId('screens-cell-trimsdash#0-fullexit').click();
    await page.getByTestId('screens-close').click();

    // PHONE: the dock is FULLSCREEN and the zoom overlay carries big screens
    const origin = new URL(page.url()).origin;
    const ph = await browser.newContext({
      viewport: { width: 412, height: 915 },
      storageState: { cookies: [], origins: [{ origin, localStorage: [
        { name: 'archean-app-debug', value: '1' },
        { name: 'archean-app-backdrop', value: 'none' },
        { name: 'archean-worldsim', value: '' },
      ] }] },
    });
    const pp = await ph.newPage();
    await pp.goto(`/?craft=${PLANE}`);
    await pp.waitForFunction(() => /SCENE PASS/.test(document.title), null, { timeout: 120_000 });
    await pp.getByTestId('screens-btn').click();
    const pb = (await pp.getByTestId('screens-dock').boundingBox())!;
    expect(pb.height).toBeGreaterThanOrEqual(900);
    await pp.getByTestId('screens-cell-trimsdash#0-full').click();
    await expect(pp.getByTestId('screens-cell-trimsdash#0-fullcanvas')).toBeVisible();
    await pp.getByTestId('screens-cell-trimsdash#0-fullexit').click();
    await ph.close();
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

  test('dash focus + deep link + cockpit keys + buzzers: Mario plays @slow', async ({ page, browser }) => {
    // (we 2026-10-27: "dashboard … too small to read … No zooming … does not
    // let you filter" + "WASD, up, down, and F … inputs into the computer
    // for all cockpit connections it has" + "buzzers should be implemented"
    // + "a deeplink ability to the specific dash as well as the super mario
    // game by chip imported. That way, we can play super mario in our
    // browser.") Deep-link straight to Mario's GAME canvas: the FIRST
    // virtualscreen (we 2026-10-28: "it should actually focus on the first
    // virtualscreen" — the game composes on virtual#0#0 900×600; the
    // dashboard panels are its physical mounts).
    test.setTimeout(300_000);
    const OV = 'screens-cell-virtual#0#0';
    await page.goto(`/?craft=${MARIO}&dash=first-virtual`);
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 180_000 });

    // the dock opened itself (on the Virtual tab), the canvas raised its
    // zoom window as soon as it painted (no clicking on a tiny canvas)
    const overlay = page.getByTestId(`${OV}-overlay`);
    await expect(overlay).toBeVisible({ timeout: 120_000 });
    const full = page.getByTestId(`${OV}-fullcanvas`);
    await expect(full).toBeVisible();
    // zoom controls ride the window
    await page.getByTestId(`${OV}-zoomin`).click();
    await expect(page.getByTestId(`${OV}-zoom`)).toHaveText('125%');
    // THE ASPECT LAW (we: "it doesnt properly scale, it stretches it
    // sideways when trying to maximise"): the fullscreen canvas keeps the
    // surface's 900:600 ratio, at any zoom
    {
      const fb = (await full.boundingBox())!;
      expect(Math.abs(fb.width / fb.height - 1.5)).toBeLessThan(0.1);
      await page.getByTestId(`${OV}-zoomin`).click();
      await page.getByTestId(`${OV}-zoomin`).click();
      const fb2 = (await full.boundingBox())!;
      expect(Math.abs(fb2.width / fb2.height - 1.5)).toBeLessThan(0.1);
    }
    // the GAME paints the canvas (title screen pixels)
    await expect
      .poll(() => litPixels(page, `[data-testid="${OV}-fullcanvas"]`),
        { timeout: 60_000 })
      .toBeGreaterThan(200);
    await page.getByTestId(`${OV}-fullexit`).click();

    // the dock: every surface + the FILTER (we: "doesnt let you filter")
    await expect(page.locator('[data-testid^="screens-cell-"]')).not.toHaveCount(0);
    await page.getByTestId('screens-search').fill('zzz-no-surface');
    await expect(page.locator('[data-testid^="screens-cell-"]')).toHaveCount(0);
    await expect(page.getByText('no surface matches the filter')).toBeVisible();
    await page.getByTestId('screens-search').fill('');
    await expect(page.locator(`[data-testid="${OV}"]`)).toBeVisible();
    // TILE MODE: gaps collapse to ZERO and the panels sit flush — Mario's
    // six HdScreens read as one TV wall (we: "the spacing between
    // dashboards should be collapsable to be zero, so they are super-smooth
    // together, with a button") — on the Dashboards tab
    await page.getByTestId('screens-tab-dash').click();
    await page.getByTestId('screens-tight').click();
    const c0 = (await page.getByTestId('screens-canvas-screen#0').boundingBox())!;
    const c1 = (await page.getByTestId('screens-canvas-screen#1').boundingBox())!;
    expect(Math.abs(c1.x - (c0.x + c0.width))).toBeLessThanOrEqual(1.5);
    await page.getByTestId('screens-tight').click();
    // clicking the THUMBNAIL opens its zoom window (no more VM mis-clicks)
    await page.getByTestId('screens-canvas-screen#0').click();
    await expect(page.getByTestId('screens-cell-screen#0-overlay')).toBeVisible();
    await page.getByTestId('screens-cell-screen#0-fullexit').click();

    // THE TOPBAR SOUND ICON (we: "place a mute icon/sound icon near the
    // 'view' buttons … which animates whenever any buzzer is making
    // sound"): visible beside ⚙ View while the dock keeps the computer
    // running (closing the dock without the IDE closes the pump, and the
    // icon stands down with it), starts muted; the click is the
    // autoplay-safe gesture. Checked NOW — once the IDE opens it covers
    // the TopBar.
    const snd = page.getByTestId('buzzer-toggle');
    await expect(snd).toBeVisible();
    await expect(snd).toHaveAttribute('aria-pressed', 'false');
    await snd.click();
    await expect(snd).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('screens-close').click();

    // app-shortcut law: 'w' did NOT toggle wireframe while the dash was
    // armed (checked NOW — the TopBar ⚙ is reachable while the dock, not
    // the IDE, is the top window)
    await page.getByTestId('toggle-options').click();
    await expect(page.getByTestId('opt-wire')).not.toBeChecked();
    await page.getByTestId('toggle-options').click();

    // cockpit: open the IDE, the Screens tab arms the flight keys, all
    // nine are bound to the gamer-chair PilotSeat
    await page.getByTestId('xenon-menu').click();
    await page.locator('[data-testid^="xenon-comp-"]').first().click();
    await expect(page.getByTestId('xenon-on')).toHaveText('ON', { timeout: 90_000 });
    await page.getByTestId('xenon-side-screens').click();
    const xen = () => page.evaluate(() => (window as any).__XENON__?.());
    await expect
      .poll(async () => (await xen())?.pilotKeys?.length ?? 0, { timeout: 30_000 })
      .toBe(9);
    const row = async (re: string) =>
      ((await xen())?.world ?? []).find((r: any) => new RegExp(re).test(r.name));
    // THE SPRITE-ATLAS LAW (we: "when we get far in a level, things get
    // smeared ... not all of the graphics are being copied by our screen
    // copy?"): Mario skins the whole atlas through virtualscreen(10000,600)
    // — the shim must honour the GAME's 10000 cap, not the old 4096
    // (a truncated atlas = every sprite past x=4096 is garbage).
    await expect
      .poll(async () => {
        const metas = (await xen())?.surfaceMeta ?? [];
        return metas.some((m: any) => /^virtual#/.test(m.key) && m.w >= 10000);
      }, { timeout: 30_000 })
      .toBe(true);
    // W = Backward/Forward +1 (the game reads it as RUN, main.xc ch 1)
    await page.keyboard.down('w');
    await expect.poll(async () => (await row('backward_forward'))?.manual, { timeout: 8_000 }).toBe(1);
    await page.keyboard.up('w');
    await expect.poll(async () => (await row('backward_forward'))?.manual, { timeout: 8_000 }).toBe(0);
    // F = Aux 1 (the game's JUMP, ch 8)
    await page.keyboard.down('f');
    await expect.poll(async () => (await row('aux_1'))?.manual, { timeout: 8_000 }).toBe(1);
    await page.keyboard.up('f');
    // SPACE = the same action button (the classic jump key, ch 8 too)
    await page.keyboard.down('Space');
    await expect.poll(async () => (await row('aux_1'))?.manual, { timeout: 8_000 }).toBe(1);
    await page.keyboard.up('Space');
    // E = Roll (ch 5) — the game's FIRE key (we: "we should have forwarded
    // the e key as well"); the probe proved Mario's fire channel is Roll
    await page.keyboard.down('e');
    await expect.poll(async () => (await row('roll'))?.manual, { timeout: 8_000 }).toBe(1);
    await page.keyboard.up('e');
    // A/D = Left/Right (ch 2) — the MOVE
    await page.keyboard.down('d');
    await expect.poll(async () => (await row('left_right'))?.manual, { timeout: 8_000 }).toBe(1);
    await page.keyboard.up('d');

    // buzzers: the Bus tab lists the game's BUZZERS with live amp+Hz
    // (audio.xc writes Amplitude ch0 / Frequency ch1 every cycle)
    await page.getByTestId('xenon-side-bus').click();
    await expect(page.getByTestId('xenon-buzzer-card')).toBeVisible();
    await expect(page.getByTestId('buzzer-row-game-melody')).toBeVisible();
    await expect(page.getByTestId('buzzer-row-game-bass')).toBeVisible();
    await expect(page.getByTestId('buzzer-sound')).toBeVisible();     // 🔊 (autoplay-safe)
    await expect(page.getByTestId('buzzer-wave-sawtooth')).toBeVisible();
    // the game IS playing: the title DEMO is deliberately silent (main.xc
    // sets musicgate=0) and inputs during the ~16 s sprite-cache phase are
    // swallowed — MASH the jump key (the Bus tab arms the pilot keys too)
    // until a game starts; the level theme then drives the melody buzzer.
    let amp = 0;
    for (let i = 0; i < 26 && amp <= 0; i++) {
      await page.keyboard.down('f');
      await page.waitForTimeout(90);
      await page.keyboard.up('f');
      await page.waitForTimeout(1600);
      const t = await page.getByTestId('buzzer-row-game-melody').locator('span').nth(1)
        .innerText().catch(() => '0');
      amp = parseFloat(t) || 0;
    }
    expect(amp).toBeGreaterThan(0);
    // …and the icon THROBBES while the buzzer sings (data-playing = the
    // live buzzerAudio.level > 0 law)
    await expect
      .poll(async () => snd.getAttribute('data-playing'), { timeout: 10_000 })
      .toBe('1');
    // OBJECTIVE AUDIO PROOF (we: "do they make sound?"): the AnalyserNode
    // on the master chain measures the samples flowing to the speakers —
    // a muted headless browser reads them too. outputLevel > 0 = audible.
    await expect
      .poll(async () => (await xen())?.buzzer?.outputLevel ?? 0, { timeout: 15_000 })
      .toBeGreaterThan(0.003);

    // PHONE: the touch cockpit rides THE SCREEN itself — deep-link to
    // Mario's game canvas (first virtualscreen), the pad shows W A S D /
    // ▲ ▼ E F ␣; press = keydown, release = keyup (we: "overlay all
    // keyboard binds as buttons … on virtual screens … fullscreening")
    const origin = new URL(page.url()).origin;
    const ph = await browser.newContext({
      viewport: { width: 412, height: 915 }, hasTouch: true,
      storageState: { cookies: [], origins: [{ origin, localStorage: [
        { name: 'archean-app-debug', value: '1' },
        { name: 'archean-app-backdrop', value: 'none' },
      ] }] },
    });
    const pp = await ph.newPage();
    await pp.goto(`/?craft=${MARIO}&dash=first-virtual`);
    await pp.waitForFunction(() => /SCENE PASS/.test(document.title), null, { timeout: 180_000 });
    // the deep-linked fullscreen zoom window carries the pad
    const pad = pp.getByTestId(`${OV}-overlay`).getByTestId('pilot-touchpad');
    await expect(pad).toBeVisible({ timeout: 120_000 });
    for (const k of ['w', 'a', 's', 'd', 'up', 'down', 'f', 'e', 'space'])
      await expect(pp.locator(
        `[data-testid="${OV}-overlay"] [data-testid="pilot-touch-${k}"]`)).toBeVisible();
    // press = keydown: the W button lands on the seat's Backward/Forward
    const wManual = async () => pp.evaluate(() =>
      (((window as any).__XENON__?.()?.world ?? []).find((r: any) => /backward/.test(r.name))?.manual) ?? null);
    await pp.locator(`[data-testid="${OV}-overlay"] [data-testid="pilot-touch-w"]`).dispatchEvent('pointerdown');
    await expect.poll(wManual, { timeout: 15_000 }).toBe(1);
    // release = keyup: the stick centers
    await pp.locator(`[data-testid="${OV}-overlay"] [data-testid="pilot-touch-w"]`).dispatchEvent('pointerup');
    await expect.poll(wManual, { timeout: 15_000 }).toBe(0);
    await ph.close();
    await page.getByTestId('xenon-close').click();
  });
});
