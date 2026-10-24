// gallery.test.ts — the compiled catalog (virtual:gallery) rules. The user
// report (2026-10-19): the app gallery showed the INDIVIDUAL COMPONENT TEST
// CASES (matrix fixtures 90000010NN/90000020NN written into the Steam corpus
// folder) and missed most workshop items, because it scanned ONLY the
// configured corpus — a machine's client/blueprints dir holds just the craft
// touched in-game. The catalog is now the corpus ∪ testdata fixture floor
// minus fixtures/excludes, with make_landing.py's name tiers + numeric skip:
// the SAME workshop catalog as the landing page.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { craftFile, galleryData } from '../../../tools/vite-corpus.ts';

const G = galleryData();
const byId = new Map(G.map(g => [g.id, g]));

describe('compiled gallery catalog', () => {
  it('is substantial (the landing-scale workshop catalog, not a stub)', () => {
    expect(G.length).toBeGreaterThanOrEqual(50);
  });
  it('never lists synthetic/matrix fixtures', () => {
    for (const g of G) expect(g.id).not.toMatch(/^900000\d{4}$/);
    expect(byId.has('9000000001')).toBe(false);
    expect(byId.has('9000001001')).toBe(false);
    expect(byId.has('9000002001')).toBe(false);
  });
  it('applies the landing exclusions', () => {
    // the 2026-10-24 trio (dolphin / Sprite-500 / Cede) stay in testdata/ as
    // regtest + e2e FIXTURES — hidden from the gallery only, deep links and
    // /corpus routes still resolve them (craftFile is not EXCLUDE-gated)
    for (const id of ['3384910875', '3334593406', '3347018068', '3334591920',
      '3417786605', '3404843025', '3348400160']) {
      expect(byId.has(id), id).toBe(false);
    }
    expect(existsSync(craftFile('3417786605')), 'hidden ≠ gone: the fixture still resolves').toBe(true);
  });
  it('lists the corpus workshop crafts OUTSIDE the machine corpus too', () => {
    // the fixture floor: a Steam client/blueprints folder carries only a
    // subset — testdata crafts must appear regardless of the conf
    for (const id of ['3327182790', '3816936540', '3481322297', '3803780241']) {
      expect(byId.has(id), id).toBe(true);
    }
  });
  it('resolves real names (workshop.json / curated table), never ids', () => {
    expect(byId.get('3327182790')!.name).toBe('Cheap Exploration Plane');
    expect(byId.get('3481322297')!.name).toMatch(/truck|semi/i);
    for (const g of G) {
      expect(g.name).not.toBe(`Workshop ${g.id}`);
      expect(g.name).toMatch(/\D/);            // no numeric-only names
    }
  });
  it('serves previews through Pages-root-relative routes (fixture floor included)', () => {
    // 'testdata/<id>/…' is exact at the Pages SITE ROOT (the app IS the
    // site) and on the dev '/' page (plugin /testdata/ route); App.tsx's
    // CardPreview flips to '../testdata/…' for the '/app/' copy.
    const withPrev = G.filter(g => g.preview);
    expect(withPrev.length).toBeGreaterThanOrEqual(40);
    for (const g of withPrev.slice(0, 8)) {
      const inTest = existsSync(craftFile(g.id, 'preview.jpg'))
        && existsSync(new URL(`../../../../testdata/${g.id}/preview.jpg`, import.meta.url).pathname);
      expect(g.preview, g.id).toBe(inTest ? `testdata/${g.id}/preview.jpg` : `corpus/${g.id}/preview.jpg`);
      // the /corpus + /testdata handlers resolve files through craftFile's
      // PER-FILE fixture floor, so a testdata-only preview IS reachable
      expect(existsSync(craftFile(g.id, 'preview.jpg')), g.id).toBe(true);
    }
  });
  it('dedupes: one entry per id across both roots', () => {
    expect(new Set(G.map(g => g.id)).size).toBe(G.length);
  });
  it('VERSIONED CACHE: every entry stamps rev + sha + bytes + mtime of its blueprint.json', () => {
    // (v1.9.5) The IndexedDB cache validation and the X-Blueprint-Sha route
    // header depend on this: rev = '<bytes>-<mtimeMs>', sha = hex SHA-256 of
    // the bytes as served, and the stamp describes the SAME file the
    // craftFile()//corpus-route resolution downloads — so a staleness flag
    // can never lie about a different file.
    for (const g of G) {
      expect(g.rev, g.id).toMatch(/^\d+-\d+$/);
      expect(g.sha, g.id).toMatch(/^[0-9a-f]{64}$/);
      expect(g.bytes, g.id).toBeGreaterThan(0);
      expect(g.mtime, g.id).toBeGreaterThan(0);
    }
    // spot-check one entry against the bytes on disk, hashed through node
    // crypto independently of the plugin's memoised path
    const id = '3481322297';
    const g = byId.get(id)!;
    const st = statSync(craftFile(id));
    expect(g.rev).toBe(`${st.size}-${Math.round(st.mtimeMs)}`);
    expect(g.sha).toBe(createHash('sha256').update(readFileSync(craftFile(id))).digest('hex'));
    expect(g.bytes).toBe(st.size);
  });
});
