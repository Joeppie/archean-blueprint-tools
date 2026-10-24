// stalecheck.mjs — REAL-DATA staleness walk-through for one craft, UI paths
// only. It drives the live editor with a PERSISTENT browser profile under
// /tmp/opencode (its own IndexedDB — NEVER the human's browser cache, never a
// write to anything under ~/.steam), so the SAME cached copy is inspected
// before and after a real workshop/in-game edit:
//
//   node tools/stalecheck.mjs <craft-id> [base-url]     (run from app/)
//
// Before an edit  → prints: silent open (fresh), no dialog, chip = fresh ✓.
// After the human edits the craft (in-game re-save, workshop update, any way
// they choose) → prints: chip = stale ⚠, the open gate with its dates, and
// after clicking [Download latest] the copy returns to FRESH (silent reload).
// The script NEVER edits corpus files; the ONLY changes it causes are
// browser-side cache writes through the app's own download path.
import { chromium } from '@playwright/test';

const id = process.argv[2];
if (!id) { console.error('usage: node tools/stalecheck.mjs <craft-id> [base-url]'); process.exit(2); }
const URL = process.argv[3] ?? 'http://127.0.0.1:5175';

const ctx = await chromium.launchPersistentContext('/tmp/opencode/stalecheck-profile', {
  headless: true,
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=vulkan'],
});
const page = await ctx.newPage();
await page.addInitScript(() => localStorage.setItem('archean-app-debug', '1'));

const opened = async () => {           // silent SCENE PASS, or the open gate wins
  return Promise.race([
    page.waitForFunction(() => /SCENE PASS/.test(document.title), null, { timeout: 45_000 })
      .then(() => 'silent'),
    page.getByTestId('stale-open-dialog').waitFor({ state: 'visible', timeout: 45_000 })
      .then(() => 'dialog'),
  ]);
};

// ---- 1. open ----------------------------------------------------------------
let reqs = 0;
page.on('request', r => { if (r.url().includes(`/${id}/blueprint.json`)) reqs++; });
await page.goto(`${URL}/?craft=${id}`, { waitUntil: 'domcontentloaded' });
let outcome = await opened();
if (outcome === 'dialog') {
  const text = (await page.getByTestId('stale-open-dialog').innerText()).replace(/\s+/g, ' ');
  console.log(`OPEN: gate shown — ${text}`);
  await page.getByTestId('stale-download').click();      // the honest door for a real edit
  await page.waitForFunction(() => /SCENE PASS/.test(document.title), null, { timeout: 45_000 });
  console.log('OPEN: [Download latest] chosen — craft open, copy re-stamped');
} else {
  console.log(`OPEN: silent (first download of this profile, or provably fresh) · requests so far ${reqs}`);
}

// ---- 2. reload (cache state WITHOUT touching the network) --------------------
await page.reload({ waitUntil: 'domcontentloaded' });
outcome = await opened();
if (outcome === 'dialog') {
  console.log(`RELOAD: ⚠ EDITED SINCE CACHED — gate: ${(await page.getByTestId('stale-open-dialog').innerText()).replace(/\s+/g, ' ')}`);
  await page.getByTestId('stale-download').click();
  await page.waitForFunction(() => /SCENE PASS/.test(document.title), null, { timeout: 45_000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  const again = await opened();
  console.log(`AFTER DOWNLOAD: ${again === 'silent' ? 'FRESH — silent open' : 'STILL GATED (unexpected!)'}`);
} else {
  console.log('RELOAD: fresh — silent zero-dialog open');
}

// ---- 3. gallery chip ----------------------------------------------------------
await page.goto(`${URL}/`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector(`[data-testid="card-${id}"], [data-testid="gallery"]`);
await page.waitForTimeout(600);                          // chips render after the IDB snapshot resolves
const chips = await page.locator(`[data-testid^="card-status-"][data-testid$="-${id}"]`).all();
for (const c of chips) console.log(`GALLERY chip: ${await c.getAttribute('data-testid')} — "${await c.getAttribute('title')}"`);
if (!chips.length) console.log('GALLERY chip: none (craft not cached in THIS profile, or not listed)');

await page.screenshot({ path: `/tmp/opencode/stalecheck-${id}.png`, fullPage: false });
console.log(`(screenshot: /tmp/opencode/stalecheck-${id}.png · profile: /tmp/opencode/stalecheck-profile)`);
await ctx.close();
