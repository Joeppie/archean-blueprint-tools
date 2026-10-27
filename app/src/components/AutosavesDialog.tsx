// AutosavesDialog.tsx — File ▸ Autosaves (v1.13.x: "autosaves should show
// for the various craft, with timestamp behind it"). Every shadow copy the
// viewer kept, newest first: timestamp · craft · size, with Restore and ✕.
// Restoring routes through the Editor's open funnel (the shadow text IS a
// save-quality doc text), so nothing is half-applied.
import { useEffect, useState } from 'react';
import { autosaveTime, deleteAutosave, listAutosaves, type Autosave } from '../engine/autosave';

export default function AutosavesDialog(p: {
  currentKey: string;
  onRestore: (a: Autosave) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<Autosave[] | null>(null);
  useEffect(() => {
    let dead = false;
    void listAutosaves().then(r => { if (!dead) setRows(r); });
    return () => { dead = true; };
  }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') p.onClose(); };
    addEventListener('keydown', h);
    return () => removeEventListener('keydown', h);
  }, [p]);

  return (
    <div data-testid="autosaves-dialog" className="fixed inset-0 z-40 grid place-items-center
           bg-black/60 p-2" onMouseDown={e => { if (e.target === e.currentTarget) p.onClose(); }}>
      <div className="flex max-h-[80dvh] w-[min(720px,94vw)] flex-col overflow-hidden rounded-lg
             border border-[#3a4a6a] bg-[#10141f]/[.97] text-[13px] text-[#d6dbe1] shadow-2xl">
        <div className="flex items-center justify-between bg-[#1a2436] px-3 py-1.5">
          <span className="font-bold">Autosaves — shadow copies of your crafts</span>
          <button data-testid="autosaves-close" className="text-[#8a93a0] hover:text-white"
            onClick={p.onClose} aria-label="close">✕</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <div className="mb-2 text-[11px] text-[#5d6a7d]">
            The viewer shadows each edited craft every ~20 s while you work
            (and on every save) — forget to save and the latest state is
            here. Restoring opens the shadow copy as the working doc;
            downloads and the workshop copy are untouched until you save.
          </div>
          {rows === null && <div className="text-[#5d6a7d]">reading…</div>}
          {rows?.length === 0 && (
            <div className="text-[#5d6a7d]">no autosaves yet — they appear once you edit a craft.</div>
          )}
          <div className="grid gap-1">
            {rows?.map(a => (
              <div key={a.id} data-testid={`autosave-row-${a.id}`}
                className={`flex items-center gap-3 rounded border px-2 py-1 text-[12px]
                       ${a.key === p.currentKey ? 'border-[#3a5a8a] bg-[#152036]' : 'border-[#232c3d] bg-[#131a28]'}`}>
                <span className="w-[130px] shrink-0 tabular-nums text-[#8fd4ff]">{autosaveTime(a.ts)}</span>
                <span className="min-w-0 flex-1 truncate" title={a.label}>{a.label}</span>
                <span className="shrink-0 tabular-nums text-[#5d6a7d]">{(a.bytes / 1024).toFixed(1)} kB</span>
                <button data-testid={`autosave-restore-${a.id}`}
                  className="shrink-0 rounded bg-[#2b4a2b] px-2 py-0.5 text-[11px] hover:bg-[#38603a]"
                  onClick={() => p.onRestore(a)}>↥ restore</button>
                <button data-testid={`autosave-del-${a.id}`}
                  className="shrink-0 rounded bg-[#33202a] px-2 py-0.5 text-[11px] text-[#e0a0a0]
                         hover:bg-[#4a2836]"
                  onClick={() => void deleteAutosave(a.id).then(() =>
                    setRows(r => (r ?? []).filter(x => x.id !== a.id)))}>✕</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
