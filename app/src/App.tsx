// SPA shell (Phase 1): blueprint picker over the configured corpus folder
// (/corpus/ served by tools/vite-corpus.ts — AGENTS § Blueprint folder) and
// a placeholder viewport. The Three.js scene engine + full panel UI land in
// Phases 2–3; selection state here already follows the ?craft= deep link so
// Playwright fixtures can address a craft directly.
import { useEffect, useState } from 'react';
import type { Blueprint } from './engine/format';
import { isLegacyFile } from './engine/format';

interface CraftRow { id: string; name: string }

function useCraftParam(): [string | null, (id: string) => void] {
  const [params, setParams] = useState(() => new URLSearchParams(location.search));
  const select = (id: string) => {
    params.set('craft', id);
    history.pushState({}, '', `${location.pathname}?${params}`);
    setParams(new URLSearchParams(params));
  };
  return [params.get('craft'), select];
}

export default function App() {
  const [craft, setCraft] = useCraftParam();
  const [crafts, setCrafts] = useState<CraftRow[]>([]);
  const [bp, setBp] = useState<Blueprint | null>(null);

  useEffect(() => {
    (async () => {
      const html = await (await fetch('/corpus/')).text();
      const ids = [...html.matchAll(/href="(\d{6,})\/"/g)].map(m => m[1]!);
      setCrafts(ids.map(id => ({ id, name: id })));
      if (!craft && ids.length) setCraft(ids[0]!);
    })().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!craft) return;
    (async () => {
      const res = await fetch(`/corpus/${craft}/blueprint.json`);
      if (res.ok) setBp(await res.json() as Blueprint);
    })().catch(console.error);
  }, [craft]);

  return (
    <div className="grid h-full grid-cols-[260px_1fr]">
      <aside className="overflow-y-auto border-r border-white/10 bg-panel p-2" data-testid="corpus-panel">
        <h1 className="mb-2 px-1 text-[11px] tracking-widest text-ink-dim uppercase">
          Archean inspector
        </h1>
        {crafts.map(c => (
          <button key={c.id}
            data-testid={`craft-${c.id}`}
            onClick={() => setCraft(c.id)}
            className={`block w-full truncate rounded px-2 py-1 text-left ${
              c.id === craft ? 'bg-panel2 text-accent' : 'hover:bg-panel2'}`}>
            {c.name}
          </button>
        ))}
        {crafts.length === 0 && <p className="px-2 text-ink-dim">corpus folder empty</p>}
      </aside>
      <main className="relative flex items-center justify-center" data-testid="viewport">
        {bp ? <Summary craft={craft!} bp={bp} /> : <p className="text-ink-dim">open a craft…</p>}
        <p className="absolute bottom-2 right-3 text-[11px] text-ink-dim">
          scene engine lands in Phase 2 (see REWRITE.md)
        </p>
      </main>
    </div>
  );
}

function Summary({ craft, bp }: { craft: string; bp: Blueprint }) {
  const legacy = isLegacyFile(bp);
  return (
    <div data-testid="bp-summary" className="rounded-lg border border-white/10 bg-panel px-5 py-4">
      <h2 className="mb-1 text-base text-accent">{bp.data.alias || `Workshop ${craft}`}</h2>
      <p className="text-ink-dim">
        blocks={bp.data.blocks.length} components={bp.data.components.length}
        {' '}triangles={bp.data.triangles?.length ?? 0} version={bp.data.version}
        {' '}{legacy ? <span data-testid="legacy-badge" className="text-gold">legacy palette</span>
                    : <span className="text-gold">file palette</span>}
      </p>
    </div>
  );
}
