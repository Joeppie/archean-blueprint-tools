// storage.spec.ts — THE STORAGE PERSISTENCE LAW (v1.16.27, we: "I tried
// the chipOS devkt, but all screens say to use the primary one and I cannot
// get it to work. I suspect something is wrong there.").
//
// The devkit diagnosis, made testable: `storage var` is PERSISTENT storage
// in the game (kept beside the save), but our VMs run on the wasm in-memory
// filesystem, which dies with the page — ChipOS re-ran its first-run setup
// on every load. The law: the pump restores the map into the fresh VM
// BEFORE boot (shim ABI 19 xc_seed_storage) and persists the live cache
// back (xc_storage_dump) on a ~2 s throttle.
//
// Fixture 9000009096 STORAGE BENCH: one MiniComputer counting boots in a
// storage var onto the bus row "bootcount". Without persistence the row
// reads 1 forever, page after page; with it, every reload's boot SEES the
// last count and writes one more.
//
// e2e-tier because: IndexedDB + real page lifecycles are exactly the tier
// rule (the persist/restore plumbing itself is plain pump code; the
// xenonstore map has its own vitest round-trip).
import { test, expect } from '@playwright/test';

const CRAFT = '9000009096';

/** The stale-open gate is law (v1.9.5: an unverified download is NEVER
 * silently trusted) — the dev/Pages layout route serves blueprint bytes
 * without X-Blueprint headers, so a REOPEN always asks. The spec answers
 * like the player would: open the cached copy (it is the same served file;
 * the storage under test is the VM's, not this cache). */
const passGate = async (page: import('@playwright/test').Page) => {
  await page.getByTestId('stale-usecached').click({ timeout: 8000 }).catch(() => {});
};

const busRow = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const A = (window as any).__ARCHEAN__;
    const v = A?.xenon?.farm?.bus?.get('bootcount', 0);
    return typeof v === 'number' ? v : Number(v) || 0;
  });

test.describe('@storage @xenon THE STORAGE PERSISTENCE LAW', () => {
  test('a storage var survives page loads: bootcount INCREASES across reloads', async ({ page }) => {
    test.setTimeout(240_000);
    await page.addInitScript(() => localStorage.setItem('archean-app-live', 'on'));

    // boot #1: a genuinely fresh disk answers 1
    await page.goto(`/?craft=${CRAFT}`);
    await page.waitForFunction(() => !!(window as any).__ARCHEAN__?.xenon?.farm, null,
      { timeout: 90_000 });
    await passGate(page);
    await expect.poll(() => busRow(page), { timeout: 60_000 }).toBeGreaterThanOrEqual(1);

    // let the ~2 s persistence throttle write the disk at least twice,
    // headless worst case (a slow pump counts cycles, not seconds)
    await page.waitForTimeout(6000);

    // boot #2: the restored disk says 1 → the program answers 2
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => !!(window as any).__ARCHEAN__?.xenon?.farm, null,
      { timeout: 90_000 });
    await passGate(page);
    await expect.poll(() => busRow(page), { timeout: 60_000 }).toBeGreaterThanOrEqual(2);
    await page.waitForTimeout(6000);

    // boot #3: 3 — persistence iterates, it is not a one-off
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => !!(window as any).__ARCHEAN__?.xenon?.farm, null,
      { timeout: 90_000 });
    await passGate(page);
    await expect.poll(() => busRow(page), { timeout: 60_000 }).toBeGreaterThanOrEqual(3);
  });

  test('THE STORAGE WIPE: the Vars-tab 🗑 gives a fresh disk, and the wipe persists', async ({ page, isMobile }) => {
    // desktop-only (the analysis-family law): the wipe rides the IDE's
    // side panel, which on phones is a rail + overlay DRAWER.
    test.skip(isMobile, 'IDE side-panel density (desktop dialog family)');
    test.setTimeout(240_000);
    await page.addInitScript(() => localStorage.setItem('archean-app-live', 'on'));
    await page.goto(`/?craft=${CRAFT}`);
    await page.waitForFunction(() => !!(window as any).__ARCHEAN__?.xenon?.farm, null,
      { timeout: 90_000 });
    await passGate(page);
    // a booted disk carries a count > 1 after a beat (the pump writes
    // every boot); the wipe must clear it to a FRESH disk's 1.
    await expect.poll(() => busRow(page), { timeout: 60_000 }).toBeGreaterThanOrEqual(1);
    await page.getByTestId('xenon-menu').click();
    await page.locator('[data-testid^="xenon-comp-"]').first().click();
    await expect(page.getByTestId('xenon-dialog')).toBeVisible();
    await page.getByTestId('ide-clear-storage').click();          // arm (title toolbar)
    await page.getByTestId('ide-clear-storage').click();          // confirm
    await expect.poll(() => busRow(page), { timeout: 90_000 }).toBe(1);
    await page.locator('[data-testid="xenon-close"]').first().click();
    // …and the WIPE is itself persistent: a reload starts over from 1,
    // the old count cannot resurrect.
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => !!(window as any).__ARCHEAN__?.xenon?.farm, null,
      { timeout: 90_000 });
    await passGate(page);
    await expect.poll(() => busRow(page), { timeout: 90_000 }).toBe(1);
  });

  test('THE CRAFT-WIDE WIPE: the Xenon ▾ row clears every disk on the craft', async ({ page, isMobile }) => {
    test.skip(isMobile, 'desktop menu density (wipe family)');
    test.setTimeout(240_000);
    page.on('dialog', d => void d.accept());           // the confirm()
    await page.addInitScript(() => localStorage.setItem('archean-app-live', 'on'));
    await page.goto(`/?craft=${CRAFT}`);
    await page.waitForFunction(() => !!(window as any).__ARCHEAN__?.xenon?.farm, null,
      { timeout: 90_000 });
    await passGate(page);
    await expect.poll(() => busRow(page), { timeout: 60_000 }).toBeGreaterThanOrEqual(1);
    // let it accumulate two boots' worth of count
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => !!(window as any).__ARCHEAN__?.xenon?.farm, null,
      { timeout: 90_000 });
    await passGate(page);
    await expect.poll(() => busRow(page), { timeout: 60_000 }).toBeGreaterThanOrEqual(2);
    // the FILE-menu row wipes the whole craft (v1.17.2, we: "The clear
    // buttons are far outside of visibility and should be under MENU")
    await page.getByTestId('file-menu').click();
    await page.getByTestId('file-clear-storage').click();
    await expect.poll(() => busRow(page), { timeout: 90_000 }).toBe(1);
    // the wipe persists: a reload starts over from 1
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => !!(window as any).__ARCHEAN__?.xenon?.farm, null,
      { timeout: 90_000 });
    await passGate(page);
    await expect.poll(() => busRow(page), { timeout: 90_000 }).toBe(1);
  });
});
