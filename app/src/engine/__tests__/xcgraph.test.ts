// xcgraph.test.ts — THE XENON ANALYSIS GRAMMAR (v1.17.0): the mermaid
// SOURCE the dialog renders. Pure tier: participants/arrows/relations are
// deterministic text; the mermaid RUNTIME itself is the dialog's concern
// (e2e: analysis.spec renders SVGs in the browser).
import { describe, expect, it } from 'vitest';
import { buildAnalysisHtml, codeRundown, estWatts, GAME_HUD_LAW,
  GAME_IPC_LAW, GAME_POWER_LAW, svgTextOnly, xcDiagrams, type XcFile } from '../xcgraph';
import type { XCDevice } from '../xenoncode';

const dev = (io: number, alias: string, type: string): XCDevice =>
  ({ io, id: io, alias, type, ci: io + 100, x: 0, y: 0, z: 0 } as XCDevice);

const GAME = `
var $device = "game-fx-blocks"

update
\tvar $vol = input_number("seat-main", 5)
\tif $vol > 0
\t\t$device = "game-fx-power"
\toutput_number($device, 0, $vol)
\toutput_number("melody", 0, @tone(2))

function @tone($n : number) : number
\treturn $n * 440
`;
const OS = `
include "game.xc"

init
\toutput_number("screen-main", 0, 1)
\tvar $hz = @tone(3)
`;
const prog = {
  alias: 'app-1', ci: 3,
  files: [{ name: 'main.xc', code: OS }, { name: 'game.xc', code: GAME }],
  devices: [dev(10, 'seat-main', 'PilotSeat'), dev(11, 'melody', 'Buzzer'),
    dev(12, 'game-fx-blocks', 'Buzzer'), dev(13, 'game-fx-power', 'Buzzer'),
    dev(2, 'screen-main', 'Dashboard')],
};

describe('THE XENON ANALYSIS GRAMMAR v2 (bounded, split, node-aware)', () => {
  const ds = xcDiagrams(prog, { 5: 'roll' });
  it('emits FOUR bounded diagrams: class, flow, seq-in, seq-out', () => {
    expect(ds.map(d => d.kind)).toEqual(['class', 'flow', 'seqIn', 'seqOut']);
    expect(ds[0]!.source).toMatch(/^classDiagram/);
    expect(ds[2]!.source).toMatch(/^sequenceDiagram/);
    // the user law: input and output do NOT share one diagram
    expect(ds[2]!.source).not.toMatch(/write ch/);
    expect(ds[3]!.source).not.toMatch(/read ch/);
  });
  it('class: files with entry marks and capped members', () => {
    const cls = ds[0]!.source;
    expect(cls).toMatch(/class \S+\["game\.xc"\] \{/);
    expect(cls).toContain('\u00abupdate \u00b7 tick 25 Hz\u00bb');       // the TICK block is visible
    expect(cls).toContain('\u00abinit\u00bb');                              // entry points seen
    expect(cls).toContain('@tone');
  });
  it('sequences are BOUNDED (we: "bloated and unusable")', () => {
    for (const d of ds.filter(x => x.kind.startsWith('seq'))) {
      const lines = d.source.split('\n');
      expect(lines.length).toBeLessThan(40);
      expect(lines.filter(l => l.includes('participant') || l.includes('actor')).length).toBeLessThanOrEqual(9);
    }
  });
  it('the PILOT is an actor, devices FULLY RESOLVED, coupled press→read', () => {
    const seqIn = ds[2]!.source;
    expect(seqIn).toContain('actor U as Pilot / user');
    expect(seqIn).toMatch(/U->>\S+: press \(roll\)/);
    expect(seqIn).toMatch(/d_seat\S*->>\+?P: read ch 5/);
    expect(ds[3]!.source).toMatch(/game19fx19(blocks|power)\S*: write ch/);  // the $device SWITCH lands (nid: dashes → 19)
    const seqOut = ds[3]!.source;
    expect(seqOut).toMatch(/->>\+?d_melody\S*: write ch/);
  });
  it('flow: subgraphs close, node files get their NODE graph (we: "or even a node if it is an node")', () => {
    const nodeFile: XcFile = { name: 'plomo.main.xc', code:
      '#NODES {"nodes":[{"id":"N1","channel":5,"ioNumber":11,"outputType":0,"title":"input.11","type":"InputNode","inputs":[],"inputValues":[]},' +
      '{"id":"N2","ioNumber":0,"outputType":2,"title":"output.0","type":"OutputNode","inputs":["N1"],"inputValues":[""]}]}\n\nupdate\n\tvar $v = input_number(11, 5)\n\toutput_number("ail", 0, $v)\n' };
    const dns = xcDiagrams({ alias: 'plomo', ci: 9, files: [nodeFile],
      devices: [dev(11, 'seat-main', 'PilotSeat'), dev(0, 'ail', 'Aileron')] }, { 5: 'roll' });
    const flow = dns[1]!.source;
    expect(flow).toContain('input.11');                       // node TITLES label the graph
    expect(flow).toContain('-->');
    expect(flow.match(/subgraph/g)!.length).toBe(flow.match(/^  end$/gm)!.length);  // balanced
    // the node program's io surface was INVISIBLE to the text scan; the graph fixes it
    expect(dns[2]!.source).toContain('press');
    expect(dns[3]!.source).toMatch(/d_ail\S*: write/);
  });
  it('mermaid-hostile characters never leak into labels', () => {
    const evil = xcDiagrams({
      alias: 'a"b#', ci: 0,
      files: [{ name: 'x;y<x>.xc', code: 'update\n\toutput_number("q|w#e", 0, 1)' }],
      devices: [dev(1, 'q|w#e', 'Lamp')],
    });
    for (const d of evil) {
      const outside = d.source.replace(/\[[^\]]*\]/g, '');
      expect(outside).not.toContain('|');
      expect(outside).not.toContain('<');
      expect(outside).not.toContain(';');
    }
  });
  it('MARIO-scale programs stay bounded (we: "for ASuper mario that became WAY too large")', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      ({ name: `f${i}.xc`, code: `update\n${Array.from({ length: 20 }, (_, j) => `function @g${j}()\n\tvar $x = ${j}`).join('\n')}` }));
    const big = xcDiagrams({ alias: 'chipos', ci: 1, files: many, devices: [] });
    for (const d of big) {
      const n = d.source.split('\n').length;
      expect(n, d.kind).toBeLessThan(90);
    }
    // overflow folds HONESTLY somewhere visible (30 files cannot all fit)
    expect(big[0]!.source).toMatch(/\+ ?\d+ ?(more|functions|nodes|file)/);
  });
});

describe('THE CODE RUNDOWN (v1.17.1, we: "analysis … should give a better rundown")', () => {
  const rd = codeRundown(prog);
  it('per-file inventory: lines, entries, functions, io counts', () => {
    const game = rd.files.find(f => f.name === 'game.xc')!;
    expect(game.lines).toBeGreaterThan(5);
    expect(game.entries).toContain('update');
    const tone = game.functions.find(fn => fn.name === 'tone')!;
    expect(tone.ret).toBe('number');
    expect(tone.lines).toBeGreaterThanOrEqual(3);
    expect(game.io.filter(i => i.dir === 'out').length).toBeGreaterThanOrEqual(2);
  });
  it('the $device SWITCH resolves to every assigned device and is CALLED OUT', () => {
    const game = rd.files.find(f => f.name === 'game.xc')!;
    const devIo = game.io.find(i => i.token === '$device')!;
    expect(devIo.resolved.sort()).toEqual(['game-fx-blocks', 'game-fx-power']);
    expect(rd.summary.join('\n')).toMatch(/\$device is a SWITCH.*game-fx-blocks.*game-fx-power/);
  });
  it('device fan-in counts reads and writes per resolved device', () => {
    const seat = rd.fanIn.find(x => x.device === 'seat-main')!;
    expect(seat.readers).toBeGreaterThanOrEqual(1);
    expect(seat.type).toBe('PilotSeat');
    const melody = rd.fanIn.find(x => x.device === 'melody')!;
    expect(melody.writers).toBeGreaterThanOrEqual(1);
    expect(rd.summary.join('\n')).toContain('bus fan-in top');
  });
  it('the export document carries the rundown table', () => {
    const html = buildAnalysisHtml({ craft: 'c', sections: [{
      compAlias: 'app-1', diagrams: [], svgs: [], rundown: rd }] });
    expect(html).toContain('Code structure');
    expect(html).toContain('seat-main');
    expect(html).toContain('Device fan-in');
  });
});

describe('THE PURE-SVG LAW (v1.17.1, we: "SVG doesn\'t rendee images")', () => {
  const fo = '<svg xmlns="http://www.w3.org/2000/svg"><rect/>' +
    '<foreignObject x="10" y="20" width="90" height="30">' +
    '<div xmlns="http://www.w3.org/1999/xhtml" style="font-size:16px;text-align:center">update &amp; click</div>' +
    '</foreignObject></svg>';
  it('foreignObject labels become real SVG text', () => {
    const out = svgTextOnly(fo);
    expect(out).not.toContain('foreignObject');
    expect(out).toContain('<text');
    expect(out).toContain('update &amp; click');
    expect(out).toContain('font-size="16"');
    expect(out).toContain('middle');                 // centred labels stay centred
    expect(out).toContain('.fo2txt');                // the injected style
  });
  it('pure svgs pass through untouched', () => {
    const clean = '<svg><text x="1">ok</text></svg>';
    expect(svgTextOnly(clean)).toBe(clean);
  });
});

describe('THE WORK CENSUS LAW (v1.17.1, we: "calculate how much work the computer does per iteration, and correspond to documentation Archean [has] on what is possible and allowed")', () => {
  it('the documented laws are quoted, not invented', () => {
    expect(GAME_IPC_LAW).toMatch(/wiki Computer\.md/);
    expect(GAME_IPC_LAW).toMatch(/SERVER config/i);          // the cap is NOT blueprint data
    expect(GAME_POWER_LAW).toMatch(/30 W/);
    expect(GAME_POWER_LAW).toMatch(/500 W/);
    expect(GAME_HUD_LAW).toMatch(/wiki hud\.md/);
    expect(GAME_HUD_LAW).toMatch(/client/i);                 // HUDs: no server budget
  });
  it('the energy correspondence is the documented linear ratio', () => {
    expect(estWatts(0, 1000)).toBe(30);                      // idle
    expect(estWatts(1000, 1000)).toBe(500);                  // 100 % Max IPC
    expect(estWatts(2000, 1000)).toBe(500);                  // clamped (it crashed first)
    expect(estWatts(500, 1000)).toBe(265);                   // the linear middle
  });
  it('the export carries a Compute budget card per program', () => {
    const html = buildAnalysisHtml({ craft: 'c', sections: [{
      compAlias: 'cpu', diagrams: [], svgs: [],
      compute: { alias: 'cpu', isHud: false, workEma: 412.5, samples: 90, live: true } },
      { compAlias: 'hud', diagrams: [], svgs: [],
        compute: { alias: 'hud', isHud: true, workEma: null, samples: 0 } }] });
    expect(html).toContain('Compute budget');
    expect(html).toContain('413 IPC penalty units / cycle');
    expect(html).toContain('EMA over 90 cycles');
    expect(html.match(/client/g)!.length).toBeGreaterThan(0);   // the HUD row quotes hud law
  });
});
