// xenondbg.spec.ts — THE DEBUG CONSOLE end-to-end (v1.13.24, we: "create a
// text-based/lower level/JS interface where we can define breakpoints and
// then run stuff - a nice interface that makes using it for AI agents to
// analyze xenoncode easier").
//
// This spec IS the AI-agent demo: a headless client (exactly what an agent
// drives via page.evaluate) uses window.__XCDBG__ to set a breakpoint, run,
// read the typed frame, write a value back (validated), run to a line
// inside a TIMER block (the frame-label law of the same batch), step, and
// resume — never touching the DOM. The pure semantics are unit-pinned on a
// fake pump (src/engine/__tests__/xcdbg.test.ts).
// e2e-tier because: the API is a thin shell over the REAL pump — worker
// SAB breakpoints, mid-cycle pauses and Computer::WriteVarAt live only in
// the browser stack.
import { expect, test } from '@playwright/test';

const PLANE = '3294880085';

test.describe('Xenon debug console @slow', () => {
  test('headless client: break, run, frame, write, goto a block body, step @slow', async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto(`/?craft=${PLANE}`);
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 90_000 });
    // the console exists on the bare page (the Editor installs it)
    expect(await page.evaluate(() => (window as any).__XCDBG__?.version)).toBe(1);
    // boot a computer (the pump needs a program; opening the IDE is the
    // game's own way to point the pump at one)
    await page.getByTestId('xenon-menu').click();
    await page.locator('[data-testid^="xenon-comp-"]').first().click();
    await expect(page.getByTestId('xenon-on')).toHaveText('ON', { timeout: 60_000 });

    // files + line budget for line-mapping (what an agent reads first)
    const files = await page.evaluate(() => (window as any).__XCDBG__.files());
    expect(files.map((f: { name: string }) => f.name)).toContain('functions.xc');

    // feed the throttle-key channel so the >0 branch runs every cycle
    // (the console's io law — the same channel the Bus-tab slider drives)
    await page.evaluate(() => (window as any).__XCDBG__.io(11, 3, 1));
    const fed = await page.evaluate(() => (window as any).__XCDBG__.break('functions.xc', [10]));
    expect(fed).toEqual([{ file: 'functions.xc', line: 10 }]);

    const r = await page.evaluate(() => (window as any).__XCDBG__.run({ cycles: 500 }));
    expect(r).toMatchObject({ paused: true, file: 'functions.xc', line: 10, frame: '@selectcase' });

    // the typed frame (the locals the user asked to see, as data)
    const fr = await page.evaluate(() => (window as any).__XCDBG__.frame());
    const names = fr.locals.map((v: { name: string }) => v.name);
    expect(names).toEqual(expect.arrayContaining(
      ['inputsource', 'target', 'increment', 'lowerlimit', 'upperlimit', 'result']));
    expect(fr.locals.find((v: { name: string }) => v.name === 'increment'))
      .toMatchObject({ type: 'number' });

    // write back: valid lands, invalid is refused by the VM's law
    const okw = await page.evaluate(() => (window as any).__XCDBG__.write('$result', '42'));
    expect(okw).toEqual({ ok: true });
    const badw = await page.evaluate(() => (window as any).__XCDBG__.write('$result', 'abc'));
    expect(badw.ok).toBe(false);
    expect(badw.error).toContain('finite');
    expect((await page.evaluate(() => (window as any).__XCDBG__.locals()))
      .find((v: { name: string }) => v.name === 'result').value).toBe('42');

    // step over: the pause site moves, the VM stays parked mid-cycle
    const st = await page.evaluate(() => (window as any).__XCDBG__.step('over'));
    expect(st).toMatchObject({ paused: true, moved: true });
    expect(st.line).not.toBe(10);

    // RUN TO a line inside the timer-frequency block (the v1.13.24 frame
    // law: a break in a block body is a FRAME with the block as its label -
    // this is the update-block report's shape)
    await page.evaluate(() => (window as any).__XCDBG__.clear('functions.xc'));
    const g = await page.evaluate(() => (window as any).__XCDBG__.goto('functions.xc', 31, 500));
    expect(g).toMatchObject({ paused: true, file: 'functions.xc', line: 31 });
    const fr2 = await page.evaluate(() => (window as any).__XCDBG__.frame());
    expect(fr2.frame).toBe('timer frequency 4');
    expect(fr2.locals.map((v: { name: string }) => v.name)).toContain('change');

    // resume with the budget law: no breaks left -> cycles stream, honest
    // 'not paused' answer
    const rr = await page.evaluate(() => (window as any).__XCDBG__.run({ cycles: 30 }));
    expect(rr.paused).toBe(false);
    expect(rr.cycles).toBeGreaterThan(0);
    // the io bus streamed while we watched
    const bus = await page.evaluate(() => (window as any).__XCDBG__.bus());
    expect(Object.keys(bus).length).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
  });
});
