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
import { BlockPanel, FlightPanel, TriPanel, WirePanel, WindPanel, placeBlock, type Brush } from './components/ModePanels';
import { cornerOf, triAt, triangleFromCorners } from './engine/tris';
import type { Blueprint } from './engine/format';
import { docArrayInsert, docFromValue, docValue, parseDoc } from './engine/doc';
import { makeCtx, resetComponent, setDataField, setOrientation, setPos, setCompField,
  setCompColor, serializeSave, type EditCtx } from './engine/edit';
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
  const [gizmoOn, setGizmoOn] = useState(() => localStorage.getItem('archean-app-gizmo') !== '0');
  const [hiDef, setHiDefState] = useState(() => localStorage.getItem('archean-app-hidef') !== '0');
  const [rev, setRev] = useState(0);
  const [blockSel, setBlockSel] = useState(-1);
  const [brush, setBrush] = useState<Brush>({ type: 0, sx: 0, sy: 0, sz: 0, slot: 4 });
  const [blockTool, setBlockTool] = useState<'place' | 'select'>('place');
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
    }
    setEngine(e);
  }, [markDirty, bumpRev]);
  const [engine, setEngine] = useState<Engine | null>(null);

  // mode gating: gizmo only in Edit; Wire forces cables visible; the wind
  // tunnel runs ONLY in Wind mode (the solve is bounded but never free)
  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    e.setGizmoEnabled(mode === 'edit' && gizmoOn);
    if (mode === 'wire') e.setOption('pipes', true);
    if (mode !== 'blocks') setBlockSel(-1);
    e.setWindTunnel(mode === 'aero');
  }, [mode, gizmoOn, engine]);

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
  }), [bumpRev, markDirty, sceneChanged]);

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
        if (placing) { setPlacing(null); return; }   // KSP: drop the HELD part first
        engineRef.current?.select(-1); setBlockSel(-1);
      }
      // NOTE: deleting a block goes through the BlockPanel button ONLY —
      // it mutates bp AND the doc together; a bare key must never touch bp
      // without the doc mirror.
    };
    addEventListener('keydown', h);
    return () => removeEventListener('keydown', h);
  }, [save, toggleOpt, placing]);

  // blocks-mode canvas handling: place (brush) or select, via engine.pickCell
  const onBlockPick = useCallback((clientX: number, clientY: number) => {
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
    if (!r) return;
    if (blockTool === 'select') { setBlockSel(r.bi >= 0 ? r.bi : -1); return; }
    if (r.bi >= 0) { setBlockSel(placeBlock(ctx, r.cell, brush, mirrorPlace)); sceneChanged(); }
    else setBlockSel(-1);
  }, [blockTool, blockSub, brush, mirrorPlace, triDraft, triBrush, sceneChanged]);

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
    <div className="overflow-y-auto">
      <div className="flex gap-1 px-3 pt-2">
        {(['blocks', 'tris'] as const).map(t => (
          <button key={t} data-testid={`blocksub-${t}`} onClick={() => { setBlockSub(t); setTriDraft([]); }}
            className={`ksp-btn px-2 py-[3px] text-[11px] ${blockSub === t ? 'on' : ''}`}>
            {t === 'blocks' ? '▤ Blocks' : '▵ Triangles'}
          </button>
        ))}
      </div>
      <div className="flex gap-1 px-3 pt-1">
        {(['place', 'select'] as const).map(t => (
          <button key={t} data-testid={`blocktool-${t}`} onClick={() => setBlockTool(t)}
            className={`ksp-btn px-2 py-[3px] text-[11px] ${blockTool === t ? 'on' : ''}`}>
            {t === 'place' ? '✚ Place' : '▣ Select'}
          </button>
        ))}
        {blockSub === 'blocks' && blockTool === 'place' && (
          <button data-testid="block-mirror" title="⇄ also place the x-mirrored twin (blocks AND catalog parts)"
            aria-pressed={mirrorPlace} onClick={() => setMirrorPlace(m => !m)}
            className={`ksp-btn ml-auto px-2 py-[3px] text-[11px] ${mirrorPlace ? 'on' : ''}`}>
            ⇄ {mirrorPlace ? 'twin ON' : 'twin off'}
          </button>
        )}
      </div>
      {blockSub === 'tris' ? triPanel : (
        <BlockPanel engine={engine} ctx={ctxRef.current} bp={bp!} blockSel={blockSel}
          brush={brush} onBrush={setBrush} onSelectBlock={setBlockSel} onApplied={sceneChanged} />
      )}
    </div>
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
      <TopBar mode={mode} onMode={m => {
        // the ACTIVE mode tile clicked again is a shortcut, not a re-select:
        // on View it toggles the side panel (user 2026-10-19: "clicking view
        // an extra time should hide the side panel") — more screen for the
        // craft; the ▤ button and a re-click bring it back
        if (m === 'view' && mode === 'view') { setPanelOpen(o => !o); return; }
        setMode(m);
      }} dirty={dirty} title={name} craftId={craft}
        onNew={() => { ctxRef.current = null; setBp(null); openText(emitNew()); }}
        onOpen={openFile} onSave={save} onClose={onBack} onBack={onBack}
        onRefresh={craft ? () => { forceRef.current = true; setRetrySeq(s => s + 1); } : undefined}>
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
                         shadow-2xl md:static md:z-auto md:shadow-none">
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
                    opts={opts} hullOpacity={hullOpacity} onHullOpacity={setHullOp}
                                        gizmoOn={gizmoOn && mode === 'edit'} onGizmo={setGizmo}
                    hiDef={hiDef} onHiDef={onHiDef}
                    onOpt={toggleOpt}
                    onSelect={(ci, fly) => { engineRef.current?.select(ci); if (fly) engineRef.current?.flyTo(ci); }}
                    onSelectSub={bi => engineRef.current?.selectSub(bi)}
                    edits={edits} inspKey={inspKey} markDirty={markDirty}
                    readOnly={mode === 'view'}
                    bottom={modePanel}
                    manifest={manifest}
                    placingType={placing}
                    onPlaceType={(t) => { setPlacing(t); if (t && mode === 'view') setMode('edit'); }}
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
              mode={mode} onBlockPick={onBlockPick}
              placing={mode === 'edit' ? placing : null} onPlace={onPlacePoint}
              onManifest={setManifest} />
            {placing && mode === 'edit' && (
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
                                    gizmoOn={gizmoOn} onGizmo={setGizmo} hiDef={hiDef} onHiDef={onHiDef} />
              </div>
            )}
            {/* KSP bottom-left: the STATIC INFO black box (mass & CoM) */}
            {bp && <div className="absolute bottom-2 left-3 z-[5]"><StaticInfo engine={engine} rev={rev} /></div>}
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
