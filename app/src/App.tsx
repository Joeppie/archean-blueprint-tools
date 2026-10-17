// App.tsx — two-stage SPA: craft GALLERY (legacy index-page style) →
// full-screen EDITOR. ?craft=<id> deep-links straight into the editor, so
// old links and Playwright fixtures keep working. The catalog itself is
// STATICALLY COMPILED at build time (virtual:gallery from the configured
// blueprint folder — AGENTS § Blueprint folder), so the gallery paints with
// zero runtime fetches; only the preview images load lazily as files.
import { useEffect, useState } from 'react';
import { GALLERY } from 'virtual:gallery';
import type { PickHit } from './engine/scene';
import Viewport from './components/Viewport';
import type { Blueprint } from './engine/format';
import { isLegacyFile } from './engine/format';

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
    ? <Editor craft={craft} onBack={() => navigate(null)} />
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
  const [sel, setSel] = useState<PickHit | null>(null);

  useEffect(() => {
    setBp(null); setSel(null);
    (async () => {
      const res = await fetch(`/corpus/${craft}/blueprint.json`);
      if (res.ok) setBp(await res.json() as Blueprint);
    })().catch(console.error);
  }, [craft]);

  const name = bp?.data.alias?.trim() || craftName(craft);
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
      </header>
      <div className="relative flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1">
          <Viewport bp={bp} onPick={setSel} />
          {bp && sel && sel.kind !== 'none' && (
            <PickChip sel={sel} bp={bp} />
          )}
        </main>
      </div>
    </div>
  );
}

/** picked-part chip: bottom sheet on phones, floating card on desktop */
function PickChip({ sel, bp }: { sel: PickHit; bp: Blueprint }) {
  const comp = sel.kind === 'comp' && sel.ci != null ? bp.data.components[sel.ci] : null;
  return (
    <div data-testid="pick-info"
      className="pointer-events-none absolute inset-x-2 bottom-12 rounded-lg border border-gold/30
                 bg-black/70 px-3 py-2 text-[12px] text-ink backdrop-blur
                 md:inset-x-auto md:bottom-auto md:right-3 md:top-3 md:max-w-[320px]">
      picked: <span className="text-gold">{sel.kind}</span>
      {comp && <> · <span className="text-accent">{comp.type}</span>
        {comp.name ? <span className="text-ink-dim"> "{comp.name}"</span> : null}</>}
      {sel.point && <span className="text-ink-dim"> @ {sel.point.map(n => n.toFixed(2)).join(', ')}</span>}
    </div>
  );
}
