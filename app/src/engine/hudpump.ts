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
// THE RUNTIME OWNER: the shim is ONE interpreter (see runtimemgr.ts) — the
// HUD pump and the computer pump take turns on the module; opening one
// closes the other. The farm (slice C) lifts this.
import { XenonRun, CYCLE_MS, type XenonComputer, type XenonHud } from './xenoncode';
import { beaconNet } from './beaconnet';
import { claimRuntime, releaseRuntime } from './runtimemgr';
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

export interface HudSurface { key: string; w: number; h: number; anchor: number }

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
    claimRuntime({ name: 'hud', kill: () => this.close() });
    const comp: XenonComputer = {
      ci: hud.ci, alias: hud.alias, program: 'hud',
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
    this.beaconIdx = [];
    this.surfaces = [];
    this.t0 = Date.now();
    if (run.error) { this.stop(); this.notify(); return; }
    this.timer = setInterval(() => this.tick(), CYCLE_MS);
    this.notify();
  }

  private tick(): void {
    const run = this.run, hud = this.hud;
    if (!run || !hud || !this.running) return;
    // AVATARSIM feed: the avatar_sensor_* rows at t → the get() pool
    const t = (Date.now() - this.t0) / 1000;
    for (const r of AVATARSIM_ROWS) {
      const c = wsEnsure(r.key, r.label, 'sensor', r.def);
      try { run.setWorld(r.key, String(evalExpr(c.base, t))); } catch { /* keep last */ }
    }
    // the player viewport + pointer (homo: `if fov < 1`, mouse_y)
    run.setView(window.innerWidth, window.innerHeight, this.mouse.x, this.mouse.y, 1, this.mouse.look);
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
    // HUD panels: the panel#N surfaces, with anchors for the canvas layout
    this.surfaces = run.screenMeta()
      .filter(m => m.key.startsWith('panel#'))
      .map(m => ({ key: m.key, w: m.w, h: m.h, anchor: run.screenAnchor(m.key) }));
    if (run.error) { this.error = run.error; this.stop(); }
    this.cycles++;
    this.notify();
  }

  pixels(key: string): Uint8ClampedArray | null {
    return this.run?.screenPixels(key) ?? null;
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
    this.running = false;
    this.hud = null;
    this.surfaces = [];
  }
  close(): void {
    this.stop();
    releaseRuntime('hud');
    this.error = '';
    this.cycles = 0;
    this.prints = [];
    this.notify();
  }
}

/** THE HUD runtime singleton (one panel of radios at a time — farm in C). */
export const hudPump = new HudPump();
