// help.spec.ts — the built-in MANUAL (v1.5.20 user request: "add
// documentation in a help menu, with search for words for topics, keep it
// simple, markdown, generate html table, make it a manual so people can
// learn how to use it effectively"). Pins:
//  • Help ▾ Manual… opens the dialog: a search box, the topic rail, and a
//    markdown-rendered article — the topics' pipe tables as REAL <table>
//    elements;
//  • the word search matches TITLE, TAG ("zeppelin" finds the Balloon topic)
//    and BODY words, ANDs multiple words, and admits "no topic matches"
//    for gibberish instead of blanking the manual;
//  • Esc / ✕ / backdrop close it;
//  • the window NEVER outgrows the viewport (desktop AND Pixel 7 — the
//    tool-dialog discipline applied to the manual).
import { expect, test } from '@playwright/test';

async function openNew(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByTestId('gallery-new').click();
  await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
}

async function openHelp(page: import('@playwright/test').Page) {
  await page.getByTestId('help-menu').click();
  await page.getByTestId('help-manual').click();
  await expect(page.getByTestId('help-dialog')).toBeVisible();
}

test.describe('help manual @ui', () => {
  test('menu opens the manual; rail, article and HTML tables render', async ({ page }) => {
    await openNew(page);
    await openHelp(page);
    // the rail lists the topics in reading order, Quick start first
    await expect(page.getByTestId('help-topic-start')).toBeVisible();
    await expect(page.getByTestId('help-topic-balloon')).toBeVisible();
    // the article is the rendered markdown of the selected topic
    await expect(page.getByTestId('help-article').locator('h1'))
      .toContainText('Quick start');
    // the balloon topic: its tables must be REAL html <table>s (v1.9:
    // two tables ride the topic — the body table AND the limits table)
    await page.getByTestId('help-topic-balloon').click();
    const art = page.getByTestId('help-article');
    await expect(art.locator('h1')).toContainText('Generate balloon');
    await expect(art).toContainText(/convex[- ]hull/i);
    await expect(art.locator('table.md-table')).toHaveCount(2);
    await expect(art.locator('table.md-table').last().locator('th').first()).toHaveText('Limit');
    // v1.9: the tail section documents the fin/coupler/volume batch
    await expect(art).toContainText('2 ailerons');
    // keys topic: the shortcut table lists Ctrl+Z
    await page.getByTestId('help-topic-keys').click();
    await expect(art.locator('table.md-table').first())
      .toContainText('undo');
    // Esc closes (the v1.5.20 subscribe-once law, at the app's real TopBar
    // wiring; the full close-trio + search + rail laws moved to the jsdom
    // tier: src/components/__tests__/helpdialog.test.tsx, v1.12.1)
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('help-dialog')).toHaveCount(0);
  });

  test('the window never outgrows the viewport', async ({ page }) => {
    await openNew(page);
    await openHelp(page);
    const box = await page.getByTestId('help-dialog').boundingBox();
    const vp = page.viewportSize()!;
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(vp.height + 1);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width + 1);
  });
});
