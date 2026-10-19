// devscrape.mjs — drive the Xenon dev viewer + our viewer over the matrix
// fixtures and dump a machine-readable comparison dossier per craft.
//
//   node app/tools/devscrape.mjs --ids 9000001001,9000002001 \
//        [--corpus <dir>] [--out reports/matrix] [--ours http://HOST:PORT] \
//        [--dev URL] [--no-ours] [--no-dev] [--width 1400 --height 900]
//
// Dev side (viewer.xenontools.dev): uploads the blueprint through the file
// input (the dev viewer has no URL loader), waits for the atelier + the model
// builder, clicks the 'iso' view preset, then scrapes mass & balance, build
// cost (items + raw materials), the component list and the notes/warnings,
// and screenshots the viewport.
//
// Our side (static server at --ours): loads viewer/index.html?open=<corpus>
// and MATCHES the camera to the dev's iso framing — dev Viewer.VIEW_ANGLES.iso
// is azimuth 0.9 / elevation 0.45 rad in FILE space (dir =
// (cos e·sin a, sin e, cos e·cos a)); our view space mirrors z, so the camera
// sits along (0.7053, 0.4350, -0.5597) at the load-fit distance. Uses ONLY the
// frozen viewer's public surface: URL params + the window.HARCHEAN test hooks
// (camera / controls / invalidate). Two shots: proxy (default) and real game
// models (?real) — dev always draws the real models.
//
// Output per craft: <out>/<id>.json {dev:{mass,cost,items,warnings},...}
// and <id>-dev.png, <id>-ours-proxy.png, <id>-ours-real.png.
//
// Needs the app/ npm project (@playwright/test). Run from app/:
//   node tools/devscrape.mjs ...

import { chromium } from '@playwright/test';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  if (!process.argv[i].startsWith('--')) continue;
  const key = process.argv[i].slice(2);
  const next = process.argv[i + 1];
  if (next !== undefined && !next.startsWith('--')) { args[key] = next; i++; }
  else args[key] = '1';
}
const IDS = (args.ids || '').split(',').filter(Boolean);
if (!IDS.length) {
  console.error('usage: node tools/devscrape.mjs --ids <id>[,<id>...] [--corpus DIR] ...');
  process.exit(2);
}
const REPO = execFileSync('git', ['rev-parse', '--show-toplevel'],
  { cwd: import.meta.dirname }).toString().trim();
const CORPUS = args.corpus || execFileSync('python3', ['tools/config.py'],
  { cwd: REPO }).toString().match(/blueprints\s*=\s*(\S+)/)[1];
const OUT = args.out || path.join(REPO, 'reports', 'matrix');
const DEV = args.dev || 'https://viewer.xenontools.dev/';
const OURS = args.ours || '';
const W = +(args.width || 1400), H = +(args.height || 900);
const DO_DEV = !args['no-dev'], DO_OURS = !args['no-ours'] && !!OURS;
const DO_SHOTS = !('no-shots' in args);
mkdirSync(OUT, { recursive: true });

// dev iso: azimuth 0.9 elevation 0.45, FILE-space camera direction; our view
// space mirrors z (pos (x,y,-z)) so the camera dir follows.
const ISO = { az: 0.9, el: 0.45 };
const ISO_DIR = [
  Math.cos(ISO.el) * Math.sin(ISO.az),
  Math.sin(ISO.el),
  -Math.cos(ISO.el) * Math.cos(ISO.az),   // our view space: z mirrored
];

async function openCraftDev(page, file) {
  await page.goto(DEV, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  // the app's ES modules register the file-input 'change' listener; setting
  // files before that loses the event entirely
  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
  await page.waitForSelector('#file-input', { state: 'attached' });
  await page.setInputFiles('#file-input', file);
  await page.waitForSelector('#atelier:not(.hidden)', { timeout: 90_000 });
  // loading overlay gone + status dot settled (success: '… components' with
  // kind 'ok'; parse failures set kind 'error')
  await page.waitForFunction(() =>
    document.getElementById('loading').classList.contains('hidden') &&
    /status-dot (ok|idle|error)/.test(document.getElementById('status-dot').className),
  null, { timeout: 90_000 });
  const st = await page.textContent('#status-text');
  const kind = await page.getAttribute('#status-dot', 'class');
  if (kind.includes('error')) throw new Error(`dev viewer status: ${st}`);
  await page.waitForTimeout(1500);              // mass/cost panels settle
}

async function scrapeDev(page, shotPath) {
  const out = {};
  out.massRows = await page.$$eval('#mass-stats dt', (dts) =>
    dts.map((dt) => [dt.textContent.trim(),
      dt.nextElementSibling ? dt.nextElementSibling.textContent.trim() : '']));
  out.massState = await page.textContent('#mass-state');
  out.comps = await page.$$eval('#comp-list .comp-group',
    (els) => els.map((e) => ({ id: e.dataset.rowKey,
      text: e.textContent.replace(/\s+/g, ' ').trim() })));
  await page.click('[data-view="iso"]');
  await page.waitForTimeout(1200);
  if (DO_SHOTS) await page.screenshot({ path: shotPath });
  // build-cost lives in a collapsed <details>; rows exist in the DOM but the
  // mode buttons only become clickable once the fold is open
  const fold = page.locator('details:has(#cost-mode)');
  if ((await fold.getAttribute('open')) === null) {
    await fold.locator('summary').click();
  }
  await page.waitForSelector('[data-cost="raw"]', { state: 'visible', timeout: 5000 });
  const scrapeCost = () => page.$$eval('#cost-list .cost-row', (rows) =>
    rows.map((r) => ({ id: r.getAttribute('title'),
      name: r.querySelector('.name')?.textContent.trim(),
      qty: r.querySelector('.mono')?.textContent.trim(),
      stuck: r.classList.contains('stuck') })));
  const scrapeHeads = () => page.$$eval('#cost-list .cost-head', (rows) =>
    rows.map((r) => r.textContent.replace(/\s+/g, ' ').trim()));
  // default mode is 'items' already — only switch when needed
  if (!(await page.locator('[data-cost="items"]').evaluate((b) => b.classList.contains('on'))))
    await page.click('[data-cost="items"]');
  await page.waitForTimeout(300);
  out.costItems = await scrapeCost(); out.costItemsHeads = await scrapeHeads();
  await page.click('[data-cost="raw"]');
  await page.waitForTimeout(400);
  out.costRaw = await scrapeCost(); out.costRawHeads = await scrapeHeads();
  const warnVisible = await page.$eval('#warnings-block',
    (e) => !e.classList.contains('hidden')).catch(() => false);
  out.warnings = warnVisible
    ? await page.$$eval('#warnings li', (ls) => ls.map((l) => l.textContent.trim()))
    : [];
  return out;
}

async function openCraftOurs(page, url, iso) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(() => !!window.HARCHEAN?.camera, null,
    { timeout: 90_000 });
  // #filestatus fills '— <alias> · N components' after setModel; the <title>
  // is a static header string. An 'ERR …' title means the loader threw.
  await page.waitForFunction(() => {
    const fs = document.getElementById('filestatus');
    return fs && /\d+ components/.test(fs.textContent);
  }, null, { timeout: 90_000 });
  if ((await page.title()).startsWith('ERR'))
    throw new Error(`viewer load error: ${await page.title()}`);
  await page.waitForTimeout(2500);              // model + real geometry settle
  if (iso) {
    await page.evaluate((dir) => {
      const H = window.HARCHEAN;
      const d = [...dir];
      const t = H.controls.target.clone();
      const dist = H.camera.position.distanceTo(t);
      H.camera.position.copy(t).add(new H.camera.position.constructor(...d).multiplyScalar(dist));
      H.controls.update();
      H.invalidate();
    }, ISO_DIR);
    await page.waitForTimeout(800);
  }
}

(async () => {
  console.error(`[launch] dev=${DO_DEV} ours=${DO_OURS} ${OURS}`);
  const launch = () => chromium.launch({
    env: { ...process.env,
      // keep the discrete GPU (serving AI models) untouched — desktop iGPU
      VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
    args: ['--no-sandbox', '--disable-dev-shm-usage',
      '--use-gl=angle', '--use-angle=vulkan',
      '--enable-unsafe-swiftshader'],
  });
  const dead = (e) => /Target closed|browser has been closed|browser closed|crashed/i
    .test(String(e));
  let browser = await launch();
  const errors = [];
  const { writeFileSync } = await import('node:fs');
  for (const id of IDS) {
    const file = path.join(CORPUS, id, 'blueprint.json');
    if (!existsSync(file)) { console.error(`missing ${file}`); errors.push(id); continue; }
    const dossier = { id };
    for (const phase of ['dev', 'ours-proxy', 'ours-real']) {
      try {
        if (phase === 'dev') {
          if (!DO_DEV) continue;
          console.error(`[${id}] dev: open`);
          const pDev = await (await browser.newContext({ viewport: { width: W, height: H } })).newPage();
          const devErrors = [];
          pDev.on('pageerror', (e) => devErrors.push(String(e)));
          try {
            await openCraftDev(pDev, file);
            console.error(`[${id}] dev: scrape+shot`);
            dossier.dev = await scrapeDev(pDev, path.join(OUT, `${id}-dev.png`));
          } catch (err) {
            dossier.devError = String(err);
            console.error(`[${id}] dev ERROR stack:`);
            console.error(String(err.stack || err));
          }
          dossier.devPageErrors = devErrors;
          await pDev.context().close().catch(() => {});
        } else {
          if (!DO_OURS) continue;
          const tag = phase.slice(5);
          const q = tag === 'real' ? '&real' : '';
          console.error(`[${id}] ours(${tag}): open`);
          const p = await (await browser.newContext({ viewport: { width: W, height: H } })).newPage();
          const ourErrors = [];
          p.on('pageerror', (e) => ourErrors.push(String(e)));
          try {
            await openCraftOurs(p, `${OURS}/viewer/index.html?open=../testdata/${id}/blueprint.json${q}`, true);
            dossier[`ours_${tag}`] = { filestatus: await p.textContent('#filestatus'),
              title: await p.title(), errors: ourErrors };
            if (DO_SHOTS) {
              console.error(`[${id}] ours(${tag}): shot`);
              await p.screenshot({ path: path.join(OUT, `${id}-ours-${tag}.png`) });
            }
          } catch (err) {
            dossier[`ours_${tag}`] = { error: String(err).split('\n')[0], errors: ourErrors };
            console.error(`[${id}] ours(${tag}) ERROR: ${err}`.split('\n')[0]);
          }
          await p.context().close().catch(() => {});
        }
      } catch (err) {
        if (dead(err)) {          // browser crash: relaunch and retry this id
          console.error(`[${id}] browser died (${String(err).split('\n')[0]}), relaunching`);
          await browser.close().catch(() => {});
          browser = await launch();
          errors.push(`${id}:${phase}`);
        } else {
          dossier[phase === 'dev' ? 'devError' : `ours_${phase.slice(6)}`] = String(err);
          errors.push(`${id}:${phase}`);
        }
      }
    }
    // mass sanity from our own file (no browser): compare later in python
    dossier.local = JSON.parse(readFileSync(file, 'utf8')).mass;
    writeFileSync(path.join(OUT, `${id}.json`), JSON.stringify(dossier, null, 1));
    const bad = dossier.devError ? ' DEVFAIL' : (dossier.devPageErrors?.length ? ' DEVERR' : '');
    console.log(`${id}: ${dossier.dev ? `dev mass ${dossier.dev.massState || '?'}` : 'no-dev'}${bad}`);
    if (dossier.devError) errors.push(id);
  }
  await browser.close().catch(() => {});
  process.exit(errors.length ? 1 : 0);
})();
