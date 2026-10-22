// latsphere.worker.ts — the sphere-skin PLANNER off the UI thread
// (user 2026-10-22: "The sphere generator shouldn't block slider if
// resizing it … delay it's calculation or do it background"). Planning is a
// pure function (engine/latsphere.ts has zero DOM/THREE imports), so it
// moves to a module worker verbatim: the dialog's sliders keep sliding at
// 60 Hz while a zeppelin-sized hull re-plans behind the message port.
// TWO jobs share the port: 'stats' (the live preview line) and 'tris' (the
// Confirm staging — a 96 m skin plans in seconds and must NEVER run on the
// UI thread, or the dialog looks dead: "Nothing happens when I press
// review and confirm").
import { sphereSkinTris, sphereStats, type SkinOptions, type SphereSpec, type SphereStats } from './latsphere';
import type { Triangle } from './format';

// the worker global scope, typed narrowly (this file never runs under the
// DOM lib — vite compiles it as its own module graph entry)
declare const self: {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage: (message: unknown) => void;
};

interface Request {
  id: number;
  spec: SphereSpec;
  /** 'stats' (default) = the preview metrics; 'tris' = the staged skin */
  kind?: 'stats' | 'tris';
  opt?: SkinOptions;
}

self.onmessage = (e: MessageEvent) => {
  const { id, spec, kind, opt } = (e.data ?? {}) as Request;
  try {
    if (kind === 'tris') {
      const tris: Triangle[] = sphereSkinTris(spec, opt ?? { slot: 51 });
      self.postMessage({ id, tris });
    } else {
      const stats: SphereStats = sphereStats(spec);
      self.postMessage({ id, stats });
    }
  } catch {
    self.postMessage({ id, stats: null, tris: null });   // caller falls back
  }
};
