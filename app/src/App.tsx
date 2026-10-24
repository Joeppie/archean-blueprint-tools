// App.tsx — two-stage SPA: craft GALLERY (legacy index-page style) →
// full-screen EDITOR laid out KSP-VAB-style: a viewport that fills the
// window, the PARTS panel docked LEFT (mobile: drawer), the STATIC INFO
// (mass/CoM) black box bottom-left, the camera-preset cluster bottom-right
// and the File menu + View / Edit / Wire / Flight / Wind mode tiles in a
// thin toolbar. ?craft=<id> deep-links straight into the editor. The
// catalog is STATICALLY COMPILED at build time (virtual:gallery — AGENTS
// § Blueprint folder), so the gallery paints with zero runtime fetches.
// The EDITOR is a LAZY chunk: the gallery page ships only React + the card
// grid — three.js and the whole engine load on the FIRST craft open.
//
// EDITING: the blueprint lives in a raw-literal DOC (doc.ts) plus a plain
// live view of it. v1 files are NORMALIZED to the v2 dialect at open time
// (normalize.ts — the migration the user asked for: convert first, then the
// app speaks one format). Every write goes through engine/edit.ts + the
// pure mode modules, and SAVE re-emits the doc byte-identically except for
// the edited fields. Blueprints DOWNLOAD only on demand and cache in
// IndexedDB (crafts.ts) — a cached craft opens with zero network.
import { lazy, Suspense, useEffect, useState } from 'react';
import { GALLERY } from './gallery-catalog';
import { cacheSnapshot, craftStateOf, type CacheInfo, type CraftState } from './crafts';

const Editor = lazy(() => import('./Editor'));

export { craftName } from './gallery-catalog';

export default function App() {
  const [params, setParams] = useState(() => new URLSearchParams(location.search));
  const craft = params.get('craft');
  const [newSeq, setNewSeq] = useState(0);
  const [isNew, setIsNew] = useState(false);
  const navigate = (to: string | null) => {
    // RELATIVE query-only pushState: absolute '/' would eject the SPA from
    // its Pages subdirectory (/archean-blueprint-tools/app/) and break the
    // ../testdata + ../viewer asset routes on reload.
    history.pushState({}, '', to ? `?craft=${to}` : location.pathname);
    setParams(new URLSearchParams(to ? { craft: to } : {}));
    setIsNew(false);
  };
  useEffect(() => {
    const pop = () => setParams(new URLSearchParams(location.search));
    addEventListener('popstate', pop);
    return () => removeEventListener('popstate', pop);
  }, []);

  const editor = isNew && !craft
    ? <Editor key={`new-${newSeq}`} craft={null} onBack={() => navigate(null)} />
    : <Editor key={craft} craft={craft!} onBack={() => navigate(null)} />;

  return (
    <Suspense fallback={<div data-testid="editor-loading"
      className="grid h-dvh place-items-center text-[12px] text-ink-dim">
      loading editor…
    </div>}>
      {craft || isNew ? editor : <Gallery onOpen={navigate} onNew={() => { setIsNew(true); setNewSeq(s => s + 1); }} />}
    </Suspense>
  );
}

// ---------------------------------------------------------------- gallery
function Gallery({ onOpen, onNew }: { onOpen: (id: string) => void; onNew: () => void }) {
  // v1.9.5 VERSIONED CACHE chip: ONE pass over the IndexedDB cache paints a
  // status badge on every CACHED card (never on uncached ones). The state
  // comes from craftStateOf(cache record, catalog stamp) — the SAME rule the
  // editor's open gate runs, so chip and dialog can never disagree about a
  // craft. fresh = the copy provably is the file as served (subtle ✓);
  // stale = the folder holds a newer file (amber ⚠); unknown = legacy or
  // unverified copy (⚠) — both warned states ASK before opening.
  const [snap, setSnap] = useState<Map<string, CacheInfo> | null>(null);
  useEffect(() => {
    let dead = false;
    cacheSnapshot().then(s => { if (!dead) setSnap(s); }).catch(() => { /* chips are cosmetic */ });
    return () => { dead = true; };
  }, []);
  return (
    <div className="min-h-dvh overflow-y-auto bg-[#0e1013] px-4 py-6 md:px-10">
      <header className="mx-auto flex max-w-5xl flex-wrap items-end justify-between gap-3">
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
          className="shrink-0 whitespace-nowrap rounded-lg bg-accent px-3 py-1.5 text-[13px] font-semibold text-black hover:brightness-110">
          + New craft
        </button>
      </header>
      <main data-testid="gallery"
        className="mx-auto mt-6 grid max-w-5xl grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {GALLERY.map(g => (
          <button key={g.id} data-testid={`card-${g.id}`} onClick={() => onOpen(g.id)}
            className="group text-left">
            <div className="relative aspect-square overflow-hidden rounded-lg border border-white/10 bg-panel2
                            transition group-hover:border-accent/60">
              {g.preview && <CardPreview preview={g.preview} />}
              {snap && snap.has(g.id) && (
                <CardStatusChip state={craftStateOf(snap.get(g.id), g)}
                  saved={snap.get(g.id)?.saved} changed={g.mtime} id={g.id} />
              )}
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
      {/* the app IS the site now (Pages root): the retired zero-build viewer
          lives at the very END of the gallery — one small, muted link. The
          href is ROOT-relative-exact (from the Pages site root AND the dev
          '/' page — '../' would ESCAPE the Pages repo prefix). */}
      <footer className="mx-auto mt-12 max-w-5xl border-t border-white/5 pt-3 pb-1 text-[11px] text-ink-dim/70">
        <a data-testid="legacy-link" href="viewer/index.html"
          className="underline decoration-white/15 underline-offset-2 hover:text-ink">
          legacy blueprint viewer
        </a>
      </footer>
    </div>
  );
}

// Catalog previews bake the ROOT layout ('testdata/<id>/…', where Pages
// serves the app); the '/app/' copy resolves one level deeper, so onError
// flips to the parent-relative twin. Dev hits the plugin's /testdata route.
function CardPreview({ preview }: { preview: string }) {
  const [src, setSrc] = useState(preview);
  const alt = src.startsWith('testdata/') ? `../${src}`
    : src.startsWith('../testdata/') ? src.slice(3) : null;
  return <img src={src} alt="" loading="lazy" decoding="async"
    onError={() => { if (alt && src !== alt) setSrc(alt); }}
    className="h-full w-full object-cover" />;
}

const chipDate = (ms?: number) =>
  ms && ms > 0 ? new Date(ms).toISOString().slice(0, 10) : 'unknown';

/** VERSIONED CACHE status badge (v1.9.5) — shown ONLY for cached crafts:
 *  fresh ✓ (subtle) · stale ⚠ amber "edited since cached" · unversioned ⚠.
 *  The tooltip carries the dates the open dialog repeats; the testid keeps
 *  the state IN THE NAME (`card-status-stale-<id>`) so a pin asserts the
 *  EXACT state, not merely a chip. */
function CardStatusChip(p: { state: CraftState; saved?: number; changed?: number; id: string }) {
  if (p.state === 'absent') return null;
  const [icon, cls, tip] = p.state === 'fresh'
    ? ['\u2713', 'bg-black/55 text-emerald-300/90',
       `cached copy matches the blueprint folder (cached ${chipDate(p.saved)})`]
    : p.state === 'stale'
      ? ['\u26a0', 'bg-amber-400/95 text-black',
         `cached ${chipDate(p.saved)} \u00b7 file changed ${chipDate(p.changed)} \u2014 will ask before opening`]
      : ['\u26a0', 'bg-amber-500/80 text-black',
         `cached copy unversioned (cached ${chipDate(p.saved)}) \u2014 will ask before opening`];
  return (
    <span data-testid={`card-status-${p.state}-${p.id}`} data-state={p.state} title={tip}
      className={`absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded px-[3px]
                  text-[10px] font-bold leading-none shadow ${cls}`}>
      {icon}
    </span>
  );
}
