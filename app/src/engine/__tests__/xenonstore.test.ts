// xenonstore.test.ts — THE STORAGE PERSISTENCE LAW's map tier (v1.16.27):
// the key shape and the load/save round-trip (node runs the memory
// fallback — the IndexedDB path is the identical contract, exercised
// for-real by the e2e storage.spec across page reloads).
import { describe, expect, it } from 'vitest';
import { loadStore, saveStore, storageKey } from '../xenonstore';

describe('THE STORAGE PERSISTENCE LAW (map tier)', () => {
  it('keys are per-(craft, computer)', () => {
    expect(storageKey('9000009096', 11)).toBe('9000009096#11');
    expect(storageKey('9000009096', 12)).not.toBe(storageKey('9000009096', 11));
    expect(storageKey('3828773626', 4)).not.toBe(storageKey('9000009096', 4));
  });
  it('a saved map reloads intact; a fresh key answers null', async () => {
    const k = storageKey('unittest-craft', 1);
    expect(await loadStore(k)).toBeNull();          // genuinely fresh disk
    const store = { $boots: ['1'], $cfg_primary_alias: ['main-screen', '0'] };
    await saveStore(k, store);
    expect(await loadStore(k)).toEqual(store);
    await saveStore(k, {});                         // a WIPED disk is state too
    expect(await loadStore(k)).toEqual({});
  });
});
