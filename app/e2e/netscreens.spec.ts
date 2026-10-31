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
      expect(feeds).toContainEqual({ key: `main-screen#${ch}`, w: 300, h: 300 });
    expect(feeds).toContainEqual({ key: 'secondary-screen#0', w: 300, h: 300 });

    // ── ③ LIGHT-UP: ChipOS draws through its runtime addressing; the pump
    //    pushes land on the shared face — the ink census proves the board
    //    shows CONTENT (the user's complaint was a pitch-black screen).
    const ink = (key: string) => page.evaluate((k) =>
      (window as any).__ARCHEAN__.engine.screenFeedInk(k), key);
    await expect.poll(() => ink('main-screen#0'), { timeout: 60_000 })
      .toBeGreaterThan(0.2);
    // pushes ride the 25 Hz cycle hook (not the 10 Hz notify)
    expect(await page.evaluate(() =>
      (window as any).__ARCHEAN__.engine.pushCounts.get('main-screen#0') ?? 0)).toBeGreaterThan(20);
  });
});
