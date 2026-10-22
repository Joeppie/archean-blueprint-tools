// latsphere-async.ts — the dialog's background path to the sphere planner.
// The SAME pure engine/latsphere.ts runs inside a module worker
// (latsphere.worker.ts); a request id correlates replies so stale answers
// are ignored at the caller (which also guards by sequence). Where no
// Worker exists (vitest/node, exotic embeds), the construction fails
// (blocked by CSP/privacy settings), or a reply never lands (watchdog),
// the call answers SYNCHRONOUSLY — the exact same numbers, just on the
// caller's thread. A broken worker is never allowed to leave the dialog
// stuck 'planning…' forever (2026-10-22 field report: "Nothing happens
// when I press review and confirm" — every failure mode must degrade,
// never deadlock).
import { sphereSkinTris, sphereStats, type SkinOptions, type SphereSpec, type SphereStats } from './latsphere';
import type { Triangle } from './format';

const WATCHDOG_MS = 6000;   // no reply inside this = answer sync, count it
const DEAD_AFTER = 2;       // repeated watchdog misses ⇒ retire the worker

let worker: Worker | null = null;
let dead = false;
let watchdogMisses = 0;
let seq = 0;
const pending = new Map<number, (s: unknown | null) => void>();

function retire() {                          // worker died: a hung worker's
  dead = true;                               // queue drains itself on
  pending.clear();                           // terminate — open requests
  worker?.terminate();                       // were answered by the
  worker = null;                             // watchdog or fail below
}

function ensureWorker(): Worker | null {
  if (dead || typeof Worker === 'undefined') return null;
  if (!worker) {
    try {
      worker = new Worker(new URL('./latsphere.worker.ts', import.meta.url), { type: 'module' });
    } catch {                                   // construction refused
      dead = true;
      return null;
    }
    worker.onmessage = (e: MessageEvent) => {
      const { id, stats, tris } = (e.data ?? {}) as { id: number; stats?: unknown; tris?: unknown };
      const cb = pending.get(id);
      if (cb) { pending.delete(id); cb(stats ?? tris ?? null); }
    };
    worker.onerror = () => {
      // mid-flight requests must not hang until the watchdog: answer them
      for (const cb of pending.values()) cb(null);
      retire();
    };
  }
  return worker;
}

/** One job through the worker with a watchdog; null = fall back. */
function request<T>(job: { spec: SphereSpec; kind?: 'stats' | 'tris'; opt?: SkinOptions }): Promise<T | null> {
  const w = ensureWorker();
  if (!w) return Promise.resolve(null);
  const id = ++seq;
  return new Promise<T | null>((res) => {
    let done = false;
    const finish = (s: unknown | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      pending.delete(id);
      res((s as T) ?? null);
    };
    const timer = setTimeout(() => {            // silent worker ⇒ sync now
      if (++watchdogMisses >= DEAD_AFTER) retire();
      finish(null);
    }, WATCHDOG_MS);
    pending.set(id, finish);
    try {
      w.postMessage({ id, ...job });
    } catch {
      finish(null);                             // dead port ⇒ sync fallback
    }
  });
}

/** sphereStats off the main thread where possible; never rejects. */
export async function sphereStatsAsync(spec: SphereSpec): Promise<SphereStats> {
  return (await request<SphereStats>({ spec, kind: 'stats' })) ?? sphereStats(spec);
}

/** The Confirm STAGING job: a 96 m skin (seconds of planning) must never
 *  run on the UI thread — that is the "nothing happens on Confirm" freeze.
 *  Never rejects. */
export async function sphereSkinTrisAsync(spec: SphereSpec, opt: SkinOptions): Promise<Triangle[]> {
  return (await request<Triangle[]>({ spec, kind: 'tris', opt })) ?? sphereSkinTris(spec, opt);
}
