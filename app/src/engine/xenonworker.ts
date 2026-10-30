// xenonworker.ts — the VM's thread (v1.13.17 TRUE LINE STEPPING, we:
// "Implement the capacity to actually step through lines").
//
// The wasm module (with our device shim) runs entirely HERE, driven by the
// app's XenonWorkerRun bridge: main posts {cmd:'cycle',…}, the worker runs
// xc_cycle() and posts the events / vars / screens back. The debugger's
// power comes from the SHARED Int32Array (library_xc.js protocol): the
// interpreter's line hook checks the step law and, on a stop, SLEEPS IN
// PLACE (Atomics.wait) inside xc_cycle — this thread freezes mid-update
// with the C++ stack (function locals, nested @call frames) intact, while
// the MAIN thread stays fully alive: the UI paints, keys respond, and the
// next F10/F8 lands as an Atomics.notify that wakes the exact line.
//
// Everything else is a faithful mirror of XenonRun (open procedure, event
// JSON, screen registry) — the pump's applyCycle consumes the same shapes.
/// <reference lib="webworker" />

type Msg = {
  t: string;
  /** the ESM glue's module URL (the app's ?url asset — main thread resolves it) */
  xcUrl?: string;
  /** the wasm's asset URL (the glue's locateFile target) */
  xcWasmUrl?: string;
  sab?: SharedArrayBuffer;
  comp?: {
    capacity: number; builtin: boolean;
    files: { name: string; code: string }[];
    screens: { alias: string; channel: number; w: number; h: number; deviceScreen?: boolean }[];
    devices: { id: number; io: number; alias: string; type: string; x: number; y: number; z: number }[];
  };
  inputs?: [number | string, number, number | string][];
  bputs?: [number, string][];
  sync?: [string, number][];
  keys?: string[];
  key?: string; x?: number; y?: number; d?: number;
  lines?: [string, number][];
  n?: number;
  /** XENON-DEBUG v3: on = tracking gate (record + ship pair/depth streams) */
  on?: boolean;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
const ctx = self as unknown as {
  postMessage: (m: unknown, t?: Transferable[]) => void;
  close: () => void;
  onmessage: ((e: MessageEvent) => void) | null;
};
let mod: any = null;
let err = '';
let wantKeys: string[] = [];
// XENON-DEBUG v3 (workpackages WP6): the pump's TRACKING GATE — while the
// interpreter records no lines (no breaks, no armed step, no armed park)
// the cycle response skips the pair + depth JSON entirely (no
// UTF8ToString, no JSON.stringify, no postMessage payload).
let tracked = false;

const enc = new TextEncoder();
function putStr(s: string): number {
  const nb = enc.encode(s).length + 1;
  const p = mod._malloc(nb);
  mod.stringToUTF8(s, p, nb);
  return p;
}

function openRun(m: Msg): void {
  const comp = m.comp!;
  mod._xc_reset_screens();
  mod._xc_reset_devices();
  mod._xc_set_capability(0, comp.capacity);
  for (const f of comp.files) {
    const np = putStr(f.name), cp = putStr(f.code);
    mod._xc_write_file(np, cp);
    mod._free(np); mod._free(cp);
  }
  for (const sc of comp.screens) {
    const np = putStr(sc.alias);
    mod._xc_add_screen(np, sc.channel, sc.w, sc.h);
    mod._free(np);
    if ((comp.builtin || sc.deviceScreen) && sc.channel === 0) {
      // v1.15.1: the integrated touchscreen is EVERY computer's plain
      // screen() target (the XenonRun.open twin — the panel size registered
      // BEFORE boot wins the first-wins race against the 640×480 default)
      const np2 = putStr('main');
      mod._xc_add_screen(np2, 0, sc.w, sc.h);
      mod._free(np2);
    }
  }
  for (const d of comp.devices) {
    const ap = putStr(d.alias), tp = putStr(d.type);
    mod._xc_add_device(d.id, d.io, ap, tp, d.io, d.x, d.y, d.z, 0, 0, 0, 0);
    mod._free(ap); mod._free(tp);
  }
  mod._xc_pilot_script(0);
  if (typeof mod._xc_set_cycle_ms === 'function') mod._xc_set_cycle_ms(40);
  // XENON-DEBUG v3 (ABI 10): the WORKER host arms the per-line stop-hook
  // CALL (the hook IS this host's debugger); the tracking itself stays
  // gated (the pump's 'track' messages) — an untracked VM records nothing.
  if (typeof mod._xc_hook_live === 'function') mod._xc_hook_live(1);
  sentVer.clear();
  err = mod._xc_boot() ? mod.UTF8ToString(mod._xc_error()) : '';
}

function metas(): { key: string; w: number; h: number }[] {
  const out = [];
  for (let i = 0; i < mod._xc_screen_count(); i++) {
    const w = mod._xc_screen_w(i), h = mod._xc_screen_h(i);
    if (!w || !h) continue;
    out.push({ key: mod.UTF8ToString(mod._xc_screen_key(i)), w, h });
  }
  return out;
}
// ABI 15 XENON-SCREEN-VERSION (worker twin of XenonPump.fetchVersioned): a
// surface whose write counter is unchanged since its LAST delivery ships NO
// pixels — the main-thread pump keeps the previous array (applyCycle keeps
// cached pixels for a null fetch). -1 (older wasm) = ship every cycle.
const sentVer = new Map<string, number>();
function pixelsFor(keys: string[]): Record<string, ArrayBuffer> {
  const out: Record<string, ArrayBuffer> = {};
  for (const key of keys) {
    const p = putStr(key);
    const idx = typeof mod._xc_screen_index === 'function' ? mod._xc_screen_index(p) : -1;
    mod._free(p);
    if (idx < 0) continue;
    const v = typeof mod._xc_screen_version === 'function' ? mod._xc_screen_version(idx) : -1;
    if (v >= 0 && sentVer.get(key) === v) continue;
    const w = mod._xc_screen_w(idx), h = mod._xc_screen_h(idx), d = mod._xc_screen_pixels(idx);
    if (!w || !h || !d) continue;
    const ab = new ArrayBuffer(w * h * 4);
    new Uint8Array(ab).set(new Uint8Array(mod.HEAPU8.buffer, d, w * h * 4));
    out[key] = ab;
    sentVer.set(key, v);
  }
  return out;
}
function pixelKeys(): string[] {
  return [...new Set(wantKeys)];
}

function cycleData(evsJson: string): Record<string, unknown> {
  return {
    evs: JSON.parse(evsJson),
    metas: metas(),
    vars: mod.UTF8ToString(mod._xc_vars()),
    overrides: typeof mod._xc_worldsim_overrides === 'function' ? mod.UTF8ToString(mod._xc_worldsim_overrides()) : '{}',
    // v3 gate: pair + depth streams ship ONLY while tracked (the worker's
    // debugger is the SAB hook — the stream is audit payload, and a busy
    // program's per-cycle stream is megabytes of pure cost untracked)
    pairs: tracked && typeof mod._xc_cycle_pairs === 'function' ? mod.UTF8ToString(mod._xc_cycle_pairs()) : '[]',
    depths: tracked && typeof mod._xc_cycle_depths === 'function' ? mod.UTF8ToString(mod._xc_cycle_depths()) : '[]',
    pixels: pixelsFor(pixelKeys()),
    error: err,
  };
}

ctx.onmessage = (e: MessageEvent<Msg>) => {
  const m = e.data;
  try {
    if (m.t === 'open') {
      // v1.13.17 L4: the glue is an ESM build product (build.sh
      // -sEXPORT_ES6=1) served from the app's own asset graph — the module
      // worker imports the URL the main thread resolved through ?url (the
      // seal.wasm precedent). The classic-script fetch + blob export-shim
      // is GONE (and with it the wasm's public/ copy).
      return import(/* @vite-ignore */ m.xcUrl as string)
        .then(x => (x as { default: (o: Record<string, unknown>) => Promise<any> })
          .default({
            locateFile: (f: string) => (m.xcWasmUrl as string) ?? f,
            XC_SAB: m.sab,
          }))
        .then(m2 => {
          mod = m2;
          openRun(m);
          const d = {
            t: 'open', abi: typeof mod._xc_abi === 'function' ? mod._xc_abi() : 0, error: err,
            // XENON-LOCALS (ABI 8): the VM's SOURCEFILE table — the pump's
            // fileTable of record (pair streams/breakpoints/locals indices)
            sfiles: typeof mod._xc_source_files === 'function'
              ? (JSON.parse(mod.UTF8ToString(mod._xc_source_files())) as string[])
                .map((f: string) => f.split(/[\\/]/).pop() ?? f)
              : [],
          } as Record<string, unknown>;
          ctx.postMessage(d);
        }).catch((ex: unknown) => ctx.postMessage({ t: 'open', abi: 0, error: `${String(ex)} :: ${(ex as { stack?: string })?.stack?.slice(0, 300) ?? ''}` }));
    }
    if (!mod) return;
    if (m.t === 'keys') { wantKeys = m.keys ?? []; return; }
    if (m.t === 'track') {
      // XENON-DEBUG v3 TRACKING GATE: on = record lines/pairs/depths +
      // ship them; off = the VM runs with the recorder fully idle
      tracked = !!m.on;
      if (typeof mod._xc_debug_track === 'function') mod._xc_debug_track(m.on ? 1 : 0);
      return;
    }
    if (m.t === 'click') {
      const p = putStr(m.key!); const idx = mod._xc_screen_index(p); mod._free(p);
      if (idx >= 0) mod._xc_screen_click(idx, m.x!, m.y!);
      return;
    }
    if (m.t === 'scroll') {
      const p = putStr(m.key!); const idx = mod._xc_screen_index(p); mod._free(p);
      if (idx >= 0) mod._xc_screen_scroll(idx, m.d!);
      return;
    }
    if (m.t === 'parse') {
      const errs = (m.lines ?? []).map(([s, n]) => {
        const p = putStr(s);
        const bad = mod._xc_parse_line(p, n);
        const msg = bad ? mod.UTF8ToString(mod._xc_error()) : '';
        mod._free(p);
        return msg;
      });
      return ctx.postMessage({ t: 'parse', errs });
    }
    if (m.t === 'reboot') {
      // XenonRun.reboot law: flush the storage cache, then re-boot.
      err = '';
      mod._xc_save_storage();
      sentVer.clear();
      const ok = !mod._xc_boot();
      if (!ok) err = mod.UTF8ToString(mod._xc_error());
      return ctx.postMessage({ t: 'reboot', ok, error: err });
    }
    if (m.t === 'cycle' || m.t === 'runCycles') {
      // the keys ride EVERY cycle message (XenonWorkerRun.setKeys piggybacks
      // them) — WITHOUT this read the pixel fetch ran on a permanently-empty
      // wantKeys: worker mode shipped with ZERO screen pixels delivered
      // (the four litPixels e2e reds, v1.13.17)
      if (m.keys) wantKeys = m.keys;
      for (const [io, ch, v] of m.inputs ?? []) {
        if (typeof v === 'string' && typeof io === 'string' && /^\d+$/.test(io)
            && typeof mod._xc_set_input_ti === 'function') {
          const t = putStr(v);
          mod._xc_set_input_ti(+io, ch, t); mod._free(t);
        }
        else if (typeof v === 'string' && typeof io === 'string'
            && typeof mod._xc_set_input_t === 'function') {
          // ABI 11 text channel feed (beaconNet delivery -> Beacon ch0)
          const a = putStr(io), t = putStr(v);
          mod._xc_set_input_t(a, ch, t); mod._free(a); mod._free(t);
        }
        // ABI 16: text onto a DEVICE KEY / raw port (the appkit bus fan-out)
        else if (typeof v === 'string' && typeof io === 'number'
            && typeof mod._xc_set_input_ti === 'function') {
          const t = putStr(v);
          mod._xc_set_input_ti(io, ch, t); mod._free(t);
        }
        else if (typeof io === 'number') mod._xc_set_input(io, ch, v as number);
        else if (/^\d+$/.test(io)) mod._xc_set_input(+io, ch, v as number);
        else if (typeof mod._xc_set_input_a === 'function') {
          const p = putStr(io); mod._xc_set_input_a(p, ch, v as number); mod._free(p);
        }
      }
      // ABI 11: deliver to the worker's program beacon() objects (.data)
      if (typeof mod._xc_beacon_put === 'function')
        for (const [i, payload] of m.bputs ?? []) {
          const p = putStr(payload); mod._xc_beacon_put(i, p); mod._free(p);
        }
      if (typeof mod._xc_worldsim_sync === 'function')
        for (const [name, v] of m.sync ?? []) {
          const p = putStr(name); mod._xc_worldsim_sync(p, v); mod._free(p);
        }
      const n = m.t === 'runCycles' ? (m.n ?? 1) : 1;
      // xc_events DRAINS per fetch (XenonRun law) — merge the n cycles'
      const evs: unknown[] = [];
      for (let i = 0; i < n; i++) {
        // 2 = XENON-DEBUG v3 exact-line park (the hook parks mid-cycle;
        // the pause-request seam is the main-thread pump's path — a park
        // that reaches HERE is honest: events drained, cycle truncated)
        const rc = mod._xc_cycle();
        if (rc === 2) break;
        if (rc) { err = mod.UTF8ToString(mod._xc_error()); break; }
        try { evs.push(...JSON.parse(mod.UTF8ToString(mod._xc_events()))); } catch { /* drain */ }
      }
      const evsJson = JSON.stringify(evs);
      const d = cycleData(evsJson);
      d.t = 'cycle';
      d.n = n;
      const tr: ArrayBuffer[] = [];
      const pmap = d.pixels as Record<string, ArrayBuffer>;
      for (const k in pmap) { const b = pmap[k]; if (b) tr.push(b); }
      return ctx.postMessage(d, tr);
    }
    if (m.t === 'close') { ctx.close(); return; }
  } catch (ex) {
    ctx.postMessage({ t: 'cycle', evs: [], metas: [], vars: '[]', overrides: '{}', pairs: '[]', pixels: {}, error: String(ex) });
  }
};
