// codec.corpus.test.ts — the codec's CORPUS legs (split from the package's
// codec.test.ts at S0, P10): the corpus lives in THIS repo, so only the
// app tier can state the law over it. The game's pack-out is the fixture:
// every testdata blueprint's disks roundtrip decompose→compose to BYTE
// identity, real `.main.xc` files carry the #NODES header (73 measured),
// and all four disk-host kinds occur. The xenoncore package itself stays
// corpus-free (src/__tests__/codec.test.ts, package tier).
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  decomposeBlueprint, composeFiles, nodesHeader, nodesViolations,
  matchWorldHdds, type BlueprintLike, type DiskFile,
} from 'xenoncore';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS = join(HERE, '../../../../testdata');

function diskBlueprints(): { id: string; bp: BlueprintLike }[] {
  const out: { id: string; bp: BlueprintLike }[] = [];
  for (const d of readdirSync(CORPUS)) {
    const p = join(CORPUS, d, 'blueprint.json');
    if (!existsSync(p)) continue;
    const bp = JSON.parse(readFileSync(p, 'utf8')) as BlueprintLike;
    if (decomposeBlueprint(bp).programs.length) out.push({ id: d, bp });
  }
  return out;
}
const DISKS = diskBlueprints();
const ALL = DISKS.flatMap(x => decomposeBlueprint(x.bp).programs);
const origFiles = (bp: BlueprintLike, ci: number, hud: boolean): DiskFile[] =>
  (hud
    ? bp.data?.components?.[ci]?.data?.xc_files
    : bp.data?.components?.[ci]?.data?.hdd?.xc_files) ?? [];

describe('corpus decompose (the game pack-out IS the fixture)', () => {
  it('the corpus carries many disks incl. all four kinds', () => {
    expect(ALL.length).toBeGreaterThanOrEqual(40);
    const kinds = new Set(ALL.map(p => p.kind));
    expect(kinds.has('MiniComputer')).toBe(true);
    expect(kinds.has('HudController')).toBe(true);   // Badger 3326372833 …
    expect(kinds.has('Crafter')).toBe(true);         // 3294879498 …
    expect(ALL.filter(p => p.files.length > 10).length).toBeGreaterThanOrEqual(2);
  });
  it('every program names an entry among its files', () => {
    for (const p of ALL)
      expect(p.entry === null || p.files.some(f => f.name === p.entry),
        `disk ${p.alias || p.ci}`).toBe(true);
  });
});

describe('THE ROUNDTRIP LAW: decompose→compose is byte identity', () => {
  it('every corpus disk re-emits {name, plain_code} byte-identically', () => {
    let disks = 0, files = 0;
    for (const { id, bp } of DISKS) {
      for (const p of decomposeBlueprint(bp).programs) {
        const orig = origFiles(bp, p.ci, p.kind === 'HudController');
        disks++; files += orig.length;
        expect(JSON.stringify(composeFiles(orig, p.files)),
          `disk ${id}/${p.alias || p.ci}`).toBe(JSON.stringify(orig));
      }
    }
    expect(disks).toBeGreaterThanOrEqual(40);
    expect(files).toBeGreaterThanOrEqual(400);
  });
});

describe('THE #NODES PRESERVATION LAW (measured: 73 corpus files)', () => {
  it('the corpus roundtrip preserves every header verbatim (≥50 present)', () => {
    let withHeader = 0;
    for (const { bp } of DISKS) {
      for (const p of decomposeBlueprint(bp).programs) {
        const orig = origFiles(bp, p.ci, p.kind === 'HudController');
        withHeader += orig.filter(f => nodesHeader(f.plain_code) !== null).length;
        expect(nodesViolations(orig, p.files), `disk ${p.alias || p.ci}`).toEqual([]);
      }
    }
    expect(withHeader).toBeGreaterThanOrEqual(50);
  });
});

describe('the world-save bridge on REAL disks', () => {
  it('runtime HDD dirs map to their programs at score 1 (decoys stay out)', () => {
    const chip = ALL.find(p => p.files.some(f => f.name === 'chipos-appkit.xc'));
    if (!chip) return;                              // fixture floor
    const hdds = [
      { id: 'HDD-AAA', files: chip.files.map(f => ({ name: f.name, code: f.plain_code })) },
      { id: 'HDD-CCC', files: [{ name: 'main.xc', code: 'init\n\tprint("other craft")\n' }] },
    ];
    const m = matchWorldHdds(
      { craft: { alias: '', author: '', workshop_item_id: '', datetime: '' }, programs: [chip] },
      hdds);
    expect(m[0]!.hddId).toBe('HDD-AAA');
    expect(m[0]!.score).toBe(1);
  });
});
