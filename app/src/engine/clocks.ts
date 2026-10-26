// ---------- P7.2: the interaction clocks (docs/TEST-PYRAMID.md Phase 2) ----------
// The timestamp-driven state machines that used to live in Viewport.tsx as
// refs + setTimeout pairs. Their contracts (the ~40 Hz raycast cap with a
// TRAILING edge, the 120 ms cable-label dwell, the 2 s X-ray dwell) were
// pinned in e2e against WALL CLOCK — the flake surface this module exists
// to kill. Everything here is pure: the clock (`now`) and the scheduler
// (ms → callback → cancel) are INJECTED, so vitest pins the contracts on a
// synthetic clock, and Viewport only forwards DOM events into these.

/** injectable clock (performance.now in the browser, a counter in tests) */
export type Clock = () => number;
/** schedule cb after ms; the return value CANCELS it */
export type Scheduler = (ms: number, cb: () => void) => () => void;

/** the browser wiring Viewport injects */
export const realScheduler: Scheduler = (ms, cb) => {
  const t = setTimeout(cb, ms);
  return () => clearTimeout(t);
};

/**
 * Leading + TRAILING rate cap (the coord-readout / cable-pick throttle,
 * v1.9.2): at most one `run` per `interval`, AND the position the pointer
 * STOPS at always gets its raycast (a hover that stops mid-window must
 * still converge — the views.spec 'hovering the CRAFT' pin's contract).
 * `leading` mode with trailing=false reproduces the ghost's plain 40 Hz
 * cap (blockHover: sweeps drop, a force=true re-aim bypasses).
 */
export class RateCap {
  private last = -Infinity;
  private trail: (() => void) | null = null;
  private lastPos = { x: 0, y: 0 };
  private trailing: boolean;
  interval: number;
  constructor(
    interval: number,
    run: (x: number, y: number) => void,
    now: Clock,
    schedule: Scheduler,
    trailing = true,
  ) {
    this.interval = interval;
    this.run = run; this.now = now; this.schedule = schedule; this.trailing = trailing;
  }
  private run: (x: number, y: number) => void;
  private now: Clock;
  private schedule: Scheduler;
  move(x: number, y: number): void {
    this.lastPos = { x, y };
    const t = this.now();
    if (t - this.last >= this.interval) {
      this.cancelTrail();
      this.last = t;
      this.run(x, y);
    } else if (this.trailing && !this.trail) {
      // the literal Viewport law: the check is >= interval, the trailing
      // fires at interval+1 so it never lands exactly ON the boundary
      this.trail = this.schedule(Math.max(1, this.interval + 1 - (t - this.last)), () => {
        this.trail = null;
        this.last = this.now();
        this.run(this.lastPos.x, this.lastPos.y);
      });
    }
  }
  /** a re-aim that must not be dropped (Shift press/release re-aims the ghost) */
  force(x: number, y: number): void {
    this.cancelTrail();
    this.last = this.now();
    this.run(x, y);
  }
  cancel(): void { this.cancelTrail(); }
  private cancelTrail(): void {
    if (this.trail) { this.trail(); this.trail = null; }
  }
}

/** the side-effects the cable-hover machine drives (Viewport supplies them
 *  over engineRef.current, so a scene reload under a live hover is safe) */
export interface WireHoverFx {
  /** engine.pipeHoverState(): the LIVE pick under the cursor right now */
  live: () => { pi: number; label: string } | null;
  showChip: (label: string) => void;
  hideChip: () => void;
  beginXray: (pi: number) => void;
  endXray: () => void;
}

/**
 * The cable-hover state machine (v1.10.1/v1.11): a cable must hold the
 * cursor `dwellMs` before its label appears (sweeps stay quiet), and
 * `xrayMs` of SOLID highlight on ONE cable opens the X-ray episode
 * (engine.beginWireXray), restored the moment the hover ends. The timers
 * read the LIVE pick when they FIRE (label/`pi` may have moved since the
 * arm; a pi that no longer matches never opens X-ray).
 */
export class WireHover {
  private shown = false;
  private dwell: (() => void) | null = null;
  private xray: (() => void) | null = null;
  private xrayPi = -1;
  private curLabel = '';
  private fx: WireHoverFx;
  private schedule: Scheduler;
  private dwellMs: number;
  private xrayMs: number;
  constructor(fx: WireHoverFx, schedule: Scheduler, dwellMs = 120, xrayMs = 2000) {
    this.fx = fx; this.schedule = schedule; this.dwellMs = dwellMs; this.xrayMs = xrayMs;
  }
  /** the chip is up: every pointermove repaints its position with this label */
  get label(): string { return this.curLabel; }
  get chipShown(): boolean { return this.shown; }
  /** called from the throttled pick pass with the pipeHoverMove result */
  hover(info: { pi: number; label: string } | null): void {
    if (!info || !info.label) { this.reset(); return; }
    this.curLabel = info.label;
    if (!this.shown && !this.dwell) {
      this.dwell = this.schedule(this.dwellMs, () => {
        this.dwell = null;
        const w = this.fx.live();
        if (w?.label) { this.shown = true; this.curLabel = w.label; this.fx.showChip(w.label); }
      });
    } else if (this.shown) {
      this.fx.showChip(info.label);
    }
    if (info.pi !== this.xrayPi) {
      this.xrayPi = info.pi;
      this.fx.endXray();
      if (this.xray) this.xray();
      const pi = info.pi;
      this.xray = this.schedule(this.xrayMs, () => {
        this.xray = null;
        const w = this.fx.live();
        if (w && w.pi === pi) this.fx.beginXray(pi);
      });
    }
  }
  /** the hover ended (showWire(null) / pointerleave): full reset, X-ray closes */
  reset(): void {
    if (this.dwell) { this.dwell(); this.dwell = null; }
    if (this.xray) { this.xray(); this.xray = null; }
    if (this.xrayPi >= 0) { this.xrayPi = -1; this.fx.endXray(); }
    this.shown = false;
    this.curLabel = '';
    this.fx.hideChip();
  }
}

/**
 * The coord chip's text law (v1.5.23/24): full snapped `x y z`, the
 * decimals follow the grid rung (sub-0.25 m steps read to 2 places), and
 * −0 never prints as −0. The views.spec chip pins re-cut to this pure
 * function; e2e keeps "the chip shows over the canvas" as the pixel law.
 */
export function coordChipText(info: { x: number; y: number; z: number; step: number }): string {
  const dg = info.step < 0.25 ? 2 : 1;
  const f = (v: number) => (Object.is(v, -0) ? 0 : v).toFixed(dg);
  return `x ${f(info.x)}  y ${f(info.y)}  z ${f(info.z)}`;
}
