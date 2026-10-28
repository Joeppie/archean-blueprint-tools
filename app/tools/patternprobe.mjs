// patternprobe.mjs — the DETERMINISTIC built-in-screen orientation probe.
// Boots a colour-coded pattern program onto the Computer (game-top RED,
// game-bottom GREEN, game-LEFT BLUE stripe), closes the IDE (freezing the
// pump, the model-face texture keeping the last blit), aims the orbit rig
// straight at the display quad (from its winding-normal side), reads the
// rendered rectangle via Engine.probeRect and classifies where each colour
// landed. Prints the exact (v, u) flips the shipped UV law needs.
//
//   node tools/patternprobe.mjs [base-url]        (run from app/)
import { chromium } from '@playwright/test';

const URL = process.argv[2] ?? 'http://127.0.0.1:5175';
const ctx = await chromium.launch({
  headless: true,
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=vulkan'],
});
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 200)));
await page.addInitScript(() => {
  localStorage.setItem('archean-app-debug', '1');
  localStorage.setItem('archean-app-backdrop', 'none');
});
await page.goto(`${URL}/?craft=3288012440`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => /SCENE PASS/.test(document.title), null, { timeout: 90_000 });

// 1) boot the pattern onto the Computer (the SAME disk writeback the IDE
//    editor uses → VM auto-reboots onto it and redraws every cycle)
await page.getByTestId('xenon-menu').click();
await page.getByTestId('xenon-comp-13').click();
await page.waitForFunction(() => (window.__XENON__?.() ?? {}).status === 'running', null, { timeout: 90_000 });
await page.getByTestId('xenon-side-screens').click();
const SCRIPT = `name: orient-probe
program: |
  init
  \tblank(black)
  update
  \tblank(black)
  \tdraw_rect(0,0,640,240,red)
  \tdraw_rect(0,240,640,480,green)
  \tdraw_rect(0,0,160,480,blue)
cycles: 4
`;
await page.evaluate((src) => window.__XENONTEST__.run(src), SCRIPT);
await page.waitForTimeout(1200);                       // rAF keeps the pattern alive
const surfOk = await page.evaluate(() => {
  const s = window.__XENON__().pixels?.('main#0');
  if (!s) return 'NO main#0';
  const kind = (y) => {
    let r = 0, g = 0, b = 0;
    for (let x = 0; x < s.w; x += 4) {
      const i = (y * s.w + x) * 4;
      if (s.data[i] > 120 && s.data[i + 1] < 80 && s.data[i + 2] < 80) r++;
      else if (s.data[i + 1] > 120 && s.data[i] < 80) g++;
      else if (s.data[i + 2] > 120 && s.data[i] < 80 && s.data[i + 1] < 80) b++;
    }
    return r > g && r > b ? 'RED' : g > b ? 'GREEN' : b > 0 ? 'BLUE' : 'dark';
  };
  return `main#0 rows 5/240/474: ${kind(5)}/${kind(240)}/${kind(474)} (want RED/GREEN/GREEN) `
    + `cols: mid-left ${kindRow(s, 240, 80)} mid-right ${kindRow(s, 240, 560)} (want BLUE/RED-ish)`;
  function kindRow(s, y, x) {
    const i = (y * s.w + x) * 4;
    return s.data[i] > 120 && s.data[i + 1] < 80 ? 'RED'
      : s.data[i + 2] > 120 ? 'BLUE' : s.data[i + 1] > 120 ? 'GREEN' : 'dark';
  }
});
console.log('PATTERN', surfOk);

// 2) close the IDE — the pump closes, the display texture FREEZES on the
//    pattern (no live canvas competes with the screenshot)
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

// 3) aim at the display quad from its front side and read the rect
const aim = await page.evaluate(() => {
  const eng = window.__ARCHEAN__.engine;
  const q = eng.screenFeedQuads().find((v) => /^computer/.test(v.key));
  if (!q) return null;
  // front normal = the winding cross of the world corners (already world space)
  const u = [q.corners[1][0] - q.corners[0][0], q.corners[1][1] - q.corners[0][1], q.corners[1][2] - q.corners[0][2]];
  const v = [q.corners[3][0] - q.corners[0][0], q.corners[3][1] - q.corners[0][1], q.corners[3][2] - q.corners[0][2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const nl = Math.hypot(...n);
  const d = Math.max(1.4, q.width * 2.2);
  const b = [n[0] / nl, n[1] / nl + 0.3, n[2] / nl];           // front, slight top bias
  const bl = Math.hypot(...b);
  eng.auditLookAt(
    [q.center[0] + b[0] / bl * d, q.center[1] + b[1] / bl * d, q.center[2] + b[2] / bl * d],
    q.center);
  return { key: q.key, n: n.map((x) => +x.toFixed(2)) };
});
console.log('AIM', JSON.stringify(aim));
await page.waitForTimeout(700);

const f2 = await page.evaluate(() => window.__ARCHEAN__.engine.screenFeedQuads()
  .find((v) => /^computer/.test(v.key)).corners.map((c) => window.__ARCHEAN__.engine.projectCanvas(...c)));
const us = f2.map((p) => p.u), vs = f2.map((p) => p.v);
const [u0, u1, v0, v1] = [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];
const rect = await page.evaluate(([a, b, w, h]) => {
  const r = window.__ARCHEAN__.engine.probeRect(a, b, w, h);
  return r ? { w: r.w, h: r.h, rgba: [...r.rgba] } : null;
}, [u0, v0, u1 - u0, v1 - v0]);
if (!rect) { console.log('probeRect failed'); await ctx.close(); process.exit(1); }
console.log(`face rect ${rect.w}x${rect.h}`);

// 4) classify: top band / bottom band / left third / right third
const frac = (py0, py1, px0, px1) => {
  let r = 0, g = 0, b = 0, n = 0;
  for (let py = Math.floor(rect.h * py0); py < Math.floor(rect.h * py1); py++)
    for (let px = Math.floor(rect.w * px0); px < Math.floor(rect.w * px1); px++) {
      const i = ((rect.h - 1 - py) * rect.w + px) * 4;   // py 0 = rect TOP
      const R = rect.rgba[i], G = rect.rgba[i + 1], B = rect.rgba[i + 2];
      n++;
      if (R > 120 && G < 80 && B < 80) r++;
      else if (G > 120 && R < 80) g++;
      else if (B > 120 && R < 80 && G < 80) b++;
    }
  return { red: +(r / n).toFixed(2), green: +(g / n).toFixed(2), blue: +(b / n).toFixed(2) };
};
const top = frac(0.1, 0.4, 0.2, 0.8), bot = frac(0.6, 0.9, 0.2, 0.8);
const left = frac(0.35, 0.65, 0.05, 0.28), right = frac(0.35, 0.65, 0.72, 0.95);
console.log(`canvas-TOP band:    ${JSON.stringify(top)}`);
console.log(`canvas-BOTTOM band: ${JSON.stringify(bot)}`);
console.log(`canvas-LEFT band:   ${JSON.stringify(left)}`);
console.log(`canvas-RIGHT band:  ${JSON.stringify(right)}`);
const vflip = top.green > top.red && bot.red > bot.green;   // game-top(red) low
const up = top.red > top.green && bot.green > bot.red;      // game-top(red) high
const mirror = right.blue > left.blue;                       // game-left(blue) right
const clean = left.blue > right.blue;
console.log(`VERDICT vertical: ${up ? 'UPRIGHT' : vflip ? 'V-FLIPPED' : 'inconclusive'}`
  + ` | horizontal: ${clean ? 'CLEAN' : mirror ? 'MIRRORED' : 'inconclusive'}`);
console.log('UV fix for the Computer branch (u = 1-(x-mn)/us, v = ...):',
  `v must be ${up ? 'WITH the axis (vv)' : vflip ? '1-MINUS (1-vv)' : '??'},`,
  `u must be ${clean ? 'WITH the axis (uu)' : mirror ? '1-MINUS (1-uu)' : '??'}`);
await ctx.close();
