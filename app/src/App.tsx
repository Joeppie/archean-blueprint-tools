// App.tsx — two-stage SPA: craft GALLERY (legacy index-page style) →
// full-screen EDITOR (viewport + DevTools-style panels). ?craft=<id> deep
// links straight into the editor, so old links and Playwright fixtures keep
// working. The catalog itself is STATICALLY COMPILED at build time
// (virtual:gallery from the configured blueprint folder — AGENTS § Blueprint
// folder), so the gallery paints with zero runtime fetches; only the preview
// images load lazily as files.
//
// EDITING (P3): the blueprint lives in a raw-literal DOC (doc.ts) plus a
// plain live view of it; every write goes through engine/edit.ts so bp and
// doc stay in lockstep, and SAVE re-emits the doc byte-identically except
// for the edited numbers (occupancy + type-255 mirrors ride at save time).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GALLERY } from 'virtual:gallery';
import type { Engine, PickHit, ViewOptions } from './engine/scene';
import Viewport from './components/Viewport';
import Panel, { type EditApi } from './components/Panel';
import type { Blueprint } from './engine/format';
import { isLegacyFile } from './engine/format';
import { docValue, parseDoc } from './engine/doc';
import { makeCtx, resetComponent, setDataField, setOrientation, setPos,
  serializeSave, type EditCtx } from './engine/edit';

export const craftName = (id: string) =>
  GALLERY.find(g => g.id === id)?.name ?? `Workshop ${id}`;

export default function App() {
  const [params, setParams] = useState(() => new URLSearchParams(location.search));
  const craft = params.get('craft');
  const navigate = (to: string | null) => {
    history.pushState({}, '', to ? `/?craft=${to}` : '/');
    setParams(new URLSearchParams(to ? { craft: to } : {}));
  };
  useEffect(() => {
    const pop = () => setParams(new URLSearchParams(location.search));
    addEventListener('popstate', pop);
    return () => removeEventListener('popstate', pop);
  }, []);

  return craft
    ? <Editor key={craft} craft={craft} onBack={() => navigate(null)} />
    : <Gallery onOpen={navigate} />;
}

// ---------------------------------------------------------------- gallery
function Gallery({ onOpen }: { onOpen: (id: string) => void }) {
  return (
    <div className="min-h-dvh overflow-y-auto bg-[#0e1013] px-4 py-6 md:px-10">
      <header className="mx-auto max-w-5xl">
        <h1 className="text-xl font-semibold text-white">
          Archean <span data-testid="brand-accent" className="text-accent">blueprint inspector</span>
        </h1>
        <p data-testid="gallery-sub" className="mt-1 text-[12px] text-ink-dim">
          Click a craft to open the 3D editor; &#8599; opens the Steam Workshop page.
          {' '}{GALLERY.length} crafts from the configured blueprint folder.
        </p>
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
function Editor({ craft, onBack }: { craft: string; onBack: () => void }) {
  const [bp, setBp] = useState<Blueprint | null>(null);
  const [sel, setSel] = useState<{ ci: number; sub: number }>({ ci: -1, sub: -1 });
  const [hit, setHit] = useState<PickHit | null>(null);
  const [dirty, setDirty] = useState(false);
  const [inspKey, setInspKey] = useState(0);
  const [opts, setOpts] = useState<ViewOptions>({ grid: true, occ: false, hull: true, wire: false, pipes: true, subs: true, mirror: true });
  const [hullOpacity, setHullOpacity] = useState(1);
  const [realModels, setRealModels] = useState(true);
  const [gizmoOn, setGizmoOn] = useState(() => localStorage.getItem('archean-app-gizmo') !== '0');
  const engineRef = useRef<Engine | null>(null);
  const [engine, setEngine] = useState<Engine | null>(null);
  const ctxRef = useRef<EditCtx | null>(null);
  const dirtyRef = useRef(false);
  // mobile: the panel is a drawer; desktop opens it by default
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth >= 768);

  useEffect(() => {
    setBp(null); setSel({ ci: -1, sub: -1 }); setHit(null); setDirty(false);
    dirtyRef.current = false;
    (async () => {
      const res = await fetch(`/corpus/${craft}/blueprint.json`);
      if (!res.ok) return;
      const text = await res.text();
      const d = parseDoc(text);
      ctxRef.current = makeCtx(d, docValue(d) as Blueprint);
      setBp(ctxRef.current.bp);
    })().catch(console.error);
  }, [craft]);

  const markDirty = useCallback(() => {
    if (!dirtyRef.current) { dirtyRef.current = true; setDirty(true); }
  }, []);

  const onEngine = useCallback((e: Engine | null) => {
    engineRef.current = e;
    if (e) {
      e.onSelection = s => setSel(s);
      // gizmo drags mutate bp inside the engine — mirror into the doc + dirty
      e.onEdit = ci => {
        const ctx = ctxRef.current;
        const c = ctx?.bp.data.components[ci];
        if (!ctx || !c) return;
        setPos(ctx, ci, 'x', c.position.x); setPos(ctx, ci, 'y', c.position.y); setPos(ctx, ci, 'z', c.position.z);
        setOrientation(ctx, ci, c.orientation ?? { w: 1, x: 0, y: 0, z: 0 });
        markDirty();
      };
      e.onDataEdit = (ci, key) => {
        const ctx = ctxRef.current;
        const v = ctx?.bp.data.components[ci]?.data?.[key];
        if (!ctx || typeof v !== 'number') return;
        setDataField(ctx, ['data', 'components', ci], key, v);
        markDirty();
      };
    }
    setEngine(e);
  }, [markDirty]);

  // every write: doc + bp (edit.ts) AND the live scene (engine) — one funnel
  const edits: EditApi = useMemo(() => ({
    // position edits ride the ENGINE path: twin propagation + doc mirror via
    // onEdit (edit.ts primitives stay the doc layer's own tools)
    pos: (_ctx, ci, ax, v) => { engineRef.current?.setFilePosAxis(ci, ax, v); },
    beginRot: ci => engineRef.current?.beginRotEdit(ci),
    quatDelta: (ctx, ci, p, y, r) => {
      const q = engineRef.current?.setCompQuatDelta(ci, p, y, r);
      if (q) setOrientation(ctx, ci, q);
    },
    dataField: (ctx, path, k, v) => { setDataField(ctx, path, k, v); },
    reset: (ctx, ci) => {
      resetComponent(ctx, ci);
      setInspKey(k => k + 1);                     // rebuild the slider baselines
    },
  }), []);

  // SAVE: mirror-sync occupancy + type-255 blocks into the doc and re-emit
  const save = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const text = serializeSave(ctx);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = 'blueprint.json'; a.click(); URL.revokeObjectURL(a.href);
    dirtyRef.current = false; setDirty(false);
  }, []);

  // keyboard: g/o/h drive the SAME toggles as the checkboxes (v0.147 rule),
  // Esc deselects, Ctrl+S saves
  const toggleOpt = useCallback((k: keyof ViewOptions, on: boolean) => {
    const e = engineRef.current;
    if (!e) return;
    e.setOption(k, on);
    setOpts(e.getOptions());                      // hull/wire exclusivity rides back
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
      if (e.key === 'Escape') engineRef.current?.select(-1);
    };
    addEventListener('keydown', h);
    return () => removeEventListener('keydown', h);
  }, [save, toggleOpt]);

  const setReal = useCallback((on: boolean) => {
    setRealModels(on);
    engineRef.current?.setRealModels(on);
  }, []);
  const setGizmo = useCallback((on: boolean) => {
    setGizmoOn(on);
    engineRef.current?.setGizmoEnabled(on);
  }, []);
  const setHullOp = useCallback((v: number) => {
    setHullOpacity(v);
    engineRef.current?.setHullOpacity(v);
  }, []);

  const name = bp?.data.alias?.trim() || craftName(craft);
  const panel = bp && ctxRef.current && (
    <Panel
      engine={engine} ctx={ctxRef.current} bp={bp} sel={sel}
      opts={opts} hullOpacity={hullOpacity} onHullOpacity={setHullOp}
      realModels={realModels} onRealModels={setReal}
      gizmoOn={gizmoOn} onGizmo={setGizmo}
      onOpt={toggleOpt}
      onSelect={(ci, fly) => { engineRef.current?.select(ci); if (fly) engineRef.current?.flyTo(ci); }}
      onSelectSub={bi => engineRef.current?.selectSub(bi)}
      edits={edits} inspKey={inspKey} markDirty={markDirty}
    />
  );

  return (
    <div className="flex h-dvh w-full flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-white/10 bg-panel px-2">
        <button data-testid="back-to-gallery" onClick={onBack}
          className="rounded bg-panel2 px-2.5 py-1 text-[12px] text-ink hover:bg-white/10 hover:text-accent">
          ← gallery
        </button>
        <span data-testid="editor-title" className="min-w-0 flex-1 truncate text-[13px] font-semibold text-accent">{name}</span>
        {bp && (
          <span className="hidden shrink-0 text-[11px] text-ink-dim sm:block">
            v{bp.data.version} · {isLegacyFile(bp) ? 'legacy palette' : 'file palette'}
          </span>
        )}
        <button data-testid="save-btn" onClick={save}
          className={`rounded px-2.5 py-1 text-[12px] ${dirty ? 'bg-accent text-black' : 'bg-panel2 text-ink-dim'}`}>
          {dirty ? '● Save' : 'Save'}
        </button>
        <button data-testid="toggle-panels" onClick={() => setPanelOpen(o => !o)}
          className="rounded bg-panel2 px-2.5 py-1 text-[12px] text-ink hover:bg-white/10 hover:text-accent">
          ⚙
        </button>
      </header>
      <div className="relative flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1">
          <Viewport bp={bp} onPick={setHit} onEngine={onEngine} />
          {bp && hit && hit.kind !== 'none' && (
            <PickChip hit={hit} bp={bp} />
          )}
        </main>
        {panelOpen && (
          <aside data-testid="panel-aside"
            className="absolute inset-y-0 right-0 z-10 w-[300px] max-w-[85vw] border-l border-white/10
                       shadow-2xl md:static md:z-auto md:shadow-none">
            {panel}
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
