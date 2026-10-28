// makeclip.mjs — record the PLAYABLE gallery clips as small WEBMs (< 250 KiB
// target, we's spec 2026-10-28: "a small webm for each of them, < 250 KiB
// should do" — the GIF idea blew its size budget AND /tmp). A cinematic
// capture of each game running INSIDE its craft: oblique view, the pilot
// seat in the frame, a slow lateral pan so it reads as a live simulation,
// low-res 5 fps ("don't make the res too high, and 5 fps is sufficient").
//
//   mario    — the title loads, then the game AUTOPLAYS itself (the
//              program's attract mode: `titleclock > 8 → $demo = 1`)
//   invaders — the title RISES from mid-screen + the invader row lights up
//
// The camera flies through Engine.auditLookAt (test-only seam); app overlays
// are hidden for the shot; frames go to a bounded /tmp dir that this tool
// DELETES on exit; ffmpeg does a 2-pass vp8 webm. Output: public/games/
// <name>.webm (the gallery PLAYABLE row + the README).
//
//   node tools/makeclip.mjs mario|invaders [base-url]    (run from app/)
import { chromium } from '@playwright/test';
import { mkdirSync, rmSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const NAME = process.argv[2];
const URL = process.argv[3] ?? 'http://127.0.0.1:5175';
const SPECS = {
  // invaders: the Computer's built-in display at (0,-0.15,-1.12) (front
  // normal -z), the PilotSeat behind it at (0,-0.78,+0.13): the camera sits
  // front-left-above, the seat peeks past the cabinet = depth. Pan: +x drift.
  invaders: {
    craft: '3288012440', dash: 'main#0',
    eye0: [-1.25, 0.5, -2.55], eye1: [-0.55, 0.5, -2.85], target: [0, -0.34, -0.55],
    captureSec: 26, winStart: 2, winLen: 11,   // intro: title rising → arrival → sprites
  },
  // mario: the six-Screen wall at x=-1.5, the PilotSeat at x=-2.88 in front
  // of it: the camera looks over the seat's shoulder at the wall. Pan: +x/+z.
  mario: {
    craft: '3820116990', dash: 'first-virtual',
    eye0: [-4.75, 0.85, 1.75], eye1: [-4.05, 0.85, 2.35], target: [-2.0, -0.55, -0.15],
    captureSec: 30, winStart: 3, winLen: 13,   // title → the demo takes over
  },
};
const spec = SPECS[NAME];
if (!spec) { console.error('usage: node tools/makeclip.mjs mario|invaders [url]'); process.exit(2); }

const OUT = join('public', 'games');
const DIR = `/tmp/opencode/clip-${NAME}`;
rmSync(DIR, { recursive: true, force: true });
mkdirSync(`${DIR}/frames`, { recursive: true });
mkdirSync(`${DIR}/win`, { recursive: true });
mkdirSync(OUT, { recursive: true });

const cleanup = () => rmSync(DIR, { recursive: true, force: true });
process.on('exit', cleanup);

const ctx = await chromium.launch({
  headless: true,
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=vulkan'],
});
const page = await ctx.newPage();
await page.setViewportSize({ width: 640, height: 420 });   // low-res per spec
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 160)));
await page.addInitScript(() => {
  localStorage.setItem('archean-app-debug', '1');
  localStorage.setItem('archean-app-backdrop', 'none');   // flat sky: clean frame
  localStorage.setItem('archean-app-ortho', '0');
});
console.log(`[clip:${NAME}] booting ${spec.craft} (dash=${spec.dash})`);
await page.goto(`${URL}/?craft=${spec.craft}&dash=${encodeURIComponent(spec.dash)}`,
  { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => /SCENE PASS/.test(document.title), null, { timeout: 120_000 });
await page.waitForFunction(() => (window.__XENON__?.() ?? {}).status === 'running', null, { timeout: 120_000 });
console.log(`[clip:${NAME}] VM running — closing the zoom window, hiding the UI`);
const closeBtn = page.getByText('✕ close').first();
if (await closeBtn.count()) await closeBtn.click({ timeout: 10_000 }).catch(() => {});
await page.waitForTimeout(600);
await page.evaluate(() => {
  const ids = ['screens-dock', 'build-dock', 'mode-bar', 'vessel-stats', 'stats-strip',
    'coord-chip', 'wire-chip', 'massbox', 'cam-cluster', 'tooltab', 'playable'];
  for (const id of ids)
    for (const el of document.querySelectorAll(`[data-testid="${id}"],[id="${id}"]`))
      el.style.setProperty('display', 'none', 'important');
  for (const el of document.querySelectorAll('[data-testid$="-overlay"]'))
    el.style.setProperty('display', 'none', 'important');
});
await page.waitForTimeout(800);

const N = spec.captureSec * 5;
const t0 = Date.now();
console.log(`[clip:${NAME}] capturing ${N} frames (${spec.captureSec}s)`);
for (let i = 0; i < N; i++) {
  const k = i / (N - 1);
  const eye = spec.eye0.map((v, a) => v + (spec.eye1[a] - v) * k);
  await page.evaluate(([e, c]) => window.__ARCHEAN__.engine.auditLookAt(e, c), [eye, spec.target]);
  const due = t0 + i * 200 - Date.now();
  if (due > 0) await new Promise(r => setTimeout(r, due));
  await page.screenshot({ path: `${DIR}/frames/f${String(i).padStart(3, '0')}.png` });
}
await ctx.close();

const frames = readdirSync(`${DIR}/frames`).filter(f => f.endsWith('.png')).sort();
const s = spec.winStart * 5, e = Math.min(frames.length, (spec.winStart + spec.winLen) * 5);
for (let i = s; i < e; i++) copyFileSync(`${DIR}/frames/${frames[i]}`, `${DIR}/win/w${String(i - s).padStart(3, '0')}.png`);
const gif = join(OUT, `${NAME}.webm`);
execFileSync('ffmpeg', ['-y', '-framerate', '5', '-i', `${DIR}/win/w%03d.png`,
  '-vf', 'scale=480:-2:flags=lanczos', '-c:v', 'libvpx', '-crf', '14',
  '-b:v', '90k', '-maxrate', '140k', '-bufsize', '280k', '-an', '-auto-alt-ref', '0', gif],
  { stdio: 'pipe' });
const kb = Math.round(statSync(gif).size / 1024);
console.log(`[clip:${NAME}] wrote ${gif} (${kb} KiB, ${e - s} frames = ${((e - s) / 5).toFixed(0)}s @ 5fps)`);
cleanup();
