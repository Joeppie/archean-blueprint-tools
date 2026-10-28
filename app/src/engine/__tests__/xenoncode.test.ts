// xenoncode.test.ts — the pure half of the XenonCode seam (engine/xenoncode.ts):
// the blueprint extraction, the dev-mode tokenizer, the #NODES graph and the
// input-channel detection all run headless; the wasm pump itself is pinned
// in e2e/xenon.spec.ts (browser: WASM + canvas pixels).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  chanInfo, detectChannels, parseNodes, PILOT_KEYS, tokenize, xenonComputers, xenonScreens,
} from '../xenoncode';
import channelsJson from '../../../../viewer/models/channels.json';
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
    // the io ports are the data_port.0NN cables: 11 = PilotSeat, 8 = wheel
    const io = new Map(c.devices.filter(d => d.io >= 0).map(d => [d.io, d.type]));
    expect(io.get(11)).toBe('PilotSeat');
    expect(io.get(8)).toBe('SmallWheel');
    expect(io.get(0)).toBe('Aileron');
  });
  it('the Badger: 57 files, program-less main.xc, alias-addressed devices', () => {
    const comps = xenonComputers(data('3326372833'));
    expect(comps).toHaveLength(1);
    const c = comps[0]!;
    expect(c.files.length).toBe(57);
    expect(c.files[0]!.name).toBe('main.xc');          // program='' fallback law
    expect(c.files[0]!.code).toContain('Smart Quad');
    expect(c.capacity).toBeGreaterThan(0);
    expect(c.screens.length).toBeGreaterThan(5);       // dashboard + override screens
    expect(c.screens.some(s => s.alias === 'pilot-screen')).toBe(true);
    expect(c.screens.some(s => s.alias === 'systems-dashboard' && s.w === 150)).toBe(true);  // 25-unit at 6 px/unit
    expect(c.devices.some(d => d.alias === 'mining-drill')).toBe(true);
    expect(c.devices.some(d => d.alias === 'left-cargo')).toBe(true);
  });
  it('screen(alias, ch) binds to the Dashboard Screen/HdScreen elements', () => {
    const bp = data('3281212435');                     // Code Wizard tutorial
    const files = xenonComputers(bp)[0]!.files;
    const screens = xenonScreens(bp, files, xenonComputers(bp)[0]!.ci);
    expect(screens.length).toBe(1);                    // one HdScreen element
    // v1.13.x: the registration key is the program's LITERAL token (the shim
    // keys surfaces by it — this craft calls screen(0,0)); label is human.
    expect(screens[0]).toMatchObject({ alias: '0', label: 'screen', channel: 0, w: 300, h: 300 });  // 50×50 units at 6 px/unit
    // an alias with no component on the craft -> not pre-registered; the
    // shim auto-creates its surface at boot (no crash, honest empty list)
    expect(xenonScreens(bp, [{ name: 'main.xc', code: 'var $s = screen("no-such", 0)' }])).toEqual([]);
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

describe('io → component + channel meanings (the game wiki table)', () => {
  const CH = channelsJson as unknown as Record<string, Record<string, Record<string, { fn: string; rng: string }>>>;
  it('resolves the shipped table for the classic channels', () => {
    expect(chanInfo(CH, 'PilotSeat', 'out', 1)?.fn).toBe('Backward/Forward');
    expect(chanInfo(CH, 'NavInstrument', 'out', 6)?.fn).toBe('Heading');
    expect(chanInfo(CH, 'NavInstrument', 'out', 8)?.fn).toContain('Latitude');
    expect(chanInfo(CH, 'MiningDrill', 'out', 3)?.fn).toBe('MiningRate');
    expect(chanInfo(CH, 'SmallWheel', 'in', 1)?.fn).toBe('Steer');
    expect(chanInfo(CH, 'NoComponent', 'out', 1)).toBeNull();
    expect(chanInfo(CH, 'ThrottleLever', 'out', 1)).toBeNull();   // no table in the wiki
  });
  it('detectChannels sees alias-addressed reads (computer.md aliasOrIoNumber)', () => {
    const chs = detectChannels([
      { name: 'm.main.xc', code: 'input_number(3, 6)\ninput_number("mining-drill", 3)\ninput_number(3,6)' },
    ]);
    expect(chs).toEqual([{ io: 3, ch: 6 }, { io: 'mining-drill', ch: 3 }]);
  });
  it('detectChannels sees input_text reads (the PilotSeat user-token channel)', () => {
    // Chip's Mario gates ALL input on `input_text("gamer-chair", 0)` being
    // seated; that channel must be a worldsim row (default '1') to play.
    const chs = detectChannels([
      { name: 'm.main.xc', code: 'input_text("gamer-chair", 0)\ninput_number("gamer-chair", 2)' },
    ]);
    expect(chs).toEqual([{ io: 'gamer-chair', ch: 0 }, { io: 'gamer-chair', ch: 2 }]);
  });
  it('the cockpit PilotSeat channels the pilot keys answer are all DETECTED on Mario', async () => {
    // 3820116990 (PKC-385 'Super Mario Brothers'): gamer-chair is a PilotSeat;
    // the game reads ch 1 (Backward/Forward), 2 (Left/Right), 3 (Down/Up),
    // 8 (Aux 1) — the exact four PILOT_KEYS words. detectChannels must
    // surface them, so pump.buildWorldSim can bind the flight keys.
    const fs = await import('fs');
    const bp = JSON.parse(fs.readFileSync(new URL(
      '../../../../testdata/3820116990/blueprint.json', import.meta.url)).toString());
    const { xenonComputers } = await import('../xenoncode');
    const comp = xenonComputers(bp)[0];
    if (!comp) throw new Error('the Mario craft must expose a computer');
    expect(comp).toBeTruthy();
    const seat = comp.devices.find(d => d.type === 'PilotSeat');
    expect(seat?.alias).toBe('gamer-chair');
    const seatChs = comp.channels.filter(c => c.io === 'gamer-chair').map(c => c.ch);
    for (const ch of [1, 2, 3, 8]) expect(seatChs).toContain(ch);
    // the game's music is BUZZER components driven by output_number
    expect(comp.devices.filter(d => d.type === 'Buzzer').length).toBeGreaterThan(3);
  });
});

describe('THE FULL COCKPIT KEY LAW (v1.13.8)', () => {
  // we: "we need keyboard binds available also for the other keys cockpits
  // can give" — every documented PilotSeat output word (wiki PilotSeat.md,
  // packed into channels.json) must answer a keyboard key, so a seat row
  // exists for the key to drive (engine/xenoncode.ts PILOT_KEYS).
  const seat = (channelsJson as any).PilotSeat?.out ?? {};
  it('every PilotSeat channel word maps to at least one key', () => {
    const unmapped = Object.entries(seat)
      .map(([ch, v]) => [ch, String((v as any).fn ?? '').toLowerCase()] as const)
      .filter(([, fn]) => fn !== 'using' && !PILOT_KEYS[fn]);
    expect(unmapped).toEqual([]);
  });
  it('SPACE feeds the Down/Up stick channel (arcade "Press SPACE" reads ch 3)', () => {
    // 3288012440 (Space Invaders arcade) gates its whole game on
    // input_number(10,3)==1 — Space must reach the seat's Up, not just Aux 1.
    expect(PILOT_KEYS['down/up']).toMatchObject({ up: 1, down: -1, space: 1 });
    expect(PILOT_KEYS['aux 1']).toMatchObject({ f: 1, space: 1 });   // Mario keeps it
  });
  it('the stick signs are the game\'s (press = ±1 about the channel centre)', () => {
    expect(PILOT_KEYS['backward/forward']).toMatchObject({ w: 1, s: -1 });
    expect(PILOT_KEYS['left/right']).toMatchObject({ d: 1, a: -1 });
    expect(PILOT_KEYS['pitch']).toMatchObject({ i: 1, k: -1 });
    expect(PILOT_KEYS['roll']).toMatchObject({ e: 1, q: -1 });
    expect(PILOT_KEYS['yaw']).toMatchObject({ l: 1, j: -1 });
  });
  it('the Aux ladder: digits 1-9 then 0 for Aux 1..9 and Aux 0', () => {
    for (const [word, key] of [['aux 1', 'digit1'], ['aux 2', 'digit2'], ['aux 3', 'digit3'],
      ['aux 4', 'digit4'], ['aux 5', 'digit5'], ['aux 6', 'digit6'], ['aux 7', 'digit7'],
      ['aux 8', 'digit8'], ['aux 9', 'digit9'], ['aux 0', 'digit0']] as const)
      expect(PILOT_KEYS[word]).toMatchObject({ [key]: 1 });
  });
});
