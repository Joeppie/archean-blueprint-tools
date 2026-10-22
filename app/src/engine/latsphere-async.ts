// latsphere-async.ts — the dialog's background path to the sphere planner.
// The SAME pure engine/latsphere.ts runs inside a module worker
// (latsphere.worker.ts); a request id correlates replies so stale answers
// are ignored at the caller (which also guards by sequence). Where no
// Worker exists (vitest/node, exotic embeds) the call answers synchronously
// — the exact same numbers, just on the caller's thread.
import { sphereStats, type SphereSpec, type SphereStats } from './latsphere';

let worker: Worker | null = null;
let dead = false;
let seq = 0;
const pending = new Map<number, (s: SphereStats | null) => void>();

function ensureWorker(): Worker | null {
  if (dead || typeof Worker === 'undefined') return null;
  if (!worker) {
    worker = new Worker(new URL('./latsphere.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent) => {
      const { id, stats } = (e.data ?? {}) as { id: number; stats: SphereStats | null };
      const cb = pending.get(id);
      if (cb) { pending.delete(id); cb(stats ?? null); }
    };
    worker.onerror = () => {                       // CSP/bundle trouble:
      dead = true;                                 // never stall the dialog —
      for (const cb of pending.values()) cb(null); // everything falls back
      pending.clear();                             // to the sync planner
      worker?.terminate();
      worker = null;
    };
  }
  return worker;
}

/** sphereStats off the main thread (or on this thread where a worker is
 *  unavailable / broken). Never rejects. */
export async function sphereStatsAsync(spec: SphereSpec): Promise<SphereStats> {
  const w = ensureWorker();
  if (!w) return sphereStats(spec);
  const id = ++seq;
  const got = await new Promise<SphereStats | null>((res) => {
    pending.set(id, res);
    w.postMessage({ id, spec });
  });
  return got ?? sphereStats(spec);
}
