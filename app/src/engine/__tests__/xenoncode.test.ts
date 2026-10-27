// xenoncode.test.ts — the pure half of the XenonCode seam (engine/xenoncode.ts):
// the blueprint extraction, the dev-mode tokenizer, the #NODES graph and the
// input-channel detection all run headless; the wasm pump itself is pinned
// in e2e/xenon.spec.ts (browser: WASM + canvas pixels).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  detectChannels, parseNodes, tokenize, xenonComputers, xenonScreens,
} from '../xenoncode';
import type { Blueprint } from '../format';

const REPO = new URL('../../../../', import.meta.url).pathname;   // mass.test.ts pattern
const data = (id: string): Blueprint =>
  JSON.parse(readFileSync(`${REPO}testdata/${id}/blueprint.json`, 'utf8')) as Blueprint;
const xc = (f: string) => readFileSync(`${REPO}tools/xenoncode/${f}`, 'utf8');

describe('blueprint extraction', () => {
  it('finds the MiniComputer of Just-Plane-Easy with its program files', () => {
    const comps = xenonComputers(data('3294880085'));
    expect(comps).toHaveLength(1);
    const c = comps[0]!;
    expect(c.program).toBe('FirstFlight');
    expect(c.files[0]!.name).toBe('main.xc');          // the entry renames
    expect(c.files[0]!.code).toContain('update');
    expect(c.files.map(f => f.name)).toContain('functions.xc');
    expect(c.channels.length).toBeGreaterThan(3);
  });
  it('the Cheap Exploration Plane carries its node program + io 8 channels', () => {
    const comps = xenonComputers(data('3327182790'));
    expect(comps).toHaveLength(1);
    const c = comps[0]!;
    expect(c.files[0]!.code).toContain('#NODES');
    expect(c.channels).toEqual(expect.arrayContaining([{ io: 8, ch: 1 }]));
    expect(c.channels.every(ch => ch.io === 8 || ch.io === 11)).toBe(true);
  });
  it('screen(alias, ch) binds to the Dashboard Screen/HdScreen elements', () => {
    const bp = data('3281212435');                     // Code Wizard tutorial
    const screens = xenonScreens(bp, 'screen');
    expect(screens.length).toBe(1);                    // one HdScreen element
    expect(screens[0]).toMatchObject({ alias: 'screen', channel: 0, w: 51, h: 51 });
    expect(xenonScreens(bp, 'no-such-dash')).toEqual([]);
  });
  it('channels are unique and sorted', () => {
    const chs = detectChannels([
      { name: 'main.xc', code: 'x = input_number(11, 2)\ny = input_number(1, 7)\nz = input_number(11,2)' },
    ]);
    expect(chs).toEqual([{ io: 1, ch: 7 }, { io: 11, ch: 2 }]);
  });
});

describe('tokenizer (the dev mode: www/xc_mode.js + tmLanguage)', () => {
  const types = (line: string) => tokenize(line).filter(t => t.t !== 'txt').map(t => t.t);
  it('keywords, variables, types and comments split apart', () => {
    expect(types('storage array $map : text')).toEqual(
      ['kw', 'kw', 'var', 'op', 'kw']);
    expect(types('; a comment with $var and 42')).toEqual(['com']);
    expect(types('if $a == 5')).toEqual(['kw', 'var', 'op', 'num']);
    expect(types('$dash.write(0, 0, white, "Hi {} there", $x)')).toContain('var');
  });
  it('entry points and control words are keywords', () => {
    for (const w of ['update', 'tick', 'init', 'timer', 'foreach', 'repeat',
      'recursive', 'function', 'output', 'break', 'click_hold'])
      expect(types(w), w).toContain('kw');
  });
  it('format spans inside strings are fmt tokens', () => {
    const toks = tokenize('$t = text("A {0.00} B {}", $a, $b)');
    expect(toks.filter(t => t.t === 'fmt').map(t => t.s)).toEqual(['{0.00}', '{}']);
    expect(toks.filter(t => t.t === 'str').map(t => t.s).join('')).toContain('A ');
  });
  it('functions are fn, numbers stay one token, operators group', () => {
    expect(types('@myFn($a, $b)')).toEqual(['fn', 'var', 'var']);
    expect(types('$x = 1.5e-3')).toContain('num');
    expect(tokenize('$x = 1.5e-3').find(t => t.t === 'num')!.s).toBe('1.5e-3');
  });
  it('a whole real file tokenizes without swallowing text', () => {
    const code = xc('FirstFlight.main.xc');
    const joined = code.split('\n').map(l => tokenize(l).map(t => t.s).join('')).join('\n');
    expect(joined).toBe(code);                         // lossless
  });
});

describe('#NODES graph', () => {
  it('parses the airplane node program: boxes, ports, wires', () => {
    const g = parseNodes([{ name: 'main.xc', code: xc('FirstFlight.main.xc') }]);
    expect(g).not.toBeNull();
    expect(g!.nodes.length).toBeGreaterThan(8);
    const ids = new Set(g!.nodes.map(n => n.id));
    for (const l of g!.links) {
      expect(ids.has(l.from)).toBe(true);              // every wire resolves
      expect(ids.has(l.to)).toBe(true);
    }
    const kinds = new Set(g!.nodes.map(n => n.type));
    expect(kinds).toContain('InputNode');
    expect(kinds).toContain('OutputNode');
    expect([...kinds].some(k => k.startsWith('MathNode'))).toBe(true);
    const input = g!.nodes.find(n => n.type === 'InputNode')!;
    expect(input.channel).toBeTypeOf('number');        // the io channel it reads
    for (const n of g!.nodes) {
      expect(n.w).toBeGreaterThan(0);
      expect(n.h).toBeGreaterThan(0);
    }
  });
  it('the Cheap Exploration Plane graph (CounterNode) parses from the blueprint', () => {
    const comps = xenonComputers(data('3327182790'));
    const g = parseNodes(comps[0]!.files);
    expect(g!.nodes.some(n => n.type === 'CounterNode')).toBe(true);
  });
  it('no marker → null', () => {
    expect(parseNodes([{ name: 'main.xc', code: 'tick\n\tprint("x")' }])).toBeNull();
  });
});
