// staleness.spec.ts — the VERSIONED CACHE UI (v1.9.5): the gallery status
// chip + the [Download latest] / [Open cached copy] open gate.
//
// The staleness is SEALED IN THROUGH THE WIRE, not a debug backdoor: the
// first download's response is intercepted and re-fulfilled with the REAL
// body but a FAKE X-Blueprint-Rev header. The copy therefore caches at a
// rev the compiled catalog has never published, so the client's validator
// (cached rev ≠ catalog rev) reports 'edited since cached' exactly as it
// does for a genuine workshop edit — while the corpus files on disk stay
// untouched. The digest is kept CORRECT (hashed from the body in the test
// process), so only the version disagrees, and the sha-mismatch path has
// its own vitest pin.
import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';

const ID = '3417786605';                       // Dolphin — on the testdata floor

const fakeRevRoute = async (route: import('@playwright/test').Route) => {
  const res = await route.fetch();
  const body = await res.text();
  await route.fulfill({
    status: 200, body,
    headers: {
      'content-type': 'application/json',
      'x-blueprint-rev': '1-19700101',         // a rev the catalog never had
      'x-blueprint-sha': createHash('sha256').update(body).digest('hex'),
    },
  });
};

test.describe('@ui versioned cache staleness', () => {
  test('stale copy: open gate asks with both doors; [Open cached copy] is zero-network; gallery chip warns', async ({ page }) => {
    await page.route(`**/${ID}/blueprint.json`, fakeRevRoute);
    let reqs = 0;
    page.on('request', r => { if (r.url().includes(`/${ID}/blueprint.json`)) reqs++; });

    // first open: absent → download (stores the FAKE rev), no dialog
    await page.goto(`/?craft=${ID}`);
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
    expect(reqs).toBe(1);

    // reload: cached rev ≠ catalog rev → the gate asks, nothing loads or replaces
    await page.reload();
    const dialog = page.getByTestId('stale-open-dialog');
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog).toContainText(/edited since cached/i);
    await expect(dialog).toContainText(/nothing is used or replaced/i);
    await expect(page.getByTestId('stale-download')).toBeVisible();
    await expect(page.getByTestId('stale-usecached')).toBeVisible();

    // [Open cached copy] → the cached text opens, ZERO further requests
    await page.getByTestId('stale-usecached').click();
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
    expect(reqs, 'the cached door downloads nothing').toBe(1);

    // and the GALLERY says so: an amber stale chip on that card, none on an
    // uncraft of it (a never-opened craft carries no chip at all)
    await page.getByTestId('back-to-gallery').click();
    await expect(page.getByTestId('gallery')).toBeVisible();
    await expect(page.getByTestId(`card-status-stale-${ID}`)).toBeVisible();
    expect(await page.locator('[data-testid^="card-status-"]').count()).toBe(1);
  });

  test('[Download latest] re-stamps the copy → fresh opens silently with zero network again', async ({ page }) => {
    await page.route(`**/${ID}/blueprint.json`, fakeRevRoute);
    await page.goto(`/?craft=${ID}`);
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });

    await page.reload();
    await expect(page.getByTestId('stale-open-dialog')).toBeVisible({ timeout: 15_000 });

    // unroute FIRST: the download must hit the REAL /corpus route with its
    // genuine X-Blueprint-Rev / X-Blueprint-Sha headers
    await page.unroute(`**/${ID}/blueprint.json`);
    let reqs = 0;
    page.on('request', r => { if (r.url().includes(`/${ID}/blueprint.json`)) reqs++; });
    await page.getByTestId('stale-download').click();
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
    expect(reqs).toBe(1);

    // the copy now provably IS the served file: opens ask NOTHING and fetch NOTHING
    await page.reload();
    await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 30_000 });
    await expect(page.getByTestId('stale-open-dialog')).toHaveCount(0);
    expect(reqs, 'fresh copy: ZERO network on reopen').toBe(1);

    // the gallery chip flips from stale to the subtle fresh ✓
    await page.getByTestId('back-to-gallery').click();
    await expect(page.getByTestId(`card-status-fresh-${ID}`)).toBeVisible();
  });
});
