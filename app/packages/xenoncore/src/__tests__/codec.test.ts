// codec.test.ts — the S4 codec seed pins (P10). The corpus IS the fixture:
// every testdata blueprint's disks roundtrip decompose→compose to BYTE
// identity (the byte-identical law extended to the codec), the entry law
// matches xenonComputers, `#NODES` headers survive verbatim, capacity/label
// ride untouched, the blueprint is never mutated, and the world-save bridge
// maps programs to HDD dirs by content hash (measured layout, FORMAT §
// Xenon virtual disk runtime pack-out).
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  decomposeBlueprint, composeFiles, pickEntry, nodesHeader, nodesViolations,
  contentHash, matchWorldHdds, programKindOf,
  type BlueprintLike, type DiskFile,
} from '../codec';

const HERE = dirname(fileURLToPath(import.meta.url));
function repoRoot(): string {
  let d = HERE;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(d, 'testdata'))) return d;
    d = join(d, '..');
  }
  throw new Error('testdata corpus not found above the test file');
}
const CORPUS = join(repoRoot(), 'testdata');

/** every corpus blueprint that carries at least one disk */
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

describe('entry-selection law (the xenonComputers law)', () => {
  it('<program>.main.xc wins over a literal main.xc', () => {
    expect(pickEntry(['main.xc', 'Cede.main.xc', 'screen.xc'])).toBe('Cede.main.xc');
  });
  it('literal main.xc when no program main exists', () => {
    expect(pickEntry(['main.xc', 'lib.xc'])).toBe('main.xc');
  });
  it('falls back to the first file', () => {
    expect(pickEntry(['a.xc', 'b.xc'])).toBe('a.xc');
    expect(pickEntry([])).toBe(null);
  });
});

describe('program kinds', () => {
  it('maps the four disk hosts, rejects the rest', () => {
    expect(programKindOf('Computer')).toBe('Computer');
    expect(programKindOf('MiniComputer')).toBe('MiniComputer');
    expect(programKindOf('Crafter')).toBe('Crafter');
    expect(programKindOf('HudController')).toBe('HudController');
    expect(programKindOf('PilotSeat')).toBe(null);
    expect(programKindOf(undefined)).toBe(null);
  });
});

describe('corpus decompose', () => {
  it('the corpus carries many disks incl. all four kinds', () => {
    expect(ALL.length).toBeGreaterThanOrEqual(40);
    const kinds = new Set(ALL.map(p => p.kind));
    expect(kinds.has('MiniComputer')).toBe(true);
    expect(kinds.has('HudController')).toBe(true);   // Badger 3326372833 …
    expect(kinds.has('Crafter')).toBe(true);         // 3294879498 …
    const multi = ALL.filter(p => p.files.length > 10);
    expect(multi.length).toBeGreaterThanOrEqual(2);  // ChipOS + Badger disks
  });
  it('every program names an entry among its files', () => {
    for (const p of ALL)
      expect(p.entry === null || p.files.some(f => f.name === p.entry),
        `disk ${p.alias || p.ci}`).toBe(true);
  });
  it('decompose NEVER mutates the blueprint', () => {
    const { bp } = DISKS[0]!;
    const before = JSON.stringify(bp);
    decomposeBlueprint(bp);
    expect(JSON.stringify(bp)).toBe(before);
  });
});

describe('THE ROUNDTRIP LAW: decompose→compose is byte identity', () => {
  it('every corpus disk re-emits {name, plain_code} byte-identically', () => {
    let disks = 0, files = 0;
    for (const { id, bp } of DISKS) {
      const comps = bp.data?.components ?? [];
      for (const p of decomposeBlueprint(bp).programs) {
        const orig: DiskFile[] =
          (p.kind === 'HudController'
            ? comps[p.ci]?.data?.xc_files
            : comps[p.ci]?.data?.hdd?.xc_files) ?? [];
        disks++; files += orig.length;
        expect(JSON.stringify(composeFiles(orig, p.files)),
          `disk ${id}/${p.alias || p.ci}`).toBe(JSON.stringify(orig));
      }
    }
    expect(disks).toBeGreaterThanOrEqual(40);
    expect(files).toBeGreaterThanOrEqual(400);
  });
  it('key order is exactly {name, plain_code} on composed records', () => {
    const out = composeFiles(
      [{ name: 'a.xc', plain_code: 'x' }, { name: 'b.xc', plain_code: 'y' }],
      [{ name: 'a.xc', plain_code: 'X' }, { name: 'b.xc', plain_code: 'y' }]);
    expect(JSON.stringify(out[1])).toBe('{"name":"b.xc","plain_code":"y"}');
  });
  it('original file order rides through; adds append; deletes drop', () => {
    const orig = ['a.xc', 'b.xc', 'c.xc'].map(n => ({ name: n, plain_code: n }));
    const edited = [{ name: 'c.xc', plain_code: 'c' }, { name: 'a.xc', plain_code: 'A' },
      { name: 'd.xc', plain_code: 'd' }];
    expect(composeFiles(orig, edited).map(f => f.name)).toEqual(['a.xc', 'c.xc', 'd.xc']);
  });
});

describe('THE #NODES PRESERVATION LAW (measured: 73 corpus files)', () => {
  it('detects the first-line header only', () => {
    expect(nodesHeader('#NODES {"a":1}\nbody')).toBe('#NODES {"a":1}');
    expect(nodesHeader('init\nprint(1)\n')).toBe(null);
    expect(nodesHeader('; #NODES not-first')).toBe(null);
  });
  it('body edits are clean; header loss/reformat is a violation', () => {
    const orig: DiskFile[] = [{ name: 'flight.main.xc', plain_code: '#NODES {"n":1}\ninit\n' }];
    expect(nodesViolations(orig, composeFiles(orig,
      [{ name: 'flight.main.xc', plain_code: '#NODES {"n":1}\ninit\n\tprint(1)\n' }]))).toEqual([]);
    expect(nodesViolations(orig, composeFiles(orig,
      [{ name: 'flight.main.xc', plain_code: 'init\n\tprint(1)\n' }]))).toEqual(['flight.main.xc']);
    expect(nodesViolations(orig, composeFiles(orig,
      [{ name: 'flight.main.xc', plain_code: '#NODES  {"n":1}\ninit\n' }]))).toEqual(['flight.main.xc']);
  });
  it('the corpus roundtrip preserves every header verbatim (≥50 present)', () => {
    let withHeader = 0;
    for (const { bp } of DISKS) {
      const comps = bp.data?.components ?? [];
      for (const p of decomposeBlueprint(bp).programs) {
        const orig: DiskFile[] =
          (p.kind === 'HudController'
            ? comps[p.ci]?.data?.xc_files
            : comps[p.ci]?.data?.hdd?.xc_files) ?? [];
        withHeader += orig.filter(f => nodesHeader(f.plain_code) !== null).length;
        expect(nodesViolations(orig, p.files), `disk ${p.alias || p.ci}`).toEqual([]);
      }
    }
    expect(withHeader).toBeGreaterThanOrEqual(50);
  });
});

describe('capacity/label ride VERBATIM (never synthesized)', () => {
  it('the ChipOS fixture disk carries its hdd fields through', () => {
    const chip = ALL.find(p => p.files.some(f => f.name === 'chipos-appkit.xc'));
    expect(chip).toBeDefined();
    expect(chip!.capacity).toBeGreaterThan(0);
    expect(typeof chip!.label).toBe('string');
  });
});

describe('the world-save bridge (content hash; entitystate RE is BANNED)', () => {
  it('contentHash is stable, input-sensitive, length-safe', () => {
    expect(contentHash('init\n')).toBe(contentHash('init\n'));
    expect(contentHash('init\n')).not.toBe(contentHash('init\n\tprint(1)\n'));
    expect(contentHash('ab')).not.toBe(contentHash('cd'));
  });
  it('world HDD dirs map to their programs at score 1 (decoys stay out)', () => {
    const chip = ALL.find(p => p.files.some(f => f.name === 'chipos-appkit.xc'))!;
    const app = ALL.find(p => p !== chip && p.files.some(f => f.name === 'main.xc'))!;
    const hdds = [
      { id: 'HDD-AAA', files: chip.files.map(f => ({ name: f.name, code: f.plain_code })) },
      { id: 'HDD-BBB', files: app.files.map(f => ({ name: f.name, code: f.plain_code })) },
      { id: 'HDD-CCC', files: [{ name: 'main.xc', code: 'init\n\tprint("other craft")\n' }] },
    ];
    const m = matchWorldHdds({ craft: { alias: '', author: '', workshop_item_id: '', datetime: '' },
      programs: [chip, app] }, hdds);
    expect(m.find(x => x.alias === chip.alias)!.hddId).toBe('HDD-AAA');
    expect(m.find(x => x.alias === chip.alias)!.score).toBe(1);
    expect(m.find(x => x.alias === app.alias)!.hddId).toBe('HDD-BBB');
  });
  it('a byte-drifted world file still maps (fractional score ≥ threshold)', () => {
    const app = ALL.find(p => p.files.length > 1 && p.files.length < 6 && p.alias !== '')!;
    // drift the SMALLEST file: the matched fraction is then ≥ 1/2 by maths,
    // so the pin tests the bridge, not the disk's shape
    const minI = app.files.reduce(
      (mi, f, i, a) => (f.plain_code.length < a[mi]!.plain_code.length ? i : mi), 0);
    const drifted = app.files.map((f, i) => ({
      name: f.name,
      code: i === minI ? f.plain_code + '; autosave note\n' : f.plain_code,
    }));
    const m = matchWorldHdds(
      { craft: { alias: '', author: '', workshop_item_id: '', datetime: '' }, programs: [app] },
      [{ id: 'HDD-DRIFT', files: drifted }]);
    expect(m[0]!.hddId).toBe('HDD-DRIFT');
    expect(m[0]!.score).toBeGreaterThanOrEqual(0.5);
    expect(m[0]!.score).toBeLessThan(1);
  });
  it('an unrelated dir maps to nothing', () => {
    const app = ALL.find(p => p.files.length > 0 && p.files.length < 6 && p.alias !== '')!;
    const m = matchWorldHdds(
      { craft: { alias: '', author: '', workshop_item_id: '', datetime: '' }, programs: [app] },
      [{ id: 'HDD-X', files: [{ name: 'main.xc', code: 'init\n\tprint(9)\n' }] }]);
    expect(m[0]!.hddId).toBe(null);
  });
});
