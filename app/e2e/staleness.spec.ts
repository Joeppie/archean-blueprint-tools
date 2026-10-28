// staleness.spec.ts — the VERSIONED CACHE UI (v1.10.0): the gallery status
// chip + the [Download latest] / [Open cached copy] open gate.
//
// The staleness is SEALED IN THROUGH THE WIRE, not a debug backdoor. Under
// the v1.13.11 SHA-ONLY LAW (we: "it always thinks it changed when I made a
// new release; this should check whether the actual SHA of the file itself
// is different! not the release") identity is the CONTENT digest: the old
// fake-REV seal (real body, fake X-Blueprint-Rev) classifies as FRESH —
// provably the same bytes is exactly what a matching sha means, and the
// rev is display metadata only. So the wire seal swaps the CONTENT: the
// response body gains a trailing newline (JSON.parse tolerates it — the
// cached copy parses and opens), the digest is the honest SHA-256 OF THE
// SWAPPED BODY (the app's download-verify passes, the store self-check
// passes), and the catalog sha of the REAL file therefore differs —
// 'edited since cached' with both dates, exactly as for a genuine
// workshop edit, while the corpus files on disk stay untouched.
import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';

const ID = '3803780241';                       // XYQ-615 — a cataloged craft (a
//                                               hidden craft has no gallery card,
//                                               so it can't carry the chip the test asserts)

const fakeContentRoute = async (route: import('@playwright/test').Route) => {
  const res = await route.fetch();
  const body = await res.text();
  const swapped = body + '\n';                 // content edit (parses identically)
  await route.fulfill({
    status: 200, body: swapped,
    headers: {
      'content-type': 'application/json',
      'x-blueprint-rev': res.headers()['x-blueprint-rev'] ?? '',
      'x-blueprint-sha': createHash('sha256').update(swapped).digest('hex'),
    },
  });
};

test.describe('@ui versioned cache staleness @while-publish', () => {
  test('stale copy: open gate asks with both doors; [Open cached copy] is zero-network; gallery chip warns', async ({ page }) => {
    await page.route(`**/${ID}/blueprint.json`, fakeContentRoute);
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
    await page.route(`**/${ID}/blueprint.json`, fakeContentRoute);
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
