// xcanalyze.test.ts — THE XENONCODE ANALYZER's pure pins (v1.16.13; the
// xenoncore package era, P10-S1): vocabulary sync against the C++ sources
// (the mass.ts ⇄ game_data.py pattern) and one pin per diagnostic code.
// The corpus TRUE-NEGATIVE legs (real disks, player-HUD disks) ride in the
// APP as xcanalyze.integration.test.ts — the package never imports the
// blueprint reader.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { analyzeProject, XC_SHIM_FUNCTIONS, XC_LANG_FUNCTIONS } from '../xcanalyze';
import type { XCFile } from '../xcproject';

const HERE = dirname(fileURLToPath(import.meta.url));
function repoRoot(): string {
  let d = HERE;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(d, 'tools', 'xenoncode', 'xc_host.cpp'))) return d;
    d = join(d, '..');
  }
  throw new Error('tools/xenoncode/xc_host.cpp not found above the test file');
}
const ROOT = repoRoot();
const XC_HOST = join(ROOT, 'tools/xenoncode/xc_host.cpp');
const XENON_HPP = join(ROOT, 'tools/xenoncode/upstream/XenonCode.hpp');
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

describe('THE ROOT-NAME LAW (v1.16.14 — the Human HUD beacon case)', () => {
  it('member use references the ROOT var ($beacon.data in tick uses $beacon)', () => {
    const ds = analyzeProject([f('main.xc',
      'var $beacon = beacon("tx", "rx")\n\ninit\n\t$beacon.transmit("hi")\n\ntick\n\tprint($beacon.data)\n')]);
    expect(ds.filter(d => d.code === 'xc-unused-var' && d.message.includes('beacon')))
      .toEqual([]);
  });
});
