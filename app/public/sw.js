/* sw.js — THE ISOLATION FORGER (v1.13.29) — ships at the SITE ROOT: vite
* copies app/public/ verbatim into dist/, and tools/deploy_pages.py puts
* dist AT the Pages site root, so this file lives beside index.html.
*
* WHY: GitHub Pages cannot send response headers, so there
* window.crossOriginIsolated is false and the Xenon debugger's SAB gate
* (app/src/engine/xenoncode.ts sabSupported()) degrades worker mode to the
* main-thread cycle-granular pump. A service worker CAN rewrite the two
* headers on navigation RESPONSES — the documented self-isolation recipe
* (web.dev/coop-coep): app/src/main.tsx registers this worker on the first
* non-isolated visit and reloads ONCE; the second load is isolated and the
* existing SAB gate unlocks worker mode with zero further changes.
*
* THE WHY BEHIND THE GATE: SharedArrayBuffer is withheld unless the site
* self-certifies isolation via COOP+COEP because Spectre-style timing
* attacks read across co-resident cross-origin documents — HTTPS
* authenticates BYTES, not CO-RESIDENCE; the isolation flags, not TLS,
* are what makes shared memory safe to hand out.
*
* PURE PASSTHROUGH: zero caching (no interplay with deploy_pages'
* append-only cache-bust law — the network is the only source). /viewer/ is
* HEADER-FREE: the frozen inspector loads Three.js from a CDN and
* require-corp kills cross-origin subresources without CORP. Non-GET,
* failed and non-basic responses pass untouched. Every
* failure path (insecure origin, CSP, offline) leaves the register()
* promise in main.tsx rejecting → today's main-thread pump: this file can
* only ever ADD isolation, never remove behaviour.
*
* WHICH RESPONSES (the web.dev self-isolation recipe, proven by the
* e2e/isolation.spec.ts probe): a COEP document ENFORCES COEP on its
* subresources, and a module-worker script served in an SW-controlled
* context is CORP-checked — forging ONLY on the navigation boots the page
* isolated but then `net::ERR_BLOCKED_BY_RESPONSE` kills the xenonworker
* chunk (the chip sticks at 'worker starting…', ABI 0, open-timeout). So:
* navigations get COOP + COEP + CORP; same-origin GETs get COEP + CORP;
* cross-origin subresources (none on the app pages; the CDN loads under
* the header-free /viewer/) stay untouched.
*/
'use strict';

const COOP = 'Cross-Origin-Opener-Policy';
const COEP = 'Cross-Origin-Embedder-Policy';
const CORP = 'Cross-Origin-Resource-Policy';

// Header-free paths under the scope — page-relative law (AGENTS §
// Publishing): the SW sits at the site root, so './viewer/' resolves to
// the frozen inspector in EVERY deploy layout, no repo URL path baked in.
// The exclusion covers the /viewer/ document AND its subresources.
const HEADER_FREE = [new URL('viewer/', self.location).pathname];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (HEADER_FREE.some((p) => url.pathname.startsWith(p))) return;
  const nav = req.mode === 'navigate';
  // Cross-origin subresources: the app pages load NONE (three.js is
  // bundled; the CDN lives under the header-free /viewer/) — hand them
  // back verbatim, their CORP is the issuer's business.
  if (!nav && url.origin !== self.location.origin) return;
  e.respondWith(forge(req, nav));
});

async function forge(req, nav) {
  const res = await fetch(req); // the network is the only source: no cache
  if (!res.ok || res.type !== 'basic') return res; // 404s / opaqued pass on
  const headers = new Headers(res.headers);
  if (nav) headers.set(COOP, 'same-origin'); // documents only: the flag setter
  headers.set(COEP, 'require-corp');
  headers.set(CORP, 'same-origin'); // the COEP-enforced subresources need it
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}
