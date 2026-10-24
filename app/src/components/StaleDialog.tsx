// StaleDialog.tsx — the versioned-cache OPEN GATE (v1.9.5). The catalog says
// the cached copy of this craft is NOT provably current ('stale' — the file
// was edited after caching — or 'unknown' — a legacy v1 / unverified copy).
// The rule this window enforces: nothing is used or replaced WITHOUT the
// user's choice, so the editor shows this instead of silently opening either
// copy. Two doors, one line of meaning, the same ksp-win chrome as the
// download overlay; File ▸ 'Refresh craft (redownload)' stays the manual
// escape hatch once the craft is open.
import type { CacheInfo, CraftState } from '../crafts';
import type { CraftMeta } from '../gallery-catalog';

const fmtDate = (ms?: number) =>
  ms && ms > 0 ? new Date(ms).toISOString().slice(0, 10) : 'unknown';

export default function StaleDialog(p: {
  name: string; state: CraftState; cached: CacheInfo | null; meta?: CraftMeta;
  onDownload: () => void; onCached: () => void }) {
  const stale = p.state === 'stale';
  return (
    <div data-testid="stale-open-dialog"
      className="absolute inset-0 z-50 grid place-items-center bg-black/50">
      <div className="ksp-win w-[400px] max-w-[88vw] rounded-lg px-4 py-4">
        <div className={`ksp-label mb-1 text-[12px] ${stale ? 'text-amber-400' : 'text-sky-300'}`}>
          {stale ? '\u26a0 Edited since cached' : '\u26a0 Cached copy unversioned'}
        </div>
        <div className="truncate text-[13px] font-semibold text-ink">{p.name}</div>
        {/* what the state MEANS, in one line — plus both dates for 'stale' */}
        <p className="mt-2 text-[11px] leading-snug text-ink-dim">
          {stale
            ? <>The blueprint folder holds a NEWER file than our cached copy — cached {fmtDate(p.cached?.saved)} · file changed {fmtDate(p.meta?.mtime)}. Nothing is used or replaced without your choice.</>
            : <>This cached copy carries no version stamp (saved {fmtDate(p.cached?.saved)} — an older cache entry or an unverified download), so it cannot be proven current. Nothing is used or replaced without your choice.</>}
        </p>
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <button data-testid="stale-usecached" onClick={p.onCached}
            className="ksp-btn px-3 py-1 text-[12px] text-ink-dim hover:text-ink">
            Open cached copy
          </button>
          <button data-testid="stale-download" onClick={p.onDownload}
            className="ksp-btn on px-3 py-1 text-[12px] font-semibold">
            Download latest
          </button>
        </div>
      </div>
    </div>
  );
}
