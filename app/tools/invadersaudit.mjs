// invadersaudit.mjs — live audit of craft 3288012440 (Shadoh's Space
// Invaders arcade: Computer ci13 + PilotSeat (io 10 = ch1/2/3 stick) +
// ThrottleLever (io 9 ch 0) + Lamp (io 11)). One boot measures every law the
// 2026-10-28 reports ask about:
//   #2 the built-in screen: ▣ dock gate + IDE surfaces + 3-D mirror feed
//   #1/#3 input: seat channel READS per key press (d, ArrowUp, Space)
//   #4 the bound pilot-key set (PILOT_KEYS ∩ the seat's channels)
//   #5 the BUILT-IN SCREEN ORIENTATION, measured: project the live 3-D quad
//      → probeRect the framebuffer rectangle → correlate against the live
//      main#0 surface for the four orientations (identity/vflip/hflip/rot18);
//      the SMALLEST mean |Δ| is how the face renders (pixels, not intent).
//
//   node tools/invadersaudit.mjs [base-url]     (run from app/)
import { chromium } from '@playwright/test';

const URL = process.argv[2] ?? 'http://127.0.0.1:5175';

const ctx = await chromium.launch({
  headless: true,
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=vulkan'],
});
const page = await ctx.newPage();
page.on('pageerror', e => console.log('PAGEERROR', String(e).slice(0, 200)));
await page.addInitScript(() => {
  localStorage.setItem('archean-app-debug', '1');
  localStorage.setItem('archean-app-backdrop', 'none');
});
const X = () => page.evaluate(() => (window.__XENON__ ? window.__XENON__() : null));

await page.goto(`${URL}/?craft=3288012440`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => /SCENE PASS/.test(document.title), null, { timeout: 60_000 });

// ---- 1) the gates (report #2) ----------------------------------------------
await page.getByTestId('xenon-menu').click();
const items = await page.locator('[data-testid^="xenon-comp-"]').count();
console.log(`GATE Xenon menu: ${items} computer item(s)`);
console.log(`GATE ▣ Screens dock button present: ${await page.getByTestId('screens-btn').count() > 0}`);
await page.getByTestId('xenon-comp-13').click();
await page.waitForFunction(() => (window.__XENON__?.() ?? {}).status === 'running', null, { timeout: 60_000 });
await page.getByTestId('xenon-side-screens').click();
await page.waitForFunction(() => {
  const x = window.__XENON__?.();
  return x && x.cycles > 120 && x.surfaceMeta.some(m => m.key === 'main#0');
}, null, { timeout: 60_000 });

let x = await X();
await page.waitForFunction(() => (window.__XENON__?.() ?? {}).cycles > 320, null,
  { timeout: 90_000 });                     // > 12 s: the title + Top-Scores state
x = await X();
console.log('SURFACES', x.surfaceMeta.map(m => `${m.key} ${m.w}x${m.h}`).join(' | '));
const mirror = x.surfaceMeta.find(m => /^computer/.test(m.key));
console.log(`BUILT-IN mirror surface (model face key): ${mirror ? `${mirror.key} ${mirror.w}x${mirror.h}` : 'ABSENT'}`);
const feeds = await page.evaluate(() => window.__ARCHEAN__.engine.screenFeedKeys());
console.log('3-D feed keys:', feeds.join(', '));

// ---- 2) bound cockpit keys (report #4) --------------------------------------
console.log(`PILOT-KEYS bound: [${x.pilotKeys.join(',')}]`);
const rowsOf = (xx, pat) => xx.world.filter(r => r && r.name.includes(pat)).map(r => `${r.name}=${r.value}`);
console.log('seat rows at rest:', rowsOf(x, 'pilotseat').join(' '));

// ---- 3) the input path (reports #1/#3) --------------------------------------
const press = async (key, ms = 200) => {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  const during = await X();
  await page.keyboard.up(key);
  await page.waitForTimeout(160);
  const r = await page.evaluate(() => window.__XENON__().reads());
  return { rows: rowsOf(during, 'pilotseat'), reads: r };
};
const up = await press('ArrowUp', 400);           // enters the game (ch3 = +1)
console.log('PRESS ArrowUp → rows:', up.rows.join(' '), '| reads:', JSON.stringify(up.reads));
await page.waitForTimeout(600);
const d = await press('d');                       // steering in play: ch 2 read EVERY cycle
console.log('PRESS d → rows:', d.rows.join(' '), '| reads:', JSON.stringify(d.reads));
const sp = await press(' ');                       // the game's own call-to-action key
console.log('PRESS Space → rows:', sp.rows.join(' '), '| reads:', JSON.stringify(sp.reads));
x = await X();
console.log('reads map after the game runs (io:ch → last value):',
  JSON.stringify(await page.evaluate(() => window.__XENON__().reads())));

// ---- 4) the built-in screen orientation (report #5) -------------------------
// The Computer's baked screen quad is an UP-FACING panel (arcade-top style):
// aim the rig from ABOVE the pilot side (normal + up + pilot-direction, 50°
// elevation) so the projection is a clean fronto-parallel-ish rect, then
// correlate the RENDERED rect with the live main#0 framebuffer under the
// four orientations.
const aimed = await page.evaluate(() => {
  const eng = window.__ARCHEAN__.engine;
  const q = eng.screenFeedQuads().find(v => /^computer/.test(v.key));
  if (!q) return null;
  const d = Math.max(1.6, q.width * 2.4);
  // bias = toward the pilot seat (+z) + world up + the face normal
  const b = [q.normal[0] * 1.0 + 0.35, q.normal[1] * 1.0 + 0.75, q.normal[2] * 1.0 + 0.75];
  const len = Math.hypot(...b);
  eng.auditLookAt(
    [q.center[0] + b[0] / len * d, q.center[1] + b[1] / len * d, q.center[2] + b[2] / len * d],
    q.center);
  return q.key;
});
if (!aimed) {
  console.log('ORIENT: no computer screen quad registered');
} else {
  await page.waitForTimeout(600);
  const quadInfo = await page.evaluate(() => {
    const q = window.__ARCHEAN__.engine.screenFeedQuads().find(v => /^computer/.test(v.key));
    return q ? { center: q.center.map(n => +n.toFixed(3)), normal: q.normal.map(n => +n.toFixed(3)),
      corners: q.corners.map(c => c.map(n => +n.toFixed(3))) } : null;
  });
  console.log('quad:', JSON.stringify(quadInfo));
  const f2 = await page.evaluate(() => {
    const eng = window.__ARCHEAN__.engine;
    const q = eng.screenFeedQuads().find(v => /^computer/.test(v.key));
    return q ? q.corners.map(c => eng.projectCanvas(c[0], c[1], c[2])) : null;
  });
  const us = f2.map(p => p.u), vs = f2.map(p => p.v);
  const u0 = Math.min(...us), u1 = Math.max(...us), v0 = Math.min(...vs), v1 = Math.max(...vs);
  console.log(`face rect: u ${u0.toFixed(3)}..${u1.toFixed(3)} v ${v0.toFixed(3)}..${v1.toFixed(3)}`);
  // an eyeball crop of the live 3-D face for the humans
  try {
    const box = await page.locator('[data-testid="canvas"]').boundingBox();
    if (box) await page.screenshot({ path: '/tmp/opencode/invaders-face.png',
      clip: { x: box.x + u0 * box.width - 4, y: box.y + v0 * box.height - 4,
              width: (u1 - u0) * box.width + 8, height: (v1 - v0) * box.height + 8 } });
  } catch { /* probe-only */ }
  const rect = await page.evaluate(([a, b, w, h]) => {
    const r = window.__ARCHEAN__.engine.probeRect(a, b, w, h);
    return r ? { w: r.w, h: r.h, rgba: [...r.rgba] } : null;
  }, [u0, v0, u1 - u0, v1 - v0]);
  const surf = await page.evaluate(() => window.__XENON__().pixels('main#0'));
  if (!rect || !surf) console.log('ORIENT: probe missing', !!rect, !!surf);
  else {
    // bilinear sample of the rendered rect at face (tu, v_uv) coords;
    // corners are (u,v)_uv ordered C00, C10, C11, C01
    const [C00, C10, C11, C01] = f2;
    const sample = (tu, vuv) => {
      const u = (1 - tu) * (1 - vuv) * C00.u + tu * (1 - vuv) * C10.u
              + tu * vuv * C11.u + (1 - tu) * vuv * C01.u;
      const v = (1 - tu) * (1 - vuv) * C00.v + tu * (1 - vuv) * C10.v
              + tu * vuv * C11.v + (1 - tu) * vuv * C01.v;
      const px = Math.max(0, Math.min(rect.w - 1, Math.floor((u - u0) / (u1 - u0) * rect.w)));
      const py = Math.max(0, Math.min(rect.h - 1, Math.floor((v - v0) / (v1 - v0) * rect.h)));
      const row = rect.h - 1 - py;                         // GL: row 0 = bottom
      const i = (row * rect.w + px) * 4;
      return [rect.rgba[i], rect.rgba[i + 1], rect.rgba[i + 2]];
    };
    const texel = (tu, tv) => {                            // tv: 0 = image TOP
      const px = Math.max(0, Math.min(surf.w - 1, Math.floor(tu * surf.w)));
      const py = Math.max(0, Math.min(surf.h - 1, Math.floor(tv * surf.h)));
      const i = (py * surf.w + px) * 4;
      return [surf.data[i], surf.data[i + 1], surf.data[i + 2]];
    };
    const score = (mapTu, mapTv) => {
      let s = 0, n = 0, ink = 0;
      for (let gy = 1; gy < 72; gy++)
        for (let gx = 1; gx < 128; gx++) {
          const tu = gx / 128, tv = gy / 72;
          const b = texel(tu, tv);
          const lum = (b[0] + b[1] + b[2]) / 3;
          if (lum < 25) continue;                 // ink-only samples
          const a = sample(mapTu(tu, tv), 1 - mapTv(tu, tv));   // v_uv = 1 - tv
          s += Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
          n++; ink++;
        }
      score.ink = ink;
      return n ? s / n : 1e9;
    };
    // BAND-ENERGY metric (robust to the symmetric invader grid): the game's
    // waiting state is TOP-heavy (bright title + invader rows at y≈16-44 of
    // 480, only the thin blinking prompt at the bottom). Upright means the
    // face's WORLD-TOP band is the bright one.
    const { K00, K10, K11, K01 } = { K00: f2[0], K10: f2[1], K11: f2[2], K01: f2[3] };
    const bandLum = (vu0, vu1) => {
      let s = 0, n = 0;
      for (let vi = 0; vi < 12; vi++)
        for (let ui = 1; ui < 40; ui++) {
          const tu = ui / 40, vuv = vu0 + (vu1 - vu0) * (vi / 12);
          const u = (1 - tu) * (1 - vuv) * K00.u + tu * (1 - vuv) * K10.u
                  + tu * vuv * K11.u + (1 - tu) * vuv * K01.u;
          const v = (1 - tu) * (1 - vuv) * K00.v + tu * (1 - vuv) * K10.v
                  + tu * vuv * K11.v + (1 - tu) * vuv * K01.v;
          const px = Math.max(0, Math.min(rect.w - 1, Math.floor((u - u0) / (u1 - u0) * rect.w)));
          const py = Math.max(0, Math.min(rect.h - 1, Math.floor((v - v0) / (v1 - v0) * rect.h)));
          const i = ((rect.h - 1 - py) * rect.w + px) * 4;
          s += (rect.rgba[i] + rect.rgba[i + 1] + rect.rgba[i + 2]) / 3; n++;
        }
      return s / n;
    };
    // the quad's uv v=1 corner is ws[2]/ws[3] = WORLD TOP (max Y) — its
    // projected v is the rect TOP, so vuv≈1 samples the panel's world-top.
    const faceTop = bandLum(0.84, 1.0), faceBot = bandLum(0.0, 0.16);
    // ground truth from the framebuffer: texture TOP band (tv 0..0.16)
    let tTop = 0, tBot = 0;
    for (let py = 2; py < Math.floor(surf.h * 0.16); py++)
      for (let px = 0; px < surf.w; px += 3) {
        const i = (py * surf.w + px) * 4;
        tTop += (surf.data[i] + surf.data[i + 1] + surf.data[i + 2]) / 3;
      }
    for (let py = Math.floor(surf.h * 0.84); py < surf.h - 2; py++)
      for (let px = 0; px < surf.w; px += 3) {
        const i = (py * surf.w + px) * 4;
        tBot += (surf.data[i] + surf.data[i + 1] + surf.data[i + 2]) / 3;
      }
    const nT = Math.floor(surf.h * 0.16) * Math.ceil(surf.w / 3);
    tTop /= nT; tBot /= nT;
    console.log(`texture bands: TOP ${tTop.toFixed(1)} vs BOTTOM ${tBot.toFixed(1)} (game state)`);
    console.log(`face bands: WORLD-TOP ${faceTop.toFixed(1)} vs WORLD-BOTTOM ${faceBot.toFixed(1)}`);
    const faceTopHeavy = faceTop > faceBot;
    const texTopHeavy = tTop > tBot;
    console.log(`VERDICT: face is ${faceTopHeavy ? 'top-heavy' : 'bottom-heavy'}, texture is ${texTopHeavy ? 'top-heavy' : 'bottom-heavy'} → ${faceTopHeavy === texTopHeavy ? 'UPRIGHT ✔' : 'UPSIDE DOWN ✗'}`);
    const ID = () => (t) => t;
    const KEEP_V = () => (_t, v) => v;
    const FLIP_V = () => (_t, v) => 1 - v;
    const FLIP_U = () => (t) => 1 - t;
    // SHARPER metric: mean RENDERED luminance at ink texel positions — the
    // correct orientation lands texture-ink on face-ink (bright); a wrong one
    // samples dark bezel (dim). Immune to the black-field dilution of |Δ|.
    const [CC00, CC10, CC11, CC01] = f2;
    const inkLum = (mapTu, mapTv) => {
      let s = 0, n = 0;
      for (let gy = 1; gy < 72; gy++)
        for (let gx = 1; gx < 128; gx++) {
          const tu = gx / 128, tv = gy / 72;
          const b = texel(tu, tv);
          if ((b[0] + b[1] + b[2]) / 3 < 25) continue;
          const vuv = 1 - mapTv(tu, tv);
          const u = (1 - mapTu(tu, tv)) * (1 - vuv) * CC00.u + mapTu(tu, tv) * (1 - vuv) * CC10.u
                  + mapTu(tu, tv) * vuv * CC11.u + (1 - mapTu(tu, tv)) * vuv * CC01.u;
          const vv = (1 - mapTu(tu, tv)) * (1 - vuv) * CC00.v + mapTu(tu, tv) * (1 - vuv) * CC10.v
                  + mapTu(tu, tv) * vuv * CC11.v + (1 - mapTu(tu, tv)) * vuv * CC01.v;
          const px = Math.max(0, Math.min(rect.w - 1, Math.floor((u - u0) / (u1 - u0) * rect.w)));
          const py = Math.max(0, Math.min(rect.h - 1, Math.floor((vv - v0) / (v1 - v0) * rect.h)));
          const i = ((rect.h - 1 - py) * rect.w + px) * 4;
          s += (rect.rgba[i] + rect.rgba[i + 1] + rect.rgba[i + 2]) / 3; n++;
        }
      return n ? s / n : -1;
    };
    const R = {
      identity: score(ID(), KEEP_V()),
      'v-flipped (upside down)': score(ID(), FLIP_V()),
      'h-flipped (mirrored)': score(FLIP_U(), KEEP_V()),
      'rotated 180': score(FLIP_U(), FLIP_V()),
    };
    const L = {
      identity: inkLum(ID(), KEEP_V()),
      'v-flipped (upside down)': inkLum(ID(), FLIP_V()),
      'h-flipped (mirrored)': inkLum(FLIP_U(), KEEP_V()),
      'rotated 180': inkLum(FLIP_U(), FLIP_V()),
    };
    for (const [k, v] of Object.entries(R).sort((a, b) => a[1] - b[1]))
      console.log(`ORIENT ${k}: mean |Δ| = ${v.toFixed(1)}  |  ink-lum = ${L[k].toFixed(1)}`);
    console.log(`ink samples used: ${score.ink}`);
    // rendered-face stats: is the face lit at all? (a black face = the feed
    // never reached the texture; the orientation scores are then meaningless)
    {
      let sum = 0, max = 0;
      for (let i = 0; i < rect.rgba.length; i += 4) {
        const lum = (rect.rgba[i] + rect.rgba[i + 1] + rect.rgba[i + 2]) / 3;
        sum += lum; if (lum > max) max = lum;
      }
      console.log(`rendered face rect: mean lum ${(sum / (rect.rgba.length / 4)).toFixed(1)}, max ${max.toFixed(0)}, ${rect.w}x${rect.h}px`);
    }
    console.log('mean surface luminance (game must be ON, ink present):',
      (surf.data.reduce((s, v, i) => (i % 4 === 3 ? s : s + v), 0) / (surf.data.length * 0.75)).toFixed(1));
  }
}
await ctx.close();
