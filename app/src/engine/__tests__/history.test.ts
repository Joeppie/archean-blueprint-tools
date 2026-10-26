// The undo-stack laws (history.ts) on a synthetic clock — the contracts
// e2e paid in wall clock (the 600 ms spacing law, "one drag = one Ctrl+Z").
import { describe, expect, test } from 'vitest';
import { HistoryStack } from '../history';
import { type Scheduler } from '../clocks';

class Fake {
  t = 0;
  private seq = 0;
  private jobs = new Map<number, { at: number; cb: () => void }>();
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
}

/** a doc whose text the test controls — emitDoc reads the CURRENT doc, so
 *  the provider returns whatever the doc says at CALL time */
const doc = (initial: string) => {
  const box = { text: initial, reads: 0 };
  return { box, text: () => { box.reads++; return box.text; } };
};

describe('HistoryStack — the shipped snapshot design', () => {
  test('open seeds ONE state; nothing to undo/redo', () => {
    const h = new HistoryStack(new Fake().schedule);
    h.open('A');
    expect(h.depth).toBe(1);
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
    expect(h.origin).toBe('A');
  });

  test('a DRAG coalesces: every edit re-arms the window; the text is read at FIRE time', () => {
    const f = new Fake();
    const h = new HistoryStack(f.schedule, 450);
    h.open('A');
    const d = doc('A');
    // 5 gizmo writes while the doc keeps changing
    const write = (t: number, s: string) => { f.advance(t); d.box.text = s; h.snapshotSoon(d.text); };
    write(0, 'B1'); write(100, 'B2'); write(200, 'B3'); write(300, 'B4'); write(400, 'B5');
    expect(h.depth).toBe(1);                            // nothing committed mid-drag
    f.advance(400 + 450);
    expect(h.depth).toBe(2);                            // exactly ONE entry
    expect(h.current).toBe('B5');                       // the doc as of FIRE
  });

  test('separate clicks stay separate steps (edits beyond the window)', () => {
    const f = new Fake();
    const h = new HistoryStack(f.schedule, 450);
    h.open('A');
    const d = doc('A');
    d.box.text = 'B'; h.snapshotSoon(d.text);
    f.advance(1000);
    d.box.text = 'C'; h.snapshotSoon(d.text);
    f.advance(3000);
    expect(h.depth).toBe(3);                            // A, B, C
  });

  test('a text identical to the present NEVER commits (no-op flush stays clean)', () => {
    const h = new HistoryStack(new Fake().schedule);
    h.open('A');
    expect(h.snapshotNow('A')).toBe(false);
    expect(h.snapshotNow('B')).toBe(true);
    expect(h.snapshotNow('B')).toBe(false);
    expect(h.depth).toBe(2);
  });

  test('undo/redo FLUSH the open gesture first (the last drag is undoable)', () => {
    const f = new Fake();
    const h = new HistoryStack(f.schedule, 450);
    h.open('A');
    const d = doc('A');
    d.box.text = 'B';
    h.snapshotSoon(d.text);
    f.advance(100);                                     // window still open
    expect(h.undo(d.text)).toBe('A');                   // B flushed, then stepped back
    d.box.text = 'A';                                   // applyHistory reloaded the doc
    expect(h.current).toBe('A');
    expect(h.canRedo).toBe(true);
    expect(h.redo(d.text)).toBe('B');                   // the flush dedups (doc = 'A' = current)
  });

  test('a new edit after an undo DROPS the redo tail', () => {
    const h = new HistoryStack(new Fake().schedule);
    h.open('A');
    h.snapshotNow('B');
    h.snapshotNow('C');
    expect(h.undo(() => 'C')).toBe('B');
    h.snapshotNow('D');
    expect(h.canRedo).toBe(false);
    expect(h.depth).toBe(3);                            // A, B, D — C is gone
    expect(h.current).toBe('D');
  });

  test('boundaries: undo at 0 / redo at the tip return null and move nothing', () => {
    const h = new HistoryStack(new Fake().schedule);
    h.open('A');
    expect(h.undo(() => 'A')).toBeNull();
    expect(h.redo(() => 'A')).toBeNull();
    expect(h.current).toBe('A');
  });

  test('open() cancels an open gesture (a craft swap never commits into the new doc)', () => {
    const f = new Fake();
    const h = new HistoryStack(f.schedule, 450);
    h.open('A');
    const d = doc('DIRTY');
    h.snapshotSoon(d.text);
    h.open('FRESH');
    f.advance(5000);
    expect(h.depth).toBe(1);
    expect(h.current).toBe('FRESH');
    expect(d.box.reads).toBe(0);                        // the provider never ran
  });

  test('onPush fires per pushed state (menu enabled-state repaint)', () => {
    const h = new HistoryStack(new Fake().schedule);
    let pushes = 0;
    h.onPush = () => { pushes++; };
    h.open('A');
    h.snapshotNow('B');
    h.snapshotNow('B');                                 // dedup: no repaint
    expect(pushes).toBe(2);                             // open + B
  });
});
