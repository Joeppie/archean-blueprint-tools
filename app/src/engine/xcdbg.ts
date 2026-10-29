// xcdgb.ts — THE DEBUG CONSOLE (v1.13.24, we: "Create a text-based/lower
// level/JS interface where we can define breakpoints and then run stuff -
// a nice interface that makes using it for AI agents to analyze xenoncode
// easier").
//
// makeXcdbg(getPump) wraps the FARM's live pumps in a small,
// JSON-serialisable, async API installed as window.__XCDBG__ by Editor.tsx
// — so an AI agent (Playwright page.evaluate, the browser console, or a
// userscript) drives the REAL debugger: set breakpoints by file:line, run
// N cycles, step over/into, read the frame (typed rows), write variables
// back (XENON-WRITEBACK's validated law), and read the io-bus/prints.
// v1.15.0 slice C: getPump() resolves the ACTIVE pump per call (the farm
// may hold several VMs); a never-opened pump is the null object, so every
// method stays callable (and honest: 'idle', 0 cycles) with no VM booted.
//
// Every method answers plain data (no DOM, no class instances). The pump
// cadence/worker machinery stays the single source of truth; this file adds
// only the WAITING (promise on pump notifies + a wall-clock guard) and the
// name->slot plumbing of writeVar.
import { XenonPump, varKind } from './xenoncode';

export interface XcdbgVarRow {
  name: string;
  /** 'number' | 'text' | 'storage number' | 'number[]' | 'object' … */
  type: string;
  value: string;
  /** recursion-copy id (XENON-LOCALS), only on frames with copies */
  copy?: number;
}

export interface XcdbgState {
  status: string;
  cycles: number;
  paused: boolean;
  file: string | null;
  line: number | null;
  /** the frame label: '@fn', a block ('timer frequency 4', 'update'), null */
  frame: string | null;
  worker: boolean;
}

const typeOf = (t: number): string =>
  t >= 50 && t <= 61 ? `storage ${t === 51 || t === 61 ? 'text' : 'number'}`
  : t === 70 ? 'number' : t === 71 ? 'text'
  : t === 80 ? 'number[]' : t === 81 ? 'text[]'
  : t >= 128 ? 'object' : varKind(t);

export function makeXcdbg(getPump: () => XenonPump | null) {
  const IDLE = new XenonPump();          // null object: never opened
  const pump = () => getPump() ?? IDLE;
  const breaks = new Map<string, Set<number>>();
  const push = () =>
    pump().setBreaksMap(Object.fromEntries([...breaks].map(([f, s]) => [f, [...s]])));
  const list = () => [...breaks].flatMap(([f, s]) => [...s].sort((a, b) => a - b).map(l => ({ file: f, line: l })));
  const state = (): XcdbgState => ({
    status: pump().status, cycles: pump().cycles,
    paused: pump().paused,
    file: pump().paused ? pump().pausedFile : null,
    line: pump().paused ? pump().pausedLine : null,
    frame: pump().paused ? pump().localsFrame() : null,
    worker: !!pump().wrun,
  });
  const rows = (list: readonly { name: string; t: number; v: string; s?: number }[]): XcdbgVarRow[] =>
    list.map(v => ({ name: v.name, type: typeOf(v.t), value: v.v, ...(v.s ? { copy: v.s } : {}) }));
  /** resolve when pred() holds — pump notifies drive it, a 15 ms poll keeps
   *  wall-clock deadlines honest on quiet states (paused loops notify at 10 Hz) */
  const wait = (pred: () => boolean, ms = 20_000): Promise<boolean> =>
    new Promise(res => {
      const t0 = performance.now();
      const unsub = pump().subscribe(() => check());
      const timer = setInterval(check, 15);
      function check() {
        if (pred()) { unsub(); clearInterval(timer); res(true); }
        else if (performance.now() - t0 > ms) { unsub(); clearInterval(timer); res(false); }
      }
      check();
    });
  const runTo = async (opts?: { cycles?: number; until?: () => boolean }): Promise<XcdbgState & { reached: boolean }> => {
    const target = pump().cycles + (opts?.cycles ?? 400);
    // run() from a pause RESUMES the parked VM, then watches for the next
    // stop / budget / halt (an agent's "continue")
    if (pump().paused) pump().resume();
    pump().startRunning();
    const reached = await wait(() =>
      (opts?.until?.() ?? false) || pump().paused || pump().cycles >= target
      || pump().status === 'error' || pump().status === 'stopped' || pump().status === 'idle');
    return { ...state(), reached };
  };

  return {
    version: 1,
    /** live debugger state (status/cycles/pause site/frame label/worker) */
    status: state,
    /** the disk: names + line counts (agents map breaks onto real lines) */
    files: () => (pump().comp?.files ?? []).map(f => ({ name: f.name, lines: f.code.split('\n').length })),
    source: (file: string) => pump().comp?.files.find(f => f.name === file)?.code ?? null,

    /** breakpoints BY FILE (the XENON-DEBUG v2 law): replaces the set for
     *  that file; empty lines clears it. Answers the whole live list. */
    break: (file: string, lines: number[]) => {
      if (!pump().fileTable.includes(file)) return { error: `no such file (have: ${pump().fileTable.join(', ')})` };
      if (lines.length === 0) breaks.delete(file);
      else breaks.set(file, new Set(lines));
      push();
      return list();
    },
    clear: (file?: string) => {
      if (file === undefined) breaks.clear();
      else breaks.delete(file);
      push();
      return list();
    },
    breakpoints: list,

    /** run (from a pause: RESUME the VM) until the next breakpoint, a
     *  cycle budget, stop, or error */
    run: (opts?: { cycles?: number }) => runTo(opts),
    resume: (opts?: { cycles?: number }) => runTo(opts),
    /** F10/F11 as data: 'over' leaves the current body, 'into' steps in */
    step: async (kind: 'over' | 'into' = 'over') => {
      const before = `${pump().pausedFile}:${pump().pausedLine}`;
      if (!pump().paused) return { ...state(), moved: false, error: 'not paused' };
      if (kind === 'into') pump().stepInto(); else pump().stepOver();
      const moved = await wait(() =>
        pump().paused && `${pump().pausedFile}:${pump().pausedLine}` !== before);
      return { ...state(), moved };
    },
    /** Run-menu 'Run to cursor': pause when (file,line) executes */
    goto: async (file: string, line: number, cycles = 400) => {
      pump().runTo(file, line);
      return runTo({ cycles, until: () => pump().paused && pump().pausedFile === file && pump().pausedLine === line });
    },

    /** the paused frame (null while running: a frame is born at a stop) */
    frame: () => pump().paused
      ? { file: pump().pausedFile, line: pump().pausedLine, frame: pump().localsFrame(), locals: rows(pump().locals) }
      : null,
    locals: () => rows(pump().locals),
    globals: () => rows([...pump().vars.values()]),
    /** live io bus (output_number rows: 'io:port' -> value) + prints */
    bus: () => Object.fromEntries(pump().bus),
    prints: () => pump().prints.slice(-60).map(e => String(e.v ?? '')),
    /** FEED an input channel (the same law as the Bus-tab sliders):
     *  io-driven branches only run when the world feeds them — an agent
     *  steers `input_number(11, 3)`-guarded code through this */
    io: (io: number | string, ch: number, v: number) => {
      pump().setInput(io, ch, v);
      return true;
    },

    /** XENON-WRITEBACK: validate + inject a value into the VM. scope
     *  'locals' edits the PAUSED frame (worker mode: pause first), 'globals'
     *  the globals table. Answers {ok}|{ok:false, error} — the SAME law the
     *  row editors in the UI use (Computer::WriteVarAt). */
    write: async (name: string, value: string, scope: 'locals' | 'globals' = 'locals') => {
      const pool = scope === 'locals' ? pump().locals : [...pump().vars.values()];
      const row = pool.find(r => r.name === name.replace(/^\$/, ''));
      if (!row) return { ok: false, error: `no $${name} in ${scope}` };
      return pump().writeVar(row.name, row.t, value, scope);
    },
  };
}

export type Xcdbg = ReturnType<typeof makeXcdbg>;
