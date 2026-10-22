// latsphere.worker.ts — the sphere-skin PLANNER off the UI thread
// (user 2026-10-22: "The sphere generator shouldn't block slider if
// resizing it … delay it's calculation or do it background"). Planning is a
// pure function (engine/latsphere.ts has zero DOM/THREE imports), so it
// moves to a module worker verbatim: the dialog's sliders keep sliding at
// 60 Hz while a zeppelin-sized hull re-plans behind the message port.
import { sphereStats, type SphereSpec, type SphereStats } from './latsphere';

// the worker global scope, typed narrowly (this file never runs under the
// DOM lib — vite compiles it as its own module graph entry)
declare const self: {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage: (message: unknown) => void;
};

interface Request { id: number; spec: SphereSpec }

self.onmessage = (e: MessageEvent) => {
  const { id, spec } = (e.data ?? {}) as Request;
  let stats: SphereStats | null = null;
  try { stats = sphereStats(spec); } catch { stats = null; }   // caller falls back
  self.postMessage({ id, stats });
};
