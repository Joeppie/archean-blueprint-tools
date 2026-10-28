// xcproject.test.ts — the IDE project model on the corpus's REAL syntax
// (3288012440's game.xc/space_helpers.xc shapes: `function @name($a:type)`,
// `include "file.xc"`, calls `@name(`).
import { describe, expect, it } from 'vitest';
import {
  blockAt, definitionOf, functionAt, functionTokenAt, includeOrder, projectBlocks, projectDecls, projectFunctions,
  type XCFile,
} from '../xcproject';

const game: XCFile = {
  name: 'game.xc',
  code: [
    ';#NODES {}',                                    // line 1
    'function @_draw_enemy($enemy:text)',            // 2
    '  $x = $enemy[0]',                              // 3
    '  @draw_rect($x, 0, 3, 3)',                     // 4
    '',                                              // 5
    'function @_draw_enemies()',                     // 6
    '  @foreach $e in $enemies: @draw($e)',          // 7
    '  @_draw_enemy("a")',                           // 8
    'const $score = 0',                              // 9
    'var $wave = 1',                                 // 10
  ].join('\n'),
};
const helpers: XCFile = {
  name: 'space_helpers.xc',
  code: 'function @hsv_to_color($h:number, $s:number, $v:number)\n  return 0\n',
};
const main: XCFile = {
  name: 'main.xc',
  code: [
    'include "space_helpers.xc"',                    // 1
    'include "game.xc"',                             // 2
    'include "game.xc"',                             // 3 duplicate
    'var $main_state = 0',                           // 4
    'function @return_to_title()',                   // 5
    '  @hsv_to_color(1, 1, 1)',                      // 6
  ].join('\n'),
};
const files = [main, game, helpers];

describe('function index', () => {
  const funcs = projectFunctions(files);

  it('finds @-prefixed declarations with params, file and lines', () => {
    const d = definitionOf(funcs, '@_draw_enemy')!;
    expect(d).toBeTruthy();
    expect(d.file).toBe('game.xc');
    expect(d.line).toBe(2);
    expect(d.display).toBe('@_draw_enemy($enemy:text)');
    // end = next declaration - 1
    expect(d.end).toBe(5);
    // last function of a file: body runs to EOF
    expect(definitionOf(funcs, 'return_to_title')!.end).toBe(6);
  });

  it('definitionOf tolerates the @ typed or not', () => {
    expect(definitionOf(funcs, 'hsv_to_color')!.file).toBe('space_helpers.xc');
    expect(definitionOf(funcs, '@hsv_to_color')!.file).toBe('space_helpers.xc');
    expect(definitionOf(funcs, 'nope')).toBeNull();
  });

  it('functionAt resolves the enclosing body (and step-over scope)', () => {
    expect(functionAt(funcs, 'game.xc', 4)!.name).toBe('_draw_enemy');
    expect(functionAt(funcs, 'game.xc', 3)!.name).toBe('_draw_enemy');
    expect(functionAt(funcs, 'game.xc', 9)).toBeNull();          // global scope
    expect(functionAt(funcs, 'game.xc', 8)!.name).toBe('_draw_enemies');
  });

  it('functionTokenAt hits @name at the caret (go-to-definition)', () => {
    const line = '  @foreach $e in $enemies: @draw($e)';
    expect(functionTokenAt(line, line.indexOf('@draw') + 2)).toBe('draw');
    expect(functionTokenAt(line, line.indexOf('@foreach') + 3)).toBe('foreach');
    expect(functionTokenAt(line, 0)).toBeNull();                 // leading spaces
  });
});

describe('include order = the SOURCEFILE file table', () => {
  it('entry first, includes BFS in statement order, deduped', () => {
    expect(includeOrder(files, 'main.xc')).toEqual(
      ['main.xc', 'space_helpers.xc', 'game.xc']);
  });
  it('missing includes keep their slot (indices never shift)', () => {
    const withMissing: XCFile = { name: 'm.xc', code: 'include "ghost.xc"\ninclude "h.xc"' };
    const order = includeOrder([withMissing, helpers], 'm.xc');
    expect(order[0]).toBe('m.xc');
    expect(order[1]).toBe('ghost.xc');      // slot preserved, unresolvable
    expect(order[2]).toBe('h.xc');
  });
});

describe('declaration scan (completion pool)', () => {
  const decls = projectDecls(files);
  const names = decls.map(d => d.name);

  it('captures globals AND function params', () => {
    expect(names).toContain('$score');
    expect(names).toContain('$wave');
    expect(names).toContain('$main_state');
    expect(names).toContain('$enemy');        // param of @_draw_enemy
    expect(names).toContain('$h');            // param of @hsv_to_color
  });
});

describe('BLOCK frames (v1.13.24 - update/tick/timer bodies are frames)', () => {
  // a real report: a break inside an `update` block said "top level" - the
  // block compiles as a named body WITH locals, the project model must see it
  const files: XCFile[] = [{
    name: 'main.xc',
    code: [
      'var $_plomo_counter1 : number',
      '',
      'update',
      '\tvar $_input_number_11_3 = input_number(11, 3)',
      '\t$_plomo_counter1 += 1',
      '',
      'timer frequency 4',
      '\tvar $change = input_number(11, 3)',
      '',
      'function @f($a:number):number',
      '\tvar $r = $a',
      '\treturn $r',
    ].join('\n'),
  }];
  it('finds block bodies with spans', () => {
    const blocks = projectBlocks(files);
    expect(blocks.map(b => b.label)).toEqual(['update', 'timer frequency 4']);
    expect(blocks[0]!.line).toBe(3);
    expect(blocks[0]!.end).toBe(6);          // next global-scope line - 1
  });
  it('blockAt resolves inside, not outside; innermost wins', () => {
    const blocks = projectBlocks(files);
    expect(blockAt(blocks, 'main.xc', 5)?.label).toBe('update');
    expect(blockAt(blocks, 'main.xc', 8)?.label).toBe('timer frequency 4');
    expect(blockAt(blocks, 'main.xc', 1)).toBeNull();    // top level
    expect(blockAt(blocks, 'main.xc', 11)).toBeNull();   // a function body is not a block
  });
});

// ── LIBRARY INDEX (v1.13.25): the table the IDE's Library tab renders.
// The lockstep pin is the law: every completion-pool name has exactly one
// doc row, and the table never invents a function the pool does not offer.
import { libIndex, XC_LIB_DOC, XC_LIB_FNS, XC_SCREEN_MEMBERS } from '../xcproject';

describe('library index (XC_LIB_DOC ⇄ XC_LIB_FNS lockstep)', () => {
  it('covers every library function exactly once', () => {
    const names = XC_LIB_DOC.map(f => f.name);
    expect(names.length).toBe(new Set(names).size);          // no duplicates
    expect([...names].sort()).toEqual([...XC_LIB_FNS].sort());
  });
  it('every row has a signature starting with its name and a summary', () => {
    for (const f of XC_LIB_DOC) {
      expect(f.sig.startsWith(f.name), f.name).toBe(true);
      expect(f.desc.trim().length, f.name).toBeGreaterThan(8);
      expect(f.group.trim().length, f.name).toBeGreaterThan(0);
    }
  });
  it('libIndex filters over name, signature, description and group', () => {
    expect(libIndex('').length).toBe(XC_LIB_DOC.length);
    expect(libIndex('PRINT').map(f => f.name)).toEqual(['print']);
    expect(libIndex('worldsim').every(f => f.group === 'worldsim')).toBe(true);
    expect(libIndex('cable').length).toBeGreaterThan(0);     // description match
    expect(libIndex('zzzz')).toEqual([]);
  });
  it('screen members are unique and non-empty', () => {
    expect(new Set(XC_SCREEN_MEMBERS).size).toBe(XC_SCREEN_MEMBERS.length);
    expect(XC_SCREEN_MEMBERS).toContain('write');
  });
});

// ── v1.13.26 helpers: group tabs, block-open lines, io-call hit test
import { ioCallAt, opensBlockLine, XC_LIB_GROUPS } from '../xcproject';

describe('library group tabs', () => {
  it('group keys cover the function groups PLUS the three constant kinds', () => {
    const groups = new Set(XC_LIB_DOC.map(f => f.group));
    expect(new Set(XC_LIB_GROUPS.map(g => g.key)))
      .toEqual(new Set([...groups, 'color', 'align', 'math']));
    for (const g of XC_LIB_GROUPS) expect(g.color).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('opensBlockLine (Enter auto-indent law)', () => {
  it('opens on block keywords, function declarations and control flow', () => {
    for (const l of ['init', 'update', '  tick', 'timer frequency 4', 'input 11',
      'screen("TrimsDash", 0)', 'function @helper($a:number)',
      'recursive function @fib($n:number):number',
      'if input_number(11,17) == 1', '\tif $x > 2', 'elseif $y', 'else',
      'while $run', 'repeat', 'for $i = 1 to 5', 'foreach $e in $enemies'])
      expect(opensBlockLine(l), l).toBe(true);
  });
  it('does not open on bodies, calls, blank or indented statements', () => {
    for (const l of ['', '  $x = 1', 'output_number("Engine", 0)', 'const $a = 1',
      '@helper(1)', 'var $v = 0', '; init note', '  endif', 'endfor',
      'verified = true', 'form = 1', 'important = 2'])
      expect(opensBlockLine(l), l).toBe(false);
  });
});

describe('ioCallAt (io hover hit test)', () => {
  const line = '  output_number("PitchControlJunction", 1, -$pitch)';
  it('fires on the function name, not past the args', () => {
    expect(ioCallAt(line, 4)?.fn).toBe('output_number');
    expect(ioCallAt(line, 22)?.fn).toBe('output_number');   // alias string too
    expect(ioCallAt(line, line.length + 3)).toBeNull();
    expect(ioCallAt('  $x = 1 + 2', 4)).toBeNull();
  });
  it('parses alias-text and io-number first args + the channel', () => {
    expect(ioCallAt(line, 4)).toEqual({ fn: 'output_number', arg: 'PitchControlJunction', channel: 1 });
    expect(ioCallAt('input_number(11, 3)', 2))
      .toEqual({ fn: 'input_number', arg: '11', channel: 3 });
    expect(ioCallAt('input_text("ui")', 2)).toBeNull();      // no channel arg
  });
  it('spans of TWO calls on one line resolve independently', () => {
    const two = 'print(text(input_number("a", 1)))';
    expect(ioCallAt(two, 2)).toBeNull();          // print is NOT an io call
    expect(ioCallAt(two, 20)?.fn).toBe('input_number');
  });
});

// ── v1.13.27 global constants: lockstep with THE SHIM (the ground truth)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { XC_GLOBAL_CONSTS } from '../xcproject';

describe('XC_GLOBAL_CONSTS ⇄ xc_host.cpp lockstep', () => {
  it('names every DeclareGlobalConstant the shim makes, and no others', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../../../../tools/xenoncode/xc_host.cpp', import.meta.url)),
      'utf8');
    const shim = [...src.matchAll(/DeclareGlobalConstant\("([\w.]+)"/g)].map(m => m[1]!);
    expect([...XC_GLOBAL_CONSTS.map(c => c.name)].sort())
      .toEqual([...new Set(shim)].sort());
  });
  it('every color has a #rrggbb swatch; align/math have none', () => {
    for (const c of XC_GLOBAL_CONSTS) {
      if (c.kind === 'color') expect(c.hex, c.name).toMatch(/^#[0-9a-f]{6}$/);
      else expect(c.hex, c.name).toBeUndefined();
      expect(c.desc.length, c.name).toBeGreaterThan(3);
    }
  });
});
