// ui.tsx — the shared GUI kit: one place for the sidebar primitives the
// panels compose (section shells, committed number fields, searchable
// pick-lists). Logic lives OUTSIDE these components — they are dumb views
// over callbacks, so every mode panel stays independently testable.
import { useMemo, useState } from 'react';

/** v1.11 MIRROR GLYPH (we: "the mirror option is not understandable, it
 *  should be visually understood, add a mirror icon with a strikethrough,
 *  and x y z also with mirror behind it"): a dashed MIRROR PLANE with a
 *  solid triangle on one side and its reflected ghost on the other — the
 *  whole mirror rule in one mark. `strike` adds the red diagonal (mirroring
 *  OFF). In the dock's axis chips the glyph sits BEHIND the axis letter
 *  (see the mirw-* buttons in Editor.tsx). currentColor keeps it theme
 *  honest: a lit chip (gold text) lights the glyph. */
export function MirrorGlyph(p: { strike?: boolean; size?: number }) {
  const s = p.size ?? 16;
  return (
    <svg data-g={p.strike ? 'mirror-off' : 'mirror'} width={s} height={s} viewBox="0 0 16 16"
      className="inline-block align-middle" aria-hidden="true">
      <line x1="8" y1="1" x2="8" y2="15" stroke="currentColor" strokeWidth="1"
        strokeDasharray="2.2 2" opacity="0.75" />
      <path d="M2.2 12.4 L6.8 12.4 L4.5 3.6 Z" fill="currentColor" />
      <path d="M13.8 12.4 L9.2 12.4 L11.5 3.6 Z" fill="none" stroke="currentColor"
        strokeWidth="1" opacity="0.45" />
      {p.strike && (
        <line data-g="mirror-strike" x1="1.4" y1="14" x2="14.6" y2="2" stroke="#ff6b6b"
          strokeWidth="1.8" strokeLinecap="round" />
      )}
    </svg>
  );
}

export const Sec = (p: { title: string; children?: React.ReactNode; testid?: string }) => (
  <section className="border-t border-white/10 px-3 py-2" data-testid={p.testid}>
    <h3 className="ksp-label mb-1 text-[11px] font-semibold text-ink-dim">{p.title}</h3>
    {p.children}
  </section>
);

export function Num(p: { label: string; value: number; min: number; max: number;
  disabled?: boolean; testid?: string; onCommit: (v: number) => void }) {
  const [v, setV] = useState(String(p.value));
  // v1.10.6: EXTERNAL commits (the dock's keyboard brush resize, twin
  // mirrors, undo) must repaint the field — the local string stays while it
  // already carries the same number, so typing "3." / "-" mid-keystroke is
  // never yanked (the v0.149 row().set() lesson: a control that shows a
  // stale value is a dead button the user cannot trust). Render-phase
  // adjustment (React's derived-state idiom), not an effect.
  const [last, setLast] = useState(p.value);
  if (last !== p.value) {
    setLast(p.value);
    setV(s => (+s === p.value && s.trim() !== '' ? s : String(p.value)));
  }
  return (
    <label className="flex items-center gap-1.5 py-[2px] text-[11px]">
      <span className="w-[62px] shrink-0 text-ink-dim">{p.label}</span>
      <input type="number" value={v} min={p.min} max={p.max} disabled={p.disabled}
        data-testid={p.testid ?? `num-${p.label}`}
        className="w-[60px] rounded border border-white/10 bg-panel2 px-1 py-[1px] text-ink"
        onChange={e => { setV(e.target.value); const n = +e.target.value;
          if (e.target.value !== '' && isFinite(n)) p.onCommit(Math.max(p.min, Math.min(p.max, n))); }} />
    </label>
  );
}

export interface ListEntry { id: string; label: string; sub?: string; disabled?: boolean }

/** Searchable pick-list: entries + a query box, one onTap per row.
 *  onHover(id|null) fires as rows are entered / the list left — wire mode
 *  uses it to PREVIEW the candidate part in the 3D view (the selection the
 *  user is editing stays untouched; leaving restores it visually). */
export function SearchList(p: { entries: ListEntry[]; placeholder?: string; testid: string;
  onPick: (id: string) => void; onHover?: (id: string | null) => void }) {
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return p.entries.filter(e => !needle || e.label.toLowerCase().includes(needle)
      || (e.sub ?? '').toLowerCase().includes(needle)).slice(0, 40);
  }, [p.entries, q]);
  return (
    <div>
      <input value={q} placeholder={p.placeholder ?? 'search\u2026'} data-testid={`${p.testid}-search`}
        onChange={e => setQ(e.target.value)}
        className="mb-1 w-full rounded border border-white/10 bg-panel2 px-2 py-1 text-[12px] text-ink placeholder:text-ink-dim/60" />
      <div className="max-h-56 space-y-[2px] overflow-y-auto"
        onMouseLeave={() => p.onHover?.(null)}>
        {shown.map(e => (
          <button key={e.id} data-testid={`${p.testid}-item`} disabled={e.disabled}
            className="block w-full truncate rounded bg-panel2 px-2 py-[3px] text-left text-[11px] text-ink
                       hover:bg-white/10 disabled:opacity-40"
            onMouseEnter={() => p.onHover?.(e.id)}
            onClick={() => p.onPick(e.id)}>
            {e.label}{e.sub && <span className="ml-2 text-[10px] text-ink-dim">{e.sub}</span>}
          </button>
        ))}
        {!shown.length && <div className="px-1 text-[11px] text-ink-dim">no matches</div>}
      </div>
    </div>
  );
}
