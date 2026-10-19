// gallery.test.ts — the compiled catalog (virtual:gallery) rules. The user
// report (2026-10-19): the app gallery showed the INDIVIDUAL COMPONENT TEST
// CASES (matrix fixtures 90000010NN/90000020NN written into the Steam corpus
// folder) and missed most workshop items, because it scanned ONLY the
// configured corpus — a machine's client/blueprints dir holds just the craft
// touched in-game. The catalog is now the corpus ∪ testdata fixture floor
// minus fixtures/excludes, with make_landing.py's name tiers + numeric skip:
// the SAME workshop catalog as the landing page.
import { existsSync } from 'node:fs';
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
    for (const id of ['3384910875', '3334593406', '3347018068', '3334591920']) {
      expect(byId.has(id), id).toBe(false);
    }
  });
  it('lists the corpus workshop crafts OUTSIDE the machine corpus too', () => {
    // the fixture floor: a Steam client/blueprints folder carries only a
    // subset — testdata crafts must appear regardless of the conf
    for (const id of ['3327182790', '3417786605', '3481322297', '3803780241']) {
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
  it('serves previews through /corpus (fixture floor included)', () => {
    const withPrev = G.filter(g => g.preview);
    expect(withPrev.length).toBeGreaterThanOrEqual(40);
    for (const g of withPrev.slice(0, 8)) {
      expect(g.preview).toBe(`/corpus/${g.id}/preview.jpg`);
      // the /corpus handler resolves files through craftFile's PER-FILE
      // fixture floor, so a testdata-only preview IS reachable
      expect(existsSync(craftFile(g.id, 'preview.jpg')), g.id).toBe(true);
    }
  });
  it('dedupes: one entry per id across both roots', () => {
    expect(new Set(G.map(g => g.id)).size).toBe(G.length);
  });
});
