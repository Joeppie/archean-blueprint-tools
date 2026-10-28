// camtune.mjs — auto-pick the clip camera by MEASURING candidate eyes.
// For invaders: sweep eyes around the cabinet; for each, project the screen
// quad corners to the canvas and score the quad's pixel region — panel ink
// (bright game pixels) + dark game background + quad area + the PilotSeat
// peeking into frame. The best-scoring eye IS the "player at the cabinet"
// angle; hand-guessing it burned three takes.
//
//   node tools/camtune.mjs invaders|mario [base-url]      (run from app/)
import { chromium } from '@playwright/test';

const NAME = process.argv[2];
const URL = process.argv[3] ?? 'http://127.0.0.1:5175';
const CFG = {
  invaders: {
    craft: '3288012440', dash: 'main#0',
    // v1.13.11: pilot side (+z). Second ring: ~1.0-1.2 m out so the WHOLE
    // 0.78 m panel (title, invader rows, scores, prompt) fits the 45° frame
    // — the first chair-side ring stood 0.45 m out and framed the empty
    // middle band (ink 0.1 %). Seat volume starts z ≈ -0.12: the camera
    // rides its front edge = the "between chair and computer" drama.
    target: [0, -0.152, -1.118],
    eyes: [
      [0.0, -0.15, -0.05], [0.2, -0.05, -0.1], [-0.2, -0.05, -0.1],
      [0.0, 0.05, -0.05], [0.25, -0.25, 0.0], [-0.25, -0.25, 0.0],
      [0.0, -0.3, -0.05], [0.15, -0.1, -0.2], [-0.15, -0.1, -0.2],
      [0.0, 0.15, -0.05], [0.3, 0.05, -0.2], [0.0, -0.05, 0.05],
    ],
  },
  mario: {
    craft: '3820116990', dash: 'first-virtual',
    target: [-1.5, -0.4, -0.75],           // the six-SCREEN wall's centre
    eyes: [
      [-1.72, -0.4, -0.75], [-1.8, -0.42, -0.55], [-1.75, -0.3, -0.9],
      [-1.95, -0.35, -0.75], [-1.72, -0.55, -0.75], [-1.85, -0.4, -1.0],
      [-1.72, -0.25, -0.6], [-2.0, -0.5, -0.5], [-1.78, -0.45, -0.75],
    ],
  },
};
const cfg = CFG[NAME];
if (!cfg) { console.error('usage: node tools/camtune.mjs invaders|mario [url]'); process.exit(2); }

const b = await chromium.launch({
  headless: true,
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=vulkan'],
});
const p = await (await b.newContext({ viewport: { width: 640, height: 420 } })).newPage();
await p.addInitScript(() => {
  localStorage.setItem('archean-app-debug', '1');
  localStorage.setItem('archean-app-backdrop', 'none');
  localStorage.setItem('archean-app-ortho', '0');
});
await p.goto(`${URL}/?craft=${cfg.craft}&dash=${encodeURIComponent(cfg.dash)}`,
  { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => /SCENE PASS/.test(document.title), null, { timeout: 120_000 });
await p.waitForFunction(() => (window.__XENON__?.() ?? {}).status === 'running', null, { timeout: 120_000 });
if (NAME === 'mario') {
  // title state on the wall (don't start the game — the close-up wants the TITLE)
  await p.waitForFunction(() => (window.__XENON__?.()?.vars?.()?.assetsready) === '1',
    null, { timeout: 150_000 });
} else {
  await p.waitForTimeout(9000);                      // title arrived (waiting state)
}
const cb = p.getByText('✕ close').first();
if (await cb.count()) await cb.click().catch(() => {});
await p.evaluate(() => {
  for (const id of ['screens-dock', 'build-dock', 'mode-bar', 'vessel-stats'])
    for (const el of document.querySelectorAll(`[data-testid="${id}"]`))
      el.style.display = 'none';
});
await p.waitForTimeout(500);

const scores = [];
for (const eye of cfg.eyes) {
  await p.evaluate(([e, t]) => window.__ARCHEAN__.engine.auditLookAt(e, t), [eye, cfg.target]);
  await p.waitForTimeout(450);
  const s = await p.evaluate((nm) => {
    const eng = window.__ARCHEAN__.engine;
    const q = nm === 'invaders'
      ? eng.screenFeedQuads().find((v) => /^computer/.test(v.key))
      : { key: 'wall', corners: [
        [-1.5, -0.05, -1.15], [-1.5, -0.05, -0.35], [-1.5, -0.75, -0.35], [-1.5, -0.75, -1.15]] };
    const pts = q.corners.map((c) => eng.projectCanvas(...c));
    const us = pts.map((c) => c.u * 640), vs = pts.map((c) => c.v * 420);
    const x0 = Math.max(0, Math.min(...us)), x1 = Math.min(640, Math.max(...us));
    const y0 = Math.max(0, Math.min(...vs)), y1 = Math.min(420, Math.max(...vs));
    return { quad: { x0, y0, x1, y1 } };
  }, NAME);
  const q = s.quad;
  if (!q || q.x1 - q.x0 < 40 || q.y1 - q.y0 < 40) { scores.push({ eye, ink: 0, dark: 0, area: 0, seat: 0 }); continue; }
  const shot = await p.screenshot();
  // pixel stats over the quad region (PNG decode in the browser is awkward;
  // sample raw via a canvas round-trip in-page instead of decoding here)
  const stats = await p.evaluate(async ({ b64, box }) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/png;base64,' + b64; });
    const cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0);
    const d = cx.getImageData(Math.round(box.x0), Math.round(box.y0),
      Math.round(box.x1 - box.x0), Math.round(box.y1 - box.y0)).data;
    let ink = 0, dark = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = (d[i] + d[i + 1] + d[i + 2]) / 3;
      n++;
      if (l > 190) ink++;
      else if (l < 45) dark++;
    }
    return { ink: ink / n, dark: dark / n };
  }, { b64: shot.toString('base64'), box: q });
  // seat presence: project the PilotSeat (craft-specific), sample a disc
  const seat = await p.evaluate((nm) => {
    const eng = window.__ARCHEAN__.engine;
    const st = nm === 'mario' ? [-2.88, -0.55, 0.0] : [0, -0.62, 0.131];
    const pt = eng.projectCanvas(...st);
    if (!pt || pt.behind) return 0;
    return { x: pt.u * 640, y: pt.v * 420 };
  }, NAME);
  let seatScore = 0;
  if (seat && seat.x > 8 && seat.x < 632 && seat.y > 8 && seat.y < 412) {
    const disc = await p.evaluate(({ b64, x, y }) => {
      const img = new Image();
      return new Promise((res) => {
        img.onload = () => {
          const cv = document.createElement('canvas');
          cv.width = img.width; cv.height = img.height;
          const cx = cv.getContext('2d', { willReadFrequently: true });
          cx.drawImage(img, 0, 0);
          const d = cx.getImageData(Math.round(x - 14), Math.round(y - 14), 28, 28).data;
          let sum = 0, n = 0;
          for (let i = 0; i < d.length; i += 4) { sum += (d[i] + d[i + 1] + d[i + 2]) / 3; n++; }
          res(sum / n);
        };
        img.src = 'data:image/png;base64,' + b64;
      });
    }, { b64: shot.toString('base64'), x: seat.x, y: seat.y });
    seatScore = disc > 25 && disc < 200 ? 1 : 0.4;      // seat geometry, not sky
  }
  const area = Math.min(1, ((q.x1 - q.x0) * (q.y1 - q.y0)) / (640 * 300));
  scores.push({ eye, ...stats, area, seat: seatScore });
  console.log(`eye ${JSON.stringify(eye)}: ink=${stats.ink.toFixed(2)} dark=${stats.dark.toFixed(2)} area=${area.toFixed(2)} seat=${seatScore}`);
}
await b.close();
// score: for invaders, a real game image (ink+dark) at a decent size with
// the seat; for mario the title close-up is BRIGHT (sky-blue title screen).
const best = scores.reduce((a, s) => {
  // invaders (chair side, v1.13.11): the seat is BEHIND the camera there —
  // score the game image itself (ink + dark game background at area)
  const v = (s.ink + s.dark) * s.area + 0.5 * Math.min(s.dark, 0.5);
  return v > a.v ? { v, s } : a;
}, { v: -1, s: scores[0] });
console.log(`BEST ${NAME}: eye ${JSON.stringify(best.s.eye)} score ${best.v.toFixed(2)}`);
