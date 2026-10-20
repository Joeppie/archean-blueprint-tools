// Editor.tsx — the full-screen KSP-VAB editing workspace (lazy chunk: the
// gallery never loads three.js/the engine). Viewport fills the window, the
// parts panel docks LEFT (mobile: a drawer behind ⚙), STATIC INFO (mass &
// CoM) floats bottom-left, the camera-preset cluster bottom-right. Blueprints
// stream through crafts.ts (IndexedDB cache: a cached craft opens with zero
// network; the KSP "receiving blueprint" overlay shows only on a real
// download). Holds the raw-literal DOC + live bp; see App.tsx for the shell.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { craftName } from './gallery-catalog';
import { DEFAULT_OPTS, type Engine, type PickHit, type ViewOptions } from './engine/scene';
import Viewport from './components/Viewport';
import Panel, { StaticInfo, ViewOpts, type EditApi } from './components/Panel';
import TopBar, { type Mode } from './components/TopBar';
import { BlockPanel, FlightPanel, TriPanel, WirePanel, WindPanel, brushSpec, placeBlock, type Brush } from './components/ModePanels';
import { BlockPaint, CompPaint, SwatchGrid } from './components/ColorPanel';
import { TOOLS, ToolDialog } from './components/ToolsDialog';
import { blockInfo, blockMirrorTwin, cellIndex, cellOverlap, complementBlock, paintTwinPair } from './engine/blocks';
import { cornerOf, triAt, triangleFromCorners } from './engine/tris';
import type { Blueprint } from './engine/format';
import { isLegacyFile } from './engine/format';
import type { ResolvedColor } from './engine/palette';
import { docArrayInsert, docArrayRemoveAt, docFromValue, docValue, parseDoc } from './engine/doc';
import { allocateSlot, paletteSlotNode, type Rgb255 } from './engine/tools';
import { setPaletteSlot } from './engine/edit';
import { makeCtx, resetComponent, setDataField, setOrientation, setPos, setCompField,
  setCompColor, serializeSave, writeBlockDoc, type EditCtx } from './engine/edit';
import { makePipe } from './engine/wireops';
import { normalizeDoc } from './engine/normalize';
import { newCraftDoc, newComponent } from './engine/newcraft';
import { loadCraft } from './crafts';

export default function Editor({ craft, onBack }: { craft: string | null; onBack: () => void }) {
  const [bp, setBp] = useState<Blueprint | null>(null);
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
  // x-flipped cell/position about file x = 0 — the game editor's mirror tool
  const [mirrorPlace, setMirrorPlace] = useState(() => localStorage.getItem('archean-app-plsym') === '1');
  useEffect(() => { localStorage.setItem('archean-app-plsym', mirrorPlace ? '1' : '0'); }, [mirrorPlace]);
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
  const engineRef = useRef<Engine | null>(null);
  const ctxRef = useRef<EditCtx | null>(null);
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

  /** parse → v1→v2 NORMALIZE → doc+ctx → live bp. One funnel for download,
   *  file-open, drag-drop and New craft. */
  const openText = useCallback((text: string) => {
    const d = parseDoc(text);
    normalizeDoc(d);                              // convert-on-open migration
    ctxRef.current = makeCtx(d, docValue(d) as Blueprint);
    dirtyRef.current = false;
    setDirty(false); setSel({ ci: -1, sub: -1 }); setBlockSel(-1); setPlacing(null);
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
  }, []);
  const bumpRev = useCallback(() => setRev(r => r + 1), []);

  /** block/wire mutations rebuild the merged scene — debounced so slider
   *  drags do not rebuild on every tick */
  const sceneChanged = useCallback(() => {
    markDirty(); bumpRev();
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => engineRef.current?.reload(), 180);
  }, [markDirty, bumpRev]);

  const onEngine = useCallback((e: Engine | null) => {
    engineRef.current = e;
    if (e) {
      e.onSelection = s => setSel(s);
      // engine-side writes (sliders/gizmo/twins) mirror bp → doc + dirty
      e.onEdit = ci => {
        const ctx = ctxRef.current;
        const c = ctx?.bp.data.components[ci];
        if (!ctx || !c) return;
        setPos(ctx, ci, 'x', c.position.x); setPos(ctx, ci, 'y', c.position.y); setPos(ctx, ci, 'z', c.position.z);
        setOrientation(ctx, ci, c.orientation ?? { w: 1, x: 0, y: 0, z: 0 });
        markDirty(); bumpRev();
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
  }, [markDirty, bumpRev, sceneChanged]);
  const [engine, setEngine] = useState<Engine | null>(null);

  // mode gating: gizmo in Edit AND Blocks (v1.4: clicking a component in
  // blocks mode selects it and must be movable/rotatable there too); Wire
  // forces cables visible; the wind tunnel runs ONLY in Wind mode (the solve
  // is bounded but never free). Leaving a mode also drops any stale PICK CHIP.
  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    setHit(null);
    e.setGizmoEnabled((mode === 'edit' || mode === 'blocks') && gizmoOn);
    if (mode === 'wire') e.setOption('pipes', true);
    if (mode !== 'blocks') setBlockSel(-1);
    e.setWindTunnel(mode === 'aero');
  }, [mode, gizmoOn, engine]);

  // BLOCK widget (v1.5): a SELECTED block owns the gizmo in BLOCKS ▸ Edit —
  // cell-snapped arrows + 90°-snap rings; a selected COMPONENT takes it back.
  // ⇄ on ⇒ the block's SIMILAR TWIN moves/turns in unison (blockMirrorTwin).
  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    const on = mode === 'blocks' && tool === 'edit' && blockSel >= 0 &&
      sel.ci < 0 && sel.sub < 0 && gizmoOn;
    e.setBlockGizmo(on ? blockSel : -1, mirrorPlace);
  }, [mode, tool, blockSel, sel, mirrorPlace, gizmoOn, rev, engine]);

  /** Delete a selected component (v1.4): bp splice + doc mirror TOGETHER,
   *  the per-component orig/applied save-sync tables shift with it, the
   *  scene rebuilds on the debounce. CABLES referencing shifted indices are
   *  left alone (the game editor prunes them on load; a stale pipe index is
   *  data, not a crash). */
  const deleteComp = useCallback((ctx: EditCtx, ci: number) => {
    ctx.bp.data.components.splice(ci, 1);
    docArrayRemoveAt(ctx.doc, ['data', 'components'], ci);
    ctx.orig.splice(ci, 1);
    ctx.applied.splice(ci, 1);
    engineRef.current?.select(-1);
    engineRef.current?.setCompGhost(null);
    sceneChanged();
  }, [sceneChanged]);

  const edits: EditApi = useMemo(() => ({
    compField: (ctx, ci, key, v) => { setCompField(ctx, ci, key, v); markDirty(); bumpRev(); },
    compColor: (ctx, ci, which, field, v) => {
      setCompColor(ctx, ci, which, field, v);
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
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = as ?? 'blueprint.json'; a.click(); URL.revokeObjectURL(a.href);
    dirtyRef.current = false; setDirty(false);
  }, []);

  const openFile = useCallback(() => fileRef.current?.click(), []);
  const readFile = useCallback((f: File) => {
    f.text().then(openText).catch(console.error);
  }, [openText]);

  // keyboard: g/o/h toggles, Ctrl+S save, Esc drops the HELD part else
  // deselects (KSP pickup rule)
  const toggleOpt = useCallback((k: keyof ViewOptions, on: boolean) => {
    const e = engineRef.current;
    if (!e) return;
    e.setOption(k, on);
    setOpts(e.getOptions());
  }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); return; }
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const map: Record<string, keyof ViewOptions> = { g: 'grid', o: 'occ', h: 'hull' };
      if (map[e.key]) {
        const cur = engineRef.current?.getOptions();
        if (cur) toggleOpt(map[e.key]!, !cur[map[e.key]!]);
      }
      if (e.key === 'Escape') {
        setPaintOpen(false);                           // 🎨 palette window first
        if (placing) {                              // KSP: drop the HELD part first
          setPlacing(null);
          engineRef.current?.setCompGhost(null);
          return;
        }
        engineRef.current?.select(-1); setBlockSel(-1);
      }
      // NOTE: deleting a block goes through the BlockPanel button ONLY —
      // it mutates bp AND the doc together; a bare key must never touch bp
      // without the doc mirror.
    };
    addEventListener('keydown', h);
    return () => removeEventListener('keydown', h);
  }, [save, toggleOpt, placing]);

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
    if (placing && (mode === 'edit' || mode === 'blocks')) {  // HELD part: its ghost
      const p = e.pickPlacePoint(clientX, clientY);
      e.setCompGhost(p ? { type: placing, point: p } : null, mirrorPlace);
      return;
    }
    if (mode !== 'blocks' || blockSub !== 'blocks' || tool !== 'place') { e.setPlaceGhost(null); return; }
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
    if (mode === 'blocks' && tool === 'place' && blockSub === 'blocks') computeGhost(h.x, h.y, h.shift);
    else { engineRef.current?.setPlaceGhost(null); ghostRef.current = null; }
  }, [mode, tool, blockSub, brush, computeGhost]);

  // BLOCKS selection highlight (v1.4 "blocks don't yet highlight"): the
  // picked block gets the golden overlay and its SIMILAR TWIN rides along
  // dimly (blockMirrorTwin — same plane as the component twins). v1.7.1: the
  // twin is IDENTIFIED on EVERY selection, ⇄ or not (user: "Selecting blocks
  // does NOT SELECT MIRROR SYMMETRY" — ⇄ defaults OFF, so the pair read as
  // un-symmetrised). The ⇄ toggle gates only whether EDITS propagate to the
  // twin (paint/gizmo/panel rows), never whether it is shown co-selected —
  // exactly how the BlockPanel's twin row already behaves.
  useEffect(() => {
    const e = engineRef.current, ctx = ctxRef.current;
    if (!e) return;
    if (mode === 'blocks' && blockSel >= 0 && ctx)
      e.setBlockHighlight(blockSel, blockMirrorTwin(ctx.bp, blockSel));
    else e.setBlockHighlight(-1);
  }, [mode, blockSel, rev, engine]);

  // the CATALOG ghost (v1.4): while a part is HELD, hovering the viewport
  // docks a translucent preview at the surface (⇄ adds the mirrored twin
  // box) — placement now works like the blocks ghost. v1.5: the PLACE flavor
  // holds parts in the Blocks workspace too (one panel, both dockers).
  useEffect(() => {
    if (!engine) return;
    if (!placing || (mode !== 'edit' && mode !== 'blocks')) engine.setCompGhost(null);
  }, [placing, mode, engine]);

  const onBlockPick = useCallback((clientX: number, clientY: number, shift: boolean,
    openWidget: () => void) => {
    const e = engineRef.current, ctx = ctxRef.current;
    if (!e || !ctx) return;
    if (blockSub === 'tris') {
      const r = e.pickCell(clientX, clientY);
      if (!r) return;
      const t = triAt(ctx.bp, r.point);
      if (t >= 0 && triDraft.length === 0) { setTriSel(t); return; }   // select existing
      const g = cornerOf(r.point);
      const next = [...triDraft, g];
      if (next.length < 3) { setTriDraft(next); return; }
      const tri = triangleFromCorners(next[0] as [number,number,number], next[1] as [number,number,number],
        next[2] as [number,number,number], triBrush);
      setTriDraft([]);
      if (!tri) return;
      ctx.bp.data.triangles = ctx.bp.data.triangles ?? [];
      ctx.bp.data.triangles.push(tri);
      const at = ctx.bp.data.triangles.length - 1;
      docArrayInsert(ctx.doc, ['data', 'triangles'], at, docFromValue(tri));
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
      e.select(r.ci);          // the gizmo rides it (enabled in blocks too)
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
    setBlockSel(placeBlock(ctx, spec, mirrorPlace));
    sceneChanged();
    // the game keeps the ghost under the cursor after a placement — re-aim
    // it over the fresh surface (it may now complement the block placed)
    computeGhost(clientX, clientY, shift);
  }, [tool, blockSub, brush, mirrorPlace, triDraft, triBrush, sceneChanged, computeGhost, blockSel]);

  /** CATALOG placement (KSP part pickup): land the HELD type at the picked
   *  surface — bp + doc together, then the debounced scene reload; the part
   *  auto-selects once the fresh roots exist (load() clears the selection,
   *  so the select rides just behind the 180 ms reload). Like KSP, one
   *  click places ONE part and the hand empties. */
  const onPlacePoint = useCallback((clientX: number, clientY: number) => {
    const e = engineRef.current, ctx = ctxRef.current;
    if (!e || !ctx || !placing) return;
    const p = e.pickPlacePoint(clientX, clientY);
    if (!p) return;
    setPlacing(null);
    const type = placing;
    const module = e.manifest?.[type]?.module ?? 'ARCHEAN_general';
    const comp = newComponent(type, module, p);
    ctx.bp.data.components.push(comp as never);
    const at = ctx.bp.data.components.length - 1;
    docArrayInsert(ctx.doc, ['data', 'components'], at, docFromValue(comp));
    if (mirrorPlace) {
      // ⇄ twin: mirrored POSITION, same orientation — exactly the geometry
      // sym.ts indexes (mask bit 1), so the pair co-selects and every later
      // edit propagates through the established twin path.
      const twin = newComponent(type, module, [-p[0], p[1], p[2]]);
      ctx.bp.data.components.push(twin as never);
      docArrayInsert(ctx.doc, ['data', 'components'], ctx.bp.data.components.length - 1, docFromValue(twin));
    }
    sceneChanged();
    setTimeout(() => engineRef.current?.select(at), 350);
  }, [placing, mirrorPlace, sceneChanged]);

  const setGizmo = useCallback((on: boolean) => {
    setGizmoOn(on);
    engineRef.current?.setGizmoEnabled(on && (mode === 'edit' || mode === 'blocks'));
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
   *  ⇄ on ⇒ the SIMILAR TWIN is painted through the mirrored face mapping
   *  (paintTwinPair/mirrorFaceOrder) — mirroring is respected for PAINT
   *  exactly like the gizmo respects it for GEOMETRY. bp + doc together. */
  const paintBlock = useCallback((slot: number, faces?: number[]) => {
    const ctx = ctxRef.current;
    if (!ctx || blockSel < 0) return;
    const twin = mirrorPlace ? blockMirrorTwin(ctx.bp, blockSel) : -1;
    if (!paintTwinPair(ctx.bp, blockSel, twin, slot, faces).length) return;
    writeBlockDoc(ctx, blockSel);
    if (twin >= 0) writeBlockDoc(ctx, twin);
    sceneChanged();
  }, [blockSel, mirrorPlace, sceneChanged]);
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
   *  color1/color2 dict (r/g/b/opacity/roughness/metallic). */
  const paintComp = useCallback((ci: number, which: 'color1' | 'color2', c: ResolvedColor) => {
    const ctx = ctxRef.current;
    if (!ctx || ci < 0) return;
    for (const [f, v] of [['r', c.r], ['g', c.g], ['b', c.b], ['opacity', c.opacity],
      ['roughness', c.roughness], ['metallic', c.metallic]] as const)
      setCompColor(ctx, ci, which, f, v);
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
        ctx.bp.data.pipes.push(pipe as never);
        docArrayInsert(ctx.doc, ['data', 'pipes'], ctx.bp.data.pipes.length - 1, docFromValue(pipe));
        sceneChanged();
        return true;
      }} />
  );

  const name = (bp?.data.alias?.trim()) || (craft ? craftName(craft) : 'Untitled craft');
  const triPanel = (
    <TriPanel bp={bp!} ctx={ctxRef.current} draft={triDraft} triSel={triSel}
      brush={triBrush} onSlot={(i, v) => setTriBrush(b => b.map((x, j) => j === i ? v : x))}
      onUndo={() => setTriDraft(d => d.slice(0, -1))}
      onDeleted={sceneChanged} onClearSel={() => setTriSel(-1)} />
  );
  const modePanel = mode === 'blocks' ? (
    // v1.4 fix: the blocks workspace stays visible even with a component
    // selected — the Inspector stacks ABOVE it (Panel's selOverBottom), so
    // entering BLOCKS with a part selected never ate the brush/editor.
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
            brush={brush} tab={tool} mirror={mirrorPlace} legacy={legacy}
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
        onNew={() => { ctxRef.current = null; setBp(null); openText(emitNew()); }}
        onOpen={openFile} onSave={save} onClose={onBack} onBack={onBack}
        onRefresh={craft ? () => { forceRef.current = true; setRetrySeq(s => s + 1); } : undefined}
        tools={TOOLS.map(t => ({ id: t.id, label: t.label, icon: t.icon }))}
        onTool={id => setToolOpen(id)}>
        <button data-testid="save-btn" onClick={() => save()}
          className={`ksp-btn shrink-0 px-2.5 py-1 text-[12px] ${dirty ? 'on font-semibold' : 'text-ink-dim'}`}>
          {dirty ? '● Save' : 'Save'}
        </button>
        <button data-testid="toggle-panels" title="toggle the parts panel" onClick={() => setPanelOpen(o => !o)}
          className="ksp-btn shrink-0 px-2.5 py-1 text-[12px] hover:text-accent">
          ▤
        </button>
        <button data-testid="toggle-options" title="view options" aria-pressed={optsOpen}
          onClick={() => setOptsOpen(o => !o)}
          className={`ksp-btn shrink-0 px-2.5 py-1 text-[12px] hover:text-accent ${optsOpen ? 'on' : ''}`}>
          ⚙
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
                    gizmoOn={gizmoOn && (mode === 'edit' || mode === 'blocks')} onGizmo={setGizmo}
                    hiDef={hiDef} onHiDef={onHiDef}
                    staticInfo={staticInfo} onStaticInfo={setStaticInfo}
                    onOpt={toggleOpt}
                    onSelect={(ci, fly) => { engineRef.current?.select(ci); if (fly) engineRef.current?.flyTo(ci); }}
                    onSelectSub={bi => engineRef.current?.selectSub(bi)}
                    edits={edits} inspKey={inspKey} markDirty={markDirty}
                    readOnly={mode === 'view'}
                    bottom={modePanel}
                    selOverBottom={mode === 'blocks'}
                    manifest={manifest}
                    placingType={placing}
                    onPlaceType={(t) => { setPlacing(t); if (t && mode === 'view') setMode('edit'); }}
                    tool={mode === 'edit' || mode === 'blocks' ? tool : undefined}
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
              placing={mode === 'edit' || mode === 'blocks' ? placing : null} onPlace={onPlacePoint}
              onPaintOpen={() => setPaintOpen(o => !o)}
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
                  {mode === 'blocks' && blockSel >= 0 ? `Block[${blockSel}]${mirrorPlace ? ' + ⇄ twin' : ''}`
                    : sel.ci >= 0 ? `${bp.data.components[sel.ci]?.type ?? 'part'}[${sel.ci}]`
                      : 'brush'}
                  <button data-testid="palette-close" onClick={() => setPaintOpen(false)}
                    className="ksp-btn rounded px-1.5 text-[11px] text-ink-dim hover:text-accent">✕</button>
                </div>
                {mode === 'blocks' && blockSel >= 0 ? (
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
            {placing && (mode === 'edit' || mode === 'blocks') && (
              <div data-testid="place-hint"
                className="ksp-win ksp-label pointer-events-none absolute left-1/2 top-2 z-20 -translate-x-1/2
                           rounded px-3 py-1 text-[11px] text-accent">
                holding <b>{placing}</b> — click a surface · Esc drops it
              </div>
            )}
            {bp && hit && hit.kind !== 'none' && mode !== 'blocks' && (
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
                                    staticInfo={staticInfo} onStaticInfo={setStaticInfo} />
              </div>
            )}
            {/* TOOLS ▸ the definition-driven modal dialog (v1.7): opens over
                the viewport, OK-and-run or Cancel. */}
            {toolOpen && bp && ctxRef.current && (
              <ToolDialog key={toolOpen}
                tool={TOOLS.find(t => t.id === toolOpen)!} bp={bp} ctx={ctxRef.current}
                onClose={() => setToolOpen(null)}
                onApplied={msg => { sceneChanged(); setToolMsg(msg); }} />
            )}
            {toolMsg && (
              <div data-testid="tool-toast"
                className="ksp-win ksp-label pointer-events-none absolute left-1/2 top-2 z-20 -translate-x-1/2
                           rounded px-3 py-1 text-[11px] text-gold">
                {toolMsg}
              </div>
            )}
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
