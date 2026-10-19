// devchir.mjs — dev-side chirality probe via the XenonViewer capture API
// (window.XenonViewer.open/capture, js/app.js + js/viewer.js captureImage:
// azimuth/elevation in degrees, camera dir = (cos e sin a, sin e, cos e cos a)
// in FILE/raw scene space).  Scratch harness.
//   node tools/devchir.mjs --out /tmp/dir [--id 3309955432] [--corpus DIR]
import { chromium } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  if (!process.argv[i].startsWith('--')) continue;
  const k = process.argv[i].slice(2), n = process.argv[i + 1];
  if (n !== undefined && !n.startsWith('--')) { args[k] = n; i++; } else args[k] = '1';
}
const OUT = args.out || '/tmp/opencode/sidechir';
const ID = args.id || '3309955432';
const REPO = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: import.meta.dirname }).toString().trim();
const CORPUS = args.corpus || execFileSync('python3', ['tools/config.py'], { cwd: REPO }).toString().match(/blueprints\s*=\s*(\S+)/)[1];
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle',
    '--use-angle=vulkan', '--enable-unsafe-swiftshader'],
});
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
page.on('pageerror', (e) => console.error('dev page error:', String(e).slice(0, 200)));
await page.goto('https://viewer.xenontools.dev/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => !!window.XenonViewer?.ready, null, { timeout: 120000 });
await page.evaluate(() => window.XenonViewer.ready);
const json = JSON.parse(readFileSync(path.join(CORPUS, ID, 'blueprint.json'), 'utf8'));
await page.evaluate((bp) => window.XenonViewer.open({ blueprint: bp, name: 'chir.json' }), json);
await page.waitForFunction(() => !document.getElementById('loading').classList.contains('hidden')
  || /components/.test(document.getElementById('status-text')?.textContent || ''),
  null, { timeout: 180000 });
await page.waitForTimeout(2500);

// captureImage azimuth convention (viewer.js): camera sits along
// dir = (cos e sin a, sin e, cos e cos a) from the target, in RAW file space.
// az -90 => camera on the file -x side (looks at the x=-3 livery from outside).
for (const [name, az, el] of [['xneg', -90, 4], ['xpos', 90, 4], ['iso', 51.56, 25.78],
                              ['xneg90', -90, 0], ['xpos90', 90, 0]]) {
  const url = await page.evaluate(([az, el]) => window.XenonViewer.capture({
    azimuth: az, elevation: el, width: 1400, height: 900, grid: false,
  }), [az, el]);
  writeFileSync(path.join(OUT, `dev-${name}.png`),
    Buffer.from(url.split(',')[1], 'base64'));
  console.log(`dev-${name}.png done`);
}
await browser.close();
