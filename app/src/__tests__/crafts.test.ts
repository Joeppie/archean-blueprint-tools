// crafts.test.ts — download-when-required + cache policy (node: no
// indexedDB → the session-Memory fallback runs, same code path the
// browser's cache-hit branch takes). fetchProgress is fed a fake
// streaming Response, so the byte/percent math is asserted for real.
// The VERSIONED CACHE suite (v1.9.5) pins rev/sha stamping, the digest
// verification (good AND corrupted bytes), the stale/unknown/absent states
// and both sha-256 paths (WebCrypto + the pure-JS fallback) against node's
// crypto. The corpus-side half lives in engine/__tests__/corpus-staleness.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  cacheSnapshot, clearCraftCache, craftCached, craftInfo, craftState,
  craftStateOf, fetchProgress, loadCraft, sha256Hex, sha256HexSync,
} from '../crafts';

const stream = (body: string, chunk: number, len = body.length,
  headers: Record<string, string> = {}) => ({
  ok: true,
  headers: new Headers({ ...(len ? { 'content-length': String(len) } : {}), ...headers }),
  body: new ReadableStream<Uint8Array>({
    start(c) {
      const b = new TextEncoder().encode(body);
      for (let i = 0; i < b.length; i += chunk) c.enqueue(b.slice(i, i + chunk));
      c.close();
    },
  }),
}) as unknown as Response;

/** the /corpus route's contract, in one call: rev + sha headers over the body */
const versioned = (body: string, rev: string, sha: string) =>
  stream(body, 8, body.length, { 'x-blueprint-rev': rev, 'x-blueprint-sha': sha });
const shaOf = (s: string) => createHash('sha256').update(s).digest('hex');

describe('fetchProgress', () => {
  it('reports cumulative byte progress and returns the body', async () => {
    const body = JSON.stringify({ data: { x: 'x'.repeat(100) } });
    const seen: [number | null, number][] = [];
    const res = await fetchProgress('/u', (f, b) => seen.push([f, b]),
      async () => stream(body, 16));
    expect(res).toBe(body);
    expect(seen.length).toBeGreaterThanOrEqual(8);
    expect(seen[seen.length - 1]).toEqual([1, body.length]);
    // strictly increasing fractions ending at exactly 1
    for (let i = 1; i < seen.length; i++) expect(seen[i]![0]).toBeGreaterThan(seen[i - 1]![0]!);
  });

  it('unlengthed bodies stream once with frac=1', async () => {
    const seen: (number | null)[] = [];
    const fake = async () => ({
      ok: true, headers: new Headers(), body: null,
      text: async () => 'plain',
    }) as unknown as Response;
    expect(await fetchProgress('/u', (f) => seen.push(f), fake)).toBe('plain');
    expect(seen).toEqual([1]);
  });

  it('HTTP failure and network throw yield null', async () => {
    expect(await fetchProgress('/u', () => {},
      async () => ({ ok: false, headers: new Headers(), body: null } as unknown as Response))).toBeNull();
    expect(await fetchProgress('/u', () => {},
      async () => { throw new Error('down'); })).toBeNull();
  });
});

describe('loadCraft — download ONLY when required', () => {
  it('first open downloads (progress), second open is pure cache', async () => {
    await clearCraftCache();
    const body = '{"data":{"components":[]}}';
    let calls = 0;
    const fetcher = async () => { calls++; return stream(body, 8); };

    const a = await loadCraft('9100000001', () => {}, false, fetcher);
    expect(a).toMatchObject({ text: body, fromCache: false });
    expect(calls).toBe(1);
    expect(await craftCached('9100000001')).toBe(true);

    const seen: unknown[] = [];
    const b = await loadCraft('9100000001', (f, n) => seen.push([f, n]), false, fetcher);
    expect(b).toMatchObject({ text: body, fromCache: true });
    expect(calls, 'cached craft: ZERO network').toBe(1);
    expect(seen, 'cached craft: no progress events (no overlay flash)').toEqual([]);
  });

  it('force (File ▾ Refresh) re-downloads and updates the cache', async () => {
    await clearCraftCache();
    let calls = 0;
    const body1 = '{"v":1}';
    const body2 = '{"v":2}';
    const f1 = async () => { calls++; return stream(body1, 8); };
    await loadCraft('9100000002', () => {}, false, f1);
    const f2 = async () => { calls++; return stream(body2, 8); };
    await loadCraft('9100000002', () => {}, true, f2);        // force
    expect(calls).toBe(2);
    const f3 = async () => { calls++; return stream('', 1); };
    const c = await loadCraft('9100000002', () => {}, false, f3);
    expect(c).toMatchObject({ text: body2, fromCache: true });
    expect(calls).toBe(2);
  });

  it('network failure with no cache → null (the overlay\'s error state)', async () => {
    await clearCraftCache();
    const r = await loadCraft('9100000003', () => {}, false,
      async () => ({ ok: false, status: 404 } as unknown as Response));
    expect(r).toBeNull();
  });

  it('concurrent opens of the same craft SHARE one download (StrictMode double-mount)', async () => {
    await clearCraftCache();
    const body = '{"concurrent":true}';
    let calls = 0;
    const fetcher = async () => { calls++; return stream(body, 8); };
    const seenA: unknown[] = []; const seenB: unknown[] = [];
    const [a, b] = await Promise.all([
      loadCraft('9100000004', f => seenA.push(f), false, fetcher),
      loadCraft('9100000004', f => seenB.push(f), false, fetcher),
    ]);
    expect(calls).toBe(1);
    expect(a).toEqual(b);
    expect(seenA[0]).toBeNull();               // both listeners saw start + chunks
    expect(seenB[0]).toBeNull();
  });
});

describe('sha256 — both paths pinned against node crypto', () => {
  // the block-boundary sizes (55/56/63/64/65) are where sloppy padding dies
  for (const body of ['', 'abc', '{"data":{"alias":"é🚀ü"}}',
                      'x'.repeat(55), 'y'.repeat(56), 'z'.repeat(64), 'w'.repeat(100_000)]) {
    it(`hashes ${body.length || 'zero'} bytes identically (subtle === js === node)`, async () => {
      const want = shaOf(body);
      expect(await sha256Hex(body)).toBe(want);
      expect(sha256HexSync(body)).toBe(want);   // the no-crypto.subtle fallback
    });
  }
  it('NIST known vectors', () => {
    expect(sha256HexSync('abc'))
      .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256HexSync(''))
      .toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

describe('versioned cache — rev + SHA-256 validation (v1.9.5)', () => {
  it('fresh: download stamps rev+sha from the headers; the next open is pure cache, ZERO network', async () => {
    await clearCraftCache();
    const body = '{"v":"A"}';
    const rev = '9-111';
    const meta = { rev, sha: shaOf(body), bytes: body.length, mtime: 111 };
    let calls = 0;
    const fetcher = async () => { calls++; return versioned(body, rev, meta.sha); };
    expect(await craftState('9200000001', meta)).toBe('absent');
    const a = await loadCraft('9200000001', () => {}, false, fetcher, meta);
    expect(a).toMatchObject({ text: body, fromCache: false });
    expect(await craftState('9200000001', meta)).toBe('fresh');
    const b = await loadCraft('9200000001', () => {}, false, fetcher, meta);
    expect(b).toMatchObject({ text: body, fromCache: true });
    expect(calls, 'fresh cached craft: ZERO network').toBe(1);
    expect(await craftInfo('9200000001')).toMatchObject({ rev, sha: meta.sha, bytes: body.length });
  });

  it('stale: rev differs → stale → force redownload re-stamps → fresh again', async () => {
    await clearCraftCache();
    const A = '{"v":1}';
    const B = '{"v":2,"edited":true}';
    const revA = `${A.length}-1`, shaA = shaOf(A);
    const revB = `${B.length}-2`, shaB = shaOf(B);
    await loadCraft('9200000002', () => {}, false,
      async () => versioned(A, revA, shaA), { rev: revA, sha: shaA });
    expect(await craftState('9200000002', { rev: revA, sha: shaA })).toBe('fresh');
    // the file was edited after caching — the catalog now publishes revB:
    expect(await craftState('9200000002', { rev: revB, sha: shaB })).toBe('stale');
    // [Download latest] = the force path; it stores the NEW rev + sha
    const r = await loadCraft('9200000002', () => {}, true,
      async () => versioned(B, revB, shaB), { rev: revB, sha: shaB });
    expect(r).toMatchObject({ text: B, fromCache: false });
    expect(await craftState('9200000002', { rev: revB, sha: shaB })).toBe('fresh');
    expect(await craftCached('9200000002')).toBe(true);
  });

  it('sha mismatch: bytes still open in the session but are NOT cached as trusted', async () => {
    await clearCraftCache();
    const body = '{"corrupt?":true}';
    const rev = '17-333';
    const wrongSha = shaOf('the bytes the digest was actually published for');
    let calls = 0;
    const fetcher = async () => { calls++; return versioned(body, rev, wrongSha); };
    const r = await loadCraft('9200000003', () => {}, false, fetcher, { rev });
    expect(r).toMatchObject({ text: body, fromCache: false });      // session keeps working
    expect(await craftCached('9200000003')).toBe(true);              // cached…
    expect(await craftState('9200000003', { rev })).toBe('unknown'); // …never trusted
    // [Open cached copy] still serves it (the UI's explicit choice), no new fetch
    const c = await loadCraft('9200000003', () => {}, false, fetcher, { rev });
    expect(c).toMatchObject({ text: body, fromCache: true });
    expect(calls).toBe(1);
  });

  it('static layout (no headers): the catalog digest verifies good bytes and rejects corrupted ones', async () => {
    await clearCraftCache();
    const good = '{"pages":true}';
    const meta = { rev: '13-999', sha: shaOf(good) };
    await loadCraft('9200000004', () => {}, false, async () => stream(good, 8), meta);
    expect(await craftState('9200000004', meta)).toBe('fresh');
    await clearCraftCache();                                        // corrupted server bytes
    await loadCraft('9200000004', () => {}, false,
      async () => stream('{"pages":TRUTH}', 8), meta);
    expect(await craftState('9200000004', meta)).toBe('unknown');
  });

  it('legacy v1 entry (no rev) classifies unknown — always warned, never trusted silently', async () => {
    await clearCraftCache();
    // a header-less download with NO catalog meta is exactly what a v1 entry
    // looks like to the new code: { text, saved } and nothing to validate
    await loadCraft('9200000005', () => {}, false, async () => stream('{"v1":true}', 8));
    expect(await craftCached('9200000005')).toBe(true);
    expect(await craftState('9200000005', { rev: '8-100' })).toBe('unknown');
    expect(await craftState('9200000005')).toBe('unknown');
  });

  it('craftStateOf — the pure classifier for every state (gallery chips run this)', () => {
    expect(craftStateOf(undefined, { rev: 'x' })).toBe('absent');
    expect(craftStateOf({ saved: 1 }, { rev: 'x' })).toBe('unknown');        // legacy: no rev
    expect(craftStateOf({ saved: 1, rev: 'x' }, undefined)).toBe('unknown'); // nothing to check against
    expect(craftStateOf({ saved: 1, rev: 'x' }, { rev: 'x' })).toBe('fresh');
    expect(craftStateOf({ saved: 1, rev: 'x' }, { rev: 'y' })).toBe('stale');
  });

  it('cacheSnapshot covers every cached craft with its metadata (gallery ONE pass)', async () => {
    await clearCraftCache();
    await loadCraft('9200000006', () => {}, false,
      async () => versioned('{"a":1}', '5-1', shaOf('{"a":1}')));
    await loadCraft('9200000007', () => {}, false, async () => stream('{"b":2}', 8));
    const snap = await cacheSnapshot();
    expect([...snap.keys()].sort()).toEqual(['9200000006', '9200000007']);
    expect(snap.get('9200000006')).toMatchObject({ rev: '5-1', sha: shaOf('{"a":1}') });
    expect(snap.get('9200000007')?.rev).toBeUndefined();            // legacy-shaped record
    await clearCraftCache();
    expect((await cacheSnapshot()).size).toBe(0);
  });
});
