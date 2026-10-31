// codec.pack.corpus.test.ts — the byte-SURGERY law over the corpus (P10-S4,
// app tier: the corpus lives HERE). The workspace packer edits a game save
// by BYTE SPAN: no edits ⇒ byte identity over every blueprint with disks;
// one edit ⇒ the diff is BOUNDED to that disk's xc_files array; capacity/
// label and every sibling ride verbatim. xenoncore's workspace.test.ts
// proves the same on synthetic raws; this is the game-writer proof.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { decomposeBlueprint, type BlueprintLike } from 'xenoncore';
import { jsonSpanOf, packBlueprintRaw } from 'xenoncore/workspace';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS = join(HERE, '../../../../testdata');

const raws: { id: string; raw: string; bp: BlueprintLike }[] = [];
for (const d of readdirSync(CORPUS)) {
  const p = join(CORPUS, d, 'blueprint.json');
  if (!existsSync(p)) continue;
  const raw = readFileSync(p, 'utf8');
  const bp = JSON.parse(raw) as BlueprintLike;
  if (decomposeBlueprint(bp).programs.length) raws.push({ id: d, raw, bp });
}

describe('THE SURGICAL-PACK LAW over the corpus', () => {
  it('no edits ⇒ byte identity (every blueprint with disks)', () => {
    expect(raws.length).toBeGreaterThanOrEqual(10);
    for (const { id, raw, bp } of raws)
      expect(packBlueprintRaw(raw, decomposeBlueprint(bp), new Map()),
        id).toBe(raw);
  });

  it('one edit ⇒ the diff is bounded to the edited disk array', () => {
    // the intercom bench: edit computer 0's main program
    const t = raws.find(r => r.id === '9000009010');
    expect(t).toBeDefined();
    const { raw, bp } = t!;
    const man = decomposeBlueprint(bp);
    const prog = man.programs.find(p => p.ci === 0)!;
    const files = prog.files.map((f, i) =>
      i === 0 ? { name: f.name, plain_code: f.plain_code + '\n; packed-test\n' } : f);
    const out = packBlueprintRaw(raw, man, new Map([[0, files]]));
    const span = jsonSpanOf(raw, ['data', 'components', 0, 'data', 'hdd', 'xc_files'])!;
    // everything BEFORE the array and AFTER the array rides byte-identically
    expect(out.slice(0, span[0])).toBe(raw.slice(0, span[0]));
    expect(out.slice(out.length - (raw.length - span[1]))).toBe(raw.slice(span[1]));
    // and the edit is real, the sibling disk untouched
    const back = JSON.parse(out) as BlueprintLike;
    const xf = (back.data!.components![0]!.data!.hdd as { xc_files: { name: string; plain_code: string }[] }).xc_files;
    expect(xf[0]!.plain_code.endsWith('; packed-test\n')).toBe(true);
    expect(back.data!.components![1]).toEqual(bp.data!.components![1]);
  });

  it('the corpus pack-out disks all locate at their spans (the law holds on every real disk)', () => {
    let disks = 0;
    for (const { id, raw, bp } of raws) {
      for (const p of decomposeBlueprint(bp).programs) {
        if (!p.files.length) continue;   // Crafter built-ins ride the game,
                                          // not the disk: no span to locate
        const path = p.kind === 'HudController'
          ? ['data', 'components', p.ci, 'data', 'xc_files']
          : ['data', 'components', p.ci, 'data', 'hdd', 'xc_files'];
        const span = jsonSpanOf(raw, path);
        expect(span, `${id}/ci${p.ci}`).not.toBeNull();
        expect(raw.slice(span![0], span![0] + 1)).toBe('[');
        disks++;
      }
    }
    expect(disks).toBeGreaterThanOrEqual(40);
  });
});
