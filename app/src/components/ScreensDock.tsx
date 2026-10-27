// ScreensDock.tsx — the ▣ SCREENS bottom tab (v1.13.x: "lets be able to open
// the screens in the bottom tab using a screen button on top (only visible if
// the craft has dashboards) which display the current (raster) graphics/
// values of the dashboards. There should be a tab for normal and virtual
// ones, so that we can understand what is being composed currently").
//
// The dock rides the SHARED XenonPump: the SAME running computer feeds the
// IDE dialog, the 3-D dashboard faces and this panel — one VM, one 25 Hz
// pump, every surface blitted to every registered canvas.
//   · Dashboards tab — every surface that is NOT a virtualscreen: the
//     craft's physical Screen/HdScreen elements (bound by screen(alias,ch))
//     and the program's auto-created surfaces (main#0 = integrated screen).
//   · Virtual tab — the code-created buffers (virtualscreen(w,h)) — the
//     Badger composes its attitude display out of these.
// v1.13.2 (we: "dashboard that is 640*480 which is too small to read, when I
// click it becomes worse. No zooming is available for the specific dashboard
// window (and it doesnt let you filter)"): dock cells are ScreensCell —
// CLICK A CELL to open its own FULLSCREEN ZOOM WINDOW (fit / 1:1 px / ± /
// pinch, scroll to pan); the tiny dock thumbnail no longer fires the VM, so
// a mis-click cannot press a button_rect and change the screen under you.
// VM clicks (the game's button law) land in the zoom window, where the
// pixels are 1:1. A SEARCH box filters the cells by name; while the dock is
// open WASD/↑/↓/F fly the craft's PilotSeat (engine/pilotkeys.ts).
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useRef, useState } from 'react';
import FloatingWindow from './FloatingWindow';
import { xenonPump, xenonScreenBindings, CYCLE_HZ, type XenonComputer } from '../engine/xenoncode';
import { usePilotKeys } from '../engine/pilotkeys';

/** One live surface canvas — registers with the pump (the pump blits), routes
 *  pointer clicks / wheel notches into the VM (computer.md: click entry
 *  point + button "evaluates to true if clicked"). `onTap` replaces the VM
 *  click (the small dock thumbnail opens the zoom window instead). */
export function ScreenCanvas(p: {
  surfKey: string; w: number; h: number; testid?: string;
  maxH?: number; maxW?: number; fill?: boolean; onTap?: () => void;
  tight?: boolean;                  // tile mode: no border/radius, flush edges
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    return cv ? xenonPump.registerCanvas(p.surfKey, cv) : undefined;
  }, [p.surfKey]);
  const toPixels = (e: React.MouseEvent) => {
    const cv = ref.current;
    if (!cv) return null;
    const r = cv.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) * (cv.width / r.width));
    const y = Math.floor((e.clientY - r.top) * (cv.height / r.height));
    return { x, y };
  };
  return <canvas ref={ref} data-testid={p.testid} width={p.w} height={p.h}
    className={p.tight ? 'block bg-black' : 'rounded-sm border border-[#2b313b] bg-black'}
    style={{ imageRendering: 'pixelated', maxHeight: p.maxH ?? 220,
             width: p.fill ? '100%' : 'auto', maxWidth: '100%', cursor: 'pointer' }}
    onClick={e => {
      if (p.onTap) { p.onTap(); return; }
      const px = toPixels(e);
      if (px) xenonPump.screenClick(p.surfKey, px.x, px.y);
    }}
    onWheel={e => xenonPump.screenScroll(p.surfKey, e.deltaY < 0 ? 1 : -1)} />;
}

/** One cell: the live thumbnail, its name, and ⛶ — and the thumbnail CLICK
 *  itself opens the zoom window (v1.13.2). The fullscreen canvas is a second
 *  registered view of the SAME surface: it stays live, and its clicks ARE
 *  the game's button presses at 1:1 pixels. */
export function ScreensCell(p: {
  surfKey: string; label: string; w: number; h: number; testid?: string;
  canvasTestid?: string; maxH?: number;
  autoFull?: boolean;               // deep link: raise the zoom window at once
  onAutoOpened?: () => void;        // one-shot: fired when the auto window opens
  tight?: boolean;                  // tile mode: flush canvases, labels hidden
}) {
  const [full, setFull] = useState(!!p.autoFull);
  useEffect(() => { if (p.autoFull) p.onAutoOpened?.(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  // zoom (we: "I need to be able to zoom in on dashboard screens -
  // dolphin/cede have screens that are too large for me to properly see"):
  // z=1 is FIT; +/−/pinch (ctrl+wheel) scale the canvas in its own px; the
  // overlay scrolls, so zooming in pans by dragging/scrolling natively.
  const [z, setZ] = useState(1);
  const fit = (() => {
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
    const s = Math.min((vw * 0.96) / p.w, ((vh - 120) * 0.96) / p.h);
    return Math.max(1, Math.floor(Math.min(s, 12) * p.w));
  })();
  const openFull = () => { setZ(1); setFull(true); };
  return (
    <>
      <div data-testid={p.testid} className="relative">
        <ScreenCanvas surfKey={p.surfKey} w={p.w} h={p.h} maxH={p.maxH ?? 160}
          testid={p.canvasTestid} onTap={openFull} tight={p.tight} />
        {!p.tight && (
          <button data-testid={`${p.testid}-full`} title="open the zoomable window (click the screen works too)"
            onClick={openFull}
            className="absolute right-1 top-1 rounded bg-black/60 px-1 text-[10px] text-[#8fd4ff]
                 hover:bg-black/80">⛶</button>
        )}
        {!p.tight && (
          <div className="max-w-[170px] truncate text-[10px] text-[#5d6a7d]">{p.label} · {p.w}×{p.h}</div>
        )}
      </div>
      {full && (
        <div data-testid={`${p.testid}-overlay`}
          onWheel={e => {
            if (!e.ctrlKey) return;          // pinch / ctrl+wheel = zoom
            e.preventDefault();
            setZ(v => Math.max(0.25, Math.min(16, v * (e.deltaY < 0 ? 1.2 : 1 / 1.2))));
          }}
          className="fixed inset-0 z-50 overflow-auto bg-black" onClick={() => setFull(false)}>
          <div className="sticky top-0 z-10 flex items-center gap-2 bg-black/80 px-3 py-1.5"
            data-nodrag onClick={e => e.stopPropagation()}>
            <button data-testid={`${p.testid}-zoomout`} className="rounded bg-[#243a52] px-2 py-0.5 text-[13px]"
              onClick={() => setZ(v => Math.max(0.25, v / 1.25))}>−</button>
            <span data-testid={`${p.testid}-zoom`} className="w-12 text-center text-[11px] tabular-nums text-[#9fb0c8]">
              {Math.round(z * 100)}%</span>
            <button data-testid={`${p.testid}-zoomin`} className="rounded bg-[#243a52] px-2 py-0.5 text-[13px]"
              onClick={() => setZ(v => Math.min(16, v * 1.25))}>+</button>
            <button className="rounded bg-[#1a2436] px-2 py-0.5 text-[10px] text-[#9fb0c8]"
              onClick={() => setZ(1)}>fit</button>
            <button className="rounded bg-[#1a2436] px-2 py-0.5 text-[10px] text-[#9fb0c8]"
              onClick={() => setZ(Math.min(16, (window.innerWidth * 0.9) / p.w))}>1:1 px</button>
            <span className="truncate text-[11px] text-[#9fb0c8]">{p.label} · {p.w}×{p.h}</span>
            <span className="hidden text-[10px] text-[#5d6a7d] md:inline">clicks press the screen · scroll/drag to pan · pinch or Ctrl+wheel to zoom</span>
            <button data-testid={`${p.testid}-fullexit`}
              className="ml-auto rounded bg-[#243a52] px-3 py-1 text-[11px]"
              onClick={() => setFull(false)}>✕ close</button>
          </div>
          <div className="pt-2 text-center" style={{ width: Math.round(fit * z), maxWidth: 'none', margin: '0 auto' }}
            onClick={e => e.stopPropagation()}>
            <ScreenCanvas surfKey={p.surfKey} w={p.w} h={p.h} fill
              testid={`${p.testid}-fullcanvas`} />
          </div>
        </div>
      )}
    </>
  );
}

export default function ScreensDock(p: {
  comp: XenonComputer | null; onClose: () => void;
  /** deep link (Editor `?dash=`): this surface's zoom window opens by itself */
  focus?: string;
}) {
  const [, setTick] = useState(0);
  const [tab, setTab] = useState<'dash' | 'virtual'>('dash');
  const [q, setQ] = useState('');
  // TILE MODE (we 2026-10-27: "the spacing between dashboards should be
  // collapsable to be zero, so they are super-smooth together, with a
  // button"): gaps, padding, borders and labels collapse to 0 and the
  // surfaces tile flush — a multi-panel TV (Mario's six HdScreens) reads
  // as ONE screen. Persisted; the zoom windows are untouched.
  const [tight, setTight] = useState(() => {
    try { return localStorage.getItem('archean-app-screens-tight') === '1'; }
    catch { return false; }
  });
  const toggleTight = () => setTight(v => {
    try { localStorage.setItem('archean-app-screens-tight', v ? '0' : '1'); }
    catch { /* private mode */ }
    return !v;
  });
  useEffect(() => xenonPump.subscribe(() => setTick(t => t + 1)), []);
  // WASD / ↑ / ↓ / F → the cockpit (we: "when you are looking at the dash
  // window … pressing WASD, up, down, and F should be given as inputs into
  // the computer for all cockpit connections it has")
  usePilotKeys(true);

  const bindings = p.comp ? xenonScreenBindings(p.comp) : new Map<string, string>();
  const all = [...xenonPump.surfaces.values()];
  const virt = all.filter(s => s.key.startsWith('virtual#'));
  const dash = all.filter(s => !s.key.startsWith('virtual#'));
  const list = useMemo(() => {
    const base = tab === 'virtual' ? virt : dash;
    const s = q.trim().toLowerCase();
    if (!s) return base;
    return base.filter(x => x.key.includes(s) || (bindings.get(x.key) ?? '').toLowerCase().includes(s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, q, xenonPump.cycles, bindings]);

  // deep-link focus is ONE-SHOT: consumed the moment the zoom window opens
  // (a filter round-trip remounts cells; a re-armed autoFull would raise
  // the overlay again and intercept the next click — the suite caught it)
  const [focusLeft, setFocusLeft] = useState(p.focus ?? null);

  const pilot = xenonPump.pilotKeysBound();

  return (
    <FloatingWindow
      id="screens" testid="screens-dock" minW={420} minH={260}
      initial={(vw, vh) => {
        const w = Math.min(1100, vw * 0.96), h = vh * 0.42;
        return { x: (vw - w) / 2, y: vh - h, w, h };
      }}
      className="font-mono"
      header={
      <div className="flex items-center gap-3 bg-[#1a2436] px-3 py-1.5 text-[12px]">
        <span className="font-bold tracking-wide">▣ Screens
          {p.comp && <span className="ml-2 font-normal text-[#9fb0c8]">— {p.comp.alias || p.comp.program}</span>}
        </span>
        <span data-testid="screens-status"
          className={`text-[10px] font-bold ${xenonPump.status === 'running' ? 'text-[#3ddc55]' : 'text-[#ff5b5b]'}`}>
          {xenonPump.status === 'running' ? 'ON' : xenonPump.status.toUpperCase()}
        </span>
        <span className="text-[10px] text-[#5d6a7d]">cycles {xenonPump.cycles} @ {CYCLE_HZ} Hz</span>
        {pilot.length > 0 && (
          <span data-testid="screens-pilot-hint" className="hidden text-[10px] text-[#5d6a7d] lg:inline"
            title={`bound cockpit channels: ${pilot.join(', ')}`}>
            ⌨ WASD ↑↓ F fly the seat
          </span>
        )}
        <button data-testid="screens-tab-dash"
          onClick={() => setTab('dash')}
          className={`rounded px-2 py-0.5 text-[11px] ${tab === 'dash' ? 'bg-[#243a52] text-[#8fd4ff]' : 'bg-[#1a2233] text-[#7d8aa0]'}`}>
          Dashboards ({dash.length})
        </button>
        <button data-testid="screens-tab-virtual"
          onClick={() => setTab('virtual')}
          className={`rounded px-2 py-0.5 text-[11px] ${tab === 'virtual' ? 'bg-[#243a52] text-[#8fd4ff]' : 'bg-[#1a2233] text-[#7d8aa0]'}`}>
          Virtual ({virt.length})
        </button>
        <input data-testid="screens-search" value={q} placeholder="filter screens…"
          onChange={e => setQ(e.target.value)}
          className="w-32 rounded border border-[#2b3a52] bg-[#0b0f18] px-1.5 py-0.5 text-[11px] outline-none" />
        <button data-testid="screens-tight" aria-pressed={tight}
          title={tight ? 'restore gaps between screens'
            : 'collapse the spacing between screens to zero — panels tile flush'}
          onClick={toggleTight}
          className={`rounded px-2 py-0.5 text-[11px] ${tight ? 'bg-[#243a52] text-[#8fd4ff]' : 'bg-[#1a2233] text-[#7d8aa0]'}`}>
          ▦ tile
        </button>
        <button data-testid="screens-close" className="ml-auto text-[#8a93a0] hover:text-white"
          onClick={p.onClose} aria-label="close screens">✕</button>
      </div>
      }>
      <div data-testid="screens-grid"
        className={`flex min-h-0 flex-1 flex-wrap overflow-y-auto ${tight ? 'content-start gap-0 p-0' : 'content-start gap-3 p-3'}`}>
        {!p.comp && (
          <span className="text-[12px] text-[#5d6a7d]">this craft has no computer to run screens.</span>
        )}
        {p.comp && !all.length && (
          <span className="text-[12px] text-[#5d6a7d]">
            {xenonPump.status === 'booting' ? 'booting the computer…' : 'no surfaces painted yet'}
          </span>
        )}
        {list.map(s => (
          <ScreensCell key={s.key} surfKey={s.key} w={s.w} h={s.h} maxH={260}
            testid={`screens-cell-${s.key}`}
            canvasTestid={`screens-canvas-${s.key}`}
            autoFull={focusLeft === s.key}
            onAutoOpened={() => setFocusLeft(null)}
            tight={tight}
            label={bindings.get(s.key) ?? s.key} />
        ))}
        {p.comp && !!all.length && !list.length && (
          <span className="text-[12px] text-[#5d6a7d]">
            {q.trim() ? 'no surface matches the filter'
              : tab === 'virtual' ? 'no virtualscreen() buffers composed yet' : 'no physical surfaces painted yet'}
          </span>
        )}
      </div>
    </FloatingWindow>
  );
}
