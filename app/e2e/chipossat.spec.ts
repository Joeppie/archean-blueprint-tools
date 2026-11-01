// chipossat.spec.ts — THE SATELLITE SETUP (v1.17.0, we: "create and add and
// test ChipOS setup that has satellite connections into its main comp for
// aerthnav and Tetris apps, and make it work").
//
// Fixture 9000009098 CHIP SAT BENCH (tools/make_satchip_test.py): the REAL
// App TETRIS and EarthNAV disks run on their OWN computers, each reaching
// the main-router through its own DataBridge satellite link — the game's
// per-part link shape (data passes, power does not). ChipOS (alias
// 'chipos') must SEE them as devices, INSTALL their appkit manifests and
// REMEMBER them.
//
// The reload leg is the STORAGE PERSISTENCE LAW (v1.16.27) proven through
// a third-party OS: after a page reload ChipOS restores xa_alias from the
// app's persistent disk — the apps re-handshake (their .kit{3} manifests
// ride the bus again) but the OS does NOT reinstall: "New app installed"
// is a first-sight event, and a second one would mean amnesia.
//
// e2e-tier because: three real VMs over a shared bus + a real page
// lifecycle (IndexedDB reload). @slow: two cold boots of three big disks.
import { expect, test } from '@playwright/test';

const CRAFT = '9000009098';

const osState = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const f = (window as any).__ARCHEAN__.xenon.farm;
    const os = f.pumps.find((p: any) => p.comp?.alias === 'chipos');
    const prints = (os?.prints ?? []).map((p: any) => String(p.v ?? ''));
    const bus = f.bus.snapshot();
    const kit = Object.keys(bus).filter(k =>
      typeof bus[k] === 'string' && (bus[k] as string).startsWith('.kit{'));
    return {
      pumps: f.pumps.length,
      installed: prints.filter((s: string) => /New app installed/.test(s)),
      booting: prints.some((s: string) => /booting/.test(s)),
      kit,
    };
  });

/** the stale-open gate is law (unversioned cached copy on the layout
 *  route) — answer like a player: open the cached copy (v1.9.5). The gate
 *  appears AFTER the blueprint fetch resolves, so a one-shot click races
 *  it: poll-click until the buttons stop answering. */
const passGate = async (page: import('@playwright/test').Page) => {
  for (let i = 0; i < 50; i++) {
    const btn = page.getByTestId('stale-usecached');
    if (await btn.count() === 0) { if (i > 0) return; }
    await btn.first().click({ timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(500);
  }
};

test.describe('@chipossat @slow THE CHIP SAT BENCH', () => {
  test('satellites install through their DataBridges — and survive a reload', async ({ page, isMobile }) => {
    test.skip(isMobile, 'three-VM bench farm (chipos family)');
    test.setTimeout(480_000);
    await page.addInitScript(() => localStorage.setItem('archean-app-live', 'on'));

    // ── boot #1: the OS sees 10 devices THROUGH the bridges and installs
    //    both satellites (first sight).
    await page.goto(`/?craft=${CRAFT}`);
    // the gate can hold the whole open — clear it, then the pumps arrive
    await passGate(page);
    await page.waitForFunction(
      () => (window as any).__ARCHEAN__?.xenon?.farm?.pumps?.length >= 3, null,
      { timeout: 240_000 });
    await passGate(page);
    await expect.poll(() => osState(page), { timeout: 180_000, message: 'both satellites install' })
      .toMatchObject({
        installed: expect.arrayContaining([
          expect.stringMatching(/New app installed: TETRIS/),
          expect.stringMatching(/New app installed: EARTHNAV/),
        ]) as string[],
      });
    // the appkit manifests ride the bus under the SATELLITE aliases
    await expect.poll(() => osState(page), { timeout: 60_000 })
      .toMatchObject({ kit: expect.arrayContaining(['app-tetris:0', 'app-earthnav:0']) });

    // ── reload: storage persistence. The OS REMEMBERS: the manifests
    //    arrive again (the apps re-handshake), but NO reinstall prints —
    //    xa_alias came back off the persistent disk.
    await page.reload({ waitUntil: 'load' });
    await passGate(page);
    await page.waitForFunction(
      () => (window as any).__ARCHEAN__?.xenon?.farm?.pumps?.length >= 3, null,
      { timeout: 240_000 });
    await passGate(page);
    await expect.poll(() => osState(page), { timeout: 180_000, message: 'OS boots again' })
      .toMatchObject({ booting: true, kit: expect.arrayContaining(['app-tetris:0', 'app-earthnav:0']) });
    // amnesia would reinstall — the law says it must NOT:
    const st = await osState(page);
    expect(st.installed, 'a reload must NOT reinstall known apps')
      .toEqual([]);
  });
});
