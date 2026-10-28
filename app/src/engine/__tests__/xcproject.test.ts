// xcproject.test.ts — the IDE project model on the corpus's REAL syntax
// (3288012440's game.xc/space_helpers.xc shapes: `function @name($a:type)`,
// `include "file.xc"`, calls `@name(`).
import { describe, expect, it } from 'vitest';
import {
  definitionOf, functionAt, functionTokenAt, includeOrder, projectDecls, projectFunctions,
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
