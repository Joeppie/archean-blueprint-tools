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
     *  block owns the gizmo (Edit ▸ ✎ Edit flavor), else null */
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
    /** v1.8.6: the ghost's LIVE triangle records (what ✔ Build writes) — the
     *  v1.8.6 pin compares the ghost's AREA to the built file's */
    placeData: () => ReturnType<Engine['clusterGhostData']>;
    placePoint: () => ReturnType<Engine['clusterGhostScreenPoint']>;
    placeShift: (s: [number, number, number]) => boolean;
    /** v1.7.2: 90° quarter-turn of the ghost about a world axis (lattice law) */
    placeRotate: (axis: 'x' | 'y' | 'z') => boolean;
    /** v1.5.21 adaptive ground grid plan (step/major/spans in file coords) */
    grid: () => ReturnType<Engine['gridInfo']>;
    /** COORD READOUT: the snapped file-space point the ray LANDS ON —
     *  the visible surface's full x/y/z (flat plane x–z, y = UP per
     *  FORMAT §world maths), null when the ray misses the pad */
    coord: () => ReturnType<Engine['coordHoverState']>;
    /** the pad axis-marker labels (['−x','+x','−z','+z']) */
    axis: () => string[];
    /** v1.9.2 VIEW MENU: active projection + eye/target/zoom */
    view: () => ReturnType<Engine['viewState']>;
    /** v1.9.2 sky backdrop ({current, ready}) */
    backdrop: () => ReturnType<Engine['backdropState']>;
    /** v1.9.2 world (FILE metres) → client px — the ortho parallelism pin */
    screen: (x: number, y: number, z: number) => [number, number] | null;
    /** v1.9.2 framebuffer probe at normalized canvas coords (v from top) */
    pixel: (u: number, v: number) => [number, number, number] | null;
    /** v1.10.1 CABLE HOVER: the {pi, label} the cursor rests on (also set by
     *  the WIRE panel list-hover), null when nothing is hovered */
    wireHover: () => ReturnType<Engine['pipeHoverState']>;
    /** client px at the middle of a cable's drawn path (pins aim the mouse) */
    cablePoint: (pi: number) => { x: number; y: number } | null;
    /** v1.5.21 settable mirror axis (⚙ row) — 'off' (v1.10.5) disables it */
    mirAxis: () => 'x' | 'y' | 'z' | 'off';
    /** v1.11 TRIANGLE PIN EDITOR: {mode, pts, ti, arrow} | null, the client
     *  px of pin i (aim the mouse there to drag it), and the block STRETCH
     *  nudge (whole-cell footprint ext; signs[ax] = +1 grows the +a face /
     *  −1 the −a face, the OPPOSITE face stays anchored — the ⤢ widget's
     *  programmatic twin, for the size pins) */
    pins: () => ReturnType<Engine['pinsState']>;
    pinPoint: (i: number) => { x: number; y: number } | null;
    blockScale: (ext: [number, number, number], signs?: [number, number, number]) => boolean;
    /** v1.11 CENTROID WIDGET: the pinned triangle owning the gizmo, the
     *  whole-cell MOVE and the lattice-quantised ROTATE (the widget commit's
     *  exact paths, driven headless by the pins) */
    triGizmo: () => ReturnType<Engine['triGizmoState']>;
    triShift: (d: [number, number, number]) => boolean;
    triRotate: (axis: 'x' | 'y' | 'z', deg: number) => boolean;
  } }
}

let atlasP: Promise<ModelAtlas | null> | null = null;
const getAtlas = (): Promise<ModelAtlas | null> => (atlasP ??= openAtlas());

export default function Viewport({ bp, onPick, onEngine, mode = 'edit', tool, onBlockPick, onBlockHover, placing = null, onPlace, onPaintOpen, onBlockToTris, onPlaceCancel, onPlaceBuild, onPlaceRotate, onPlaceBack, onManifest, keepView = false }: {
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
  /** the side panel's PLACE|EDIT flavor (v1.5): the constructor ghost
   *  hovers only in PLACE; in the EDIT flavor only a held catalog part
   *  docks a ghost */
  tool?: 'edit' | 'place';
  onBlockPick?: (clientX: number, clientY: number, shift: boolean,
    /** pops the ⊘/✥/⟳/⇄ mode widget at the click point (v1.4: a component
     *  picked in the merged EDIT workspace gets the gizmo mode switch there
     *  too) */
    openWidget: () => void) => void;
  /** PLACE-flavor hover: the engine re-aims the ghost preview (shiftKey =
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
  /** v1.11 ▵ button (we: "Button should exist to turn block to triangle when
   *  selecting a block, on its widget"): convert the selected BLOCK into its
   *  hull-triangle skin (the scoped hullify law); block-owned widget only */
  onBlockToTris?: () => void;
  /** v1.6 TOOLS ▸ placement (Spheroid): the confirmed tool's movable ghost
   *  carries a label with ✕ Cancel / ✔ Build — both owned by the Editor */
  onPlaceCancel?: () => void;
  onPlaceBuild?: () => void;
  /** v1.7.2: ⟲ quarter-turn of the ghost (world axis) and ↩ back to the
   *  tool dialog with the parameters kept ("change parameters without
   *  starting from scratch") */
  onPlaceRotate?: (axis: 'x' | 'y' | 'z') => void;
  onPlaceBack?: () => void;
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
      placeData: () => engine.clusterGhostData(),
      placePoint: () => engine.clusterGhostScreenPoint(),
      placeShift: (s: [number, number, number]) => engine.clusterGhostShift(s),
      placeRotate: (axis: 'x' | 'y' | 'z') => engine.clusterGhostRotate(axis),
      // v1.5.21 adaptive grid + mirror axis; v1.5.23 coord readout pins
      grid: () => engine.gridInfo(),
      mirAxis: () => engine.mirrorAxis,
      coord: () => engine.coordHoverState(),
      axis: () => engine.axisMarks(),
      // v1.9.2 VIEW MENU pins: projection swap, sky backdrop, world→px and
      // the framebuffer probe (the see-through-ground pin asserts PIXELS)
      view: () => engine.viewState(),
      backdrop: () => engine.backdropState(),
      screen: (x: number, y: number, z: number) => engine.screenPoint(x, y, z),
      pixel: (u: number, v: number) => engine.probePixel(u, v),
      wireHover: () => engine.pipeHoverState(),
      cablePoint: (pi: number) => engine.pipeScreenPoint(pi),
      // v1.11 TRIANGLE PIN EDITOR + BLOCK STRETCH hooks for the pins
      pins: () => engine.pinsState(),
      pinPoint: (i: number) => engine.pinScreenPoint(i),
      blockScale: (ext, signs) => engine.blockGizmoScale(ext, signs),
      triGizmo: () => engine.triGizmoState(),
      triShift: (d) => engine.triGizmoShift(d),
      triRotate: (axis, deg) => engine.triGizmoRotate(axis, deg),
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
  // hover routing (v1.4): the Edit mode's PLACE flavor drives the
  // constructor ghost; while a catalog part is HELD the same path docks
  // the part ghost.
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
  // v1.11: does a BLOCK own the widget (→ the ⤢ stretch row shows)? The
  // Editor's setBlockGizmo effect lands AFTER this component's render, so
  // the flag is polled (120 ms) while the widget is open, never derived at
  // render time — a component-owned widget never shows the row.
  const [wBlock, setWBlock] = useState(false);
  useEffect(() => {
    if (!widget) return;
    const read = () => setWBlock(!!engineRef.current?.blockGizmoState()?.shown);
    read();
    const h = setInterval(read, 120);
    return () => clearInterval(h);
  }, [widget]);
  // ⊘ ('off') is SESSION-only — healed to the default at load, exactly like
  // the Engine (v1.5.1: the persisted ⊘ was the silent "no gizmo anywhere" trap)
  const [gmode, setGmode] = useState<'off' | 'translate' | 'rotate' | 'scale'>(() => {
    const m = localStorage.getItem('archean-app-gizmo-mode');
    return m === 'translate' || m === 'rotate' || m === 'scale' ? m : 'rotate';
  });
  // v1.8.0 FAUX-MIRROR ⚠ popup: poll the engine's conflict state (selection-
  // scoped, cheap) and re-anchor it every ~250 ms so it rides camera motion.
  const [warn, setWarn] = useState<{ text: string; info: boolean; x: number; y: number } | null>(null);
  // v1.11 (we: "on mobile, the warning popups for mirroring shouldn't be on
  // top of interface"): phones dock the popup at the viewport's bottom edge
  // (above the build dock) as a compact strip instead of the 3-D anchor
  const [mobile, setMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const h = () => setMobile(window.innerWidth < 768);
    addEventListener('resize', h);
    return () => removeEventListener('resize', h);
  }, []);
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
      // (KEYDOWN ONLY — the same keystroke's keyup fires after the tool
      // dialog's capture-phase Escape handler has already closed the modal,
      // and canceling THEN would kill the ghost that ↩ deliberately left
      // waiting behind the dialog, v1.7.2 e2e)
      if (!on) return;
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
  const setMode = (m: 'off' | 'translate' | 'rotate' | 'scale') => {
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
  // v1.5.23 coord-readout chip (Blender-style black label following the
  // cursor; text set imperatively — a React state per pointermove is waste)
  const chipRef = useRef<HTMLDivElement>(null);
  // v1.9.2 coord-readout throttle (see onPointerMove): the last raycast
  // result rides between the ~40 Hz re-probes; coordLast/coordTrail give
  // the throttle a TRAILING edge — the pointer's final position ALWAYS
  // gets its raycast (a hover that stops mid-window must still converge;
  // the views.spec "hovering the CRAFT" pin asserts exactly that)
  const coordT = useRef(0);
  const coordInfo = useRef<{ x: number; y: number; z: number; step: number } | null>(null);
  const coordTrail = useRef<ReturnType<typeof setTimeout> | null>(null);
  const coordLast = useRef({ x: 0, y: 0 });
  /** paint the black chip (imperative — a React state per move is waste) */
  const showCoord = (info: { x: number; y: number; z: number; step: number } | null,
    cx: number, cy: number) => {
    const chip = chipRef.current, host = hostRef.current;
    if (!chip || !host) return;
    if (!info) { chip.style.display = 'none'; return; }
    const hr = host.getBoundingClientRect();
    const dg = info.step < 0.25 ? 2 : 1;
    const f = (v: number) => (Object.is(v, -0) ? 0 : v).toFixed(dg);
    chip.textContent = `x ${f(info.x)}  y ${f(info.y)}  z ${f(info.z)}`;
    chip.style.display = 'block';
    chip.style.left = `${Math.min(Math.max(4, cx - hr.left + 14), hr.width - 170)}px`;
    chip.style.top = `${Math.max(4, cy - hr.top + 16)}px`;
  };
  // v1.10.1 CABLE HOVER chip (user: "on mouse-over of a cable, it should
  // tell us where things are going. e.g. 'propeller[9].1 <-> Computer[0].1'"):
  // the SAME throttled pass ray-to-polyline-tests the drawn cable net; when
  // a cable is under the cursor its endpoint label rides a gold chip right
  // below the coord chip and the engine gold-lights the cable itself.
  const wireChipRef = useRef<HTMLDivElement>(null);
  const wireInfo = useRef<{ pi: number; label: string } | null>(null);
  // v1.11 (we: "moving the cursor causes labels for the wires to show up,
  // I guess that's fine if after 100 Ms"): the chip DWELLS — a cable must
  // hold the cursor ~120 ms before its label appears (sweeps stay quiet);
  // and 2 s of SOLID highlight opens the X-ray: the geometry between the
  // camera and the cable's two parts thins out (engine.beginWireXray),
  // restored the moment the hover ends.
  const wireDwell = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wireShown = useRef(false);
  const wirePos = useRef({ cx: 0, cy: 0 });
  const xrayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const xrayPi = useRef(-1);
  const renderWireChip = (label: string, cx: number, cy: number) => {
    const chip = wireChipRef.current, host = hostRef.current;
    if (!chip || !host) return;
    const hr = host.getBoundingClientRect();
    chip.textContent = label;
    chip.style.display = 'block';
    // v1.11: clamp by the MEASURED chip (a long label wraps, never clips —
    // the fixed 260 px clamp cut the tail off)
    const w = chip.offsetWidth, h = chip.offsetHeight;
    chip.style.left = `${Math.min(Math.max(4, cx - hr.left + 14), hr.width - w - 8)}px`;
    chip.style.top = `${Math.max(4, Math.min(cy - hr.top + 38, hr.height - h - 6))}px`;
  };
  const showWire = (info: { pi: number; label: string } | null, cx: number, cy: number) => {
    const chip = wireChipRef.current;
    if (!chip) return;
    if (!info || !info.label) {
      if (wireDwell.current) { clearTimeout(wireDwell.current); wireDwell.current = null; }
      if (xrayTimer.current) { clearTimeout(xrayTimer.current); xrayTimer.current = null; }
      if (xrayPi.current >= 0) { xrayPi.current = -1; engineRef.current?.endWireXray(); }
      wireShown.current = false;
      chip.style.display = 'none';
      return;
    }
    wirePos.current = { cx, cy };
    if (!wireShown.current && !wireDwell.current) {
      wireDwell.current = setTimeout(() => {
        wireDwell.current = null;
        const w = engineRef.current?.pipeHoverState();
        if (w?.label) { wireShown.current = true; renderWireChip(w.label, wirePos.current.cx, wirePos.current.cy); }
      }, 120);
    } else if (wireShown.current) renderWireChip(info.label, cx, cy);
    if (info.pi !== xrayPi.current) {
      xrayPi.current = info.pi;
      engineRef.current?.endWireXray();
      if (xrayTimer.current) clearTimeout(xrayTimer.current);
      xrayTimer.current = setTimeout(() => {
        xrayTimer.current = null;
        const w = engineRef.current?.pipeHoverState();
        if (w && w.pi === info.pi) engineRef.current?.beginWireXray(info.pi);
      }, 2000);
    }
  };
  /** one throttled raycast + chip repaint */
  const coordRun = (x: number, y: number) => {
    coordT.current = performance.now();
    coordInfo.current = engineRef.current?.coordHoverMove(x, y) ?? null;
    showCoord(coordInfo.current, x, y);
    wireInfo.current = engineRef.current?.pipeHoverMove(x, y) ?? null;
    showWire(wireInfo.current, x, y);
  };
  const pickClick = (e: React.PointerEvent) => {
    const engine = engineRef.current;
    if (!engine) return;
    // v1.11: a pin drag just ended → the release is NOT a canvas click (it
    // must not drop a 4th pin / re-place under the pin that was moved)
    if (engine.pinGesture()) return;
    // v1.11: the pointer rests ON a gizmo handle (TGC's live axis) — the
    // click belongs to the widget, it must not place/select through it
    if (engine.gizmoDragAxis()) return;
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
          if (placing && mode === 'edit' && e.button === 0 && !e.shiftKey &&
            engineRef.current?.placeDragStart(e.clientX, e.clientY))
            placeDrag.current = { yaw: engineRef.current.compGhostState?.yaw ?? 0 };
        }}
        onPointerMove={e => {
          if (placeDrag.current) {
            const y = engineRef.current?.placeDragMove(e.clientX, e.clientY);
            if (y != null) placeDrag.current.yaw = y;
            return;                       // the smear aims the ghost, not hover
          }
          blockHover(e.clientX, e.clientY, e.shiftKey);
          // BLENDER-STYLE COORD READOUT: the grid corner the ray lands on
          // (x–z flat plane, y = UP per FORMAT §world maths).
          // v1.9.2 PERF (audit): the SAME ~40 Hz raycast cap as the ghost —
          // this used to pay a FULL recursive scene raycast on EVERY
          // pointermove event; high-poll mice fire ~120 Hz, so the readout
          // silently taxed every hover on a giant craft. With TRAILING EDGE:
          // the position the pointer STOPS at always gets raycast.
          coordLast.current = { x: e.clientX, y: e.clientY };
          const cnow = performance.now();
          if (cnow - coordT.current >= 24) {
            if (coordTrail.current) { clearTimeout(coordTrail.current); coordTrail.current = null; }
            coordRun(e.clientX, e.clientY);
          } else {
            if (!coordTrail.current) {
              coordTrail.current = setTimeout(() => {
                coordTrail.current = null;
                coordRun(coordLast.current.x, coordLast.current.y);
              }, Math.max(1, 25 - (cnow - coordT.current)));
            }
            showCoord(coordInfo.current, e.clientX, e.clientY);   // follows live, cheap
            showWire(wireInfo.current, e.clientX, e.clientY);     // idem the cable label
          }
        }}
        onPointerLeave={() => {
          if (coordTrail.current) { clearTimeout(coordTrail.current); coordTrail.current = null; }
          engineRef.current?.coordHoverClear();
          engineRef.current?.clearPipeHover();
          coordInfo.current = null;
          wireInfo.current = null;
          if (chipRef.current) chipRef.current.style.display = 'none';
          showWire(null, 0, 0);              // resets dwell + xray timers
          // the ghost dies with the pointer (the game's ghost too)
          lastHover.current = null;
          if (placeDrag.current) { engineRef.current?.placeDragEnd(); placeDrag.current = null; }
          if (hoverOn) onBlockHover?.(-1e5, -1e5, false);
        }}
        onPointerUp={e => {
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
          {/* v1.11 STRETCH (we: "you can choose to move/rotate/scale it;
              scaling means stretching in a direction"): the ⤢ row appears
              ONLY when a BLOCK owns the widget — the game has no part scale,
              so a component never sees it. A gesture grows/shrinks the
              footprint in whole cells about the bbox centre. */}
          {wBlock && (
            <button title="stretch — drag a face; that face moves, the opposite one stays anchored (whole cells)" data-testid="mode-scale"
              onClick={() => setMode('scale')}
              className={`ksp-btn grid h-8 w-9 place-items-center text-[15px] leading-none ${gmode === 'scale' ? 'on' : ''}`}>
              ⤢
            </button>
          )}
          {/* v1.11 ▵ (we: "Button should exist to turn block to triangle when
              selecting a block, on its widget"): the block's free faces
              become its hull-triangle skin (scoped hullify law, game
              outward+flat convention); the block is removed, Undo restores */}
          {wBlock && (
            <button title="▵ turn this block into hull triangles (its free faces become the skin; the block is removed — Undo returns it)"
              data-testid="mode-tris" onClick={() => onBlockToTris?.()}
              className="ksp-btn grid h-8 w-9 place-items-center text-[15px] leading-none">
              ▵
            </button>
          )}
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
          className={`ksp-win absolute z-30 flex items-start gap-1.5
                      rounded px-2 py-1 text-[10px] leading-snug ${
                        warn.info ? 'text-[#9cc8ff]' : 'text-[#ff9c9c]'} ${
                        mobile ? 'inset-x-2 bottom-[calc(38%+10px)]'
                          : 'max-w-[240px] -translate-x-1/2'}`}
          style={mobile ? undefined : { left: warn.x, top: Math.max(8, warn.y + 14) }}>
          <span className={`text-[13px] leading-none ${warn.info ? 'text-[#4da3ff]' : 'text-[#ff4d4d]'}`}>
            {warn.info ? 'ℹ' : '⚠'}</span>
          <span>{warn.text}</span>
        </div>
      )}
      {place && (
        // v1.6 placement label (user: "its label should have a cancel and
        // build button"): ✕ drops the ghost, ✔ writes it in — red while the
        // footprint collides (Build disabled, the constructor-ghost contract).
        // v1.7.2 adds ⟲x/⟲y/⟲z quarter-turns (the lattice only stores 90°
        // steps — quarter-snap BY LAW, not taste) and ↩ back to the tool
        // dialog with the form intact ("without starting from scratch").
        <div data-testid="place-label"
          className={`ksp-win absolute z-30 flex max-w-[min(96vw,30rem)] -translate-x-1/2 flex-wrap
                      items-center gap-1.5 rounded
                      px-2 py-1 text-[10px] leading-none ${place.valid ? 'text-[#9cffd4]' : 'text-[#ff9c9c]'}`}
          style={{ left: place.x, top: Math.max(8, place.y + 18) }}>
          <span>◍ {place.tris ? `${place.tris} triangles` : `${place.blocks} blocks`}{place.valid ? '' : ' — collides'}</span>
          {(['x', 'y', 'z'] as const).map(ax => (
            <button key={ax} data-testid={`place-rot-${ax}`} title={`turn 90° about world ${ax.toUpperCase()} (lattice quarter-turn)`}
              onClick={() => onPlaceRotate?.(ax)}
              className="ksp-btn rounded px-1.5 py-[3px] text-[11px] text-ink-dim hover:text-gold">
              ⟲{ax}
            </button>
          ))}
          <button data-testid="place-back" title="back to the parameters (nothing is lost)"
            onClick={() => onPlaceBack?.()}
            className="ksp-btn rounded px-1.5 py-[3px] text-[11px] text-ink-dim hover:text-accent">
            ↩ edit
          </button>
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
      {/* the black coord label, Blender-style, follows the cursor */}
      <div ref={chipRef} data-testid="coord-chip" style={{ display: 'none' }}
        className="pointer-events-none absolute z-30 rounded-sm bg-black/85 px-1.5 py-[1px]
                   font-mono text-[11px] tracking-tight text-[#e8e8e8]" />
      {/* v1.10.1 the GOLD cable label: "Propeller[9].lowvoltage ↔ Computer[0].data_port.001" */}
      <div ref={wireChipRef} data-testid="wire-chip" style={{ display: 'none' }}
        className="pointer-events-none absolute z-30 max-w-[min(92%,420px)] rounded-sm
                   bg-[#241c05]/90 px-1.5 py-[1px] font-mono text-[11px] leading-snug tracking-tight
                   text-[#ffd479] ring-1 ring-[#ffd479]/40" />
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
