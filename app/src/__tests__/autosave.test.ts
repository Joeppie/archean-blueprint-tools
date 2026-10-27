// autosave.test.ts — the shadow-copy policy (engine/autosave.ts), run on the
// session-Memory path (node has no indexedDB — the crafts.ts pattern).
// Pins: content-change recording, the identical-text skip, per-craft caps,
// prune-after-save, newest-first listing, per-craft scoping.
import { describe, expect, it } from 'vitest';
import {
  autosave, autosavesFor, countAutosaves, listAutosaves, pruneAfterSave,
} from '../engine/autosave';

describe('autosave shadow copies', () => {
  it('records on content change, skips identical text', async () => {
    const a = await autosave('craft-A', 'Crafter A', '{"a":1}');
    expect(a).not.toBeNull();
    expect(a!.key).toBe('craft-A');
    expect(a!.text).toBe('{"a":1}');
    expect(a!.bytes).toBe(7);
    expect(await autosave('craft-A', 'Crafter A', '{"a":1}')).toBeNull();   // no change, no row
    const b = await autosave('craft-A', 'Crafter A', '{"a":2}');
    expect(b).not.toBeNull();
    // Date.now() collides inside a test tick — ids must stay unique:
    expect(b!.id).not.toBe(a!.id);
  });

  it('lists newest first, scoped per craft', async () => {
    await autosave('craft-B', 'Crafter B', '{"b":1}');
    const a = await autosavesFor('craft-A');
    expect(a.length).toBe(2);
    expect(a[0]!.text).toBe('{"a":2}');                 // newest first
    expect(a.every(x => x.key === 'craft-A')).toBe(true);
    const all = await listAutosaves();
    expect(all.length).toBe(3);
    expect((await countAutosaves())).toBe(3);
  });

  it('pruneAfterSave keeps the newest few', async () => {
    for (let i = 0; i < 8; i++) await autosave('craft-C', 'Crafter C', `{"c":${i}}`);
    expect((await autosavesFor('craft-C')).length).toBe(8);
    await pruneAfterSave('craft-C');
    const left = await autosavesFor('craft-C');
    expect(left.length).toBe(4);
    expect(left[0]!.text).toBe('{"c":7}');              // newest kept
  });

  it('caps per craft at KEEP_PER_CRAFT', async () => {
    for (let i = 0; i < 15; i++) await autosave('craft-D', 'Crafter D', `{"d":${i}}`);
    expect((await autosavesFor('craft-D')).length).toBe(12);
    expect((await autosavesFor('craft-D'))[0]!.text).toBe('{"d":14}');
  });
});
