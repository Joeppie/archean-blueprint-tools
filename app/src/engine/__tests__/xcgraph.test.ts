// xcgraph.test.ts — THE XENON ANALYSIS GRAMMAR (v1.17.0): the mermaid
// SOURCE the dialog renders. Pure tier: participants/arrows/relations are
// deterministic text; the mermaid RUNTIME itself is the dialog's concern
// (e2e: analysis.spec renders SVGs in the browser).
import { describe, expect, it } from 'vitest';
import { buildAnalysisHtml, codeRundown, craftIsFlyable, svgTextOnly, xcDiagrams } from '../xcgraph';
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

describe('THE XENON ANALYSIS GRAMMAR', () => {
  it('emits the three diagrams, each valid-headed', () => {
    const ds = xcDiagrams(prog, { 5: 'roll' });
    expect(ds.map(d => d.kind)).toEqual(['flow', 'sequence', 'class']);
    expect(ds[0]!.source).toMatch(/^flowchart TD/);
    expect(ds[1]!.source).toMatch(/^sequenceDiagram/);
    expect(ds[2]!.source).toMatch(/^classDiagram/);
  });
  it('sequence: the PILOT is an actor and devices are FULLY RESOLVED system actors', () => {
    const seq = xcDiagrams(prog, { 5: 'roll' })[1]!.source;
    expect(seq).toContain('actor U as Pilot / user');
    // seat FIRST (the pilot presses it), fully resolved name:
    expect(seq).toContain('participant');
    expect(seq).toMatch(/participant \S+ as seat-main · PilotSeat · io 10/);
    expect(seq).toMatch(/U->>\S+: press ch 5 \(roll\)/);
    // resolved by the $device VAR idiom (both literals assigned in source):
    expect(seq).toMatch(/game-fx-blocks · Buzzer · io 12/);
    expect(seq).toMatch(/game-fx-power · Buzzer · io 13/);
    // program->device writes and reads:
    expect(seq).toMatch(/->>\S+melody\S*: output_number ch 0/);
    // cross-file @tone call: main.xc calls a game.xc function
    expect(seq).toMatch(/@tone\(\)/);
    expect(seq).toContain('entry: update');
    expect(seq).toContain('entry: init');
  });
  it('flow: per-file subgraphs with entry nodes, fns, include + call edges', () => {
    const flow = xcDiagrams(prog)[0]!.source;
    expect(flow).toContain('subgraph');
    expect(flow).toMatch(/\(\["update"\]\):::entry/);
    expect(flow).toContain('@tone');
    expect(flow).toMatch(/-\.\s*include\s*\.\->/);
    expect(flow).toMatch(/calls @tone/);
  });
  it('class: files as classes with $vars and @functions as members', () => {
    const cls = xcDiagrams(prog)[0 + 2]!.source;
    expect(cls).toMatch(/class c_[^ ]+\["game\.xc"\] \{/);
    expect(cls).toContain('+tone(');
    expect(cls).toMatch(/\.\.>.*:\s*include/);
    expect(cls).toMatch(/calls @tone/);
  });
  it('mermaid-hostile characters never leak into labels', () => {
    const evil = xcDiagrams({
      alias: 'a"b#', ci: 0,
      files: [{ name: 'x;y<x>.xc', code: 'update\n\toutput_number("q|w#e", 0, 1)' }],
      devices: [dev(1, 'q|w#e', 'Lamp')],
    });
    const seq = evil[1]!.source;      // sequenceDiagram carries no legit #…
    expect(seq).not.toContain('#');
    expect(seq).not.toContain('|');
    expect(seq).not.toContain('"');
    expect(seq).not.toContain('<');
    expect(seq).not.toContain(';');
  });
  it('flight gate: ailerons fly, rovers and Mario benches do not', () => {
    expect(craftIsFlyable({ data: { components: [{ type: 'Aileron' }] } })).toBe(true);
    expect(craftIsFlyable({ data: { components: [{ type: 'BigWheel' }, { type: 'MiniComputer' }] } })).toBe(false);
  });
  it('the ANALYSIS REPORT embeds plates + svgs and gates the flight theatre', () => {
    const ds = xcDiagrams(prog);
    const html = buildAnalysisHtml({
      craft: '9000009096&x',
      sections: [{ compAlias: 'app-1', plateTop: 'data:image/png;a', plateFront: 'data:image/png;b',
        diagrams: ds, svgs: ['<svg id="s1"/>', null, '<svg id="s3"/>'] }],
      flight: null,
    });
    expect(html).toContain('craft analysis');
    expect(html).toContain('data:image/png;a');
    expect(html).toContain('<svg id="s1"/>');           // RENDERED svgs embed
    expect(html).toContain('mermaid source');           // unpainted ones fall back to source
    expect(html).toContain('9000009096&amp;x');          // the craft id is escaped
    expect(html).toMatch(/Not applicable/);              // no flight theatre without a report
    const fly = buildAnalysisHtml({
      craft: 'c', sections: [],
      flight: { speed: 80, mass: 900, stallSpeed: 21, ldMax: 9, staticMarginPct: -2,
        pitchVerdict: 'unstable', yawVerdict: 'stable',
        rows: [{ axis: 'roll', part: 'Aileron #7', authority: 12, buried: true }] },
    });
    expect(fly).toContain('unstable');
    expect(fly).toContain('buried in the collider mass');   // the drag suspect is CALLED OUT
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
