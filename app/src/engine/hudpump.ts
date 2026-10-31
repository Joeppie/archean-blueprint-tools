// hudpump.ts — THE HUD RUNTIME (v1.14.1 P9 slice B; REWRITE § P9).
//
// A HudController's .xc runs on the SAME XenonCode VM as a computer: the
// ABI-11 shim carries its HUD builtins (panel(anchor,w,h) → "panel#N"
// surfaces with anchors, beacon($tx,$rx) + .data + .transmit, get(key),
// the screen_w/mouse_*/fov values). The pump's loop feeds, per cycle:
//   • AVATARSIM — the avatar_sensor_* worldsim rows evaluated at t →
//     xc_set_world (the program's get() pool; FORMAT §Player-installed
//     HUDs, the "homo" HUD's read law),
//   • the player viewport + pointer → xc_set_view,
//   • beaconNet deliveries → xc_beacon_put (.data on the paired object),
// and drains the cycle's events: beaconpair registers the HUD's radios in
// the GLOBAL scope (the BEACONS tab), beacontx posts onto beaconNet — so a
// HUD transmit reaches a Beacon COMPONENT's io channel (slice D) and any
// other listener of that frequency, the RCS500 demo end to end.
//
// THE RUNTIME (slice C): every VM is its own wasm instance (co-run) — the
// HUD pump and the computer farm share the craft's beaconNet/io state,
// not an interpreter.
import { XenonRun, CYCLE_MS, TURBO_X, type XenonComputer, type XenonHud,
  type XenonVar } from './xenoncode';
import { beaconNet } from './beaconnet';
import { wsEnsure, evalExpr } from './worldsim';

/** The a HUD's get() reads of the PLAYER (homo HUD): speed m/s, terrain
 *  altitude, absolute (sea datum 6 203 000 m). Worldsim sensor rows —
 *  hudPump ENSURES them each tick (the get() pool exists with no panel
 *  mounted), and the BEACONS tab renders the same rows (avatarsim). */
export const AVATARSIM_ROWS = [
  { key: 'avatar_sensor_speed', label: 'Avatar · speed (m/s)', def: '80' },
  { key: 'avatar_sensor_altitude', label: 'Avatar · terrain altitude (m)', def: '2000' },
  { key: 'avatar_sensor_altitude_absolute', label: 'Avatar · absolute altitude (m)', def: '6205000' },
] as const;

export interface HudSurface {
  key: string; w: number; h: number; anchor: number;
  /** ABI 14: set_position px/py + the flag (until set, the panel rides
   *  its ANCHOR layout on the composited SCREEN window). */
  px: number; py: number; pos: boolean;
}

/** THE HUD SCREEN (v1.15.5, we: "Panels in Huds are rendered
 *  independently.. not how they normally work. They should be composed
 *  together on a normal screen as per the rules of the game… a Panels and
 *  Screen window, which composes together the panels (respecting alpha,
 *  like the real thing)"): the game renders the HUD as ONE overlay on the
 *  PLAYER SCREEN — panels ride their anchor/set_position in screen pixels,
 *  alpha-composited; the player's screen resolution (and the UI-Scaling
 *  setting, wiki hud.md) feeds the program's screen_w/screen_h. We
 *  simulate that screen: a chosen W×H, fed through xc_set_view every
 *  cycle; applying a new size REBOOTS the runtime (the game's restart on
 *  resolution change) so anchor-driven layouts recompute. */
export const HUD_VIEW_PRESETS = [
  { w: 1280, h: 720 }, { w: 1366, h: 768 }, { w: 1920, h: 1080 }, { w: 2560, h: 1440 },
];
const LS_HUD_VIEW = 'archean-…view';

/** The panel(anchor,..) word constants (xc_host alignment bits) → labels. */
export const ANCHOR_LABELS: Record<number, string> = {
  5: 'top-left', 4: 'top', 6: 'top-right', 1: 'left', 16: 'center',
  2: 'right', 9: 'bottom-left', 8: 'bottom', 10: 'bottom-right',
};

class HudPump {
  hud: XenonHud | null = null;
  running = false;
  error = '';
  cycles = 0;
  prints: string[] = [];
  surfaces: HudSurface[] = [];
  version = 0;
  private run: XenonRun | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private t0 = 0;
  private beaconIdx: number[] = [];
  private mouse = { x: 0, y: 0, look: 0 };
  /** THE HUD SCREEN size (the simulated player screen; localStorage
   *  persisted, 1920×1080 default — see HUD_VIEW_PRESETS doc). */
  view = (() => {
    try {
      const v = JSON.parse(localStorage.getItem(LS_HUD_VIEW) || 'null');
      if (v && v.w >= 320 && v.h >= 240) return { w: v.w | 0, h: v.h | 0 };
    } catch { /* default */ }
    return { w: 1920, h: 1080 };
  })();
  /** Apply a new player-screen size. While running this REBOOTS the HUD
   *  (the game restarts the HUD on resolution change — programs lay out
   *  on screen_w/screen_h at boot, the wiki's guide/HUDs do). */
  setViewSize(w: number, h: number): void {
    w = Math.max(320, Math.min(7680, w | 0)); h = Math.max(240, Math.min(4320, h | 0));
    if (w === this.view.w && h === this.view.h) return;
    this.view = { w, h };
    try { localStorage.setItem(LS_HUD_VIEW, JSON.stringify(this.view)); } catch { /* private */ }
    if (this.running && this.hud) void this.open(this.hud);   // restart law
    else this.notify();
  }
  private listeners = new Set<() => void>();

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }
  private notify(): void {
    this.version++;
    for (const cb of this.listeners) cb();
  }

  /** Boot (or re-boot after a save — the F5 law, same as a computer). */
  async open(hud: XenonHud): Promise<void> {
    this.stop();
    const comp: XenonComputer = {
      ci: hud.ci, alias: hud.alias, program: 'hud',
      // v1.15.2 law made LIVE (and the v1.16.13 set_cps gate): the HUD pump
      // STAMPS its VM instance — HUD-only builtins (screen_w/screen_h as
      // the player viewport, set_cps's cadence recording) gate on it;
      // computers never call it.
      hudRuntime: true,
      files: hud.files.map(f => ({ ...f })),
      entryName: 'main.xc', capacity: 8192, channels: [], screens: [], devices: [],
    };
    const run = await XenonRun.open(comp);
    this.run = run;
    this.hud = hud;
    this.running = run.running;
    this.error = run.error;
    this.cycles = 0;
    this.prints = [];
    this.vars = [];
    this.beaconIdx = [];
    this.surfaces = [];
    this.t0 = Date.now();
    if (run.error) { this.stop(); this.notify(); return; }
    this.arm();
    this.notify();
  }

  /** v1.16.13 THE HUD CADENCE LAW (the user: "setCPS in HUDS lets code
   *  change its actual interval, but this is done in its init. We should
   *  support that way of doing it. We cannot preparse the init, because it
   *  can actually run and should run in the same scope"): the pump's
   *  interval follows the PROGRAM's set_cps(n) (wiki hud.md) read live
   *  after every cycle — init RUNS as a cycle, so the cadence adapts the
   *  moment the call executes: no pre-parse, same scope, the program owns
   *  its rate. 0 = unset → the 25 Hz CYCLE_MS law; TURBO multiplies on top
   *  of the program's own rate; older wasm (no xc_hud_cps) = 0 → 25 Hz. */
  private timerMs = 0;
  /** AUDIT SEAM (v1.16.13): the interval the pump currently runs
   *  (40 = the 25 Hz law; 1000/n after the program's set_cps(n)). */
  cadenceMs(): number { return this.timerMs; }
  private arm(): void {
    const cps = this.run?.hudCps() ?? 0;
    const ms = Math.max(4, (cps > 0 ? 1000 / cps : CYCLE_MS) / (this.turbo ? TURBO_X : 1));
    if (this.timer && ms === this.timerMs) return;
    if (this.timer) clearInterval(this.timer);
    this.timerMs = ms;
    this.timer = setInterval(() => this.tick(), ms);
  }

  /** v1.16.13 TURBO (the user: "runs at 4x speed temporarily … debugging
   *  easier and even our tests could run faster") — the HUD pump's cadence
   *  only, the program's virtual dt stays 40 ms: the HUD's clock advances
   *  4× per real second. Session-only. (The HUD pump runs the SAME 25 Hz
   *  law as computers — the game drives HUDs at its frame rate; the
   *  program itself cannot set the frequency, so the editor owns turbo.) */
  turbo = false;
  setTurbo(on: boolean) {
    if (this.turbo === on) return;
    this.turbo = on;
    if (this.timer) { clearInterval(this.timer); this.timer = null; this.timerMs = 0; }
    if (this.running) this.arm();
    this.notify();
  }

  private tick(): void {
    const run = this.run, hud = this.hud;
    if (!run || !hud || !this.running) return;
    this.arm();   // v1.16.13: follow the program's set_cps (init runs as a cycle)
    // AVATARSIM feed: the avatar_sensor_* rows at t → the get() pool
    const t = (Date.now() - this.t0) / 1000;
    for (const r of AVATARSIM_ROWS) {
      const c = wsEnsure(r.key, r.label, 'sensor', r.def);
      try { run.setWorld(r.key, String(evalExpr(c.base, t))); } catch { /* keep last */ }
    }
    // the player viewport + pointer (homo: `if fov < 1`, mouse_y) — THE
    // HUD SCREEN size (see HUD_VIEW_PRESETS): the program's screen_w/
    // screen_h are the chosen simulated player screen, not the browser.
    run.setView(this.view.w, this.view.h, this.mouse.x, this.mouse.y, 1, this.mouse.look);
    // beacon deliveries: what the paired frequencies RECEIVED → .data
    for (const i of this.beaconIdx) {
      const q = beaconNet.takePending(`hud:${hud.ci}#${i}`);
      const last = q[q.length - 1];
      if (last !== undefined) run.beaconPut(i, last);
    }
    const step = run.cycle();
    for (const e of step.evs) {
      if (e.e === 'beaconpair' && typeof e.i === 'number') {
        this.beaconIdx.push(e.i);
        beaconNet.registerPair(`hud:${hud.ci}#${e.i}`,
          `HUD ${hud.alias} · beacon`, 'hud', hud.ci,
          String(e.tx ?? ''), String(e.rx ?? ''));
      } else if (e.e === 'beacontx' && typeof e.i === 'number') {
        beaconNet.post(`hud:${hud.ci}#${e.i}`, String(e.d ?? ''));
      } else if (e.e === 'print') {
        this.prints = [...this.prints.slice(-60), String(e.v ?? '')];
      }
    }
    // HUD panels: the panel#N surfaces, with anchors + set_position for
    // the canvas layout AND the composited SCREEN window
    this.surfaces = run.screenMeta().filter(m => m.key.startsWith('panel#')).map(m => {
      const [px, py, pos] = run.screenPos(m.key);
      return { key: m.key, w: m.w, h: m.h, anchor: run.screenAnchor(m.key), px, py, pos };
    });
    // v1.16.14: the live globals snapshot (the HUD IDE's Vars tab — we:
    // "variables is missing from HUD code!")
    this.vars = run.vars();
    if (run.error) { this.error = run.error; this.stop(); }
    this.cycles++;
    this.notify();
  }

  /** ABI 15 XENON-SCREEN-VERSION (HUD twin): a panel whose write counter is
   *  unchanged returns the CACHED array — the canvas blit skips the heap
   *  copy; -1 (older wasm) fetches every cycle (the pre-v1.16.8 law). */
  /** live program globals (the XENON-VARS dump — the HUD IDE's Vars tab) */
  vars: XenonVar[] = [];
  private surfVer = new Map<string, { v: number; px: Uint8ClampedArray }>();
  pixels(key: string): Uint8ClampedArray | null {
    const r = this.run;
    if (!r) return null;
    const v = r.screenVersion(key);
    if (v >= 0) {
      const c = this.surfVer.get(key);
      if (c && c.v === v) return c.px;
    }
    const px = r.screenPixels(key);
    if (px && v >= 0) this.surfVer.set(key, { v, px });
    return px;
  }
  setMouse(x: number, y: number, look?: number): void {
    this.mouse = { x, y, look: look ?? this.mouse.look };
  }
  /** A canvas click on a panel (pixel coords) — button_rect evaluates it
   *  THIS cycle (the game law, xc_screen_click). */
  click(key: string, x: number, y: number): void { this.run?.screenClick(key, x, y); }

  private stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.run?.stop();
    this.run = null;
    this.surfVer.clear();
    this.running = false;
    this.hud = null;
    this.surfaces = [];
  }
  close(): void {
    this.stop();
    this.error = '';
    this.cycles = 0;
    this.prints = [];
    this.notify();
  }
}

/** THE HUD runtime singleton (one panel of radios at a time — farm in C). */
export const hudPump = new HudPump();
