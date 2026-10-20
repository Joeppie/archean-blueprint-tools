// Viewport.tsx — thin React host for the headless Engine. React owns mount/
// resize/blueprint-load ONLY; scene graph, pick, selection and render cadence
// stay in the engine (the 60 fps path never runs through the reconciler).
// Test hooks land on window.__ARCHEAN__ (same philosophy as the legacy
// title/#out reporting): stats/pick/pose are assertable without pixels.
import { useEffect, useRef, useState } from 'react';
import { openAtlas, modelFailures, type ModelAtlas } from '../engine/models';
import type { Blueprint } from '../engine/format';
import { Engine, type PickHit, type SceneStats } from '../engine/scene';

declare global {
  interface Window { __ARCHEAN__?: {
    engine: Engine;
    stats: () => SceneStats;
    pickProbe: () => PickHit;
    lastPick: () => PickHit;
    /** cable power-surge + label pins (legacy selftest surges=true) */
    surges: () => ReturnType<Engine['surgeState']>;
    labels: () => ReturnType<Engine['labelState']>;
    /** wire-mode list-hover 3D preview (accent glow beside the selection) */
    hover: (ci: number) => void;
    hoverState: () => number;
    /** blocks-place ghost preview state (null = no ghost) */
    ghost: () => Engine['placeGhostState'];
    /** BLOCKS-edit selection highlight state ({bi, twin} | null, v1.4) */
    blockHighlight: () => Engine['blockHighlightState'];
    /** BLOCK widget state (v1.5): {bi, mode, mirror, cell} while a selected
     *  block owns the gizmo (BLOCKS ▸ Edit), else null */
    blockGizmo: () => ReturnType<Engine['blockGizmoState']>;
    /** live selection ({ci, sub}) — v1.5 view-lock pin */
    sel: () => ReturnType<Engine['selectionState']>;
    /** held-catalog-part placement ghost state (v1.4, null = no ghost) */
    compGhost: () => Engine['compGhostState'];
    /** constrained subgrid joint handles (the hinge UI at the joint line) */
    hinge: () => ReturnType<Engine['hingeInfo']>;
    hingePoint: (i: number) => ReturnType<Engine['hingeScreenPoint']>;
    /** wind tunnel (engine/aero.ts) live state */
    wind: () => ReturnType<Engine['windState']>;
  } }
}

let atlasP: Promise<ModelAtlas | null> | null = null;
const getAtlas = (): Promise<ModelAtlas | null> => (atlasP ??= openAtlas());

export default function Viewport({ bp, onPick, onEngine, mode = 'edit', tool, onBlockPick, onBlockHover, placing = null, onPlace, onManifest }: {
  bp: Blueprint | null;
  onPick: (h: PickHit) => void;
  onEngine?: (e: Engine | null) => void;
  /** workspace mode: blocks clicks route to onBlockPick; the mode widget
   *  only belongs to Edit; VIEW picks NOTHING (v1.5 user rule: "selecting
   *  components shouldnt be possible in view — view shows the amounts") */
  mode?: 'view' | 'edit' | 'blocks' | 'wire' | 'flight' | 'aero';
  /** the side panel's PLACE|EDIT flavor (v1.5): in BLOCKS the ghost hovers
   *  only in PLACE; in EDIT only a held catalog part docks a ghost */
  tool?: 'edit' | 'place';
  onBlockPick?: (clientX: number, clientY: number, shift: boolean,
    /** pops the ⊘/✥/⟳/⇄ mode widget at the click point (v1.4: a component
     *  picked in BLOCKS mode gets the gizmo mode switch there too) */
    openWidget: () => void) => void;
  /** BLOCKS-place hover: the engine re-aims the ghost preview (shiftKey =
   *  the game's logical-continuation modifier). Throttled here (~40 Hz):
   *  one raycast per pointermove event would tax a giant on a phone. */
  onBlockHover?: (clientX: number, clientY: number, shift: boolean) => void;
  /** KSP part placement: a held catalog type — the next canvas click
   *  places it at the picked surface instead of selecting */
  placing?: string | null;
  onPlace?: (clientX: number, clientY: number) => void;
  /** game manifest once the model atlas is open (drives the Catalog tab) */
  onManifest?: (m: Record<string, { mass: number; module: string }> | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);

  useEffect(() => {
    const engine = new Engine();
    engine.attach(canvasRef.current!);
    engineRef.current = engine;
    const ro = new ResizeObserver(() => engine.resize());
    ro.observe(canvasRef.current!);
    window.__ARCHEAN__ = {
      engine,
      stats: () => engine.stats(),
      pickProbe: () => engine.pickProbe(),
      lastPick: () => engine.lastPick,
      surges: () => engine.surgeState(),
      labels: () => engine.labelState(),
      hover: (ci: number) => engine.previewHover(ci),
      hoverState: () => engine.hoverActive,
      ghost: () => engine.placeGhostState,
      blockHighlight: () => engine.blockHighlightState,
      blockGizmo: () => engine.blockGizmoState(),
      sel: () => engine.selectionState(),
      compGhost: () => engine.compGhostState,
      hinge: () => engine.hingeInfo(),
      hingePoint: (i: number) => engine.hingeScreenPoint(i),
      wind: () => engine.windState(),
    };
    onEngine?.(engine);
    return () => {
      ro.disconnect(); engine.dispose(); window.__ARCHEAN__ = undefined; onEngine?.(null);
    };
  }, []);                                    // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!bp) return;
    let dead = false;
    (async () => {
      const atlas = await getAtlas();
      if (!dead) engineRef.current?.load(bp, atlas);
      if (!dead) onManifest?.(atlas?.manifest ?? null);
    })().catch(console.error);
    return () => { dead = true; };
  }, [bp, onManifest]);

  // DELIBERATE press picks (PERF.md: one raycast per click, none during
  // orbit): pointerdown records, pointerup <4px moves select-and-fly,
  // exactly like the legacy pick-on-click rule. A comp pick also pops the
  // MODE widget at the click point (⊘/✥/⟳, legacy v0.153; ⇄ comes with the
  // symmetry port) — the choice persists and drives the gizmo.
  const down = useRef({ x: 0, y: 0 });
  const hostRef = useRef<HTMLDivElement>(null);
  // hover routing (v1.4): BLOCKS mode drives the constructor ghost; while a
  // catalog part is HELD in EDIT mode the same path docks the part ghost.
  // Remember the pointer so a Shift press/release (the game's logical-
  // continuation modifier) re-aims the ghost WITHOUT a move.
  // v1.5 flavor rule: the ghost only lives in the PLACE flavor.
  const hoverOn = (mode === 'blocks' && tool === 'place') ||
    ((mode === 'edit' || mode === 'blocks') && !!placing);
  const lastHover = useRef<{ x: number; y: number; shift: boolean } | null>(null);
  const hoverT = useRef(0);
  const blockHover = (x: number, y: number, shift: boolean, force = false) => {
    if (!hoverOn || !onBlockHover) return;
    lastHover.current = { x, y, shift };
    const now = performance.now();
    if (!force && now - hoverT.current < 24) return;    // ~40 Hz raycast cap
    hoverT.current = now;
    onBlockHover(x, y, shift);
  };
  const [widget, setWidget] = useState<{ x: number; y: number } | null>(null);
  const [gmode, setGmode] = useState<'off' | 'translate' | 'rotate'>(
    () => (localStorage.getItem('archean-app-gizmo-mode') as 'off' | 'translate' | 'rotate') || 'rotate');
  const [, setSymTick] = useState(0);
  useEffect(() => {
    const sh = (e: KeyboardEvent, on: boolean) => {
      if (e.key !== 'Shift') return;
      engineRef.current?.setGizmoSnap(on);
      // the ghost re-aims the moment Shift goes down/up over a block (the
      // game swaps brush → continuation instantly, no mouse move needed)
      const h = lastHover.current;
      if (h && mode === 'blocks' && tool === 'place') blockHover(h.x, h.y, on, true);
    };
    const dn = (e: KeyboardEvent) => sh(e, true), up = (e: KeyboardEvent) => sh(e, false);
    addEventListener('keydown', dn); addEventListener('keyup', up);
    return () => { removeEventListener('keydown', dn); removeEventListener('keyup', up); };
  }, [mode, tool, onBlockHover]);
  const setMode = (m: 'off' | 'translate' | 'rotate') => {
    setGmode(m);
    engineRef.current?.setGizmoMode(m);
  };
  const pickClick = (e: React.PointerEvent) => {
    const engine = engineRef.current;
    if (!engine) return;
    // VIEW picks NOTHING (v1.5 user rule: "selecting components shouldnt be
    // possible in view — view shows the amounts"): inspect only, no select,
    // no fly-to, no mode widget — the side panel keeps the vessel stats.
    if (mode === 'view') return;
    if (placing) { onPlace?.(e.clientX, e.clientY); return; }   // KSP place: no select
    if (mode === 'blocks') {
      let opened = false;
      onBlockPick?.(e.clientX, e.clientY, e.shiftKey, () => {
        const box = hostRef.current?.getBoundingClientRect();
        if (box) { opened = true; setWidget({ x: e.clientX - box.left, y: e.clientY - box.top }); }
      });
      if (!opened) setWidget(null);
      return;
    }
    const hit = engine.pickAt(e.clientX, e.clientY);
    onPick(hit);
    if (hit.kind === 'comp' && hit.ci != null) {
      engine.select(hit.ci); engine.flyTo(hit.ci);
      const box = hostRef.current?.getBoundingClientRect();
      if (box && mode === 'edit') setWidget({ x: e.clientX - box.left, y: e.clientY - box.top });
    } else {
      if (hit.kind === 'sub' && hit.sub != null) engine.selectSub(hit.sub);
      else engine.select(-1);
      setWidget(null);
    }
  };

  return (
    <div ref={hostRef} className="relative h-full w-full" data-testid="viewport">
      <canvas ref={canvasRef} data-testid="canvas" className="block h-full w-full touch-none"
        onPointerDown={e => { down.current = { x: e.clientX, y: e.clientY }; }}
        onPointerMove={e => blockHover(e.clientX, e.clientY, e.shiftKey)}
        onPointerLeave={() => {
          // the ghost dies with the pointer (the game's ghost too)
          lastHover.current = null;
          if (hoverOn) onBlockHover?.(-1e5, -1e5, false);
        }}
        onPointerUp={e => {
          if (Math.abs(e.clientX - down.current.x) < 4 && Math.abs(e.clientY - down.current.y) < 4)
            pickClick(e);
        }} />
      {widget && (
        <div data-testid="modebox"
          className="ksp-win absolute z-20 flex -translate-x-1/2 gap-1 rounded p-1"
          style={{ left: widget.x, top: Math.max(8, widget.y - 48) }}>
          {([['off', '⊘', 'hide gizmo'], ['translate', '✥', 'move'], ['rotate', '⟳', 'rotate']] as const).map(([m, ic, t]) => (
            <button key={m} title={t} data-testid={`mode-${m}`} onClick={() => setMode(m)}
              className={`ksp-btn grid h-8 w-9 place-items-center text-[15px] leading-none ${gmode === m ? 'on' : ''}`}>
              {ic}
            </button>
          ))}
          {/* ⇄ mirror-twin switch (v0.161): effective state with strikethrough when
              off OR the selected pair drifted apart (the >5 cm auto-disable) */}
          <button title="move mirrored twins (⇄)" data-testid="mode-sym"
            onClick={() => { const e = engineRef.current; if (e) e.setSymOn(!e.symState().on); setSymTick(t => t + 1); }}
            className={`ksp-btn grid h-8 w-9 place-items-center text-[15px] leading-none ${
              engineRef.current?.symState().active ? 'on' : 'line-through opacity-60'}`}>
            ⇄
          </button>
        </div>
      )}
      {DEBUG_MODE && <StatsStrip engine={engineRef} bp={bp} />}
    </div>
  );
}

/** live scene-stats strip; also the headless assertion point. DEBUG ONLY
 *  (user 2026-10-19: "blocks=… draws=… should not show, not unless in debug
 *  mode" — and the browser TAB must keep its normal title, not the
 *  "SCENE PASS …" test signal). Debug mode = URL ?debug or the persisted
 *  localStorage flag; the Playwright config sets that flag for every e2e
 *  context, so the title/strip assertions keep working unchanged. */
export const DEBUG_MODE =
  new URLSearchParams(location.search).has('debug') ||
  localStorage.getItem('archean-app-debug') === '1';

function StatsStrip({ engine, bp }: { engine: { current: Engine | null }; bp: Blueprint | null }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (!bp || !DEBUG_MODE) return;
    let raf = 0, frames = 0;
    const tick = () => {                                   // poll after first drawn frame
      const e = engine.current;
      if (e && ref.current) {
        const s = e.stats();
        if (s.draws > 0 || frames++ > 120) {
          const fails = modelFailures();
          ref.current.textContent =
            `blocks=${s.blocks} tris=${s.tris} hull=${s.hullTris} comps=${s.comps} subs=${s.subs} draws=${s.draws} tier=${s.tier}`
            + (fails.length ? `  ⚠ ${fails.length} game-model file(s) FAILED to load — stand-ins drawn; Ctrl+Shift+R` : '');
          document.title = s.ok && s.draws > 0 ? `SCENE PASS ${ref.current.textContent}` : `SCENE ${JSON.stringify(s)}`;
          if (s.ok && s.draws > 0) return;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [bp, engine]);
  return <p data-testid="scene-stats" ref={ref}
    className="pointer-events-none absolute left-3 top-2 max-w-[calc(100%-1.5rem)] truncate rounded
               bg-black/50 px-2 py-1 text-[11px] text-ink-dim" />;
}
