// TopBar.tsx — the KSP-VAB-style toolbar over the editor: the MENUS (File ▾,
// Edit ▾, Tools ▾), a New-craft button, and the MODE tiles that split the
// workspace (icon + uppercase caption, like KSP's editor/tool buttons). Dark
// bevelled .ksp-btn chrome, blue glow on the active tile:
//   View   — inspect ONLY: the vessel amounts/census panel; canvas clicks
//            select nothing (v1.5 — selection belongs to the Edit flavor)
//   Edit   — component editing: gizmo, sliders, data rows
//   Blocks — block placement / resizing / deletion
//   Wire   — the port graph: census, naive auto-wiring, warnings
//   Flight — flight analysis (mass/CoM, thrust nets, control surfaces)
// The Edit menu is the HOME of the two user-declared TODOs (v1.7): the undo
// stack and the vessel-information section (author / name / abbreviation) —
// listed DISABLED so the roadmap is visible in the UI, wired in the Editor.
import { useEffect, useRef, useState } from 'react';

export type Mode = 'view' | 'edit' | 'blocks' | 'wire' | 'flight' | 'aero';

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
  /** Tools ▾ entries (the ToolDialog registry in ToolsDialog.tsx) */
  tools?: { id: string; label: string; icon: string }[];
  onTool?: (id: string) => void;
  children?: React.ReactNode;              // right side: panel toggle etc.
}

const MODES: [Mode, string, string][] = [
  ['view', '⌖', 'View'], ['edit', '✎', 'Edit'], ['blocks', '▦', 'Blocks'],
  ['wire', '∿', 'Wire'], ['flight', '➤', 'Flight'], ['aero', '≋', 'Wind'],
];

/** One top menu: the button + a dropdown, closed by an outside mousedown. */
function Menu(p: { testid: string; label: string; width?: string;
  children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    addEventListener('mousedown', off);
    return () => removeEventListener('mousedown', off);
  }, [open]);
  return (
    <div ref={ref} className="relative shrink-0">
      <button data-testid={`${p.testid}-menu`} onClick={() => setOpen(o => !o)}
        className={`ksp-btn whitespace-nowrap px-2.5 py-1 text-[12px] ${open ? 'on' : ''}`}>
        {p.label}
      </button>
      {open && (
        <div data-testid={`${p.testid}-dropdown`}
          className={`ksp-win absolute left-0 top-8 overflow-hidden rounded-md ${p.width ?? 'w-56'}`}>
          {p.children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

const Item = (p: { testid: string; label: string; hint?: string; disabled?: boolean;
  on?: boolean; onClick: () => void }) => (
  <button data-testid={p.testid} disabled={p.disabled}
    className={`flex w-full items-center justify-between gap-4 px-3 py-1.5 text-left text-[12px]
               ${p.disabled ? 'cursor-default text-ink-dim/60' : 'text-ink hover:bg-white/10'}
               ${p.on ? 'text-accent' : ''}`}
    onClick={() => { if (!p.disabled) p.onClick(); }}>
    <span className="ksp-label">{p.label}</span>
    {p.hint && <span className="text-[10px] text-ink-dim">{p.hint}</span>}
  </button>
);

const Sep = () => <div className="my-1 border-t border-white/10" />;

export default function TopBar(p: Props) {
  return (
    // mobile: the mode bar cannot share one row with File/Edit/Tools/Save/⚙
    // (it gets crushed to a sliver by the shrink-0 siblings), so it wraps onto
    // a full-width second row; desktop keeps the single-row KSP chrome
    <header className="relative z-30 flex min-h-11 shrink-0 flex-wrap items-center gap-x-2 gap-y-1
                       border-b border-[rgba(217,212,189,.22)] bg-gradient-to-b from-panel to-panel2
                       px-2 py-1 md:flex-nowrap md:py-0">
      <button data-testid="back-to-gallery" onClick={p.onBack} title="back to space center (gallery)"
        className="ksp-btn shrink-0 px-2.5 py-1 text-[12px] hover:text-accent">
        ←
      </button>

      <Menu testid="file" label="File ▾">
        {close => (<>
          <Item testid="file-new" label="New craft" onClick={() => { close(); p.onNew(); }} />
          <Item testid="file-open" label="Open file…" onClick={() => { close(); p.onOpen(); }} />
          <Sep />
          <Item testid="file-save" label={p.dirty ? '● Save (download)' : 'Save (download)'}
            hint="Ctrl+S" onClick={() => { close(); p.onSave(); }} />
          <Item testid="file-saveas" label="Save as…" onClick={() => { close(); p.onSave('archean-craft.json'); }} />
          <Sep />
          {p.onRefresh && <Item testid="file-refresh" label="Refresh craft (redownload)"
            onClick={() => { close(); p.onRefresh?.(); }} />}
          <Item testid="file-close" label="Close → gallery" onClick={() => { close(); p.onClose(); }} />
        </>)}
      </Menu>

      <Menu testid="edit" label="Edit ▾">
        {() => (<>
          <Item testid="edit-undo" label="Undo" hint="todo — not wired yet" disabled
            onClick={() => undefined} />
          <Sep />
          <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-ink-dim">Vessel information</div>
          <Item testid="edit-vessel-name" label="Name…" hint="todo" disabled onClick={() => undefined} />
          <Item testid="edit-vessel-author" label="Author…" hint="todo" disabled onClick={() => undefined} />
          <Item testid="edit-vessel-code" label="Abbreviation / plate…" hint="todo" disabled
            onClick={() => undefined} />
        </>)}
      </Menu>

      {(p.tools?.length ?? 0) > 0 && (
        <Menu testid="tools" label="Tools ▾">
          {close => (<>
            {p.tools!.map(t => (
              <Item key={t.id} testid={`tool-${t.id}`} label={`${t.icon}  ${t.label}`}
                onClick={() => { close(); p.onTool?.(t.id); }} />
            ))}
            <Sep />
            <div className="px-3 py-1.5 text-[10px] text-ink-dim">more tools to follow</div>
          </>)}
        </Menu>
      )}

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
