import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// v1.12.2 BOOT COST: phase marks for tools/bootprobe.mjs (performance.mark is
// a no-op for users; the boot budget is a measured number now, not folklore).
performance.mark('boot:main');

// STALE-TAB SELF-HEAL (v1.13.11, after a redeploy broke a live tab's lazy
// XenonDialog import): a tab compiled against an OLD build asks for content-
// hashed chunks a redeploy no longer serves (deploys keep recent ones, see
// deploy_pages' append-only law — this covers tabs older than that window).
// Vite reports every failed dynamic import as `vite:preloadError`; the cure
// is the free one: reload ONCE, the fresh index.html rebakes the tab onto
// the current fingerprints. The sessionStorage flag keeps it one-shot, so a
// genuinely broken build can never loop into a reload storm.
{
  const heal = 'archean-chunk-healed';
  const fresh = sessionStorage.getItem(heal) === null;
  sessionStorage.removeItem(heal);            // this load starts unflagged
  addEventListener('vite:preloadError', (e) => {
    if (!fresh) return;                        // already healed this session
    e.preventDefault();
    sessionStorage.setItem(heal, '1');
    location.reload();
  });
}

declare global {
  interface Window {
    /** the Editor chunk RESOLVED before createRoot (deep-link boot path —
     *  see bootEditor below); App renders it without the lazy boundary */
    __EDITOR_MODULE__?: typeof import('./Editor');
  }
}

// v1.12.2 BOOT COST — DEEP-LINK FAST PATH: a fresh `?craft=` load (every
// e2e boot, every shared link, the user opening a craft in a new tab)
// awaits the EDITOR chunk and the model MANIFEST fetch BEFORE the root is
// created. Why: rendering the lazy Editor through Suspense is a normal-
// priority React update = a TIME-SLICED concurrent render — the bootprobe
// profile measured render1 → commit spread over ~250 ms of amortised idle
// (many 5-ms slices) on the e2e stack. createRoot's INITIAL mount flushes
// synchronously instead: the same JS in one burst, no slice amortisation,
// and the 107 kB manifest is already in flight (its fetch starts beside
// the chunk import, long before the engine asks for it). The gallery path
// (no ?craft) is untouched: it stays the light index chunk.
const bootEditor = async () => {
  const q = new URLSearchParams(location.search);
  if (!q.get('craft')) return;
  void import('./engine/models').then(m => m.loadManifest()).catch(() => { /* atlas retries per use */ });
  window.__EDITOR_MODULE__ = await import('./Editor');
};

void bootEditor().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
