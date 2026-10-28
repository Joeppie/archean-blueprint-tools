// isolation.spec.ts — THE ISOLATION-SW BOOT LAW on a PAGES-STYLE origin
// (v1.13.29). E2E-TIER because: a service worker's header forging lives
// ONLY in a real browser's navigation pipeline (fetch handlers,
// clients.claim, the crossOriginIsolated computation from response
// headers) — jsdom and vitest cannot state it; the pure decision is
// vitest-pinned in src/engine/__tests__/isolation.test.ts.
//
// The suite's vite-preview origin SENDS COOP/COEP (isolated from load one),
// so no existing spec can ever exercise the SW path. This spec serves its
// OWN plain-header static server: the built app/dist under a
// /archean-blueprint-tools/-style subpath + the repo's testdata/ and
// viewer/ plumbing — the tools/deploy_pages.py layout reproduced offline.
import { expect, test } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const PREFIX = '/archean-blueprint-tools';
const PORT = Number(process.env.ISO_PORT ?? 5231);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const DIST = path.resolve('dist');
const REPO = path.resolve('..');
const CEP = '3327182790'; // Cheap Exploration Plane (xenon.spec's fixture)

const TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.ico': 'image/x-icon', '.map': 'application/json',
  '.txt': 'text/plain', '.ini': 'text/plain', '.md': 'text/plain',
};

/** Pages-style static origin: NO COOP/COEP headers, no caching. Routes
 *  resolve the deploy_pages layout: build output at the site root FIRST,
 *  then the repo plumbing (testdata/, viewer/, assets/). */
function pagesStyleServer(): Server {
  return createServer((req, res) => {
    const url = (req.url ?? '').split('?')[0].split('#')[0];
    if (!url.startsWith(PREFIX + '/') && url !== PREFIX) {
      res.writeHead(404, { 'cache-control': 'no-store' });
      res.end('not found');
      return;
    }
    const rel = decodeURIComponent(url.slice(PREFIX.length));
    const p = path.normalize(path.join(DIST, rel));
    const cands = [p, path.normalize(path.join(REPO, rel))].map(
      (c) => (c.endsWith(path.sep) ? path.join(c, 'index.html') : c),
    );
    cands.push(path.join(p, 'index.html'));
    const file = cands.find((c) => existsSync(c) && statSync(c).isFile());
    if (!file) {
      res.writeHead(404, { 'cache-control': 'no-store' });
      res.end('not found');
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(readFileSync(file));
  });
}

test.describe('Isolation SW @ui', () => {
  test.skip(
    !existsSync(path.join(DIST, 'index.html')),
    'needs the built bundle (the webServer builds it; E2E_DEV runs skip)',
  );

  let server: Server;
  test.beforeAll(async () => {
    server = pagesStyleServer();
    await new Promise<void>((res) => server.listen(PORT, '127.0.0.1', res));
  });
  test.afterAll(() => server?.close());

  test('first visit forges isolation with one reload; the debugger unlocks worker mode; /viewer/ stays header-free @slow', async ({ page }) => {
    test.setTimeout(240_000);

    await test.step('first load: SW registers, the tab reloads ONCE, isolated', async () => {
      // the SW ritual is FAST: install → claim → reload can DESTROY the
      // evaluate context mid-poll (and abort goto's awaited load) — the
      // reload IS the law firing, so probes swallow the destroyed-context
      // error and the polls assert the settled state.
      await page.goto(`${ORIGIN}${PREFIX}/`).catch(() => undefined);
      const probe = <T>(fn: () => T): Promise<T | undefined> =>
        page.evaluate(fn).catch(() => undefined);
      // THE ONE-RELOAD LAW: the session flag is set before the reload, so
      // observing it proves the reload was the SW ritual, not a crash loop.
      await expect
        .poll(() => probe(() => sessionStorage.getItem('archean-isolation-sw')),
          { timeout: 30_000 })
        .toBe('1');
      await expect
        .poll(() => probe(() => window.crossOriginIsolated),
          { timeout: 30_000 })
        .toBe(true);
      // the SW controls the tab, scoped to the app's own directory
      const scope = await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        return reg?.scope ?? '';
      });
      expect(scope).toBe(`${ORIGIN}${PREFIX}/`);
    });

    await test.step('the debugger chip states worker · true line-stepping', async () => {
      await page.goto(`${ORIGIN}${PREFIX}/?craft=${CEP}`);
      // (no SCENE PASS here: the debug flag's storageState is pinned to the
      // suite's preview origin, not this one — the scene gate is the menu)
      const menu = page.getByTestId('xenon-menu');
      await expect(menu).toBeVisible({ timeout: 90_000 });
      await menu.click();
      // the Computer-menu banner: isolated origin ⇒ the emerald WORKER line
      await expect(page.getByTestId('xenon-sab-warn')).toContainText('true line-stepping');
      await page.locator('[data-testid^="xenon-comp-"]').first().click();
      await expect(page.getByTestId('xenon-on')).toHaveText('ON', { timeout: 90_000 });
      // the chip settles on worker mode once the wasm boots on the worker —
      // on this plain static server (no warm HTTP cache, fresh profile) the
      // open can outlast the 5 s default; a FALLBACK to main-thread would
      // flip the text and fail this same assert.
      await expect(page.getByTestId('xenon-mode'), { timeout: 60_000 })
        .toContainText('worker · true line-stepping');
    });

    await test.step('/viewer/ is header-free: NOT isolated, Three.js CDN loads', async () => {
      await page.goto(`${ORIGIN}${PREFIX}/viewer/index.html`);
      // The frozen inspector's navigation must NOT wear COEP: require-corp
      // would block its CDN Three.js (canvas = Three built and painted).
      expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(false);
      await expect(page).toHaveTitle(/Archean Blueprint Viewer/);
      await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30_000 });
    });
  });
});
