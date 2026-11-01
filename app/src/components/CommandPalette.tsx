// CommandPalette.tsx — THE SEARCHABLE COMMAND INDEX (v1.17.2, we: "There
// should be a menu item somewhere for each button, and it should be
// correctly organized, and searchable, findable. even for the main
// editor, at top level"). One box, every command of the editor: modes,
// view toggles, windows/docks, tools, computers/HUDs, resets. Open with
// Ctrl/Cmd+K or the 🔍 in the top bar; type to filter (label, hint,
// group); ↑↓ + Enter runs; Esc closes. The palette is the findability
// layer — the menus stay the organized browse layer.
import { useEffect, useMemo, useRef, useState } from 'react';

export interface Command {
  id: string;
  label: string;
  hint?: string;
  group: string;
  run: () => void;
}

const GROUP_ORDER = ['Modes', 'View', 'Panels & docks', 'Tools', 'Computers & HUDs',
  'Craft', 'File', 'Reset'];

export default function CommandPalette(p: { commands: Command[]; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement | null>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const items = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = p.commands.filter(c => !s
      || c.label.toLowerCase().includes(s)
      || (c.hint ?? '').toLowerCase().includes(s)
      || c.group.toLowerCase().includes(s));
    return [...list].sort((a, b) => {
      const ga = GROUP_ORDER.indexOf(a.group), gb = GROUP_ORDER.indexOf(b.group);
      return (ga < 0 ? 99 : ga) - (gb < 0 ? 99 : gb);
    });
  }, [q, p.commands]);
  const run = (c: Command | undefined) => { if (!c) return; p.onClose(); c.run(); };
  return (
    <div className="fixed inset-0 z-[120] bg-black/60" onClick={p.onClose}
      data-testid="palette-scrim">
      <div className="absolute left-1/2 top-[10%] w-[min(560px,92vw)] -translate-x-1/2 overflow-hidden
                     rounded-xl border border-[#3a4a6a] bg-[#10141f] shadow-2xl"
        onClick={e => e.stopPropagation()}>
        <input ref={input} data-testid="palette-input" value={q}
          placeholder="search commands — modes, toggles, panels, tools, computers, resets…"
          className="w-full border-b border-[#2b313b] bg-[#0b0f18] px-3 py-2.5 text-[13px] outline-none"
          onChange={e => { setQ(e.target.value); setSel(0); }}
          onKeyDown={e => {
            if (e.key === 'Escape') { e.stopPropagation(); p.onClose(); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, items.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)); }
            else if (e.key === 'Enter') { e.preventDefault(); run(items[sel]); }
          }} />
        <div className="max-h-[56vh] overflow-y-auto p-1.5" data-testid="palette-list">
          {items.length === 0 && (
            <div className="px-3 py-4 text-center text-[11px] text-[#5d6a7d]">no command matches “{q}”</div>
          )}
          {items.map((c, i) => (
            <div key={c.id}>
              {i > 0 && items[i - 1]?.group !== c.group && (
                <div className="px-2 pt-2 text-[9px] uppercase tracking-widest text-[#5d6a7d]">{c.group}</div>
              )}
              {i === 0 && (
                <div className="px-2 pt-1 text-[9px] uppercase tracking-widest text-[#5d6a7d]">{c.group}</div>
              )}
              <button data-testid="palette-item"
                className={`flex w-full items-baseline gap-2 rounded px-2 py-1.5 text-left text-[12px] ${
                  i === sel ? 'bg-[#1d2b42] text-[#8fd4ff]' : 'text-[#c8d4e4] hover:bg-[#182236]'}`}
                onMouseEnter={() => setSel(i)}
                onClick={() => run(c)}>
                <span>{c.label}</span>
                {c.hint && <span className="ml-auto shrink-0 text-[10px] text-[#5d6a7d]">{c.hint}</span>}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
