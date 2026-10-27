// bootprobe.mjs — BOOT-COST measurement for the app (v1.12.2 perf pass).
//
// Why: e2e wall time ≈ (boots × per-boot cost) + assertions, and the user's
// "snappier app" is the SAME number lived interactively. This probe boots the
// PRODUCTION preview (the exact stack playwright.config drives: fresh context
// per boot = no HTTP cache, ANGLE-Vulkan on the iGPU, NVIDIA hidden) and
// prints, per craft:
//   t0 → domContentLoad   bundle/HTML cost
//   t0 → boot:scene-load  the engine's scene-built mark (performance.mark,
//                         Viewport.tsx) — THE number
//   t0 → SCENE PASS       the title signal every e2e spec waits on
//   modules / bytes       the resource waterfall split per initiatorType
//   long>50ms             main-thread tasks over 50 ms (parse/compile/build)
// plus a GALLERY boot (the chunk-diet baseline for the lazy Editor design).
//
// usage: node tools/bootprobe.mjs [url] [ids...]
//        node tools/bootprobe.mjs http://127.0.0.1:5188 3812927875 9000007001
// Default ids: ISW · x-ray fixture · truck · giant · testframe.
import { chromium } from '@playwright/test';

const URL = process.argv[2] ?? 'http://127.0.0.1:5188';
const IDS = process.argv.slice(3).length ? process.argv.slice(3)
  : ['3812927875', '9000007001', '3481322297', '3509975859', '9000005001'];
const REPS = 3;

const browser = await chromium.launch({
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=vulkan'],
});

const OBSERVE = () => {
  window.__LT = [];
  try {
    new PerformanceObserver(l => { for (const e of l.getEntries()) window.__LT.push(e.duration); })
      .observe({ entryTypes: ['longtask'] });
  } catch { /* longtask unsupported: counts stay 0 */ }
};

const measure = async (path, wantTitle) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(OBSERVE);
  await ctx.addInitScript(() => {
    localStorage.setItem('archean-app-debug', '1');
    // mirror the Playwright BACKDROP-SKIP FIXTURE LAW (playwright.config.ts)
    // so the probe measures the boot the suite pays
    localStorage.setItem('archean-app-backdrop', 'none');
  });
  const page = await ctx.newPage();
  const t0 = Date.now();
  await page.goto(URL + path, { waitUntil: 'domcontentloaded' });
  let tDcl = Date.now() - t0;
  let tMark = null;
  if (wantTitle) {
    await page.waitForFunction(
      () => performance.getEntriesByName('boot:scene-load', 'mark').length > 0,
      null, { timeout: 120_000 }).catch(() => { /* mark missing — title times below */ });
    tMark = await page.evaluate(
      () => performance.getEntriesByName('boot:scene-load', 'mark')[0]?.startTime ?? -1);
    await page.waitForFunction(() => /SCENE PASS/.test(document.title), null, { timeout: 120_000 });
  } else {
    await page.waitForSelector('[data-testid=gallery]', { timeout: 30_000 });
  }
  const tTitle = Date.now() - t0;
  const page2 = { dcl: tDcl, mark: tMark, title: tTitle };
  const res = await page.evaluate(() => {
    const g = {};
    const by = {};
    for (const r of performance.getEntriesByType('resource')) {
      const k = r.initiatorType || 'other';
      (g[k] ??= { n: 0, b: 0 });
      g[k].n++; g[k].b += r.transferSize ?? 0;
      // bucket by route so the boot waterfall is readable: chunk JS,
      // atlas model JSON, blueprint, backdrop pano, wasm…
      const u = r.name.replace(/^https?:\/\/[^/]+/, '');
      const key = /\/assets\//.test(u) ? 'chunk'
        : /\/models\//.test(u) ? (u.includes('manifest') ? 'models/manifest' : 'models/type')
          : /\/testdata\//.test(u) ? 'blueprint'
            : /\.(jpg|jpeg|png)$/.test(u) ? 'pano'
              : /\.wasm$/.test(u) ? 'wasm' : 'other';
      (by[key] ??= { n: 0, b: 0, end: 0 });
      by[key].n++; by[key].b += r.transferSize ?? 0;
      by[key].end = Math.max(by[key].end, r.responseEnd);
    }
    const mk = n => performance.getEntriesByName(n, 'mark')[0]?.startTime ?? -1;
    return { g, by, marks: { main: Math.round(mk('boot:main')),
      eval: Math.round(mk('boot:editor-eval')), render1: Math.round(mk('boot:render1')), vp: Math.round(mk('boot:vp-render')),
      canvas: Math.round(mk('boot:canvas')),
      enginedone: Math.round(mk('boot:enginedone')), renderer: Math.round(mk('boot:renderer')),
      env: Math.round(mk('boot:env')), attach: Math.round(mk('boot:attach')),
      atlas: Math.round(mk('boot:atlas')), load: Math.round(mk('boot:scene-load')) },
    phases: window.__ARCHEAN__?.stats().loadPhases ?? null,
    lt: (window.__LT ?? []).filter(d => d > 50).length,
    ltms: Math.round((window.__LT ?? []).reduce((s, d) => s + d, 0)) };
  });
  await ctx.close();
  return { ...page2, ...res };
};

const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
const fmtRes = (g) => Object.entries(g)
  .map(([k, v]) => `${k}:${v.n}/${Math.round(v.b / 1024)}k`).join(' ');

console.log(`bootprobe ${URL} · iGPU ANGLE · ${REPS} boots per target, medians`);
const rows = [];
rows.push(['GALLERY', await Promise.all(Array.from({ length: REPS }, () => measure('/', false)))]);
for (const id of IDS)
  rows.push([id, await Promise.all(Array.from({ length: REPS }, () => measure(`/?craft=${id}`, true)))]);

for (const [name, runs] of rows) {
  const r0 = runs[0];
  console.log(
    `${name.padEnd(12)} dcl ${String(med(runs.map(r => r.dcl))).padStart(5)}ms` +
    `  mark ${String(med(runs.map(r => r.mark))).padStart(6)}ms` +
    `  pass ${String(med(runs.map(r => r.title))).padStart(6)}ms` +
    `  lt ${String(med(runs.map(r => r.lt))).padStart(2)}/${String(med(runs.map(r => r.ltms))).padStart(5)}ms` +
    `  ${fmtRes(r0.g)}`);
  const m = r0.marks;
  if (m) console.log(`${''.padEnd(12)} marks: main ${m.main} · eval ${m.eval} · render1 ${m.render1} · vp ${m.vp} · canvas ${m.canvas} · ` +
    `engine ${m.enginedone} · renderer ${m.renderer} · env ${m.env} · attach ${m.attach} · ` +
    `atlas ${m.atlas} · scene-load ${m.load}`);
  if (r0.phases)
    console.log(`${''.padEnd(12)} phases: ` + Object.entries(r0.phases)
      .map(([k, v]) => `${k} ${v}`).join(' · '));
  if (r0.by)
    console.log(`${''.padEnd(12)} routes: ` + Object.entries(r0.by)
      .map(([k, v]) => `${k} ${v.n}/${Math.round(v.b / 1024)}k@${Math.round(v.end)}ms`).join(' · '));
}
await browser.close();
