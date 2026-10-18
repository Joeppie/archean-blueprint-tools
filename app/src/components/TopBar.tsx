// TopBar.tsx — the KSP-VAB-style toolbar over the editor: a File menu
// (New / Open / Save + Save as + Close-to-gallery), a New-craft button, and
// the MODE tiles that split the workspace (icon + uppercase caption, like
// KSP's editor/tool buttons). Dark bevelled .ksp-btn chrome, blue glow on
// the active tile:
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
  /** File ▾ redownload: the ONLY user-forced network fetch for a cached craft */
  onRefresh?: () => void;
  children?: React.ReactNode;              // right side: panel toggle etc.
}

const MODES: [Mode, string, string][] = [
  ['view', '⌖', 'View'], ['edit', '✎', 'Edit'], ['blocks', '▦', 'Blocks'],
  ['wire', '∿', 'Wire'], ['flight', '➤', 'Flight'],
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
      <span className="ksp-label">{label}</span><span className="text-[10px] text-ink-dim">{key === 'save' ? 'Ctrl+S' : ''}</span>
    </button>
  );

  return (
    // mobile: the mode bar cannot share one row with File/Save/⚙ (it gets
    // crushed to a sliver by the shrink-0 siblings), so it wraps onto a
    // full-width second row; desktop keeps the single-row KSP chrome
    <header className="relative z-30 flex min-h-11 shrink-0 flex-wrap items-center gap-x-2 gap-y-1
                       border-b border-[rgba(217,212,189,.22)] bg-gradient-to-b from-panel to-panel2
                       px-2 py-1 md:flex-nowrap md:py-0">
      <button data-testid="back-to-gallery" onClick={p.onBack} title="back to space center (gallery)"
        className="ksp-btn shrink-0 px-2.5 py-1 text-[12px] hover:text-accent">
        ←
      </button>
      <div ref={menuRef} className="relative shrink-0">
        <button data-testid="file-menu" onClick={() => setFileOpen(o => !o)}
          className={`ksp-btn whitespace-nowrap px-2.5 py-1 text-[12px] ${fileOpen ? 'on' : ''}`}>
          File ▾
        </button>
        {fileOpen && (
          <div data-testid="file-dropdown"
            className="ksp-win absolute left-0 top-8 w-56 overflow-hidden rounded-md">
            {item('New craft', p.onNew, 'new')}
            {item('Open file…', p.onOpen, 'open')}
            <div className="my-1 border-t border-white/10" />
            {item(p.dirty ? '● Save (download)' : 'Save (download)', () => p.onSave(), 'save')}
            {item('Save as…', () => p.onSave('archean-craft.json'), 'saveas')}
            <div className="my-1 border-t border-white/10" />
            {p.onRefresh && item('Refresh craft (redownload)', p.onRefresh, 'refresh')}
            {item('Close → gallery', p.onClose, 'close')}
          </div>
        )}
      </div>
      <button data-testid="new-craft" onClick={p.onNew}
        className="ksp-btn hidden shrink-0 whitespace-nowrap px-2.5 py-1 text-[12px] hover:text-accent md:inline">
        + New craft
      </button>

      <nav data-testid="mode-bar" title="editor modes — KSP-style tool switch"
        className="order-last flex w-full justify-between gap-[3px] rounded-lg
                   border border-[rgba(217,212,189,.16)] bg-black/30 p-[3px]
                   md:order-none md:ml-1 md:w-auto md:max-w-[52vw] md:justify-start
                   md:shrink md:overflow-x-auto">
        {MODES.map(([m, ic, label]) => (
          <button key={m} data-testid={`mode-${m}`} onClick={() => p.onMode(m)}
            className={`ksp-btn flex flex-1 flex-col items-center rounded px-2 py-[2px] leading-tight
                        md:flex-none md:px-3 ${p.mode === m ? 'on' : ''}`}>
            <span className="text-[13px] leading-[15px]">{ic}</span>
            <span className="text-[9px]">{label}</span>
          </button>
        ))}
      </nav>

      {/* ship nameplate — the KSP vessel-name strip */}
      <span data-testid="editor-title"
        className="ksp-label ml-1 min-w-[64px] flex-1 truncate text-[13px] font-semibold tracking-[.12em] text-accent
                   md:ml-2 md:text-[14px]">
        {p.title}{p.dirty && <span className="text-gold"> ●</span>}
      </span>
      {p.craftId && /^\d{6,}$/.test(p.craftId) && p.craftId !== '0000000000' && p.craftId !== '9000000001' && (
        <a data-testid="wslink" title="Steam Workshop page"
          href={`https://steamcommunity.com/sharedfiles/filedetails/?id=${p.craftId}`}
          target="_blank" rel="noopener"
          className="ksp-btn hidden shrink-0 px-2 py-1 text-[11px] text-ink-dim md:block">workshop ↗</a>
      )}
      {p.children}
    </header>
  );
}
