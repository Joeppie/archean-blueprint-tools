// corpus-staleness.test.ts — THE corpus-vs-workshop staleness test promised
// with the v1.9.5 versioned cache. It runs the REAL machinery end to end on
// TEMP FIXTURES ONLY:
//   ① a temp corpus folder under /tmp/opencode with one craft, published via
//      env ARCHEAN_BLUEPRINTS (the sanctioned config channel — AGENTS
//      § Blueprint folder; NOTHING under a Steam tree is ever read/written);
//   ② the REAL plugin catalog compile (galleryData) → entry {rev, sha,
//      bytes, mtime} for revision A;
//   ③ the blueprint.json EDITED on disk (new bytes, mtime advanced with
//      utimesSync so no sleep/race is involved) → recompile → rev AND sha
//      changed;
//   ④ a cache entry stored at revision A through the real loadCraft (fake
//      fetch serving the /corpus route's X-Blueprint-Rev/-Sha headers) →
//      craftState = 'stale' against the recompiled catalog, and a fresh
//      copy downloads to 'fresh' — plus the unverified/legacy 'unknown' path.
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { blueprintMeta, galleryData, resetCorpusCache } from '../../../tools/vite-corpus.ts';
import {
  clearCraftCache, craftCached, craftState, craftStateOf, loadCraft, type CraftMeta,
} from '../../crafts';

// 95xxxx: outside the real Steam id range (≈3.3e9) AND outside the
// 900000xxxx fixture pattern the catalog excludes — a private probe id.
const ID = '9500000001';
const TEXT_A = JSON.stringify({ data: { alias: 'Staleness Probe', components: [] } });
const TEXT_B = JSON.stringify({ data: { alias: 'Staleness Probe EDITED', components: [] } });

// module-scope setup: the fixture exists BEFORE the first catalog compile,
// and the env is published BEFORE corpusDir() memoises (it resolves lazily).
mkdirSync('/tmp/opencode', { recursive: true });
const TMP = mkdtempSync('/tmp/opencode/archean-staleness-');
const BP = join(TMP, ID, 'blueprint.json');
mkdirSync(join(TMP, ID), { recursive: true });
writeFileSync(BP, TEXT_A);
process.env.ARCHEAN_BLUEPRINTS = TMP;
resetCorpusCache();

const shaOf = (s: string) => createHash('sha256').update(s).digest('hex');
const metaOf = (id: string): CraftMeta => {
  const g = galleryData().find(e => e.id === id);
  return g ? { rev: g.rev, sha: g.sha, bytes: g.bytes, mtime: g.mtime } : {};
};
/** the /corpus route's response contract (vite-corpus sendFile headers) */
const routeRes = (body: string, rev: string, sha: string) => ({
  ok: true,
  headers: new Headers({ 'content-length': String(Buffer.byteLength(body)),
    'x-blueprint-rev': rev, 'x-blueprint-sha': sha }),
  body: new ReadableStream<Uint8Array>({
    start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); },
  }),
}) as unknown as Response;

describe('corpus-vs-workshop staleness (temp fixture, real machinery)', () => {
  it('catalog compile stamps rev + sha + bytes + mtime for revision A', () => {
    const st = statSync(BP);
    const g = galleryData().find(e => e.id === ID);
    expect(g, 'temp corpus craft joined the catalog').toBeTruthy();
    expect(g!.name).toBe('Staleness Probe');           // aliasOf through the temp root
    expect(g!.bytes).toBe(st.size);
    expect(g!.mtime).toBe(st.mtimeMs);
    expect(g!.rev).toBe(`${st.size}-${Math.round(st.mtimeMs)}`);
    expect(g!.sha).toBe(shaOf(TEXT_A));
    // the route-side helper resolves the SAME file with the SAME stamp
    expect(blueprintMeta(ID)).toEqual({ rev: g!.rev, sha: g!.sha, bytes: g!.bytes, mtime: g!.mtime });
  });

  it('fresh at A → file EDITED → stale → Download latest → fresh at B', async () => {
    await clearCraftCache();
    const metaA = metaOf(ID);
    const noop = () => {};

    // download at revision A (the plugin-header contract, real loadCraft)
    const rA = await loadCraft(ID, noop, false,
      async () => routeRes(TEXT_A, metaA.rev!, metaA.sha!), metaA);
    expect(rA).toMatchObject({ text: TEXT_A, fromCache: false });
    expect(await craftState(ID, metaA)).toBe('fresh');

    // ③ EDIT the file: new bytes + an advanced mtime (deterministic +5 s)
    writeFileSync(BP, TEXT_B);
    const tB = statSync(BP).mtimeMs / 1000 + 5;
    utimesSync(BP, tB, tB);
    const metaB = metaOf(ID);                          // recompile (memo revalidates)
    expect(metaB.rev).not.toBe(metaA.rev);             // THE promised flips:
    expect(metaB.sha).not.toBe(metaA.sha);             //   rev changed AND sha changed
    expect(metaB.sha).toBe(shaOf(TEXT_B));

    // ④ the copy stored at revision A is provably STALE now
    expect(await craftState(ID, metaB)).toBe('stale');
    // (and the pure gallery-chip classifier agrees)
    expect(craftStateOf({ saved: Date.now(), rev: metaA.rev }, metaB)).toBe('stale');

    // [Download latest] → force redownload re-stamps → fresh at B again
    const rB = await loadCraft(ID, noop, true,
      async () => routeRes(TEXT_B, metaB.rev!, metaB.sha!), metaB);
    expect(rB).toMatchObject({ text: TEXT_B, fromCache: false });
    expect(await craftState(ID, metaB)).toBe('fresh');
  });

  it('corrupted bytes (digest mismatch) are delivered but never trusted: unknown', async () => {
    await clearCraftCache();
    const metaB = metaOf(ID);
    const r = await loadCraft(ID, () => {}, false,
      async () => routeRes(TEXT_B, metaB.rev!, '0'.repeat(64)), metaB);   // WRONG digest
    expect(r?.text).toBe(TEXT_B);                       // the session still opens
    expect(await craftCached(ID)).toBe(true);           // cached…
    expect(await craftState(ID, metaB)).toBe('unknown'); // …but warned forever, never silently fresh
  });

  it('a header-less copy (legacy v1 shape) classifies unknown against the catalog', async () => {
    await clearCraftCache();
    await loadCraft(ID, () => {}, false, async () => ({
      ok: true, headers: new Headers(),
      text: async () => TEXT_B,
    }) as unknown as Response);
    expect(await craftState(ID, metaOf(ID))).toBe('unknown');
  });
});
