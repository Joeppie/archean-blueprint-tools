// XenonDialog.tsx — the in-game-style XenonCode IDE for one craft computer
// (v1.13 line; the v1.13.x batch: EDITABLE code + the virtual-disk file
// dialog + live node values + clickable screens, all on the SHARED XenonPump
// so the bottom Screens dock and the 3-D dashboards ride the same VM).
//
// The look follows the in-game IDE (wiki xenoncode/ide.md): dark window,
// title bar, the File/Library/Computer menu row, ONE TAB PER HDD FILE
// ("all the files in that virtual computer's HDD will always be opened as
// Tabs"), line-numbered code, the "Program 'x' is running…" status lines,
// the green ON indicator. CTRL+S saves the current file and the computer
// AUTO-REBOOTS (the game's rule); CTRL+SHIFT+S saves all.
//
// Code EDITING is a real CodeMirror 6 editor (components/CodeEditor.tsx):
// syntax highlighting, breakpoint gutter, right-click menu (Go to
// Definition · Run to Cursor · breakpoints · clipboard · Save), hover
// signatures + live $var values, go-to-definition, completion on typing —
// we: "when I edit code, I need syntax highlighting, I should have go to
// definition as a right click menu and hovering over a function should tell
// me its signature and where it lives". Debugger (XENON-DEBUG v2): F10/F11
// step LINES (file-qualified executed-pair stream), a BREAKPOINT OVERVIEW,
// and a "where am I" pill (file:line @function). The file dialog
// creates/removes files on the craft's virtual disk (data.hdd.xc_files —
// baked into the blueprint json, saved with the craft).
//
// Node graphs: programs authored in the visual editor carry a
// `;#NODES {json}` header; the DOM cards show the LIVE values — io-addressed
// InputNodes print the value the program ACTUALLY read from its component
// (the shim's per-cycle input_number reports), OutputNodes the io-bus value.
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useRef, useState } from 'react';
import FloatingWindow from './FloatingWindow';
import {
  chanInfo, loadChannelTable, parseKv, parseNodes, varKind, xenonPump,
  xenonScreenBindings, xcDiskFiles, CYCLE_HZ, sabSupported,
  type ChannelTable, type XenonComputer, type XGraph, type XCFile,
} from '../engine/xenoncode';
import { BUZZER_MODES, buzzerAudio, buzzerReadings, type BuzzerWave } from '../engine/buzzer';
import { parseXenonTest, evalAssert, type XenonAssertResult } from '../engine/xenontest';
import { usePilotKeys } from '../engine/pilotkeys';
import type { Engine } from '../engine/scene';
import { ScreensCell } from './ScreensDock';
import { CodeEditor, type CodeEditorHandle } from './CodeEditor';
import { functionAt, projectDecls, projectFunctions } from '../engine/xcproject';

const MAX_PARSE_LINES = 500;   // validation pass cap (window around the caret)
const fmtVal = (v: number | string) =>
  typeof v === 'number' ? (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(3)) : String(v).slice(0, 12);

export default function XenonDialog(p: {
  comp: XenonComputer;
  engine?: Engine | null;
  onClose: () => void;
  /** the virtual disk changed — the Editor writes bp + doc and re-boots */
  onFiles: (ci: number, files: XCFile[]) => void;
}) {
  const { comp } = p;
  const [, setTick] = useState(0);
  const [tab, setTab] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [dirty, setDirty] = useState<Set<number>>(new Set());
  const [files, setFiles] = useState<XCFile[]>(() => xcDiskFiles(comp));
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newProg, setNewProg] = useState(false);
  const [armedDel, setArmedDel] = useState(false);
  const [vals, setVals] = useState<Record<string, number>>({});
  const [side, setSide] = useState<'vars' | 'screens' | 'world' | 'bus' | 'console' | 'autotest'>('screens');
  const [varQ, setVarQ] = useState('');
  const [scrQ, setScrQ] = useState('');
  // ── AUTOTEST (v1.13.7, we: "a simple interface for automating that in
  // the editor, almost like a scripting language, so we can have an
  // interface for AI agents … so a craft can be diagnosed using that"):
  // a XenonTest script (engine/xenontest.ts) loads a probe program onto
  // THIS computer, advances it EXACTLY N cycles (deterministic — the rAF
  // loop is gated out), and evaluates asserts against the snapshot.
  // window.__XENONTEST__ is the programmatic door for automation.
  const [testSrc, setTestSrc] = useState(() =>
    comp.devices.some(d => d.alias === 'bench-horn')
      ? `# Buzzer Bench — the audio law end to end (XenonCode -> bus ->\n# WebAudio), plus the cockpit mirror: the program feeds the horn's\n# amplitude from the gamer-chair's Aux 1 (press F, re-run, watch amp).\nname: buzzer-bench\ncycles: 20\nassert:\n  - bus("bench-horn", 1) >= 440\n  - amp("bench-horn") >= 0.2\n  - wave("bench-horn") == "sawtooth"\n  - prints == 0\n  - cycles >= 20\n`
      : `# Craft diagnosis — asserts read the computer's live snapshot.\n# Optional "program: |" section boots a probe program onto this computer.\nname: ${comp.alias || comp.program}-check\ncycles: 20\nassert:\n  - cycles >= 20\n  - prints == 0\n`);
  const [testRes, setTestRes] = useState<XenonAssertResult[] | null>(null);
  const [testName, setTestName] = useState('');
  const [testBusy, setTestBusy] = useState(false);
  const runTest = async (text: string): Promise<XenonAssertResult[]> => {
    const t = parseXenonTest(text);
    setTestName(t.name);
    if (t.error) return [{ expr: '(script)', ok: false, actual: t.error }];
    setTestBusy(true);
    try {
      if (t.program) {
        // boot the probe program onto this computer (the SAME writeback
        // the disk editor uses: file + doc mirror, VM auto-reboots)
        const base = xcDiskFiles(comp);
        p.onFiles(comp.ci, base.map((f, i) => (i === 0 ? { ...f, code: t.program! } : f)));
        for (let i = 0; i < 100 && xenonPump.status !== 'running'; i++)
          await new Promise(r => setTimeout(r, 100));
        await new Promise(r => setTimeout(r, 300));
      }
      await xenonPump.runCycles(Math.max(0, Math.min(20000, t.cycles | 0)));
      const snap = xenonPump.snapshot();
      const res = t.asserts.map(a => evalAssert(a, snap));
      setTestRes(res);
      return res;
    } finally {
      setTestBusy(false);
    }
  };
  useEffect(() => {
    (window as any).__XENONTEST__ = {
      run: (text: string) => runTest(text),
      snapshot: () => xenonPump.snapshot(),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comp.ci]);
  // ── debugger (XENON-DEBUG v2, VS-Code keys): F9 breakpoint on the cursor
  // line, F10 STEP OVER (next executed line), F11 STEP INTO, F8 resume,
  // right-click ▸ Run to Cursor. Breakpoints are per-file line sets — the
  // pair stream is file-qualified, so breaks in ANY tab fire. The pill shows
  // WHERE: file:line @function (the project index names the function).
  const [bps, setBps] = useState<Record<number, Set<number>>>({});
  const [lastLine, setLastLine] = useState(0);          // 1-based caret (F9 target)
  const editorRef = useRef<CodeEditorHandle>(null);
  const [pendingJump, setPendingJump] = useState(0);
  // the game's OWN channel meanings (viewer/models/channels.json): an io
  // resolves to its cabled/aliased component TYPE, the channel to its
  // function — "io 4 · NavInstrument · ch 6 Heading", not a bare "ch 6"
  // (we: "the computer STILL does not resolve the component type of the
  // input, nor the meaning of the channels per input")
  const [chans, setChans] = useState<ChannelTable | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void loadChannelTable().then(c => { if (live) setChans(c); });
    return () => { live = false; };
  }, []);
  const devOf = (io: number | string) => comp.devices.find(d =>
    typeof io === 'number' ? d.io === io : d.alias === io);
  const chanLabel = (io: number | string | undefined, ch: number | undefined,
    dir: 'in' | 'out') => {
    if (io === undefined || ch === undefined) return null;
    const dev = devOf(io);
    return dev ? chanInfo(chans, dev.type, dir, ch) : null;
  };
  const closeRef = useRef(p.onClose);
  closeRef.current = p.onClose;
  const pump = xenonPump;
  // debug channel (the __ARCHEAN__ pattern, DEBUG builds): pump internals
  useEffect(() => {
    (window as any).__XENON__ = () => ({
      status: pump.status, cycles: pump.cycles, raf: pump.raf2(),
      running: pump.run?.running ?? null, surfaces: pump.surfaces.size,
      paused: pump.paused, error: pump.error,
      worker: !!pump.wrun, isolated: sabSupported(),
      surfaceKeys: [...pump.surfaces.keys()],
      surfaceMeta: [...pump.surfaces.values()].map(({ key, w, h }) => ({ key, w, h })),
      world: [...pump.wsBoundNames()].map(n => {
        const r = pump.wsChannels().find(c => c.name === n);
        return r ? { name: r.name, mode: r.mode, manual: r.manual, value: r.value } : null;
      }).filter(Boolean),
      pilotKeys: pump.pilotKeysBound(),
      cycleLines: pump.run?.cycleLines() ?? [],
      cyclePairs: pump.run?.cyclePairs() ?? [],
      debug: { paused: pump.paused, file: pump.pausedFile, line: pump.pausedLine,
        stepMode: pump.stepMode, breaks: [...pump.breaks.entries()].map(([f, s]) => [f, [...s]]) },
      // XENON-LOCALS audit: the panel's frame + the raw SAB handoff (slot 19
      // length + the JSON head the parked hook encoded)
      locals: pump.locals,
      handoff: (() => {
        const w = pump.wrun;
        if (!w) return null;
        const n = Atomics.load(w.i32, 19);
        return { len: n,
          head: n > 0 && n <= w.bytes.length - 80
            ? new TextDecoder().decode(new Uint8Array(w.bytes.slice(80, 80 + Math.min(n, 240)))) : '' };
      })(),
      project: { funcs: funcs.map(f => ({ name: f.name, file: f.file, line: f.line })),
        fileTable: pump.fileTable },
      bus: [...pump.bus.entries()].slice(-40),
      // v1.13.8 audit door (mirrors the __XENON__ base hook in Editor.tsx):
      // a surface's live framebuffer + the last input_number READS per io:ch.
      pixels: (key: string) => {
        const s = pump.surfaces.get(key);
        return s?.pixels ? { w: s.w, h: s.h, data: [...s.pixels!] } : null;
      },
      reads: () => Object.fromEntries(pump.reads),
      buzzer: {
        soundOn: buzzerAudio.soundOn, wave: buzzerAudio.wave, level: buzzerAudio.level,
        outputLevel: buzzerAudio.outputLevel(), voices: buzzerAudio.voiceCount(),
      },
    });
  }, [pump]);

  useEffect(() => pump.subscribe(() => setTick(t => t + 1)), [pump]);

  // WASD / ↑ / ↓ / F / Space / E (+ Q/I/K/J/L/R + the 1-9,0 Aux ladder) fly
  // the craft's PilotSeat WHILE THE
  // COMPUTER'S WINDOW IS OPEN — any tab (the Auto-test reads the seat too;
  // typing in fields is guarded by isTyping) (v1.13.2: "for when you are
  // looking at the dash window, or computer's dash window, pressing WASD,
  // up, down, and F should be given as inputs into the computer for all
  // cockpit connections it has")
  usePilotKeys(true);

  // Esc closes (subscribe ONCE through a ref — the v1.5.20 listener lesson);
  // Esc in the editor first COMMITS nothing — it reverts the draft.
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    addEventListener('keydown', h);
    return () => removeEventListener('keydown', h);
  }, []);

  // boot this computer on the pump (the pump is the single VM context: the
  // Screens dock and the 3-D feeds ride the SAME run)
  useEffect(() => {
    void pump.open(comp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comp.ci]);

  // the 3-D law: tell the engine which dashboards this computer drives
  useEffect(() => {
    p.engine?.setScreenFeeds(comp.screens
      .filter(s => s.ci != null)
      .map(s => ({ key: `${s.alias.toLowerCase()}#${s.channel}`, ci: s.ci!, channel: s.channel })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comp, p.engine]);

  const file = files[tab];
  // the RUN-side file names (the pump renames index 0 to entryName — the
  // debugger's file names, the go-to-definition targets, the project index
  // all key off THESE)
  const runtimeFiles = useMemo(() => files.map((f, i) => (
    { name: i === 0 ? comp.entryName : f.name, code: f.code })), [files, comp.entryName]);
  const runtimeName = (i: number) => runtimeFiles[i]?.name ?? files[i]?.name ?? '';
  const funcs = useMemo(() => projectFunctions(runtimeFiles), [runtimeFiles]);
  const decls = useMemo(() => projectDecls(runtimeFiles), [runtimeFiles]);
  const bpRows = useMemo(() => runtimeFiles.flatMap((f, i) =>
    [...(bps[i] ?? [])].sort((x, y) => x - y).map(line => ({
      file: f.name, line,
      fn: functionAt(funcs, f.name, line)?.name,
      code: (f.code.split('\n')[line - 1] ?? '').trim().slice(0, 42),
    }))), [bps, runtimeFiles, funcs]);
  const jumpTo = (fileName: string, line1: number) => {
    const idx = runtimeFiles.findIndex(f => f.name === fileName);
    if (idx < 0) return;
    setTab(idx); setEditing(false);
    setPendingJump(line1);
  };
  useEffect(() => {
    if (!pendingJump) return;
    const h = window.setTimeout(() => editorRef.current?.jumpTo(pendingJump), 60);
    setPendingJump(0);
    return () => window.clearTimeout(h);
  }, [pendingJump]);
  // validation: the REAL compiler (xc_parse_line) over a window around the
  // caret (the v1 visible-window law, kept bounded for 16k Badger files)
  const [errors, setErrors] = useState<Map<number, string> | undefined>(undefined);
  const lastTabRef = useRef(tab);
  lastTabRef.current = tab;
  const valSeqRef = useRef(0);
  useEffect(() => {
    const run = pump.run;
    const code = (editing && tab === lastTabRef.current ? draft : file?.code) ?? '';
    if (!run || !file) { setErrors(undefined); return; }
    const h = window.setTimeout(() => {
      const lines = code.split('\n');
      const a = Math.max(0, Math.min(lastLine || 1, lines.length) - 250);
      const b = Math.min(lines.length, a + MAX_PARSE_LINES);
      // BATCH validation (v1.13.17: one parse round-trip per window — the
      // worker mode answers it asynchronously; XenonRun resolves sync)
      const req: [string, number][] = [];
      for (let i = a; i < b; i++) {
        const s = lines[i]?.trim() ?? '';
        if (!s || s.startsWith(';') || s.startsWith('//') || s.startsWith('#')) continue;
        req.push([lines[i]!, i + 1]);
      }
      const seq = ++valSeqRef.current;
      void run.parseLines(req).then(errs => {
        if (seq !== valSeqRef.current) return;   // a newer window won the race
        const m = new Map<number, string>();
        errs.forEach((e, k) => { if (e) m.set(req[k]![1], e); });
        setErrors(m);
      });
    }, 300);
    return () => window.clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.name, draft, editing, pump.status, Math.max(0, Math.floor((lastLine || 1) / 200))]);
  const graph: XGraph | null = useMemo(() => parseNodes(files), [files]);
  const bindings = useMemo(() => xenonScreenBindings(comp), [comp]);
  const varList = useMemo(() => {
    const q = varQ.trim().toLowerCase();
    const all = [...pump.vars.values()];
    if (!q) return all;
    return all.filter(v => v.name.includes(q) || v.v.toLowerCase().includes(q)
      || (parseKv(v.v) ?? []).some(e => e.k.toLowerCase().includes(q) || e.v.toLowerCase().includes(q)));
  }, [pump.vars, varQ, pump.cycles]);
  // XENON-LOCALS: the paused frame (pump.locals), searched with the SAME
  // query the Vars tab uses (the search row is shared at the tab level)
  const locList = useMemo(() => {
    const q = varQ.trim().toLowerCase();
    const all = pump.locals;
    if (!q) return all;
    return all.filter(v => v.name.includes(q) || v.v.toLowerCase().includes(q));
  }, [pump.locals, varQ]);
  // recursion copies (same name, several stackIds) get a #s badge
  const locCopies = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of pump.locals) m.set(v.name, (m.get(v.name) ?? 0) + 1);
    return m;
  }, [pump.locals]);
  const surfList = useMemo(() => {
    const q = scrQ.trim().toLowerCase();
    const all = [...pump.surfaces.values()];
    if (!q) return all;
    return all.filter(s => s.key.includes(q) || (bindings.get(s.key) ?? '').toLowerCase().includes(q));
  }, [pump.surfaces, scrQ, bindings, pump.cycles]);
  const status = tab === 100 ? 'nodes' : 'code';

  const save = (_all: boolean) => {
    // the draft is the EDITOR's buffer: it may only land in the file while
    // editing (File ▸ Save while browsing must never blank the file)
    const merged = [...files];
    if (editing && tab < files.length) merged[tab] = { ...merged[tab]!, code: draft };
    setFiles(merged);
    setDirty(new Set());
    setEditing(false);
    p.onFiles(comp.ci, merged);
  };

  // Ctrl+S / Ctrl+Shift+S (behind typing: from the textarea the draft rides
  // in — save() reads it through the closure ref pattern)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's') return;
      e.preventDefault();
      save(e.shiftKey);
    };
    addEventListener('keydown', h);
    return () => removeEventListener('keydown', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, tab, draft, editing]);

  const startEdit = () => {
    setDraft(file?.code ?? '');
    setEditing(true);
  };
  const editChange = (v: string) => {
    setDraft(v);
    setDirty(m => new Set(m).add(tab));
  };

  const addFile = () => {
    let name = newName.trim();
    if (!name) return;
    if (newProg) name = name.replace(/\.xc$/i, '').replace(/\.main$/i, '') + '.main.xc';
    else if (!/\.xc$/i.test(name)) name += '.xc';
    if (files.some(f => f.name.toLowerCase() === name.toLowerCase())) { setNewOpen(false); return; }
    setFiles([...files, { name, code: newProg ? `\ninit\n\nupdate\n\n` : '' }]);
    setDirty(m => new Set(m).add(files.length));
    setNewOpen(false); setNewName('');
    // creating a file saves it to the virtual disk (game CTRL+N)
    p.onFiles(comp.ci, [...files, { name, code: newProg ? '\ninit\n\nupdate\n\n' : '' }]);
  };
  const delFile = () => {
    if (!armedDel) { setArmedDel(true); return; }
    setArmedDel(false);
    if (files.length <= 1) return;
    const next = files.filter((_, i) => i !== tab);
    setFiles(next);
    setDirty(new Set());
    setEditing(false);
    setTab(0);
    p.onFiles(comp.ci, next);
  };

  const toggleBp = (line1: number) => {
    setBps(m => {
      const s = new Set(m[tab] ?? []);
      if (s.has(line1)) s.delete(line1); else s.add(line1);
      return { ...m, [tab]: s };
    });
  };
  const toggleBpFile = (fileName: string, line1: number) => {
    const idx = runtimeFiles.findIndex(f => f.name === fileName);
    if (idx < 0) return;
    setBps(m => {
      const s = new Set(m[idx] ?? []);
      if (s.has(line1)) s.delete(line1); else s.add(line1);
      return { ...m, [idx]: s };
    });
  };

  const onCode = tab < files.length;
  const booting = pump.status === 'booting' || pump.status === 'idle';

  // XENON-DEBUG v2: breakpoints keyed by RUN-side file name — breaks in
  // inactive tabs fire too (the pair stream is file-qualified)
  useEffect(() => {
    pump.setBreaksMap(Object.fromEntries(
      runtimeFiles.map((f, i) => [f.name, bps[i] ?? new Set<number>()])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bps, runtimeFiles, pump]);

  // F9 break · F10/F11 step (one computer cycle) · F8 resume — the IDE's
  // debugger keys (the user asked for the IDE-class set; F5-run is not
  // feasible: the VM runs continuously at the pump's 25 Hz cadence, so
  // RUN is the default state and PAUSE/STEP are the meaningful controls)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'F8') { e.preventDefault(); pump.resume(); }
      else if (e.key === 'F9') {
        e.preventDefault();
        if (onCode && lastLine > 0) toggleBp(lastLine);
      } else if (e.key === 'F10') { e.preventDefault(); pump.stepOver(); }
      else if (e.key === 'F11') { e.preventDefault(); pump.stepInto(); }
    };
    addEventListener('keydown', h);
    return () => removeEventListener('keydown', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastLine, tab, onCode, bps]);

  return (
    <FloatingWindow
      id="xenon" testid="xenon-dialog" minW={720} minH={400}
      initial={(vw, vh) => {
        const w = Math.min(1400, vw * 0.97), h = vh * 0.94;
        return { x: (vw - w) / 2, y: (vh - h) / 2, w, h };
      }}
      className="font-mono"
      header={
        /* title bar - the drag handle (the ✕ is a button, excluded) */
        <div className="flex items-center justify-between bg-[#1a2436] px-3 py-1.5 text-[13px]">
          <span className="font-bold tracking-wide">XenonCode IDE ({comp.alias || comp.program})</span>
          <div className="flex items-center gap-3">
            <span data-testid="xenon-on" className={`text-[11px] font-bold ${pump.status === 'running' ? 'text-[#3ddc55]' : 'text-[#ff5b5b]'}`}>
              {pump.status === 'running' ? 'ON' : 'OFF'}
            </span>
            {pump.paused && (
              <span data-testid="xenon-paused" data-file={pump.pausedFile}
                data-line={pump.pausedLine} title="where the debugger stopped"
                className="rounded bg-[#4a3d14] px-2 py-0.5 text-[10px] font-bold text-[#e6c07b]">
                ⏸ {pump.pausedFile ? `${pump.pausedFile}:${pump.pausedLine}` : 'paused'}
                {functionAt(funcs, pump.pausedFile, pump.pausedLine)
                  ? ` @${functionAt(funcs, pump.pausedFile, pump.pausedLine)!.name}` : ''}
              </span>
            )}
            {pump.stepMode !== 'off' && !pump.paused && (
              <span data-testid="xenon-stepping" className="rounded bg-[#14304a] px-2 py-0.5
                     text-[10px] font-bold text-[#8fd4ff]">
                {pump.stepMode === 'over' ? 'stepping → next line'
                  : pump.stepMode === 'into' ? 'stepping → next pair' : 'running to cursor'}
              </span>
            )}
            <button data-testid="xenon-close" className="text-[#8a93a0] hover:text-white"
              onClick={p.onClose} aria-label="close">✕</button>
          </div>
        </div>
      }>
        {/* menu bar — real IDE dropdowns (we: "should it even nest?
            computer is what we are in, keep it a good menu structure like
            an IDE"): File owns the disk, Run owns the execution (incl. the
            debugger keys), Computer owns the machine (re-boot), Help the
            keys. The flat 'Options ▸ run' labels are gone. */}
        <MenuBar
          right={`cycles ${pump.cycles} @ ${CYCLE_HZ} Hz · CTRL+S save+reboot · screens clickable · WASD↑↓ space fly · QE roll · IK pitch · JL yaw · R thrust · 1-9/0 aux`}
          menus={[
            { label: 'File', testid: 'xmenu-file', entries: [
              { label: 'New file…', testid: 'file-new', on: () => { setNewProg(false); setNewOpen(true); } },
              { label: 'New program…', testid: 'file-new-prog', on: () => { setNewProg(true); setNewOpen(true); } },
              { label: 'Save', hint: 'Ctrl+S', testid: 'file-save', on: () => save(false), disabled: !onCode },
              { label: 'Save all', hint: 'Ctrl+Shift+S', testid: 'file-save-all', on: () => save(true), disabled: !onCode },
              { label: 'Delete current tab', testid: 'file-delete-tab', on: () => delFile(), disabled: files.length <= 1 },
            ] },
            { label: 'Run', testid: 'xmenu-run', entries: [
              { label: pump.status === 'running' ? 'Resume / continue' : 'Start', hint: 'F8', testid: 'run-resume', on: () => pump.startRunning() },
              { label: 'Pause', hint: 'F8', testid: 'run-pause', on: () => pump.pause(), disabled: pump.status !== 'running' },
              { label: pump.wrun ? 'Step next line' : 'Step next CYCLE (cycle-stepping ⚠)', hint: 'F10', testid: 'run-step', on: () => pump.stepOver() },
              { label: pump.wrun ? 'Step into @call' : 'Step into next CYCLE (cycle-stepping ⚠)', hint: 'F11', testid: 'run-step-into', on: () => pump.stepInto() },
              // the capability that is ABSENT on this origin, as a disabled
              // item (v1.13.18, we: "disable the relevant menu items AND show
              // a warning label") — never silently hidden
              ...(pump.wrun ? [] : [{
                label: sabSupported()
                  ? 'True line-stepping — worker starting…'
                  : 'True line-stepping — needs http://localhost:PORT (unavailable here)',
                testid: 'run-lines-exact', on: () => undefined, disabled: true,
              }]),
              { label: 'Stop', testid: 'run-stop', on: () => pump.stopRunning() },
              { label: 'Toggle breakpoint', hint: 'F9', testid: 'run-breakpoint', on: () => { if (onCode && lastLine > 0) toggleBp(lastLine); }, disabled: !onCode || lastLine <= 0 },
            ] },
            { label: 'Computer', testid: 'xmenu-computer', entries: [
              { label: 'Re-boot (files from disk)', testid: 'computer-reboot', on: () => pump.reboot() },
            ] },
            { label: 'Help', testid: 'xmenu-help', entries: [
              { label: 'F9 break · F10 over · F11 into · F8 resume · Ctrl+S save', testid: 'help-keys', on: () => undefined },
              { label: 'Right-click: definition · run-to-cursor · breakpoints', testid: 'help-ctx', on: () => undefined },
              { label: 'Type $ for variables, @ for declared functions', testid: 'help-complete', on: () => undefined },
            ] },
          ]}
        />

        {/* the File dialog: virtual-disk operations (the files are BAKED INTO
            THE CRAFT json — add/remove them freely, they save with the craft) */}
        {newOpen && (
          <div data-testid="xenon-file-dialog"
            className="flex flex-nowrap items-center gap-2 overflow-x-auto border-b border-[#2b313b] bg-[#10182a] px-3 py-1.5 text-[11px] [scrollbar-width:thin]">
            <span className="text-[#9fb0c8]">Virtual disk — {files.length} file(s):</span>
            {files.map((f, i) => (
              <span key={f.name} data-testid={`xenon-disk-${i}`}
                className={`rounded bg-[#1a2233] px-1.5 py-0.5 ${i === tab ? 'text-[#8fd4ff]' : 'text-[#7d8aa0]'}`}>
                {f.name}{dirty.has(i) ? ' ●' : ''}
              </span>
            ))}
            <span className="mx-2 text-[#3f4b5f]">|</span>
            <input data-testid="xenon-new-name" value={newName} placeholder="new-file / program-name"
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addFile(); }}
              className="w-44 rounded border border-[#2b3a52] bg-[#0b0f18] px-1.5 py-0.5 text-[11px]" />
            <label className="flex items-center gap-1 text-[#9fb0c8]">
              <input data-testid="xenon-new-prog" type="checkbox" checked={newProg}
                onChange={e => setNewProg(e.target.checked)} /> program (.main.xc)
            </label>
            <button data-testid="xenon-new-ok" className="rounded bg-[#2b4a2b] px-2 py-0.5 hover:bg-[#38603a]"
              onClick={addFile}>+ create</button>
            <button data-testid="xenon-del-file"
              className={`rounded px-2 py-0.5 ${armedDel ? 'bg-[#6a1b1b] hover:bg-[#8a2424]' : 'bg-[#33202a] hover:bg-[#4a2836]'}`}
              onClick={delFile}>{armedDel ? 'sure?' : '✕ delete tab'}</button>
          </div>
        )}
        <div className="flex min-h-0 flex-1 gap-2 overflow-hidden p-2">
          {/* LEFT COLUMN: the file-tab strip rides ABOVE the code; the
              COMPUTER SIDE PANEL stands to its right, top to bottom
              (v1.13.x: "Variables/screens should be to the side of the
              enumerated files, and the window should be larger") */}
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {/* tabs — every HDD file, dirty-marked; ONE row, scrollable
              (we: "File shouldn't show more than one line at a time") */}
          <div className="flex shrink-0 items-center gap-1.5">
          <div data-testid="xenon-tabstrip" className="flex min-w-0 flex-1 flex-nowrap items-center gap-1 overflow-x-auto rounded border border-[#2b313b] bg-[#121826] px-2 py-1 text-[12px] [scrollbar-width:thin]">
          {files.map((f, i) => (
            <button key={f.name} data-testid={`xenon-tab-${i}`}
              onClick={() => { setTab(i); setEditing(false); setArmedDel(false); }}
              className={`rounded-t px-3 py-1 ${tab === i ? 'bg-[#10141f] text-[#8fd4ff]' : 'bg-[#1a2233] text-[#7d8aa0]'}`}>
              {i === 0 ? `${comp.program}.main.xc` : f.name}{dirty.has(i) ? ' ●' : ''}
            </button>
          ))}
          {graph && (
            <button data-testid="xenon-tab-nodes" onClick={() => setTab(100)}
              className={`rounded-t px-3 py-1 ${tab === 100 ? 'bg-[#10141f] text-[#8fd4ff]' : 'bg-[#1a2233] text-[#7d8aa0]'}`}>
              ⌗ nodes ({graph.nodes.length})
            </button>
          )}
          </div>
          {/* edit/save actions ride BESIDE the strip (never clipped by it) */}
          <div className="flex shrink-0 items-center gap-1 text-[11px]">
          {onCode && !editing && (
            <button data-testid="xenon-edit" className="rounded bg-[#1d2c46] px-2 py-0.5
                   hover:bg-[#27395c]" onClick={startEdit}>✎ edit</button>
          )}
          {onCode && editing && (<>
            <button data-testid="xenon-save" className="rounded bg-[#2b4a2b] px-2 py-0.5
                   hover:bg-[#38603a]" onClick={() => save(false)}>💾 save</button>
            <button data-testid="xenon-save-all" className="rounded bg-[#243a52] px-2 py-0.5
                   hover:bg-[#2f4c6b]" onClick={() => save(true)}>⇩ all</button>
            <button data-testid="xenon-edit-cancel" className="px-1.5 py-0.5 text-[#8a93a0]
                   hover:bg-[#27395c]" onClick={() => setEditing(false)}>↺ revert</button>
          </>)}
          </div>
          </div>

          {/* code / nodes */}
          <div data-testid={`xenon-code-${tab}`} data-mode={status}
            className="min-h-0 flex-1 overflow-hidden rounded border border-[#232c3d] bg-[#0b0f18] text-[12px] leading-[1.45]">
            {onCode && file && (
              <CodeEditor ref={editorRef}
                file={runtimeFiles[tab] ?? file} tabKey={`${comp.ci}:${tab}`}
                editable={editing} onChange={editChange} onSave={() => save(false)}
                breaks={bps[tab] ?? new Set()}
                pausedLine={pump.pausedFile === runtimeName(tab) ? pump.pausedLine : 0}
                errors={editing ? undefined : errors}
                funcs={funcs} decls={decls}
                varList={[...pump.vars.values()].map(v => ({ ...v, name: '$' + v.name.replace(/^\$/, '') }))}
                devices={comp.devices.filter(d => d.alias).map(d => ({ alias: d.alias!, type: d.type }))}
                getVar={(n) => { const v = pump.varValue(n); return v ? { v: v.v, type: varKind(v.t) } : undefined; }}
                debugActive={pump.status === 'running' || pump.status === 'stopped'}
                onToggleBreak={(l) => toggleBp(l)}
                onRunTo={(l) => pump.runTo(runtimeName(tab), l)}
                onGoDef={(f, l) => jumpTo(f, l)}
                onLine={(l) => setLastLine(l)} />
            )}
            {tab === 100 && graph && (
              <NodeGraph graph={graph} reads={pump.reads} bus={pump.bus}
                chanLabel={(io, ch) => chanLabel(io, ch, 'out')?.fn ?? null} />
            )}
          </div>

          {/* BREAKPOINT OVERVIEW (we: "we dont have an overview window for
              breakpoints"): every break, in every file, with its enclosing
              function and code excerpt; click jumps, ✕ removes */}
          {bpRows.length > 0 && (
            <div data-testid="bp-overview"
              className="flex max-h-24 shrink-0 flex-wrap items-start gap-1 overflow-y-auto rounded border border-[#2b313b] bg-[#121826] px-2 py-1 text-[10px] [scrollbar-width:thin]">
              <span className="pt-0.5 text-[#9fb0c8]">BREAKPOINTS {bpRows.length}:</span>
              {bpRows.map((r, i) => (
                <button key={`${r.file}:${r.line}`} data-testid={`bp-row-${i}`}
                  onClick={() => jumpTo(r.file, r.line)}
                  title={`${r.file}:${r.line}${r.fn ? ' @' + r.fn : ''} — ${r.code}`}
                  className="rounded bg-[#2a1520] px-1.5 py-0.5 text-[#ffb3b3] hover:bg-[#3a1d2a]">
                  {r.file}:{r.line}{r.fn ? ` @${r.fn}` : ''}
                  <span role="button" aria-label="remove breakpoint"
                    className="ml-1 text-[#8a93a0] hover:text-[#ff5b5b]"
                    onClick={(e) => { e.stopPropagation(); toggleBpFile(r.file, r.line); }}>✕</span>
                </button>
              ))}
            </div>
          )}

          </div>

          {/* right: THE COMPUTER SIDE PANEL — tabbed: Vars / Screens / Bus /
              Console (v1.13.x: "the computer should have a side-panel you can
              tab through, you should be able to see variables there, which
              automatically breaks open its KV structure … one of the side
              tabs to be the screens and virtual screens … search
              names/values in vars, and also names of screens") */}
          <div className="flex min-h-0 flex-1 flex-col gap-1.5">
            {/* TOP TAB ROW (v1.13.21, we: "put the tabs currently vertically
                labeled as top-tabs at the same level as the 'search
                names/values'"): the rail becomes a horizontal row and the
                tab's search box rides that SAME row */}
            <div className="flex shrink-0 flex-wrap items-center gap-1">
              {([['vars', `Vars ${pump.vars.size ? `(${pump.vars.size})` : ''}${pump.locals.length ? ` + frame ${pump.locals.length}` : ''}`],
                ['screens', `Screens ${pump.surfaces.size ? `(${pump.surfaces.size})` : ''}`],
                ['world', `World ${pump.wsChannels().length ? `(${pump.wsChannels().length})` : ''}`],
                ['bus', 'Bus'], ['autotest', 'Auto'], ['console', 'Console']] as const).map(([k, label]) => (
                <button key={k} data-testid={`xenon-side-${k}`} onClick={() => setSide(k)}
                  className="shrink-0 rounded px-2 py-1 text-[10px] tracking-wide hover:bg-[#182236]"
                  title={label.trim()}>
                  <span className={side === k ? 'rounded bg-[#1d2b42] px-1 py-0.5 text-[#8fd4ff]' : 'text-[#7d8aa0]'}>{label.trim()}</span>
                </button>
              ))}
              <div className="min-w-0 flex-1">
                {side === 'vars' && (
                  <input data-testid="xenon-var-search" value={varQ} placeholder="search names / values…"
                    onChange={e => setVarQ(e.target.value)}
                    className="w-full rounded border border-[#2b3a52] bg-[#0b0f18] px-2 py-1 text-[11px] outline-none" />
                )}
                {side === 'screens' && (
                  <input data-testid="xenon-screen-search" value={scrQ} placeholder="search screen names…"
                    onChange={e => setScrQ(e.target.value)}
                    className="w-full rounded border border-[#2b3a52] bg-[#0b0f18] px-2 py-1 text-[11px] outline-none" />
                )}
              </div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
            {side === 'vars' && (<>
              {/* VARS AND LOCALS CO-HABIT, LOCALS ALWAYS ON TOP (v1.13.22,
                  we: "vars and locals should co-habit the same tab, with
                  locals always on top"): the paused frame first — a frame
                  is born at a debugger STOP and dies at resume (it only
                  exists while the VM is parked mid-update), which is why
                  running programs show only globals below — then the
                  globals, live every cycle. One search filters both. */}
              <div className="flex items-baseline justify-between gap-2 text-[10px]">
                <span data-testid="xenon-locals-frame" className="truncate text-[#e6c07b]">
                  <span className="uppercase tracking-widest text-[#5d6a7d]">Locals</span>
                  {pump.paused
                    ? ` · paused at ${pump.pausedFile}:${pump.pausedLine}${pump.localsFrame() ? ` ${pump.localsFrame()}` : ' (top level)'}`
                    : pump.locals.length > 0
                      ? ` · last stop ${pump.pausedFile}:${pump.pausedLine}${pump.localsFrame() ? ` ${pump.localsFrame()}` : ''} · stale (running)`
                      : ' · appear at a debugger stop — click a line\u2019s gutter, step with F10/F11'}
                </span>
                {pump.paused && <span className="shrink-0 text-[#8fd48f]">live frame</span>}
              </div>
              {locList.map(v => {
                const kv = parseKv(v.v);
                const kind = varKind(v.t);
                return (
                  <div key={`${v.name}#${v.s}`} data-testid={`xenon-loc-${v.name}`}
                    className="rounded border border-[#2b3a52] bg-[#152036] px-2 py-1 text-[11px]">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[#8fd48f]">${v.name}
                        {kind === 'array' && <span className="ml-1 text-[9px] text-[#5d6a7d]">array</span>}
                        {kind === 'object' && <span className="ml-1 text-[9px] text-[#5d6a7d]">object</span>}
                        {(locCopies.get(v.name) ?? 0) > 1 &&
                          <span className="ml-1 rounded bg-[#1d2b42] px-1 text-[9px] text-[#8fd4ff]">#{v.s}</span>}
                      </span>
                      <span className="truncate text-right tabular-nums text-[#d6dbe1]" title={v.v}>
                        {kv ? `{${kv.length}}` : v.v === '' ? '·' : v.v.length > 28 ? v.v.slice(0, 28) + '…' : v.v}
                      </span>
                    </div>
                    {kv && (
                      <div className="ml-3 border-l border-[#2b3a52] pl-2">
                        {kv.map(e => (
                          <div key={e.k} className="flex justify-between gap-2 text-[10px]">
                            <span className="text-[#7ea6ff]">.{e.k}</span>
                            <span className="truncate tabular-nums text-[#9fb0c8]">{e.v === '' ? '·' : e.v}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {locList.length === 0 && pump.paused && (
                <span className="text-[11px] text-[#5d6a7d]">
                  {pump.localsFrame()
                    ? 'no locals recorded for this body'
                    : 'top-level frame — these variables are globals (below)'}
                </span>
              )}
              <div data-testid="xenon-globals-head" className="text-[10px] uppercase tracking-widest text-[#5d6a7d]">
                Globals {pump.vars.size ? `· ${pump.vars.size} live` : ''}
              </div>
              {varList.map(v => {
                const kv = parseKv(v.v);
                const kind = varKind(v.t);
                const storage = v.t === 50 || v.t === 51 || v.t === 60 || v.t === 61;
                return (
                  <div key={v.name} data-testid={`xenon-var-${v.name}`}
                    className="rounded border border-[#232c3d] bg-[#131a28] px-2 py-1 text-[11px]">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[#8fd48f]">${v.name}
                        {storage && <span className="ml-1 rounded bg-[#332a1a] px-1 text-[9px] text-[#e6c07b]">storage</span>}
                        {kind === 'object' && <span className="ml-1 text-[9px] text-[#5d6a7d]">screen obj</span>}
                      </span>
                      <span className="truncate text-right tabular-nums text-[#d6dbe1]" title={v.v}>
                        {kv ? `{${kv.length}}` : v.v === '' ? '·' : v.v.length > 28 ? v.v.slice(0, 28) + '…' : v.v}
                      </span>
                    </div>
                    {kv && (
                      <div className="ml-3 border-l border-[#2b3a52] pl-2">
                        {kv.map(e => (
                          <div key={e.k} data-testid={`xenon-kv-${v.name}-${e.k}`}
                            className="flex justify-between gap-2 text-[10px]">
                            <span className="text-[#7ea6ff]">.{e.k}</span>
                            <span className="truncate tabular-nums text-[#9fb0c8]">{e.v === '' ? '·' : e.v}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {varList.length === 0 && (
                <span className="text-[11px] text-[#5d6a7d]">
                  {pump.vars.size === 0 ? 'no variables yet (booting?)' : 'no variable matches'}
                </span>
              )}
            </>)}
            {side === 'screens' && (<>
              {booting && <span className="text-[11px] text-[#5d6a7d]">booting…</span>}
              {!booting && surfList.length === 0 && (
                <span className="text-[11px] text-[#5d6a7d]">no surfaces match</span>
              )}
              <div className="flex flex-wrap gap-2">
                {surfList.map(s => (
                  <ScreensCell key={s.key} surfKey={s.key} w={s.w} h={s.h}
                    canvasTestid={`xenon-screen-${s.key}`} testid={`xenon-cell-${s.key}`}
                    label={`${bindings.get(s.key) ?? s.key}${s.key.startsWith('virtual#') ? ' ·virtual' : ''}`} />
                ))}
              </div>
            </>)}
            {side === 'world' && (<>
              {/* WORLDSIM (engine/worldsim.ts): every input channel is a
                  function of t seconds, evaluated each cycle — defaults fly
                  the craft at 2000 m / 80 m/s. setworldsim(name, v) from the
                  program overrides a row; pow(10,40) releases it;
                  getworldsim(name) answers the live value. */}
              <div className="rounded border border-[#232c3d] bg-[#131a28] p-2 text-[10px] leading-snug text-[#5d6a7d]">
                Worldsim — each input is a function of <span className="text-[#8fd48f]">t</span> (elapsed
                seconds), fed to the computer every cycle. Defaults: level flight
                2000 m, 80 m/s. From the program: <span className="text-[#8fd48f]">setworldsim(&quot;name&quot;, v)</span>
                {' '}overrides a row (<span className="text-[#8fd48f]">pow(10,40)</span> releases),{' '}
                <span className="text-[#8fd48f]">getworldsim(&quot;name&quot;)</span> reads it.
              </div>
              <WorldSimList pump={pump} /></>)}
            {side === 'bus' && (<>
              <div className="rounded border border-[#232c3d] bg-[#131a28] p-2 text-[11px]">
                <div className="mb-1 text-[10px] uppercase tracking-widest text-[#5d6a7d]">
                  Inputs (io · channel → value)</div>
                {comp.channels.map(c => {
                  const dev = devOf(c.io);
                  const ci = chanLabel(c.io, c.ch, 'out');     // what the device SENDS on ch
                  return (
                  <label key={`${c.io}.${c.ch}`} className="grid grid-cols-[124px_1fr_44px] items-center gap-2">
                    <span className="truncate text-[#9fb0c8]"
                      title={ci ? `${dev?.alias || dev?.type || c.io} ch ${c.ch} — ${ci.fn} (${ci.rng})`
                        : `${dev?.alias || dev?.type || c.io} ch ${c.ch}`}>
                      {dev?.alias || dev?.type || c.io} · ch {c.ch}{ci && <span className="text-[#8fd48f]"> {ci.fn}</span>}</span>
                    <input type="range" min={-1} max={1} step={0.05}
                      data-testid={`xenon-in-${c.io}-${c.ch}`}
                      value={vals[`${c.io}.${c.ch}`] ?? 0}
                      onChange={e => {
                        const v = +e.target.value;
                        setVals(m => ({ ...m, [`${c.io}.${c.ch}`]: v }));
                        pump.setInput(c.io, c.ch, v);
                      }} />
                    <span className="text-right tabular-nums">{(vals[`${c.io}.${c.ch}`] ?? 0).toFixed(2)}</span>
                  </label>);
                })}
                {comp.channels.length === 0 && <span className="text-[#5d6a7d]">no input_number() channels detected</span>}
              </div>
              <div className="rounded border border-[#232c3d] bg-[#131a28] p-2 text-[11px]">
                <div className="mb-1 text-[10px] uppercase tracking-widest text-[#5d6a7d]">io bus (output_number)</div>
                <div className="grid grid-cols-[1fr_28px_64px] gap-x-2">
                  {[...pump.bus.entries()].slice(-24).map(([k, v]) => {
                    const [io = '', port = '0'] = k.split(':');
                    const ioKey = /^\d+$/.test(io) ? +io : io;
                    const dev = devOf(ioKey);
                    const ci = chanLabel(ioKey, +(port ?? '0'), 'in');   // meaning of ch port ON the device
                    return (
                      <div key={k} className="contents">
                        <span className="truncate text-[#9fb0c8]"
                          title={dev && ci ? `${dev.alias || dev.type} ch ${port} — ${ci.fn} (${ci.rng})`
                            : dev ? `io ${io} = ${dev.alias || dev.type}` : io}>
                          {dev ? `${dev.alias || dev.type}` : io}{ci && <span className="text-[#8fd48f]"> {ci.fn}</span>}</span>
                        <span className="text-[#5d6a7d]">{port}</span>
                        <span className="text-right tabular-nums text-[#8fd48f]">{fmtVal(v)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              {/* BUZZERS (v1.13.2, we: "buzzers should be implemented, with
                  square/sawtooth, and the frequency") — the game's Buzzer
                  plays sine/square/triangle/sawtooth tones; Amplitude is
                  ch 0 and Frequency (Hz) ch 1 of its data channel, so the
                  io-bus rows above ARE the drive values. engine/buzzer.ts
                  renders them as WebAudio (one oscillator per buzzer — the
                  wiki's multi-tone law). */}
              {comp.devices.some(d => d.type === 'Buzzer') && (
                <div data-testid="xenon-buzzer-card"
                  className="rounded border border-[#232c3d] bg-[#131a28] p-2 text-[11px]">
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-widest text-[#5d6a7d]">
                    Buzzers ({comp.devices.filter(d => d.type === 'Buzzer').length})
                    <button data-testid="buzzer-sound"
                      title="the browser allows sound only after a click — this toggle is that click"
                      onClick={() => { buzzerAudio.toggleSound(); setTick(t => t + 1); }}
                      className={`rounded px-2 py-0.5 text-[10px] normal-case tracking-normal ${
                        buzzerAudio.soundOn ? 'bg-[#2b4a2b] text-[#8fd48f]' : 'bg-[#33202a] text-[#e6a07b]'}`}>
                      {buzzerAudio.soundOn ? '🔊 sound on' : '🔇 muted'}
                    </button>
                    <span className="ml-auto flex gap-1 normal-case tracking-normal">
                      {(['auto', ...BUZZER_MODES] as const).map(w => (
                        <button key={w} data-testid={`buzzer-wave-${w}`}
                          title={w === 'auto'
                            ? 'each buzzer plays the tone its COMPONENT authored (data.mode) — the game law'
                            : `force ${w} on every buzzer (override)`}
                          onClick={() => { buzzerAudio.setWave(w as BuzzerWave | 'auto'); setTick(t => t + 1); }}
                          className={`rounded px-1.5 py-0.5 text-[10px] ${
                            buzzerAudio.wave === w ? 'bg-[#243a52] text-[#8fd4ff]' : 'bg-[#1a2233] text-[#7d8aa0]'}`}>
                          {w}
                        </button>
                      ))}
                    </span>
                  </div>
                  {buzzerReadings(pump).map(r => (
                    <div key={r.name} data-testid={`buzzer-row-${r.name}`}
                      className="grid grid-cols-[1fr_58px_46px_64px] gap-x-2">
                      <span className="truncate text-[#9fb0c8]" title={r.name}>{r.name}</span>
                      <span className="text-right tabular-nums text-[#8fd48f]" title="Amplitude (ch 0)">{r.amp.toFixed(2)}</span>
                      <span className="text-right tabular-nums text-[#d6dbe1]" title="Frequency (ch 1)">
                        {Math.round(r.freq)} Hz</span>
                      <span className="truncate text-[9px] text-[#5d6a7d]"
                        title="the tone its component authored (data.mode) — auto mode plays it"
                        data-testid={`buzzer-tone-${r.name}`}>{r.wave}</span>
                    </div>
                  ))}
                  <div className="mt-1 text-[9px] leading-snug text-[#5d6a7d]">
                    Amplitude = ch 0, Frequency = ch 1 (wiki Buzzer.md) — programs drive them
                    with <span className="text-[#8fd48f]">output_number(alias, ch, v)</span>.
                    The wave is the component's tone-type config (the game&apos;s V menu);
                    one oscillator per buzzer = simultaneous tones.
                  </div>
                </div>
              )}
            </>)}
            {side === 'autotest' && (<>
              {/* THE AUTOTEST PANEL (v1.13.7): a XenonTest script runs on
                  THIS computer — optional probe program, exactly N
                  deterministic cycles, asserts over the live snapshot.
                  window.__XENONTEST__.run(text) is the same door for AI
                  agents and headless probes. */}
              <textarea
                data-testid="xenon-test-src" value={testSrc} spellCheck={false}
                onChange={e => setTestSrc(e.target.value)}
                className="min-h-[120px] w-full resize-y rounded border border-[#2b3a52] bg-[#0b0f18] px-2 py-1 font-mono text-[11px] leading-snug text-[#d6dbe1] outline-none" />
              <div className="flex items-center gap-2">
                <button data-testid="xenon-test-run" disabled={testBusy}
                  onClick={() => void runTest(testSrc)}
                  className="rounded bg-[#2b4a2b] px-3 py-1 text-[11px] hover:bg-[#38603a] disabled:opacity-50">
                  {testBusy ? 'running…' : '▶ run test'}
                </button>
                <span data-testid="xenon-test-summary" className="text-[11px] tabular-nums">
                  {testRes && (() => {
                    const pass = testRes.filter(r => r.ok).length;
                    return `${testName}: ${pass}/${testRes.length} ${pass === testRes.length ? 'PASS' : 'FAIL'}`;
                  })()}
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                {(testRes ?? []).map((r, i) => (
                  <div key={i} data-testid={`xenon-test-result-${i}`} data-ok={r.ok ? '1' : '0'}
                    className={`flex justify-between gap-2 rounded px-2 py-0.5 font-mono text-[11px] ${
                      r.ok ? 'bg-[#12281a] text-[#8fd48f]' : 'bg-[#2a1520] text-[#ff9a9a]'}`}>
                    <span className="truncate">{r.expr}</span>
                    <span className="shrink-0 tabular-nums">{r.ok ? '✓' : `= ${r.actual}`}</span>
                  </div>
                ))}
                {testRes === null && (
                  <span className="text-[11px] text-ink-dim">
                    asserts: bus("alias", ch) · amp("alias") · freq("alias") · wave("alias") · cycles · prints — with == != &gt;= &lt;= &gt; &lt;
                  </span>
                )}
              </div>
            </>)}
            {side === 'console' && (
              <div data-testid="xenon-log" className="min-h-[70px] flex-1 overflow-y-auto rounded border border-[#232c3d] bg-[#0b0f18] p-2 text-[11px]">
                {pump.prints.slice(-60).map((e, i) => (
                  <div key={i} className="text-[#d6dbe1]">print: {String(e.v)}</div>
                ))}
                {pump.prints.length === 0 && (
                  <div className="text-[#5d6a7d]">no prints yet</div>
                )}
              </div>
            )}
            </div>
          </div>
        </div>

        {/* status lines (in-game parity) */}
        <div className="border-t border-[#2b313b] bg-[#141b28] px-3 py-1 text-[11px]">
          <div className={pump.status === 'error' ? 'text-[#ff5b5b]' : 'text-[#3ddc55]'}>
            {pump.status === 'error' ? `Program '${comp.program}' crashed: ${pump.error}`
              : `Program '${comp.program}' loaded`}</div>
          {pump.status === 'running' && <div className="text-[#7ea6ff]">Program '{comp.program}' is running…</div>}
          {/* DEBUGGER MODE CHIP (v1.13.18, we: "the application MUST CLEARLY
              announce this degradation in capabilities"): which stepper is
              LIVE (pump.wrun, not the gate) — a booting/absent worker on a
              gated origin reads honestly, never a silent lie. */}
          <div data-testid="xenon-mode"
            title={pump.wrun
              ? 'The VM runs on a worker: breakpoints + F10/F11 freeze it MID-CYCLE'
              : sabSupported()
                ? 'Worker debugger starting on this origin'
                : 'This origin is not a secure, cross-origin-isolated context (use http://localhost:PORT or https): the browser withholds SharedArrayBuffer, so stepping advances one full 25 Hz cycle per F10/F11 and breakpoints fire at cycle boundaries'}
            className={pump.wrun ? 'text-emerald-400/90' : 'text-amber-400/90'}>
            {pump.wrun
              ? <>debugger: <b>worker · true line-stepping</b></>
              : sabSupported()
                ? <>debugger: worker starting…</>
                : <>⚠ debugger: <b>main-thread · cycle-granular</b> — each step advances a full cycle (true line-stepping needs http://localhost:PORT)</>}
          </div>
        </div>
    </FloatingWindow>
  );
}

// ---------------------------------------------------------------------------
// The visual-program graph (#NODES): DOM cards + SVG wires, pan + zoom.
// Colours follow the in-game node editor (green inputs, purple outputs, blue
// math, orange utility); the LIVE values: InputNode = the value last READ
// from its io/channel's component, OutputNode = the io bus value per port.

function nodeColor(type: string): string {
  if (type.startsWith('Input')) return '#2e7d32';
  if (type.startsWith('Output')) return '#6a1b9a';
  if (type.startsWith('MathNode')) return '#1565c0';
  if (type.startsWith('Counter') || type.startsWith('Timer') || type.startsWith('PID')) return '#ef6c00';
  return '#37474f';
}

function NodeGraph(p: {
  graph: XGraph; reads: Map<string, number>; bus: Map<string, number | string>;
  chanLabel?: (io: number | undefined, ch: number | undefined) => string | null;
}) {
  const { graph } = p;
  const boxRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 20, y: 20, k: 0.6 });
  const drag = useRef<{ px: number; py: number } | null>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const xs = graph.nodes.map(n => n.x), ys = graph.nodes.map(n => n.y);
    const x2 = graph.nodes.map(n => n.x + n.w), y2 = graph.nodes.map(n => n.y + n.h);
    const bw = Math.max(...x2) - Math.min(...xs), bh = Math.max(...y2) - Math.min(...ys);
    const k = Math.min(el.clientWidth / (bw + 60), el.clientHeight / (bh + 60), 1.2);
    setView({ k, x: (el.clientWidth - bw * k) / 2 - Math.min(...xs) * k,
              y: (el.clientHeight - bh * k) / 2 - Math.min(...ys) * k });
  }, [graph]);

  const byId = useMemo(() => new Map(graph.nodes.map(n => [n.id, n])), [graph]);
  const minX = Math.min(...graph.nodes.map(n => n.x));
  const minY = Math.min(...graph.nodes.map(n => n.y));

  return (
    <div ref={boxRef} data-testid="xenon-nodes" className="relative h-full max-h-[560px] w-full overflow-hidden
         cursor-grab bg-[#0b0f18]"
      onPointerDown={e => { drag.current = { px: e.clientX - view.x, py: e.clientY - view.y }; }}
      onPointerMove={e => {
        if (!drag.current) return;
        setView(v => ({ ...v, x: e.clientX - drag.current!.px, y: e.clientY - drag.current!.py }));
      }}
      onPointerUp={() => { drag.current = null; }}
      onWheel={e => {
        const r = boxRef.current?.getBoundingClientRect();
        if (!r) return;
        const mx = e.clientX - r.left, my = e.clientY - r.top;
        setView(v => {
          const k2 = Math.min(4, Math.max(0.08, v.k * (e.deltaY < 0 ? 1.12 : 0.89)));
          return { k: k2, x: mx - ((mx - v.x) / v.k) * k2, y: my - ((my - v.y) / v.k) * k2 };
        });
      }}>
      <div className="absolute left-0 top-0" style={{ transform: `translate(${view.x}px,${view.y}px) scale(${view.k})`, transformOrigin: '0 0' }}>
        <svg className="absolute" width={1} height={1} style={{ left: minX, top: minY, overflow: 'visible', pointerEvents: 'none' }}>
          {graph.links.map((l, i) => {
            const a = byId.get(l.from), b = byId.get(l.to);
            if (!a || !b) return null;
            const ax = a.x + a.w, ay = a.y + a.h / 2;
            const by = b.y + 16 + (b.h - 20) * ((l.port + 0.5) / Math.max(b.inputs.length, 1));
            return <path key={i} d={`M ${ax - minX} ${ay - minY} C ${ax + 40 - minX} ${ay - minY}, ${b.x - 40 - minX} ${by - minY}, ${b.x - minX} ${by - minY}`}
              stroke="#8899c8" strokeWidth={1.4 / view.k} fill="none" />;
          })}
        </svg>
        {graph.nodes.map(n => {
          const isInput = n.type.startsWith('Input');
          const isOutput = n.type.startsWith('Output');
          const inVal = isInput && n.ioNumber != null ? p.reads.get(`${n.ioNumber}:${n.channel ?? 0}`) : undefined;
          return (
            <div key={n.id} data-testid={`xenon-node-${n.id}`}
              className="absolute overflow-hidden rounded border border-[#2b3a52] bg-[#16202e] text-[9px] leading-[12px]"
              style={{ left: n.x, top: n.y, width: Math.max(n.w, 90), height: n.h }}>
              <div className="h-[14px] truncate px-1 text-[10px] leading-[14px] text-white"
                style={{ background: nodeColor(n.type) }}>{n.title}</div>
              {(isInput || isOutput) && (
                <div className="px-1 pt-0.5 text-[#c8d4e8]">
                  {isInput ? `io ${n.ioNumber ?? '?'}  ch ${n.channel ?? '?'}` : `io ${n.ioNumber ?? '?'}  (write)`}
                  {isInput && p.chanLabel?.(n.ioNumber, n.channel) && (
                    <span data-testid={`xenon-chan-${n.id}`} className="ml-1 text-[#e6c07b]">
                      {p.chanLabel(n.ioNumber, n.channel)}
                    </span>
                  )}
                  {isInput && (
                    <span data-testid={`xenon-nodeval-${n.id}`} className="ml-1 font-bold text-[#8fd48f]">
                      = {inVal === undefined ? '·' : fmtVal(inVal)}
                    </span>
                  )}
                </div>
              )}
              {n.inputs.map((src, i) => {
                const outV = isOutput && n.ioNumber != null ? p.bus.get(`${n.ioNumber}:${i}`) : undefined;
                const v = n.inputValues?.[i];
                const label = src ? (byId.get(src)?.title ?? '?')
                  : v !== undefined && v !== '' ? `= ${v}` : '·';
                return (
                  <div key={i} className="flex items-center justify-between px-1 text-[#9fb0c8]">
                    <span className="truncate">· {label}</span>
                    {outV !== undefined && (
                      <span data-testid={`xenon-nodeval-${n.id}-${i}`} className="shrink-0 font-bold text-[#8fd48f]">
                        {fmtVal(outV)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MenuBar — the IDE's dropdown row (File / Run / Computer / Help). One
// concept per menu: File owns the virtual disk, Run owns execution (the
// debugger keys live here), Computer owns the machine.

function MenuBar(p: {
  right: string;
  menus: {
    label: string; testid: string;
    entries: { label: string; testid: string; hint?: string; on: () => void; disabled?: boolean }[];
  }[];
}) {
  const [open, setOpen] = useState<string | null>(null);
  // Esc closes an OPEN menu (and stops there — the dialog's own Esc-close
  // owns the key when no menu is up; the menus e2e leg caught the overlap)
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(null); }
    };
    addEventListener('keydown', h, true);
    return () => removeEventListener('keydown', h, true);
  }, [open]);
  return (
    <div className="flex items-center gap-1 border-b border-[#2b313b] bg-[#141b28] px-3 py-1 text-[12px] text-[#9fb0c8]">
      {p.menus.map(m => (
        <div key={m.testid} className="relative">
          <button data-testid={m.testid}
            onClick={() => setOpen(o => (o === m.testid ? null : m.testid))}
            className={`rounded px-2 py-0.5 hover:bg-[#1d2c46] ${open === m.testid ? 'bg-[#1d2c46] text-white' : ''}`}>
            {m.label} ▾
          </button>
          {open === m.testid && (<>
            <div className="fixed inset-0 z-30" onClick={() => setOpen(null)} />
            <div data-testid={`${m.testid}-pop`}
              className="absolute left-0 top-full z-40 min-w-[230px] rounded border border-[#3a4a6a] bg-[#10141f] py-1 shadow-2xl">
              {m.entries.map(e => (
                <button key={e.testid} data-testid={e.testid} disabled={e.disabled}
                  onClick={() => { setOpen(null); e.on(); }}
                  className="flex w-full items-center justify-between gap-4 px-3 py-1 text-left
                         text-[12px] hover:bg-[#1d2c46] disabled:opacity-40">
                  <span>{e.label}</span>
                  {e.hint && <span className="text-[10px] text-[#5d6a7d]">{e.hint}</span>}
                </button>
              ))}
            </div>
          </>)}
        </div>
      ))}
      <span className="ml-auto text-[10px] text-[#5d6a7d]">{p.right}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// WorldSimList — the World tab (v1.13.x): the GLOBAL worldsim channels,
// grouped SENSORS (observers of the world: get a base f(t) AND a $val
// override — '$val + 2' tests an instrument reading high, an inverted craft)
// and CONTROLS (the pilot's buttons/sticks/levers: toggleable, oscillating,
// NO $val override — they don't observe anything). Rows bound to the running
// computer ride first; every row edits the shared store (persisted).

function WorldSimList(p: { pump: typeof xenonPump }) {
  const bound = p.pump.wsBoundNames();
  const all = p.pump.wsChannels();
  const row = (r: (typeof all)[number]) => (
    <div key={r.name} data-testid={`worldsim-row-${r.name}`}
      className="rounded border border-[#232c3d] bg-[#131a28] p-2 text-[11px]">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[#9fb0c8]">{r.label}</span>
        <span className="shrink-0 tabular-nums text-[#8fd48f]"
          data-testid={`worldsim-val-${r.name}`}>{r.value.toFixed(3)}</span>
      </div>
      <div className="text-[9px] text-[#5d6a7d]" data-testid={`worldsim-name-${r.name}`}>
        {r.name}{bound.has(r.name) ? '' : ' · other craft'}
        {p.pump.wsOverrideNames().includes(r.name) &&
          <span className="ml-1 rounded bg-[#332a1a] px-1 text-[#e6c07b]">program</span>}
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        <span className="text-[9px] text-[#5d6a7d]">f(t)=</span>
        <input data-testid={`worldsim-base-${r.name}`} value={r.base}
          onChange={e => p.pump.wsSetBase(r.name, e.target.value)}
          className="min-w-0 flex-1 rounded border border-[#2b3a52] bg-[#0b0f18]
                 px-1.5 py-0.5 text-[11px] text-[#d6dbe1] outline-none" />
        <label className="flex items-center gap-0.5 text-[9px] text-[#9fb0c8]">
          <input type="radio" checked={r.mode === 'auto'}
            data-testid={`worldsim-auto-${r.name}`}
            onChange={() => p.pump.wsSetMode(r.name, 'auto')} />auto
        </label>
        <label className="flex items-center gap-0.5 text-[9px] text-[#9fb0c8]">
          <input type="radio" checked={r.mode === 'manual'}
            data-testid={`worldsim-manual-${r.name}`}
            onChange={() => p.pump.wsSetMode(r.name, 'manual')} />man
        </label>
      </div>
      {r.kind === 'sensor' && (
        <div className="mt-1 flex items-center gap-1.5">
          <span className="text-[9px] text-[#5d6a7d]">$val=</span>
          <input data-testid={`worldsim-ov-${r.name}`} value={r.override}
            placeholder="(blank = none — e.g. $val + 2)"
            onChange={e => p.pump.wsSetOverride(r.name, e.target.value)}
            className="min-w-0 flex-1 rounded border border-[#2b3a52] bg-[#0b0f18]
                   px-1.5 py-0.5 text-[11px] text-[#e6c07b] outline-none" />
        </div>
      )}
      {r.mode === 'manual' && (
        <input type="range" min={-1} max={1} step={0.01} value={r.manual}
          data-testid={`worldsim-slider-${r.name}`}
          onChange={e => p.pump.wsSetManual(r.name, +e.target.value)} className="mt-1 w-full" />
      )}
      {r.error && <div className="mt-1 text-[10px] text-[#ff5b5b]">{r.error}</div>}
    </div>
  );
  const group = (title: string, list: typeof all) => list.length > 0 && (<>
    <div className="mt-1 text-[10px] uppercase tracking-widest text-[#5d6a7d]">{title}</div>
    {list.map(row)}
  </>);
  const inBound = (a: typeof all[number], b: typeof all[number]) =>
    (bound.has(b.name) ? 1 : 0) - (bound.has(a.name) ? 1 : 0) || a.name.localeCompare(b.name);
  return (
    <>
      {group('Sensors — observers of the world ($val overrides)',
        all.filter(c => c.kind === 'sensor').sort(inBound))}
      {group('Controls — the pilot\'s buttons and sticks (toggle / oscillate)',
        all.filter(c => c.kind === 'control').sort(inBound))}
      {all.length === 0 && (
        <span className="text-[11px] text-[#5d6a7d]">no channels named yet — open a computer</span>
      )}
    </>
  );
}
