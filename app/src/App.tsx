// App.tsx — two-stage SPA: craft GALLERY (legacy index-page style) →
// full-screen EDITOR with desktop-app chrome (File menu, New craft, the
// View / Edit / Blocks / Wire / Flight mode bar). ?craft=<id> deep-links
// straight into the editor. The catalog is STATICALLY COMPILED at build
// time (virtual:gallery — AGENTS § Blueprint folder), so the gallery paints
// with zero runtime fetches. The EDITOR is a LAZY chunk: the gallery page
// ships only React + the card grid — three.js and the whole engine load on
// the FIRST craft open (mobile initial paint stays light).
//
// EDITING: the blueprint lives in a raw-literal DOC (doc.ts) plus a plain
// live view of it. v1 files are NORMALIZED to the v2 dialect at open time
// (normalize.ts — the migration the user asked for: convert first, then the
// app speaks one format). Every write goes through engine/edit.ts + the
// pure mode modules, and SAVE re-emits the doc byte-identically except for
// the edited fields.
import { lazy, Suspense, useEffect, useState } from 'react';
import { GALLERY } from './gallery-catalog';

const Editor = lazy(() => import('./Editor'));

export { craftName } from './gallery-catalog';

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
            <div className="aspect-square overflow-hidden rounded-lg border border-white/10 bg-panel2
                            transition group-hover:border-accent/60">
              {g.preview && <img src={g.preview} alt="" loading="lazy" decoding="async"
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
