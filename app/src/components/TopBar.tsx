// TopBar.tsx — the desktop-app chrome on top of the editor: a File menu
// (New / Open / Save + Save as + Close-to-gallery), a New-craft button, and
// the MODE segments that split the workspace:
//   View   — inspect only (no gizmo, no writes)
//   Edit   — component editing: gizmo, sliders, data rows
//   Blocks — block placement / resizing / deletion
//   Wire   — the port graph: census, naive auto-wiring, warnings
//   Flight — flight analysis (mass/CoM, thrust nets, control surfaces)
import { useEffect, useRef, useState } from 'react';

export type Mode = 'view' | 'edit' | 'blocks' | 'wire' | 'flight';

interface Props {
  mode: Mode;
  onMode: (m: Mode) => void;
  dirty: boolean;
  title: string;
  craftId: string | null;
  onNew: () => void;
  onOpen: () => void;
  onSave: (as?: string) => void;
  onClose: () => void;
  onBack: () => void;
  children?: React.ReactNode;              // right side: panel toggle etc.
}

const MODES: [Mode, string][] = [
  ['view', 'View'], ['edit', 'Edit'], ['blocks', 'Blocks'], ['wire', 'Wire'], ['flight', 'Flight'],
];

export default function TopBar(p: Props) {
  const [fileOpen, setFileOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!fileOpen) return;
    const off = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setFileOpen(false); };
    addEventListener('mousedown', off);
    return () => removeEventListener('mousedown', off);
  }, [fileOpen]);

  const item = (label: string, act: () => void, key?: string) => (
    <button data-testid={`file-${key ?? label}`}
      className="flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-[12px] text-ink hover:bg-white/10"
      onClick={() => { setFileOpen(false); act(); }}>
      {label}<span className="text-[10px] text-ink-dim">{key === 'save' ? 'Ctrl+S' : ''}</span>
    </button>
  );

  return (
    // mobile: the mode bar cannot share one row with File/Save/⚙ (it used to
    // be crushed to a sliver by the shrink-0 siblings), so it wraps onto a
    // full-width second row; desktop keeps the single-row chrome
    <header className="relative z-30 flex min-h-11 shrink-0 flex-wrap items-center gap-x-2 gap-y-1
                       border-b border-white/10 bg-panel px-2 py-1 md:flex-nowrap md:py-0">
      <button data-testid="back-to-gallery" onClick={p.onBack} title="back to gallery"
        className="shrink-0 rounded bg-panel2 px-2.5 py-1 text-[12px] text-ink hover:bg-white/10 hover:text-accent">
        ←
      </button>
      <div ref={menuRef} className="relative shrink-0">
        <button data-testid="file-menu" onClick={() => setFileOpen(o => !o)}
          className={`whitespace-nowrap rounded px-2.5 py-1 text-[12px] ${fileOpen ? 'bg-white/10 text-ink' : 'bg-panel2 text-ink hover:bg-white/10'}`}>
          File ▾
        </button>
        {fileOpen && (
          <div data-testid="file-dropdown"
            className="absolute left-0 top-8 w-56 overflow-hidden rounded-md border border-white/15 bg-panel shadow-2xl">
            {item('New craft', p.onNew, 'new')}
            {item('Open file…', p.onOpen, 'open')}
            <div className="my-1 border-t border-white/10" />
            {item(p.dirty ? '● Save (download)' : 'Save (download)', () => p.onSave(), 'save')}
            {item('Save as…', () => p.onSave('archean-craft.json'), 'saveas')}
            <div className="my-1 border-t border-white/10" />
            {item('Close → gallery', p.onClose, 'close')}
          </div>
        )}
      </div>
      <button data-testid="new-craft" onClick={p.onNew}
        className="hidden shrink-0 whitespace-nowrap rounded bg-panel2 px-2.5 py-1 text-[12px] text-ink hover:bg-white/10 hover:text-accent md:inline">
        + New craft
      </button>

      <nav data-testid="mode-bar"
        className="order-last flex w-full justify-between gap-[2px] rounded-lg border border-white/10
                   bg-panel2 p-[2px] md:order-none md:ml-1 md:w-auto md:max-w-[46vw] md:justify-start
                   md:shrink md:overflow-x-auto">
        {MODES.map(([m, label]) => (
          <button key={m} data-testid={`mode-${m}`} onClick={() => p.onMode(m)}
            className={`flex-1 whitespace-nowrap rounded-md px-2.5 py-1.5 text-center text-[12px]
                       md:flex-none md:px-3 md:py-1 ${
              p.mode === m ? 'bg-accent font-semibold text-black' : 'text-ink-dim hover:text-ink'}`}>
            {label}
          </button>
        ))}
      </nav>

      <span data-testid="editor-title"
        className="ml-1 min-w-[64px] flex-1 truncate text-[13px] font-semibold text-accent md:ml-2">
        {p.title}{p.dirty && <span className="text-gold"> ●</span>}
      </span>
      {p.craftId && /^\d{6,}$/.test(p.craftId) && p.craftId !== '0000000000' && p.craftId !== '9000000001' && (
        <a data-testid="wslink" title="Steam Workshop page"
          href={`https://steamcommunity.com/sharedfiles/filedetails/?id=${p.craftId}`}
          target="_blank" rel="noopener"
          className="hidden shrink-0 rounded bg-panel2 px-2 py-1 text-[11px] text-ink-dim hover:text-accent md:block">workshop ↗</a>
      )}
      {p.children}
    </header>
  );
}
