// dbgaudit.mjs — the v1.13.31 debugger workpackages AUDIT (workpackages.md):
// drives the REAL dev server through window.__XCDBG__ + the toolbar UI and
// pins every workpackage live, on a GIVEN origin. Run it TWICE:
//   APP_URL=http://127.0.0.1:5175   node tools/dbgaudit.mjs   (WORKER mode)
//   APP_URL=http://100.117.137.1:5175  node tools/dbgaudit.mjs (MAIN-THREAD —
//   the user's Tailscale origin: no secure context ⇒ the pair-stream pump)
// Playwright is used as a DRIVER only (the suite stays untouched).
import { chromium } from '@playwright/test';

const CRAFT = process.env.CRAFT ?? '3294880085';   // PLANE (functions.xc @selectcase)
const BASE = process.env.APP_URL ?? 'http://127.0.0.1:5175';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const browser = await chromium.launch({
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
  args: ['--use-gl=angle', '--use-angle=vulkan', '--no-sandbox', '--disable-dev-shm-usage'],
});
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  storageState: { cookies: [], origins: [{ origin: BASE,
    localStorage: [{ name: 'archean-app-debug', value: '1' },
      { name: 'archean-app-backdrop', value: 'none' }] }] },
});
const page = await ctx.newPage();
page.on('pageerror', e => console.log('PAGEERROR', String(e).slice(0, 160)));

await page.goto(`${BASE}/?craft=${CRAFT}`);
await page.waitForFunction(() => /SCENE PASS/.test(document.title), null, { timeout: 180_000 });
await page.getByTestId('xenon-menu').click();
await page.locator('[data-testid^="xenon-comp-"]').first().click();
await page.getByTestId('xenon-on').waitFor({ timeout: 90_000 });
await page.waitForFunction(() => document.querySelector('[data-testid="xenon-on"]')?.textContent === 'ON',
  null, { timeout: 90_000 });

const dbg = (fn, arg) => page.evaluate(fn, arg);
const X = () => dbg(() => window.__XENON__?.());
const worker = (await X())?.worker === true;
console.log(`=== ${BASE} — mode: ${worker ? 'WORKER (true line-stepping)' : 'MAIN-THREAD (pair-stream)'} ===`);

// ── WP6: the TRACKING GATE — IDE open, no breakpoints ⇒ untracked ────────
{
  const d = (await X()).debug;
  check('WP6 gate: IDE open + no breaks ⇒ tracked=false', d.tracked === false,
    `tracked=${d.tracked}`);
}

// ── feed the throttle channel so @selectcase runs its >0 branch ──────────
await dbg(() => window.__XCDBG__.io(11, 3, 1));
const src = await dbg(() => window.__XCDBG__.source('functions.xc'));
const hasCall = /@selectcase/.test(src ?? '');
check('fixture: functions.xc calls @selectcase (in-file)', hasCall,
  'the WP4 probe needs an in-file call site');
// find the in-file CALL line (the timer block's `@selectcase` caller)
let callLine = -1;
(src ?? '').split('\n').forEach((l, i) => {
  if (callLine < 0 && /@selectcase/.test(l) && !/function\s+@selectcase/.test(l)) callLine = i + 1;
});
console.log(`      in-file @selectcase call at functions.xc:${callLine}`);

// ── WP1: breakpoints fire (and SURVIVE a long chatty run) ────────────────
{
  await dbg(() => window.__XCDBG__.break('functions.xc', [10]));
  const r = await dbg(() => window.__XCDBG__.run({ cycles: 800 }));
  check('WP1: breakpoint fires', r.paused === true && r.line === 10,
    `paused=${r.paused} at ${r.file}:${r.line}`);
  const d = (await X()).debug;
  check('WP6 gate: break armed ⇒ tracked=true', d.tracked === true, `tracked=${d.tracked}`);
  await dbg(() => window.__XCDBG__.clear('functions.xc'));
  // the cap-death probe: thousands of cycles untracked, then re-arm + fire
  await dbg(() => window.__XCDBG__.resume({ cycles: 200 }));
  await page.waitForTimeout(8000);                       // chatty streaming
  await dbg(() => window.__XCDBG__.break('functions.xc', [10]));
  const r2 = await dbg(() => window.__XCDBG__.run({ cycles: 800 }));
  check('WP1: breakpoints STILL fire after thousands of streamed cycles',
    r2.paused === true && r2.line === 10, `paused=${r2.paused} at ${r2.file}:${r2.line}`);
}

// ── WP4: F10 from the CALL line steps OVER the in-file callee ────────────
{
  await dbg(() => window.__XCDBG__.clear('functions.xc'));
  await dbg(() => window.__XCDBG__.resume({ cycles: 50 }));
  await dbg((l) => window.__XCDBG__.break('functions.xc', [l]), callLine);
  const r = await dbg(() => window.__XCDBG__.run({ cycles: 800 }));
  check(`WP4 setup: parked at the CALL line functions.xc:${callLine}`,
    r.paused === true && r.line === callLine, `at ${r.file}:${r.line}`);
  const st = await dbg(() => window.__XCDBG__.step('over'));
  // THE CALLEE BODY RANGE of @selectcase (v2 landed inside it = "F10 steps
  // into"; v3 must land OUTSIDE it: worker mode = the caller's next line,
  // main-thread mode = the next cycle's same-file line, both outside).
  const srcLines = (src ?? '').split('\n');
  const fstart = srcLines.findIndex(l => /function\s+@selectcase/.test(l)) + 1;
  // the body ends at the next TOP-LEVEL line (col-0 construct: the next
  // function/block declaration — the body itself is tab-indented)
  let fend = srcLines.length + 1;
  for (let i = fstart; i < srcLines.length; i++)
    if (/^[A-Za-z;]/.test(srcLines[i])) { fend = i + 1; break; }
  const inCallee = st.file === 'functions.xc' && st.line > fstart && st.line < fend;
  const over = st.paused === true && st.file === 'functions.xc'
    && st.moved === true && !inCallee;
  check('WP4: F10 over an in-file @call lands OUTSIDE the callee body',
    over, `landed ${st.file}:${st.line} (callee body = functions.xc:${fstart + 1}..${fend - 1})`);
  await dbg(() => window.__XCDBG__.clear('functions.xc'));
  await dbg(() => window.__XCDBG__.resume({ cycles: 50 }));
}

// ── WP7: ⏹ STOP parks on the EXECUTING line, values become editable ──────
{
  await page.getByTestId('xenon-side-vars').click();
  const c0 = (await X()).cycles;
  await page.getByTestId('ide-stop').click();
  await page.waitForFunction(() => {
    const x = window.__XENON__?.();
    return x && x.paused === true && x.debug.line > 0;
  }, null, { timeout: 8000 });
  const x = await X();
  check('WP7: F6/⏹ parks at a LINE (no breakpoint armed)',
    x.paused === true && x.debug.line > 0 && x.debug.breaks.length === 0,
    `parked at ${x.debug.file}:${x.debug.line}`);
  await page.waitForTimeout(1200);
  const x2 = await X();
  check('WP7: parked pump is frozen (cycles stop)', x2.cycles === x.cycles,
    `${x.cycles} → ${x2.cycles}`);
  // the yellow wash rides the park (WP3 positive side)
  const wash = await page.locator('.xc-line-paused').count();
  check('WP3: the paused-line wash shows at the park', wash >= 1, `wash rows=${wash}`);
  // the editable affordance exists at the park (the write itself is the
  // WP5 frame probe below — deterministic inside a paused function frame)
  const row = page.locator('[data-testid^="xenon-val-"]').first();
  const hasRow = await row.count();
  check('WP5: value rows carry the edit affordance at the park', hasRow >= 1,
    `editable value rows=${hasRow}`);
  // WP7+WP3: RESUME clears the wash + the pill
  await page.getByTestId('ide-run').click();
  await page.waitForFunction(() => window.__XENON__?.().paused === false, null, { timeout: 8000 });
  await page.waitForTimeout(600);
  const wash2 = await page.locator('.xc-line-paused').count();
  const pill = await page.getByTestId('xenon-paused').count();
  check('WP3: resume clears the yellow highlight (wash + pill gone)',
    wash2 === 0 && pill === 0, `wash=${wash2} pill=${pill}`);
  const x3 = await X();
  check('WP7: resume from ⏹ restarts the cycle counter', x3.cycles > x2.cycles,
    `${x2.cycles} → ${x3.cycles}`);
}

// ── WP5: the WRITE itself, in a parked function frame (deterministic:
// the paused frame is frozen; a GLOBAL row would be overwritten by the
// program's own loop on resume) ───────────────────────────────────────────
{
  await page.getByTestId('xenon-side-vars').click();
  await dbg(() => window.__XCDBG__.break('functions.xc', [10]));
  const r = await dbg(() => window.__XCDBG__.run({ cycles: 800 }));
  check('WP5 setup: parked inside the @selectcase frame',
    r.paused === true && r.line === 10, `${r.file}:${r.line}`);
  const cell = page.getByTestId('xenon-val-result');
  const ok = await cell.isVisible().catch(() => false);
  check('WP5: $result (paused frame) shows the edit affordance', ok);
  if (ok) {
    await cell.click();
    const inp = page.getByTestId('xenon-edit-result');
    await inp.waitFor({ timeout: 5000 });
    await inp.fill('42');
    await inp.press('Enter');
    let rowTxt = '';
    for (let i = 0; i < 25 && !/42/.test(rowTxt); i++) {
      await page.waitForTimeout(200);
      rowTxt = await page.getByTestId('xenon-loc-result').innerText().catch(() => '');
    }
    check('WP5: writing a frame-local value at the park LANDS (row shows 42)',
      /42/.test(rowTxt), JSON.stringify(rowTxt.slice(0, 60)));
  }
  await dbg(() => window.__XCDBG__.clear('functions.xc'));
  await dbg(() => window.__XCDBG__.resume({ cycles: 50 }));
}

// ── WP2: the caret follows the hit and lands CENTERED in the view ────────
{
  await dbg(() => window.__XCDBG__.break('functions.xc', [10]));
  await dbg(() => window.__XCDBG__.run({ cycles: 800 }));
  await page.waitForTimeout(900);                     // follow-jump + CM scroll
  const geo = await page.evaluate(() => {
    const sc = document.querySelector('.cm-scroller');
    const lines = document.querySelectorAll('.cm-content .cm-line');
    if (!sc || !lines.length) return null;
    const sr = sc.getBoundingClientRect();
    let target = null;
    for (const el of lines) {                       // the paused row (wash)
      if (el.classList.contains('xc-line-paused') || el.querySelector('.xc-paused-mark')) target = el;
    }
    if (!target) {
      // gutter marker rides the gutter cell — match its line number
      const cell = document.querySelector('.xc-paused-mark');
      const ln = cell ? Number(cell.closest('.cm-gutterElement')?.getAttribute('aria-label')?.replace(/\D/g, '') || 0) : 0;
      target = lines[ln - 1] ?? null;
    }
    if (!target) return null;
    const tr = target.getBoundingClientRect();
    const center = sr.top + sr.height / 2;
    const mid = tr.top + tr.height / 2;
    return { off: Math.abs(mid - center), h: sr.height };
  });
  check('WP2: the followed line is CENTERED in the editor view',
    !!geo && geo.off < geo.h * 0.35, geo ? `offset ${Math.round(geo.off)}px of ${Math.round(geo.h)}px` : 'no view');
  await dbg(() => window.__XCDBG__.clear('functions.xc'));
  await dbg(() => window.__XCDBG__.resume({ cycles: 50 }));
}

// ── WP7b: ⏸ PAUSE parks with no breakpoints, worker mid-cycle exact ─────
{
  const c0 = (await X()).cycles;
  await page.getByTestId('ide-pause').click();
  await page.waitForFunction(() => {
    const x = window.__XENON__?.();
    return x && x.paused === true && x.debug.line > 0;
  }, null, { timeout: 8000 });
  const x = await X();
  check('WP7: ⏸ parks on the executing line (no break armed)',
    x.paused && x.debug.line > 0 && x.debug.breaks.length === 0,
    `parked at ${x.debug.file}:${x.debug.line}`);
  if (worker) {
    // the mid-cycle proof: the parked cycle NEVER completes
    await page.waitForTimeout(1000);
    const x2 = await X();
    check('WP7 (worker): the park is MID-CYCLE (cycle counter frozen)',
      x2.cycles === x.cycles, `${x.cycles} → ${x2.cycles}`);
  }
  // WP5 park-to-edit: while RUNNING, a value cell click ARMS the park
  await page.getByTestId('ide-run').click();
  await page.waitForFunction(() => window.__XENON__?.().paused === false, null, { timeout: 8000 });
  const press = page.locator('[data-testid^="xenon-valpress-"]').first();
  const nPress = await press.count();
  if (worker) {
    check('WP5: running worker shows the park-to-edit affordance on value rows',
      nPress >= 1, `press rows=${nPress}`);
    if (nPress) {
      await press.click();
      await page.waitForFunction(() => {
        const x = window.__XENON__?.();
        return x && x.paused === true;
      }, null, { timeout: 8000 });
      const inp = page.locator('[data-testid^="xenon-edit-"]').first();
      // the editor opens on the render that follows the park notify —
      // poll, never isVisible-once (React render is a frame away)
      const ok = await inp.waitFor({ state: 'visible', timeout: 5000 })
        .then(() => true).catch(() => false);
      check('WP5: click on a running value PARKS the VM and opens the editor', ok);
      if (ok) await page.keyboard.press('Escape');
    }
  } else {
    check('WP5: main-thread mode keeps the live-edit affordance (running)',
      await page.locator('[data-testid^="xenon-val-"]').count() >= 1);
  }
  await page.keyboard.press('Escape');
}

const fails = results.filter(r => !r.ok);
console.log(`\n=== ${BASE} — ${results.length - fails.length}/${results.length} PASS ===`);
await browser.close();
process.exit(fails.length ? 1 : 0);
