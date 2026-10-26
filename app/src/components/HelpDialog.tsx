// HelpDialog.tsx — the built-in MANUAL (v1.5.20 user request: "add a nice
// way to document … add documentation in a help menu, with search for words
// for topics, keep it simple, markdown, generate html table, make it a
// manual so people can learn how to use it effectively").
//
// The content is the markdown corpus in src/help/topics/ (registry + word
// search: src/help/manual.ts); engine/markdown.ts renders a topic to HTML,
// pipe tables included. On phones the window is FULLSCREEN (v1.11.1 user
// rule); on desktop it reuses the tool-dialog ergonomics the user already
// approved: capped at 86 dvh, draggable title bar, smooth scrolling body,
// Esc/✕/backdrop to close. Layout: topic rail (search-filtered, scored) +
// the article.
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useRef, useState } from 'react';
import { renderMarkdown } from '../engine/markdown';
import { TOPICS, searchTopics, type HelpTopic } from '../help/manual';

export default function HelpDialog(p: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState<string>(TOPICS[0]?.id ?? 'start');
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ sx: number; sy: number; bx: number; by: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const artRef = useRef<HTMLDivElement>(null);

  // Esc closes — subscribed ONCE through a ref (v1.5.20 e2e lesson): the
  // Editor's OWN window keydown handler sets state, and React flushes a
  // discrete keyboard event synchronously MID-DISPATCH — a deps-[onClose]
  // effect re-subscribes during that flush and the dialog's listener is
  // REMOVED before the same keypress reaches it (real presses closed the
  // manual only for synthetic dispatchEvents). A ref keeps the mount-time
  // subscription always live, whatever the parent re-renders with.
  const closeRef = useRef(p.onClose);
  closeRef.current = p.onClose;
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    addEventListener('keydown', h);
    return () => removeEventListener('keydown', h);
  }, []);

  const results = useMemo(() => searchTopics(query), [query]);
  const searching = query.trim().length > 0;
  // while searching, the article follows the BEST match; an empty result
  // set keeps the last topic on screen (a half-typed word never blanks the
  // manual — the rail just says "no topic matches")
  const shown: HelpTopic | undefined = useMemo(() => {
    if (searching && results.length) return results[0]!.topic;
    return TOPICS.find(t => t.id === sel) ?? TOPICS[0];
  }, [searching, results, sel]);

  // the article = the topic's TITLE as an h1 (manual.ts strips it into
  // metadata so the rail/links can use it) + the rendered body
  const doc = useMemo(() => (shown ? renderMarkdown(`# ${shown.title}\n\n${shown.body}`) : null),
    [shown]);
  useEffect(() => { artRef.current?.scrollTo({ top: 0 }); }, [shown?.id]);

  // the tool-dialog drag (pointer-captured, clamped INSIDE the backdrop)
  const headDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button,input')) return;
    const cur = drag ?? { x: 0, y: 0 };
    dragRef.current = { sx: e.clientX, sy: e.clientY, bx: cur.x, by: cur.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const headMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const el = boxRef.current, host = el?.parentElement as HTMLElement | null;
    let nx = d.bx + e.clientX - d.sx, ny = d.by + e.clientY - d.sy;
    if (el && host) {
      const hb = host.getBoundingClientRect(), db = el.getBoundingClientRect();
      const limX = Math.max(0, hb.width / 2 - db.width / 2);
      const limY = Math.max(0, hb.height / 2 - db.height / 2);
      nx = Math.min(limX, Math.max(-limX, nx));
      ny = Math.min(limY, Math.max(-limY, ny));
    }
    setDrag({ x: nx, y: ny });
  };
  const headUp = () => { dragRef.current = null; };

  return (
    // v1.11.1 (we: "Help should be fullscreen window on phone"): below md
    // the dialog FILLS the backdrop (rounded-none, no 86 dvh cap, no phone
    // clear-zone reserve — the ✕ sits in the title bar, nothing hides behind
    // a browser action row); ≥ md keeps the approved tool-dialog chrome
    // exactly (86 dvh cap, p-3, draggable).
    <div data-testid="help-backdrop"
      className="fixed inset-0 z-40 grid grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)]
                 place-items-center bg-black/60
                 p-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] md:p-3 md:pt-3 md:pb-3"
      onMouseDown={e => { if (e.target === e.currentTarget) p.onClose(); }}>
      <div ref={boxRef} data-testid="help-dialog" role="dialog" aria-label="Manual"
        className="ksp-win flex h-full w-full max-h-full max-w-none flex-col rounded-none px-3 py-2
                   md:h-auto md:max-h-[min(86dvh,100%)] md:w-[860px] md:max-w-[95vw] md:rounded-lg md:px-4 md:py-3"
        style={drag ? { transform: `translate(${drag.x}px, ${drag.y}px)` } : undefined}>
        {/* title bar = the drag handle */}
        <div data-testid="help-drag"
          className="ksp-label flex shrink-0 cursor-move touch-none select-none items-center gap-2
                     border-b border-white/10 pb-1.5 text-[12px] text-accent"
          onPointerDown={headDown} onPointerMove={headMove} onPointerUp={headUp} onPointerCancel={headUp}>
          <span className="text-[14px]">ⓘ</span> Manual — Archean Blueprint Inspector
          <button data-testid="help-close" onClick={p.onClose} aria-label="close"
            className="ksp-btn ml-auto rounded px-1.5 text-[11px] text-ink-dim hover:text-accent">✕</button>
        </div>

        {/* word search: every topic matches on title, tags AND body words */}
        <div className="flex shrink-0 items-center gap-2 pt-2">
          <input data-testid="help-search" value={query} onChange={e => setQuery(e.target.value)}
            placeholder="search topics — try: sphere, mirror, undo, lift, palette…"
            className="ksp-btn w-full rounded px-2 py-1 text-[12px] normal-case tracking-normal
                       text-ink placeholder:text-ink-dim/70 focus:outline-none" />
          <span data-testid="help-matchcount" className="shrink-0 text-[10px] tabular-nums text-ink-dim">
            {searching ? `${results.length}/${TOPICS.length}` : `${TOPICS.length} topics`}
          </span>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2 pt-2 md:flex-row">
          {/* topic rail — a horizontal chip row on phones, a column ≥ md */}
          <nav data-testid="help-rail"
            className="tool-scroll flex shrink-0 gap-1 overflow-x-auto md:w-40 md:flex-col md:overflow-y-auto md:pr-1">
            {results.length === 0 && searching && (
              <div data-testid="help-noresults" className="px-2 py-1 text-[11px] italic text-ink-dim">
                no topic matches “{query.trim()}”
              </div>
            )}
            {results.map(({ topic }) => (
              <button key={topic.id} data-testid={`help-topic-${topic.id}`}
                onClick={() => { setQuery(''); setSel(topic.id); }}
                className={`ksp-btn shrink-0 whitespace-nowrap rounded px-2 py-1 text-left text-[11px]
                            md:whitespace-normal ${!searching && topic.id === shown?.id ? 'on' : ''}`}>
                {topic.title}
              </button>
            ))}
          </nav>

          {/* the article: rendered markdown (headings, lists, HTML tables) */}
          <div ref={artRef} data-testid="help-article"
            className="tool-scroll manual min-h-0 flex-1 overflow-y-auto overscroll-contain rounded
                       border border-white/10 bg-black/25 px-3 py-2 md:px-4"
            style={{ scrollBehavior: 'smooth' }}
            dangerouslySetInnerHTML={{ __html: doc?.html ?? '' }} />
        </div>
      </div>
    </div>
  );
}
