// xenon.spec.ts — the Xenon IDE (v1.13 batch: "in the menu add Xenon …
// list all computers … pop-up with its code that looks like it does in-game",
// "display using the screen and HD screen that a craft may have", "code that
// has nodes should also render"). E2E-TIER because the laws live in the
// browser: the dev's XenonCode interpreter boots as WASM, runs the craft's
// own program, and its XenonScreen framebuffer reaches canvas pixels; the
// #NODES graph paints on canvas. Pure helpers (tokenizer, #NODES parse,
// channel detection, blueprint extraction) are vitest-pinned —
// src/engine/__tests__/xenoncode.test.ts; the VM LAWS v1.16.6 (boot/compile,
// screen PIXEL censuses, the alias io bus, the stick's algebra, dashboard
// button presses, the built-in panel size) run the SAME wasm in vitest —
// src/engine/__tests__/xenonvm.test.ts.
//
// Fixtures: Just-Plane-Easy (3294880085, screen("TrimsDash",0) → the
// Dashboard's 50×25 HdScreen element) and the Cheap Exploration Plane
// (3327182790, pure #NODES flight-control program, no screens).
import { expect, test } from '@playwright/test';

const PLANE = '3294880085';
const CEP = '3327182790';
const BADGER = '3326372833';
// (The v1.13.2-era Mario full-game leg was REPLACED in v1.13.7 by the
// BUZZER BENCH fixture 9000008001 below — the same laws, deterministic,
// seconds; the game stays a manual playtest, not a CI test.)

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
  // v1.16.6 (L5): the SCREEN lit-pixel census, the io-bus alias rows and the
  // STICK LAW (elevator channel → PitchControlJunction = −(stick+trim)) moved
  // to xenonvm.test.ts — the real wasm in vitest measures them EXACT
  // (out = −0.8 at stick 0.8; the e2e polled a <−0.3 band). This leg keeps
  // the IDE DOM: the WIP menu, the file tabs, the code pane, the validator.
  test('the craft computer boots on the dev WASM: menu, tabs, code, validator @slow', async ({ page }) => {
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

    // the Dashboard HdScreen ("TrimsDash", 0) is registered as a live surface
    await expect(page.locator('[data-testid="xenon-screen-trimsdash#0"]')).toBeVisible();

    // Esc closes
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('xenon-dialog')).toHaveCount(0);
  });

  // v1.13.25 (we: "an index of all known library and custom-defined
  // functions … ctrl-f text … easily maximise the IDE … F5 should run the
  // code, so long as a computer or screen window is open"). E2E-TIER
  // because the laws are key routing (Ctrl+F/F5/Escape between the CM
  // panel, the IDE window and the browser) + viewport geometry.
  test('IDE extras: Library index+jump, Ctrl-F find, ⛶ maximise, F5 re-boot @slow @codeditor', async ({ page }) => {
    await page.goto(`/?craft=${PLANE}`);
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 90_000 });
    await page.getByTestId('xenon-menu').click();
    await page.locator('[data-testid^="xenon-comp-"]').first().click();
    const dlg = page.getByTestId('xenon-dialog');
    await expect(dlg).toBeVisible();

    // LIBRARY TAB: the built-in docs render and filter; a declared function
    // JUMPS — opening its file with the caret on the declaration
    await page.getByTestId('xenon-side-library').click();
    await expect(page.getByTestId('xenon-lib-doc-print')).toContainText('console');
    await page.getByTestId('xenon-lib-search').fill('worldsim');
    await expect(page.getByTestId('xenon-lib-doc-setworldsim')).toBeVisible();
    await expect(page.getByTestId('xenon-lib-doc-print')).toHaveCount(0);
    // CATEGORY TABS (v1.13.26): a group chip shows only its coloured rows
    await page.getByTestId('xenon-lib-search').fill('');
    await page.getByTestId('xenon-lib-g-screen').click();
    await expect(page.getByTestId('xenon-lib-doc-screen')).toBeVisible();
    await expect(page.getByTestId('xenon-lib-doc-print')).toHaveCount(0);
    await page.getByTestId('xenon-lib-g-all').click();
    await expect(page.getByTestId('xenon-lib-doc-print')).toBeVisible();
    await page.getByTestId('xenon-lib-search').fill('selectcase');
    await expect(page.getByTestId('xenon-lib-fn-selectcase')).toBeVisible();
    await page.getByTestId('xenon-lib-fn-selectcase').click();
    await expect(page.getByTestId('xenon-code-1')).toContainText('function @selectcase');

    // CTRL+F from a dead zone (the tab strip) opens the FIND panel; Escape
    // closes ONLY the panel — the popup stopPropagation law (the window's
    // Esc-closes-the-IDE handler must not eat the same keystroke)
    await page.getByTestId('xenon-tab-1').click();
    await page.keyboard.press('Control+f');
    const panel = page.locator('.cm-panel.cm-search');
    await expect(panel).toBeVisible();
    await panel.locator('input').first().fill('output_number');
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(dlg).toBeVisible();

    // MAXIMIZE: ⛶ fills the viewport; a title-bar double-click restores
    const vp = page.viewportSize()!;
    const box0 = (await dlg.boundingBox())!;
    await page.getByTestId('xenon-max').click();
    await expect(dlg).toHaveAttribute('data-maximized', '1');
    const box1 = (await dlg.boundingBox())!;
    expect(box1.width).toBeGreaterThanOrEqual(vp.width - 1);
    expect(box1.height).toBeGreaterThanOrEqual(vp.height - 1);
    expect(box1.width).toBeGreaterThan(box0.width);
    await dlg.locator('> div').first().dblclick();
    await expect(dlg).not.toHaveAttribute('data-maximized');
    expect(((await dlg.boundingBox())!).width).toBeLessThan(vp.width - 1);

    // F5 RUN inside the IDE: the cycle counter rewinds (re-boot), the page
    // never reloads (no browser refresh while a computer window is open).
    // Gate on a SETTLED counter (>30 ≈ 1.2 s of running) so the rewind
    // cannot race the poll on a freshly booted pump.
    const cycles = () => page.evaluate(() => (window as any).__XENON__().cycles as number);
    await expect.poll(async () => (await cycles()) > 30, { timeout: 30_000 }).toBe(true);
    const c0 = await cycles();
    await page.keyboard.press('F5');
    await expect
      .poll(async () => (await cycles()) < c0 / 2, { timeout: 15_000, intervals: [200] })
      .toBe(true);
    await expect(dlg).toBeVisible();

    // F5 with ONLY the ▣ Screens dock open: run (re-boot), not refresh
    // (close() zeroes the counter, so the gate sees the NEW boot counting)
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
    await page.getByTestId('screens-btn').click();
    await expect.poll(async () => (await cycles()) > 30, { timeout: 30_000 }).toBe(true);
    const c1 = await cycles();
    await page.keyboard.press('F5');
    await expect
      .poll(async () => (await cycles()) < c1 / 2, { timeout: 15_000, intervals: [200] })
      .toBe(true);
    await expect(page.getByTestId('screens-btn')).toBeVisible();
  });

  // v1.13.26 (we: "ctrl-g needs to go to a certain line … Tab needs to not
  // move the cursor out of the editor … after hitting enter on an init,
  // update etc. block, the next line should automatically indent, same
  // with a function … mouseovering a io write/read … resolve what kind of
  // device it is … display the 3d view"). E2E-TIER because these are real
  // key routing + caret geometry + the hover tooltip + the camera.
  test('editor keys: Tab stays, block auto-indent, Ctrl+G, io hover + 3-D fly @slow @codeditor', async ({ page }) => {
    await page.goto(`/?craft=${PLANE}`);
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 90_000 });
    await page.getByTestId('xenon-menu').click();
    await page.locator('[data-testid^="xenon-comp-"]').first().click();
    await expect(page.getByTestId('xenon-dialog')).toBeVisible();
    const cm = page.locator('.cm-content');
    await cm.click();
    await page.keyboard.press('Control+End');

    // Enter after a block opener indents one unit; after a nested opener
    // TWO units; Tab lands inside the editor, focus NEVER leaves
    await page.keyboard.type('update');
    await page.keyboard.press('Escape');          // dismiss the completion popup
    await page.keyboard.press('Enter');
    await page.keyboard.type('init');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Enter');
    // assert the auto-indent BEFORE Tab rides on top of it: Enter after a
    // block opener lands one TAB deeper (the game's scope grammar)
    const txt = await cm.evaluate((el: HTMLElement) => el.innerText);
    expect(txt, 'TAIL: ' + JSON.stringify(txt.slice(-100))).toMatch(/update\n\tinit\n\t\t/);
    // Tab lands INSIDE the code (focus law) and adds indent — its exact
    // stop-fill is CM's business, the two laws are ours
    await page.keyboard.press('Tab');
    const txtTab = await cm.evaluate((el: HTMLElement) => el.innerText);
    expect(txtTab).not.toBe(txt);
    expect(await page.evaluate(() =>
      (document.activeElement as HTMLElement | null)?.closest('.cm-editor') !== null)).toBe(true);

    // Ctrl+G jumps the caret to a line (jump to 1 → typed text lands at
    // the very top of the file)
    await page.keyboard.press('Control+g');
    const goto = page.getByTestId('xc-goto-input');
    await expect(goto).toBeVisible();
    await goto.fill('1');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('xc-goto')).toHaveCount(0);
    await page.keyboard.type(';;G');
    const txt2 = await cm.evaluate((el: HTMLElement) => el.innerText);
    // CM's innerText may lead with blank-line newlines — anchor on the
    // first NON-EMPTY rendered line
    expect(txt2.replace(/^\n+/, '').startsWith(';;G')).toBe(true);

    // io HOVER: over an output_number("alias", ch, …) the tooltip names
    // the DEVICE (type), the channel MEANING and the live write value
    const ioLine = page.locator('.cm-line', { hasText: 'output_number(' }).first();
    const t = await ioLine.innerText();
    const alias = /output_number\(\s*"([^"]+)"/.exec(t)?.[1];
    expect(alias).toBeTruthy();
    const box = (await ioLine.boundingBox())!;
    const x = await ioLine.evaluate((el, idx) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let n: Text | null; let acc = 0;
      while ((n = walker.nextNode() as Text | null)) {
        if (idx <= acc + n.length) {
          const r = document.createRange();
          r.setStart(n, idx - acc); r.setEnd(n, Math.min(n.length, idx - acc + 1));
          return r.getBoundingClientRect().left;
        }
        acc += n.length;
      }
      return el.getBoundingClientRect().left;
    }, t.indexOf('output_number') + 4);
    await page.mouse.move(x, box.y + box.height / 2);
    const tip = page.locator('.cm-tooltip').first();
    await expect(tip).toBeVisible({ timeout: 8_000 });
    await expect(tip).toContainText(alias!);
    await expect(tip).toContainText('write');
    // the tooltip carries the device's CATALOG PREVIEW (the placement
    // menu's own live-model renderer fills the img, async) — we: "a view
    // of the component's normal appearance like in the menu where its
    // placed from"
    const thumb = tip.locator('img[data-testid="xc-io-thumb"]');
    await expect(thumb).toBeVisible();
    await expect
      .poll(async () => ((await thumb.getAttribute('src')) ?? '').length > 100,
        { timeout: 20_000, intervals: [300] })
      .toBe(true);

    // Ctrl+Click on the call → the 3-D view FLEYS to the device
    const cam = () => page.evaluate(() => (window as any).__XENON__().cam?.() ?? null);
    const cam0 = await cam();
    await page.keyboard.down('Control');
    await page.mouse.click(x, box.y + box.height / 2);
    await page.keyboard.up('Control');
    await expect
      .poll(async () => JSON.stringify(await cam()) !== JSON.stringify(cam0),
        { timeout: 10_000, intervals: [250] })
      .toBe(true);

    // closing the IDE DISCARDS the unsaved buffers (v1.13.27: SAVE is the
    // only commit; the scratch edit never reaches the disk)
    await page.keyboard.press('Escape');
  });

  // v1.16.6 (L5): the alias io bus ('mining-drill'), the NAMED-screen paint
  // (pilot-screen#0 lit census) and the globals census moved to
  // xenonvm.test.ts — the same wasm compiles the 36k lines in <1 s on node
  // (this leg's 240 s budget was browser boot + pump latency). This leg
  // keeps the browser-only laws: 57 file TABS wrap the tab strip, the
  // biggest file renders WINDOWED (data-lines), the CONSOLE tab renders the
  // pump's print log.
  test('the Badger boots: 57 tabs, console log, windowed 7459-line file @slow', async ({ page }) => {
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
    // the biggest file (dashboard-art.xc, 7459 lines) renders WINDOWED —
    // v1.13.x retired the 1500-line view cap: every line is reachable,
    // none are rendered at once
    await page.locator('[data-testid^="xenon-tab-"]', { hasText: 'dashboard-art.xc' }).click();
    const view = page.getByTestId('xc-editor');
    await expect(view).toBeVisible();
    expect(Number(await view.getAttribute('data-lines'))).toBeGreaterThan(7000);
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

  // v1.16.6 (L5): the surface census (10#0 = 870×390), the lit-pixel law and
  // THE BUTTON PRESS ($disp 1→0 at canvas px 4,4 — the v1.13.x VOID
  // button_rect fix, per computer.md) moved to xenonvm.test.ts (VM side,
  // exact values). This leg keeps the REAL-POINTER plumbing the VM cannot
  // state: the thumbnail→ZOOM WINDOW raise, the press at 1:1 canvas scale,
  // the vars tab row, the CM $var hover, the clean validator.
  test('craft 3381670618: the IDE shows the dashboard, zoom-window press, vars, hover @slow', async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto('/?craft=3381670618');
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 120_000 });
    await page.getByTestId('xenon-menu').click();
    await page.locator('[data-testid^="xenon-comp-"]').first().click();
    await expect(page.getByTestId('xenon-on')).toHaveText('ON', { timeout: 60_000 });
    await expect(page.getByText(/is running…/)).toBeVisible();
    // the io-10 Dashboard surface is registered at the ELEMENT size (the
    // canvas px are the VM surface px — xenonvm.test.ts pins the VM side)
    const scr = page.locator('[data-testid="xenon-screen-10#0"]');
    await expect(scr).toBeVisible();
    expect(await scr.evaluate(el => (el as HTMLCanvasElement).width)).toBe(870);   // 145-unit element at the 6 px-per-unit screen scale
    // clicking the thumbnail opens its ZOOM WINDOW, and the button press
    // lands on the 1:1 fullscreen canvas (the DOM pointer→VM px plumbing)
    await page.getByTestId('xenon-screen-10#0').click();
    const full = page.getByTestId('xenon-cell-10#0-fullcanvas');
    await expect(full).toBeVisible();
    const fb = (await full.boundingBox())!;
    await full.click({ position: { x: fb.width * 4 / 870, y: fb.height * 4 / 396 } });
    await page.getByTestId('xenon-cell-10#0-fullexit').click();
    await page.getByTestId('xenon-side-vars').click();
    await expect(page.getByTestId('xenon-var-disp')).toBeVisible();
    // the 3381670618 code validates clean (no red lines in the entry file)
    await page.getByTestId('xenon-tab-0').click();
    await expect(page.locator('.cm-line.xc-line-error')).toHaveCount(0, { timeout: 15_000 });
    // $var hover (CM): the tooltip shows the CURRENT live value
    const tok = page.locator('.cm-content span').filter({ hasText: /^\$auto\b/ }).first();
    await expect(tok).toBeVisible({ timeout: 15_000 });
    await tok.hover();
    await expect(page.locator('.cm-tooltip .xc-hover').first()).toContainText('=', { timeout: 8_000 });
    await page.keyboard.press('Escape');
  });

  // v1.16.6 (L5): the VM-side streams are pinned in xenonvm.test.ts — the
  // TRACKING GATE (unarmed = zero recording), the pair/depth index alignment
  // + SOURCEFILE-TRUTH bounds, the exact-line PARK site. This leg keeps the
  // browser laws: F-key routing, the break-table UI and the CM follow.
  test('the debugger: breakpoint pauses, F10 steps LINES, F11 steps in, F8 resumes @slow', async ({ page }) => {
    // (we: "f10 should mean step one line and f11 step into" + "we dont have
    // an overview window for breakpoints" + "I need to know where we are
    // debugging") — XENON-DEBUG v2: the interpreter streams (file,line)
    // pairs in execution order; a break pauses AT its first executed pair,
    // F10 stops at the next executed LINE, the pill says WHERE
    // (file:line), the BREAKPOINTS strip lists every break.
    await page.goto(`/?craft=${CEP}`);
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 90_000 });
    await page.getByTestId('xenon-menu').click();
    // THE MODE WARNING (v1.13.18 + v1.15.1, we: "remove the notification
    // that says its possible to debug … just the warning"): this suite runs
    // on an isolated origin — the menu says NOTHING; only the dialog's
    // xenon-mode chip (below) reports the live stepper.
    await expect(page.getByTestId('xenon-sab-warn')).toHaveCount(0);
    await page.locator('[data-testid^="xenon-comp-"]').first().click();
    await expect(page.getByTestId('xenon-on')).toHaveText('ON', { timeout: 60_000 });
    // the IDE chip states the LIVE stepper (pump.wrun — the dev-only
    // StrictMode stale-open race nulled it while the VM ran on the worker;
    // the chip + this pin make any such silent degradation visible)
    await expect(page.getByTestId('xenon-mode')).toContainText('worker · true line-stepping');
    await page.getByTestId('xenon-tab-0').click();
    // line 17 (output_number(8,0,...)) runs EVERY cycle — click its gutter
    const gutter = page.locator('.xc-break-gutter .cm-gutterElement').nth(16);
    await expect(gutter).toBeVisible();
    await gutter.click();
    await expect(page.locator('.xc-bp')).toHaveCount(1);
    // the overview strip lists the break (file:line + code excerpt)
    const ov = page.getByTestId('bp-overview');
    await expect(ov).toBeVisible();
    await expect(ov).toContainText(':17');
    // the pump pauses AT the pair
    const pill = page.getByTestId('xenon-paused');
    await expect(pill).toBeVisible({ timeout: 15_000 });
    await expect(pill).toHaveAttribute('data-line', '17');
    const cycles = async () => Number(
      (await page.getByText(/cycles \d+ @ 25 Hz/).first().innerText()).match(/cycles (\d+)/)?.[1] ?? -1);
    const c0 = await cycles();
    await page.waitForTimeout(1200);
    expect(await cycles()).toBe(c0);                 // frozen while paused
    // F10 = the NEXT EXECUTED LINE. THE MODE LAW (v1.13.17): in WORKER
    // mode the VM stops MID-CYCLE inside xc_cycle — the pump's cycle
    // counter is FROZEN through every step (the cycle completes only on
    // resume); the main-thread stepper (Pages / non-isolated origins)
    // consumes one pump cycle per step instead.
    const workerMode = await page.evaluate(
      () => (window as any).__XENON__?.()?.worker === true);
    await page.keyboard.press('F10');
    await expect.poll(async () => Number(await pill.getAttribute('data-line')),
      { timeout: 8_000 }).not.toBe(17);              // the line ADVANCED
    await expect(pill).toBeVisible();
    expect(await cycles()).toBe(workerMode ? c0 : c0 + 1);
    const l1 = Number(await pill.getAttribute('data-line'));
    await page.keyboard.press('F11');                // step into: next pair
    await expect.poll(async () => Number(await pill.getAttribute('data-line')),
      { timeout: 8_000 }).not.toBe(l1);
    await expect(pill).toBeVisible();
    expect(await cycles()).toBe(workerMode ? c0 : c0 + 2);
    if (workerMode) {
      // THE MID-CYCLE PROOF: two steps, ZERO cycles — the VM never
      // finished the update it stepped into
      expect(await page.evaluate(() => (window as any).__XENON__().cycles)).toBe(c0);
    }
    // F8 = resume: the cycle COMPLETES (worker: the first cycle lands
    // now), the break re-arms and cycles stream past
    await page.keyboard.press('F8');
    await expect.poll(cycles, { timeout: 8_000 }).toBeGreaterThan(c0);
    // the overview ✕ removes the break (strip disappears)
    await page.locator('[data-testid^="bp-row-"]').first().hover();
    await page.locator('[data-testid^="bp-row-"] span[role="button"]').first().click();
    await expect(page.getByTestId('bp-overview')).toHaveCount(0);
    await page.keyboard.press('Escape');
  });

  test('THE LOCALS TAB: break inside a function, read its live frame @slow', async ({ page }) => {
    // (we: "When debugging local variables, I cannot see their value. But
    // that is vital when debugging locals; add this as a tab, also put the
    // tabs currently vertically labeled as top-tabs at the same level as
    // the search names/values") — XENON-LOCALS: the parked worker's hook
    // reads its own function's RAM frame and hands it over on the SAB; the
    // tab rides the row that carries the search box. Runs on PLANE, whose
    // functions.xc @selectcase takes its >0 branch every cycle once the
    // throttle-key channel (io 11 ch 3) is fed.
    // e2e-tier because: the frame under test is the REAL worker VM parked
    // mid-cycle inside xc_cycle — the SAB handoff, the hook's dumper call
    // and the layout law (search at the tab level) are browser laws; the
    // JSON/reader/filter/shadowing half is vitest-pinned (THE LOCALS LAW).
    await page.goto(`/?craft=${PLANE}`);
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 90_000 });
    await page.getByTestId('xenon-menu').click();
    await page.locator('[data-testid^="xenon-comp-"]').first().click();
    await expect(page.getByTestId('xenon-on')).toHaveText('ON', { timeout: 60_000 });
    // this pin is the worker-mode proof: the frame the hook dumps is the
    // MID-CYCLE truth (the parked VM's own voice), not a cycle-end echo
    await expect(page.getByTestId('xenon-mode')).toContainText('worker · true line-stepping');
    await page.getByTestId('xenon-side-bus').click();
    const key = page.getByTestId('xenon-in-11-3');
    await key.evaluate((el: HTMLInputElement) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      set.call(el, '1');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    // functions.xc tab: break on line 10 — `$result += $increment`, inside
    // the `if $inputsource>0` branch (line 10 as authored: 4 header lines,
    // the declaration, the $result init, a comment, the if, a comment)
    await page.getByTestId('xenon-tab-1').click();
    const gutter = page.locator('.xc-break-gutter .cm-gutterElement').nth(9);
    await expect(gutter).toBeVisible();
    await gutter.click();
    await expect(page.locator('.xc-bp')).toHaveCount(1);
    const pill = page.getByTestId('xenon-paused');
    await expect(pill).toBeVisible({ timeout: 15_000 });
    await expect(pill).toHaveAttribute('data-line', '10');
    // THE LOCALS PANEL (v1.13.22: co-habits the Vars tab, ALWAYS ON TOP):
    // the frame chip names the owning function; the rows carry the
    // ARGUMENTS the pause-carrying call passed (increment 5, limits
    // 0..100 = the throttle call) and $result — ABOVE the globals section
    await page.getByTestId('xenon-side-vars').click();
    await expect(page.getByTestId('xenon-locals-frame')).toContainText('@selectcase');
    await expect(page.getByTestId('xenon-loc-inputsource')).toBeVisible();
    await expect(page.getByTestId('xenon-loc-increment')).toContainText('5');
    await expect(page.getByTestId('xenon-loc-lowerlimit')).toContainText('0');
    await expect(page.getByTestId('xenon-loc-upperlimit')).toContainText('100');
    await expect(page.getByTestId('xenon-loc-result')).toBeVisible();
    // THE CO-HABITATION LAW (we: "vars and locals should co-habit the same
    // tab, with locals always on top"): one panel, the frame rows above
    // the globals head and its rows
    const locBox = await page.getByTestId('xenon-loc-result').boundingBox();
    const ghBox = await page.getByTestId('xenon-globals-head').boundingBox();
    expect(!!locBox && !!ghBox && locBox.y + locBox.height <= ghBox.y).toBe(true);
    const anyVar = page.locator('[data-testid^="xenon-var-"]:not([data-testid="xenon-var-search"])').first();
    const varBox = await anyVar.boundingBox();
    expect(!!ghBox && !!varBox && ghBox.y <= varBox.y).toBe(true);
    // THE ROW LAW (the layout half of the ask): the search box sits AT THE
    // SAME LEVEL as the tab row — the old vertical rail is gone (boxes
    // overlap vertically)
    const tab = await page.getByTestId('xenon-side-vars').boundingBox();
    const box = await page.getByTestId('xenon-var-search').boundingBox();
    expect(!!tab && !!box && tab.y < box.y + box.height && box.y < tab.y + tab.height).toBe(true);
    // the shared search filters the frame
    await page.getByTestId('xenon-var-search').fill('increment');
    await expect(page.locator('[data-testid^="xenon-loc-"]')).toHaveCount(1);
    await page.getByTestId('xenon-var-search').fill('');
    // XENON-WRITEBACK (we: "the capacity to edit its current value, valid
    // for its type, type shown beside the name, reject invalid values,
    // inject those back into xenoncode"): the paused frame's $result is
    // editable — 'abc' is refused inline (the editor stays open), 42 is
    // accepted and lands in the row (the ack ok + the RAM slot is written)
    await expect(page.getByTestId('xenon-loc-result')).toContainText('number');
    await page.getByTestId('xenon-val-result').click();
    const inp = page.getByTestId('xenon-edit-result');
    await expect(inp).toBeVisible();
    await inp.fill('abc');
    await inp.press('Enter');
    await expect(page.getByTestId('xenon-edit-error')).toContainText('not a finite number');
    await inp.fill('42');
    await inp.press('Enter');
    await expect(page.getByTestId('xenon-loc-result')).toContainText('42');
    await expect(page.getByTestId('xenon-edit-error')).toHaveCount(0);
    // F8 resumes — FIRST disarm the break (the throttle-fed
    // `@selectcase` runs every cycle; a live break re-parks the VM at
    // ~25 Hz and races the writable-moment check below — the wasm rebuild
    // shifted that coin-flip and exposed the latent race)
    await gutter.click();
    await expect(page.locator('.xc-bp')).toHaveCount(0);
    await page.keyboard.press('F8');
    await expect(pill).toHaveCount(0);
    await expect(page.getByTestId('xenon-locals-frame')).toContainText('last stop');
    // THE WRITABLE-MOMENT LAW: a RUNNING worker has no writable moment —
    // the globals' values are plain text, no edit affordance
    expect(await page.locator('[data-testid="xenon-val-numset"]').count()).toBe(0);
    await page.keyboard.press('Escape');
  });

  // v1.13.27 (we: "when hitting a breakpoint in execution, the editor
  // should move to the point just being hit … create a navpoint we can
  // browser-history to … save should commit it and reload … keep
  // breakpoints … red, green … are colors"). E2E-TIER: pump pause timing,
  // DOM focus geometry, the commit/re-boot loop.
  test('nav history + breakpoint follow + save keeps breaks @slow @codeditor', async ({ page }) => {
    await page.goto(`/?craft=${PLANE}`);
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 90_000 });
    await page.getByTestId('xenon-menu').click();
    await page.locator('[data-testid^="xenon-comp-"]').first().click();
    await expect(page.getByTestId('xenon-dialog')).toBeVisible();

    // BREAKPOINT on the every-cycle line 17 (same gutter the debugger leg
    // uses): the PAUSE makes the pane report the hit (breakpoint-follow)
    const gutter = page.locator('.xc-break-gutter .cm-gutterElement').nth(16);
    await expect(gutter).toBeVisible();
    await gutter.click();
    await expect(page.locator('.xc-bp')).toHaveCount(1);
    const pane = page.getByTestId('xenon-code-0');
    await expect(pane).toHaveAttribute('data-paused-jump', /main\.xc:17$/, { timeout: 20_000 });
    await page.keyboard.press('F8');

    // SAVE commits + re-boots, the BREAKPOINT SURVIVES (marker + hit)
    const cm = page.locator('.cm-content');
    await cm.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n; nav-pin');
    await page.getByTestId('xenon-save').click();
    await expect(page.getByTestId('xenon-on')).toHaveText('ON', { timeout: 60_000 });
    await expect(page.locator('.xc-bp')).toHaveCount(1);
    // the break fires again after the commit (line 18 now — the '; nav-pin'
    // comment rode in front of nothing, the break line shifted by one)
    await expect(pane).toHaveAttribute('data-paused-jump', /main\.xc:1[78]$/, { timeout: 20_000 });
    // disarm the breakpoint, resume — the nav steps run unparked
    await gutter.click();
    await expect(page.locator('.xc-bp')).toHaveCount(0);
    await page.keyboard.press('F8');

    // NAV: the Library jump records the pause spot; Alt+← walks back,
    // Alt+→ forward
    await page.getByTestId('xenon-side-library').click();
    await page.getByTestId('xenon-lib-fn-selectcase').click();
    await expect(page.getByTestId('xenon-code-1')).toContainText('function @selectcase');
    await expect(page.getByTestId('xenon-nav-back')).toBeEnabled();
    await page.keyboard.press('Alt+ArrowLeft');
    await expect(page.getByTestId('xenon-nav-forward')).toBeEnabled({ timeout: 10_000 });
    await page.keyboard.press('Alt+ArrowRight');

    // COLORS are first-class: the Colors chip shows swatched constants,
    // and typing 'r' completes `red` as a constant
    await page.getByTestId('xenon-lib-g-color').click();
    await expect(page.getByTestId('xenon-const-red')).toContainText('red');
    await expect(page.getByTestId('xenon-const-white')).toBeVisible();
    await page.getByTestId('xenon-tab-1').click();
    await cm.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\nvar $zzc = whi', { delay: 30 });
    const ac = page.locator('.cm-tooltip-autocomplete');
    await expect(ac).toBeVisible({ timeout: 8_000 });
    await expect(ac).toContainText('white');
    // closing the IDE discards the unsaved buffers (save is the commit)
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
  });

  // v1.13.28 (we: "Sometimes when I press f10 it doesnt seem to properly
  // move to where I am executing code"): the CLASSIC step-over law — F10
  // advances ONE executed line at the CURRENT frame; a call into another
  // file is stepped OVER. In-file frame stepping (functions.xc calls
  // @selectcase from its own body): the OLD scope-window law jumped out of
  // the function and skipped ahead to line ~49; the frame law lands on the
  // NEXT BODY LINE.
  test('F10 steps line-by-line in the current frame @slow @codeditor', async ({ page }) => {
    await page.goto(`/?craft=${PLANE}`);
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 90_000 });
    await page.getByTestId('xenon-menu').click();
    await page.locator('[data-testid^="xenon-comp-"]').first().click();
    await expect(page.getByTestId('xenon-dialog')).toBeVisible();

    // top level: consecutive executed lines. The exact-line law is the
    // WORKER stepper; on a LAN origin (main-thread pump, no SAB) every
    // step advances a FULL cycle — the mode chip's announced degradation.
    // The chip flips LIVE (worker boot races the booting status), so the
    // gate is read LAZILY. The FOLLOW law (v1.13.33, we: "the
    // scroll/focus doesn't change position when I used f11 … not
    // acceptable") must hold on BOTH.
    const isWorker = () => page.getByTestId('xenon-mode')
      .innerText().then(t => t.includes('worker · true line-stepping'));
    const lineExp = async (n: number) => (await isWorker())
      ? new RegExp(`main\\.xc:${n}$`) : /main\.xc:\d+$/;
    // the FOLLOW observable: data-editor-jump (jumpTo's target) must equal
    // the stop site — asserting data-paused-jump alone proves the pump,
    // not the editor follow.
    const followTo = async (pane: import('@playwright/test').Locator) => {
      const site = await pane.getAttribute('data-paused-jump');
      expect(site, 'a stop site exists').toBeTruthy();
      await expect
        .poll(() => pane.getAttribute('data-editor-jump'),
          { message: `the editor follows the stop site ${site}`, timeout: 5_000 })
        .toBe(site);
      // v1.16.13: the attribute is set by the dialog's jumpTo BEFORE the
      // scroll runs — the FOLLOW law is about the VIEW. The active (paused)
      // line must sit INSIDE the code pane's box (the user: "when I debug
      // and step into, my scroll does NOT move").
      const paneBox = await pane.boundingBox();
      const active = pane.locator('.cm-activeLine').first();
      await expect
        .poll(async () => {
          const a = await active.boundingBox();
          if (!paneBox || !a) return false;
          return a.y >= paneBox.y - 4 && a.y + a.height <= paneBox.y + paneBox.height + 4;
        }, { message: `the paused line is on screen at ${site}`, timeout: 5_000 })
        .toBe(true);
    };
    await page.locator('.xc-break-gutter .cm-gutterElement').nth(16).click();
    const pane0 = page.getByTestId('xenon-code-0');
    await expect(pane0).toHaveAttribute('data-paused-jump', /main\.xc:17$/, { timeout: 20_000 });
    await followTo(pane0);
    await page.keyboard.press('F10');
    await expect(pane0).toHaveAttribute('data-paused-jump', await lineExp(18), { timeout: 10_000 });
    await followTo(pane0);
    await page.keyboard.press('F10');
    await expect(pane0).toHaveAttribute('data-paused-jump', await lineExp(19), { timeout: 10_000 });
    await followTo(pane0);
    await page.keyboard.press('F8');
    await page.waitForTimeout(600);
    // DISARM main's break (measured: with it live, every cycle parks at
    // 17 BEFORE the function runs, so the functions.xc break is
    // unreachable — the pump sits parked, not stepping)
    await page.locator('.xc-break-gutter .cm-gutterElement').nth(16).click();
    await expect(page.locator('.xc-bp')).toHaveCount(0);
    await page.keyboard.press('F8');   // the removal parked AT 17 — resume

    // inside the function (functions.xc:6, the @selectcase `if`): the
    // throttle-key channel must be FED (the leg feeds io 11 ch 3) or
    // @selectcase is never called; the pause is in the frame; F10 stays
    // IN THE BODY (line < 45 = the body range [5..44]) — the old law
    // landed at 49+ (out of the function)
    await page.getByTestId('xenon-side-bus').click();
    await page.getByTestId('xenon-in-11-3').evaluate((el: HTMLInputElement) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      set.call(el, '1');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.getByTestId('xenon-tab-1').click();
    await page.locator('.xc-break-gutter .cm-gutterElement').nth(5).click();
    const pane1 = page.getByTestId('xenon-code-1');
    await expect(pane1).toHaveAttribute('data-paused-jump', /functions\.xc:6$/, { timeout: 20_000 });
    await page.keyboard.press('F10');
    // auto-retrying: the wake→park→notify→render cycle takes ~1 frame.
    // Body-range = the WORKER stepper law; the main-thread stepper runs a
    // full cycle per step (the pair may land anywhere ≥ the call site).
    await expect(pane1).toHaveAttribute('data-paused-jump',
      (await isWorker()) ? /functions\.xc:(?:[1-3]?\d|4[0-4])$/ : /functions\.xc:\d+$/,
      { timeout: 10_000 });
    await followTo(pane1);
    // v1.13.33 (we: "the scroll/focus doesn't change position when I used
    // f11, necessitating me to find it manually. That is not acceptable"):
    // EVERY debugger stop — steps included — must move the editor. On the
    // main-thread stepper the cycle-granular stream can land the F11 stop
    // in main.xc (the tab then FOLLOWS — it must!), so the check rides
    // the ACTIVE pane, file-agnostic. e2e-tier because: the law is the
    // live pump→editor follow chain.
    await page.keyboard.press('F11');
    const paneN = page.locator('[data-testid^="xenon-code-"]').first();
    await expect(paneN).toHaveAttribute('data-paused-jump',
      /\.xc:\d+$/, { timeout: 10_000 });
    await followTo(paneN);
    await page.keyboard.press('F8');
    await page.keyboard.press('Escape');
  });

  // v1.13.28 (we: "Running the code/resetting/stopping should have
  // classical style buttons"; "After if statements the indent should be
  // one deeper"; "a red asterisk… for modified"; "when I type $
  // suggestions for locals should show up")
  test('run toolbar + if-indent + dirty dot + frame locals @slow @codeditor', async ({ page }) => {
    await page.goto(`/?craft=${PLANE}`);
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 90_000 });
    await page.getByTestId('xenon-menu').click();
    await page.locator('[data-testid^="xenon-comp-"]').first().click();
    await expect(page.getByTestId('xenon-dialog')).toBeVisible();

    // CLASSIC TOOLBAR: ⏹ stops (ON→OFF), ▶ runs again
    await expect(page.getByTestId('ide-stop')).toBeVisible();
    // v1.13.32 (we: "debug buttons as part of the title to save space"):
    // the toolbar rides the TITLE BAR (the FloatingWindow drag handle)
    await expect(page.locator('div.cursor-move [data-testid="ide-stop"]')).toBeVisible();
    await page.getByTestId('ide-stop').click();
    await expect(page.getByTestId('xenon-on')).toHaveText('OFF', { timeout: 10_000 });
    await page.getByTestId('ide-run').click();
    await expect(page.getByTestId('xenon-on')).toHaveText('ON', { timeout: 30_000 });
    // v1.13.31 (workpackages WP7): ⏹ now PARKS on the EXECUTING line, so
    // the breakpoint-follow may have moved the editor to that file (the
    // timer block lives in functions.xc) — return to the main tab, the
    // dirty-dot pin below is about the tab we type into
    await page.getByTestId('xenon-tab-0').click();

    // IF auto-indents one unit (a tab) on Enter; the tab gets the RED dot
    const cm = page.locator('.cm-content');
    await cm.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\nif $x > 2');
    await page.keyboard.press('Enter');
    const txt = await cm.evaluate((el: HTMLElement) => el.innerText);
    expect(txt, 'TAIL: ' + JSON.stringify(txt.slice(-60))).toMatch(/if \$x > 2\n\t$/);
    await expect(page.getByTestId('xenon-tab-0')).toContainText('●');

    // $ COMPLETION carries the PAUSED FRAME's locals ($Pilot_WS is
    // declared inside update — visible only while the frame is live)
    await page.locator('.xc-break-gutter .cm-gutterElement').nth(16).click();
    await expect(page.getByTestId('xenon-code-0'))
      .toHaveAttribute('data-paused-jump', /main\.xc:17$/, { timeout: 20_000 });
    await cm.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\nvar $zz = $Pilo', { delay: 30 });
    const ac = page.locator('.cm-tooltip-autocomplete');
    await expect(ac).toBeVisible({ timeout: 8_000 });
    await expect(ac).toContainText('Pilot_WS');
    await page.keyboard.press('Escape');
    // FLASH-ON-CHANGE (v1.13.32, we: "Modified variables should flash a
    // green background as an updated highlight, both locals and globals"):
    // the deterministic trigger is THE WRITEBACK LAW — write a global at
    // the park (first writable value cell) and its row remounts with the
    // .var-flash wash. e2e-tier because: the wash fires through the
    // panel's per-commit value diffing (notify → key remount → CSS anim).
    await page.getByTestId('xenon-side-vars').click();
    await expect(page.getByTestId('xenon-locals-frame')).toContainText(/main\.xc:17/);
    const cell = page.locator('[data-testid^="xenon-var-"] [data-testid^="xenon-val-"]').first();
    await expect(cell).toBeVisible({ timeout: 10_000 });
    const gname = (await cell.getAttribute('data-testid'))!.replace('xenon-val-', '');
    const gRow = page.getByTestId(`xenon-var-${gname}`);
    await cell.click();                                   // park-to-edit cell
    const gInput = page.getByTestId(`xenon-edit-${gname}`);
    await gInput.fill('42');
    await gInput.press('Enter');
    await expect(gRow).toContainText('42', { timeout: 10_000 });
    await expect(page.locator('.var-flash').first()).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press('Escape');   // close the IDE, discard buffers
  });

  test('the editor: syntax colors, right-click menu, go-to-definition, hover @slow @codeditor', async ({ page }) => {
    test.setTimeout(120_000);
    // (we: "there should be a context menu when I right click… I should have
    // go to definition as a right click menu and hovering over a function
    // should tell me its signature and where it lives… I need syntax
    // highlighting") — PLANE: its functions.xc declares @to/@call/@selectcase
    // tokens to hover and jump to
    await page.goto(`/?craft=${PLANE}`);
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 90_000 });
    await page.getByTestId('xenon-menu').click();
    await page.locator('[data-testid^="xenon-comp-"]').first().click();
    await expect(page.getByTestId('xenon-on')).toHaveText('ON', { timeout: 60_000 });
    // syntax highlighting: token spans are styled (the theme's generated
    // classes ride every keyword/var/number span)
    await expect(page.locator('.cm-content .cm-line').first()).toBeVisible();
    // POLLED (v1.16.10): CodeMirror's windowed doc fills over its first
    // frames — the LAW is "the doc is syntax-highlighted", not "frame 1
    // has spans" (the Jimmy-batch catch: a first-paint count raced).
    await expect
      .poll(() => page.evaluate(() => document.querySelectorAll(
        '.cm-content .cm-line span[class]').length), { timeout: 10_000 })
      .toBeGreaterThan(8);
    // RIGHT-CLICK a $var token → menu with Go to Definition / Run to
    // Cursor / Add Breakpoint
    const varTok = page.locator('.cm-content span').filter({ hasText: /^\$\S+$/ }).first();
    await expect(varTok).toBeVisible();
    await varTok.click({ button: 'right' });
    const menu = page.getByTestId('xc-ctxmenu');
    await expect(menu).toBeVisible();
    await expect(menu.getByTestId('ctx-runtocursor')).toBeVisible();
    await menu.getByTestId('ctx-breakpoint').click();
    await expect(page.locator('.xc-bp')).toHaveCount(1);
    // remove it again through the same menu
    await varTok.click({ button: 'right' });
    await page.getByTestId('ctx-breakpoint').click();
    await expect(page.locator('.xc-bp')).toHaveCount(0);
    // HOVER a @function declaration → signature + declaring file
    // (functions.xc declares function @to … — tab 1)
    await page.locator('[data-testid^="xenon-tab-"]', { hasText: 'functions.xc' }).click();
    await page.waitForTimeout(600);
    const fnTok = page.locator('.cm-content span').filter({ hasText: /^@\S+/ }).first();
    await expect(fnTok).toBeVisible({ timeout: 10_000 });
    await fnTok.hover();
    await expect(page.locator('.cm-tooltip span.xc-hover, .cm-tooltip .xc-hover').first())
      .toContainText('defined in', { timeout: 8_000 });
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
    // the editor is ALWAYS live (v1.13.27): type, then SAVE commits
    const cm = page.locator('.cm-content');
    await expect(cm).toBeVisible();
    await cm.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n; autosave-pin marker');
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
    // CodeMirror virtualizes too — scroll the scroller to the tail so the
    // appended marker line enters the DOM before asserting
    const codeBox = page.locator('.cm-scroller');
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

  test('IDE menus, single-row tab strip, and $/@/word AUTOCOMPLETE @slow @codeditor', async ({ page }) => {
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
    await expect(page.getByTestId('xenon-save')).toBeVisible();
    // v1.13.32 (we: "We can't see all files in code … expand the list of
    // file tabs to multiple lines when mouse over"): the strip is ONE row
    // at rest and WRAPS on hover. e2e-tier because: CSS :hover + computed
    // flex layout — no state seam exists.
    expect(await strip.evaluate(el => getComputedStyle(el).flexWrap)).toBe('nowrap');
    await strip.hover();
    await expect
      .poll(() => strip.evaluate(el => getComputedStyle(el).flexWrap),
        { message: 'the tab strip expands to multiple lines on hover' })
      .toBe('wrap');
    // DEBUG BUTTONS IN THE TITLE (v1.13.32, we: "debug buttons as part of
    // the title to save space"). e2e-tier because: the title bar IS the
    // FloatingWindow drag handle — the toolbar living inside it (drag
    // excluded on buttons) is DOM plumbing.
    await expect(page.locator('div.cursor-move [data-testid="ide-stop"]')).toBeVisible();
    await expect(page.locator('div.cursor-move [data-testid="ide-step-over"]')).toBeVisible();
    // autocomplete (real-time, CodeMirror): bare words complete the library,
    // '$' completes declared/live variables, '@' lists declared functions
    const cm = page.locator('.cm-content');
    await cm.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\nvar $zz_pitch_marker = input_', { delay: 30 });
    const ac = page.locator('.cm-tooltip-autocomplete');
    await expect(ac).toBeVisible({ timeout: 8_000 });
    await expect(ac).toContainText('input_number');
    await page.keyboard.press('Enter');
    await expect(cm).toContainText('input_number');
    await page.keyboard.type('  + $roll', { delay: 30 });
    await expect(ac).toBeVisible({ timeout: 8_000 });
    await expect(ac).toContainText('$rollnum');
    await page.keyboard.press('Escape');
    // declared FUNCTION completion: '@' lists function @names declared on disk
    await page.keyboard.type('\n@sel', { delay: 30 });
    await expect(ac).toBeVisible();
    await page.keyboard.press('Escape');
    // closing the IDE DISCARDS the unsaved buffers (v1.13.27: SAVE is the
    // only commit; the scratch edit never reaches the disk)
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
    const cm = page.locator('.cm-content');
    await expect(cm).toBeVisible();
    // insert INSIDE the update body: anchor on a tab-indented body line and
    // type before it — CM copies that line's indent, so the new line lands
    // in the section (XenonCode section bodies are indent-significant)
    // the print goes at the TOP of the update body (right after the
    // section header) — XenonCode section bodies are TAB-indented
    // (indent-significant), the typed line carries its own tab
    const upd = page.locator('.cm-line', { hasText: /^update$/ }).first();
    await expect(upd).toBeVisible({ timeout: 15_000 });
    await upd.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('print(text("alt: {}", input_number(4, 2)))');
    await page.getByTestId('xenon-save').click();
    await expect(page.getByTestId('xenon-on')).toHaveText('ON', { timeout: 90_000 });
    await page.getByTestId('xenon-side-console').click();
    await expect(page.getByTestId('xenon-log')).toContainText('alt: 2002', { timeout: 30_000 });
    // PROGRAM override via setworldsim wins over the expression — authored
    // the user's own way (v1.13.26): click the update line, End, ENTER
    // (auto-indent lands the body's tab), type the statement. The old
    // insert-at-Home + mid-line-Enter trick left the split `print` at
    // column 0 = global scope = boot error (measured twice)
    const upd2 = page.locator('.cm-line', { hasText: /^update$/ }).first();
    await expect(upd2).toBeVisible();
    await upd2.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('setworldsim("navinstrument.altitude_meters_from_sea_level", 3000)');
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
    // the zoom window writes the ?craft&dash DEEP LINK into the URL bar
    // (we: "when you open a screen fullscreen, update the URL to be a
    // deeplink") — this exact URL must boot straight into this view
    await expect(page).toHaveURL(/craft=3294880085&dash=trimsdash%230/);
    const zoom = page.getByTestId('screens-cell-trimsdash#0-zoom');
    await expect(zoom).toHaveText('100%');
    const cvFit = (await page.getByTestId('screens-cell-trimsdash#0-fullcanvas').boundingBox())!;
    await page.getByTestId('screens-cell-trimsdash#0-zoomin').click();
    await page.getByTestId('screens-cell-trimsdash#0-zoomin').click();
    await expect(zoom).toHaveText('156%');
    const cvZoom = (await page.getByTestId('screens-cell-trimsdash#0-fullcanvas').boundingBox())!;
    expect(cvZoom.width).toBeGreaterThan(cvFit.width * 1.4);
    await page.getByTestId('screens-cell-trimsdash#0-fullexit').click();
    // closing the zoom strips the dash param back out of the URL
    await expect(page).toHaveURL(/\?craft=3294880085$/);
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

  // THE BUZZER BENCH (we 2026-10-28: "I DO NOT WANT an integration test
  // that runs the full mario game; instead just write a computer that
  // outputs a signal to a single buzzer, and see if it does its thing").
  // Fixture 9000008001: one MiniComputer, one Buzzer (authored mode 3 =
  // sawtooth), one PilotSeat whose Aux 1 the program mirrors into the
  // horn's amplitude. Pins end to end: the deep link (first-virtual,
  // aspect), the XenonTest panel (the AI-agent-facing automation door),
  // the cockpit law, and the AUDIO TRUTH via the analyser. Boots in
  // seconds; deterministic phase — no game, no sprite caching, no mash.
  test('buzzer bench: deep link, XenonTest panel, cockpit, audio chain @ui', async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto('/?craft=9000008001&dash=first-virtual');
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 180_000 });

    // deep link: the program's own virtualscreen(160,120) opens fullscreen
    const full = page.getByTestId('screens-cell-virtual#0#0-fullcanvas');
    await expect(full).toBeVisible({ timeout: 120_000 });
    {
      const fb = (await full.boundingBox())!;
      expect(Math.abs(fb.width / fb.height - 160 / 120)).toBeLessThan(0.15);   // aspect law
    }
    await expect
      .poll(() => litPixels(page, '[data-testid="screens-cell-virtual#0#0-fullcanvas"]'),
        { timeout: 30_000 })
      .toBeGreaterThan(100);                                                    // canvas paints
    await page.getByTestId('screens-cell-virtual#0#0-fullexit').click();
    await page.getByTestId('screens-close').click();

    // the Autotest panel, preset for the bench
    await page.getByTestId('xenon-menu').click();
    await page.locator('[data-testid^="xenon-comp-"]').first().click();
    await expect(page.getByTestId('xenon-on')).toHaveText('ON', { timeout: 90_000 });
    await page.getByTestId('xenon-side-autotest').click();
    await expect(page.getByTestId('xenon-test-src')).toContainText('buzzer-bench');
    await page.getByTestId('xenon-test-run').click();
    await expect(page.getByTestId('xenon-test-summary')).toContainText('5/5 PASS', { timeout: 30_000 });
    await expect(page.getByTestId('xenon-test-result-2')).toHaveAttribute('data-ok', '1');  // sawtooth law

    // the PROGRAMMATIC door — the interface for AI agents / headless
    // probes: evaluate a script straight off the window
    const res = await page.evaluate(() => (window as any).__XENONTEST__.run(
      'name: t\ncycles: 5\nassert:\n  - cycles >= 5\n  - wave("bench-horn") == "sawtooth"'));
    expect(res.length).toBe(2);
    expect(res.every((r: any) => r.ok)).toBe(true);

    // the COCKPIT law: F arms the seat (the dash/IDE armed the keys);
    // the program mirrors Aux 1 into the horn amplitude -> amp == 0.8
    await page.keyboard.down('f');
    const aux = async () => ((await page.evaluate(() => (window as any).__XENON__?.()))?.world ?? [])
      .find((r: any) => /aux_1/.test(r.name))?.manual ?? 0;
    await expect.poll(aux, { timeout: 10_000 }).toBe(1);
    const mirror = await page.evaluate(() => (window as any).__XENONTEST__.run(
      'name: cockpit\ncycles: 6\nassert:\n  - amp("bench-horn") == 0.8'));
    expect(mirror[0].ok).toBe(true);
    await page.keyboard.up('f');

    // AUDIO TRUTH: the AnalyserNode reads the samples flowing to the
    // speakers (sound is ON by default; the clicks above were the unlock
    // gestures) — "do they make sound?" answered by the graph
    await expect
      .poll(async () => (await page.evaluate(() => (window as any).__XENON__?.()))?.buzzer?.outputLevel ?? 0,
        { timeout: 30_000 })
      .toBeGreaterThan(0.03);
    const bz = await page.evaluate(() => (window as any).__XENON__?.()?.buzzer);
    expect(bz.voices).toBeGreaterThanOrEqual(1);
    expect(bz.level).toBeGreaterThanOrEqual(0.2);
  });

  // THE SPACE INVADERS arcade laws (craft 3288012440) — e2e tier: the live
  // pump + seat rows + the Screens gate on the booted app (the pure key
  // LAW is vitest-pinned in xenoncode.test.ts).
  test('the Space Invaders arcade: built-in screen gate, FULL COCKPIT keys, Space → the stick @ui', async ({ page }) => {
    // craft 3288012440 (Shadoh's arcade cabinet: Computer ci13 + PilotSeat
    // on data_port.010). e2e-tier because the laws are the live pump + seat
    // rows + the Screens gate on the booted app (the pure key LAW is vitest).
    await page.goto('/?craft=3288012440');
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 90_000 });

    // #2 the ▣ Screens gate counts a Computer's INTEGRATED screen (we:
    // "it doesnt register the built-in screen" — the button was absent)
    await expect(page.getByTestId('screens-btn')).toBeVisible();

    // boot the pump through the IDE (arms the pilot keys)
    await page.getByTestId('xenon-menu').click();
    await page.getByTestId('xenon-comp-13').click();
    await expect(page.getByTestId('xenon-on')).toHaveText('ON', { timeout: 90_000 });
    await page.getByTestId('xenon-side-screens').click();

    // #4 FULL COCKPIT: every seat channel has a row + a bound key, not just
    // the ch 1/2/3 the game reads (we: "keyboard binds available also for
    // the other keys cockpits can give")
    await expect
      .poll(async () => {
        const x = await page.evaluate(() => (window as any).__XENON__?.() ?? { pilotKeys: [], world: [] });
        const keys: string[] = x.pilotKeys;
        const need = ['w', 'a', 's', 'd', 'up', 'down', 'f', 'space', 'e', 'q',
          'i', 'k', 'j', 'l', 'r', 'digit1', 'digit5', 'digit9', 'digit0'];
        return need.filter((k) => keys.includes(k)).length;
      }, { timeout: 30_000 })
      .toBe(19);
    const rows: string[] = await page.evaluate(
      () => ((window as any).__XENON__?.() ?? { world: [] }).world.map((r: any) => r.name));
    for (const n of ['pilotseat.pitch', 'pilotseat.yaw', 'pilotseat.main_thrust',
      'pilotseat.aux_2', 'pilotseat.aux_0'])
      expect(rows).toContain(n);

    // #1/#3 SPACE feeds the seat's Up channel (the game's 'Press SPACE'
    // reads ch 3; Space was wired only to Aux 1, which the game ignores)
    await page.keyboard.down(' ');
    await expect
      .poll(async () => (await page.evaluate(() => (window as any).__XENON__?.() ?? { world: [] }))
        .world.find((r: any) => r.name === 'pilotseat.down_up')?.manual ?? 0,
        { timeout: 10_000 })
      .toBe(1);
    await page.keyboard.up(' ');
    await expect
      .poll(async () => (await page.evaluate(() => (window as any).__XENON__?.() ?? { world: [] }))
        .world.find((r: any) => r.name === 'pilotseat.down_up')?.manual ?? -1,
        { timeout: 10_000 })
      .toBe(0);

    // R = Main Thrust (a padded channel): the key reaches the row
    await page.keyboard.down('r');
    await expect
      .poll(async () => (await page.evaluate(() => (window as any).__XENON__?.() ?? { world: [] }))
        .world.find((r: any) => r.name === 'pilotseat.main_thrust')?.manual ?? 0,
        { timeout: 10_000 })
      .toBe(1);
    await page.keyboard.up('r');
  });
});
