// P7.2 (docs/TEST-PYRAMID.md): the interaction-clock contracts, pinned on a
// SYNTHETIC clock. These are the laws that e2e used to chase with wall
// clock (wire.spec dwells, the views.spec trailing-edge convergence) — the
// e2e tier keeps one thin "pointermove reaches the seam" leg per family.
import { describe, expect, test } from 'vitest';
import { RateCap, WireHover, coordChipText, type Scheduler } from '../clocks';

/** a clock whose time only moves when the test says so; jobs fire in time
 *  order, and jobs an fired job arms can fire in the same advance() */
class Fake {
  t = 0;
  private seq = 0;
  private jobs = new Map<number, { at: number; cb: () => void }>();
  now = () => this.t;
  schedule: Scheduler = (ms, cb) => {
    const id = ++this.seq;
    this.jobs.set(id, { at: this.t + ms, cb });
    return () => { this.jobs.delete(id); };
  };
  advance(to: number): void {
    for (;;) {
      let hit: { id: number; at: number; cb: () => void } | null = null;
      for (const [id, j] of this.jobs)
        if (j.at <= to && (hit === null || j.at < hit.at)) hit = { id, ...j };
      if (!hit) break;
      this.jobs.delete(hit.id);
      this.t = Math.max(this.t, hit.at);
      hit.cb();
    }
    this.t = to;
  }
  get pending(): number { return this.jobs.size; }
}

describe('RateCap — the ~40 Hz throttle with a TRAILING edge', () => {
  test('a burst runs ONCE (leading) and the STOP position always converges (trailing)', () => {
    const f = new Fake();
    const runs: [number, number][] = [];
    const cap = new RateCap(24, (x, y) => runs.push([x, y]), f.now, f.schedule);
    // 120 Hz mouse: moves at t = 0, 8, 16 … 40, ending at (50, 60)
    for (let i = 0; i <= 5; i++) { f.advance(i * 8); cap.move(i * 10, i * 12); }
    // t=24 has ELAPSED the interval → a second leading run; mid-window drops
    expect(runs).toEqual([[0, 0], [30, 36]]);          // t=8,16 and t=32,40 dropped
    expect(f.pending).toBe(1);                         // t=40 armed a trailing
    f.advance(400);
    expect(runs).toEqual([[0, 0], [30, 36], [50, 60]]); // the STOP position ran
    expect(f.pending).toBe(0);
  });

  test('moves spaced beyond the interval all run; no trailing is armed', () => {
    const f = new Fake();
    const runs: number[] = [];
    const cap = new RateCap(24, (x) => runs.push(x), f.now, f.schedule);
    for (let i = 0; i < 4; i++) { f.advance(i * 30); cap.move(i, 0); }
    expect(runs).toEqual([0, 1, 2, 3]);
    expect(f.pending).toBe(0);
  });

  test('force bypasses the cap and cancels a pending trailing (Shift re-aim)', () => {
    const f = new Fake();
    const runs: [number, number][] = [];
    const cap = new RateCap(24, (x, y) => runs.push([x, y]), f.now, f.schedule);
    cap.move(0, 0);
    f.advance(4);
    cap.move(4, 4);                                    // mid-window: arms trailing
    expect(f.pending).toBe(1);
    cap.force(9, 9);
    f.advance(500);
    expect(runs).toEqual([[0, 0], [9, 9]]);            // trailing consumed by force
  });

  test('cancel() drops the trailing (pointerleave — no raycast on a dead pointer)', () => {
    const f = new Fake();
    const runs: number[] = [];
    const cap = new RateCap(24, (x) => runs.push(x), f.now, f.schedule);
    cap.move(0, 0);
    f.advance(2);
    cap.move(2, 2);
    cap.cancel();
    f.advance(500);
    expect(runs).toEqual([0]);
    expect(f.pending).toBe(0);
  });

  test('trailing=false is the plain cap (the ghost hover): bursts drop, nothing converges', () => {
    const f = new Fake();
    const runs: number[] = [];
    const cap = new RateCap(24, (x) => runs.push(x), f.now, f.schedule, false);
    for (let i = 0; i <= 5; i++) { f.advance(i * 8); cap.move(i, 0); }
    expect(runs).toEqual([0, 3]);                      // t=24 elapsed: leading; 1,2,4,5 dropped
    f.advance(500);
    expect(runs).toEqual([0, 3]);
  });
});

describe('WireHover — 120 ms chip dwell + 2 s X-ray dwell', () => {
  interface Log { show: string[]; hide: number; begin: number[]; end: number[] }
  const mk = (live: () => { pi: number; label: string } | null) => {
    const log: Log = { show: [], hide: 0, begin: [], end: [] };
    const f = new Fake();
    const w = new WireHover(
      {
        live,
        showChip: (l) => log.show.push(l),
        hideChip: () => { log.hide++; },
        beginXray: (pi) => log.begin.push(pi),
        endXray: () => log.end.push(1),
      },
      f.schedule,
    );
    return { f, w, log };
  };
  test('a sweep (cursor gone within the dwell) shows NOTHING and opens no X-ray', () => {
    const { f, w, log } = mk(() => ({ pi: 3, label: 'A[1] ↔ B[0]' }));
    w.hover({ pi: 3, label: 'A[1] ↔ B[0]' });
    f.advance(100);
    w.reset();
    f.advance(5000);
    expect(log.show).toEqual([]);
    expect(log.begin).toEqual([]);
    expect(f.pending).toBe(0);
  });
  test('a solid hover shows the chip at 120 ms with the LIVE label at fire time', () => {
    let label = 'OLD';
    const { f, w, log } = mk(() => ({ pi: 3, label }));
    w.hover({ pi: 3, label: 'OLD' });
    f.advance(50);
    label = 'NEW';                                     // the pick re-labelled mid-dwell
    w.hover({ pi: 3, label: 'NEW' });                  // same pi: dwell NOT re-armed
    expect(log.show).toEqual([]);                      // no premature chip
    f.advance(120);
    expect(log.show).toEqual(['NEW']);                 // LIVE label at fire
  });
  test('no cable under the cursor at fire time → no chip; a later hover re-arms', () => {
    let live: { pi: number; label: string } | null = null;   // sweep-through pick
    const { f, w, log } = mk(() => live);
    w.hover({ pi: 3, label: 'X' });                     // a stale pick armed the dwell
    f.advance(120);
    expect(log.show).toEqual([]);
    live = { pi: 3, label: 'X' };
    w.hover({ pi: 3, label: 'X' });                     // arm again from here…
    f.advance(240);
    expect(log.show).toEqual(['X']);                    // …and it lands
  });
  test('2 s of solid highlight opens the X-ray on the SAME pi the live pick confirms', () => {
    const { f, w, log } = mk(() => ({ pi: 3, label: 'A' }));
    w.hover({ pi: 3, label: 'A' });
    f.advance(1999);
    expect(log.begin).toEqual([]);
    f.advance(2000);
    expect(log.begin).toEqual([3]);
  });
  test('leaving before the dwell reopens: a NEW cable re-arms from its own press', () => {
    let pi = 3;
    const { f, w, log } = mk(() => ({ pi, label: `c${pi}` }));
    w.hover({ pi: 3, label: 'c3' });
    f.advance(1500);
    pi = 7;
    w.hover({ pi: 7, label: 'c7' });                    // switch: endXray + re-arm at t=1500
    expect(log.end.length).toBeGreaterThan(0);
    f.advance(1500 + 1999);
    expect(log.begin).toEqual([]);                      // 2 s not up for cable 7
    f.advance(1500 + 2000);
    expect(log.begin).toEqual([7]);
  });
  test('a pi that MOVED AWAY at fire time never opens X-ray', () => {
    let live: { pi: number; label: string } | null = { pi: 3, label: 'A' };
    const { f, w, log } = mk(() => live);
    w.hover({ pi: 3, label: 'A' });
    f.advance(1000);
    live = { pi: 9, label: 'B' };                       // the hover drifted; the caller
    w.hover({ pi: 3, label: 'A' });                     // keeps the timer for pi 3
    f.advance(2000);
    expect(log.begin).toEqual([]);                      // fire verified pi: 9 ≠ 3 → refuse
  });
  test('reset closes a live X-ray episode and clears every timer', () => {
    const { f, w, log } = mk(() => ({ pi: 3, label: 'A' }));
    w.hover({ pi: 3, label: 'A' });
    f.advance(2000);
    expect(log.begin).toEqual([3]);
    w.reset();
    expect(log.end.length).toBeGreaterThan(0);          // episode restored
    expect(log.hide).toBe(1);
    f.advance(9000);
    expect(log.begin).toEqual([3]);                     // nothing re-armed
    expect(f.pending).toBe(0);
  });
  test('while shown, every hover repaints the chip label (follows the pick)', () => {
    const { f, w, log } = mk(() => ({ pi: 3, label: 'A' }));
    w.hover({ pi: 3, label: 'A' });
    f.advance(120);
    log.show.length = 0;
    w.hover({ pi: 3, label: 'A' });
    w.hover({ pi: 3, label: 'A' });
    expect(log.show.length).toBe(2);
  });
});

describe('coordChipText — snapped triple, rung-following decimals', () => {
  test('0.25 m rung prints 1 decimal; a finer rung prints 2', () => {
    expect(coordChipText({ x: 3, y: -2.5, z: 0, step: 0.25 })).toBe('x 3.0  y -2.5  z 0.0');
    expect(coordChipText({ x: 3.05, y: 0, z: 0, step: 0.05 })).toBe('x 3.05  y 0.00  z 0.00');
  });
  test('−0 never prints as −0', () => {
    expect(coordChipText({ x: -0, y: 0.5, z: 0.25, step: 0.25 })).toBe('x 0.0  y 0.5  z 0.3');
  });
});
