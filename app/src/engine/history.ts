// ---------- the undo stack (P7.2 extraction, docs/TEST-PYRAMID.md) ----------
// The 2026-10-20 snapshot design (the backlog design) SHIPPED in Editor.tsx
// as a ref + setTimeout pair; the STACK LOGIC is pure string bookkeeping,
// so it lives here with an INJECTED clock/scheduler and vitest pins the
// coalescing contract. Editor keeps applyHistory (the React re-parse side:
// parse → normalize → makeCtx → setBp) and calls into this.
//
// Laws (each pinned in __tests__/history.test.ts):
//  • a COMMIT is the doc's FULL literal text (emitDoc) — every mutation
//    path mirrors bp → doc, raw literals keep saves byte-exact;
//  • coalescing is time-windowed: every edit RE-ARMS one windowMs timer and
//    the text is read at FIRE time — one gizmo/slider DRAG (dozens of
//    writes) lands as ONE entry, separate clicks stay separate steps;
//  • a text identical to the current state never commits (the 450 ms flush
//    after a no-op edit must not dirty the stack / the file);
//  • a new edit drops REDO (states truncate at p);
//  • undo/redo FLUSH the open gesture first, then move p and hand the
//    caller the state text to apply.

import type { Scheduler } from './clocks';

export class HistoryStack {
  private states: string[] = [];
  private p = 0;
  private timer: (() => void) | null = null;
  private schedule: Scheduler;
  private windowMs: number;
  /** fires when a state was PUSHED (Editor repaints the menu's enabled state) */
  onPush: (() => void) | null = null;

  constructor(schedule: Scheduler,
    /** the coalescing window (Editor: 450 ms — pins that need SEPARATE
     *  undo steps must space their edits beyond it; the v1.11 timing law) */
    windowMs = 450) {
    this.schedule = schedule; this.windowMs = windowMs;
  }

  /** the file just opened (openText): the stack restarts at this text */
  open(text: string): void {
    this.cancel();
    this.states = [text];
    this.p = 0;
    this.onPush?.();
  }

  /** an edit landed: extend the open gesture. `text` is READ AT FIRE TIME. */
  snapshotSoon(text: () => string): void {
    this.cancel();
    this.timer = this.schedule(this.windowMs, () => {
      this.timer = null;
      this.snapshotNow(text());
    });
  }

  /** commit NOW (undo/redo/save re-arm paths): returns true if a state was
   *  pushed — a text equal to the current state is a NO-OP (never dirties
   *  the file, never spends an undo step, so the redo list can never hold
   *  a duplicate of the present) */
  snapshotNow(text: string): boolean {
    if (text === this.states[this.p]) return false;
    this.states = this.states.slice(0, this.p + 1);    // a new edit drops REDO
    this.states.push(text);
    this.p = this.states.length - 1;
    this.onPush?.();
    return true;
  }

  /** flush the open gesture (call before undo/redo/save) */
  flush(text: () => string): void {
    this.cancel();
    this.snapshotNow(text());
  }

  undo(text: () => string): string | null {
    this.flush(text);
    if (this.p <= 0) return null;
    this.p -= 1;
    return this.states[this.p]!;
  }

  redo(text: () => string): string | null {
    this.flush(text);
    if (this.p >= this.states.length - 1) return null;
    this.p += 1;
    return this.states[this.p]!;
  }

  /** the opened-file text: state 0 (Editor's dirty law: current ≠ 0) */
  get origin(): string { return this.states[0] ?? ''; }
  get current(): string { return this.states[this.p] ?? ''; }
  get canUndo(): boolean { return this.p > 0; }
  get canRedo(): boolean { return this.p < this.states.length - 1; }
  /** a coalesced gesture is mid-flight: flushing it will create an undoable
   *  step, so the Edit ▾ menu lights Undo (the v1.11 enabled-state law) */
  get openGesture(): boolean { return this.timer !== null; }
  get depth(): number { return this.states.length; }

  private cancel(): void {
    if (this.timer) { this.timer(); this.timer = null; }
  }
}
