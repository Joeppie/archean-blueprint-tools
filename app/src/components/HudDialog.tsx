// HudDialog.tsx — the IDE of a HUD block (v1.14.0 P9 slice A; runtime in
// slice B; we: "allow us to edit the code for at least HUDs that are
// contained within a HUD block, and establish a familiar environment,
// including the concept of screens and buttons").
//
// A HudController component (data.xc_files, FORMAT §HUD) opens a familiar
// IDE: the SAME CodeEditor (tabs, syntax, completion, find/goto), the
// SAME save law (files live IN the blueprint; save = doc write; F5), a
// RUN ▶ / STOP ⏹ pair on the title bar driving the HUD runtime
// (engine/hudpump.ts: panel() surfaces → live canvases under PANELS,
// beacon() radios → the BEACONS tab, the AVATARSIM as the get() pool),
// and THE SAME Beacons tab — the global radio scope every HUD talks
// through. Saving while the runtime runs re-boots it on the fresh files
// (the F5 law).
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import FloatingWindow from './FloatingWindow';
import { CodeEditor, type CodeEditorHandle } from './CodeEditor';
import BeaconPanel from './BeaconPanel';
import { hudPump, ANCHOR_LABELS, type HudSurface } from '../engine/hudpump';
import type { XCFile } from '../engine/xenoncode';
import { projectFunctions, projectDecls } from '../engine/xcproject';
import type { XenonHud } from '../engine/xenoncode';

const MENU_HINT = 'F5 run = save (re-boots the HUD runtime on them) · Ctrl+F find · Ctrl+G goto · ⛶ maximise';

export default function HudDialog(p: {
  hud: XenonHud;
  onClose: () => void;
  onFiles: (ci: number, files: XCFile[]) => void;
}) {
  const { hud } = p;
  const [files, setFiles] = useState<XCFile[]>(hud.files.map(f => ({ ...f })));
  const [dirty, setDirty] = useState<Set<number>>(new Set());
  const [tab, setTab] = useState(0);
  const [max, setMax] = useState(false);
  const [side, setSide] = useState<'beacons' | 'panels'>('panels');
  const [pendingJump, setPendingJump] = useState<{ line: number; focus: boolean } | null>(null);
  const editorRef = useRef<CodeEditorHandle | null>(null);
  const [armedDel, setArmedDel] = useState(false);

  const funcs = useMemo(() => projectFunctions(files), [files]);
  const decls = useMemo(() => projectDecls(files), [files]);
  // the HUD runtime view (one subscription; hudPump.version drives rerender)
  const hudVersion = useSyncExternalStore(cb => hudPump.subscribe(cb), () => hudPump.version);
  const hudPumpRunning = hudPump.running && hudPump.hud?.ci === hud.ci;
  const hudPumpVersion = { cycles: hudPump.cycles, error: hudPump.error, v: hudVersion };
  const onCode = tab < files.length;
  const file = files[tab];

  const save = () => {
    p.onFiles(hud.ci, files);
    setDirty(new Set());
    // F5 law for a RUNNING HUD: the runtime re-boots on the saved files
    if (hudPump.running && hudPump.hud?.ci === hud.ci)
      void hudPump.open({ ci: hud.ci, alias: hud.alias, files: files.map(f => ({ ...f })) });
  };
  const editChange = (v: string) => {
    setFiles(m => {
      if (tab >= m.length) return m;
      const n = [...m];
      n[tab] = { ...n[tab]!, code: v };
      return n;
    });
    setDirty(mm => new Set(mm).add(tab));
  };
  const jumpTo = (fileName: string, line1: number) => {
    const idx = files.findIndex(f => f.name === fileName);
    if (idx >= 0) { setTab(idx); setPendingJump({ line: line1, focus: true }); }
  };
  const addFile = () => {
    const name = `hud-file-${files.length + 1}.xc`;
    setFiles([...files, { name, code: '' }]);
    setDirty(m => new Set(m).add(files.length));
    setTab(files.length);
  };
  const delFile = () => {
    if (!armedDel) { setArmedDel(true); return; }
    setArmedDel(false);
    if (files.length <= 1) return;
    setFiles(files.filter((_, i) => i !== tab));
    setDirty(new Set());
    setTab(0);
  };

  // F5 = SAVE the buffers (the IDE key law: a computer RUNS them; a HUD has
  // no runtime YET — saving is the commit, same doc path, same reboot-free
  // rhythm), Ctrl+F/G = find/goto (the shared IDE key laws).
  const keys = useRef({ save, onCode });
  keys.current = { save, onCode };
  const keyH = useRef((e: KeyboardEvent) => {
    if (e.key === 'F5') { e.preventDefault(); keys.current.save(); }
    else if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'g')) {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable === true)) return;
      e.preventDefault();
      if (e.key === 'f') editorRef.current?.openSearch();
      else editorRef.current?.openGoto();
    }
  }).current;
  useEffect(() => {
    addEventListener('keydown', keyH);
    return () => removeEventListener('keydown', keyH);
  }, [keyH]);
  // the jump lands AFTER the tab's editor remounts (the XenonDialog law)
  useEffect(() => {
    if (!pendingJump) return;
    const h = window.setTimeout(
      () => editorRef.current?.jumpTo(pendingJump.line, pendingJump.focus), 60);
    setPendingJump(null);
    return () => window.clearTimeout(h);
  }, [pendingJump]);

  return (
    <FloatingWindow
      id="hud" testid="hud-dialog" minW={640} minH={380}
      maximized={max} onToggleMaximize={() => setMax(m => !m)}
      initial={(vw, vh) => {
        const w = Math.min(1180, vw * 0.92), h = vh * 0.86;
        return { x: (vw - w) / 2 + 30, y: (vh - h) / 2 + 20, w, h };
      }}
      className="font-mono xenon-ide"
      header={        <div className="flex items-center justify-between gap-2 bg-[#1a2436] px-3 py-1.5 text-[13px]">
          <span className="min-w-0 flex-1 truncate font-bold tracking-wide">
            HUD IDE ({hud.alias})</span>
          <div className="flex shrink-0 items-center gap-3">
            {/* HUD runtime (slice B): ▶ boots the program on the VM —
                panel() surfaces appear under PANELS, beacon() radios join
                the BEACONS scope. The runtime owns the ONE interpreter:
                booting it closes any running computer IDE pump. */}
            <button data-testid="hud-run"
              className={`rounded px-2 py-0.5 text-[11px] ${hudPumpRunning ? 'bg-[#1d2b42] text-[#5d6a7d]' : 'bg-[#2b4a2b] text-[#b7ecb7] hover:bg-[#38603a]'}`}
              title="run this HUD program (the HUD runtime takes the VM — a running computer IDE pump is closed)"
              onClick={() => void hudPump.open({ ci: hud.ci, alias: hud.alias, files: files.map(f => ({ ...f })) })}
              disabled={hudPumpRunning}>▶</button>
            <button data-testid="hud-stop"
              className={`rounded px-2 py-0.5 text-[11px] ${hudPumpRunning ? 'bg-[#5a2222] text-[#ffb3b3] hover:bg-[#7a2e2e]' : 'bg-[#1d2b42] text-[#5d6a7d]'}`}
              title="stop the HUD runtime"
              onClick={() => hudPump.close()} disabled={!hudPumpRunning}>⏹</button>
            <span data-testid="hud-run-status"
              className={`text-[10px] font-bold tabular-nums ${hudPumpRunning ? 'text-[#3ddc55]' : 'text-[#5d6a7d]'}`}>
              {hudPumpRunning ? `ON ${hudPumpVersion.cycles} cyc` : hudPumpVersion.error ? 'CRASH' : 'off'}
            </span>
            <span data-testid="hud-dirty" className={`text-[10px] font-bold ${dirty.size ? 'text-[#ff5b5b]' : 'text-[#5d6a7d]'}`}>
              {dirty.size ? `● ${dirty.size} unsaved` : 'saved'}
            </span>
            <button data-testid="hud-max" className="text-[#8a93a0] hover:text-white"
              title={max ? 'restore' : 'maximise'}
              onClick={() => setMax(m => !m)} aria-label="maximise">{max ? '🗗' : '⛶'}</button>
            <button data-testid="hud-close" className="text-[#8a93a0] hover:text-white"
              onClick={() => { hudPump.close(); p.onClose(); }} aria-label="close">✕</button>
          </div>
        </div>
      }>
      {/* menu row — File owns the disk (save = write into the HUD block);
          the right side states the scope law */}
      <div className="flex items-center gap-2 border-b border-[#2b313b] bg-[#141b28] px-3 py-1 text-[11px] text-[#9fb0c8]">
        <button data-testid="hud-save" className="rounded bg-[#2b4a2b] px-2 py-0.5 text-[#b7ecb7] hover:bg-[#38603a]"
          title="commit the files into the HUD block (F5) — data.xc_files, doc-guaranteed"
          onClick={save}>💾 save{dirty.size ? ` (${dirty.size})` : ''}</button>
        <button data-testid="hud-new-file" className="rounded bg-[#1d2c46] px-2 py-0.5 text-[#cfe1ff] hover:bg-[#27395c]"
          title="add an include file to the HUD program" onClick={addFile}>+ file</button>
        <button data-testid="hud-del-file"
          className={`rounded px-2 py-0.5 ${armedDel ? 'bg-[#6a1b1b] text-[#ffd7d7] hover:bg-[#8a2424]' : 'bg-[#33202a] text-[#ffb3b3] hover:bg-[#4a2836]'}`}
          onClick={delFile}>{armedDel ? 'sure?' : '✕ delete tab'}</button>
        <span className="ml-auto hidden text-[10px] text-[#5d6a7d] md:inline">{MENU_HINT}</span>
      </div>

      <div className={`flex min-h-0 flex-1 gap-2 overflow-hidden p-2${max ? '' : ''}`}>
        {/* left: file tabs + the shared CodeEditor (the familiar environment:
            the very editor of the computer IDE — tabs, theme, completion,
            find/goto; the debugger gutters idle: no VM behind a HUD YET) */}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div data-testid="hud-tabstrip"
            className="flex shrink-0 items-center gap-1 overflow-x-auto rounded border border-[#2b313b] bg-[#121826] px-2 py-1 text-[12px] [scrollbar-width:thin]">
            {files.map((f, i) => (
              <button key={f.name} data-testid={`hud-tab-${i}`}
                onClick={() => { setTab(i); setArmedDel(false); }}
                className={`shrink-0 whitespace-nowrap rounded-t px-3 py-1 ${tab === i ? 'bg-[#10141f] text-[#8fd4ff]' : 'bg-[#1a2233] text-[#7d8aa0]'}`}>
                {f.name}{dirty.has(i) && <span className="text-[#ff5b5b]" title="unsaved changes"> ●</span>}
              </button>
            ))}
          </div>
          <div data-testid={`hud-code-${tab}`}
            className="min-h-0 flex-1 overflow-hidden rounded border border-[#232c3d] bg-[#0b0f18] text-[12px] leading-[1.45]">
            {onCode && file && (
              <CodeEditor ref={editorRef}
                file={file} tabKey={`hud:${hud.ci}:${tab}`}
                editable
                onChange={editChange} onSave={save}
                breaks={new Set<number>()} pausedLine={0}
                errors={undefined}
                funcs={funcs} decls={decls}
                varList={[]}
                devices={[]}
                getVar={() => undefined}
                debugActive={false}
                onToggleBreak={() => undefined}
                onLine={() => undefined}
                onRunTo={() => undefined}
                onGoDef={(f, l) => jumpTo(f, l)}
              />
            )}
          </div>
        </div>

        {/* right: THE BEACONS tab — the global radio scope (the same panel
            the computer IDE shows; beacons + HUD programs + your sends) */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex shrink-0 flex-wrap items-center gap-1">
            <button data-testid="hud-side-panels" onClick={() => setSide('panels')}
              className="shrink-0 rounded px-2 py-1 text-[10px] tracking-wide hover:bg-[#182236]">
              <span className={`rounded px-1 py-0.5 ${side === 'panels' ? 'bg-[#1d2b42] text-[#8fd4ff]' : 'text-[#7d8aa0]'}`}>
                Panels {hudPumpRunning && hudPump.surfaces.length ? `(${hudPump.surfaces.length})` : ''}</span>
            </button>
            <button data-testid="hud-side-beacons" onClick={() => setSide('beacons')}
              className="shrink-0 rounded px-2 py-1 text-[10px] tracking-wide hover:bg-[#182236]">
              <span className={`rounded px-1 py-0.5 ${side === 'beacons' ? 'bg-[#1d2b42] text-[#8fd4ff]' : 'text-[#7d8aa0]'}`}>
                Beacons</span>
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
            {hudPumpVersion.error && (
              <div data-testid="hud-run-error"
                className="rounded border border-[#6a1b1b] bg-[#33202a] px-2 py-1 text-[10px] text-[#ffb3b3]">
                {hudPumpVersion.error}
              </div>
            )}
            {side === 'panels' && <HudPanels />}
            {side === 'beacons' && <BeaconPanel />}
          </div>
        </div>
      </div>
    </FloatingWindow>
  );
}

// ── HUD PANELS (slice B): every panel() surface the running program owns,
// blitted from the VM's framebuffers every cycle (canvas blits EVERY cycle
// — the CADENCE law). Clicks route in (button_rect evaluates them THIS
// cycle); pointer moves feed the program's mouse_x/mouse_y.
function HudPanels() {
  useSyncExternalStore(cb => hudPump.subscribe(cb), () => hudPump.version);
  if (!hudPump.running)
    return (
      <div data-testid="hud-panels-idle"
        className="rounded border border-[#2b313b] bg-[#10182a] px-2 py-1 text-[10px] leading-snug text-[#5d6a7d]">
        Press ▶ to run this HUD: its panel() surfaces appear here live —
        buttons clickable, beacons wired into the global BEACONS scope.
        The runtime takes the VM from the computer IDE (one interpreter —
        the farm lifts this in the next slice).
      </div>
    );
  if (!hudPump.surfaces.length)
    return (
      <div data-testid="hud-panels-empty" className="px-2 py-1 text-[10px] text-[#5d6a7d]">
        running ({hudPump.cycles} cycles) — the program has not created a
        panel() yet
      </div>
    );
  const order = [5, 4, 6, 1, 16, 2, 9, 8, 10];   // top row … bottom row
  const surfs = [...hudPump.surfaces].sort(
    (a, b) => (order.indexOf(a.anchor) + 1 || 99) - (order.indexOf(b.anchor) + 1 || 99));
  return (
    <div className="flex flex-wrap gap-2">
      {surfs.map(s => <HudCanvas key={s.key} s={s} n={surfs.indexOf(s)} />)}
    </div>
  );
}

function HudCanvas(p: { s: HudSurface; n: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const cv = ref.current;
      if (!cv) return;
      const px = hudPump.pixels(p.s.key);
      if (!px) return;
      if (cv.width !== p.s.w || cv.height !== p.s.h) { cv.width = p.s.w; cv.height = p.s.h; }
      // the pixel view may ride a SharedArrayBuffer (worker law) — copy
      // into a plain array before ImageData will accept it
      cv.getContext('2d')?.putImageData(
        new ImageData(new Uint8ClampedArray(px), p.s.w, p.s.h), 0, 0);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [p.s.key, p.s.w, p.s.h]);
  return (
    <figure className="m-0">
      <canvas ref={ref} data-testid={`hud-panel-canvas-${p.n}`}
        title={`${p.s.key} · ${ANCHOR_LABELS[p.s.anchor] ?? `anchor ${p.s.anchor}`} · click routes in`}
        className="max-w-full rounded border border-[#2b313b] bg-black [image-rendering:pixelated]"
        style={{ width: Math.min(p.s.w, 520) }}
        onClick={e => {
          const r = (e.target as HTMLCanvasElement).getBoundingClientRect();
          hudPump.click(p.s.key,
            Math.round((e.clientX - r.left) * p.s.w / r.width),
            Math.round((e.clientY - r.top) * p.s.h / r.height));
        }}
        onPointerMove={e => {
          const r = (e.target as HTMLCanvasElement).getBoundingClientRect();
          hudPump.setMouse(
            Math.round((e.clientX - r.left) * p.s.w / r.width),
            Math.round((e.clientY - r.top) * p.s.h / r.height));
        }} />
      <figcaption className="mt-0.5 text-[9px] text-[#5d6a7d]">
        {p.s.key} · {ANCHOR_LABELS[p.s.anchor] ?? p.s.anchor} · {p.s.w}×{p.s.h}
      </figcaption>
    </figure>
  );
}
