// xcanalyze.integration.test.ts — the analyzer's APP-side TRUE-NEGATIVE
// legs (split from the pure xcanalyze.test.ts when the analyzer moved into
// packages/xenoncore, P10-S1): the shipped real programs (ChipOS's disks,
// the Badger's disk, the player-HUD disks, the ANALYSIS BENCH fixture)
// ride xenonComputers + the corpus reader, so they stay in the app tier —
// the package imports NEITHER.
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { analyzeProject } from 'xenoncore';
import { xenonComputers } from '../xenoncode';
import { listPlayerHuds, readPlayerHudProgram } from '../../../tools/vite-corpus';
import type { Blueprint } from '../format';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS = join(HERE, '../../../../testdata');
const load = (id: string): Blueprint | null => {
  const p = join(CORPUS, id, 'blueprint.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
};

describe('TRUE-NEGATIVE law: shipped programs are clean', () => {
  const HARD = ['xc-undeclared-function', 'xc-unknown-function', 'xc-unknown-method',
    'xc-unknown-include', 'xc-duplicate-function', 'xc-missing-return'];
  const runDisks = (id: string): string[] => {
    const bp = load(id);
    if (!bp) return [];
    const bad: string[] = [];
    for (const c of xenonComputers(bp)) {
      if (!c.files.length) continue;
      const aliases = c.devices.map(d => d.alias.toLowerCase()).filter(Boolean);
      const ds = analyzeProject(c.files, { aliases });
      bad.push(...ds.filter(d => HARD.includes(d.code))
        .map(d => `${c.alias}/${d.file}:${d.line} ${d.code}: ${d.message}`));
    }
    return bad;
  };

  it('the ChipOS Dev Kit (per-computer disks incl. the 52-file OS): no HARD diagnostics', () => {
    expect(xenonComputers(load('3828773626')!).length).toBeGreaterThanOrEqual(3);
    expect(runDisks('3828773626').slice(0, 12),
      'the shipped OS + app disks must analyze clean').toEqual([]);
  }, 30_000);

  it('the Badger 3326372833 disk: no HARD diagnostics', () => {
    expect(runDisks('3326372833').slice(0, 12)).toEqual([]);
  }, 30_000);

  it('the corpus ids census reads at least the fixture disks', () => {
    const ids = readdirSync(CORPUS).filter(d => d.startsWith('9000009050'));
    expect(ids.length).toBe(1);
  });

  it('the SHIPPED player-HUD disks (fixture floor + machine huds: readme, ' +
    'homo, omfg) carry no HARD diagnostics (v1.16.13 — the game hud calling ' +
    'button_circle is what fired the vocabulary audit)', () => {
    const entries = listPlayerHuds();
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      const prog = readPlayerHudProgram(e.name);
      if (!prog) continue;
      const hard = analyzeProject(prog.files).filter(d => HARD.includes(d.code));
      expect(hard.map(d => `${e.name}/${d.file}:${d.line} ${d.code}: ${d.message}`).slice(0, 8),
        `hud ${e.name}`).toEqual([]);
    }
  }, 30_000);
});

describe('ANALYSIS BENCH fixture (9000009090 — one defect per code)', () => {
  it('every planted defect fires; the clean counterparts stay silent', () => {
    const bp = load('9000009090');
    if (!bp) return;
    const comp = xenonComputers(bp).find(c => c.alias === 'analyst')!;
    const aliases = comp.devices.map(d => d.alias?.toLowerCase() ?? '').filter(Boolean);
    expect(aliases).toContain('lamp');
    const ds = analyzeProject(comp.files, { aliases });
    const byCode = new Map<string, number>();
    for (const d of ds) byCode.set(d.code, (byCode.get(d.code) ?? 0) + 1);
    for (const code of ['xc-undeclared-function', 'xc-unknown-function',
      'xc-unknown-method', 'xc-unknown-include', 'xc-missing-return',
      'xc-unused-function', 'xc-unused-var', 'xc-unused-param',
      'xc-unknown-alias', 'xc-duplicate-function', 'xc-duplicate-var'])
      expect(byCode.has(code), `${code} must fire on the bench (got ${[...byCode]})`).toBe(true);
    // the clean half: @dup/@sink calls, $v/$x reads, the lamp alias — the
    // ghost alias fires EXACTLY once, the lamp one never
    expect(byCode.get('xc-unknown-alias')).toBe(1);
    expect(ds.filter(d => d.code === 'xc-undeclared-function')).toHaveLength(1);
    // the disk is small: hints stay few (no diagnostic storm)
    expect(ds.length).toBeLessThan(16);
  });
});

describe('THE ROOT-NAME LAW — the shipped HUD leg (v1.16.14)', () => {
  it('the Human HUD disk (homo) flags NO beacon var as unused', () => {
    const prog = readPlayerHudProgram('homo');
    if (!prog) return;                       // machine-local floor
    const ds = analyzeProject(prog.files).filter(
      d => d.code === 'xc-unused-var' && d.message.includes('beacon'));
    expect(ds.map(d => d.message)).toEqual([]);
  });
});
