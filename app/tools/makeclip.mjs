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
  // invaders: the readable side of the built-in display faces the PILOT
  // (+z) — every earlier take stood on the cabinet's NOSE side (-z), looking
  // at the panel through the bezel ("the screen is totally obstructed", then
  // "WRONG angle", we). The right shot is the player's own: OVER THE PILOT
  // SEAT's shoulder (seat at 0,-0.78,+0.13 in the foreground, the panel on
  // the cabinet's +z face nothing occludes) — and the double mirror (u-flip
  // × the +z viewing side) cancels, so the text reads true. Pan: slow dolly
  // left.
  invaders: {
    craft: '3288012440', dash: 'main#0',
    // A — front, low (we's pick), camtune-scored winner: the panel fills the
    // frame with real game ink and the seat in view — the player standing at
    // the cabinet. Slow lateral drift keeps the parallax alive.
    eye0: [0.25, 0.02, -1.62], eye1: [0.05, 0.02, -1.72], target: [0, -0.15, -1.12],
    captureSec: 26, winStart: 2, winLen: 11,   // intro: title rising → arrival → sprites
    gateCycles: 60,
  },
  // mario: the six-Screen wall at x=-1.5 (boards face -x), the PilotSeat at
  // x=-2.88 in front. THE GAME DOES NOT SELF-START (we: "supermario is not
  // started with spacebar, which it can only do after its done writing its
  // sprite cache"): the gate waits for the pump to be 10 s in with the
  // program's live vars present (cache written), then the clip PRESSES
  // SPACE ON THE SEAT — and plays: run right (D), jump (Space), run, jump.
  mario: {
    craft: '3820116990', dash: 'first-virtual',
    // we's pick: "extremely close to the title screen and then zooming out
    // and rotatin/rolling" — the camera starts 0.28 m off the six-screen
    // wall (the title fills the frame), holds with a life-drift while the
    // seat presses START, and from the PLAYING moment dollies out to the
    // wall+seat wide shot with a ±14° dutch-roll that settles level.
    playCam: {
      // eyeNear = camtune's wall-close winner (0.22 m off the six-screen
      // wall). The wall is attract-off DARK through the title/menu/build
      // presses — it IGNITES into the level at the PLAYING moment, and the
      // camera pulls out to the wall+seat wide shot with the dutch roll.
      eyeNear: [-1.72, -0.4, -0.75], eyeFar: [-2.9, 0.0, 0.9],
      target: [-1.52, -0.42, -0.72], rollMax: 0.24, rampSec: 8,
    },
    eye0: [-1.72, -0.4, -0.75], eye1: [-2.9, 0.0, 0.9], target: [-1.52, -0.42, -0.72],
    captureSec: 90, winStart: 0, winLen: 999,   // the take self-ends 10 s into play
    gateCycles: 60, gateVar: 'assetsready', gateEq: '1',  // the sprite cache is written
    // the seat's presses: JUMP(Space) on the title (mode 0→1 menu), JUMP on
    // the menu (→ new_game, mode 2 BUILDING CACHED LEVEL), then once mode 3
    // (PLAYING) is live, run+jump. playKeys fire at an OFFSET from the
    // observed mode-3 moment (dynamic — the cached-level build varies).
    keys: [
      { t: 1.0, code: 'Space', mode: 'tap' },
      { t: 3.0, code: 'Space', mode: 'tap' },
    ],
    pollVar: 'mode',
    playKeys: [
      { t: 1.5, code: 'KeyD', mode: 'down' },
      { t: 2.8, code: 'Space', mode: 'tap' },   // JUMP running right
      { t: 3.6, code: 'KeyD', mode: 'up' },
      { t: 4.6, code: 'KeyD', mode: 'down' },
      { t: 5.6, code: 'Space', mode: 'tap' },   // JUMP 2
      { t: 6.4, code: 'KeyA', mode: 'down' },
      { t: 7.2, code: 'KeyD', mode: 'up' },
      { t: 7.6, code: 'Space', mode: 'tap' },   // JUMP back
      { t: 8.4, code: 'KeyA', mode: 'up' },
    ],
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

// GATE: the pump is in deep (cycles) AND, for mario, the program's live
// vars exist — the sprite cache is written, so the SEAT's Space press lands
// on a game that can start (we: "it can only do [start] after its done
// writing its sprite cache").
const gateT0 = Date.now();
for (;;) {
  const st = await page.evaluate(() => {
    const x = window.__XENON__?.() ?? {};
    return { cycles: x.cycles ?? 0, vars: typeof x.vars === 'function' ? x.vars() : {} };
  });
  const varOk = !spec.gateVar
    || (spec.gateEq !== undefined ? String(st.vars[spec.gateVar]) === spec.gateEq
                                  : st.vars[spec.gateVar] !== undefined);
  if (st.cycles >= (spec.gateCycles ?? 60) && varOk) {
    console.log(`[clip:${NAME}] gate open at ${((Date.now() - gateT0) / 1000).toFixed(1)}s `
      + `(cycles ${st.cycles}${spec.gateVar ? ` ${spec.gateVar}=${st.vars[spec.gateVar]}` : ''})`);
    break;
  }
  if (Date.now() - gateT0 > 120_000) { console.log('[clip] gate timeout — capturing anyway'); break; }
  await new Promise(r => setTimeout(r, 1000));
}

const N = spec.captureSec * 5;
const t0 = Date.now();
const keys = [...(spec.keys ?? [])];
let ki = 0;
let playT = null;              // the observed mode-3 (PLAYING) moment
let modeSeen = '';
let clipEnd = spec.captureSec; // playCam takes self-end after the ramp
let target = spec.target;
console.log(`[clip:${NAME}] capturing ${N} frames (${spec.captureSec}s)` +
  (keys.length ? ` + ${keys.length} scripted seat presses` : ''));
for (let i = 0; i < N; i++) {
  const elapsed = (Date.now() - t0) / 1000;
  // live-var poll: when the program reports PLAYING, arm the play moves at
  // offsets from that moment and schedule the clip's end after them
  if (spec.pollVar && playT === null) {
    const v = await page.evaluate((pv) => {
      const x = window.__XENON__?.() ?? {};
      return typeof x.vars === 'function' ? String(x.vars()[pv] ?? '') : '';
    }, spec.pollVar);
    if (v !== modeSeen) { modeSeen = v; console.log(`[clip:${NAME}] mode=${v} @${elapsed.toFixed(1)}s`); }
    if (v === (spec.playEq ?? '3')) {
      playT = elapsed;
      console.log(`[clip:${NAME}] ${spec.pollVar}=3 (PLAYING) at +${playT.toFixed(1)}s — arming play moves`);
      for (const pk of spec.playKeys ?? []) keys.push({ t: playT + pk.t, code: pk.code, mode: pk.mode });
      keys.sort((a, b) => a.t - b.t);
      clipEnd = playT + 10;                       // end the take 10 s into play
    }
  }
  if (playT !== null && elapsed > clipEnd) break;
  while (ki < keys.length && keys[ki].t <= elapsed) {
    const k = keys[ki++];
    console.log(`[clip:${NAME}] +${k.t.toFixed(1)}s ${k.code} ${k.mode}`);
    if (k.mode === 'tap') {
      // a real press: the VM samples inputs on its 25 Hz cycle — a
      // keyboard.press (sub-frame) lands BETWEEN cycles and the program
      // never sees the edge (learned the hard way: mode never moved)
      await page.keyboard.down(k.code);
      await new Promise(r => setTimeout(r, 150));
      await page.keyboard.up(k.code);
    } else if (k.mode === 'down') {
      await page.keyboard.down(k.code);
    } else {
      await page.keyboard.up(k.code);
    }
  }
  // camera: playCam (title close-up → dolly-out + dutch roll from the
  // PLAYING moment) when the spec has one, else a linear eye0→eye1 pan
  let eye, roll = 0;
  if (spec.playCam) {
    const pc = spec.playCam;
    if (playT === null) {
      eye = pc.eyeNear.map((v, a) => v + Math.sin(elapsed * 0.55 + a * 2.1) * 0.012);
    } else {
      const s = Math.min(1, (elapsed - playT) / pc.rampSec);
      const ez = s * s * (3 - 2 * s);
      eye = pc.eyeNear.map((v, a) => v + (pc.eyeFar[a] - v) * ez);
      roll = pc.rollMax * Math.sin(Math.PI * s);
    }
    target = spec.playCam.target;
  } else {
    const k = i / (N - 1);
    eye = spec.eye0.map((v, a) => v + (spec.eye1[a] - v) * k);
  }
  await page.evaluate(([e, c, r]) => window.__ARCHEAN__.engine.auditLookAt(e, c, r), [eye, target, roll]);
  const due = t0 + i * 200 - Date.now();
  if (due > 0) await new Promise(r => setTimeout(r, due));
  await page.screenshot({ path: `${DIR}/frames/f${String(i).padStart(3, '0')}.png` });
}
// after the take: report the program vars (did the SEAT press start it?)
const endVars = await page.evaluate((gv) => {
  const x = window.__XENON__?.() ?? {};
  const vars = typeof x.vars === 'function' ? x.vars() : {};
  return gv ? { k: gv, v: vars[gv] } : { cycles: x.cycles };
}, spec.gateVar ?? null);
console.log(`[clip:${NAME}] end state: ${JSON.stringify(endVars)}`);
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
