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
import { GALLERY, craftName } from './gallery-catalog';
import { cacheSnapshot, craftStateOf, type CacheInfo, type CraftState } from './crafts';

const LazyEditor = lazy(async () => {
  // v1.12.2 BOOT COST: fire the model-manifest fetch the MOMENT a craft open
  // begins (the Viewport's getAtlas awaits this same promise). The card click
  // then the chunk load + React mount + engine attach ran ~350 ms before the
  // manifest request was even issued — on the live app that latency is paid
  // on EVERY first craft open, on every origin.
  void import('./engine/models').then(m => m.loadManifest());
  return import('./Editor');
});

// v1.12.2 BOOT COST — DEEP-LINK FAST PATH (main.tsx bootEditor): on a fresh
// `?craft=` load the chunk is ALREADY resolved (window.__EDITOR_MODULE__),
// so App renders the editor in the root's INITIAL (synchronous) mount —
// React's first render flushes in one burst; the lazy path above stays for
// SPA navigations from the gallery (time-sliced reveal is right there —
// it keeps the click responsive).
const Editor = window.__EDITOR_MODULE__?.default ?? LazyEditor;

export { craftName } from './gallery-catalog';

/** PLAYABLE-IN-THE-BROWSER crafts (v1.13.8, we: "add those to the library
 *  on top in a little segment of their own"): the two arcade builds whose
 *  screens run a GAME. The card loops a small webm (< 250 KiB, 5 fps) — a
 *  cinematic capture recorded INSIDE the craft (an oblique view catching
 *  the pilot seat — proof the screen is simulated in the ship;
 *  tools/makeclip.mjs). Clicking the card opens the craft AND the
 *  fullscreen game screen at once via the ?craft&dash deep link — the same
 *  URL is shareable/fresh-loadable. */
const PLAYABLE = [
  { id: '3820116990', clip: 'mario.webm', dash: 'first-virtual',
    keys: 'WASD run · SPACE jump · E fire' },
  { id: '3288012440', clip: 'invaders.webm', dash: 'main#0',
    keys: 'WASD cannon · SPACE start & fire' },
];

export default function App() {
  const [params, setParams] = useState(() => new URLSearchParams(location.search));
  const craft = params.get('craft');
  const [newSeq, setNewSeq] = useState(0);
  const [isNew, setIsNew] = useState(false);
  const navigate = (to: string | null, dash?: string) => {
    // RELATIVE query-only pushState: absolute '/' would eject the SPA from
    // its Pages subdirectory (/archean-blueprint-tools/app/) and break the
    // ../testdata + ../viewer asset routes on reload. A `dash` (PLAYABLE
    // deep link) opens the fullscreen game screen on the fresh Editor mount.
    const qs = to ? (dash ? `?craft=${to}&dash=${encodeURIComponent(dash)}` : `?craft=${to}`) : '';
    history.pushState({}, '', to ? qs : location.pathname);
    setParams(new URLSearchParams(to ? (dash ? { craft: to, dash } : { craft: to }) : {}));
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
function Gallery({ onOpen, onNew }: { onOpen: (id: string, dash?: string) => void; onNew: () => void }) {
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
      {/* PLAYABLE-IN-THE-BROWSER row (v1.13.8): the two arcade crafts, in
          their own little segment on TOP — webm cards (in-craft captures),
          click = boot the game fullscreen via the ?craft&dash deep link.
          Rendered only for crafts the corpus actually has. */}
      {PLAYABLE.some(p => GALLERY.some(g => g.id === p.id)) && (
        <section data-testid="playable" className="mx-auto mt-6 max-w-5xl">
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-accent">
            ▶ Playable in the browser
          </h2>
          <p className="mt-1 text-[12px] text-ink-dim">
            These crafts ARE arcade cabinets — the screen is simulated IN the
            craft (the seat is in the frame). Click one: it boots straight
            into the game, fullscreen; the URL is a shareable deep link.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {PLAYABLE.filter(p => GALLERY.some(g => g.id === p.id)).map(p => (
              <button key={p.id} data-testid={`playable-${p.id}`}
                onClick={() => onOpen(p.id, p.dash)}
                className="group text-left">
                <div className="relative aspect-square overflow-hidden rounded-lg border border-accent/30 bg-black
                                transition group-hover:border-accent">
                  <GameClip clip={p.clip} />
                  <span className="absolute right-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px]
                                   font-semibold text-accent">▶ play</span>
                </div>
                <div className="mt-1.5 truncate text-[13px] font-semibold text-ink group-hover:text-accent">
                  {craftName(p.id)}
                </div>
                <div className="truncate text-[11px] text-ink-dim">{p.keys}</div>
              </button>
            ))}
          </div>
        </section>
      )}
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
        <a data-testid="xenoncore-link" href="https://joeppie.github.io/xenoncore/"
          target="_blank" rel="noopener"
          className="underline decoration-white/15 underline-offset-2 hover:text-ink">
          xenoncore — the XenonCode language core & playground
        </a>
        {' · '}
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

/** PLAYABLE clip (public/games/…): a 5 fps in-craft capture, autoplaying
 *  muted loop (webm, < 250 KiB). Layout-exact like CardPreview — the Pages
 *  root serves '/games/', the '/app/' copy needs '../games/'. */
function GameClip({ clip }: { clip: string }) {
  const [src, setSrc] = useState(`games/${clip}`);
  return <video src={src} autoPlay muted loop playsInline preload="metadata"
    onError={() => setSrc(s => (s.startsWith('games/') ? `../${s}` : s))}
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
