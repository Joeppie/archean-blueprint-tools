// xcsites.test.ts — the popup label's program scanner (v1.15.6, we: "it
// should tell us … which xenoncode line the specific e.g. button_rect and
// line number and computer this corresponds to as a popup label").
import { describe, expect, test } from 'vitest';
import { chanSites, rectSites, rectsAt } from '../xcsites';

const f = (name: string, code: string) => ({ name, code });

describe('chanSites — literal (io, ch) call sites', () => {
  test('finds input/output reads and writes with 1-based lines', () => {
    const sites = chanSites([f('main.xc',
      'tick\n\t$angle = input_number(3, 0)\n\toutput_number(3, 1, $speed)\n')]);
    expect(sites).toEqual([
      { io: 3, ch: 0, dir: 'in', fn: 'input_number', file: 'main.xc', line: 2 },
      { io: 3, ch: 1, dir: 'out', fn: 'output_number', file: 'main.xc', line: 3 },
    ]);
  });
  test('alias-keyed calls ride too (computer.md alias addressing)', () => {
    const sites = chanSites([f('a.xc', 'var $v = input_text("gamer-chair", 0)\n')]);
    expect(sites[0]).toMatchObject({ io: 'gamer-chair', ch: 0, dir: 'in', line: 1 });
  });
  test('expression args are not sites (a scanner, not an AST)', () => {
    expect(chanSites([f('a.xc', 'input_number($io, 0)\n')])).toEqual([]);
  });
});

describe('rectSites — the draw-order button law', () => {
  test('bare button_rect literals → plain-screen target', () => {
    const sites = rectSites([f('main.xc',
      'tick\n\tif button_rect(25, 150, 150, 30, color(120,120,120))\n')]);
    expect(sites).toEqual([
      { kind: 'button_rect', x: 25, y: 150, w: 150, h: 30, target: '', file: 'main.xc', line: 2 },
    ]);
  });
  test('$var.button_rect binds to the var screen() target', () => {
    const code = 'var $s = screen("dash", 3)\ntick\n\tif $s.button_rect(0, 0, 40, 10, gray)\n';
    const sites = rectSites([f('main.xc', code)]);
    expect(sites[0]).toMatchObject({ target: 'dash#3', line: 3 });
  });
  test('legacy button(x, y, color, w, h) reads w/h from args 4/5', () => {
    const sites = rectSites([f('m.xc', 'if button(10, 10, red, 30, 30)\n')]);
    expect(sites[0]).toMatchObject({ kind: 'button', x: 10, y: 10, w: 30, h: 30 });
  });
  test('rectsAt: draw order decides — the LAST containing rect wins', () => {
    const sites = rectSites([f('m.xc',
      'if button_rect(0, 0, 100, 50, red)\nif button_rect(50, 0, 50, 50, blue)\n')]);
    const hits = rectsAt(sites, 'main#0', 60, 10);
    expect(hits.length).toBe(2);
    expect(hits[hits.length - 1]).toMatchObject({ x: 50 });
    expect(rectsAt(sites, 'main#0', 120, 10)).toEqual([]);   // outside
    expect(rectsAt(sites, 'dash#1', 60, 10)).toEqual([]);    // other surface
  });
});
