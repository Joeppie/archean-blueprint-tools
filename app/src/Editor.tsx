// Editor.tsx — the full-screen KSP-VAB editing workspace (lazy chunk: the
// gallery never loads three.js/the engine). Viewport fills the window, the
// parts panel docks LEFT (mobile: a drawer behind ⚙), STATIC INFO (mass &
// CoM) floats bottom-left, the camera-preset cluster bottom-right. Blueprints
// stream through crafts.ts (IndexedDB cache: a cached craft opens with zero
// network; the KSP "receiving blueprint" overlay shows only on a real
// download). Holds the raw-literal DOC + live bp; see App.tsx for the shell.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { craftName } from './gallery-catalog';
import { DEFAULT_OPTS, type Backdrop, type Engine, type PickHit, type ViewOptions } from './engine/scene';
import Viewport from './components/Viewport';
import Panel, { StaticInfo, ViewOpts, type EditApi } from './components/Panel';
import TopBar, { type Mode } from './components/TopBar';
import { BlockPanel, FlightPanel, TriPanel, WirePanel, WindPanel, brushSpec, placeBlock, type Brush } from './components/ModePanels';
import { BlockPaint, CompPaint, SwatchGrid } from './components/ColorPanel';
import { TOOLS, ToolDialog, type PlacePayload, type ToolForm } from './components/ToolsDialog';
import HelpDialog from './components/HelpDialog';
import { blockInfo, blockMirrorTwin, blockTwinIssues, cellIndex, cellOverlap,
  complementBlock, mirrorAxisIdx, paintTwinPair, type MirrorAxis } from './engine/blocks';
import { cornerOf, triAt, triangleFromCorners } from './engine/tris';
import type { Blueprint } from './engine/format';
import { isLegacyFile } from './engine/format';
import type { ResolvedColor } from './engine/palette';
import { docArrayInsert, docArrayRemoveAt, docEnsureArray, docFromValue, docValue, emitDoc, parseDoc } from './engine/doc';
import { allocateSlot, paletteSlotNode, type Rgb255 } from './engine/tools';
import { setPaletteSlot } from './engine/edit';
import { appendTrianglesDoc, makeCtx, openFunnel, resetComponent, setDataField, setOrientation, setPos, setCompField,
  pruneCompRefs, setCompColor, serializeSave, writeBlockDoc, type EditCtx } from './engine/edit';
import { makePipe } from './engine/wireops';
import { normalizeDoc } from './engine/normalize';
import { qAxisAngle } from './engine/compparts';
import { newCraftDoc, newComponent } from './engine/newcraft';
import { loadCraft } from './crafts';

export default function Editor({ craft, onBack }: { craft: string | null; onBack: () => void }) {
  const [bp, setBp] = useState<Blueprint | null>(null);
  /** the bp-swaps that are UNDO/REDO (same craft) keep the camera; see the
   *  Viewport keepView prop. openText (a craft swap) always clears it. */
  const [bpKeepView, setBpKeepView] = useState(false);
  const [sel, setSel] = useState<{ ci: number; sub: number }>({ ci: -1, sub: -1 });
  const [hit, setHit] = useState<PickHit | null>(null);
  const [dirty, setDirty] = useState(false);
  const [inspKey, setInspKey] = useState(0);
  const [mode, setMode] = useState<Mode>(() =>
    new URLSearchParams(window.location.search).has('aero') ? 'aero' : 'view');
  const [opts, setOpts] = useState<ViewOptions>(DEFAULT_OPTS);
  const [hullOpacity, setHullOpacityState] = useState(1);
  // v1.5.1: the gizmo master is SESSION-only (default ON) — its old persisted
  // key was poisoned by the view-mode gate, so it is no longer read at all.
  const [gizmoOn, setGizmoOn] = useState(true);
  const [hiDef, setHiDefState] = useState(() => localStorage.getItem('archean-app-hidef') !== '0');
  // the KSP STATIC INFO box (mass & CoM) is OPTIONAL (user 2026-10-19: "static
  // info shouldn't necessarily show. it's too large on mobile, hide it under
  // settings, x to close panel itself"): no unsolicited overlay — the ⚙ view
  // options owns the switch (row static info box) and the box has its own ✕.
  // With no stored choice, phones start WITHOUT it (it covered a third of the
  // viewport); desktop starts with it as before.
  const [staticInfo, setStaticInfo] = useState(() => {
    const s = localStorage.getItem('archean-app-static-info');
    return s === null ? window.innerWidth >= 768 : s === '1';
  });
  useEffect(() => { localStorage.setItem('archean-app-static-info', staticInfo ? '1' : '0'); }, [staticInfo]);
  const [rev, setRev] = useState(0);
  const [blockSel, setBlockSel] = useState(-1);
  // the brush's default paint is an OPAQUE hull grey (v1.6: slot 4 is the
  // built-in CLEAR GLASS — the old default placed translucent ghost blocks,
  // the root of the "my blocks turned translucent" report)
  const [brush, setBrush] = useState<Brush>({ type: 0, sx: 0, sy: 0, sz: 0, slot: 51, material: 0 });
  // the TOOLS menu ▸ ToolDialog modal (v1.7): one open tool id at a time
  const [toolOpen, setToolOpen] = useState<string | null>(null);
  // Help ▸ Manual… — the built-in markdown manual (v1.5.20)
  const [helpOpen, setHelpOpen] = useState(false);
  // v1.6 PLACEMENT staging (Spheroid): the dialog confirmed, the engine
  // ghosts the cluster (movable, CELL-snapped) and the viewport label offers
  // ✕ Cancel / ✔ Build; the commit lands at the user's final cell offset.
  const [placeStage, setPlaceStage] = useState<
    { toolId: string; form: ToolForm; payload: PlacePayload } | null>(null);
  /** v1.7.2 ↩: the cell offset the ghost had when the dialog reopened —
   *  re-staging after a parameter change lands where the user dragged it */
  const pendingPlaceOffset = useRef<[number, number, number] | null>(null);
  // the toast line a finished tool printed under the menu (auto-clears below)
  const [toolMsg, setToolMsg] = useState('');
  // 🎨 PALETTE window over the viewport (v1.6): the paint alternative to the
  // move/rotate gizmo, opened from the canvas mode widget for the CURRENT
  // selection (block ▸ per-face, component ▸ color1/color2, else the brush).
  const [paintOpen, setPaintOpen] = useState(false);
  // THE panel flavor (v1.5 user rule): ONE ✎ Edit | ✚ Place switch crowns the
  // side panel in BOTH the Edit and Blocks modes — the two flavors of the
  // SAME panel. Edit = select for gizmo/inspector/DELETE; Place = brush +
  // catalog with the dock ghost. Persisted; shared across the modes.
  const [tool, setToolState] = useState<'place' | 'edit'>(
    () => (localStorage.getItem('archean-app-panel-tool') === 'place' ? 'place' : 'edit'));
  const setTool = useCallback((t: 'place' | 'edit') => {
    setToolState(t);
    localStorage.setItem('archean-app-panel-tool', t);
  }, []);
  const [blockSub, setBlockSub] = useState<'blocks' | 'tris'>('blocks');
  // ⇄ mirrored placement (blocks AND catalog parts): the twin lands at the
  // mirrored cell/position about the SESSION mirror axis's 0-plane — the
  // game editor's mirror tool
  const [mirrorPlace, setMirrorPlace] = useState(() => localStorage.getItem('archean-app-plsym') === '1');
  useEffect(() => { localStorage.setItem('archean-app-plsym', mirrorPlace ? '1' : '0'); }, [mirrorPlace]);
  // v1.5.21 SETTABLE MIRROR AXIS (⚙ row, user: "mirror axes should be
  // settable. Game is not hardcoded x"): the Engine owns the live value
  // (same localStorage key, its own default); the React twin exists so the
  // ⚙ row re-renders. Engine reads are through engineRef for the callbacks.
  const [mirAxis, setMirAxis] = useState<MirrorAxis>(() =>
    (['x', 'y', 'z'] as string[]).includes(localStorage.getItem('archean-app-mirror-axis') ?? '')
      ? localStorage.getItem('archean-app-mirror-axis') as MirrorAxis : 'x');
  const onMirrorAxis = useCallback((a: MirrorAxis) => {
    setMirAxis(a);
    engineRef.current?.setMirrorAxis(a);
  }, []);
  // v1.9.2 THE VIEW MENU (⚙ renamed, user: "rename that to view … under view
  // also add a mode for orthogonal"): SKY BACKDROP + ORTHOGRAPHIC rows.
  // The Engine owns the live values (localStorage + its own defaults at
  // attach); the React twins exist so the rows re-render — the mirAxis
  // precedent. onEngine re-syncs both from the engine (engine is truth).
  const [backdrop, setBackdrop] = useState<Backdrop>(() =>
    (['none', 'mars', 'earth'] as string[]).includes(localStorage.getItem('archean-app-backdrop') ?? '')
      ? localStorage.getItem('archean-app-backdrop') as Backdrop : 'none');
  const onBackdrop = useCallback((b: Backdrop) => {
    setBackdrop(b);
    engineRef.current?.setBackdrop(b);
  }, []);
  const [ortho, setOrtho] = useState(() => localStorage.getItem('archean-app-ortho') === '1');
  const onOrtho = useCallback((v: boolean) => {
    setOrtho(v);
    engineRef.current?.setProjection(v);
  }, []);
  /** the axis for callbacks that run outside React render (engine is truth) */
  const mirAx = useCallback((): MirrorAxis => engineRef.current?.mirrorAxis ?? 'x', []);
  const [triDraft, setTriDraft] = useState<number[][]>([]);
  const [triSel, setTriSel] = useState(-1);
  const [triBrush, setTriBrush] = useState<number[]>([51, 51, 51, 51, 51]);
  // KSP part placement: the catalog type currently HELD (null = nothing)
  const [placing, setPlacing] = useState<string | null>(null);
  const [manifest, setManifest] = useState<Record<string, { mass: number; module: string }> | null>(null);
  // blueprint download state (overlay): null = nothing in flight / cached
  const [dl, setDl] = useState<{ frac: number | null; bytes: number } | null>(null);
  const [dlErr, setDlErr] = useState(false);
  const [retrySeq, setRetrySeq] = useState(0);
  const forceRef = useRef(false);             // File ▾ Refresh: one-shot re-download
  /** Esc precedence (v1.7.2): while a tool dialog is open, Esc belongs to
   *  the DIALOG — the viewport's Esc-⇒-place-cancel must stand down */
  const toolOpenRef = useRef<string | null>(null);
  toolOpenRef.current = toolOpen;
  const engineRef = useRef<Engine | null>(null);
  const ctxRef = useRef<EditCtx | null>(null);
  /** the rotation STORAGE law of the craft AS ON DISK (raw for palette-less
   *  sources). normalize() embeds data.colors, so the law must outlive the
   *  migration — the game stores quaternion bytes VERBATIM, so an open→save
   *  may never flip a rotation, and undo re-parses ALREADY-converted text
   *  (the law cannot be re-derived from it; v1.5.11, savefidelity pins). */
  const legacyRef = useRef(true);
  const dirtyRef = useRef(false);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // mobile: the panel is a drawer; desktop opens it by default
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth >= 768);
  // view options live in their own ⚙ popover (NOT the left parts panel —
  // the user: "the full list of options shouldnt be combined into the main
  // left-hand panel/menu")
  const [optsOpen, setOptsOpen] = useState(false);
  useEffect(() => { if (!toolMsg) return; const t = setTimeout(() => setToolMsg(''), 4000); return () => clearTimeout(t); }, [toolMsg]);

  // ------------------------------------------------------------------ HISTORY
  // 2026-10-20 UNDO/REDO (user: "ALL operations should retain a undo/redo history,
  // and be in edit menu"). Snapshot-based (the backlog design): a COMMIT is
  // the doc's FULL literal text via emitDoc — every mutation path already
  // mirrors bp → doc, and the raw literals keep saves byte-exact. Coalescing
  // is time-windowed: sceneChanged/markDirty re-arm one 450 ms timer, so one
  // gizmo/slider DRAG (dozens of writes) lands as ONE history entry while
  // separate clicks stay separate steps. Undo/redo re-parse the snapshot
  // through the SAME open funnel (parse → normalize → makeCtx → setBp), so
  // engine, doc and ctx can never drift apart; Ctrl+Z / Ctrl+Shift+Z /
  // Ctrl+Y and the Edit ▾ menu both call these.
  const histRef = useRef<{ states: string[]; p: number; timer: ReturnType<typeof setTimeout> | null }>({
    states: [], p: 0, timer: null,
  });
  const [histTick, setHistTick] = useState(0);
  const commitSnapshot = useCallback(() => {
    const ctx = ctxRef.current, h = histRef.current;
    if (!ctx) return;
    const text = emitDoc(ctx.doc);
    if (text === h.states[h.p]) return;
    h.states = h.states.slice(0, h.p + 1);          // a new edit drops REDO
    h.states.push(text); h.p = h.states.length - 1;
    setHistTick(t => t + 1);
  }, []);
  const snapshotSoon = useCallback(() => {
    const h = histRef.current;
    if (h.timer) clearTimeout(h.timer);             // extend the open gesture
    h.timer = setTimeout(() => { h.timer = null; commitSnapshot(); }, 450);
  }, [commitSnapshot]);
  const flushSnapshot = useCallback(() => {
    const h = histRef.current;
    if (h.timer) { clearTimeout(h.timer); h.timer = null; }
    commitSnapshot();
  }, [commitSnapshot]);
  const applyHistory = useCallback((state: string) => {
    const d = parseDoc(state);
    normalizeDoc(d);                                // idempotent on snapshots
    const bp = docValue(d) as Blueprint;
    bp.__legacyQ = legacyRef.current;               // the session's law (the
    ctxRef.current = makeCtx(d, bp);                // snapshot text is post-migration)
    const dirtyNow = state !== histRef.current.states[0];
    dirtyRef.current = dirtyNow; setDirty(dirtyNow);
    setSel({ ci: -1, sub: -1 }); setBlockSel(-1); setTriSel(-1); setTriDraft([]);
    setPlacing(null); setHit(null);
    engineRef.current?.select(-1);
    if (reloadTimer.current) { clearTimeout(reloadTimer.current); reloadTimer.current = null; }
    // undo/redo = the SAME craft's earlier text: the Viewport load must KEEP
    // the camera (user: "ctrl-z resets view" — it killed tool-option A/B).
    setBpKeepView(true);
    setBp(ctxRef.current.bp);                       // the Viewport reloads it
    setHistTick(t => t + 1);
  }, []);
  const undo = useCallback(() => {
    flushSnapshot();
    const h = histRef.current;
    if (h.p <= 0) return;
    h.p -= 1; applyHistory(h.states[h.p]!);
  }, [flushSnapshot, applyHistory]);
  const redo = useCallback(() => {
    flushSnapshot();
    const h = histRef.current;
    if (h.p >= h.states.length - 1) return;
    h.p += 1; applyHistory(h.states[h.p]!);
  }, [flushSnapshot, applyHistory]);

  /** parse → v1→v2 NORMALIZE → doc+ctx → live bp. One funnel for download,
   *  file-open, drag-drop and New craft. */
  const openText = useCallback((text: string) => {
    const { doc, ctx, legacy } = openFunnel(text);   // parse → law stamp → normalize
    legacyRef.current = legacy;
    ctxRef.current = ctx;
    dirtyRef.current = false;
    setDirty(false); setSel({ ci: -1, sub: -1 }); setBlockSel(-1); setPlacing(null);
    histRef.current = { states: [emitDoc(doc)], p: 0, timer: null };
    setHistTick(t => t + 1);
    setBpKeepView(false);                           // a craft swap re-frames
    engineRef.current?.setClusterGhost(null);       // a pending tool placement dies with the craft
    setPlaceStage(null);
    setBp(ctxRef.current.bp);
  }, []);

  useEffect(() => {
    setBp(null);
    if (!craft) { openText(emitNew()); return; }    // New craft (craft === null)
    let dead = false;
    const force = forceRef.current; forceRef.current = false;
    setDlErr(false);
    (async () => {
      const r = await loadCraft(craft, (frac, bytes) => { if (!dead) setDl({ frac, bytes }); }, force);
      if (dead) return;
      setDl(null);
      if (!r) { setDlErr(true); return; }           // no cache + network failed
      openText(r.text);                             // cache hit: no overlay, no network
    })().catch(console.error);
    return () => { dead = true; };
  }, [craft, openText, retrySeq]);

  const emitNew = () => {
    // doc → text round trip through the SAME doc the editor then keeps
    const d = newCraftDoc();
    return JSON.stringify(docValue(d));
  };

  const markDirty = useCallback(() => {
    if (!dirtyRef.current) { dirtyRef.current = true; setDirty(true); }
    snapshotSoon();                               // 2026-10-20 undo (drag-coalesced)
  }, [snapshotSoon]);
  const bumpRev = useCallback(() => setRev(r => r + 1), []);

  /** block/wire mutations rebuild the merged scene — debounced so slider
   *  drags do not rebuild on every tick */
  const sceneChanged = useCallback(() => {
    markDirty(); bumpRev();
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => engineRef.current?.reload(), 180);
  }, [markDirty, bumpRev, snapshotSoon]);

  // v1.8.1 CABLES FOLLOW THE PART: data.pipes is the game's cached route, so
  // a moved part leaves the recorded tips behind. The engine re-anchors the
  // ends onto the LIVE sockets (sockets.ts); this only pokes that cheap
  // cable-pass rebuild on the same drag-debounce rhythm as the reload.
  const pipesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pipesSoon = useCallback(() => {
    if (!engineRef.current?.pipeInfo().pipes) return;   // craft without cables: no-op
    if (pipesTimer.current) clearTimeout(pipesTimer.current);
    pipesTimer.current = setTimeout(() => { pipesTimer.current = null; engineRef.current?.rebuildPipes(); }, 250);
  }, []);

  // ---- v1.6 TOOLS ▸ placement flow (Spheroid): dialog OK → movable ghost +
  // ✕ Cancel / ✔ Build label → Build commits at the final cell offset ------
  const onPlaced = useCallback((tool: { id: string }, form: ToolForm, payload: PlacePayload) => {
    engineRef.current?.setBlockGizmo(-1, false);   // free the widget from a block
    engineRef.current?.select(-1);                 // …and from a component
    // the placement widget IS the tool (the user drags the ghost): raise it
    // even when the VIEW-mode gate holds it down — Cancel/Build restore the
    // gated state (the ⚙ SESSION row itself is untouched, v1.5.1 rule)
    engineRef.current?.setGizmoEnabled(true);
    engineRef.current?.setClusterGhost(payload.blocks ?? null, 0x7dffcf,
      payload.triangles ?? null, payload.rides ?? null);
    // v1.7.2 ↩ BACK: re-staging after a parameter change carries the cell
    // offset the user already dragged to (the shape changed, not the spot)
    const po = pendingPlaceOffset.current;
    pendingPlaceOffset.current = null;
    if (po) engineRef.current?.clusterGhostShift(po);
    setPlaceStage({ toolId: tool.id, form, payload });
  }, []);
  /** ↩ on the placement label: reopen the tool dialog with the SAME form
   *  (the ghost waits behind the backdrop — "change parameters without
   *  starting from scratch") */
  const onPlaceBack = useCallback(() => {
    const st = engineRef.current?.clusterGhostState();
    if (st) pendingPlaceOffset.current = st.offset;
    if (placeStage) setToolOpen(placeStage.toolId);
  }, [placeStage]);
  const onPlaceRotate = useCallback((axis: 'x' | 'y' | 'z') => {
    engineRef.current?.clusterGhostRotate(axis);
  }, []);
  const onPlaceCancel = useCallback(() => {
    // Esc ALSO routes here (the viewport's ✕ twin) — while ↩ re-opened the
    // dialog, Esc belongs to the DIALOG, never kills the waiting ghost
    if (toolOpenRef.current) return;
    engineRef.current?.setClusterGhost(null);
    engineRef.current?.setGizmoEnabled(mode === 'edit' && gizmoOn);
    setPlaceStage(null);
  }, [mode, gizmoOn]);
  const onPlaceBuild = useCallback(() => {
    const st = engineRef.current?.clusterGhostState();
    const stage = placeStage, ctx = ctxRef.current;
    if (!st || !stage || !ctx) return;
    if (!st.valid) { setToolMsg('the placement collides with existing blocks — move it first'); return; }
    const tool = TOOLS.find(t => t.id === stage.toolId);
    if (!tool?.place) return;
    // the LIVE ghost data: ⟲ quarter-turns (and the drag) happened in the
    // engine — the commit must write what is GHOSTED, not a fresh un-rotated
    // plan (the paint still resolves at commit)
    const live = engineRef.current?.clusterGhostData();
    // v1.9: the lattice RIDES (the balloon's probe tetrahedron) come back
    // with the live data, so the tail batch turns + shifts with the skin.
    const msg = tool.place.commit(stage.form, {
      blocks: live?.blocks ?? stage.payload.blocks,
      triangles: live?.triangles ?? stage.payload.triangles,
      rides: live?.rides ?? stage.payload.rides,
      balloon: stage.payload.balloon,
    }, st.offset, ctx);
    engineRef.current?.setClusterGhost(null);
    engineRef.current?.setGizmoEnabled(mode === 'edit' && gizmoOn);
    setPlaceStage(null);
    sceneChanged();
    setToolMsg(msg);
  }, [placeStage, sceneChanged, mode, gizmoOn]);

  const onEngine = useCallback((e: Engine | null) => {
    engineRef.current = e;
    if (e) {
      // the VIEW MENU rows mirror the engine's persisted state (v1.9.2)
      setBackdrop(e.backdropState().current);
      setOrtho(e.projection() === 'orthographic');
      e.onSelection = s => setSel(s);
      // engine-side writes (sliders/gizmo/twins) mirror bp → doc + dirty
      e.onEdit = ci => {
        const ctx = ctxRef.current;
        const c = ctx?.bp.data.components[ci];
        if (!ctx || !c) return;
        setPos(ctx, ci, 'x', c.position.x); setPos(ctx, ci, 'y', c.position.y); setPos(ctx, ci, 'z', c.position.z);
        setOrientation(ctx, ci, c.orientation ?? { w: 1, x: 0, y: 0, z: 0 });
        markDirty(); bumpRev();
        pipesSoon();                                    // cables re-anchor to the moved sockets
      };
      e.onDataEdit = (ci, key) => {
        const ctx = ctxRef.current;
        const v = ctx?.bp.data.components[ci]?.data?.[key];
        if (!ctx || typeof v !== 'number') return;
        setDataField(ctx, ['data', 'components', ci], key, v);
        markDirty(); bumpRev();
      };
      // BLOCK gizmo commits (v1.5): the engine moved/turned the bp blocks —
      // mirror them into the raw doc AND rebuild the merged hull (v1.5.1 fix:
      // the old markDirty+bumpRev left the SOLID mesh at the old shape — the
      // rotation/move updated the data but never repainted; sceneChanged is
      // the same debounced path the BlockPanel rows use via onApplied).
      e.onBlockEdit = (bis) => {
        const ctx = ctxRef.current;
        if (!ctx) return;
        for (const bi of bis) writeBlockDoc(ctx, bi);
        sceneChanged();
      };
    }
    setEngine(e);
  }, [markDirty, bumpRev, sceneChanged, pipesSoon]);
  const [engine, setEngine] = useState<Engine | null>(null);

  // mode gating: gizmo in Edit AND Blocks (v1.4: clicking a component in
  // blocks mode selects it and must be movable/rotatable there too); Wire
  // forces cables visible; the wind tunnel runs ONLY in Wind mode (the solve
  // is bounded but never free). Leaving a mode also drops any stale PICK CHIP.
  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    setHit(null);
    e.setGizmoEnabled(mode === 'edit' && gizmoOn);
    if (mode === 'wire') e.setOption('pipes', true);
    if (mode !== 'edit') setBlockSel(-1);
    e.setWindTunnel(mode === 'aero');
  }, [mode, gizmoOn, engine]);

  // BLOCK widget (v1.5): a SELECTED block owns the gizmo in BLOCKS ▸ Edit —
  // cell-snapped arrows + 90°-snap rings; a selected COMPONENT takes it back.
  // v1.7.1: the block's SIMILAR TWIN always moves/turns in unison (mirrored);
  // mirrorPlace (⇄) only rides as the reported placement-twin state.
  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    const on = mode === 'edit' && tool === 'edit' && blockSel >= 0 &&
      sel.ci < 0 && sel.sub < 0 && gizmoOn;
    e.setBlockGizmo(on ? blockSel : -1, mirrorPlace);
  }, [mode, tool, blockSel, sel, mirrorPlace, gizmoOn, rev, engine]);

  /** Delete a selected component (v1.4): bp splice + doc mirror TOGETHER,
   *  the per-component orig/applied save-sync tables shift with it, the
   *  scene rebuilds on the debounce. v1.5.12 (the Jimmy incident): cables +
   *  subgrid joins reference FLATTENED component indices, so the splice MUST
   *  be preceded by pruneCompRefs — references to the deleted subtree are
   *  dropped (its cables go with it), later references renumber. Leaving
   *  them stale silently re-wires the craft on paper ("computer's power
   *  cable connected to an aileron"), and the game re-saves the mangled
   *  references instead of pruning them. v1.8.0 UNIFORM MIRROR RULE:
   *  whatever the selection does, its twin pair does — deleting a part
   *  deletes its twins too. */
  const deleteComp = useCallback((ctx: EditCtx, ci: number) => {
    const idx = new Set<number>([ci]);
    for (const { j } of engineRef.current?.twinPairsOf(ci) ?? []) idx.add(j);
    pruneCompRefs(ctx, idx);
    for (const k of [...idx].sort((a, b) => b - a)) {
      ctx.bp.data.components.splice(k, 1);
      docArrayRemoveAt(ctx.doc, ['data', 'components'], k);
      ctx.orig.splice(k, 1);
      ctx.applied.splice(k, 1);
    }
    engineRef.current?.select(-1);
    engineRef.current?.setCompGhost(null);
    sceneChanged();
  }, [sceneChanged]);

  /** 2026-10-20 DELETE key paths (the panel buttons and the keyboard share these).
   *  Block: the BlockPanel geometry — self + its SIMILAR TWIN, bp + doc
   *  together (the old "a bare key must never touch bp without the doc
   *  mirror" rule; the key now routes through here, so it is mirrored). */
  const deleteBlock = useCallback((ctx: EditCtx, bi: number) => {
    const tw = blockMirrorTwin(ctx.bp, bi, mirAx());
    for (const i of [bi, ...(tw >= 0 ? [tw] : [])].sort((a, b) => b - a)) {
      ctx.bp.data.blocks.splice(i, 1);
      docArrayRemoveAt(ctx.doc, ['data', 'blocks'], i);
    }
    engineRef.current?.setBlockGizmo(-1, false);
    setBlockSel(-1);
    sceneChanged();
  }, [sceneChanged]);
  const deleteTri = useCallback((ctx: EditCtx, ti: number) => {
    ctx.bp.data.triangles?.splice(ti, 1);
    docArrayRemoveAt(ctx.doc, ['data', 'triangles'], ti);
    setTriSel(-1);
    sceneChanged();
  }, [sceneChanged]);

  const edits: EditApi = useMemo(() => ({
    compField: (ctx, ci, key, v) => { setCompField(ctx, ci, key, v); markDirty(); bumpRev(); },
    compColor: (ctx, ci, which, field, v) => {
      // v1.8.0 UNIFORM MIRROR RULE: the twin pair takes the same appearance
      setCompColor(ctx, ci, which, field, v);
      for (const { j } of engineRef.current?.twinPairsOf(ci) ?? [])
        setCompColor(ctx, j, which, field, v);
      sceneChanged();                       // materials rebuild on the debounced reload
    },
    pos: (_ctx, ci, ax, v) => { engineRef.current?.setFilePosAxis(ci, ax, v); },
    beginRot: ci => engineRef.current?.beginRotEdit(ci),
    quatDelta: (ctx, ci, p, y, r) => {
      const q = engineRef.current?.setCompQuatDelta(ci, p, y, r);
      if (q) setOrientation(ctx, ci, q);
    },
    dataField: (ctx, path, k, v) => { setDataField(ctx, path, k, v); bumpRev(); },
    reset: (ctx, ci) => {
      resetComponent(ctx, ci);
      setInspKey(k => k + 1); bumpRev();
    },
    deleteComp,
  }), [bumpRev, markDirty, sceneChanged, deleteComp]);

  const save = useCallback((as?: string) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const text = serializeSave(ctx);
    // 2026-10-20: serializeSave also SYNCS the occupancy/type-255 mirrors (it
    // mutates bp + doc) — commit that as the open history group's text so
    // undo can never resurrect a pre-sync mirror state.
    flushSnapshot();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = as ?? 'blueprint.json'; a.click(); URL.revokeObjectURL(a.href);
    dirtyRef.current = false; setDirty(false);
  }, [flushSnapshot]);

  const openFile = useCallback(() => fileRef.current?.click(), []);
  const readFile = useCallback((f: File) => {
    f.text().then(openText).catch(console.error);
  }, [openText]);

  // keyboard: g/o/h toggles, Ctrl+S save, Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y
  // UNDO/REDO (2026-10-20 — the Edit ▾ menu items call the same pair), Delete /
  // Backspace deletes the selection in the EDIT mode (2026-10-20 user rule: "when
  // I have something selected in edit mode, [delete] key should delete" —
  // component ▸ block (+twin) ▸ triangle precedence; every path mutates bp
  // AND the doc together, the stale NOTE below was the old excuse), and Esc
  // drops the HELD part else deselects (KSP pickup rule). Undo/redo sit
  // BEHIND the input guards so a focused text field keeps native Ctrl+Z.
  const toggleOpt = useCallback((k: keyof ViewOptions, on: boolean) => {
    const e = engineRef.current;
    if (!e) return;
    e.setOption(k, on);
    setOpts(e.getOptions());
  }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); return; }
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault(); if (e.shiftKey) redo(); else undo(); return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault(); redo(); return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && mode === 'edit') {
        const ctx = ctxRef.current;
        if (!ctx || placing) return;
        if (sel.ci >= 0) { e.preventDefault(); deleteComp(ctx, sel.ci); return; }
        if (blockSub === 'tris' && triSel >= 0) { e.preventDefault(); deleteTri(ctx, triSel); return; }
        if (blockSel >= 0) { e.preventDefault(); deleteBlock(ctx, blockSel); return; }
      }
      const map: Record<string, keyof ViewOptions> = { g: 'grid', o: 'occ', h: 'hull' };
      if (map[e.key]) {
        const cur = engineRef.current?.getOptions();
        if (cur) toggleOpt(map[e.key]!, !cur[map[e.key]!]);
      }
      // v1.9.2: '5' flips the PROJECTION (Blender's numpad-5 habit — the
      // user's ortho mode lives in the View menu; the key is the fast path)
      if (e.key === '5' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const on = engineRef.current?.projection() !== 'orthographic';
        setOrtho(!!on);
        engineRef.current?.setProjection(!!on);
      }
      if (e.key === 'Escape') {
        setPaintOpen(false);                           // 🎨 palette window first
        engineRef.current?.placeDragEnd();             // smear-drag yields the orbit back
        if (placing) {                              // KSP: drop the HELD part first
          setPlacing(null);
          engineRef.current?.setCompGhost(null);
          return;
        }
        engineRef.current?.select(-1); setBlockSel(-1);
      }
    };
    addEventListener('keydown', h);
    return () => removeEventListener('keydown', h);
  }, [save, toggleOpt, placing, mode, sel, blockSel, blockSub, triSel,
    undo, redo, deleteComp, deleteBlock, deleteTri]);

  // blocks-mode canvas handling: place (brush/logical continuation) or
  // select, via engine.pickCell.
  /** the ghost preview under the cursor (BLOCKS-place): brush footprint at
   *  the pick cell, or the game's Shift rule — over an existing block the
   *  ghost becomes the block that LOGICALLY CONTINUES it (complementBlock);
   *  red ghost when the footprint collides (the click is then refused). */
  const ghostRef = useRef<{ x: number; y: number; shift: boolean } | null>(null);
  const computeGhost = useCallback((clientX: number, clientY: number, shift: boolean) => {
    ghostRef.current = { x: clientX, y: clientY, shift };
    const e = engineRef.current, ctx = ctxRef.current;
    if (!e || !ctx) return;
    if (placing && mode === 'edit') {           // HELD part: its ghost
      const p = e.pickPlacePoint(clientX, clientY);
      e.setCompGhost(p ? { type: placing, point: p } : null, mirrorPlace);
      return;
    }
    if (mode !== 'edit' || blockSub !== 'blocks' || tool !== 'place') { e.setPlaceGhost(null); return; }
    const r = e.pickCell(clientX, clientY);
    if (!r || r.kind === 'ground') { e.setPlaceGhost(null); return; }
    const info = shift && r.bi >= 0 ? blockInfo(ctx.bp, r.bi) : null;
    const spec = info
      ? complementBlock(info, [cellIndex(r.point[0]), cellIndex(r.point[1]), cellIndex(r.point[2])], r.nrm)
      : { cell: r.cell, ...brushSpec(brush) };
    e.setPlaceGhost({ ...spec, valid: !cellOverlap(ctx.bp, spec.cell, spec.size), complement: !!info });
  }, [mode, tool, placing, mirrorPlace, blockSub, brush]);

  // ghost lifecycle: re-aim when the brush changes (live preview of the
  // panel), drop it when the flavor/mode leaves block-placement
  useEffect(() => {
    const h = ghostRef.current;
    if (!h) return;
    if (mode === 'edit' && tool === 'place' && blockSub === 'blocks') computeGhost(h.x, h.y, h.shift);
    else { engineRef.current?.setPlaceGhost(null); ghostRef.current = null; }
  }, [mode, tool, blockSub, brush, computeGhost]);

  // BLOCKS selection highlight (v1.4 "blocks don't yet highlight"): the
  // picked block gets the golden overlay and its SIMILAR TWIN rides along
  // dimly (blockMirrorTwin — same plane as the component twins). v1.7.1: the
  // twin is IDENTIFIED on EVERY selection, ⇄ or not. v1.8.0 UNIFORM MIRROR
  // RULE: blockTwinIssues flags a mirror-conflicting FAUX-MIRROR (shape,
  // size, material or face-paint mismatch on the mirrored footprint) — the
  // twin overlay then rides RED and the Viewport shows the ⚠ popup.
  useEffect(() => {
    const e = engineRef.current, ctx = ctxRef.current;
    if (!e) return;
    if (mode === 'edit' && blockSel >= 0 && ctx) {
      const tw = blockTwinIssues(ctx.bp, blockSel, mirAx());
      e.setBlockHighlight(blockSel, tw?.twin ?? -1, tw?.issues ?? [], tw?.info ?? false);
    } else e.setBlockHighlight(-1);
  }, [mode, blockSel, rev, engine]);

  // 2026-10-20: a SELECTED TRIANGLE rides the gold prism highlight — selection used
  // to be invisible in the 3D view (only the panel changed), part of the
  // "triangles refuse to select properly" report. Left with the sub-tab.
  useEffect(() => {
    engineRef.current?.setTriHighlight(mode === 'edit' && blockSub === 'tris' ? triSel : -1);
  }, [mode, blockSub, triSel, rev, engine]);

  // the CATALOG ghost (v1.4): while a part is HELD, hovering the viewport
  // docks a translucent preview at the surface (⇄ adds the mirrored twin
  // box) — placement now works like the blocks ghost. v1.5: the PLACE flavor
  // holds parts in the Blocks workspace too (one panel, both dockers).
  // v1.5.6: the ghost is the REAL translucent model, and a press-DRAG on a
  // surface SMEARS the part along the hull aiming its back (Viewport drives
  // engine.placeDragStart/Move/End; the release lands it).
  useEffect(() => {
    if (!engine) return;
    if (!placing || mode !== 'edit') { engine.placeDragEnd(); engine.setCompGhost(null); }
  }, [placing, mode, engine]);

  const onBlockPick = useCallback((clientX: number, clientY: number, shift: boolean,
    openWidget: () => void) => {
    const e = engineRef.current, ctx = ctxRef.current;
    if (!e || !ctx) return;
    if (blockSub === 'tris') {
      const r = e.pickCell(clientX, clientY);
      if (!r) return;
      // 2026-10-20 (the "triangles refuse to select properly" fix): ONLY a hit on
      // a hull PRISM itself can select — the old code centroid-tested every
      // pick, so a block click near a triangle STOLE the click, while the
      // middle of a large prism (beyond the 0.45 m radius) never selected at
      // all and fell through to corner-drafting. triAt is now a geometric
      // click-owner test (plane + inside-with-margin; edge/corner clicks
      // still draft lattice corners).
      if (r.kind === 'tri' && triDraft.length === 0) {
        const t = triAt(ctx.bp, r.point);
        if (t >= 0) { setTriSel(t); setBlockSel(-1); return; }
      }
      const g = cornerOf(r.point);
      const next = [...triDraft, g];
      if (next.length < 3) { setTriDraft(next); return; }
      const tri = triangleFromCorners(next[0] as [number,number,number], next[1] as [number,number,number],
        next[2] as [number,number,number], triBrush);
      setTriDraft([]);
      if (!tri) return;
      // v1.6.1: the shared bp+doc append — on a craft whose file never
      // carried data.triangles the old bare docArrayInsert failed silently
      // (no array at the path), so a hand-drafted triangle vanished on save
      const at = ctx.bp.data.triangles?.length ?? 0;
      appendTrianglesDoc(ctx, [tri]);
      setTriSel(at);
      sceneChanged();
      return;
    }
    const r = e.pickCell(clientX, clientY);
    if (!r) {
      // v1.6: clicking EMPTY SPACE (sky — nothing picked) deselects in the
      // EDIT flavor: the golden block overlay used to sit on the deck with
      // nothing selected anymore ("don't return to previous state" report —
      // a stale selection the user believed they had cleared)
      if (tool === 'edit' && blockSel >= 0) { setBlockSel(-1); e.select(-1); }
      return;
    }
    // clicking an existing COMPONENT selects it in BOTH sub-tabs (user v1.4)
    // — the inspector (with Delete) takes over the context window.
    if (r.kind === 'comp' && r.ci >= 0) {
      setBlockSel(-1);
      e.select(r.ci);          // the gizmo rides it (merged editor)
      e.flyTo(r.ci);           // like the old Edit mode: click flies in
      openWidget();            // ⊘/✥/⟳/⇄ at the part: move/rotate switch here
      return;
    }
    if (tool === 'edit') {
      // EDIT flavor: a block click SELECTS the block — golden highlight +
      // the BLOCK widget (cell arrows / 90° rings, v1.5). The ⊘/✥/⟳ widget
      // pops too: it is how the block gizmo switches between move and turn.
      if (r.bi >= 0) e.select(-1);                     // a block took the pick
      setBlockSel(r.bi >= 0 ? r.bi : -1);
      if (r.bi >= 0) openWidget();
      return;
    }
    // PLACE — any surface DOCKS a block (the game: aim at a block or beam):
    // a block face, a hull-triangle prism, a component or subgrid content.
    // The green ground plane stays unfurnishable.
    if (r.kind === 'ground') { setBlockSel(-1); return; }
    const info = shift && r.bi >= 0 ? blockInfo(ctx.bp, r.bi) : null;
    const spec = info
      ? complementBlock(info, [cellIndex(r.point[0]), cellIndex(r.point[1]), cellIndex(r.point[2])], r.nrm)
      : { cell: r.cell, ...brushSpec(brush) };
    if (cellOverlap(ctx.bp, spec.cell, spec.size)) return;   // the red ghost refuses
    setBlockSel(placeBlock(ctx, spec, mirrorPlace, mirAx()));
    sceneChanged();
    // the game keeps the ghost under the cursor after a placement — re-aim
    // it over the fresh surface (it may now complement the block placed)
    computeGhost(clientX, clientY, shift);
  }, [tool, blockSub, brush, mirrorPlace, triDraft, triBrush, sceneChanged, computeGhost, blockSel]);

  /** CATALOG placement (KSP part pickup): land the HELD type at the picked
   *  surface — bp + doc together, then the debounced scene reload; the part
   *  auto-selects once the fresh roots exist (load() clears the selection,
   *  so the select rides just behind the 180 ms reload). Like KSP, one
   *  click places ONE part and the hand empties. v1.5.6: the click IS the
   *  release of the Viewport's smear-drag — yaw (radians about the world ŷ)
   *  is where the drag pointed the part's BACK (+z, the nose is −z); a plain
   *  click carries yaw 0 (the old identity pose). */
  const onPlacePoint = useCallback((clientX: number, clientY: number, yaw = 0) => {
    const e = engineRef.current, ctx = ctxRef.current;
    if (!e || !ctx || !placing) return;
    const p = e.pickPlacePoint(clientX, clientY);
    if (!p) return;
    setPlacing(null);
    const type = placing;
    const module = e.manifest?.[type]?.module ?? 'ARCHEAN_general';
    // view-space heading → the file quaternion of THIS file's generation
    const qView = qAxisAngle([0, 1, 0], yaw);
    const qFile = isLegacyFile(ctx.bp) ? qView : { w: qView.w, x: -qView.x, y: -qView.y, z: -qView.z };
    const comp = newComponent(type, module, p, qFile);
    ctx.bp.data.components.push(comp as never);
    const at = ctx.bp.data.components.length - 1;
    docArrayInsert(ctx.doc, ['data', 'components'], at, docFromValue(comp));
    if (mirrorPlace) {
      // ⇄ twin: mirrored POSITION, same orientation — exactly the geometry
      // sym.ts indexes (mask bit 1), so the pair co-selects and every later
      // edit propagates through the established twin path.
      const ma = mirAx();
      const tp = p.map((v, k) => (k === mirrorAxisIdx(ma) ? -v : v)) as [number, number, number];
      const twin = newComponent(type, module, tp, qFile);
      ctx.bp.data.components.push(twin as never);
      docArrayInsert(ctx.doc, ['data', 'components'], ctx.bp.data.components.length - 1, docFromValue(twin));
    }
    sceneChanged();
    setTimeout(() => engineRef.current?.select(at), 350);
  }, [placing, mirrorPlace, sceneChanged]);

  const setGizmo = useCallback((on: boolean) => {
    setGizmoOn(on);
    engineRef.current?.setGizmoEnabled(on && mode === 'edit');
  }, [mode]);
  const setHullOp = useCallback((v: number) => {
    setHullOpacityState(v);
    engineRef.current?.setHullOpacity(v);
  }, []);
  const onHiDef = useCallback((on: boolean) => {
    setHiDefState(on);
    engineRef.current?.setHiDef(on);
  }, []);

  // ------------------------------------------------------------- PAINT 🎨
  /** v1 (2024-25, palette-less) files: the picker shows the legacy-mapped
   *  family colours (palette.legacySlot) so a swatch = what renders. */
  const legacy = bp ? isLegacyFile(bp) : false;
  /** Paint the SELECTED block (faces = face slots, undefined = all 7).
   *  v1.7.1: the SIMILAR TWIN is ALWAYS painted through the mirrored face
   *  mapping (paintTwinPair/mirrorFaceOrder) — every block edit mirrors to
   *  the identified twin. bp + doc together. */
  const paintBlock = useCallback((slot: number, faces?: number[]) => {
    const ctx = ctxRef.current;
    if (!ctx || blockSel < 0) return;
    const twin = blockMirrorTwin(ctx.bp, blockSel, mirAx());
    if (!paintTwinPair(ctx.bp, blockSel, twin, slot, faces, mirAx()).length) return;
    writeBlockDoc(ctx, blockSel);
    if (twin >= 0) writeBlockDoc(ctx, twin);
    sceneChanged();
  }, [blockSel, sceneChanged]);
  /** v1.7 custom RGB: write the picked colour into the next free slot of
   *  THIS craft's palette (bp + doc, int-styled like the game writer) and
   *  return its index; null = the palette is full / the write refused. The
   *  picker then paints with the new slot through the dock's own path. */
  const addPaletteColor = useCallback((c: Rgb255): number | null => {
    const ctx = ctxRef.current;
    if (!ctx) return null;
    const slot = allocateSlot(ctx.bp.data.colors ?? null);
    if (slot == null) return null;
    if (!setPaletteSlot(ctx, slot, paletteSlotNode(c))) return null;
    sceneChanged();                       // swatches + badges see the new slot
    return slot;
  }, [sceneChanged]);

  /** Snap a palette slot's FULL shading spec onto a component's custom
   *  color1/color2 dict (r/g/b/opacity/roughness/metallic). v1.8.0 UNIFORM
   *  MIRROR RULE: the twin pair is painted the SAME appearance together
   *  (colour is identity, not geometry — no mirroring to apply). */
  const paintComp = useCallback((ci: number, which: 'color1' | 'color2', c: ResolvedColor) => {
    const ctx = ctxRef.current;
    if (!ctx || ci < 0) return;
    const targets = [ci, ...(engineRef.current?.twinPairsOf(ci) ?? []).map(({ j }) => j)];
    for (const k of targets)
      for (const [f, v] of [['r', c.r], ['g', c.g], ['b', c.b], ['opacity', c.opacity],
        ['roughness', c.roughness], ['metallic', c.metallic]] as const)
        setCompColor(ctx, k, which, f, v);
    sceneChanged();
  }, [sceneChanged]);

  /** WIRE workspace: a wide BOTTOM DOCK across the viewport (the user: wire
   *  editing needs a larger screen — the 300 px sidebar slot could never
   *  show census + manual pairing + warnings legibly). The left parts panel
   *  and the inspector stay live beside it. */
  const wirePanel = (
    <WirePanel engine={engine} ctx={ctxRef.current} bp={bp!} rev={rev}
      onApplied={sceneChanged}
      onSelectComp={ci => engineRef.current?.select(ci)}
      sel={sel.ci}
      onHoverComp={ci => engineRef.current?.previewHover(ci ?? -1)}
      onConnect={(aCi, aPort, bCi, bPort) => {
        const ctx = ctxRef.current;
        if (!ctx) return false;
        const pipe = makePipe(ctx.bp, engineRef.current?.manifest ?? null, aCi, aPort, bCi, bPort);
        if (!pipe) return false;
        ctx.bp.data.pipes = ctx.bp.data.pipes ?? [];
        docEnsureArray(ctx.doc, ['data', 'pipes']);   // v1.6.1: files that
        ctx.bp.data.pipes.push(pipe as never);        // never wired carry no
        docArrayInsert(ctx.doc, ['data', 'pipes'], ctx.bp.data.pipes.length - 1, docFromValue(pipe)); // pipes key at all
        sceneChanged();
        return true;
      }} />
  );

  const name = (bp?.data.alias?.trim()) || (craft ? craftName(craft) : 'Untitled craft');
  // Edit ▾ Undo/Redo enabled state (2026-10-20). histTick is the re-render trigger —
  // the stack itself lives in a ref (commits must never re-render mid-drag).
  void histTick;
  const canUndo = histRef.current.timer !== null || histRef.current.p > 0;
  const canRedo = histRef.current.p < histRef.current.states.length - 1;
  const triPanel = (
    <TriPanel bp={bp!} ctx={ctxRef.current} draft={triDraft} triSel={triSel}
      brush={triBrush} onSlot={(i, v) => setTriBrush(b => b.map((x, j) => j === i ? v : x))}
      onUndo={() => setTriDraft(d => d.slice(0, -1))}
      onDeleted={sceneChanged} onClearSel={() => setTriSel(-1)} />
  );
  // v2.0.0 MERGED EDITOR (user: "Merge the block and component edit things,
  // I no longer see a good reason to seperate them. The UI is quite good."):
  // the old BLOCKS workspace is the EDIT mode's panel bottom — brush +
  // Blocks/Triangles sub-tabs + ⇄ row + BlockPanel/TriPanel live beside the
  // parts list; the ✎ Edit | ✚ Place flavor drives select-vs-place for BOTH
  // species. The blocks workspace stays visible even with a component
  // selected — the Inspector stacks ABOVE it (Panel's selOverBottom).
  const modePanel = mode === 'edit' ? (
    (
      <div className="overflow-y-auto">
        <div className="flex gap-1 px-3 pt-2">
          {(['blocks', 'tris'] as const).map(t => (
            <button key={t} data-testid={`blocksub-${t}`} onClick={() => { setBlockSub(t); setTriDraft([]); }}
              className={`ksp-btn px-2 py-[3px] text-[11px] ${blockSub === t ? 'on' : ''}`}>
              {t === 'blocks' ? '▤ Blocks' : '▵ Triangles'}
            </button>
          ))}
        </div>
        {/* v1.5: the PLACE|EDIT flavor buttons moved UP into the panel's
            flavor switch (one switch for both workspaces); only the ⇄ twin
            row stays here (it belongs to the block surface itself) */}
        {blockSub === 'blocks' && (
          <div className="flex justify-end px-3 pt-1">
            <button data-testid="block-mirror" title="⇄ respect the mirror plane: place the x-mirrored twin AND propagate block edits to the similar twin"
              aria-pressed={mirrorPlace} onClick={() => setMirrorPlace(m => !m)}
              className={`ksp-btn px-2 py-[3px] text-[11px] ${mirrorPlace ? 'on' : ''}`}>
              ⇄ {mirrorPlace ? 'twin ON' : 'twin off'}
            </button>
          </div>
        )}
        {blockSub === 'tris' ? triPanel : (
          <BlockPanel engine={engine} ctx={ctxRef.current} bp={bp!} blockSel={blockSel}
            brush={brush} tab={tool} mirror={mirrorPlace} legacy={legacy} mirrorAxis={mirAxis}
            onBrush={setBrush} onSelectBlock={setBlockSel} onApplied={sceneChanged}
            onPaint={paintBlock}
            custom={{ addColor: addPaletteColor, onPickSlot: slot => setBrush(b => ({ ...b, slot })) }} />
        )}
      </div>
    )
  ) : mode === 'flight' ? (
    <FlightPanel engine={engine} rev={rev} />
  ) : mode === 'aero' ? (
    <div className="overflow-y-auto"><WindPanel engine={engine} rev={rev} /></div>
  ) : undefined;

  return (
    <div className="flex h-dvh w-full flex-col"
      onDragOver={e => e.preventDefault()}
      onDrop={e => {
        e.preventDefault();
        const f = e.dataTransfer.files?.[0];
        if (f) readFile(f);
      }}>
      <TopBar mode={mode} onMode={setMode} dirty={dirty} title={name} craftId={craft}
        canUndo={canUndo} canRedo={canRedo} onUndo={undo} onRedo={redo}
        onNew={() => {
          // v1.5.10 (user: "new craft should not be a button, but only under
          // file. too dangerous"): a NEW craft throws away the open doc AND
          // its whole undo stack — while anything is unsaved, ask first.
          if (dirtyRef.current &&
              !window.confirm('Start a NEW craft? Unsaved changes to this one are lost (download it first with Save).')) return;
          ctxRef.current = null; setBp(null); openText(emitNew());
        }}
        onOpen={openFile} onSave={save} onClose={onBack} onBack={onBack}
        onRefresh={craft ? () => { forceRef.current = true; setRetrySeq(s => s + 1); } : undefined}
        tools={TOOLS.map(t => ({ id: t.id, label: t.label, icon: t.icon }))}
        onTool={id => setToolOpen(id)}
        onHelp={() => setHelpOpen(true)}>
        <button data-testid="save-btn" onClick={() => save()}
          className={`ksp-btn shrink-0 px-2.5 py-1 text-[12px] ${dirty ? 'on font-semibold' : 'text-ink-dim'}`}>
          {dirty ? '● Save' : 'Save'}
        </button>
        <button data-testid="toggle-panels" title="toggle the parts panel" onClick={() => setPanelOpen(o => !o)}
          className="ksp-btn shrink-0 px-2.5 py-1 text-[12px] hover:text-accent">
          ▤
        </button>
        <button data-testid="toggle-options" title="View" aria-pressed={optsOpen}
          onClick={() => setOptsOpen(o => !o)}
          className={`ksp-btn shrink-0 px-2.5 py-1 text-[12px] hover:text-accent ${optsOpen ? 'on' : ''}`}>
          ⚙<span className="hidden sm:inline"> View</span>
        </button>
      </TopBar>
      <input ref={fileRef} type="file" accept=".json,application/json" className="hidden"
        data-testid="file-input"
        onChange={e => { const f = e.target.files?.[0]; if (f) readFile(f); e.target.value = ''; }} />
      <div className="relative flex min-h-0 flex-1">
        {/* KSP layout: the parts list lives on the LEFT (mobile: drawer —
            tap the dimmed viewport to dismiss, ✕ in the drawer header).
            Collapsible to a BOOKMARK TAB (user 2026-10-19: "make the tab
            collapsible instead, with a > and < icon … only the expander
            visible like a little bookmark tab on the side, so it's mostly
            unobscuring to the view"): open state carries a ‹ tab clipped to
            the panel's right edge, collapsed state leaves only a slim › tab
            at the viewport edge — one toggle (testid panel-tab) both ways,
            and the ▤ button / re-clicking the active View tile do the same. */}
        {panelOpen && (
          <>
            <div data-testid="panel-backdrop" onClick={() => setPanelOpen(false)}
              className="absolute inset-0 z-[5] bg-black/40 md:hidden" />
            <aside data-testid="panel-aside"
              className="absolute inset-y-0 left-0 z-10 flex w-[300px] max-w-[85vw] flex-col border-r border-white/10
                         shadow-2xl md:relative md:z-auto md:shadow-none">
              <button data-testid="panel-tab" title="collapse the parts panel"
                aria-label="collapse the parts panel" onClick={() => setPanelOpen(false)}
                className="absolute -right-5 top-1/2 z-20 flex h-16 w-5 -translate-y-1/2 items-center
                           justify-center rounded-r-md border border-l-0 border-white/15 bg-panel2
                           text-[12px] text-ink-dim shadow-lg hover:text-accent">
                &lt;
              </button>
              <div className="flex h-9 shrink-0 items-center justify-between border-b border-white/10 px-3
                              md:hidden">
                <button data-testid="panel-close" onClick={() => setPanelOpen(false)}
                  aria-label="close panel"
                  className="ksp-btn rounded px-2.5 py-1 text-[13px] text-ink hover:text-accent">
                  ✕
                </button>
                <span className="ksp-label text-[11px] text-ink-dim">Parts</span>
              </div>
              <div className="flex min-h-0 flex-1 flex-col">
                {bp && ctxRef.current && (
                  <Panel
                    engine={engine} ctx={ctxRef.current} bp={bp} sel={sel} rev={rev}
                    legacy={legacy}
                    opts={opts} hullOpacity={hullOpacity} onHullOpacity={setHullOp}
                    gizmoOn={gizmoOn && mode === 'edit'} onGizmo={setGizmo}
                    hiDef={hiDef} onHiDef={onHiDef}
                    staticInfo={staticInfo} onStaticInfo={setStaticInfo}
                    onOpt={toggleOpt}
                    onSelect={(ci, fly) => { engineRef.current?.select(ci); if (fly) engineRef.current?.flyTo(ci); }}
                    onSelectSub={bi => engineRef.current?.selectSub(bi)}
                    edits={edits} inspKey={inspKey} markDirty={markDirty}
                    readOnly={mode === 'view'}
                    bottom={modePanel}
                    selOverBottom={mode === 'edit'}
                    manifest={manifest}
                    placingType={placing}
                    onPlaceType={(t) => { setPlacing(t); if (t && mode === 'view') setMode('edit'); }}
                    tool={mode === 'edit' ? tool : undefined}
                    onTool={setTool}
                    mirrorPlace={mirrorPlace}
                    onMirrorPlace={setMirrorPlace}
                    statsOnly={mode === 'view'}
                  />
                )}
              </div>
            </aside>
          </>
        )}
        {!panelOpen && (
          <button data-testid="panel-tab" title="show the parts panel" aria-label="show the parts panel"
            onClick={() => setPanelOpen(true)}
            className="absolute left-0 top-1/2 z-20 flex h-16 w-5 -translate-y-1/2 items-center
                       justify-center rounded-r-md border border-l-0 border-white/15 bg-panel2
                       text-[12px] text-ink-dim shadow-lg hover:text-accent">
            &gt;
          </button>
        )}
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            <Viewport bp={bp} onPick={setHit} onEngine={onEngine}
              mode={mode} tool={tool} onBlockPick={onBlockPick} onBlockHover={computeGhost}
              placing={mode === 'edit' ? placing : null} onPlace={onPlacePoint}
              onPaintOpen={() => setPaintOpen(o => !o)}
              onPlaceCancel={onPlaceCancel} onPlaceBuild={onPlaceBuild}
              onPlaceRotate={onPlaceRotate} onPlaceBack={onPlaceBack}
              keepView={bpKeepView}
              onManifest={setManifest} />
            {/* 🎨 PALETTE window (v1.6): the paint alternative to the gizmo
                modes, opened from the mode widget — targets the CURRENT
                selection: the selected BLOCK (per-face, ⇄ twin), a COMPONENT
                (color1/color2 snap), or the block BRUSH in the Place flavor */}
            {paintOpen && bp && ctxRef.current && (
              <div data-testid="palette-win"
                className="ksp-win absolute right-2 top-12 z-30 max-h-[calc(100%-4rem)] w-[320px]
                           overflow-y-auto rounded-lg px-3 py-2">
                <div className="ksp-label mb-1 flex items-center justify-between gap-2 border-b
                               border-white/10 pb-1 text-[10px] text-ink-dim">
                  Paint —{' '}
                  {mode === 'edit' && blockSel >= 0 ? `Block[${blockSel}]${bp.data.blocks[blockSel] && blockMirrorTwin(bp, blockSel, mirAxis) >= 0 ? ' + twin' : ''}`
                    : sel.ci >= 0 ? `${bp.data.components[sel.ci]?.type ?? 'part'}[${sel.ci}]`
                      : 'brush'}
                  <button data-testid="palette-close" onClick={() => setPaintOpen(false)}
                    className="ksp-btn rounded px-1.5 text-[11px] text-ink-dim hover:text-accent">✕</button>
                </div>
                {mode === 'edit' && blockSel >= 0 ? (
                  <BlockPaint bp={bp} legacy={legacy} bi={blockSel} onPaint={paintBlock}
                    custom={{ addColor: addPaletteColor, onPickSlot: slot => paintBlock(slot) }} />
                ) : sel.ci >= 0 && bp.data.components[sel.ci] ? (
                  <CompPaint bp={bp} legacy={legacy} comp={bp.data.components[sel.ci]!}
                    onApply={(which, c) => paintComp(sel.ci, which, c)}
                    custom={{ addColor: addPaletteColor, onPickSlot: () => undefined }} />
                ) : (
                  <SwatchGrid bp={bp} legacy={legacy} current={brush.slot}
                    onPick={slot => setBrush(b => ({ ...b, slot }))}
                    custom={{ addColor: addPaletteColor, onPickSlot: slot => setBrush(b2 => ({ ...b2, slot })) }} />
                )}
              </div>
            )}
            {placing && mode === 'edit' && (
              <div data-testid="place-hint"
                className="ksp-win ksp-label pointer-events-none absolute left-1/2 top-2 z-20 -translate-x-1/2
                           rounded px-3 py-1 text-[11px] text-accent">
                holding <b>{placing}</b> — press-drag on a surface to smear it
                (the drag points its BACK) · release lands it · Esc drops it
              </div>
            )}
            {bp && hit && hit.kind !== 'none' && mode !== 'view' && (
              <PickChip hit={hit} bp={bp} />
            )}
            {/* the ⚙ view-options popover — its own window, not the parts
                panel (moved out of the left sidebar by user request) */}
            {optsOpen && (
              <div data-testid="options-win"
                className="ksp-win absolute right-2 top-2 z-30 max-h-[calc(100%-1rem)] w-[290px]
                           overflow-y-auto rounded-lg">
                <ViewOpts opts={opts} onOpt={toggleOpt} hullOpacity={hullOpacity} onHullOpacity={setHullOp}
                                    gizmoOn={gizmoOn} onGizmo={setGizmo} hiDef={hiDef} onHiDef={onHiDef}
                                    staticInfo={staticInfo} onStaticInfo={setStaticInfo}
                                    mirrorAxis={mirAxis} onMirrorAxis={onMirrorAxis}
                                    backdrop={backdrop} onBackdrop={onBackdrop}
                                    ortho={ortho} onOrtho={onOrtho} />
              </div>
            )}
            {/* TOOLS ▸ the definition-driven modal dialog (v1.7): opens over
                the viewport, OK-and-run or Cancel. */}
            {toolOpen && bp && ctxRef.current && (
              <ToolDialog key={toolOpen}
                tool={TOOLS.find(t => t.id === toolOpen)!} bp={bp} ctx={ctxRef.current}
                initialForm={placeStage?.toolId === toolOpen ? placeStage.form : undefined}
                onClose={() => setToolOpen(null)}
                onPlaced={(t, f, p) => onPlaced(t, f, p)}
                onApplied={msg => { sceneChanged(); setToolMsg(msg); }} />
            )}
            {toolMsg && (
              <div data-testid="tool-toast"
                className="ksp-win ksp-label pointer-events-none absolute left-1/2 top-2 z-20 -translate-x-1/2
                           rounded px-3 py-1 text-[11px] text-gold">
                {toolMsg}
              </div>
            )}
            {/* HELP ▸ the built-in manual (v1.5.20): markdown topics with a
                word search; works with no craft open too */}
            {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}
            {/* KSP bottom-left: the STATIC INFO black box (mass & CoM) */}
            {bp && staticInfo && (
              <div className="absolute bottom-2 left-3 z-[5]">
                <StaticInfo engine={engine} rev={rev} onClose={() => setStaticInfo(false)} />
              </div>
            )}
            {/* KSP bottom-right: the camera cluster over the viewport */}
            <CameraCluster engine={engine} />
          </div>
          {mode === 'wire' && bp && (
            <div data-testid="wire-dock"
              className="h-[38%] max-h-[46%] min-h-[200px] shrink-0 overflow-y-auto border-t
                         border-[rgba(217,212,189,.22)] bg-panel">
              {wirePanel}
            </div>
          )}
        </main>
        {(dl || dlErr) && (
          <DownloadOverlay name={name} dl={dl} err={dlErr}
            onRetry={() => { forceRef.current = true; setRetrySeq(s => s + 1); }}
            onBack={onBack} />
        )}
      </div>
    </div>
  );
}

/** KSP-style "receiving blueprint" download overlay: shown ONLY while an
 *  actual download runs (cached crafts open instantly, no overlay, no
 *  network) — bevelled window, progress bar, percent + KiB; error state
 *  offers Retry / Gallery. */
function DownloadOverlay(p: { name: string; dl: { frac: number | null; bytes: number } | null;
  err: boolean; onRetry: () => void; onBack: () => void }) {
  const pct = p.dl?.frac != null ? Math.round(p.dl.frac * 100) : null;
  return (
    <div data-testid="load-overlay" className="absolute inset-0 z-40 grid place-items-center bg-black/50">
      <div className="ksp-win w-[340px] max-w-[85vw] rounded-lg px-4 py-4 text-center">
        <div className="ksp-label mb-1 text-[12px] text-accent">
          {p.err ? 'Blueprint download failed' : 'Receiving blueprint'}</div>
        <div className="truncate text-[13px] font-semibold text-ink">{p.name}</div>
        {p.err ? (
          <>
            <div className="mt-2 text-[11px] leading-snug text-ink-dim">
              This craft is not in the local cache and could not be downloaded.</div>
            <div className="mt-3 flex justify-center gap-2">
              <button data-testid="load-retry" className="ksp-btn on px-3 py-1 text-[12px]" onClick={p.onRetry}>Retry</button>
              <button data-testid="load-back" className="ksp-btn px-3 py-1 text-[12px]" onClick={p.onBack}>Gallery</button>
            </div>
          </>
        ) : (
          <>
            <div className="mt-3 h-3 overflow-hidden rounded border border-white/20 bg-black/50">
              <div data-testid="load-bar"
                className={`h-full bg-accent/80 ${p.dl && pct === null ? 'w-1/3 animate-pulse' : 'transition-[width] duration-150'}`}
                style={p.dl && pct !== null ? { width: `${pct}%` } : undefined} />
            </div>
            <div data-testid="load-pct" className="mt-1.5 text-[11px] tabular-nums text-ink-dim">
              {!p.dl ? 'checking cache…'
                : p.dl.bytes === 0 ? 'receiving…'
                : pct !== null ? `${pct}% · ${(p.dl.bytes / 1024).toFixed(0)} KiB`
                : `${(p.dl.bytes / 1024).toFixed(0)} KiB \u2026`}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** KSP-style camera presets (the square-button cluster bottom-right) */
const CAMS: ['fit' | 'top' | 'front' | 'side', string, string][] = [
  ['fit', '⌂', 'frame craft'], ['top', '⊞', 'top view'],
  ['front', '⊏', 'front (nose) view'], ['side', '⊐', 'side view'],
];
function CameraCluster({ engine }: { engine: Engine | null }) {
  return (
    <div data-testid="cam-cluster"
      className="absolute bottom-2 right-2 z-[5] flex flex-col gap-1">
      {CAMS.map(([k, ic, t]) => (
        <button key={k} data-testid={`cam-${k}`} title={t}
          className="ksp-btn grid h-8 w-9 place-items-center text-[14px] leading-none"
          onClick={() => engine?.viewPreset(k)}>
          {ic}
        </button>
      ))}
    </div>
  );
}

/** picked-part chip: bottom sheet on phones (above the static-info box),
 *  KSP part-tooltip card on desktop */
function PickChip({ hit, bp }: { hit: PickHit; bp: Blueprint }) {
  const comp = hit.kind === 'comp' && hit.ci != null ? bp.data.components[hit.ci] : null;
  return (
    <div data-testid="pick-info"
      className="ksp-win pointer-events-none absolute inset-x-2 bottom-[132px] rounded px-3 py-2 text-[12px]
                 text-ink md:inset-x-auto md:bottom-auto md:right-3 md:top-3 md:max-w-[320px]">
      <span className="ksp-label text-[10px] text-ink-dim">picked</span>{' '}
      <span className="text-gold">{hit.kind}</span>
      {comp && <> · <span className="ksp-label font-semibold text-accent">{comp.type}</span>
        {typeof comp.name === 'string' && comp.name ? <span className="text-ink-dim"> "{comp.name}"</span> : null}</>}
      {hit.point && <div className="tabular-nums text-[10px] text-ink-dim">@ {hit.point.map(n => n.toFixed(2)).join(', ')}</div>}
    </div>
  );
}
