// xenonfresh.spec.ts — THE FRESH-COMPUTER LAW (v1.13.20, we: "When I place
// a new minicomputer, I dont get a xenoncode menu for the computer, and I
// cannot write code for it as a consequence!"). Fixture 9000009001 carries
// the exact placed state: a MiniComputer with data {} — no hdd key, no
// .xc files, empty alias.
//
// E2E-TIER because: the laws are the WASM pump booting a BLANK entry, the
// real Editor save funnel rebooting it with the authored code (the print
// proves the blueprint-side file is what RAN), and the TopBar menu gate —
// none of those exist at a lower tier. The listing gate itself
// (xenonComputers on data {} / empty xc_files / Computer, the type-N
// labels, PilotSeat staying unlisted) and the doc-mirror write round-trip
// (save bytes + reload) are vitest-pinned: xenoncode.test.ts
// "THE FRESH-COMPUTER LISTING GATE" + xcfiles.test.ts round-trip.
import { expect, test } from '@playwright/test';

const FRESH = '9000009001';

test.describe('a fresh MiniComputer is programmable @ui', () => {
  test('empty disk: Xenon ▾ lists it, the blank IDE boots, authored code saves and RUNS', async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto(`/?craft=${FRESH}`);
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 90_000 });

    // THE GATE: the craft's ONLY computer carries an empty disk, and the
    // menu must still exist and list it (type-N label — no alias yet).
    await expect(page.getByTestId('xenon-menu')).toBeVisible();
    await page.getByTestId('xenon-menu').click();
    const item = page.getByTestId('xenon-comp-0');
    await expect(item).toContainText('minicomputer-0');
    await item.click();

    // the blank main.xc boots on the dev WASM: the ON indicator, then
    // cycles stream (an empty program compiles + runs, the game's rule
    // for a factory-fresh computer)
    await expect(page.getByTestId('xenon-dialog')).toBeVisible();
    await expect(page.getByTestId('xenon-on')).toHaveText('ON', { timeout: 60_000 });
    const cycles = async () => Number(
      await page.evaluate(() => (window as any).__XENON__?.()?.cycles ?? 0));
    await expect.poll(cycles, { timeout: 15_000 }).toBeGreaterThan(0);

    // AUTHOR the first program — the in-game ritual: type, save ⇒ reboot
    await page.getByTestId('xenon-edit').click();
    const cm = page.locator('.cm-content');
    await expect(cm).toBeVisible();
    await cm.click();
    // v1.13.26 law: '\n' auto-indents (update ⇒ body one unit in), so the
    // typing carries NO manual tabs — the editor owns the indent (typed
    // tabs stacked onto it = mixed indent = 'Invalid scope' at boot)
    await page.keyboard.type('var $c = 0\nupdate\n$c = $c + 1\nprint(text("fresh-boots {}", $c))');
    await page.getByTestId('xenon-save').click();

    // THE WRITE PATH ran: the save REBOOTED the VM off the blueprint's
    // files (the game's rule) — so a fresh-boots print in the console can
    // only come from the file that did not exist before this test.
    await expect(page.getByTestId('xenon-on')).toHaveText('ON', { timeout: 60_000 });
    await page.getByTestId('xenon-side-console').click();
    await expect(page.getByText(/fresh-boots \d+/).first()).toBeVisible({ timeout: 30_000 });

    // the IDE re-lists the computer from bp after the write (one disk file
    // now REAL: the doc mirror made it part of the save + the history)
    await page.keyboard.press('Escape');
    await page.getByTestId('xenon-menu').click();
    await expect(page.getByTestId('xenon-comp-0')).toContainText('1 .xc');
  });
});
