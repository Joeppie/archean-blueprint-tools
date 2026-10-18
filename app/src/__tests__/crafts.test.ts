// crafts.test.ts — download-when-required + cache policy (node: no
// indexedDB → the session-Memory fallback runs, same code path the
// browser's cache-hit branch takes). fetchProgress is fed a fake
// streaming Response, so the byte/percent math is asserted for real.
import { describe, expect, it } from 'vitest';
import { clearCraftCache, craftCached, fetchProgress, loadCraft } from '../crafts';

const stream = (body: string, chunk: number, len = body.length) => ({
  ok: true,
  headers: new Headers(len ? { 'content-length': String(len) } : {}),
  body: new ReadableStream<Uint8Array>({
    start(c) {
      const b = new TextEncoder().encode(body);
      for (let i = 0; i < b.length; i += chunk) c.enqueue(b.slice(i, i + chunk));
      c.close();
    },
  }),
}) as unknown as Response;

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
