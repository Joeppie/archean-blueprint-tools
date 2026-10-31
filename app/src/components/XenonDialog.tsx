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
  chanInfo, loadChannelTable, parseKv, parseNodes, validNumInput, varKind,
  xenonFarm, xenonScreenBindings, xcDiskFiles, CYCLE_HZ, sabSupported,
  type ChannelTable, type XenonComputer, type XGraph, type XCFile, type XenonPump,
} from '../engine/xenoncode';
import { BUZZER_MODES, buzzerAudio, buzzerReadings, type BuzzerWave } from '../engine/buzzer';
import { parseXenonTest, evalAssert, type XenonAssertResult } from '../engine/xenontest';
import { usePilotKeys } from '../engine/pilotkeys';
import type { Engine } from '../engine/scene';
import { ScreensCell } from './ScreensDock';
import { CodeEditor, type CodeEditorHandle } from './CodeEditor';
import BeaconPanel from './BeaconPanel';
import {
  functionAt, projectDecls, projectFunctions, XC_LIB_DOC,
} from '../engine/xcproject';
import { analyzeProject, type XCDiagnostic } from '../engine/xcanalyze';
import XenonLibrary from './XenonLibrary';

const MAX_PARSE_LINES = 500;   // validation pass cap (window around the caret)
const fmtVal = (v: number | string) =>
  typeof v === 'number' ? (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(3)) : String(v).slice(0, 12);

export default function XenonDialog(p: {
  comp: XenonComputer;
  /** FARM (v1.15.0 slice C): THIS computer's pump — one per open IDE
   *  window; the windows co-run on the craft's shared io bus. */
  pump: XenonPump;
  engine?: Engine | null;
  /** v1.15.6 THE POWER LAW (we: "if a computer is unpowered, according to
   *  craft design, show a warning when we interact with it"): no power
   *  source reaches this computer's power port (engine/power.ts) — in the
   *  game it never boots. The ⚠ chip rides the title bar; the dev may
   *  still run it (we are a dev tool, the farm is a dev bench). */
  unpowered?: boolean;
  onClose: () => void;
  /** the virtual disk changed — the Editor writes bp + doc and re-boots */
  onFiles: (ci: number, files: XCFile[]) => void;
}) {
  const { comp } = p;
  const [, setTick] = useState(0);
  const [tab, setTab] = useState(0);
  // v1.13.27 (we: "I dont want a distinguishment between edit and viewing
  // of code, it should be in edit mode always, save should commit it and
  // reload the code"): NO editing/draft split — files[] ARE the live
  // buffers; the editor writes into them on every change; SAVE commits the
  // buffers to the blueprint (p.onFiles ⇒ the pump re-boots on them).
  const [dirty, setDirty] = useState<Set<number>>(new Set());
  const [files, setFiles] = useState<XCFile[]>(() => xcDiskFiles(comp));
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newProg, setNewProg] = useState(false);
  const [armedDel, setArmedDel] = useState(false);
  const [vals, setVals] = useState<Record<string, number>>({});
  const [side, setSide] = useState<'vars' | 'screens' | 'library' | 'world' | 'bus' | 'console' | 'autotest' | 'beacons' | 'problems'>('screens');
  const [varQ, setVarQ] = useState('');
  const [scrQ, setScrQ] = useState('');
  // LIBRARY side tab (v1.13.25, we: "an index of all known library and
  // LIBRARY search text lives inside components/XenonLibrary (v1.15.5)
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
        for (let i = 0; i < 100 && p.pump.status !== 'running'; i++)
          await new Promise(r => setTimeout(r, 100));
        await new Promise(r => setTimeout(r, 300));
      }
      await p.pump.runCycles(Math.max(0, Math.min(20000, t.cycles | 0)));
      const snap = p.pump.snapshot();
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
      snapshot: () => p.pump.snapshot(),
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
  const [pendingJump, setPendingJump] = useState<{ line: number; focus: boolean } | null>(null);
  // last FOLLOW target handed to the editor (data-editor-jump on the code
  // pane — the pins assert it lands on every stop: v1.13.33 the step keys
  // must follow the stop site, we: "the scroll/focus doesn't change
  // position when I used f11, necessitating me to find it manually")
  const [jumped, setJumped] = useState('');
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
  // io-CALL HOVER resolution (v1.13.26, we: "when mouseovering a io
  // write/read to a specific port, … resolve what kind of device it is
  // and what its current values are … what that means, read from the
  // device itself"): alias/io → XCDevice, channel → the game's channel
  // table (name + range), value → the LIVE wires: pump.reads (the last
  // input_number READ the shim reported for io:ch — what the device
  // SENT) for reads, pump.bus (what the program WROTE) for writes.
  const ioDevice = (arg: string) => comp.devices.find(d =>
    (d.alias && d.alias === arg) || (d.io >= 0 && String(d.io) === arg));
  const ioInfo = (fn: string, arg: string, ch: number):
    { type: string; lines: string[] } | null => {
    const dev = ioDevice(arg);
    if (!dev) return null;
    const dir = fn.startsWith('input') ? 'in' : 'out';
    const ci = chanLabel(dev.io, ch, dir);
    const raw = dir === 'in'
      ? pump.reads.get(`${dev.io}:${ch}`)
      : pump.bus.get(`${dev.io}:${ch}`);
    const val = raw === undefined ? 'no read yet' : typeof raw === 'number' ? fmtVal(raw) : String(raw).slice(0, 14);
    return {
      // the type feeds the tooltip's catalog-preview thumbnail (the
      // placement menu's live-model renderer, engine/thumbs.ts)
      type: dev.type,
      lines: [
        `${dev.alias || dev.type} — ${dev.type}`,
        `io ${dev.io} · ch ${ch}${ci ? ` · ${ci.fn} (${ci.rng})` : ' · channel meaning unknown'}`,
        `${dir === 'in' ? 'device → program (read)' : 'program → device (write)'} = ${val}`,
        dev.ci != null ? 'Ctrl+Click — show the device in the 3-D view' : '',
      ].filter(Boolean),
    };
  };
  const ioFly = (fn: string, arg: string, ch: number) => {
    void fn; void ch;
    const dev = ioDevice(arg);
    if (dev?.ci != null) { p.engine?.flyTo(dev.ci); p.engine?.select(dev.ci); }
  };
  const closeRef = useRef(p.onClose);
  closeRef.current = p.onClose;
  const pump = p.pump;
  // debug channel (the __ARCHEAN__ pattern, DEBUG builds): pump internals
  useEffect(() => {
    // the dialog REPLACES the base hook while open — RESTORE it on
    // unmount (the F5-re-boot pin reads cycles() from the dock, where the
    // base hook's ACTIVE-pump view is the live one — v1.15.0)
    const prevXenon = (window as any).__XENON__;
    (window as any).__XENON__ = () => ({
      status: pump.status, cycles: pump.cycles, raf: pump.raf2(),
      running: pump.run?.running ?? null, surfaces: pump.surfaces.size,
      // FARM (v1.15.0 slice C): every co-running VM (the dialog REPLACES
      // the base hook while open — the farm audit lives in BOTH)
      farm: xenonFarm.pumps.filter(q => q.comp).map(q => ({
        comp: q.comp?.alias ?? '', cycles: q.cycles, status: q.status,
      })),
      paused: pump.paused, error: pump.error,
      worker: !!pump.wrun, isolated: sabSupported(),
      // the camera (io-hover fly-to pin; the dialog REPLACES the base hook
      // while open, so cam lives in BOTH — v1.13.26)
      cam: () => p.engine?.camPos() ?? null,
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
        stepMode: pump.stepMode, breaks: [...pump.breaks.entries()].map(([f, s]) => [f, [...s]]),
        // XENON-DEBUG v3 audit: the TRACKING GATE + park state
        parkArmed: pump.parkArmed, pausedDepth: pump.pausedDepth,
        tracked: (pump as unknown as { tracked: boolean | null }).tracked },
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
      // XENON-WRITEBACK audit: the cmd-6 slots + the raw decoded answer
      writes: (() => {
        const w = pump.wrun;
        if (!w) return null;
        const n = Atomics.load(w.i32, 18) | 0;
        let ack = '';
        try {
          ack = n > 0 && n <= w.bytes.length - 128
            ? new TextDecoder().decode(new Uint8Array(w.bytes.slice(128, 128 + Math.min(n, 240)))) : '';
        } catch { ack = '<decode failed>'; }
        return { cmd: Atomics.load(w.i32, 0), len18: n, flag20: Atomics.load(w.i32, 20), ack: ack.slice(0, 240) };
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
    return () => { (window as any).__XENON__ = prevXenon; };
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

  // Esc closes (subscribe ONCE through a ref — the v1.5.20 listener lesson).
  // TWO listeners, two phases — each owns one key routing:
  //  · CAPTURE: THE FIND PANEL ONLY (v1.13.25). CM's panel keymap consumes
  //    Escape WITHOUT stopping propagation, and the panel's input lives
  //    outside view.dom — the bubble handler below would close the IDE the
  //    moment the panel closed. Stop the key over .cm-panel and close find.
  //    (A capture listener runs BEFORE every editor/panel keymap — used
  //    here ONLY for that panel case: the menus ac leg proved a capture
  //    IDE-close steals Escape from CM's own popup guards, Prec.high is a
  //    BUBBLE-phase ordering and capture beats it.)
  //  · BUBBLE (the HEAD shape): plain Escape closes the IDE — behind the
  //    menu row's capture (an open dropdown owns the key, the v1.13 menus
  //    law), behind an open find panel (closeSearch), and behind CM's
  //    Prec.high stopPropagation (an open completion popup owns it).
  useEffect(() => {
    const cap = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const el = e.target as HTMLElement | null;
      if (!el?.closest?.('.cm-panel')) return;
      e.stopPropagation();
      editorRef.current?.closeSearch();
    };
    const bub = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('[data-testid^="xmenu-"][data-testid$="-pop"]')) return;
      if (editorRef.current?.closeSearch()) return;
      closeRef.current();
    };
    addEventListener('keydown', cap, true);
    addEventListener('keydown', bub);
    return () => {
      removeEventListener('keydown', cap, true);
      removeEventListener('keydown', bub);
    };
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
  // ── NAV HISTORY (v1.13.27, we: "editing a file at a certain line or
  // moving to a breakpoint like that should create a navpoint we can
  // browse-history to; i.e. back and forth"): browser model — leaving a
  // place records it (truncating any forward list); ◀ ▶ / Alt+←/→ walk.
  const runtimeFilesRef = useRef(runtimeFiles);
  runtimeFilesRef.current = runtimeFiles;
  // ── v1.16.13 THE ANALYSIS (engine/xcanalyze, the user: "report missing
  // functions, definitions, missing return statements in functions where a
  // result is used … mark them like VS would"): project diagnostics ride
  // the editor's lint renderer (squiggles + hover + gutter dots) and the
  // Problems side tab. Debounced — a keystroke on a 52-file disk re-scans
  // ~50-200 ms; typing stays snappy. Alias checks ride the computer's
  // DEVICE table (a component the craft does not have is a real defect).
  const [analysis, setAnalysis] = useState<XCDiagnostic[]>([]);
  const filesKey = runtimeFiles.map(f => `${f.name}\u0000${f.code}`).join('\u0001');
  useEffect(() => {
    const t = setTimeout(() => setAnalysis(analyzeProject(runtimeFilesRef.current, {
      aliases: comp.devices.map(d => d.alias?.toLowerCase() ?? '').filter(Boolean),
    })), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filesKey, comp]);
  const analysisByFile = useMemo(() => {
    const m = new Map<string, XCDiagnostic[]>();
    for (const d of analysis) {
      const a = m.get(d.file);
      if (a) a.push(d); else m.set(d.file, [d]);
    }
    return m;
  }, [analysis]);
  const sevCounts = useMemo(() => ({
    error: analysis.filter(d => d.severity === 'error').length,
    warning: analysis.filter(d => d.severity === 'warning').length,
    hint: analysis.filter(d => d.severity === 'hint').length,
  }), [analysis]);
  const navHist = useRef<{ file: string; line: number }[]>([]);
  const navPos = useRef(-1);
  const [, navTick] = useState(0);
  const recNav = () => {
    const at = navPos.current;
    const now = { file: runtimeName(tab), line: lastLine || 1 };
    const cur = navHist.current[at];
    if (cur && cur.file === now.file && cur.line === now.line) return;
    navHist.current = [...navHist.current.slice(0, at + 1), now];
    navPos.current = navHist.current.length - 1;
    navTick(t => t + 1);
  };
  const gotoNav = (delta: number) => {
    const at = navPos.current + delta;
    if (at < 0 || at >= navHist.current.length) return;
    const pt = navHist.current[at]!;
    navPos.current = at;
    navTick(t => t + 1);
    const idx = runtimeFilesRef.current.findIndex(f => f.name === pt.file);
    if (idx >= 0) { setTab(idx); setPendingJump({ line: pt.line, focus: true }); }
  };
  // Alt+←/→ CAPTURE (CM binds Alt+arrows to scope-select in the editor;
  // capture runs first — the established window-capture law)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      e.preventDefault();
      e.stopPropagation();
      gotoNav(e.key === 'ArrowLeft' ? -1 : 1);
    };
    addEventListener('keydown', h, true);
    return () => removeEventListener('keydown', h, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const jumpTo = (fileName: string, line1: number, focus = true) => {
    const idx = runtimeFiles.findIndex(f => f.name === fileName);
    if (idx < 0) return;
    recNav();                       // the place we LEAVE becomes a navpoint
    setTab(idx);
    setPendingJump({ line: line1, focus });
    // observable of the FOLLOW law: what the editor was last told to show
    // (data-editor-jump rides the code pane; the pins assert it equals the
    // stop site — v1.13.33: the step keys must follow, we: "the
    // scroll/focus doesn't change position when I used f11")
    setJumped(`${fileName}:${line1}`);
  };
  useEffect(() => {
    if (!pendingJump) return;
    const h = window.setTimeout(
      () => editorRef.current?.jumpTo(pendingJump.line, pendingJump.focus), 60);
    // v1.16.13 THE FOLLOW-SCROLL FIX (we: "when I debug and step into, my
    // scroll does NOT move to where the currently being executed line now
    // is"): the setPendingJump(null) that used to sit HERE re-triggered
    // this effect, and the re-run's cleanup CLEARed the 60 ms timer before
    // it fired — every follow (F10/F11/breakpoint/Library) scheduled its
    // scroll and then cancelled it. The data-editor-jump attribute is set
    // by the dialog's jumpTo BEFORE this effect, so the v1.13.33 follow
    // pins proved the dialog fired, not that the VIEW moved. The pending
    // state self-clears by key: the timer survives; a newer jump replaces
    // it. The e2e followTo now asserts the ACTIVE line sits inside the
    // code pane's box — the scroll itself is the observable.
    return () => window.clearTimeout(h);
  }, [pendingJump]);
  // BREAKPOINT-FOLLOW (v1.13.27, we: "when hitting a breakpoint in
  // execution, the editor should move to the point just being hit"): a
  // pause moves the IDE to the hit file:line (through jumpTo ⇒ recorded
  // navpoint, so ◀ returns to where you were editing). focus=FALSE (v1.13.31):
  // the caret/view moves, the KEYBOARD does not get yanked — a debugger
  // pause mid-typing scrolls the hit into view without stealing focus
  useEffect(() => {
    if (!pump.paused || !pump.pausedFile) return;
    if (runtimeFilesRef.current.some(f => f.name === pump.pausedFile))
      jumpTo(pump.pausedFile, pump.pausedLine, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pump.paused, pump.pausedFile, pump.pausedLine]);
  // validation: the REAL compiler (xc_parse_line) over a window around the
  // caret (the v1 visible-window law, kept bounded for 16k Badger files)
  const [errors, setErrors] = useState<Map<number, string> | undefined>(undefined);
  const lastTabRef = useRef(tab);
  lastTabRef.current = tab;
  const valSeqRef = useRef(0);
  useEffect(() => {
    const run = pump.run;
    const code = file?.code ?? '';
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
  }, [file?.name, file?.code, pump.status, Math.max(0, Math.floor((lastLine || 1) / 200))]);
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
  // FLASH-ON-CHANGE (v1.13.32, we: "Modified variables should flash a green
  // background as an updated highlight, both locals and globals"): the panel
  // re-renders with the pump's tick — a row whose VALUE string differs from
  // the previous commit gets a seq bump: its React key changes, the row
  // remounts and the .var-flash wash plays from the start. Repeat writes
  // keep the green alive; a quiet VM lets it fade out. Locals key on the
  // NAME (a step replaces the frame — the same-named local changing IS the
  // update we point at), globals on their unique name.
  const prevFlashVals = useRef(new Map<string, string>());
  const [flashSeq, setFlashSeq] = useState<Record<string, number>>({});
  useEffect(() => {
    const changed: string[] = [];
    const seen = new Set<string>();
    for (const [k, v] of [
      ...locList.map(v => [`locals:${v.name}`, v.v] as const),
      ...varList.map(v => [`globals:${v.name}`, v.v] as const),
    ]) {
      seen.add(k);
      const p = prevFlashVals.current.get(k);
      if (p !== undefined && p !== v) changed.push(k);
      prevFlashVals.current.set(k, v);
    }
    for (const k of [...prevFlashVals.current.keys()])
      if (!seen.has(k)) prevFlashVals.current.delete(k);
    if (changed.length) {
      setFlashSeq(m => {
        const n = { ...m };
        for (const k of changed) n[k] = (m[k] ?? 0) + 1;
        return n;
      });
    }
  });
  // ── XENON-WRITEBACK (v1.13.23, we: "I want the capacity to edit a
  //    variable's current value - it must be valid for its type, the type
  //    shown beside the name, reject invalid values, inject them back into
  //    xenoncode"): one inline editor at a time; the type law lives in
  //    Computer::WriteVarAt (ABI 9), validNumInput is the UI's mirror.
  const [vedit, setVedit] = useState<{ key: string; scope: 'locals' | 'globals';
    name: string; t: number; val: string } | null>(null);
  const [verr, setVerr] = useState<{ key: string; msg: string } | null>(null);
  const [vbusy, setVbusy] = useState(false);
  // ── PARK-TO-EDIT (v1.13.31, workpackages WP5, we: "I cannot change
  //    variable values from the variables value list"): on the worker a
  //    write is legal at a PAUSED moment only (THE WRITEBACK LAW). Clicking
  //    a running value PRESSES ⏸ for you — the VM parks at the exact
  //    executing line (WP7) and this pending row opens its editor the
  //    moment the park lands, so the edit is ONE click away from live.
  const parkEdit = useRef<{ key: string; scope: 'locals' | 'globals';
    name: string; t: number; val: string } | null>(null);
  const prevPaused = useRef(false);
  useEffect(() => {
    if (pump.paused && !prevPaused.current && parkEdit.current) {
      let pe = parkEdit.current;
      parkEdit.current = null;
      // The park replaced pump.locals with the NEW frame's rows — a press
      // on a stale-frame local's row must re-target: the same name in the
      // new frame, else the global of that name (WriteVarAt's own lookup
      // order), else an honest inline refusal.
      if (pe.scope === 'locals' && !pump.locals.some(v => v.name === pe.name)) {
        const g = pump.vars.get(pe.name);
        if (g) pe = { ...pe, scope: 'globals', key: `globals:${pe.name}`, t: g.t };
        else { setVerr({ key: pe.key, msg: `the park frame has no $${pe.name} (top-level stop)` }); return; }
      }
      setVedit(pe);
      setVerr(null);
    }
    prevPaused.current = pump.paused;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pump.paused]);
  const typeLabel = (t: number): string =>
    t === 70 ? 'number' : t === 71 ? 'text'
    : t === 80 ? 'number array' : t === 81 ? 'text array'
    : t === 50 || t === 60 ? 'number' : t === 51 || t === 61 ? 'text'
    : t >= 128 ? 'object' : varKind(t);
  const refuseMsg = (t: number): string =>
    t >= 128 ? 'objects are label-only - not editable'
    : t === 80 || t === 81 ? 'arrays are label-only - not editable'
    : (t >= 50 && t <= 61) ? 'storage lives in the world save - not editable here'
    : 'not editable';
  /** worker mode: the parked VM has exactly one writable moment - PAUSED
   *  (the write rides the hook, cmd 6); main-thread mode: direct, anytime */
  const canWrite = (t: number): boolean =>
    (t === 70 || t === 71)
    && (pump.wrun ? pump.paused : pump.status === 'running' || pump.status === 'stopped');
  const applyWrite = async () => {
    if (!vedit) return;
    if (vedit.t === 70 && !validNumInput(vedit.val)) {
      setVerr({ key: vedit.key, msg: 'not a finite number - try 42, -1.5, 1e3, true' });
      return;
    }
    setVbusy(true);
    const r = await pump.writeVar(vedit.name, vedit.t, vedit.val, vedit.scope);
    setVbusy(false);
    if (!r.ok) { setVerr({ key: vedit.key, msg: r.error ?? 'refused' }); return; }
    setVedit(null);
    setVerr(null);
  };
  /** The value cell: a dotted-underline button opens the inline editor
   *  (Enter writes, Esc cancels); refused writes answer inline. */
  const renderValue = (scope: 'locals' | 'globals', name: string, t: number, v: string,
    kv: { k: string; v: string }[] | null) => {
    const key = `${scope}:${name}`;
    const shown = kv ? `{${kv.length}}` : v === '' ? '·' : v.length > 28 ? v.slice(0, 28) + '…' : v;
    const editing = vedit?.key === key ? vedit : null;
    return (
      <span className="min-w-0 text-right">
        {editing ? (
          <span className="inline-flex items-center gap-1">
            <input autoFocus data-testid={`xenon-edit-${name}`} value={editing.val}
              disabled={vbusy}
              onChange={e => setVedit({ ...editing, val: e.target.value })}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.stopPropagation(); void applyWrite(); }
                else if (e.key === 'Escape') { e.stopPropagation(); setVedit(null); setVerr(null); }
              }}
              className="w-28 rounded border border-[#3a5a82] bg-[#0b0f18] px-1 py-0.5 text-right text-[11px] tabular-nums outline-none" />
            <button data-testid="xenon-edit-apply" disabled={vbusy} title="write into the program (Enter)"
              className="text-[11px] text-[#8fd48f] hover:text-[#b7ecb7]" onClick={() => void applyWrite()}>✓</button>
            <button data-testid="xenon-edit-cancel" title="cancel (Esc)"
              className="text-[11px] text-[#8a93a0] hover:text-[#c8d0da]"
              onClick={() => { setVedit(null); setVerr(null); }}>✕</button>
          </span>
        ) : canWrite(t) ? (
          <button data-testid={`xenon-val-${name}`} title="click to edit - the value is written into the running program"
            className="max-w-[180px] truncate rounded px-1 tabular-nums text-[#d6dbe1] underline decoration-dotted decoration-[#3a5a82] underline-offset-2 hover:bg-[#1d2b42]"
            onClick={() => { setVedit({ key, scope, name, t, val: v }); setVerr(null); }}>
            {shown}
          </button>
        ) : (pump.wrun && pump.status === 'running' && scope === 'globals'
             && (t === 70 || t === 71)) ? (
          <button data-testid={`xenon-valpress-${name}`}
            title="running — click parks the VM at the executing line, then this value is editable"
            className="max-w-[180px] truncate rounded px-1 tabular-nums text-[#9fb0c8] underline decoration-dotted decoration-[#2b3a52] underline-offset-2 hover:bg-[#1d2b42]"
            onClick={() => { parkEdit.current = { key, scope, name, t, val: v }; setVerr(null); pump.pause(); }}>
            {shown}
          </button>
        ) : (
          <span className="truncate text-[#d6dbe1]"
            title={(t === 70 || t === 71) ? 'press F6 (stop) or ⏸ to park on the executing line, then click to edit' : refuseMsg(t)}>
            {shown}
          </span>
        )}
        {verr?.key === key && (
          <span data-testid="xenon-edit-error" className="block text-[10px] leading-snug text-[#ff8585]">{verr.msg}</span>
        )}
      </span>
    );
  };
  const surfList = useMemo(() => {
    const q = scrQ.trim().toLowerCase();
    const all = [...pump.surfaces.values()];
    if (!q) return all;
    return all.filter(s => s.key.includes(q) || (bindings.get(s.key) ?? '').toLowerCase().includes(q));
  }, [pump.surfaces, scrQ, bindings, pump.cycles]);
  // LIBRARY tab lists (v1.13.25): the disk's declared functions + the
  // built-in library table, both filtered by the tab's one search row
  // LIBRARY (v1.15.5): the side-tab body moved to components/XenonLibrary
  // (shared with the HUD IDE); the tab label still counts the disk decls.
  const status = tab === 100 ? 'nodes' : 'code';

  const save = (_all: boolean) => {
    // v1.13.27: files[] are the live buffers (the editor writes into them
    // continuously) — SAVE commits them to the blueprint; the write path
    // re-boots the computer on the new files (the game's rule). Breakpoints
    // SURVIVE: bps is this component's state (untouched by save) and the
    // pump keeps its break map across reload→open (only close() clears it)
    setDirty(new Set());
    p.onFiles(comp.ci, files);
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
  }, [files]);

  // Ctrl+F opens the editor's FIND panel from any focus in the IDE
  // (v1.13.25, we: "I want to be able to ctrl-f text within a computer
  // XenonCode IDE"). Text fields keep native behaviour (a search box gets
  // Ctrl+F for its own use); the CodeMirror content is contentEditable and
  // its own searchKeymap owns Ctrl+F there, so only the dead zones — tab
  // strip, side panel, menus — need this relay to the active editor.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k !== 'f' && k !== 'g') return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'
        || el.isContentEditable === true)) return;
      e.preventDefault();                 // never the browser's native find
      if (k === 'f') editorRef.current?.openSearch();
      else editorRef.current?.openGoto();
    };
    addEventListener('keydown', h);
    return () => removeEventListener('keydown', h);
  }, []);

  // MAXIMIZE (v1.13.25): the ⛶ title-bar button + a title double-click;
  // FloatingWindow fills the viewport while set and restores the stored rect
  const [max, setMax] = useState(false);

  // PHONE PASS (v1.13.32, we: "On mobile, opening code I can't read it,
  // scroll through it, the bars and such should be collapsible sideways to
  // make room, also scrolling should be possible to make it possible to use
  // the coder"): below 768 px the COMPUTER SIDE PANEL collapses to a slim
  // RIGHT-EDGE RAIL — the code owns the full width, and the panel opens as
  // an overlay drawer (phone edge-dock law).
  const [narrow, setNarrow] = useState(() => window.innerWidth < 768);
  const [sideOpen, setSideOpen] = useState(false);
  useEffect(() => {
    const h = () => setNarrow(window.innerWidth < 768);
    addEventListener('resize', h);
    return () => removeEventListener('resize', h);
  }, []);

  // the editor is ALWAYS live (v1.13.27): every change writes the file's
  // buffer in place and marks it dirty (the ● on the tab)
  const editChange = (v: string) => {
    setFiles(m => {
      if (tab >= m.length) return m;
      const n = [...m];
      n[tab] = { ...n[tab]!, code: v };
      return n;
    });
    setDirty(mm => new Set(mm).add(tab));
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

  // F9 break · F10/F11 step (one computer cycle) · F8 resume · F5 RUN — the
  // IDE's debugger keys (the user asked for the IDE-class set). F5-RUN is
  // SAVE (⇒ disk write ⇒ auto-reboot on the buffers, the CTRL+S rule —
  // v1.13.27 made the editor always live, so "run" = "commit what's on
  // screen") (we: "F5 should run the code, so long as a computer or screen
  // window is open, otherwise it does a refresh" — inside this window it
  // never refreshes the page). F6 STOP (v1.13.31, we: "f6 should mean
  // stop"): parks the VM at the EXACT executing line and marks the run
  // stopped — the yellow line lands where the program stands and the
  // variables become editable (workpackages WP7).
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'F5') {
        e.preventDefault();
        save(false);
      }
      else if (e.key === 'F6') { e.preventDefault(); pump.stopRunning(); }
      else if (e.key === 'F8') { e.preventDefault(); pump.resume(); }
      else if (e.key === 'F9') {
        e.preventDefault();
        if (onCode && lastLine > 0) toggleBp(lastLine);
      } else if (e.key === 'F10') { e.preventDefault(); pump.stepOver(); }
      else if (e.key === 'F11') { e.preventDefault(); pump.stepInto(); }
    };
    addEventListener('keydown', h);
    return () => removeEventListener('keydown', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastLine, tab, onCode, bps, files]);

  return (
    <FloatingWindow
      id={`xenon-${comp.ci}`} testid="xenon-dialog" minW={720} minH={400}
      maximized={max} onToggleMaximize={() => setMax(m => !m)}
      initial={(vw, vh) => {
        // FARM (slice C): cascade the windows BELOW the top bar (so the
        // Xenon menu stays reachable to open a SISTER) and offset per
        // computer — every title bar stays grabbable.
        const k = Math.abs(comp.ci) % 4;
        const w = Math.min(1360, vw * 0.95) - k * 16;
        const h = vh - 52 - k * 26;
        return { x: (vw - w) / 2 + k * 12, y: 48 + k * 26, w, h };
      }}
      className="font-mono xenon-ide"
      header={
        /* title bar - the drag handle (the ✕ is a button, excluded) */
        <div className="flex items-center justify-between gap-2 bg-[#1a2436] px-3 py-1.5 text-[13px]">
          <span className="min-w-0 flex-1 truncate font-bold tracking-wide">XenonCode IDE ({comp.alias || comp.program})</span>
          <div className="flex shrink-0 items-center gap-3">
            <span data-testid="xenon-on" className={`text-[11px] font-bold ${pump.status === 'running' ? 'text-[#3ddc55]' : 'text-[#ff5b5b]'}`}>
              {pump.status === 'running' ? 'ON' : 'OFF'}
            </span>
            {pump.paused && (
              <span data-testid="xenon-paused" data-file={pump.pausedFile}
                data-line={pump.pausedLine} title="where the debugger stopped"
                className="hidden rounded bg-[#4a3d14] px-2 py-0.5 text-[10px] font-bold text-[#e6c07b] md:inline">
                ⏸ {pump.pausedFile ? `${pump.pausedFile}:${pump.pausedLine}` : 'paused'}
                {functionAt(funcs, pump.pausedFile, pump.pausedLine)
                  ? ` @${functionAt(funcs, pump.pausedFile, pump.pausedLine)!.name}` : ''}
              </span>
            )}
            {pump.stepMode !== 'off' && !pump.paused && (
              <span data-testid="xenon-stepping" className="hidden rounded bg-[#14304a] px-2 py-0.5
                     text-[10px] font-bold text-[#8fd4ff] md:inline">
                {pump.stepMode === 'over' ? 'stepping → next line'
                  : pump.stepMode === 'into' ? 'stepping → next pair' : 'running to cursor'}
              </span>
            )}
            {/* DEBUG BUTTONS IN THE TITLE (v1.13.32, we: "debug buttons as
                part of the title to save space"): the classic run toolbar
                rides the title bar (the FloatingWindow drag law excludes
                buttons), freeing the row beside the tab strip — on phones
                (no F-keys) this row IS the debugger */}
            {p.unpowered && (
              // v1.15.6 THE POWER LAW: the craft HAS a power grid and no
              // source reaches this computer's power port — in-game it is
              // dead metal. Warn on the window we opened (the run itself
              // stays the dev's call).
              <span data-testid="xenon-unpowered" title="no power source reaches this computer's power port — in-game it stays off (wire a battery/generator to its power connector)"
                className="rounded bg-[#4a2020] px-1.5 py-0.5 text-[10px] font-semibold text-[#ff9c9c]">
                ⚠ unpowered
              </span>
            )}
            {onCode && (
              <span data-testid="xenon-title-debug" className="flex items-center gap-1 text-[11px]">
                <span className="hidden h-4 w-px bg-[#2b313b] sm:block" aria-hidden />
                <button data-testid="ide-run"
                  className={`rounded px-2 py-0.5 ${pump.paused ? 'bg-[#2b4a2b] text-[#b7ecb7] hover:bg-[#38603a]'
                    : pump.status === 'running' ? 'bg-[#1d2b42] text-[#5d6a7d]'
                      : 'bg-[#2b4a2b] text-[#b7ecb7] hover:bg-[#38603a]'}`}
                  title="run / resume (F8)"
                  onClick={() => { if (pump.paused) pump.resume(); else pump.startRunning(); }}>▶</button>
                <button data-testid="ide-pause"
                  disabled={pump.status !== 'running' || pump.paused}
                  className="rounded bg-[#243a52] px-2 py-0.5 text-[#e6c07b] hover:bg-[#2f4c6b] disabled:opacity-30"
                  title="pause — park on the executing line (values become editable)"
                  onClick={() => pump.pause()}>⏸</button>
                <button data-testid="ide-restart"
                  className="rounded bg-[#243a52] px-2 py-0.5 text-[#8fd4ff] hover:bg-[#2f4c6b]"
                  title="re-boot the computer from disk (breakpoints kept)"
                  onClick={() => pump.reboot()}>⟳</button>
                <button data-testid="ide-stop"
                  className="rounded bg-[#5a2222] px-2 py-0.5 text-[#ffb3b3] hover:bg-[#7a2e2e]"
                  title="stop (F6) — park on the executing line, values editable"
                  onClick={() => pump.stopRunning()}>⏹</button>
                {/* TURBO (v1.16.13, the user: "a turbo button for xenoncode
                    so it runs at 4x speed temporarily; this makes debugging
                    easier and even our tests could run faster"): pump
                    cadence 100 Hz, the program's virtual dt stays 40 ms —
                    the craft's clock advances 4× per real second. Session
                    only: a re-booted pump runs 1×. */}
                <button data-testid="ide-turbo"
                  aria-pressed={pump.turbo}
                  className={`rounded px-2 py-0.5 ${pump.turbo
                    ? 'bg-[#4a3d1d] text-[#ffd76b] hover:bg-[#5d4d26]'
                    : 'bg-[#243a52] text-[#8fd4ff] hover:bg-[#2f4c6b]'}`}
                  title={pump.turbo
                    ? 'turbo ×4 RUNNING — this computer advances 4× real time (click to return to ×1)'
                    : 'turbo ×4 — run this computer at 4× real time (debug waits/timers/animations faster; the program’s own dt stays 40 ms)'}
                  onClick={() => pump.setTurbo(!pump.turbo)}>⚡</button>
                <button data-testid="ide-step-over"
                  className="rounded bg-[#1d2c46] px-1.5 py-0.5 text-[#cfe1ff] hover:bg-[#27395c]"
                  title="step over one executed line — calls are stepped over (F10)"
                  onClick={() => pump.stepOver()}>⇥</button>
                <button data-testid="ide-step-into"
                  className="rounded bg-[#1d2c46] px-1.5 py-0.5 text-[#cfe1ff] hover:bg-[#27395c]"
                  title="step into the called function (F11)"
                  onClick={() => pump.stepInto()}>↓</button>
              </span>
            )}
            <button data-testid="xenon-max" className="text-[#8a93a0] hover:text-white"
              title={max ? 'restore (⛶ / double-click title bar)' : 'maximise (⛶ / double-click title bar)'}
              onClick={() => setMax(m => !m)} aria-label="maximise">{max ? '🗗' : '⛶'}</button>
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
          right={`cycles ${pump.cycles} @ ${CYCLE_HZ} Hz · CTRL+S save+reboot`}
          rightNarrow={`${pump.cycles} cyc @ ${CYCLE_HZ}Hz`}
          menus={[
            { label: 'File', testid: 'xmenu-file', entries: [
              { label: 'New file…', testid: 'file-new', on: () => { setNewProg(false); setNewOpen(true); } },
              { label: 'New program…', testid: 'file-new-prog', on: () => { setNewProg(true); setNewOpen(true); } },
              { label: 'Save', hint: 'Ctrl+S', testid: 'file-save', on: () => save(false), disabled: !onCode },
              { label: 'Delete current tab', testid: 'file-delete-tab', on: () => delFile(), disabled: files.length <= 1 },
            ] },
            { label: 'Run', testid: 'xmenu-run', entries: [
              { label: pump.status === 'running' ? 'Resume / continue' : pump.paused ? 'Resume' : 'Start', hint: 'F8', testid: 'run-resume',
                on: () => { if (pump.paused) pump.resume(); else pump.startRunning(); } },
              { label: 'Pause (park at the executing line)', hint: '⏸', testid: 'run-pause', on: () => pump.pause(), disabled: pump.status !== 'running' },
              { label: pump.wrun ? 'Step next line (over calls)' : 'Step next CYCLE (cycle-stepping ⚠)', hint: 'F10', testid: 'run-step', on: () => pump.stepOver() },
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
              { label: 'Stop (park at the line · values editable)', hint: 'F6', testid: 'run-stop', on: () => pump.stopRunning() },
              { label: 'Toggle breakpoint', hint: 'F9', testid: 'run-breakpoint', on: () => { if (onCode && lastLine > 0) toggleBp(lastLine); }, disabled: !onCode || lastLine <= 0 },
            ] },
            { label: 'Computer', testid: 'xmenu-computer', entries: [
              { label: 'Re-boot (files from disk)', testid: 'computer-reboot', on: () => pump.reboot() },
            ] },
            { label: 'Help', testid: 'xmenu-help', entries: [
              { label: 'F9 break · F10 over · F11 into · F8 resume · Ctrl+S save', testid: 'help-keys', on: () => undefined },
              { label: 'F5 run (commit + re-boot) · F6 stop (park at the line) · Ctrl+F find · Ctrl+G goto · ⛶ maximise', testid: 'help-run', on: () => undefined },
              { label: 'F6/⏹/⏸ park on the EXECUTING line — then click a variable value to edit it', testid: 'help-park', on: () => undefined },
              { label: 'Alt+← / Alt+→ walk nav history · a breakpoint hit moves the editor', testid: 'help-nav', on: () => undefined },
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
        <div className={`flex min-h-0 flex-1 gap-2 overflow-hidden p-2${narrow && !sideOpen ? ' pr-5' : ''}`}>
          {/* LEFT COLUMN: the file-tab strip rides ABOVE the code; the
              COMPUTER SIDE PANEL stands to its right, top to bottom
              (v1.13.x: "Variables/screens should be to the side of the
              enumerated files, and the window should be larger") */}
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {/* tabs — every HDD file, dirty-marked; ONE scrollable row that
              EXPANDS TO MULTIPLE LINES on hover (v1.13.32, we: "We can't see
              all files in code, expand the list of file tabs to multiple
              lines when mouse over") */}
          <div className="flex shrink-0 items-center gap-1.5">
          {/* the strip's EXPANSION ON HOVER is an OVERLAY (absolute over the
              code), never a push — pushing shrank the code pane under a
              hovered 57-tab strip and hid the editor (v1.13.32 Badger
              catch): the wrapper keeps ONE row of height in flow */}
          <div className="relative min-w-0 flex-1">
          <div data-testid="xenon-tabstrip" title="hover to wrap the tabs over several lines"
            className="flex min-w-0 flex-nowrap items-center gap-1 overflow-x-auto rounded border border-[#2b313b] bg-[#121826] px-2 py-1 text-[12px] [scrollbar-width:thin]
                   hover:absolute hover:inset-x-0 hover:top-0 hover:z-20 hover:flex-wrap hover:overflow-visible hover:shadow-2xl">
          {files.map((f, i) => (
            <button key={f.name} data-testid={`xenon-tab-${i}`}
              onClick={() => { recNav(); setTab(i); setArmedDel(false); }}
              className={`shrink-0 whitespace-nowrap rounded-t px-3 py-1 ${tab === i ? 'bg-[#10141f] text-[#8fd4ff]' : 'bg-[#1a2233] text-[#7d8aa0]'}`}>
              {i === 0 ? `${comp.program}.main.xc` : f.name}
              {dirty.has(i) && <span className="text-[#ff5b5b]" title="unsaved changes"> ●</span>}
            </button>
          ))}
          {graph && (
            <button data-testid="xenon-tab-nodes" onClick={() => setTab(100)}
              className={`shrink-0 whitespace-nowrap rounded-t px-3 py-1 ${tab === 100 ? 'bg-[#10141f] text-[#8fd4ff]' : 'bg-[#1a2233] text-[#7d8aa0]'}`}>
              ⌗ nodes ({graph.nodes.length})
            </button>
          )}
          </div>
          </div>
          {/* actions ride BESIDE the strip (never clipped): SAVE commits
              the live buffers (⇒ re-boot, breakpoints kept); ◀ ▶ walk the
              NAV HISTORY (v1.13.27 — the editor is always live, no edit
              button, no revert: saving is the commit, closing discards) */}
          <div className="flex shrink-0 items-center gap-1 text-[11px] [overflow-x:auto] [scrollbar-width:thin]">
          {onCode && (<>
            <button data-testid="xenon-save" className="rounded bg-[#2b4a2b] px-2 py-0.5
                   hover:bg-[#38603a]" onClick={() => save(false)}
              title="commit all files to the craft (Ctrl+S) — the computer re-boots, breakpoints survive">
              💾 save{dirty.size ? ` (${dirty.size})` : ''}
            </button>
            <button data-testid="xenon-nav-back" disabled={navPos.current <= 0}
              className="rounded bg-[#1d2c46] px-1.5 py-0.5 text-[#cfe1ff] hover:bg-[#27395c] disabled:opacity-30"
              title="back to the previous navpoint (Alt+←)"
              onClick={() => gotoNav(-1)}>◀</button>
            <button data-testid="xenon-nav-forward"
              disabled={navPos.current >= navHist.current.length - 1}
              className="rounded bg-[#1d2c46] px-1.5 py-0.5 text-[#cfe1ff] hover:bg-[#27395c] disabled:opacity-30"
              title="forward to the next navpoint (Alt+→)"
              onClick={() => gotoNav(1)}>▶</button>
            {/* the CLASSIC RUN TOOLBAR moved INTO THE TITLE BAR in v1.13.32
                (we: "debug buttons as part of the title to save space") */}
          </>)}
          </div>
          </div>

          {/* code / nodes */}
          <div data-testid={`xenon-code-${tab}`} data-mode={status}
            data-paused-jump={pump.paused && pump.pausedFile ? `${pump.pausedFile}:${pump.pausedLine}` : ''}
            data-editor-jump={jumped}
            className="min-h-0 flex-1 overflow-hidden rounded border border-[#232c3d] bg-[#0b0f18] text-[12px] leading-[1.45]">
            {onCode && file && (
              <CodeEditor ref={editorRef}
                file={runtimeFiles[tab] ?? file} tabKey={`${comp.ci}:${tab}`}
                editable={onCode} onChange={editChange} onSave={() => save(false)}
                breaks={bps[tab] ?? new Set()}
                pausedLine={pump.paused && pump.pausedFile === runtimeName(tab) ? pump.pausedLine : 0}
                errors={errors}
                diagnostics={analysisByFile.get(runtimeName(tab)) ?? []}
                funcs={funcs} decls={decls}
                varList={[
                  // v1.13.28 (we: "when I type $ suggestions for locals
                  // should show up"): the paused frame's locals first,
                  // values live; then the globals
                  ...pump.locals.map(v => ({
                    name: '$' + v.name.replace(/^\$/, ''), v: v.v, type: 'local',
                  })),
                  ...[...pump.vars.values()].map(v => ({ ...v, name: '$' + v.name.replace(/^\$/, '') })),
                ]}
                devices={comp.devices.filter(d => d.alias).map(d => ({ alias: d.alias!, type: d.type }))}
                getVar={(n) => { const v = pump.varValue(n); return v ? { v: v.v, type: varKind(v.t) } : undefined; }}
                debugActive={pump.status === 'running' || pump.status === 'stopped'}
                onToggleBreak={(l) => toggleBp(l)}
                onRunTo={(l) => pump.runTo(runtimeName(tab), l)}
                onGoDef={(f, l) => jumpTo(f, l)}
                ioInfo={ioInfo} onIoClick={ioFly}
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
          {/* ON PHONES (v1.13.32) the panel COLLAPSES to the edge rail and
              opens as an OVERLAY DRAWER — the code owns the full width;
              on desktop it stands beside the code, top to bottom */}
          <div className={narrow
            ? (sideOpen
              ? 'fixed inset-y-2 left-14 right-2 z-50 flex flex-col gap-1.5 overflow-y-auto rounded-lg border border-[#3a4a6a] bg-[#10141f]/[.98] p-2 shadow-2xl'
              : 'hidden')
            : 'flex min-h-0 min-w-0 flex-1 flex-col gap-1.5'}>
            {narrow && sideOpen && (
              <div className="flex shrink-0 items-center justify-between">
                <span className="text-[10px] uppercase tracking-widest text-[#5d6a7d]">Computer</span>
                <button data-testid="xenon-side-close" aria-label="collapse the panel"
                  className="rounded bg-[#33202a] px-2 py-0.5 text-[#ffb3b3] hover:bg-[#4a2836]"
                  onClick={() => setSideOpen(false)}>✕</button>
              </div>
            )}
            {/* TOP TAB ROW (v1.13.21, we: "put the tabs currently vertically
                labeled as top-tabs at the same level as the 'search
                names/values'"): the rail becomes a horizontal row and the
                tab's search box rides that SAME row */}
            <div className="flex shrink-0 flex-nowrap items-center gap-1 overflow-x-auto [scrollbar-width:thin]">
              {([['vars', `Vars ${pump.vars.size ? `(${pump.vars.size})` : ''}${pump.locals.length ? ` + frame ${pump.locals.length}` : ''}`],
                ['screens', `Screens ${pump.surfaces.size ? `(${pump.surfaces.size})` : ''}`],
                ['library', `Library ${funcs.length + XC_LIB_DOC.length ? `(${funcs.length} + ${XC_LIB_DOC.length})` : ''}`],
                ['world', `World ${pump.wsChannels().length ? `(${pump.wsChannels().length})` : ''}`],
                ['bus', 'Bus'], ['autotest', 'Auto'], ['console', 'Console'],
                ['beacons', 'Beacons'],
                ['problems', `Problems ${analysis.length ? `(${analysis.length})` : ''}`]] as const).map(([k, label]) => (
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
                {side === 'library' && (
                  <span className="shrink-0 text-[9px] text-[#5d6a7d]">search inside the Library tab</span>
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
                const fk = `locals:${v.name}`;
                return (
                  <div key={`${v.name}#${v.s}#${flashSeq[fk] ?? 0}`} data-testid={`xenon-loc-${v.name}`}
                    className={`rounded border border-[#2b3a52] bg-[#152036] px-2 py-1 text-[11px]
                      ${flashSeq[fk] ? 'var-flash' : ''}`}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[#8fd48f]">${v.name}
                        <span className="ml-1 text-[9px] text-[#5d6a7d]">{typeLabel(v.t)}</span>
                        {(locCopies.get(v.name) ?? 0) > 1 &&
                          <span className="ml-1 rounded bg-[#1d2b42] px-1 text-[9px] text-[#8fd4ff]">#{v.s}</span>}
                      </span>
                      {renderValue('locals', v.name, v.t, v.v, kv)}
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
                const storage = v.t === 50 || v.t === 51 || v.t === 60 || v.t === 61;
                const fk = `globals:${v.name}`;
                return (
                  <div key={`${v.name}#${flashSeq[fk] ?? 0}`} data-testid={`xenon-var-${v.name}`}
                    className={`rounded border border-[#232c3d] bg-[#131a28] px-2 py-1 text-[11px]
                      ${flashSeq[fk] ? 'var-flash' : ''}`}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[#8fd48f]">${v.name}
                        <span className="ml-1 text-[9px] text-[#5d6a7d]">{typeLabel(v.t)}</span>
                        {storage && <span className="ml-1 rounded bg-[#332a1a] px-1 text-[9px] text-[#e6c07b]">storage</span>}
                      </span>
                      {renderValue('globals', v.name, v.t, v.v, kv)}
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
              {/* the pilot-key + screen-control explanation LIVES HERE
                  (v1.13.33, we: "the explanation of screen controls in
                  title of computer should live under the screens
                  explanation, not there") */}
              <div data-testid="xenon-screens-note"
                className="shrink-0 text-[10px] leading-snug text-[#5d6a7d]">
                screens clickable · WASD↑↓ space fly · QE roll · IK pitch · JL yaw · R thrust · 1-9/0 aux
              </div>
              {booting && <span className="text-[11px] text-[#5d6a7d]">booting…</span>}
              {!booting && surfList.length === 0 && (
                <span className="text-[11px] text-[#5d6a7d]">no surfaces match</span>
              )}
              <div className="flex flex-wrap gap-2">
                {surfList.map(s => (
                  <ScreensCell key={s.key} surfKey={s.key} w={s.w} h={s.h} pump={pump}
                    canvasTestid={`xenon-screen-${s.key}`} testid={`xenon-cell-${s.key}`}
                    label={`${bindings.get(s.key) ?? s.key}${s.key.startsWith('virtual#') ? ' ·virtual' : ''}`} />
                ))}
              </div>
            </>)}
            {side === 'library' && (<>
              {/* THE LIBRARY OF DEFINITIONS (v1.13.25; v1.15.5 extracted to
                  components/XenonLibrary.tsx so the HUD IDE carries the
                  same index): declared @functions + built-in callables +
                  constants + screen members; chips + search filter all. */}
              <XenonLibrary funcs={funcs} onJump={(f, l) => jumpTo(f, l)}
                ownerLabel="On this computer ·" testId="xenon" />
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
                        <span data-testid={`xenon-bus-${io}=${port}`}
                          className="truncate text-[#9fb0c8]"
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
            {side === 'problems' && (
              <div data-testid="xc-problems-list"
                className="flex min-h-0 flex-1 flex-col gap-[1px] overflow-y-auto pt-1 text-[11px]">
                <div className="flex shrink-0 gap-3 px-1 pb-1 text-[10px]" data-testid="xc-problems-counts">
                  <span className="text-[#ff6b6b]">{sevCounts.error} errors</span>
                  <span className="text-[#e6c07b]">{sevCounts.warning} warnings</span>
                  <span className="text-[#8a93a0]">{sevCounts.hint} hints</span>
                </div>
                {!analysis.length && (
                  <div className="px-1 py-2 text-[11px] text-[#5d6a7d]">
                    no problems — this disk analyzes clean.
                  </div>
                )}
                {analysis.map((d, i) => (
                  <button key={i} data-testid={`xc-problem-${i}`}
                    onClick={() => jumpTo(d.file, d.line)}
                    className="flex w-full items-start gap-1.5 rounded px-1 py-[3px] text-left hover:bg-[#182236]">
                    <span aria-label={d.severity}
                      className={`shrink-0 ${d.severity === 'error' ? 'text-[#ff6b6b]'
                        : d.severity === 'warning' ? 'text-[#e6c07b]' : 'text-[#8a93a0]'}`}>
                      {d.severity === 'error' ? '●' : d.severity === 'warning' ? '▲' : '○'}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[#c7d3e3]" title={d.message}>
                      {d.message}
                    </span>
                    <span className="shrink-0 text-[#5d6a7d]">{d.file}:{d.line}</span>
                  </button>
                ))}
              </div>
            )}
            {side === 'beacons' && <BeaconPanel />}
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

          {/* THE PHONE EDGE RAIL (v1.13.32, we: "the bars and such should be
              collapsible sideways to make room"): the collapsed side panel —
              one vertical chip per tab riding the viewport's right edge;
              a tap opens the drawer on that tab */}
          {narrow && !sideOpen && (
            <div data-testid="xenon-side-rail" className="fixed right-0 top-1/4 z-40 flex flex-col gap-1">
              {([['vars', 'Vars'], ['screens', 'Screens'], ['library', 'Library'], ['world', 'World'],
                ['bus', 'Bus'], ['autotest', 'Auto'], ['console', 'Console'],
                ['beacons', 'Beacons'], ['problems', `Problems ${analysis.length || ''}`]] as const).map(([k, label]) => (
                <button key={k} data-testid={`xenon-rail-${k}`}
                  className="rotate-180 rounded-l border border-r-0 border-[#3a4a6a] bg-[#1d2b42] px-[3px] py-2
                         text-[9px] tracking-wide text-[#8fd4ff] [writing-mode:vertical-rl] hover:bg-[#27395c]"
                  onClick={() => { setSide(k); setSideOpen(true); }}>
                  {label}
                </button>
              ))}
            </div>
          )}
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
            data-cycles={pump.cycles}
            data-turbo={pump.turbo ? '1' : '0'}
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
  /** phone variant (v1.13.33, we: "text about cycles is too big for phone
   *  display; make it much smaller there") — tiny text, no md:inline gate */
  rightNarrow?: string;
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
      <span className="ml-auto hidden text-[10px] text-[#5d6a7d] md:inline">{p.right}</span>
      {p.rightNarrow && (
        <span data-testid="menubar-right-narrow"
          className="ml-auto shrink-0 text-[8px] leading-none text-[#5d6a7d] md:hidden">{p.rightNarrow}</span>
      )}
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

function WorldSimList(p: { pump: XenonPump }) {
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
