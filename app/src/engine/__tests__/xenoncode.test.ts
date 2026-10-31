// xenoncode.test.ts — the pure half of the XenonCode seam (engine/xenoncode.ts):
// the blueprint extraction, the dev-mode tokenizer, the #NODES graph and the
// input-channel detection all run headless; the wasm pump itself is pinned
// in e2e/xenon.spec.ts (browser: WASM + canvas pixels).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  xenonDevices,
  chanInfo, detectChannels, parseNodes, PILOT_KEYS, sabSupported, stepperLaw, tokenize,
  xenonComputers, xenonScreens, XenonWorkerRun,
} from '../xenoncode';
import channelsJson from '../../../../viewer/models/channels.json';
import { craftPowerNet, computerPowered } from '../power';
import type { Blueprint } from '../format';

const REPO = new URL('../../../../', import.meta.url).pathname;   // mass.test.ts pattern
const data = (id: string): Blueprint =>
  JSON.parse(readFileSync(`${REPO}testdata/${id}/blueprint.json`, 'utf8')) as Blueprint;
const xc = (f: string) => readFileSync(`${REPO}tools/xenoncode/${f}`, 'utf8');

describe('THE FRESH-COMPUTER LISTING GATE (v1.13.20)', () => {
  // we: "When I place a new minicomputer, I dont get a xenoncode menu for
  // the computer, and I cannot write code for it as a consequence!" — a
  // placed component carries data {} (newcraft.ts); requiring an .xc file
  // before listing hid the menu AND the only path to write the first file.
  const fresh = (type: string, dataJson = '{}'): Blueprint => JSON.parse(
    '{"author":"jo","data":{"blocks":[],"components":['
    + `{"alias":"","colors":{"color1":{"r":1,"g":1,"b":12,"opacity":15,"roughness":4,"metallic":0}},`
    + `"data":${dataJson},"module":"computers","occupancies":[],`
    + '"orientation":{"w":1,"x":0,"y":0,"z":0},"position":{"x":1,"y":2,"z":3},"type":"' + type + '"}'
    + '],"pipes":[],"triangles":[],"version":2}}') as Blueprint;

  it('a placed MiniComputer (data {}, no hdd at all) IS listed', () => {
    const comps = xenonComputers(fresh('MiniComputer'));
    expect(comps).toHaveLength(1);
    const c = comps[0]!;
    expect(c.entryName).toBe('main.xc');                    // the blank tab
    expect(c.files).toEqual([{ name: 'main.xc', code: '' }]);
    expect(c.program).toBe('main');
    expect(c.alias).toBe('minicomputer-0');                 // inspector N law
    expect(c.builtin).toBeUndefined();                      // authored, not built-in
  });

  it('an EMPTY xc_files array lists the same (hdd present, disk blank)', () => {
    const comps = xenonComputers(fresh('MiniComputer',
      '{"hdd":{"capacity":1024,"label":"","xc_files":[]},"program":"","version":2}'));
    expect(comps).toHaveLength(1);
    expect(comps[0]!.files).toEqual([{ name: 'main.xc', code: '' }]);
    expect(comps[0]!.capacity).toBe(1024);
  });

  it('a placed Computer is listed too, with its integrated-screen entry', () => {
    const comps = xenonComputers(fresh('Computer'));
    expect(comps).toHaveLength(1);
    expect(comps[0]!.alias).toBe('computer-0');
    expect(comps[0]!.screens.some(s => s.deviceScreen)).toBe(true);
  });

  it('the label distinguishes TWO fresh computers (both alias-less)', () => {
    const bp = fresh('MiniComputer');
    (bp.data.components as any[]).push((bp.data.components as any[])[0]);
    const aliases = xenonComputers(bp).map(c => c.alias);
    expect(aliases).toEqual(['minicomputer-0', 'minicomputer-1']);
  });

  it('a non-computer part is NOT listed (the gate is not gone)', () => {
    expect(xenonComputers(fresh('PilotSeat', '{}'))).toHaveLength(0);
    expect(xenonComputers(fresh('Lamp', '{}'))).toHaveLength(0);
  });

  it('a Crafter with an empty disk keeps its synthesized built-in (unchanged)', () => {
    const comps = xenonComputers(fresh('Crafter', '{}'));
    expect(comps).toHaveLength(1);
    expect(comps[0]!.builtin).toBe(true);
  });
});

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

// v1.13.17 P2b (L5): THE STEPPER LAW — the pair-stream walk the main-thread
// pump applies per cycle; xc_host.cpp's EM_JS hook evaluates the SAME law
// mid-cycle in worker mode (SAB protocol). Pinned here so a drift in either
// reading of the LAW (over = same-file fresh pair at depth <= paused depth ·
// into = any fresh pair · to = exact pair · breaks = exact, keep the step
// mode) fails at unit tier. XENON-DEBUG v3: the pair stream gained the
// parallel CALL-DEPTH stream (we: "When I press f10, it steps into, not
// over a function") — depths is index-aligned; a missing/short depths
// array degrades to depth 0 (the v1.13.28 file-only law).
describe('THE STEPPER LAW (dual-site: applyCycle walk ⇄ EM_JS hook)', () => {
  const FT = ['main.xc', 'game.xc'];
  const pair = (f: number, l: number) => f * 1_000_000 + l;
  const S = (o: Partial<Parameters<typeof stepperLaw>[4]> = {}) => ({
    stepMode: 'off', pausedFile: 'main.xc', pausedLine: 0, pausedDepth: 0,
    toFile: '', toLine: 0, scope: null, ...o,
  } as Parameters<typeof stepperLaw>[4]);

  it('idle: no pairs, or no step mode and no breakpoints ⇒ no stop', () => {
    expect(stepperLaw([], undefined, FT, new Map(), S({ stepMode: 'into' }))).toBeNull();
    expect(stepperLaw([pair(0, 5)], undefined, FT, new Map(), S())).toBeNull();
  });
  it('a breakpoint stops AT the exact pair and KEEPS an armed step mode', () => {
    const breaks = new Map([['game.xc', new Set([42])]]);
    const h = stepperLaw([pair(0, 7), pair(1, 42), pair(0, 8)], undefined, FT, breaks,
      S({ stepMode: 'into', pausedFile: 'main.xc', pausedLine: 7 }));
    expect(h).toEqual({ file: 'game.xc', line: 42, stepMode: 'into', depth: 0 });
  });
  it('runTo stops on the EXACT (file,line) and disarms', () => {
    const st = S({ stepMode: 'to', toFile: 'game.xc', toLine: 20 });
    expect(stepperLaw([pair(0, 3), pair(1, 19)], undefined, FT, new Map(), st)).toBeNull();
    expect(stepperLaw([pair(1, 20)], undefined, FT, new Map(), st))
      .toEqual({ file: 'game.xc', line: 20, stepMode: 'off', depth: 0 });
  });
  it('into (F11): the FIRST fresh pair anywhere — the re-stop on the same pair (loop line) is not fresh', () => {
    const st = S({ stepMode: 'into', pausedFile: 'main.xc', pausedLine: 10 });
    expect(stepperLaw([pair(0, 10), pair(0, 10)], undefined, FT, new Map(), st)).toBeNull();
    expect(stepperLaw([pair(0, 10), pair(1, 2)], undefined, FT, new Map(), st))
      .toEqual({ file: 'game.xc', line: 2, stepMode: 'off', depth: 0 });   // steps INTO the @call file
  });
  it('over (F10, v1.13.28 CLASSIC law): stops at the first FRESH pair of the SAME file — the next line at the current frame; other-file calls are stepped OVER', () => {
    const st = S({
      stepMode: 'over', pausedFile: 'main.xc', pausedLine: 83,
      scope: { file: 'main.xc', line: 83, end: 120 },
    });
    // a call into ANOTHER file's body is stepped over (no stop in there)
    expect(stepperLaw([pair(1, 5), pair(1, 60)], undefined, FT, new Map(), st)).toBeNull();
    // the frame returns to OUR file: stop at the caller's next line
    expect(stepperLaw([pair(1, 5), pair(0, 84)], undefined, FT, new Map(), st))
      .toEqual({ file: 'main.xc', line: 84, stepMode: 'off', depth: 0 });
    // the re-stop on the SAME pair (a loop line executing again) is not fresh
    expect(stepperLaw([pair(0, 83)], undefined, FT, new Map(), st)).toBeNull();
    // a loop wrapping to an EARLIER line of our file is a fresh stop
    expect(stepperLaw([pair(0, 40)], undefined, FT, new Map(), st))
      .toEqual({ file: 'main.xc', line: 40, stepMode: 'off', depth: 0 });
  });
  it('over at TOP LEVEL (scope null): same-file fresh pairs stop, callee files step over', () => {
    const st = S({ stepMode: 'over', pausedFile: 'main.xc', pausedLine: 17, scope: null });
    expect(stepperLaw([pair(0, 17)], undefined, FT, new Map(), st)).toBeNull();
    expect(stepperLaw([pair(1, 4)], undefined, FT, new Map(), st)).toBeNull();
    expect(stepperLaw([pair(0, 18)], undefined, FT, new Map(), st))
      .toEqual({ file: 'main.xc', line: 18, stepMode: 'off', depth: 0 });
  });
  // XENON-DEBUG v3 (v1.13.31, workpackages WP4, we: "When I press f10, it
  // steps into, not over a function"): the depth stream makes the SAME-FILE
  // callee law real — a callee body (pausedDepth+1) is stepped OVER.
  it('over + depth (v3): an IN-FILE callee (depth+1) is stepped OVER, the return stops', () => {
    const st = S({ stepMode: 'over', pausedFile: 'main.xc', pausedLine: 10, pausedDepth: 0 });
    // main.xc:10 calls @move (main.xc:41-43); the caller's line 11 follows
    const pairs = [pair(0, 41), pair(0, 42), pair(0, 43), pair(0, 11)];
    const depths = [1, 1, 1, 0];
    expect(stepperLaw(pairs, depths, FT, new Map(), st))
      .toEqual({ file: 'main.xc', line: 11, stepMode: 'off', depth: 0 });
  });
  it('over + depth (v3): from INSIDE a frame the body continues at the same depth; a nested call is stepped over; the return into the caller (depth-1, same file) stops', () => {
    const st = S({ stepMode: 'over', pausedFile: 'main.xc', pausedLine: 42, pausedDepth: 1 });
    // @move body line 43 (depth 1) — the next line at MY frame: a stop
    expect(stepperLaw([pair(0, 43)], [1], FT, new Map(), st))
      .toEqual({ file: 'main.xc', line: 43, stepMode: 'off', depth: 1 });
    // a nested call (depth 2) is stepped over; the return lands at the
    // caller (depth 0, same file) — a stop there too
    expect(stepperLaw([pair(0, 90), pair(0, 91), pair(0, 12)], [2, 2, 0], FT, new Map(), st))
      .toEqual({ file: 'main.xc', line: 12, stepMode: 'off', depth: 0 });
  });
  it('over + depth (v3): a missing depths array degrades to the file-only law (older wasm)', () => {
    const st = S({ stepMode: 'over', pausedFile: 'main.xc', pausedLine: 10, pausedDepth: 0 });
    expect(stepperLaw([pair(0, 41)], [], FT, new Map(), st))
      .toEqual({ file: 'main.xc', line: 41, stepMode: 'off', depth: 0 });
  });
  it('breakpoints report the pair depth (the next pause updates pausedDepth)', () => {
    const breaks = new Map([['main.xc', new Set([42])]]);
    expect(stepperLaw([pair(0, 42)], [2], FT, breaks, S()))
      .toEqual({ file: 'main.xc', line: 42, stepMode: 'off', depth: 2 });
  });
});

// v1.13.17 P2b (L5): THE SAB GATE. Worker mode exists ONLY in a secure,
// cross-origin-isolated context; every other origin (Pages, plain-http
// Tailscale, node here) must fall back to the byte-identical main-thread
// stepper — and a silent worker must never wedge the pump (open resolves
// null, never hangs: the 15 s open-timeout races the 'open' answer).
describe('THE SAB GATE (worker mode ⇄ main-thread fallback)', () => {
  it('node (no crossOriginIsolated): sabSupported() false ⇒ XenonWorkerRun.open resolves null', async () => {
    expect(sabSupported()).toBe(false);
    await expect(XenonWorkerRun.open({
      ci: 0, program: 'p', alias: 'p', entryName: 'p.main.xc', builtin: false,
      files: [], screens: [], devices: [], channels: [], capacity: 0,
    })).resolves.toBeNull();
  });
  it('the gate opens ONLY with SharedArrayBuffer AND crossOriginIsolated', () => {
    const g = globalThis as { self?: unknown };
    const hadSelf = 'self' in g;
    const selfBackup = g.self;
    try {
      const sab = typeof SharedArrayBuffer;
      (g as { self: Record<string, unknown> }).self = { crossOriginIsolated: true };
      expect(sabSupported()).toBe(sab !== 'undefined');
      (g as { self: Record<string, unknown> }).self = { crossOriginIsolated: false };
      expect(sabSupported()).toBe(false);
      (g as { self: Record<string, unknown> }).self = {};
      expect(sabSupported()).toBe(false);
    } finally {
      if (hadSelf) g.self = selfBackup; else delete g.self;
    }
  });
});

describe('THE LOCALS LAW (v1.13.21 XENON-LOCALS)', () => {
  // we: "When debugging local variables, I cannot see their value. But that
  // is vital when debugging locals" — the Locals tab. The dump shape is the
  // fork's DumpLocalsAt JSON (names WITHOUT '$', recursion copy id 's');
  // the handoff rides the SAB (slot 19 = UTF-8 length, bytes at offset 80)
  // because a parked worker answers no messages.
  it('parses the DumpLocalsAt JSON', async () => {
    const { parseLocalsJson } = await import('../xenoncode');
    const j = '[{"name":"inputsource","t":70,"s":0,"v":"1"},'
      + '{"name":"result","t":70,"s":1,"v":"6"},'
      + '{"name":"label","t":71,"v":".on{1}"}]';
    expect(parseLocalsJson(j)).toEqual([
      { name: 'inputsource', t: 70, v: '1', s: 0 },
      { name: 'result', t: 70, v: '6', s: 1 },
      { name: 'label', t: 71, v: '.on{1}', s: 0 },   // s absent => copy 0
    ]);
    expect(parseLocalsJson('not json')).toEqual([]);
    expect(parseLocalsJson('{"name":"x"}')).toEqual([]);   // an object is not a frame
  });

  it('the SAB handoff reader: slot 19 + byte 80, honest [] on garbage', async () => {
    const { XenonWorkerRun } = await import('../xenoncode');
    const read = XenonWorkerRun.prototype['locals'] as () => unknown[];
    const sab = new SharedArrayBuffer(8192);
    const i32 = new Int32Array(sab);
    const bytes = new Uint8Array(sab);
    const fake = { i32, bytes };
    const json = '[{"name":"src","t":70,"s":0,"v":"4"}]';
    const enc = new TextEncoder().encode(json);
    bytes.set(enc, 80);
    Atomics.store(i32, 19, enc.length);
    expect(read.call(fake)).toEqual([{ name: 'src', t: 70, v: '4', s: 0 }]);
    // no handoff (a v1.13.17-era 1024-byte SAB never writes slot 19)…
    Atomics.store(i32, 19, 0);
    expect(read.call(fake)).toEqual([]);
    // …and a length that cannot fit the payload window refuses, never reads
    // past the encode guard
    Atomics.store(i32, 19, 1 << 20);
    expect(read.call(fake)).toEqual([]);
  });

  it('the varVisible filter keeps artifact rows out of the frame', async () => {
    const { varVisible } = await import('../xenoncode');
    expect(varVisible({ name: '@selectcase:', t: 70, v: '6' })).toBe(false); // return slot
    expect(varVisible({ name: 'sys.clock', t: 70, v: '1' })).toBe(false);    // dotted artifact
    expect(varVisible({ name: 'inputsource', t: 70, v: '1' })).toBe(true);
  });

  it('varValue: a paused local shadows the global; running reads globals', async () => {
    const { XenonPump } = await import('../xenoncode');
    const pump = new XenonPump();
    pump.vars = new Map([['num', { name: 'num', t: 70, v: '10' }]]);
    pump.locals = [{ name: 'num', t: 70, v: '3', s: 0 }];
    pump.paused = true;
    expect(pump.varValue('$num')?.v).toBe('3');      // the frame shadows
    expect(pump.varValue('num')?.v).toBe('3');
    pump.paused = false;
    expect(pump.varValue('$num')?.v).toBe('10');     // running: the global
    pump.locals = [{ name: 'other', t: 70, v: '1', s: 0 }];
    pump.paused = true;
    expect(pump.varValue('$num')?.v).toBe('10');     // paused, not in frame -> global
  });
});

describe('THE WRITEBACK LAW (v1.13.23 XENON-WRITEBACK)', () => {
  // we: "I want the capacity to edit a variable's current value (it must
  // be valid for its type … reject invalid values … inject those back into
  // xenoncode)" — the law lives in Computer::WriteVarAt (native-probed);
  // these pins cover the pure JS half the UI gates on.
  it('parses the writer ack', async () => {
    const { parseWriteAck } = await import('../xenoncode');
    expect(parseWriteAck('{"ok":true}')).toEqual({ ok: true });
    expect(parseWriteAck('{"error":"not a finite number"}'))
      .toEqual({ ok: false, error: 'not a finite number' });
    expect(parseWriteAck('garbage').ok).toBe(false);
    expect(parseWriteAck('{}').ok).toBe(false);          // no ok, no error -> refused
  });

  it('validNumInput mirrors WriteVarAt\'s numeric law', async () => {
    const { validNumInput } = await import('../xenoncode');
    for (const ok of ['42', '-1.5', '+7', ' 7 ', '1e3', '1E-2', '.5', '0.0', 'true', 'false'])
      expect(validNumInput(ok), ok).toBe(true);
    for (const no of ['', '  ', 'abc', '1,5', '5;', 'nan', 'inf', '0x10', '1 2', '42abc', '--3'])
      expect(validNumInput(no), no).toBe(false);
  });
});

describe('THE NET-SCREEN LAW (v1.16.11: the 3828773626 blank screens)', () => {
  it('router-coupled dashboards register their surfaces for ALL channels, ' +
    'at the 6 px/unit element size, keyed by the LOWERCASED alias', () => {
    const bp = data('3828773626');
    const chipos = xenonComputers(bp).find(c => c.ci === 4)!;
    // the literal scan alone finds NOTHING (display.xc passes $variables) —
    // this is the root cause the net law fixes
    expect(xenonScreens(bp, chipos.files, 4).length).toBe(0);
    const keys = new Set(chipos.screens.map(s => `${s.alias}#${s.channel}`));
    expect(keys.has('main-screen#0')).toBe(true);
    expect(keys.has('main-screen#7')).toBe(true);      // 8 HdScreens
    expect(keys.has('secondary-screen#0')).toBe(true);
    const ms = chipos.screens.find(s => s.alias === 'main-screen' && s.channel === 0)!;
    expect(ms).toMatchObject({ ci: 16, w: 300, h: 300 });   // 50×50 units × 6
    const sec = chipos.screens.find(s => s.alias === 'secondary-screen')!;
    expect(sec).toMatchObject({ ci: 14, w: 300, h: 300 });
    // an ALIASED dashboard answers the alias token (display.xc prefers
    // screen($dd_a, …) for $dd_a != "") — no io-number twin
    expect(chipos.screens.some(s => /^\d+$/.test(s.alias))).toBe(false);
  });

  it('a BARE dashboard (no alias) registers by io-number token — the ' +
    'screen($dd_p, …) path, resolved through the ROUTER NET', () => {
    const bp = JSON.parse(JSON.stringify(data('3828773626')));
    for (const c of bp.data.components)
      if (c.type === 'Dashboard') c.alias = '';
    const chipos = xenonComputers(bp).find((c: any) => c.ci === 4)!;
    const keys = new Set(chipos.screens.map((s: any) => `${s.alias}#${s.channel}`));
    // chipos' data_port.006 carries MiniRouter 6 → dashboards sit at io 6
    expect(keys.has('6#0')).toBe(true);
    expect(keys.has('6#7')).toBe(true);
    const s0 = chipos.screens.find((s: any) => s.alias === '6' && s.channel === 0)!;
    expect(s0.w).toBe(300);
  });

  it('virtualscreen(w,h) is NOT a screen(io,ch) reference', () => {
    // (the ChipOS Dev Kit's virtualscreen(860, 860) registered a phantom
    // io-860→channel-860 binding before the guard)
    const bp = data('3828773626');
    const chipos = xenonComputers(bp).find(c => c.ci === 4)!;
    expect(chipos.screens.some(s => s.alias === '860')).toBe(false);
    expect(xenonScreens(bp, [{ name: 'm.xc', code: 'var $v = virtualscreen(860, 860)' }], 4))
      .toEqual([]);
    // the real two-arg call still matches when glued to a token boundary
    expect(xenonScreens(bp, [{ name: 'm.xc', code: 'if(screen(5,1)){}}' }], -1).length).toBe(0);
    // (io 5 unresolvable on this craft — resolution gates registration)
    expect(xenonScreens(bp, [{ name: 'm.xc', code: '$s = screen(6, 0)' }], 4)
      .some(s => s.alias === '6' && s.channel === 0)).toBe(true);
  });
});

describe('ROUTER POWER GATING (v1.16.11: routers resolve addresses only when fed)', () => {
  it('3828773626: MiniRouter 6 is fed (LV grid), MiniRouter 11 is NOT — ' +
    'the gated census drops router 11’s sensors and keeps the boards', () => {
    const bp = data('3828773626');
    const net = craftPowerNet(bp, null);
    expect(net.hasPower).toBe(true);
    expect(computerPowered(net, 6)).toBe(true);
    expect(computerPowered(net, 11)).toBe(false);
    const gated = xenonDevices(bp, 4, { routerPowered: ci => computerPowered(net, ci) });
    const open = xenonDevices(bp, 4);
    expect(gated.some(d => d.ci === 16)).toBe(true);     // main-screen board (router 6)
    expect(gated.some(d => d.ci === 15)).toBe(false);    // DensitySensor behind router 11
    expect(open.some(d => d.ci === 15)).toBe(true);      // ungated = the old census
  });
  it('cut router 6’s LV feed = the net-screen registry loses the boards ' +
    '(the net-screen law rides the gated device walk)', () => {
    const bp = JSON.parse(JSON.stringify(data('3828773626')));
    bp.data.pipes = bp.data.pipes.filter((p: any) =>
      !(p.a_component === 5 && p.b_component === 6 && p.b_port === 'lowvoltage'));
    const net = craftPowerNet(bp, null);
    expect(computerPowered(net, 6)).toBe(false);
    const chipos = xenonComputers(bp, { routerPowered: (ci: number) => computerPowered(net, ci) })
      .find(c => c.ci === 4)!;
    expect(chipos.screens.some(s => s.alias === 'main-screen')).toBe(false);
    expect(chipos.devices.some(d => d.ci === 16)).toBe(false);
  });
  it('passive conductors are NEVER gated: a DataJunction net works with ' +
    'no power census at all (grid-less craft convention: no opts = open)', () => {
    const bp = data('9000009050');                     // CHIPOS BENCH (junction net)
    const dev = xenonDevices(bp, bp.data.components.findIndex(c => c.type === 'MiniComputer'));
    expect(dev.length).toBeGreaterThan(0);
  });
});
