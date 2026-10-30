// living.spec.ts — THE LIVING CRAFT (v1.15.6, we: "computers should start
// when a craft is loaded in, and parts need to respond to signals … hinges
// and pivots actually move, and if a pivot or hinge moves so does its
// subgrid … button presses onto dashboards and screens should actually work
// on the 3d model and propagate … a hand with finger cursor … tell us what
// channel / which xenoncode line … as a popup label … if a computer is
// unpowered, show a warning when we interact with it").
//
// e2e-tier because: a REAL pointer press on a 3-D dashboard face (raycast →
// cursor → popup chip → channel write → program read) and the auto-booted
// farm cadence need the browser; the laws' math lives at the vitest tier
// (power/devicesim/xcsites/scene.headless).
//
// The e2e fixture ships archean-app-live=off (playwright.config storage-
// State — every other spec keeps the manual-boot world); THIS spec re-arms
// the live farm for its own context (the BACKDROP-SKIP fixture law).
import { test, expect } from '@playwright/test';

const CRAFT = '9000009040';

test.describe('@living @xenon THE LIVING CRAFT', () => {
  test('auto-boot swings the hinge AND its panel; dash press + popup; unpowered warn', async ({ page }) => {
    test.setTimeout(180_000);
    await page.addInitScript(() => localStorage.setItem('archean-app-live', 'on'));
    await page.goto(`/?craft=${CRAFT}`);
    await page.waitForFunction(() => !!(window as any).__ARCHEAN__ && !!(window as any).__XENON__);

    // ── ① AUTO-BOOT: 'cpu' (on the power net) boots WITH the craft and
    //    cycles; 'ghost' (a program, no power cable) never appears.
    await page.waitForFunction(() => (window as any).__XENON__().farm
      .some((f: { comp: string; cycles: number }) => f.comp === 'cpu' && f.cycles > 5), null, {
      timeout: 60_000,
    });
    const farm = await page.evaluate(() => (window as any).__XENON__().farm);
    // the unpowered computer never auto-boots (engine/power.ts gate)
    expect(farm.some((f: { comp: string }) => f.comp === 'ghost')).toBe(false);
    await expect(page.getByTestId('live-chip')).toContainText('1');

    // ── ② ACTUATION: output_number("hinge",0,±1) swings the axle node and
    //    THE PANEL RIDES ITS MASTER (the subgrid group rides ~90° with it).
    const poseAngle = (seam: string, arg: number | string) => page.evaluate(
      ([seam, arg]) => {
        const A = (window as any).__ARCHEAN__;
        const q = seam === 'joint' ? A.jointPoseQ(arg as number, 'axle') : A.subGroupQ(arg as number);
        return q ? (2 * Math.acos(Math.min(1, Math.abs(q[0]))) * 180) / Math.PI : 0;
      }, [seam, arg] as const);
    await expect.poll(() => poseAngle('joint', 4), { timeout: 45_000 }).toBeGreaterThan(80);
    await expect.poll(() => poseAngle('sub', 8)).toBeGreaterThan(80);

    // ── ③ THE 3-D PRESS: aim at the dashboard, HOVER the ToggleButton
    //    element → finger cursor + the popup chip naming element + computer
    //    + program line; PRESS → the channel reaches the program (reads).
    await page.evaluate(() => {
      const A = (window as any).__ARCHEAN__;
      const m = A.engine.moffView;
      A.engine.auditLookAt([1.0 + m.x, 1.1 + m.y, -1.0 + m.z + 1.8],
        [1.0 + m.x, 1.1 + m.y, -1.0 + m.z]);
    });
    // CAMERA SETTLE: the glide is done when two consecutive camPos() agree
    // (the LESSONS law) — the projections below must be taken from the
    // settled camera.
    await expect.poll(async () => page.evaluate(async () => {
      const A = (window as any).__ARCHEAN__.engine.camPos();
      await new Promise(r => setTimeout(r, 250));
      const B = (window as any).__ARCHEAN__.engine.camPos();
      return JSON.stringify(A) === JSON.stringify(B);
    })).toBe(true);
    const pt = await page.evaluate(() =>
      (window as any).__ARCHEAN__.screen(0.25, 0.85, -0.985));   // ToggleButton centre (file m)
    expect(pt, 'the dashboard projects into the viewport').not.toBeNull();
    const [px, py] = pt as [number, number];
    await page.mouse.move(px, py);
    await expect.poll(() => page.evaluate(() =>
      (document.querySelector('[data-testid="canvas"]') as HTMLCanvasElement).style.cursor,
    )).toBe('pointer');
    await expect(page.getByTestId('press-chip')).toBeVisible();
    await expect(page.getByTestId('press-chip')).toContainText('ToggleButton');
    await expect(page.getByTestId('press-chip')).toContainText('cpu');
    // the press: down+up latch the toggle → the program's input_number(3,0)
    // reads 1 (the pump's READS prove the channel crossed into the VM)
    await page.mouse.down();
    await page.mouse.up();
    await expect.poll(async () => page.evaluate(() => {
      const r = ((window as any).__XENON__().reads as () => Record<string, number>)();
      return r['3:0'] ?? 0;
    }), { timeout: 15_000 }).toBe(1);

    // ── ④ THE SCREEN PRESS names the XenonCode line: the 3-D feed must be
    //    LIVE first (open the ▣ Screens dock → setScreenFeeds registers the
    //    face), then hover the literal button_rect(20, 20, 80, 24) centre.
    await page.getByTestId('screens-btn').click();
    // the 3-D face's DataTexture RESIZES to the program's surface on the
    // first pump push — the px mapping (and the rect hit-test) is only
    // meaningful at the full size, so poll for it before projecting.
    await expect.poll(async () => page.evaluate(() =>
      (window as any).__ARCHEAN__.engine.screenFeedState()
        .reduce((n: number, s: { w: number }) => Math.max(n, s.w), 0)), { timeout: 20_000 })
      .toBeGreaterThanOrEqual(600);
    const sp = await page.evaluate(() =>
      (window as any).__ARCHEAN__.screen(1.0, 1.4467, -0.9845));   // rect centre (file m)
    expect(sp).not.toBeNull();
    const [spx, spy] = sp as [number, number];
    // the chip rides the throttled hover pass — nudge the pointer inside
    // the poll so every sample re-raycasts the settled face
    await expect.poll(async () => {
      await page.mouse.move(spx, spy);
      await page.mouse.move(spx + 1, spy);
      await page.waitForTimeout(120);
      return await page.evaluate(() =>
        document.querySelector('[data-testid="press-chip"]')?.textContent ?? '');
    }, { timeout: 15_000 }).toContain('button_rect(20, 20, 80, 24)');
    expect(await page.evaluate(() =>
      document.querySelector('[data-testid="press-chip"]')?.textContent ?? ''))
      .toContain('main.xc');
    // click it → the pump routes a screenClick (the program's click entry
    // fires: print("arm"))
    await page.mouse.down();
    await page.mouse.up();
    await expect.poll(async () => page.evaluate(() =>
      ((window as any).__XCDBG__?.prints() ?? [])
        .filter((s: string) => s.includes('arm')).length), { timeout: 15_000 })
      .toBeGreaterThan(0);

    // ── ⑤ THE POWER WARNING: open 'ghost' (unpowered) from the Xenon ▾
    //    menu → the IDE header carries the ⚠ chip.
    await page.getByTestId('xenon-menu').click();
    await page.getByTestId('xenon-comp-3').click();   // 'ghost'
    await expect(page.getByTestId('xenon-unpowered')).toBeVisible();
  });
});
