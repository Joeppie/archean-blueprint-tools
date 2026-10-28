// FloatingWindow.tsx — the shared MOVABLE/RESIZABLE window frame (v1.13.x:
// "the computer and dashboard pop up windows should be things we can freely
// move around and even resize. In fact, that may be a future default for
// other windows too. If they are moved off screen, then 're-opening' them
// fixes"). The Xenon IDE and the ▣ Screens dock use it; dialogs that join
// later just pass an id + an initial rect.
//
// Law:
//  · position/size persist for the SESSION per window id (module registry);
//  · an open validates the stored rect: its TITLE STRIP must intersect the
//    viewport (a 60×22 probe at the title bar), else the window reopens at
//    its INITIAL position — "moved off screen? reopening fixes it";
//  · drags/resizes CLAMP so the title strip stays reachable (off-screen can
//    only happen via odd viewports — the recovery covers it);
//  · phones (<768 px) get the window FULLSCREEN (fullNarrow) — nothing
//    draggable, matching the phone edge-dock law.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode, PointerEvent as RPointerEvent } from 'react';

export interface Rect { x: number; y: number; w: number; h: number }

const rects = new Map<string, Rect>();

/** The title-strip reachability probe: points 60 px in from EACH end of the
 *  title bar (a window dragged mostly off the left still has its right
 *  title corner on screen). A window is reachable when a probe point lies
 *  inside [0,vw]×[0,vh] with y at the title strip. */
export function rectOnScreen(r: Rect, vw: number, vh: number): boolean {
  if (r.w < 1 || r.h < 1) return false;
  const inset = Math.min(60, Math.max(12, r.w / 2));
  const py = r.y + Math.min(11, Math.max(2, r.h / 2));
  if (py < 0 || py > vh) return false;
  const pxL = r.x + inset;
  const pxR = r.x + r.w - inset;
  return (pxL >= 0 && pxL <= vw) || (pxR >= 0 && pxR <= vw);
}

/** Pick the rect to open with: the stored one if reachable, else initial. */
export function bestRect(saved: Rect | undefined, initial: Rect, vw: number, vh: number): Rect {
  return saved && rectOnScreen(saved, vw, vh) ? saved : initial;
}

/** Clamp a drag/resize result so the title strip stays reachable. */
export function clampRect(r: Rect, vw: number, vh: number, minW: number, minH: number): Rect {
  const w = Math.max(minW, Math.min(r.w, vw));
  const h = Math.max(minH, Math.min(r.h, vh));
  return {
    w, h,
    x: Math.max(-(w - 80), Math.min(r.x, vw - 80)),
    y: Math.max(0, Math.min(r.y, vh - 36)),
  };
}

export default function FloatingWindow(p: {
  id: string;
  testid: string;
  initial: (vw: number, vh: number) => Rect;
  minW?: number;
  minH?: number;
  fullNarrow?: boolean;
  className?: string;
  header: ReactNode;          // the drag handle (buttons inside are excluded)
  /** MAXIMIZE (v1.13.25, we: "I want to be able to easily maximise the IDE
   *  itself"): controlled by the owner (its title bar carries the ⛶ button);
   *  while maximized the window fills the viewport, the grips hide and the
   *  title bar stops dragging — the ⛶ (or a title double-click) restores
   *  the stored rect. */
  maximized?: boolean;
  onToggleMaximize?: () => void;
  children: ReactNode;
}) {
  const minW = p.minW ?? 360;
  const minH = p.minH ?? 240;
  const vw0 = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh0 = typeof window !== 'undefined' ? window.innerHeight : 800;
  const [narrow, setNarrow] = useState(vw0 < 768);
  const [rect, setRect] = useState<Rect>(() =>
    bestRect(rects.get(p.id), p.initial(vw0, vh0), vw0, vh0));
  const drag = useRef<{ mode: 'move' | 'ew' | 'ns' | 'se'; ox: number; oy: number; r0: Rect } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = () => {
      setNarrow(window.innerWidth < 768);
      setRect(r => clampRect(r, window.innerWidth, window.innerHeight, minW, minH));
    };
    addEventListener('resize', h);
    return () => removeEventListener('resize', h);
  }, [minW, minH]);

  const start = (mode: 'move' | 'ew' | 'ns' | 'se') => (e: RPointerEvent) => {
    if (p.maximized) return;               // a maximized window does not drag/resize
    if (mode === 'move' && (e.target as HTMLElement).closest('button,input,select,textarea,[data-nodrag]'))
      return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { mode, ox: e.clientX, oy: e.clientY, r0: { ...rect } };
  };
  const move = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.ox, dy = e.clientY - d.oy;
    const vw = window.innerWidth, vh = window.innerHeight;
    const r: Rect = { ...d.r0 };
    if (d.mode === 'move' || d.mode === 'se') {
      if (d.mode !== 'se') { r.x = d.r0.x + dx; r.y = d.r0.y + dy; }
    }
    if (d.mode === 'ew' || d.mode === 'se') r.w = d.r0.w + (d.mode === 'se' ? dx : dx);
    if (d.mode === 'ns' || d.mode === 'se') r.h = d.r0.h + dy;
    if (d.mode === 'ew') r.x = d.r0.x;
    if (d.mode === 'ns') r.y = d.r0.y;
    const next = clampRect(r, vw, vh, minW, minH);
    setRect(next);
    rects.set(p.id, next);
  };
  const end = () => {
    if (drag.current) {
      rects.set(p.id, rect);
      drag.current = null;
    }
  };

  if (narrow && p.fullNarrow !== false) {
    return (
      <div data-testid={p.testid} ref={rootRef}
        className={`fixed inset-0 z-40 flex flex-col overflow-hidden bg-[#10141f]/[.98] text-[#d6dbe1] ${p.className ?? ''}`}>
        <div className="shrink-0">{p.header}</div>
        {p.children}
      </div>
    );
  }

  const handle = 'absolute z-10 touch-none';
  return (
    <div data-testid={p.testid} ref={rootRef}
      data-maximized={p.maximized ? '1' : undefined}
      className={`fixed z-40 flex flex-col overflow-hidden ${p.maximized ? '' : 'rounded-lg'} border border-[#3a4a6a]
             bg-[#10141f]/[.97] text-[#d6dbe1] shadow-2xl ${p.className ?? ''}`}
      style={p.maximized
        ? { left: 0, top: 0, width: '100vw', height: '100vh' }
        : { left: rect.x, top: rect.y, width: rect.w, height: rect.h }}>
      <div className="shrink-0 cursor-move touch-none select-none"
        onPointerDown={start('move')} onPointerMove={move} onPointerUp={end}
        onDoubleClick={p.onToggleMaximize}
        title={p.onToggleMaximize ? 'drag to move · double-click to maximise' : 'drag to move'}>
        {p.header}
      </div>
      {p.children}
      {/* resize grips: east, south, corner (hidden while maximized) */}
      {!p.maximized && <div className={`${handle} right-0 top-8 bottom-4 w-1.5 cursor-ew-resize`}
        onPointerDown={start('ew')} onPointerMove={move} onPointerUp={end} />}
      {!p.maximized && <div className={`${handle} left-8 right-4 bottom-0 h-1.5 cursor-ns-resize`}
        onPointerDown={start('ns')} onPointerMove={move} onPointerUp={end} />}
      {!p.maximized && <div className={`${handle} right-0 bottom-0 h-4 w-4 cursor-nwse-resize`}
        onPointerDown={start('se')} onPointerMove={move} onPointerUp={end} />}
    </div>
  );
}
