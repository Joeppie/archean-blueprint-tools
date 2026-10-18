// Editor.tsx — the full-screen editing workspace (lazy chunk: the gallery
// never loads three.js/the engine). Holds the raw-literal DOC + live bp, the
// mode bar state and the save/open funnel; see App.tsx for the app shell.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { craftName } from './gallery-catalog';
import type { Engine, PickHit, ViewOptions } from './engine/scene';
import Viewport from './components/Viewport';
import Panel, { type EditApi } from './components/Panel';
import TopBar, { type Mode } from './components/TopBar';
import { BlockPanel, FlightPanel, TriPanel, WirePanel, placeBlock, type Brush } from './components/ModePanels';
import { cornerOf, triAt, triangleFromCorners } from './engine/tris';
import type { Blueprint } from './engine/format';
import { docArrayInsert, docFromValue, docValue, parseDoc } from './engine/doc';
import { makeCtx, resetComponent, setDataField, setOrientation, setPos, setCompField,
  setCompColor, serializeSave, type EditCtx } from './engine/edit';
import { makePipe } from './engine/wireops';
import { normalizeDoc } from './engine/normalize';
import { newCraftDoc } from './engine/newcraft';

const DEFAULT_OPTS: ViewOptions = { grid: true, occ: false, hull: true, wire: false,
  pipes: true, subs: true, mirror: true, com: true };

export default function Editor({ craft, onBack }: { craft: string | null; onBack: () => void }) {
  const [bp, setBp] = useState<Blueprint | null>(null);
  const [sel, setSel] = useState<{ ci: number; sub: number }>({ ci: -1, sub: -1 });
  const [hit, setHit] = useState<PickHit | null>(null);
  const [dirty, setDirty] = useState(false);
  const [inspKey, setInspKey] = useState(0);
  const [mode, setMode] = useState<Mode>('view');
  const [opts, setOpts] = useState<ViewOptions>(DEFAULT_OPTS);
  const [hullOpacity, setHullOpacityState] = useState(1);
  const [realModels, setRealModels] = useState(true);
  const [gizmoOn, setGizmoOn] = useState(() => localStorage.getItem('archean-app-gizmo') !== '0');
  const [hiDef, setHiDefState] = useState(() => localStorage.getItem('archean-app-hidef') === '1');
  const [rev, setRev] = useState(0);
  const [blockSel, setBlockSel] = useState(-1);
  const [brush, setBrush] = useState<Brush>({ type: 0, sx: 0, sy: 0, sz: 0, slot: 4 });
  const [blockTool, setBlockTool] = useState<'place' | 'select'>('place');
  const [blockSub, setBlockSub] = useState<'blocks' | 'tris'>('blocks');
  const [triDraft, setTriDraft] = useState<number[][]>([]);
  const [triSel, setTriSel] = useState(-1);
  const [triBrush, setTriBrush] = useState<number[]>([51, 51, 51, 51, 51]);
  const engineRef = useRef<Engine | null>(null);
  const ctxRef = useRef<EditCtx | null>(null);
  const dirtyRef = useRef(false);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // mobile: the panel is a drawer; desktop opens it by default
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth >= 768);

  /** parse → v1→v2 NORMALIZE → doc+ctx → live bp. One funnel for fetch,
   *  file-open, drag-drop and New craft. */
  const openText = useCallback((text: string) => {
    const d = parseDoc(text);
    normalizeDoc(d);                              // convert-on-open migration
    ctxRef.current = makeCtx(d, docValue(d) as Blueprint);
    dirtyRef.current = false;
    setDirty(false); setSel({ ci: -1, sub: -1 }); setBlockSel(-1);
    setBp(ctxRef.current.bp);
  }, []);

  useEffect(() => {
    setBp(null);
    if (!craft) { openText(emitNew()); return; }    // New craft (craft === null)
    let dead = false;
    (async () => {
      const res = await fetch(`/corpus/${craft}/blueprint.json`);
      if (!res.ok || dead) return;
      if (!dead) openText(await res.text());
    })().catch(console.error);
    return () => { dead = true; };
  }, [craft, openText]);

  const emitNew = () => {
    // imported lazily to keep this component's top tidy; doc → text round
    // trip through the SAME doc the editor then keeps
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

  // mode gating: gizmo only in Edit; Wire forces cables visible
  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    e.setGizmoEnabled(mode === 'edit' && gizmoOn);
    if (mode === 'wire') e.setOption('pipes', true);
    if (mode !== 'blocks') setBlockSel(-1);
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

  // keyboard: g/o/h toggles, Ctrl+S save, Esc deselect, Del deletes the
  // selected block (blocks mode)
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
      if (e.key === 'Escape') { engineRef.current?.select(-1); setBlockSel(-1); }
      // NOTE: deleting a block goes through the BlockPanel button ONLY —
      // it mutates bp AND the doc together; a bare key must never touch bp
      // without the doc mirror.
    };
    addEventListener('keydown', h);
    return () => removeEventListener('keydown', h);
  }, [save, toggleOpt]);

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
    if (r.bi >= 0) { setBlockSel(placeBlock(ctx, r.cell, brush)); sceneChanged(); }
    else setBlockSel(-1);
  }, [blockTool, blockSub, brush, triDraft, triBrush, sceneChanged]);

  const setReal = useCallback((on: boolean) => {
    setRealModels(on);
    engineRef.current?.setRealModels(on);
  }, []);
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
            className={`rounded px-2 py-[3px] text-[11px] ${blockSub === t ? 'bg-accent/25 text-accent' : 'bg-panel2 text-ink-dim hover:text-ink'}`}>
            {t === 'blocks' ? '▤ Blocks' : '▵ Triangles'}
          </button>
        ))}
      </div>
      <div className="flex gap-1 px-3 pt-1">
        {(['place', 'select'] as const).map(t => (
          <button key={t} data-testid={`blocktool-${t}`} onClick={() => setBlockTool(t)}
            className={`rounded px-2 py-[3px] text-[11px] ${blockTool === t ? 'bg-accent/25 text-accent' : 'bg-panel2 text-ink-dim hover:text-ink'}`}>
            {t === 'place' ? '✚ Place' : '▣ Select'}
          </button>
        ))}
      </div>
      {blockSub === 'tris' ? triPanel : (
        <BlockPanel engine={engine} ctx={ctxRef.current} bp={bp!} blockSel={blockSel}
          brush={brush} onBrush={setBrush} onSelectBlock={setBlockSel} onApplied={sceneChanged} />
      )}
    </div>
  ) : mode === 'wire' ? (
    <WirePanel engine={engine} ctx={ctxRef.current} bp={bp!} rev={rev}
      onApplied={sceneChanged}
      onSelectComp={ci => engineRef.current?.select(ci)}
      sel={sel.ci}
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
  ) : mode === 'flight' ? (
    <FlightPanel engine={engine} rev={rev} />
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
        onOpen={openFile} onSave={save} onClose={onBack} onBack={onBack}>
        <button data-testid="save-btn" onClick={() => save()}
          className={`shrink-0 rounded px-2.5 py-1 text-[12px] ${dirty ? 'bg-accent text-black' : 'bg-panel2 text-ink-dim hover:text-ink'}`}>
          {dirty ? '● Save' : 'Save'}
        </button>
        <button data-testid="toggle-panels" onClick={() => setPanelOpen(o => !o)}
          className="shrink-0 rounded bg-panel2 px-2.5 py-1 text-[12px] text-ink hover:bg-white/10 hover:text-accent">
          ⚙
        </button>
      </TopBar>
      <input ref={fileRef} type="file" accept=".json,application/json" className="hidden"
        data-testid="file-input"
        onChange={e => { const f = e.target.files?.[0]; if (f) readFile(f); e.target.value = ''; }} />
      <div className="relative flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1">
          <Viewport bp={bp} onPick={setHit} onEngine={onEngine}
            mode={mode} onBlockPick={onBlockPick} />
          {bp && hit && hit.kind !== 'none' && mode !== 'blocks' && (
            <PickChip hit={hit} bp={bp} />
          )}
        </main>
        {panelOpen && (
          <>
            {/* mobile drawer: tap the dimmed canvas to dismiss (desktop keeps
                the static sidebar with no overlay) */}
            <div data-testid="panel-backdrop" onClick={() => setPanelOpen(false)}
              className="absolute inset-0 z-[5] bg-black/40 md:hidden" />
            <aside data-testid="panel-aside"
              className="absolute inset-y-0 right-0 z-10 flex w-[300px] max-w-[85vw] flex-col border-l border-white/10
                         shadow-2xl md:static md:z-auto md:shadow-none">
              <div className="flex h-9 shrink-0 items-center justify-between border-b border-white/10 px-3
                              md:hidden">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-dim">Panel</span>
                <button data-testid="panel-close" onClick={() => setPanelOpen(false)}
                  aria-label="close panel"
                  className="rounded bg-panel2 px-2.5 py-1 text-[13px] text-ink hover:bg-white/10 hover:text-accent">
                  ✕
                </button>
              </div>
              <div className="flex min-h-0 flex-1 flex-col">
              {bp && ctxRef.current && (
                <Panel
                  engine={engine} ctx={ctxRef.current} bp={bp} sel={sel} rev={rev}
                  opts={opts} hullOpacity={hullOpacity} onHullOpacity={setHullOp}
                  realModels={realModels} onRealModels={setReal}
                  gizmoOn={gizmoOn && mode === 'edit'} onGizmo={setGizmo}
                  hiDef={hiDef} onHiDef={onHiDef}
                  onOpt={toggleOpt}
                  onSelect={(ci, fly) => { engineRef.current?.select(ci); if (fly) engineRef.current?.flyTo(ci); }}
                  onSelectSub={bi => engineRef.current?.selectSub(bi)}
                  edits={edits} inspKey={inspKey} markDirty={markDirty}
                  readOnly={mode === 'view'}
                  bottom={modePanel}
                />
              )}
              </div>
            </aside>
          </>
        )}
      </div>
    </div>
  );
}

/** picked-part chip: bottom sheet on phones, floating card on desktop */
function PickChip({ hit, bp }: { hit: PickHit; bp: Blueprint }) {
  const comp = hit.kind === 'comp' && hit.ci != null ? bp.data.components[hit.ci] : null;
  return (
    <div data-testid="pick-info"
      className="pointer-events-none absolute inset-x-2 bottom-12 rounded-lg border border-gold/30
                 bg-black/70 px-3 py-2 text-[12px] text-ink backdrop-blur
                 md:inset-x-auto md:bottom-auto md:right-3 md:top-3 md:max-w-[320px]">
      picked: <span className="text-gold">{hit.kind}</span>
      {comp && <> · <span className="text-accent">{comp.type}</span>
        {typeof comp.name === 'string' && comp.name ? <span className="text-ink-dim"> "{comp.name}"</span> : null}</>}
      {hit.point && <span className="text-ink-dim"> @ {hit.point.map(n => n.toFixed(2)).join(', ')}</span>}
    </div>
  );
}
