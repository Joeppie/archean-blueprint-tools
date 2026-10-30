// playerhud.spec.ts — PLAYER HUDs in the IDE (v1.17.0, we: "Player huds
// should also be able to be loaded in and edited; make it possible to load
// a player HUD file … Ensure that the Library function from computer also
// works there"). Fixture: the fixture-floor hudbench (tools/make_hud_test.py
// → testdata/hud/hudbench, served by the /hud route on EVERY machine).
// e2e-tier because: the laws are the menu wiring (Xenon ▸ Player HUDs),
// the Library side tab over the LOADED files (index + jump), the HUD
// runtime painting its panel() surface (lit pixels), and the save POST
// round-trip through the dev route. The loader laws (listing order, save
// targets, the picker extraction) are vitest-pinned: playerhud.test.ts.
import { expect, test } from '@playwright/test';

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

test.describe('player HUD: load, edit, Library, run @ui @playerhud', () => {
  test('hudbench opens in the HUD IDE; the Library indexes its @functions; ▶ paints', async ({ page }) => {
    await page.goto('/?craft=3294880085');
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 90_000 });
    // Xenon ▾ carries the Player HUDs section (the /hud listing — the
    // machine's installed HUDs ride along; the fixture is asserted)
    await page.getByTestId('xenon-menu').click();
    const item = page.getByTestId('xenon-playerhud-load');
    await expect(item).toBeVisible();
    // the fixture's own menu row: names are indexes, find by label text
    const row = page.locator('[data-testid^="xenon-playerhud-"]', { hasText: 'hudbench' }).first();
    await expect(row, 'the fixture-floor HUD is listed').toBeVisible();
    await row.click();

    // the SAME HUD IDE opens on the loaded files: tabs main.xc + parse.xc
    const dlg = page.getByTestId('hud-dialog');
    await expect(dlg).toBeVisible();
    await expect(page.getByTestId('hud-tab-0')).toContainText('main.xc');
    await expect(page.getByTestId('hud-tab-1')).toContainText('parse.xc');
    const code = page.getByTestId('hud-code-0');
    await expect(code).toContainText('avatar_sensor_speed');   // the speed read

    // THE LIBRARY TAB (the ask): it indexes the LOADED hud's declared
    // @functions — @speed_kph lives in parse.xc; a click JUMPS there.
    await page.getByTestId('hud-side-library').click();
    const fn = page.getByTestId('hud-lib-fn-speed_kph');
    await expect(fn, 'the Library lists the loaded HUD\'s own function').toBeVisible();
    await fn.click();
    await expect(page.getByTestId('hud-tab-1')).toHaveClass(/bg-\[#10141f\]/);
    // the code pane testid rides the ACTIVE tab: hud-code-<tab>
    await expect(page.getByTestId('hud-code-1'), 'the jump lands in parse.xc')
      .toContainText('function @speed_kph');

    // ▶ runs it: hudPump boots the program (AVATARSIM answers
    // avatar_sensor_speed), the panel(bottom, 240, 90) surface blits live
    await page.getByTestId('hud-run').click();
    await expect(page.getByTestId('hud-run-status')).toContainText(/cycles|ON/i, { timeout: 30_000 });
    // the live panel canvases live under the PANELS side tab
    await page.getByTestId('hud-side-panels').click();
    const canvas = page.locator('canvas[data-testid^="hud-panel-canvas-"]').first();
    await expect(canvas).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => litPixels(page, 'canvas[data-testid^="hud-panel-canvas-"]'), { timeout: 15_000 })
      .toBeGreaterThan(50);
    await page.getByTestId('hud-stop').click();
    await page.getByTestId('hud-close').click();
    await expect(dlg).toHaveCount(0);
  });

  test('the save law POSTs the .xc files and they come back edited', async ({ request }) => {
    // node-side round-trip over the SAME route the IDE uses: GET program →
    // POST edited → GET again. The fixture floor writes land in the game's
    // hud_dir as a COPY (never testdata bytes), so the repo tree stays clean.
    const r = await request.get('/hud/hudbench');
    expect(r.ok()).toBeTruthy();
    const prog = await r.json() as { files: { name: string; code: string }[] };
    const marker = `; saved-by-e2e ${Date.now()}\n`;
    const post = await request.post('/hud/hudbench', {
      data: { files: [{ name: 'main.xc', code: marker + prog.files[0]!.code },
        { name: 'parse.xc', code: prog.files[1]!.code }] },
    });
    expect(post.status()).toBe(200);
    // THE COPY LAW: the save lands in the WRITE hud dir (the suite points
    // ARCHEAN_HUD at a scratch folder — playwright.config), NEVER into the
    // repo fixture floor.
    const j = await post.json() as { ok: boolean; dir: string };
    expect(j.ok).toBeTruthy();
    expect(j.dir).not.toContain('testdata');
    const again = await (await request.get('/hud/hudbench')).json() as
      { files: { name: string; code: string }[] };
    expect(again.files[0]!.code.startsWith(marker)).toBeTruthy();
  });
});
