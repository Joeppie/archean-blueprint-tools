import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { shouldRegisterIsolationSw } from './engine/isolation'
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

// ISOLATION SW (v1.13.29): GitHub Pages can't send COOP/COEP response
// headers, so there crossOriginIsolated is false and the Xenon debugger's
// SAB gate (engine/xenoncode.ts sabSupported()) degrades to the main-thread
// cycle-granular pump. The ISOLATION FORGER (public/sw.js, ships at the
// site root via vite's public/ copy) forges the two headers on navigation
// responses — the documented self-isolation recipe (web.dev/coop-coep).
// The first non-isolated load of a tab registers it and reloads ONCE
// (sessionStorage one-shot: a SW that never activates cannot loop the tab);
// the second load is isolated and the EXISTING SAB gate unlocks worker
// mode with zero changes to the gate's fallback path. Every failure
// (insecure origin, CSP, offline) lands in .catch() — today's pump.
{
  const isoFlag = 'archean-isolation-sw';
  if (shouldRegisterIsolationSw({
    isolated: (self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated === true,
    flagged: sessionStorage.getItem(isoFlag) !== null,
    hasSW: 'serviceWorker' in navigator,
  })) {
    navigator.serviceWorker
      .register(
        new URL('sw.js', document.baseURI).href,
        // page-relative law (AGENTS § Publishing): scope = the app's own
        // directory, never a hardcoded repo URL path
        { scope: new URL('.', document.baseURI).href },
      )
      .then(() => navigator.serviceWorker.ready)
      .then(() => {
        sessionStorage.setItem(isoFlag, '1');   // flag BEFORE the reload
        location.reload();
      })
      .catch(() => { /* refused (e.g. plain-http LAN = insecure context):
                        the main-thread pump stays exactly as it is */ });
  }
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
