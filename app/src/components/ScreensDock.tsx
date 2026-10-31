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
// open WASD/↑/↓/F/SPACE + Q/E/I/K/J/L/R + the 1-9,0 Aux ladder fly the
// craft's PilotSeat (engine/pilotkeys.ts).
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useRef, useState } from 'react';
import FloatingWindow from './FloatingWindow';
import {
  xenonFarm, xenonScreenBindings, CYCLE_HZ, type PilotKey, type XenonComputer,
  type XenonPump, type XenonSurface,
} from '../engine/xenoncode';
import { usePilotKeys } from '../engine/pilotkeys';
import { slug } from '../engine/worldsim';

/** True on touch-first devices (phones/tablets). The pilot touch pad and
 *  other touch affordances gate on this (we 2026-10-28: "for mobile phone,
 *  overlay all keyboard binds as buttons"). */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(pointer: coarse)');
    const h = () => setCoarse(mq.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, []);
  return coarse;
}

const PAD_LEFT: { k: PilotKey; label: string }[] = [
  { k: 'w', label: 'W' }, { k: 'a', label: 'A' }, { k: 's', label: 'S' }, { k: 'd', label: 'D' },
];
const PAD_RIGHT: { k: PilotKey; label: string }[] = [
  { k: 'up', label: '▲' }, { k: 'down', label: '▼' }, { k: 'e', label: 'E' },
  { k: 'f', label: 'F' }, { k: 'space', label: '␣' },
];

/** THE TOUCH COCKPIT (v1.13.3, we: "overlay all keyboard binds as buttons
 *  that do keydown when pressing and up when letting go, so we can play on
 *  mobile, also on virtual screens. Make that overlay the screen itself,
 *  also when fullscreening a screen"): every dash view rides a translucent
 *  pad — W/A/S/D cross at the left, ▲▼ E F ␣ at the right. pointerdown
 *  feeds pump.pilotKey(k,true) (= the keydown), pointerup/cancel/leave
 *  feeds the keyup; the canvas itself stays clickable between the keys.
 *  Renders nothing when the running computer has no cockpit bound. */
export function PilotTouchPad(p: { className?: string }) {
  // FARM (slice C): press the channel on EVERY pump with the seat bound —
  // one cockpit serves all co-running computers.
  if (!xenonFarm.pumps.some(q => q.pilotKeysBound().length)) return null;
  const press = (k: PilotKey, down: boolean) => {
    for (const q of xenonFarm.pumps) q.pilotKey(k, down);
  };
  const btn = (k: PilotKey, label: string) => (
    <button key={k} data-testid={`pilot-touch-${k}`}
      className="h-12 w-12 touch-none select-none rounded-full border border-[#3a4a6a]/70
                 bg-black/45 text-[14px] leading-none text-[#9fb0c8]
                 active:border-[#8fd4ff] active:bg-[#243a52]/85 active:text-white"
      onPointerDown={e => { e.preventDefault(); e.stopPropagation(); press(k, true); }}
      onPointerUp={e => { e.preventDefault(); e.stopPropagation(); press(k, false); }}
      onPointerCancel={() => press(k, false)}
      onPointerLeave={() => press(k, false)}
      onContextMenu={e => e.preventDefault()}
    >{label}</button>
  );
  return (
    <div data-testid="pilot-touchpad" aria-hidden
      className={`pointer-events-none absolute inset-0 z-20 flex items-end justify-between p-2 ${p.className ?? ''}`}
      onClick={e => e.stopPropagation()}
      onPointerDown={e => e.stopPropagation()}>
      <div className="pointer-events-auto flex flex-col items-center gap-1">
        {PAD_LEFT.filter(x => x.k === 'w').map(x => btn(x.k, x.label))}
        <div className="flex gap-1">{PAD_LEFT.filter(x => x.k !== 'w').map(x => btn(x.k, x.label))}</div>
      </div>
      <div className="pointer-events-auto flex flex-col items-end gap-1">
        <div className="flex gap-1">{PAD_RIGHT.filter(x => ['e', 'up'].includes(x.k)).map(x => btn(x.k, x.label))}</div>
        <div className="flex gap-1">{PAD_RIGHT.filter(x => ['f', 'down'].includes(x.k)).map(x => btn(x.k, x.label))}</div>
        {PAD_RIGHT.filter(x => x.k === 'space').map(x => btn(x.k, x.label))}
      </div>
    </div>
  );
}

/** One live surface canvas — registers with the pump (the pump blits), routes
 *  pointer clicks / wheel notches into the VM (computer.md: click entry
 *  point + button "evaluates to true if clicked"). `onTap` replaces the VM
 *  click (the small dock thumbnail opens the zoom window instead). */
export function ScreenCanvas(p: {
  surfKey: string; w: number; h: number; testid?: string;
  maxH?: number; maxW?: number; fill?: boolean; onTap?: () => void;
  tight?: boolean;                  // tile mode: no border/radius, flush edges
  /** FARM (slice C): the pump that OWNS this surface (registers the
   *  canvas, presses the VM's buttons). */
  pump: XenonPump;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    return cv ? p.pump.registerCanvas(p.surfKey, cv, !!p.fill) : undefined;
  }, [p.surfKey, p.fill, p.pump]);
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
    style={{ imageRendering: 'pixelated',
             // fill mode (the zoom window) is WIDTH-driven — a maxHeight
             // would clamp the height while the width keeps zooming and
             // re-introduce the sideways squash
             maxHeight: p.fill ? undefined : p.maxH ?? 220,
             width: p.fill ? '100%' : 'auto', maxWidth: '100%', cursor: 'pointer',
             // fill mode scales the canvas to its container WIDTH; the
             // height must follow the intrinsic ratio — leaving it at the
             // attribute px STRETCHED tall surfaces sideways (we: "it
             // stretches it sideways when trying to maximise")
             height: p.fill ? 'auto' : undefined }}
    onClick={e => {
      if (p.onTap) { p.onTap(); return; }
      const px = toPixels(e);
      if (px) p.pump.screenClick(p.surfKey, px.x, px.y);
    }}
    onWheel={e => p.pump.screenScroll(p.surfKey, e.deltaY < 0 ? 1 : -1)} />;
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
  craftId?: string;                 // set → opening the zoom window writes the
                                    // ?craft&dash DEEP LINK into the URL bar
                                    // (we 2026-10-28: "when you open a screen
                                    // fullscreen, update the URL to be a
                                    // deeplink") so the view is shareable
  pump: XenonPump;                  // FARM (slice C): the surface's owner
}) {
  const [full, setFull] = useState(!!p.autoFull);
  const syncUrl = (key: string | null) => {
    if (!p.craftId) return;
    try {
      const u = new URL(window.location.href);
      u.searchParams.set('craft', p.craftId);
      if (key) u.searchParams.set('dash', key);
      else u.searchParams.delete('dash');
      window.history.replaceState(null, '', u.toString());
    } catch { /* file:// origins: the URL is decorative there */ }
  };
  const coarse = useCoarsePointer();
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
  const openFull = () => { setZ(1); setFull(true); syncUrl(p.surfKey); };
  return (
    <>
      <div data-testid={p.testid} className="relative">
        <ScreenCanvas surfKey={p.surfKey} w={p.w} h={p.h} maxH={p.maxH ?? 160}
          testid={p.canvasTestid} onTap={openFull} tight={p.tight} pump={p.pump} />
        {!p.tight && (
          <button data-testid={`${p.testid}-full`} title="open the zoomable window (click the screen works too)"
            onClick={openFull}
            className="absolute right-1 top-1 rounded bg-black/60 px-1 text-[10px] text-[#8fd4ff]
                 hover:bg-black/80">⛶</button>
        )}
        {!p.tight && (
          <div className="max-w-[170px] truncate text-[10px] text-[#5d6a7d]">{p.label} · {p.w}×{p.h}</div>
        )}
        {/* the touch cockpit rides THE SCREEN itself (we: "make that overlay
            the screen itself") — in tile mode every tile is a play
            surface; plain thumbnails stay tappable (tap opens the zoom
            window, where the pad rides too) */}
        {coarse && p.tight && <PilotTouchPad />}
      </div>
      {full && (
        <div data-testid={`${p.testid}-overlay`}
          onWheel={e => {
            if (!e.ctrlKey) return;          // pinch / ctrl+wheel = zoom
            e.preventDefault();
            setZ(v => Math.max(0.25, Math.min(16, v * (e.deltaY < 0 ? 1.2 : 1 / 1.2))));
          }}
          className="fixed inset-0 z-50 overflow-auto bg-black"
          onClick={() => { setFull(false); syncUrl(null); }}>
          <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 bg-black/80 px-3 py-1.5"
            data-nodrag onClick={e => e.stopPropagation()}>
            <button data-testid={`${p.testid}-zoomout`} className="shrink-0 rounded bg-[#243a52] px-2 py-0.5 text-[13px]"
              onClick={() => setZ(v => Math.max(0.25, v / 1.25))}>−</button>
            <span data-testid={`${p.testid}-zoom`} className="w-12 shrink-0 text-center text-[11px] tabular-nums text-[#9fb0c8]">
              {Math.round(z * 100)}%</span>
            <button data-testid={`${p.testid}-zoomin`} className="shrink-0 rounded bg-[#243a52] px-2 py-0.5 text-[13px]"
              onClick={() => setZ(v => Math.min(16, v * 1.25))}>+</button>
            <button className="shrink-0 rounded bg-[#1a2436] px-2 py-0.5 text-[10px] text-[#9fb0c8]"
              onClick={() => setZ(1)}>fit</button>
            <button className="shrink-0 rounded bg-[#1a2436] px-2 py-0.5 text-[10px] text-[#9fb0c8]"
              onClick={() => setZ(Math.min(16, (window.innerWidth * 0.9) / p.w))}>1:1 px</button>
            <span className="min-w-0 flex-1 basis-24 truncate text-[11px] text-[#9fb0c8]">{p.label} · {p.w}×{p.h}</span>
            <span className="hidden text-[10px] text-[#5d6a7d] md:inline">clicks press the screen · scroll/drag to pan · pinch or Ctrl+wheel to zoom</span>
            <button data-testid={`${p.testid}-fullexit`}
              className="shrink-0 rounded bg-[#243a52] px-3 py-1 text-[11px]"
              onClick={() => { setFull(false); syncUrl(null); }}>✕ close</button>
          </div>
          <div className="pt-2 text-center" style={{ width: Math.round(fit * z), maxWidth: 'none', margin: '0 auto' }}
            onClick={e => e.stopPropagation()}>
            <ScreenCanvas surfKey={p.surfKey} w={p.w} h={p.h} fill
              testid={`${p.testid}-fullcanvas`} pump={p.pump} />
          </div>
          {/* ...and the fullscreen zoom window carries it too (we: "also
              when fullscreening a screen") */}
          {coarse && <PilotTouchPad />}
        </div>
      )}
    </>
  );
}

export default function ScreensDock(p: {
  comp: XenonComputer | null; onClose: () => void;
  /** FARM (slice C): the pump whose surfaces the dock shows (the active
   *  computer's); null = no VM booted yet. */
  pump: XenonPump | null;
  /** v1.16.12 FARM MERGE (the dev-kit "black windows"): every farm pump.
   *  THE NET-SCREEN LAW registers the boards on EVERY computer of the
   *  router net, so the last-booted app-2 pump carries main-screen#0..7
   *  UNPAINTED while chipos paints them on its own pump — the dock of ONE
   *  pump showed nine black tiles. Cells now merge the PAINTED surfaces of
   *  all pumps (pixels present; the never-written gate keeps blank
   *  registrations out), each cell owned by the pump that paints it. */
  pumps?: XenonPump[];
  /** deep link (Editor `?dash=`): this surface's zoom window opens by itself */
  focus?: string;
  /** set → opening a zoom window writes the ?craft&dash deep link into the
   *  URL (shareable "play this game" links — the gallery's PLAYABLE row) */
  craftId?: string;
}) {
  const pump = p.pump;
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
  useEffect(() => pump?.subscribe(() => setTick(t => t + 1)), [pump]);
  // WASD / ↑ / ↓ / F → the cockpit (we: "when you are looking at the dash
  // window … pressing WASD, up, down, and F should be given as inputs into
  // the computer for all cockpit connections it has")
  usePilotKeys(true);

  const bindings = p.comp ? xenonScreenBindings(p.comp) : new Map<string, string>();
  // v1.16.12 FARM MERGE (the dev-kit "black windows"): paint-across-pumps.
  // THE NET-SCREEN LAW registers the boards on every router-net computer;
  // the last-booted app-2 pump carries them UNPAINTED (never-written → no
  // pixels) while chipos paints the SAME keys on its pump. Show every
  // painted surface once, owned by the pump that paints it; a key no pump
  // has painted yet shows under the active pump as a live (black) cell.
  const pumps = p.pumps?.length ? p.pumps : pump ? [pump] : [];
  const mirrorSet = new Set(pumps.flatMap(q => (q.comp?.screens ?? [])
    .filter(s => s.deviceScreen).map(s => `${slug(s.alias)}#${s.channel}`.toLowerCase())));
  // OTHER pumps contribute only their PAINTED surfaces (their unpainted
  // registrations are the black-window noise the gate kills).
  const painted = new Map<string, { s: XenonSurface; q: XenonPump }>();
  for (const q of pumps) {
    if (q === pump) continue;
    for (const s of q.surfaces.values())
      if (s.pixels && !mirrorSet.has(s.key) && !painted.has(s.key)) painted.set(s.key, { s, q });
  }
  // The ACTIVE pump contributes its non-mirror surfaces: a dock cell
  // registers its canvas → the surface joins that pump's want-set → pixels
  // start flowing. The dock IS the bootstrap for auto-created + virtual
  // surfaces (painted-only listing deadlocks them: no cell → no canvas →
  // no want → no pixels — the Screens-tab leg caught it). Exception: the
  // shim's NET-PROBE surfaces — a program addressing screen($alias, ch)
  // beyond a board's element count (ChipOS's span scan probes #8..31)
  // auto-creates 640×480 dev seeds that no program paints: the key's base
  // is a registered alias and the channel exceeds the registered ones, so
  // it is a probe artifact, not a surface — kept out of the grid.
  if (pump) {
    const regMax = new Map<string, number>();
    for (const sc of pump.comp?.screens ?? []) {
      const b = slug(sc.alias).toLowerCase();
      regMax.set(b, Math.max(regMax.get(b) ?? -1, sc.channel));
    }
    for (const s of pump.surfaces.values()) {
      if (mirrorSet.has(s.key) || painted.has(s.key)) continue;
      const parts = s.key.split('#');
      const chN = parts.length === 2 ? Number(parts[1]) : NaN;
      const max = regMax.get(parts[0] ?? '');
      if (max !== undefined && Number.isFinite(chN) && chN > max) continue;
      painted.set(s.key, { s, q: pump });
    }
  }
  const all = [...painted.values()];
  const virt = all.filter(x => x.s.key.startsWith('virtual#'));
  const dash = all.filter(x => !x.s.key.startsWith('virtual#'));
  const list = useMemo(() => {
    const base = tab === 'virtual' ? virt : dash;
    const s = q.trim().toLowerCase();
    if (!s) return base;
    return base.filter(x => x.s.key.includes(s) || (bindings.get(x.s.key) ?? '').toLowerCase().includes(s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, q, pump?.cycles, bindings, pumps.length]);

  // deep-link focus is ONE-SHOT: consumed the moment the zoom window opens
  // (a filter round-trip remounts cells; a re-armed autoFull would raise
  // the overlay again and intercept the next click — the suite caught it).
  // `dash=first-virtual` focuses the FIRST virtualscreen — Mario composes
  // its game on virtual#0#0 (900×600); the dashboard panels are only its
  // physical mounts (we: "it should actually focus on the first
  // virtualscreen").
  const [focusLeft, setFocusLeft] = useState(p.focus ?? null);
  const virt0 = all.find(x => x.s.key.startsWith('virtual#'))?.s;
  useEffect(() => {
    if (focusLeft === 'first-virtual' && virt0) setTab('virtual');
  }, [focusLeft, virt0?.key]);
  // TOLERANT deep-link matching: browsers (and chat-app linkifiers) decode
  // `%23` back to `#` in the address bar, so a copied `dash=main%230` can
  // arrive as dash='main' + a '#0' FRAGMENT. Match the exact key, the key
  // minus its '#0' channel suffix, and the channel-prefix form — the
  // Invaders deep link must work however the URL survives the trip.
  const resolveFocus = (f: string): string | null => {
    let s = f; try { s = decodeURIComponent(f); } catch { /* raw */ }
    const keys = [...painted.keys()];
    return keys.includes(s) ? s
      : keys.includes(`${s}#0`) ? `${s}#0`
      : keys.find(k => k.split('#')[0] === s) ?? null;
  };
  const focusKey = focusLeft === 'first-virtual' ? virt0?.key ?? null
    : focusLeft ? resolveFocus(focusLeft) : null;

  const pilot = pump?.pilotKeysBound() ?? [];

  return (
    <FloatingWindow
      id="screens" testid="screens-dock" minW={420} minH={260}
      initial={(vw, vh) => {
        const w = Math.min(1100, vw * 0.96), h = vh * 0.42;
        return { x: (vw - w) / 2, y: vh - h, w, h };
      }}
      className="font-mono"
      header={
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-[#1a2436] px-3 py-1.5 text-[12px]">
        <span className="min-w-0 truncate font-bold tracking-wide">▣ Screens
          {p.comp && <span className="ml-2 font-normal text-[#9fb0c8]">— {p.comp.alias || p.comp.program}</span>}
        </span>
        <span data-testid="screens-status"
          className={`text-[10px] font-bold ${pump?.status === 'running' ? 'text-[#3ddc55]' : 'text-[#ff5b5b]'}`}>
          {pump ? (pump.status === 'running' ? 'ON' : pump.status.toUpperCase()) : 'OFF'}
        </span>
        <span className="hidden text-[10px] text-[#5d6a7d] sm:inline">cycles {pump?.cycles ?? 0} @ {CYCLE_HZ} Hz</span>
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
            {pump?.status === 'booting' ? 'booting the computer…' : 'no surfaces painted yet'}
          </span>
        )}
        {pumps.length > 0 && list.map(({ s: sf, q: owner }) => (
          <ScreensCell key={sf.key} surfKey={sf.key} w={sf.w} h={sf.h} maxH={260}
            craftId={p.craftId} pump={owner}
            testid={`screens-cell-${sf.key}`}
            canvasTestid={`screens-canvas-${sf.key}`}
            autoFull={focusKey === sf.key}
            onAutoOpened={() => setFocusLeft(null)}
            tight={tight}
            label={bindings.get(sf.key) ?? sf.key} />
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
