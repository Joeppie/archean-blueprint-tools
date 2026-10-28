// ---------------------------------------------------------------------------
// THE ISOLATION-SW BOOT LAW (v1.13.29) — the PURE decision behind main.tsx's
// boot section. GitHub Pages cannot send COOP/COEP headers, so there
// crossOriginIsolated is false and the SAB gate (engine/xenoncode.ts
// sabSupported()) degrades the Xenon debugger to the main-thread cycle-
// granular pump. app/public/sw.js (THE ISOLATION FORGER) restores worker
// mode by adding the two headers to navigation responses — registered and
// answered with exactly ONE reload per tab:
//
//   register ⇔ NOT isolated (nothing to gain where the dev/preview server
//   already sends the headers) AND the tab's one-shot sessionStorage flag
//   is UNSET (a SW that never activates must never loop the reload) AND
//   the browser has service workers at all.
//
// Plain-http LAN origins HAVE navigator.serviceWorker, so register() runs
// and REJECTS (insecure context) — main.tsx's .catch() degrades that path
// to today's pump; the decision here is deliberately origin-agnostic.
// ---------------------------------------------------------------------------
export interface SwBootState {
  /** window.crossOriginIsolated on THIS load */
  isolated: boolean;
  /** this tab already did the register-and-reload ritual (session flag) */
  flagged: boolean;
  /** 'serviceWorker' in navigator */
  hasSW: boolean;
}

export function shouldRegisterIsolationSw(s: SwBootState): boolean {
  return !s.isolated && !s.flagged && s.hasSW;
}
