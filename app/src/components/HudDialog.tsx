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
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import FloatingWindow from './FloatingWindow';
import { CodeEditor, type CodeEditorHandle } from './CodeEditor';
import BeaconPanel from './BeaconPanel';
import { hudPump, ANCHOR_LABELS, HUD_VIEW_PRESETS, type HudSurface } from '../engine/hudpump';
import XenonLibrary from './XenonLibrary';
import type { XCFile } from '../engine/xenoncode';
import { projectFunctions, projectDecls } from '../engine/xcproject';
import type { XenonHud } from '../engine/xenoncode';

const MENU_HINT = 'F5 run = save (re-boots the HUD runtime on them) · Ctrl+F find · Ctrl+G goto · ⛶ maximise';

/** HUD-flavoured members appended to the Library's member chips (v1.15.5):
 *  the panel object's own API (ABI 13/14, wiki xenoncode/hud.md) and the
 *  beacon object's — the screen members come from XC_SCREEN_MEMBERS. */
const HUD_MEMBERS = [
  'set_size(w,h)', 'set_position(x,y)', 'width', 'height', 'x', 'y', 'scroll',
  'set_cps(n)', 'set_resolution_scale(n)', '$beacon.data', '$beacon.transmit(t)',
];

export default function HudDialog(p: {
  hud: XenonHud;
  onClose: () => void;
  onFiles: (ci: number, files: XCFile[]) => void;
  /** PLAYER HUD detached mode (v1.17.0, we: "make it possible to load a
   *  player HUD file"): set → the SAVE law writes the .xc FILES BACK to the
   *  game's hud folder (engine/playerhud.savePlayerHud), NOT into a
   *  blueprint — the IDE, the Library tab, the runtime and the F5 law are
   *  the SAME. */
  saveHud?: (files: XCFile[]) => Promise<string>;
}) {
  const { hud } = p;
  const [files, setFiles] = useState<XCFile[]>(hud.files.map(f => ({ ...f })));
  const [dirty, setDirty] = useState<Set<number>>(new Set());
  const [tab, setTab] = useState(0);
  const [max, setMax] = useState(false);
  const [side, setSide] = useState<'beacons' | 'panels' | 'screen' | 'library'>('panels');
  const [pendingJump, setPendingJump] = useState<{ line: number; focus: boolean } | null>(null);
  const editorRef = useRef<CodeEditorHandle | null>(null);
  const [armedDel, setArmedDel] = useState(false);
  // the detached (player HUD) save echo: where the bytes landed
  const [saved, setSaved] = useState('');

  const funcs = useMemo(() => projectFunctions(files), [files]);
  const decls = useMemo(() => projectDecls(files), [files]);
  // the HUD runtime view (one subscription; hudPump.version drives rerender)
  const hudVersion = useSyncExternalStore(cb => hudPump.subscribe(cb), () => hudPump.version);
  const hudPumpRunning = hudPump.running && hudPump.hud?.ci === hud.ci;
  const hudPumpVersion = { cycles: hudPump.cycles, error: hudPump.error, v: hudVersion };
  const onCode = tab < files.length;
  const file = files[tab];

  const save = () => {
    // THE SAVE LAW, two targets: a HUD BLOCK saves into data.xc_files (the
    // doc path); a PLAYER HUD writes its .xc files back to disk (the route
    // owns the write; xc_program.bin stays the game's to recompile).
    if (p.saveHud) {
      void p.saveHud(files.map(f => ({ ...f })))
        .then(dir => setSaved(`saved → ${dir}`))
        .catch(e => setSaved(`save FAILED: ${String(e)}`));
    } else {
      p.onFiles(hud.ci, files);
    }
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
        {saved && (
          <span data-testid="hud-saved"
            className={`min-w-0 truncate text-[10px] ${saved.includes('FAILED') ? 'text-[#ff5b5b]' : 'text-[#3ddc55]'}`}>
            {saved}
          </span>
        )}
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
            <button data-testid="hud-side-screen" onClick={() => setSide('screen')}
              className="shrink-0 rounded px-2 py-1 text-[10px] tracking-wide hover:bg-[#182236]">
              <span className={`rounded px-1 py-0.5 ${side === 'screen' ? 'bg-[#1d2b42] text-[#8fd4ff]' : 'text-[#7d8aa0]'}`}>
                Screen</span>
            </button>
            <button data-testid="hud-side-library" onClick={() => setSide('library')}
              className="shrink-0 rounded px-2 py-1 text-[10px] tracking-wide hover:bg-[#182236]">
              <span className={`rounded px-1 py-0.5 ${side === 'library' ? 'bg-[#1d2b42] text-[#8fd4ff]' : 'text-[#7d8aa0]'}`}>
                Library</span>
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
            {side === 'screen' && <HudScreenView />}
            {side === 'library' && (
              // v1.15.5 (we: "library of functions is missing like it is
              // for the computer in our HUD screen"): the SAME Library of
              // definitions the computer IDE carries, with the panel/beacon
              // members added to the member chips.
              <XenonLibrary funcs={funcs} onJump={jumpTo}
                ownerLabel="On this HUD ·" testId="hud"
                extraMembers={HUD_MEMBERS} />
            )}
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
  // THE PANEL ZOOM WINDOW (v1.15.5, we: "Niether can I properly zoom into
  // panels themselves, like with screens"): ⛶ opens the same zoom UX the
  // ▣ dock's screens carry — −/+ / fit / 1:1px, wheel zooms, drag scrolls.
  const [full, setFull] = useState(false);
  const [z, setZ] = useState(0);   // 0 = FIT; >0 = explicit scale %
  const boxRef = useRef<HTMLDivElement | null>(null);
  const fitScale = Math.min(1, 820 / Math.max(1, p.s.w), 720 / Math.max(1, p.s.h));
  const scale = z > 0 ? z / 100 : fitScale;
  const zoomBy = (f: number) => setZ(Math.round(Math.min(3200, Math.max(10,
    (z > 0 ? z : fitScale * 100) * f))));
  return (
    <>
      <figure className="m-0">
        <HudCanvasDraw s={p.s} n={p.n} />
        <figcaption className="mt-0.5 flex items-center gap-1.5 text-[9px] text-[#5d6a7d]">
          <span>{p.s.key} · {ANCHOR_LABELS[p.s.anchor] ?? p.s.anchor} · {p.s.w}×{p.s.h}</span>
          <button data-testid={`hud-panel-full-${p.n}`} title="open the zoomable panel window"
            onClick={() => { setFull(true); setZ(0); }}
            className="rounded bg-[#1a2233] px-1.5 py-0.5 text-[9px] text-[#8fd4ff] hover:bg-[#24365a]">⛶</button>
        </figcaption>
      </figure>
      {full && (
        <div data-testid={`hud-panel-overlay-${p.n}`} className="fixed inset-0 z-[70] flex flex-col bg-black/85"
          onClick={() => setFull(false)}>
          <div className="flex shrink-0 flex-wrap items-center gap-2 px-3 py-2 text-[11px] text-[#cfe0ff]"
            onClick={e => e.stopPropagation()}>
            <span className="font-bold">{p.s.key}</span>
            <span className="text-[#5d6a7d]">{p.s.w}×{p.s.h} · {ANCHOR_LABELS[p.s.anchor] ?? p.s.anchor}</span>
            <button data-testid={`hud-panel-zoom-out-${p.n}`} title="zoom out"
              onClick={() => zoomBy(0.8)} className="rounded bg-[#1a2233] px-2 py-0.5 hover:bg-[#24365a]">−</button>
            <span data-testid={`hud-panel-zoom-${p.n}`} className="w-12 text-center tabular-nums">{Math.round(scale * 100)}%</span>
            <button data-testid={`hud-panel-zoom-in-${p.n}`} title="zoom in"
              onClick={() => zoomBy(1.25)} className="rounded bg-[#1a2233] px-2 py-0.5 hover:bg-[#24365a]">+</button>
            <button data-testid={`hud-panel-zoom-fit-${p.n}`} title="fit to window"
              onClick={() => setZ(0)} className="rounded bg-[#1a2233] px-2 py-0.5 hover:bg-[#24365a]">fit</button>
            <button data-testid={`hud-panel-zoom-px-${p.n}`} title="1:1 pixels"
              onClick={() => setZ(100)} className="rounded bg-[#1a2233] px-2 py-0.5 hover:bg-[#24365a]">1:1 px</button>
            <button data-testid={`hud-panel-zoom-exit-${p.n}`} title="close (Esc)"
              onClick={() => setFull(false)} className="ml-auto rounded bg-[#1a2233] px-2 py-0.5 hover:bg-[#24365a]">✕</button>
          </div>
          <div ref={boxRef} className="min-h-0 flex-1 overflow-auto p-4"
            onWheel={e => zoomBy(e.deltaY < 0 ? 1.25 : 0.8)}>
            <HudCanvasDraw s={p.s} n={p.n} zoom
              style={{ width: Math.round(p.s.w * scale), maxWidth: 'none' }} />
          </div>
          <div className="shrink-0 px-3 py-1.5 text-[9px] text-[#5d6a7d]">
            wheel zooms · scrollbars pan · clicks route in (button_rect evaluates THIS cycle)
          </div>
        </div>
      )}
    </>
  );
}

function HudCanvasDraw(p: {
  s: HudSurface; n: number; zoom?: boolean;
  style?: CSSProperties;
}) {
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
    <canvas ref={ref} data-testid={`hud-panel-canvas-${p.n}${p.zoom ? '-zoom' : ''}`}
      title={`${p.s.key} · ${ANCHOR_LABELS[p.s.anchor] ?? `anchor ${p.s.anchor}`} · click routes in`}
      className={`m-0 block rounded border border-[#2b313b] bg-black [image-rendering:pixelated] ${p.zoom ? 'mx-auto' : ''}`}
      style={{ width: p.zoom ? undefined : Math.min(p.s.w, 520), ...p.style }}
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
  );
}

// ── THE HUD SCREEN WINDOW (v1.15.5, we: "Panels in Huds are rendered
// independently.. not how they normally work. They should be composed
// together on a normal screen as per the rules of the game. Now, that
// does mean scaling the screen a bit, and we should be able to choose
// screen resolution and restart/start. So it should have a Panels and
// Screen window, which composes together the panels (respecting of
// course alpha, like the real thing.)"): ONE canvas at the simulated
// PLAYER SCREEN size; every panel#N composited at its set_position, or
// anchored to the screen edge until set (the game's anchor law); panel
// pixel alpha blends through drawImage, the world behind is a dark sky.
// The size feeds the program's screen_w/screen_h (xc_set_view) and
// APPLYING a new size RESTARTS the runtime — the game's resolution law.
function anchorLayout(s: HudSurface, sw: number, sh: number): [number, number] {
  const a = s.anchor;
  const leftCol = a === 5 || a === 1 || a === 9;
  const rightCol = a === 6 || a === 2 || a === 10;
  const topRow = a === 5 || a === 4 || a === 6;
  const botRow = a === 9 || a === 8 || a === 10;
  const x = leftCol ? 0 : rightCol ? sw - s.w : (sw - s.w) / 2;
  const y = topRow ? 0 : botRow ? sh - s.h : (sh - s.h) / 2;
  return [x, y];
}

function HudScreenView() {
  useSyncExternalStore(cb => hudPump.subscribe(cb), () => hudPump.version);
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [w, setW] = useState(hudPump.view.w);
  const [h, setH] = useState(hudPump.view.h);
  useEffect(() => { setW(hudPump.view.w); setH(hudPump.view.h); }, [hudPump.version]);
  useEffect(() => {
    const tmp = document.createElement('canvas');
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const cv = ref.current;
      if (!cv) return;
      const { w: sw, h: sh } = hudPump.view;
      if (cv.width !== sw || cv.height !== sh) { cv.width = sw; cv.height = sh; }
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#06080f';                       // the world behind the HUD
      ctx.fillRect(0, 0, sw, sh);
      for (const s of hudPump.surfaces) {
        const px = hudPump.pixels(s.key);
        if (!px) continue;
        if (tmp.width !== s.w || tmp.height !== s.h) { tmp.width = s.w; tmp.height = s.h; }
        // the pixel view may ride a SharedArrayBuffer — copy before ImageData
        tmp.getContext('2d')?.putImageData(
          new ImageData(new Uint8ClampedArray(px), s.w, s.h), 0, 0);
        const [x, y] = s.pos ? [s.px, s.py] : anchorLayout(s, sw, sh);
        ctx.drawImage(tmp, Math.round(x), Math.round(y));   // alpha blends
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  if (!hudPump.running)
    return (
      <div data-testid="hud-screen-idle"
        className="rounded border border-[#2b313b] bg-[#10182a] px-2 py-1 text-[10px] leading-snug text-[#5d6a7d]">
        Press ▶ to run this HUD: its panels composite HERE on the simulated
        player screen — anchors, set_position and pixel alpha, like the game.
      </div>
    );
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-[10px] text-[#7d8aa0]">
        <label className="pl-1" htmlFor="hud-screen-preset">player screen</label>
        <select id="hud-screen-preset" data-testid="hud-screen-preset"
          className="rounded bg-[#141b2a] px-1.5 py-1 text-[10px] text-[#cfe0ff]"
          value={HUD_VIEW_PRESETS.some(v => v.w === w && v.h === h) ? `${w}x${h}` : 'custom'}
          onChange={e => {
            if (e.target.value === 'custom') return;
            const [pw, ph] = e.target.value.split('x').map(Number) as [number, number];
            setW(pw); setH(ph);
          }}>
          {HUD_VIEW_PRESETS.map(v => <option key={`${v.w}x${v.h}`} value={`${v.w}x${v.h}`}>{v.w}×{v.h}</option>)}
          <option value="custom">custom</option>
        </select>
        <input data-testid="hud-screen-w" type="number" min={320} max={7680} value={w} aria-label="screen width"
          className="w-16 rounded bg-[#141b2a] px-1.5 py-1 text-[10px] text-[#cfe0ff]"
          onChange={e => setW(+e.target.value || 0)} />
        <span>×</span>
        <input data-testid="hud-screen-h" type="number" min={240} max={4320} value={h} aria-label="screen height"
          className="w-16 rounded bg-[#141b2a] px-1.5 py-1 text-[10px] text-[#cfe0ff]"
          onChange={e => setH(+e.target.value || 0)} />
        <button data-testid="hud-screen-apply"
          className="rounded bg-[#1d2b42] px-2 py-1 text-[10px] text-[#8fd4ff] hover:bg-[#24365a]"
          onClick={() => hudPump.setViewSize(w, h)}>apply &amp; restart</button>
      </div>
      <canvas ref={ref} data-testid="hud-screen-canvas"
        title="the composited HUD — panels on the simulated player screen; clicks route into the panel under the cursor"
        className="w-full max-w-[680px] self-center rounded border border-[#2b313b] bg-black [image-rendering:pixelated]"
        onClick={e => {
          // SCREEN hit-test (v1.15.5, we: "mouseover in the composed screen
          // and buttons dont seem to work"): the panel under the cursor
          // gets the click in ITS pixel coords — button_rect evaluates it
          // THIS cycle (the game law), same routing as the per-panel tiles.
          const cv = e.currentTarget;
          const r = cv.getBoundingClientRect();
          const sx = (e.clientX - r.left) * cv.width / r.width;
          const sy = (e.clientY - r.top) * cv.height / r.height;
          const lay = hudPump.surfaces.map(s => ({
            s,
            xy: (s.pos ? [s.px, s.py] : anchorLayout(s, hudPump.view.w, hudPump.view.h)) as [number, number],
          }));
          for (let i = lay.length - 1; i >= 0; i--) {
            const { s, xy: [x, y] } = lay[i]!;
            if (sx >= x && sx < x + s.w && sy >= y && sy < y + s.h) {
              hudPump.click(s.key, Math.round(sx - x), Math.round(sy - y));
              return;
            }
          }
        }}
        onPointerMove={e => {
          const cv = e.currentTarget;
          const r = cv.getBoundingClientRect();
          hudPump.setMouse(
            Math.round((e.clientX - r.left) * cv.width / r.width),
            Math.round((e.clientY - r.top) * cv.height / r.height));
        }} />
      <div className="px-1 text-[9px] leading-snug text-[#5d6a7d]">
        composited like the game: every panel rides its anchor / set_position on
        the simulated {hudPump.view.w}×{hudPump.view.h} player screen, pixel alpha
        blended; the program's screen_w/screen_h follow the chosen size — applying
        a new one restarts the HUD (the game's resolution law).
      </div>
    </div>
  );
}
