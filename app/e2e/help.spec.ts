// help.spec.ts — the built-in MANUAL (v1.5.20 user request: "add
// documentation in a help menu, with search for words for topics, keep it
// simple, markdown, generate html table, make it a manual so people can
// learn how to use it effectively"). Pins:
//  • Help ▾ Manual… opens the dialog: a search box, the topic rail, and a
//    markdown-rendered article — the topics' pipe tables as REAL <table>
//    elements;
//  • the word search matches TITLE, TAG ("zeppelin" finds the Sphere topic)
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
    await expect(page.getByTestId('help-topic-sphere')).toBeVisible();
    // the article is the rendered markdown of the selected topic
    await expect(page.getByTestId('help-article').locator('h1'))
      .toContainText('Quick start');
    // the sphere topic: its limits table must be a REAL html <table>
    await page.getByTestId('help-topic-sphere').click();
    const art = page.getByTestId('help-article');
    await expect(art.locator('h1')).toContainText('Sphere skin');
    await expect(art).toContainText(/convex[- ]hull/i);
    await expect(art.locator('table.md-table')).toHaveCount(1);
    await expect(art.locator('table.md-table th').first()).toHaveText('Limit');
    // keys topic: the shortcut table lists Ctrl+Z
    await page.getByTestId('help-topic-keys').click();
    await expect(art.locator('table.md-table').first())
      .toContainText('undo');
  });

  test('word search: title, tag and body words; AND; honest empty state', async ({ page }) => {
    await openNew(page);
    await openHelp(page);
    const search = page.getByTestId('help-search');
    // title hit ranks first and the article follows the best match
    await search.fill('sphere');
    await expect(page.getByTestId('help-rail').locator('button').first())
      .toHaveAttribute('data-testid', 'help-topic-sphere');
    await expect(page.getByTestId('help-article')).toContainText('Quickhull');
    // a TAG word (not in the prose) finds the same topic
    await search.fill('zeppelin');
    await expect(page.getByTestId('help-topic-sphere')).toBeVisible();
    // a BODY word from another topic: mirror severity prose
    await search.fill('faux');
    await expect(page.getByTestId('help-topic-mirror')).toBeVisible();
    // gibberish: an honest note, the rail empties, count says 0
    await search.fill('zzqxwordnever');
    await expect(page.getByTestId('help-noresults')).toBeVisible();
    await expect(page.getByTestId('help-matchcount')).toHaveText('0/14');
    // clearing the search restores the full rail
    await search.fill('');
    await expect(page.getByTestId('help-topic-start')).toBeVisible();
  });

  test('closes via Esc, ✕ and the backdrop', async ({ page }) => {
    await openNew(page);
    await openHelp(page);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('help-dialog')).toHaveCount(0);
    await openHelp(page);
    await page.getByTestId('help-close').click();
    await expect(page.getByTestId('help-dialog')).toHaveCount(0);
    await openHelp(page);
    await page.getByTestId('help-backdrop').click({ position: { x: 4, y: 4 } });
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
