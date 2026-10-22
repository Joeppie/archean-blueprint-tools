// Viewport.tsx — thin React host for the headless Engine. React owns mount/
// resize/blueprint-load ONLY; scene graph, pick, selection and render cadence
// stay in the engine (the 60 fps path never runs through the reconciler).
// Test hooks land on window.__ARCHEAN__ (same philosophy as the legacy
// title/#out reporting): stats/pick/pose are assertable without pixels.
import { useEffect, useRef, useState } from 'react';
import { openAtlas, modelFailures, type ModelAtlas } from '../engine/models';
import type { Blueprint } from '../engine/format';
import { Engine, type PickHit, type SceneStats } from '../engine/scene';
import { triAt } from '../engine/tris';

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
    /** WORLD bboxes of the highlight overlay meshes (v1.6 stale-ghost pin:
     *  the overlay must sit ON the selected block after every edit) */
    blockHlBoxes: () => ReturnType<Engine['blockHlBoxes']>;
    /** 2026-10-20 TRIANGLE selection highlight: the gold-highlighted triangle index
     *  (-1 = none) — the "triangles refuse to select properly" pin */
    triHl: () => number;
    /** 2026-10-20 triangle-select routing probe: pickCell + the geometric triAt
     *  click-owner at one pixel ({kind, bi, t}; t >= 0 = would select) */
    triPick: (x: number, y: number) => { kind: string; bi: number; t: number } | null;
    /** BLOCK widget state (v1.5): {bi, mode, mirror, cell} while a selected
     *  block owns the gizmo (BLOCKS ▸ Edit), else null */
    blockGizmo: () => ReturnType<Engine['blockGizmoState']>;
    /** live selection ({ci, sub}) — v1.5 view-lock pin */
    sel: () => ReturnType<Engine['selectionState']>;
    /** v1.8.0 faux-mirror ⚠ popup state (text + client-px anchor at the twin) */
    twinWarn: () => ReturnType<Engine['twinWarnState']>;
    /** held-catalog-part placement ghost state (v1.4, null = no ghost;
     *  v1.5.6 carries the smear-drag yaw) */
    compGhost: () => Engine['compGhostState'];
    /** v1.5.6: the ghost shows the REAL translucent model (not the box
     *  stand-in that streams until it lands) + its world mesh bboxes */
    compGhostReal: () => boolean;
    compGhostBoxes: () => ReturnType<Engine['compGhostBoxes']>;
    /** constrained subgrid joint handles (the hinge UI at the joint line) */
    hinge: () => ReturnType<Engine['hingeInfo']>;
    hingePoint: (i: number) => ReturnType<Engine['hingeScreenPoint']>;
    /** wind tunnel (engine/aero.ts) live state */
    wind: () => ReturnType<Engine['windState']>;
    /** v1.6 TOOLS ▸ placement ghost (Spheroid): state, screen anchor and
     *  the pin-driven whole-cell nudge (same path the widget commits) */
    placeGhost: () => ReturnType<Engine['clusterGhostState']>;
    placePoint: () => ReturnType<Engine['clusterGhostScreenPoint']>;
    placeShift: (s: [number, number, number]) => boolean;
    /** v1.5.21 adaptive ground grid plan (step/major/spans in file coords) */
    grid: () => ReturnType<Engine['gridInfo']>;
    /** v1.5.22 MEASURE RULER: state in the user's z-up law (x, y=-filez,
     *  z=height above the pad) + the screen anchor of a drag handle */
    probe: () => ReturnType<Engine['probeState']>;
    probePoint: (w: 'base' | 'cap') => { x: number; y: number } | null;
    /** v1.5.21 settable mirror axis (⚙ row) */
    mirAxis: () => 'x' | 'y' | 'z';
  } }
}

let atlasP: Promise<ModelAtlas | null> | null = null;
const getAtlas = (): Promise<ModelAtlas | null> => (atlasP ??= openAtlas());

export default function Viewport({ bp, onPick, onEngine, mode = 'edit', tool, onBlockPick, onBlockHover, placing = null, onPlace, onPaintOpen, onPlaceCancel, onPlaceBuild, onManifest, keepView = false }: {
  bp: Blueprint | null;
  onPick: (h: PickHit) => void;
  onEngine?: (e: Engine | null) => void;
  /** workspace mode: v2.0.0 the BLOCKS workspace MERGED into Edit (user:
   *  "Merge the block and component edit things, I no longer see a good
   *  reason to seperate them") — in edit, canvas clicks route through
   *  onBlockPick (block face → brush/select, part → select); VIEW picks
   *  NOTHING (v1.5 user rule: "selecting components shouldnt be possible in
   *  view — view shows the amounts") */
  mode?: 'view' | 'edit' | 'wire' | 'flight' | 'aero';
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
  /** KSP part placement: a held catalog type — releasing the smear-drag (see
   *  the canvas handlers) lands it at the picked surface with the drag's yaw
   *  (radians about the world ŷ) instead of selecting */
  onPlace?: (clientX: number, clientY: number, yaw: number) => void;
  /** 🎨 PALETTE button in the mode widget (v1.6): toggles the Editor's paint
   *  window — the colour alternative to the move/rotate gizmo modes */
  onPaintOpen?: () => void;
  /** v1.6 TOOLS ▸ placement (Spheroid): the confirmed tool's movable ghost
   *  carries a label with ✕ Cancel / ✔ Build — both owned by the Editor */
  onPlaceCancel?: () => void;
  onPlaceBuild?: () => void;
  /** game manifest once the model atlas is open (drives the Catalog tab) */
  onManifest?: (m: Record<string, { mass: number; module: string }> | null) => void;
  /** UNDO/REDO swaps bp for the SAME craft — keep the camera (do NOT re-frame).
   *  A craft swap (openText) never sets this, so it re-frames as ever. */
  keepView?: boolean;
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
      blockHlBoxes: () => engine.blockHlBoxes(),
      triHl: () => engine.triHighlightState,
      triPick: (x, y) => {
        const r = engine.pickCell(x, y);
        if (!r) return null;
        const b = engine.blueprint;
        return { kind: r.kind, bi: r.bi, t: b ? triAt(b, r.point) : -1 };
      },
      blockGizmo: () => engine.blockGizmoState(),
      sel: () => engine.selectionState(),
      twinWarn: () => engine.twinWarnState(),
      compGhost: () => engine.compGhostState,
      compGhostReal: () => engine.compGhostReal(),
      compGhostBoxes: () => engine.compGhostBoxes(),
      hinge: () => engine.hingeInfo(),
      hingePoint: (i: number) => engine.hingeScreenPoint(i),
      wind: () => engine.windState(),
      // v1.6 TOOLS ▸ placement ghost (Spheroid): state + the pin-driven
      // whole-cell nudge (the widget commit routes through the same path)
      placeGhost: () => engine.clusterGhostState(),
      placePoint: () => engine.clusterGhostScreenPoint(),
      placeShift: (s: [number, number, number]) => engine.clusterGhostShift(s),
      // v1.5.21 adaptive grid + mirror axis; v1.5.22 measure ruler pins
      grid: () => engine.gridInfo(),
      mirAxis: () => engine.mirrorAxis,
      probe: () => engine.probeState(),
      probePoint: (w: 'base' | 'cap') => engine.probePointScreen(w),
    };
    onEngine?.(engine);
    return () => {
      ro.disconnect(); engine.dispose(); window.__ARCHEAN__ = undefined; onEngine?.(null);
    };
  }, []);                                    // eslint-disable-line react-hooks/exhaustive-deps

  // load()'s keepView: UNDO/REDO restores the SAME craft's earlier text, so
  // the camera must survive it (user v1.5.10: "ctrl-z resets view" — it made
  // A/B-comparing tool options impossible: every undo re-framed the shot).
  // A craft swap (openText) re-frames as ever. The prop is set in the SAME
  // batch as the bp it belongs to; read through a ref so the load effect
  // never re-fires on the flag alone.
  const keepViewRef = useRef(!!keepView);
  keepViewRef.current = !!keepView;

  useEffect(() => {
    if (!bp) return;
    let dead = false;
    (async () => {
      const atlas = await getAtlas();
      if (!dead) engineRef.current?.load(bp, atlas, keepViewRef.current);
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
  const hoverOn = mode === 'edit' && (tool === 'place' || !!placing);
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
  // ⊘ ('off') is SESSION-only — healed to the default at load, exactly like
  // the Engine (v1.5.1: the persisted ⊘ was the silent "no gizmo anywhere" trap)
  const [gmode, setGmode] = useState<'off' | 'translate' | 'rotate'>(() => {
    const m = localStorage.getItem('archean-app-gizmo-mode');
    return m === 'translate' || m === 'rotate' ? m : 'rotate';
  });
  // v1.8.0 FAUX-MIRROR ⚠ popup: poll the engine's conflict state (selection-
  // scoped, cheap) and re-anchor it every ~250 ms so it rides camera motion.
  const [warn, setWarn] = useState<{ text: string; info: boolean; x: number; y: number } | null>(null);
  useEffect(() => {
    const h = setInterval(() => {
      const e = engineRef.current, box = hostRef.current?.getBoundingClientRect();
      const w = e?.twinWarnState();
      setWarn(w && box ? { text: w.text, info: w.info, x: w.x - box.left, y: w.y - box.top } : null);
    }, 250);
    return () => clearInterval(h);
  }, []);
  // v1.6 TOOLS ▸ placement: the ✕ Cancel / ✔ Build label rides the ghost
  const [place, setPlace] = useState<
    { blocks: number; tris: number; valid: boolean; x: number; y: number } | null>(null);
  useEffect(() => {
    const h = setInterval(() => {
      const e = engineRef.current, box = hostRef.current?.getBoundingClientRect();
      const st = e?.clusterGhostState();
      const pt = st ? e!.clusterGhostScreenPoint() : null;
      setPlace(st && pt && box
        ? { blocks: st.blocks, tris: st.tris, valid: st.valid, x: pt.x - box.left, y: pt.y - box.top } : null);
    }, 200);
    return () => clearInterval(h);
  }, []);
  useEffect(() => {
    const sh = (e: KeyboardEvent, on: boolean) => {
      if (e.key === 'Shift') {
        engineRef.current?.setGizmoSnap(on);
        // the ghost re-aims the moment Shift goes down/up over a block (the
        // game swaps brush → continuation instantly, no mouse move needed)
        const h = lastHover.current;
        if (h && mode === 'edit' && tool === 'place') blockHover(h.x, h.y, on, true);
      }
      // a mid-smear Esc (the Editor drops the held part): yield the orbit NOW
      if (e.key === 'Escape' && placeDrag.current) {
        engineRef.current?.placeDragEnd();
        placeDrag.current = null;
      }
      // Esc ALSO cancels a tool placement ghost (v1.6, the label's ✕ twin)
      if (e.key === 'Escape' && engineRef.current?.clusterGhostState()) onPlaceCancel?.();
    };
    const dn = (e: KeyboardEvent) => sh(e, true), up = (e: KeyboardEvent) => sh(e, false);
    addEventListener('keydown', dn); addEventListener('keyup', up);
    return () => { removeEventListener('keydown', dn); removeEventListener('keyup', up); };
  }, [mode, tool, onBlockHover, onPlaceCancel]);
  const setMode = (m: 'off' | 'translate' | 'rotate') => {
    setGmode(m);
    engineRef.current?.setGizmoMode(m);
  };
  /** held-part smear-drag (v1.5.6, user: "placing it down it should not
   *  immediately place, but you can drag towards where the back of it should
   *  be, like smearing on"): pointerdown on a placeable surface asks the
   *  Engine to CAPTURE the gesture (orbit off — the drag is the tool), moves
   *  re-dock the real-model ghost along the hull and aim its back, and the
   *  release lands it at the final yaw. A press that hits nothing placeable
   *  stays a plain camera gesture. */
  const placeDrag = useRef<{ yaw: number } | null>(null);
  // v1.5.22 measure-ruler drag (a grabbed handle: base glides on the grid,
  // cap sets the height; orbit yields while held, twin of placeDrag)
  const probeDrag = useRef(false);
  const pickClick = (e: React.PointerEvent) => {
    const engine = engineRef.current;
    if (!engine) return;
    // VIEW picks NOTHING (v1.5 user rule: "selecting components shouldnt be
    // possible in view — view shows the amounts"): inspect only, no select,
    // no fly-to, no mode widget — the side panel keeps the vessel stats.
    if (mode === 'view') return;
    if (placing) { onPlace?.(e.clientX, e.clientY, 0); return; }   // KSP place: no select
    if (mode === 'edit') {                       // merged editor (v2.0.0)
      // the info chip still rides the plain pick path (scene.spec pin: a tap
      // routes through the pick path into the info chip)
      onPick(engine.pickAt(e.clientX, e.clientY));
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
      // v2.0 merged editor: this path only serves WIRE/FLIGHT/AERO now (edit
      // routes through onBlockPick, which pops the widget itself) — select +
      // fly, no mode widget.
      engine.select(hit.ci); engine.flyTo(hit.ci);
      setWidget(null);
    } else {
      if (hit.kind === 'sub' && hit.sub != null) engine.selectSub(hit.sub);
      else engine.select(-1);
      setWidget(null);
    }
  };

  return (
    <div ref={hostRef} className="relative h-full w-full" data-testid="viewport">
      <canvas ref={canvasRef} data-testid="canvas" className="block h-full w-full touch-none"
        onPointerDown={e => {
          down.current = { x: e.clientX, y: e.clientY };
          // the MEASURE RULER grabs first (v1.5.22): a press within a
          // handle's 18 px rides the ruler, not the orbit/placement
          if (e.button === 0 && engineRef.current?.probeDragStart(e.clientX, e.clientY)) {
            probeDrag.current = true;
            return;
          }
          if (placing && mode === 'edit' && e.button === 0 && !e.shiftKey &&
            engineRef.current?.placeDragStart(e.clientX, e.clientY))
            placeDrag.current = { yaw: engineRef.current.compGhostState?.yaw ?? 0 };
        }}
        onPointerMove={e => {
          if (probeDrag.current) {
            engineRef.current?.probeDragMove(e.clientX, e.clientY);
            return;                         // the ruler rides, not the orbit
          }
          if (placeDrag.current) {
            const y = engineRef.current?.placeDragMove(e.clientX, e.clientY);
            if (y != null) placeDrag.current.yaw = y;
            return;                       // the smear aims the ghost, not hover
          }
          blockHover(e.clientX, e.clientY, e.shiftKey);
        }}
        onPointerLeave={() => {
          if (probeDrag.current) { engineRef.current?.probeDragEnd(); probeDrag.current = false; }
          // the ghost dies with the pointer (the game's ghost too)
          lastHover.current = null;
          if (placeDrag.current) { engineRef.current?.placeDragEnd(); placeDrag.current = null; }
          if (hoverOn) onBlockHover?.(-1e5, -1e5, false);
        }}
        onPointerUp={e => {
          if (probeDrag.current) { engineRef.current?.probeDragEnd(); probeDrag.current = false; return; }
          if (placeDrag.current) {
            // the RELEASE places (the press only pins — "should not just
            // place immediately"; a zero-motion release = the old click,
            // yaw 0 = the identity pose)
            const yaw = placeDrag.current.yaw;
            engineRef.current?.placeDragEnd();
            placeDrag.current = null;
            onPlace?.(e.clientX, e.clientY, yaw);
            return;
          }
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
          {/* ⇄ mirror-twin BADGE (v1.8.0 uniform rule): a selection's twin always
              rides EVERY edit (position, rotation, shape, colour, material, delete)
              — this is an indicator: lit = a live twin pair, struck = none or the
              pair drifted apart (a FAUX-MIRROR: red boxes + ⚠ label name it) */}
          <button title="mirror twin — every edit mirrors to it" data-testid="mode-sym" disabled
            className={`ksp-btn grid h-8 w-9 place-items-center text-[15px] leading-none ${
              engineRef.current?.symState().active ? 'on' : 'line-through opacity-60'}`}>
            ⇄
          </button>
          {/* 🎨 PALETTE (v1.6): painting is a peer of moving/turning — this
              opens the colour window for the part/block under the widget */}
          <button title="paint this part/block (palette)" data-testid="mode-paint"
            onClick={() => onPaintOpen?.()}
            className="ksp-btn grid h-8 w-9 place-items-center text-[15px] leading-none">
            🎨
          </button>
        </div>
      )}
      {warn && (
        // v1.8.0 conflict = RED ⚠; v1.8.1 face-paint-only = informational
        // BLUE ℹ popup (the twin overlay stays gold — user: "just its popup")
        <div data-testid="twin-warn" role={warn.info ? 'status' : 'alert'}
          title={warn.info ? 'mirror twin differs in appearance only' : 'mirror-conflicting faux-mirror'}
          className={`ksp-win absolute z-30 flex max-w-[240px] -translate-x-1/2 items-start gap-1.5
                      rounded px-2 py-1 text-[10px] leading-snug ${
                        warn.info ? 'text-[#9cc8ff]' : 'text-[#ff9c9c]'}`}
          style={{ left: warn.x, top: Math.max(8, warn.y + 14) }}>
          <span className={`text-[13px] leading-none ${warn.info ? 'text-[#4da3ff]' : 'text-[#ff4d4d]'}`}>
            {warn.info ? 'ℹ' : '⚠'}</span>
          <span>{warn.text}</span>
        </div>
      )}
      {place && (
        // v1.6 placement label (user: "its label should have a cancel and
        // build button"): ✕ drops the ghost, ✔ writes it in — red while the
        // footprint collides (Build disabled, the constructor-ghost contract)
        <div data-testid="place-label"
          className={`ksp-win absolute z-30 flex -translate-x-1/2 items-center gap-1.5 rounded
                      px-2 py-1 text-[10px] leading-none ${place.valid ? 'text-[#9cffd4]' : 'text-[#ff9c9c]'}`}
          style={{ left: place.x, top: Math.max(8, place.y + 18) }}>
          <span>◍ {place.tris ? `${place.tris} triangles` : `${place.blocks} blocks`}{place.valid ? '' : ' — collides'}</span>
          <button data-testid="place-cancel" title="cancel this placement"
            onClick={() => onPlaceCancel?.()}
            className="ksp-btn rounded px-1.5 py-[3px] text-[11px] text-ink-dim hover:text-red-300">✕</button>
          <button data-testid="place-build" title="build it into the craft"
            disabled={!place.valid}
            onClick={() => onPlaceBuild?.()}
            className={`ksp-btn rounded px-2 py-[3px] text-[11px] font-semibold ${
              place.valid ? 'on' : 'opacity-50'}`}>
            ✔ Build
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
