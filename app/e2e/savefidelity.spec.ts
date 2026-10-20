// savefidelity.spec.ts — File ▾ Save of an UNTOUCHED craft must reproduce
// every component orientation VERBATIM. The game stores and re-reads
// quaternion bytes unchanged (ISW-241: the workshop file 3518436870 and the
// game's own 2026 palette re-save 3812927875 share byte-identical
// orientations), so any rewrite the editor performs at open time becomes a
// rotated-different craft in game. That bug (v1.5.11, user 2026-10-20):
// opening the palette-less ISW-241 and saving conjugated all 25 non-trivial
// quaternions — in game the caster wheel spawned ON TOP of its strut and
// Jimmy's two-axis dashboard murals tore apart. Pixels-level companion of
// the pure savefidelity.test.ts pins, through the REAL download.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const TESTDATA = new URL('../../testdata/', import.meta.url).pathname;
const lits = (s: string) => [...s.matchAll(/"orientation":\{[^}]*\}/g)].map(m => m[0]);
const poss = (s: string) => [...s.matchAll(/"position":\{[^}]*\}/g)].map(m => m[0]);

async function saveText(page: import('@playwright/test').Page, id: string): Promise<string> {
  await page.goto(`/?craft=${id}`);
  await expect(page).toHaveTitle(/SCENE PASS/, { timeout: 40_000 });
  await page.getByTestId('file-menu').click();
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 15_000 }),
    page.getByTestId('file-save').click(),
  ]);
  const p = await dl.path();
  return readFileSync(p!, 'utf8');
}

test('palette-less craft: untouched save keeps every orientation + position literal byte-exact', async ({ page }) => {
  const src = readFileSync(`${TESTDATA}/3518436870/blueprint.json`, 'utf8');
  const out = await saveText(page, '3518436870');
  const got = lits(out);
  const want = lits(src);
  expect(got.length, 'orientation count').toBeGreaterThan(20);
  expect(want.length).toBe(got.length);
  got.forEach((lit, i) =>
    expect(lit, `orientation #${i} was rewritten (${want[i]} → ${lit})`).toBe(want[i]));
  expect(poss(out)).toEqual(poss(src));
});

test('palette craft: untouched save is byte-identical to the corpus file', async ({ page }) => {
  const src = readFileSync(`${TESTDATA}/3812927875/blueprint.json`, 'utf8');
  const out = await saveText(page, '3812927875');
  expect(out).toBe(src);
});

test('two-axis dashboard fixture (game-written L/R craft): untouched save byte-identical', async ({ page }) => {
  const src = readFileSync(`${TESTDATA}/9000004001/blueprint.json`, 'utf8');
  const out = await saveText(page, '9000004001');
  expect(out).toBe(src);
});
