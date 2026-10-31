// xcanalyze.test.ts — THE XENONCODE ANALYZER pins (v1.16.13): vocabulary
// sync against the C++ sources (the mass.ts ⇄ game_data.py pattern), one
// pin per diagnostic code, and the TRUE-NEGATIVE law: the shipped real
// programs (ChipOS's 52-file disk, the Badger's 57-file disk) compile —
// they answer to ZERO error/warning-class diagnostics (hints are allowed:
// shipped code may carry an unused local).
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { analyzeProject, XC_SHIM_FUNCTIONS, XC_LANG_FUNCTIONS } from '../xcanalyze';
import { xenonComputers } from '../xenoncode';
import { listPlayerHuds, readPlayerHudProgram } from '../../../tools/vite-corpus';
import type { Blueprint } from '../format';
import type { XCFile } from '../xcproject';

const HERE = dirname(fileURLToPath(import.meta.url));
const XC_HOST = join(HERE, '../../../../tools/xenoncode/xc_host.cpp');
const XENON_HPP = join(HERE, '../../../../tools/xenoncode/upstream/XenonCode.hpp');
const CORPUS = join(HERE, '../../../../testdata');
const load = (id: string): Blueprint | null => {
  const p = join(CORPUS, id, 'blueprint.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
};
const f = (name: string, code: string): XCFile => ({ name, code });
const codes = (ds: ReturnType<typeof analyzeProject>) => ds.map(d => d.code).sort();

describe('vocabulary sync (the binary is the source of truth)', () => {
  it('every DeclareDeviceFunction name in xc_host.cpp is in XC_SHIM_FUNCTIONS', () => {
    const src = readFileSync(XC_HOST, 'utf8');
    const names = new Set<string>();
    for (const m of src.matchAll(/DeclareDeviceFunction\("([a-z_0-9]+)/g)) names.add(m[1]!);
    // the SCREEN-MEMBER table entries ({"button_circle($x…)", …}) are the
    // shim's second declaration site (v1.16.13: button_circle fired the
    // need — the analyzer knew nothing about it)
    for (const m of src.matchAll(/\{\s*"([a-z_0-9]+)\(/g)) names.add(m[1]!);
    // …and the panel()/beacon() member maps (panelMembers["set_position(…)"]
    // — the third declaration site, v1.14.1 slice B)
    for (const m of src.matchAll(/Members\["([a-z_0-9]+)/g)) names.add(m[1]!);
    expect(names.size).toBeGreaterThan(60);
    const missing = [...names].filter(n => !XC_SHIM_FUNCTIONS.has(n));
    expect(missing, 'shim declares functions missing from XC_SHIM_FUNCTIONS (update the list!)').toEqual([]);
  });
  it('every interpreter registration in XenonCode.hpp is in XC_LANG_FUNCTIONS', () => {
    const src = readFileSync(XENON_HPP, 'utf8');
    const names = new Set<string>();
    for (const m of src.matchAll(/\{\s*"([a-z_0-9]+)",\s*"\(/g))
      names.add(m[1]!);
    expect(names.size).toBeGreaterThan(30);
    const missing = [...names].filter(n => !XC_LANG_FUNCTIONS.has(n));
    expect(missing, 'interpreter functions missing from XC_LANG_FUNCTIONS (update the list!)').toEqual([]);
  });
});

describe('per-code diagnostics (synthetic programs)', () => {
  it('undeclared-function: @call with no function declaration', () => {
    const ds = analyzeProject([f('main.xc', 'init\n\t@no_such_fn(1)\n')]);
    expect(codes(ds)).toContain('xc-undeclared-function');
  });
  it('a DECLARED @function call is clean', () => {
    const ds = analyzeProject([f('main.xc',
      'function @helper($a : number) : number\n\treturn $a\ninit\n\tprint(@helper(1))\n')]);
    expect(codes(ds)).toEqual([]);
  });
  it('unknown-function / unknown-method', () => {
    const ds = analyzeProject([f('main.xc', 'init\n\tprint(made_up_fn(1))\n\tvar $s = screen(1, 0)\n\t$s.bogus_member(2)\n')]);
    expect(codes(ds)).toContain('xc-unknown-function');
    expect(codes(ds)).toContain('xc-unknown-method');
  });
  it('known device + language calls are clean', () => {
    const ds = analyzeProject([f('main.xc',
      'init\n\tprint(size("ab"))\n\tprint(input_number(1, 0))\n\tvar $s = screen(1, 0)\n\t$s.draw_rect(0, 0, 4, 4, white, red)\n\t$s.write(1, 1, white, "hi")\n')]);
    expect(codes(ds).filter(c => c === 'xc-unknown-function' || c === 'xc-unknown-method')).toEqual([]);
  });
  it('missing-return: result used, body has no return', () => {
    const ds = analyzeProject([f('main.xc',
      'function @loud($a : number) : number\n\tprint($a)\ninit\n\tvar $x = 0\n\t$x = @loud(2)\n')]);
    expect(codes(ds)).toContain('xc-missing-return');
  });
  it('missing-return: no return-type AND result used in a condition', () => {
    const ds = analyzeProject([f('main.xc',
      'function @ready()\n\tprint(1)\ninit\n\tif @ready()\n\t\tprint(2)\n')]);
    expect(codes(ds)).toContain('xc-missing-return');
  });
  it('a function called as a STATEMENT may lack a return (no false positive)', () => {
    const ds = analyzeProject([f('main.xc',
      'function @noise($a : number)\n\tprint($a)\ninit\n\t@noise(1)\n')]);
    expect(codes(ds).filter(c => c === 'xc-missing-return')).toEqual([]);
  });
  it('a declared return type with NO return is a defect even as a statement', () => {
    const ds = analyzeProject([f('main.xc',
      'function @loud($a : number) : number\n\tprint($a)\ninit\n\t@loud(1)\n')]);
    expect(codes(ds)).toContain('xc-missing-return');
  });
  it('unused-function / unused-var / unused-param hints', () => {
    const ds = analyzeProject([f('main.xc',
      'var $dead = 1\nfunction @never_called()\n\tprint(1)\nfunction @sink($p : number)\n\tprint(1)\ninit\n\t@sink(2)\nprint(@sink(3))\n')]);
    expect(codes(ds)).toContain('xc-unused-function');
    expect(codes(ds)).toContain('xc-unused-var');
    expect(codes(ds)).toContain('xc-unused-param');
  });
  it('a var written AND read is not flagged', () => {
    const ds = analyzeProject([f('main.xc',
      'var $n = 0\ninit\n\t$n = $n + 1\n\tprint($n)\n')]);
    expect(codes(ds).filter(c => c === 'xc-unused-var')).toEqual([]);
  });
  it('unknown-alias (device names not on the craft) + clean known alias', () => {
    const prog = 'init\n\tprint(input_number("ghost", 0))\n\tprint(input_number("lamp", 0))\n';
    const ds = analyzeProject([f('main.xc', prog)], { aliases: ['lamp'] });
    const alias = ds.filter(d => d.code === 'xc-unknown-alias');
    expect(alias).toHaveLength(1);
    expect(alias[0]!.message).toContain('ghost');
  });
  it('alias checks skipped when no alias census is given (router-less crafts)', () => {
    const ds = analyzeProject([f('main.xc', 'init\n\tprint(input_number("anything", 0))\n')]);
    expect(codes(ds).filter(c => c === 'xc-unknown-alias')).toEqual([]);
  });
  it('unknown-include / duplicate-function / duplicate-var', () => {
    const ds = analyzeProject([f('main.xc',
      'include "missing.xc"\nfunction @dup()\n\tprint(1)\nfunction @dup()\n\tprint(2)\nvar $v = 1\nvar $v = 2\ninit\n\t@dup()\nprint($v)\n')]);
    expect(codes(ds)).toContain('xc-unknown-include');
    expect(codes(ds)).toContain('xc-duplicate-function');
    expect(codes(ds)).toContain('xc-duplicate-var');
  });
  it('an include of a real disk file is clean', () => {
    const ds = analyzeProject([
      f('main.xc', 'include "lib.xc"\ninit\n\t@help()\n'),
      f('lib.xc', 'function @help()\n\tprint(1)\n')]);
    expect(codes(ds).filter(c => c === 'xc-unknown-include' || c === 'xc-undeclared-function')).toEqual([]);
  });
  it('string content and comments are not scanned as calls', () => {
    const ds = analyzeProject([f('main.xc',
      'init\n\tprint("made_up_in_string(1)")\n\t; fake_call(2)\n')]);
    expect(codes(ds).filter(c => c === 'xc-unknown-function')).toEqual([]);
  });
});

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

describe('THE ROOT-NAME LAW (v1.16.14 — the Human HUD beacon case)', () => {
  it('member use references the ROOT var ($beacon.data in tick uses $beacon)', () => {
    const ds = analyzeProject([f('main.xc',
      'var $beacon = beacon("tx", "rx")\n\ninit\n\t$beacon.transmit("hi")\n\ntick\n\tprint($beacon.data)\n')]);
    expect(ds.filter(d => d.code === 'xc-unused-var' && d.message.includes('beacon')))
      .toEqual([]);
  });
  it('the Human HUD disk (homo) flags NO beacon var as unused', () => {
    const prog = readPlayerHudProgram('homo');
    if (!prog) return;                       // machine-local floor
    const ds = analyzeProject(prog.files).filter(
      d => d.code === 'xc-unused-var' && d.message.includes('beacon'));
    expect(ds.map(d => d.message)).toEqual([]);
  });
});
