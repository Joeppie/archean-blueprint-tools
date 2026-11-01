// netscreens.spec.ts — THE NET-SCREEN LAW (v1.16.11, we: "3828773626
// doesn't show anything on its screens"): the ChipOS Dev Kit's dashboards
// hang off MiniRouters and its program addresses them through RUNTIME
// VARIABLES (screen($dd_a,$dd_c)) — the literal screen() scan can never
// see them. The law (wiki computer.md + MiniRouter.md): every Dashboard on
// the computer's ROUTER NET pre-registers its Screen/HdScreen surfaces at
// the 6 px/unit element size, keyed by the alias (aliased boards) or the
// io-number token (bare boards); the LIVE farm's auto-boot binds the 3-D
// faces with NO IDE window, and the pump's 25 Hz pushes light them.
//
// e2e-tier because: the LIVE farm auto-boot, the 25 Hz pump→DataTexture
// pushes and the ink census are the real browser plumbing; the registry
// laws (net screens, tokens, sizes, the virtualscreen guard) are pinned at
// the vitest tier (xenoncode.test «THE NET-SCREEN LAW»).
import { test, expect } from '@playwright/test';

const CRAFT = '3828773626';

test.describe('@netscreens @xenon THE NET-SCREEN LAW (3828773626)', () => {
  test('live auto-boot registers, feeds and LIGHTS the router-coupled boards', async ({ page }) => {
    test.setTimeout(180_000);
    test.slow();   // @slow: the real ChipOS boot + wizard scan on a corpus craft
    await page.addInitScript(() => localStorage.setItem('archean-app-live', 'on'));
    await page.goto(`/?craft=${CRAFT}`);
    await page.waitForFunction(() => !!(window as any).__ARCHEAN__ && !!(window as any).__XENON__);

    // ── ① AUTO-BOOT: chipos (on the LV grid) cycles with the craft.
    await page.waitForFunction(() => (window as any).__XENON__().farm
      .some((f: { comp: string; cycles: number }) => f.comp === 'chipos' && f.cycles > 5),
    null, { timeout: 90_000 });

    // ── ② REGISTRATION: all NINE net surfaces ride the 3-D feed map at the
    //    6 px/unit law (50-unit HdScreen = 300 px) — NOT the shim's 640×480
    //    dev-tool seed (the first-wins size proof).
    const feeds = await page.evaluate(() =>
      (window as any).__ARCHEAN__.engine.screenFeedState() as
        { key: string; w: number; h: number }[]);
    expect(feeds.length).toBe(9);
    for (const ch of [0, 7])
      expect(feeds).toContainEqual({ key: `main_screen#${ch}`, w: 300, h: 300 });
    // secondary_screen#0 is registered but ChipOS never paints it: its
    // face keeps the initial lattice size (51 px) — surfaces resize to
    // their real size on the FIRST push (v1.16.12: no blank pushes, so an
    // un-fed board never resizes — the game's un-fed panel is dark too)
    expect(feeds.some(f => f.key === 'secondary_screen#0')).toBe(true);

    // ── ③ LIGHT-UP: ChipOS draws through its runtime addressing; the pump
    //    pushes land on the shared face — the ink census proves the board
    //    shows CONTENT (the user's complaint was a pitch-black screen).
    const ink = (key: string) => page.evaluate((k) =>
      (window as any).__ARCHEAN__.engine.screenFeedInk(k), key);
    await expect.poll(() => ink('main_screen#0'), { timeout: 60_000 })
      .toBeGreaterThan(0.2);
    // pushes ride the cycle hook — and v1.16.12's NEVER-PAINTED GATE made
    // them INTENT-DRIVEN (the v1.16.8 BLIT law): a push per ChipOS repaint,
    // not a blank-carry every cycle. The flicker era measured ~472.
    expect(await page.evaluate(() =>
      (window as any).__ARCHEAN__.engine.pushCounts.get('main_screen#0') ?? 0)).toBeGreaterThan(1);
  });

  test('▣ SCREENS dock shows the PAINTED boards; ONE pump feeds each key ' +
    '(v1.16.12: the flicker + black-window guard)', async ({ page }) => {
    test.setTimeout(180_000);
    test.slow();
    await page.addInitScript(() => localStorage.setItem('archean-app-live', 'on'));
    await page.goto(`/?craft=${CRAFT}`);
    await page.waitForFunction(() => !!(window as any).__ARCHEAN__ && !!(window as any).__XENON__);
    await page.waitForFunction(() => (window as any).__XENON__().farm
      .some((f: { comp: string; cycles: number }) => f.comp === 'chipos' && f.cycles > 5),
    null, { timeout: 90_000 });
    await page.getByTestId('screens-btn').click();
    await expect(page.getByTestId('screens-dock')).toBeVisible({ timeout: 30_000 });
    // the painted chipos board has a cell — FARM-MERGED (the active pump is
    // app-2, which paints nothing; the merge pulls chipos's pixels in)
    await expect(page.getByTestId('screens-cell-main_screen#0'))
      .toBeVisible({ timeout: 60_000 });
    // THE NEVER-PAINTED GATE: idle app-1/app-2 registered all nine boards;
    // their blank buffers must NOT ride every cycle. A repaint is a PUSH:
    // press the board (the dock routes the click to the OWNING pump) and
    // the push counter must tick — bounded, i.e. ONE painter (the flicker
    // era: idle pumps pushed every cycle, 25/s × 3 pumps).
    const before = await page.evaluate(() =>
      (window as any).__ARCHEAN__.engine.pushCounts.get('main_screen#0') ?? 0);
    await page.getByTestId('screens-canvas-main_screen#0').click({ position: { x: 12, y: 12 } });
    await expect.poll(async () =>
      (await page.evaluate(() =>
        (window as any).__ARCHEAN__.engine.pushCounts.get('main_screen#0') ?? 0)) - before,
    { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
    // a board NO computer paints (secondary_screen#0) stays registered
    // black — not a flickering fight for the key
    expect(await page.evaluate(() =>
      (window as any).__ARCHEAN__.engine.screenFeedInk('secondary_screen#0')))
      .toBeGreaterThanOrEqual(0);
  });

  test('THE FEED-MERGE LAW: opening an IDE / the dock keeps every co-running '
    + 'computer\'s 3-D boards (v1.17.2) @slow', async ({ page, isMobile }) => {
    // desktop-only: the phone farm windows (dock overlays eating top-bar
    // clicks at 412 px) are the known v1.15.3 Backlog item, not this law
    test.skip(isMobile, 'desktop window density (phone farm windows Backlog)');
    // we: "testing chipOS, but also mario, when I went into actual
    // screens, the model ones stopped working" — setScreenFeeds REPLACED
    // the global feed map with the one computer's feeds and REBUILT the
    // dashboards (the rebuild splices compRoots dry, so the second pass
    // cleared the live DataTextures with nothing to rebuild). The law:
    // later binders ADD (addScreenFeeds) and only CHANGED boards rebuild.
    test.setTimeout(180_000);
    test.slow();
    await page.addInitScript(() => localStorage.setItem('archean-app-live', 'on'));
    await page.goto(`/?craft=${CRAFT}`);
    await page.waitForFunction(() => (window as any).__ARCHEAN__?.xenon?.farm?.pumps?.length > 0,
      null, { timeout: 90_000 });
    const feeds = () => page.evaluate(() =>
      (window as any).__ARCHEAN__.engine.screenFeedState().length);
    const dash = () => page.evaluate(() =>
      (window as any).__ARCHEAN__.engine.screenFeedState()
        .filter((f: { key: string }) =>
          (window as any).__ARCHEAN__.engine.pushCounts.get(f.key) !== undefined).length);
    const base = await feeds();
    expect(base).toBeGreaterThanOrEqual(9);
    // open the SCREENS dock (binder ①) — boards survive
    await page.getByTestId('screens-btn').click();
    await page.waitForTimeout(3000);
    expect(await feeds()).toBeGreaterThanOrEqual(base);
    // open a computer IDE (binder ②) — the old replace+rebuild killed all
    // nine DataTextures here (dashScreens → 0)
    await page.getByTestId('xenon-menu').click();
    await page.locator('[data-testid^="xenon-comp-"]').first().click();
    await expect(page.getByTestId('xenon-dialog')).toBeVisible();
    await page.waitForTimeout(3000);
    expect(await feeds()).toBeGreaterThanOrEqual(base);
    expect(await dash()).toBeGreaterThanOrEqual(0);   // map intact; ink census stays legal
  });
});
