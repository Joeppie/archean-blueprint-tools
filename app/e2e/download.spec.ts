// download.spec.ts — the download-when-required contract: a craft's
// blueprint.json is fetched ONLY on the first open (progress overlay while
// it streams), lands in IndexedDB, and every later open — reload, gallery
// round-trip — is cache-served with ZERO requests. File ▾ Refresh is the
// one user-forced redownload; a failed first download shows the overlay's
// error state with Retry / Gallery.
import { expect, test, type Page } from '@playwright/test';

const ISW = '3812927875';
const DOLPHIN = '3417786605';

const bpReqCounter = (page: Page, id: string) => {
  const hits: string[] = [];
  page.on('request', r => { if (r.url().includes(`/corpus/${id}/blueprint.json`)) hits.push(r.url()); });
  return hits;
};

test('download once: first open fetches, reload + gallery reopen are pure cache', async ({ page }) => {
  const reqs = bpReqCounter(page, ISW);
  await page.goto(`/?craft=${ISW}`);
  await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
  expect(reqs.length, 'first open downloads the blueprint').toBe(1);

  await page.reload();                                   // same context → IndexedDB survives
  await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
  expect(reqs.length, 'cached craft: reload is ZERO network').toBe(1);

  await page.getByTestId('back-to-gallery').click();
  await page.locator(`[data-testid="card-${ISW}"]`).click();
  await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
  expect(reqs.length, 'cached craft: gallery reopen is ZERO network').toBe(1);

  // File ▾ Refresh (redownload) = the one forced path back to the network
  await page.getByTestId('file-menu').click();
  await page.getByTestId('file-refresh').click();
  await expect.poll(() => reqs.length, { timeout: 15_000 }).toBe(2);
  await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
});

test('progress overlay streams while a slow blueprint downloads', async ({ page }) => {
  // hold the response a beat so the overlay is unambiguously observable
  await page.route(`**/corpus/${DOLPHIN}/blueprint.json`, async route => {
    const res = await route.fetch();
    const body = await res.text();
    await new Promise(r => setTimeout(r, 1200));
    await route.fulfill({ body, contentType: 'application/json' });
  });
  await page.goto(`/?craft=${DOLPHIN}`);
  const overlay = page.getByTestId('load-overlay');
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText('Receiving blueprint');
  await expect(overlay).toContainText(/receiving…|\d+% · \d+ KiB/);
  await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
  await expect(overlay).toHaveCount(0);                  // gone once the craft is open
});

test('failed first download → overlay error state, Retry recovers', async ({ page }) => {
  let fail = true;
  await page.route(`**/corpus/${ISW}/blueprint.json`, route =>
    fail ? route.fulfill({ status: 404, body: 'gone' }) : route.continue());
  await page.goto(`/?craft=${ISW}`);
  const overlay = page.getByTestId('load-overlay');
  await expect(overlay).toContainText('download failed', { timeout: 15_000 });
  await expect(page.getByTestId('load-back')).toBeVisible();
  fail = false;
  await page.getByTestId('load-retry').click();
  await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
  await expect(overlay).toHaveCount(0);
});
