// App.tsx — two-stage SPA: craft GALLERY (legacy index-page style) →
// full-screen EDITOR with desktop-app chrome (File menu, New craft, the
// View / Edit / Blocks / Wire / Flight mode bar). ?craft=<id> deep-links
// straight into the editor. The catalog is STATICALLY COMPILED at build
// time (virtual:gallery — AGENTS § Blueprint folder), so the gallery paints
// with zero runtime fetches.
//
// EDITING: the blueprint lives in a raw-literal DOC (doc.ts) plus a plain
// live view of it. v1 files are NORMALIZED to the v2 dialect at open time
// (normalize.ts — the migration the user asked for: convert first, then the
// app speaks one format). Every write goes through engine/edit.ts + the
// pure mode modules, and SAVE re-emits the doc byte-identically except for
// the edited fields.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GALLERY } from 'virtual:gallery';
import type { Engine, PickHit, ViewOptions } from './engine/scene';
import Viewport from './components/Viewport';
import Panel, { type EditApi } from './components/Panel';
import TopBar, { type Mode } from './components/TopBar';
import { BlockPanel, FlightPanel, WirePanel, placeBlock, type Brush } from './components/ModePanels';
import type { Blueprint } from './engine/format';
import { docValue, parseDoc } from './engine/doc';
import { makeCtx, resetComponent, setDataField, setOrientation, setPos,
  serializeSave, type EditCtx } from './engine/edit';
import { normalizeDoc } from './engine/normalize';
import { newCraftDoc } from './engine/newcraft';

export const craftName = (id: string) =>
  GALLERY.find(g => g.id === id)?.name ?? `Workshop ${id}`;

export default function App() {
  const [params, setParams] = useState(() => new URLSearchParams(location.search));
  const craft = params.get('craft');
  const [newSeq, setNewSeq] = useState(0);
  const [isNew, setIsNew] = useState(false);
  const navigate = (to: string | null) => {
    history.pushState({}, '', to ? `/?craft=${to}` : '/');
    setParams(new URLSearchParams(to ? { craft: to } : {}));
    setIsNew(false);
  };
  useEffect(() => {
    const pop = () => setParams(new URLSearchParams(location.search));
    addEventListener('popstate', pop);
    return () => removeEventListener('popstate', pop);
  }, []);

  if (isNew && !craft)
    return <Editor key={`new-${newSeq}`} craft={null} onBack={() => navigate(null)} />;
  return craft
    ? <Editor key={craft} craft={craft} onBack={() => navigate(null)} />
    : <Gallery onOpen={navigate} onNew={() => { setIsNew(true); setNewSeq(s => s + 1); }} />;
}

// ---------------------------------------------------------------- gallery
function Gallery({ onOpen, onNew }: { onOpen: (id: string) => void; onNew: () => void }) {
  return (
    <div className="min-h-dvh overflow-y-auto bg-[#0e1013] px-4 py-6 md:px-10">
      <header className="mx-auto flex max-w-5xl items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">
            Archean <span data-testid="brand-accent" className="text-accent">blueprint inspector</span>
          </h1>
          <p data-testid="gallery-sub" className="mt-1 text-[12px] text-ink-dim">
            Click a craft to open the 3D editor; &#8599; opens the Steam Workshop page.
            {' '}{GALLERY.length} crafts from the configured blueprint folder.
          </p>
        </div>
        <button data-testid="gallery-new" onClick={onNew}
          className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-semibold text-black hover:brightness-110">
          + New craft
        </button>
      </header>
      <main data-testid="gallery"
        className="mx-auto mt-6 grid max-w-5xl grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {GALLERY.map(g => (
          <button key={g.id} data-testid={`card-${g.id}`} onClick={() => onOpen(g.id)}
            className="group text-left">
            <div className="aspect-square overflow-hidden rounded-lg border border-white/10 bg-panel2
                            transition group-hover:border-accent/60">
              {g.preview && <img src={g.preview} alt="" loading="lazy"
                className="h-full w-full object-cover" />}
            </div>
            <div className="mt-1.5 truncate text-[13px] font-semibold text-ink group-hover:text-accent">
              {g.name}
            </div>
            <div className="truncate text-[11px] text-ink-dim">
              {g.author ?? g.id} · <a
                href={`https://steamcommunity.com/sharedfiles/filedetails/?id=${g.id}`}
                target="_blank" rel="noopener" onClick={e => e.stopPropagation()}
                className="hover:text-accent">workshop ↗</a>
            </div>
          </button>
        ))}
        {GALLERY.length === 0 && <p className="col-span-full text-ink-dim">corpus folder empty</p>}
      </main>
    </div>
  );
}

// ----------------------------------------------------------------- editor
const DEFAULT_OPTS: ViewOptions = { grid: true, occ: false, hull: true, wire: false,
  pipes: true, subs: true, mirror: true, com: true };

function Editor({ craft, onBack }: { craft: string | null; onBack: () => void }) {
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
  }), [bumpRev]);

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
    const r = e.pickCell(clientX, clientY);
    if (!r) return;
    if (blockTool === 'select') { setBlockSel(r.bi >= 0 ? r.bi : -1); return; }
    if (r.bi >= 0) { setBlockSel(placeBlock(ctx, r.cell, brush)); sceneChanged(); }
    else setBlockSel(-1);
  }, [blockTool, brush, sceneChanged]);

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
  const modePanel = mode === 'blocks' ? (
    <div className="overflow-y-auto">
      <div className="flex gap-1 px-3 pt-2">
        {(['place', 'select'] as const).map(t => (
          <button key={t} data-testid={`blocktool-${t}`} onClick={() => setBlockTool(t)}
            className={`rounded px-2 py-[3px] text-[11px] ${blockTool === t ? 'bg-accent/25 text-accent' : 'bg-panel2 text-ink-dim hover:text-ink'}`}>
            {t === 'place' ? '✚ Place' : '▣ Select'}
          </button>
        ))}
      </div>
      <BlockPanel engine={engine} ctx={ctxRef.current} bp={bp!} blockSel={blockSel}
        brush={brush} onBrush={setBrush} onSelectBlock={setBlockSel} onApplied={sceneChanged} />
    </div>
  ) : mode === 'wire' ? (
    <WirePanel engine={engine} ctx={ctxRef.current} bp={bp!} rev={rev}
      onApplied={sceneChanged}
      onSelectComp={ci => engineRef.current?.select(ci)} />
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
          <aside data-testid="panel-aside"
            className="absolute inset-y-0 right-0 z-10 w-[300px] max-w-[85vw] border-l border-white/10
                       shadow-2xl md:static md:z-auto md:shadow-none">
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
          </aside>
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
