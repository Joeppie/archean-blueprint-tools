// xcfiles.test.ts — the v1.13.x XENON virtual-disk law: the IDE edits the
// files BAKED INTO THE CRAFT (components[ci].data.hdd.xc_files), every write
// mirrors bp + doc (the doc is the save AND the undo history — v1.6.1), the
// entry file keeps its true name on writeback, and craft 3381670618 (the
// reported craft: node-authored autopilot + a screen(10,0) dashboard)
// extracts with its io-keyed surface at the element's real pixel size.
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { emitDoc, parseDoc } from '../doc';
import { insertXcFile, openFunnel, removeXcFile, serializeSave, setXcFileCode } from '../edit';
import { hasDashboards, parseKv, varKind, varVisible, xcDiskFiles, xenonComputers } from '../xenoncode';
import type { Blueprint } from '../format';

const REPO = new URL('../../../../', import.meta.url).pathname;
const data = (id: string): Blueprint =>
  JSON.parse(readFileSync(`${REPO}testdata/${id}/blueprint.json`, 'utf8')) as Blueprint;

const SRC = '{"author":"jo","data":{"blocks":[],"components":['
  + '{"alias":"comp","colors":{"color1":{"r":1,"g":1,"b":12,"opacity":15,"roughness":4,"metallic":0}},'
  + '"data":{"hdd":{"capacity":256,"label":"",'
  + '"xc_files":[{"name":"Prog.main.xc","plain_code":"print(1)\\n"},'
  + '{"name":"lib.xc","plain_code":";lib\\n"}]},"program":"Prog","version":2},'
  + '"module":"computers","occupancies":[],'
  + '"orientation":{"w":1,"x":0,"y":0,"z":0},"position":{"x":1,"y":2,"z":3},"type":"MiniComputer"}'
  + '],"pipes":[],"triangles":[],"version":2}}';

describe('the Xenon virtual disk (xc_files) write paths', () => {
  test('an UNTOUCHED craft re-emits byte-identically', () => {
    const doc = parseDoc(SRC);
    expect(emitDoc(doc)).toBe(SRC);
  });

  test('setXcFileCode lands in the SAVE and reloads through the open funnel', () => {
    const { doc, bp, ctx } = openFunnel(SRC);
    expect(setXcFileCode(ctx, 0, 0, 'print(2)\nprint(3)\n')).toBe(true);
    const saved = serializeSave(ctx);
    const bp2 = openFunnel(saved).bp;
    const xf = ((bp2.data.components[0] as any).data.hdd.xc_files) as { name: string; plain_code: string }[];
    expect(xf[0]!.plain_code).toBe('print(2)\nprint(3)\n');
    expect(xf[1]!.plain_code).toBe(';lib\n');        // untouched file verbatim
    expect(xf[0]!.name).toBe('Prog.main.xc');       // name + order kept
    expect(doc).toBeTruthy();
    expect(bp).toBeTruthy();
  });

  test('insertXcFile appends in the game key order {name, plain_code}', () => {
    const { ctx } = openFunnel(SRC);
    expect(insertXcFile(ctx, 0, 'extra.xc', ';new\n')).toBe(true);
    const saved = serializeSave(ctx);
    expect(saved).toContain('"xc_files":[{"name":"Prog.main.xc"');
    expect(saved).toContain('{"name":"extra.xc","plain_code":";new\\n"}');
    const xf = ((openFunnel(saved).bp.data.components[0] as any).data.hdd.xc_files) as any[];
    expect(xf.map(f => f.name)).toEqual(['Prog.main.xc', 'lib.xc', 'extra.xc']);
  });

  test('removeXcFile drops the record from the save (index shift exact)', () => {
    const { ctx } = openFunnel(SRC);
    expect(removeXcFile(ctx, 0, 0)).toBe(true);
    const xf = ((openFunnel(serializeSave(ctx)).bp.data.components[0] as any).data.hdd.xc_files) as any[];
    expect(xf.map(f => f.name)).toEqual(['lib.xc']);
  });

  test('a file that never carried hdd gets its arrays (the v1.6.1 class)', () => {
    const src = SRC.replace('"hdd":{"capacity":256,"label":"",'
      + '"xc_files":[{"name":"Prog.main.xc","plain_code":"print(1)\\n"},'
      + '{"name":"lib.xc","plain_code":";lib\\n"}]},', '"hdd":{"capacity":256,"label":""},');
    const { ctx } = openFunnel(src);
    expect(insertXcFile(ctx, 0, 'main.xc', 'print(9)\n')).toBe(true);
    const xf = ((openFunnel(serializeSave(ctx)).bp.data.components[0] as any).data.hdd.xc_files) as any[];
    expect(xf).toEqual([{ name: 'main.xc', plain_code: 'print(9)\n' }]);
  });

  test('THE FRESH-COMPUTER AUTHORING ROUND-TRIP (v1.13.20): data {} → '
    + 'listed blank tab → save → the code is IN THE FILE and reloads', () => {
      // a placed MiniComputer (newcraft.ts gives data {}): xenonComputers
      // synthesizes the blank main.xc (the listing pin in xenoncode.test);
      // the IDE's save (Editor.xenonFiles) matches by name, finds no disk
      // entry, and inserts — the v1.6.1 funnel. The SAVE must carry the
      // code (the doc is the save AND the history), and a reopen must show
      // it as the entry file.
      const src = '{"author":"jo","data":{"blocks":[],"components":['
        + '{"alias":"","colors":{"color1":{"r":1,"g":1,"b":12,"opacity":15,"roughness":4,"metallic":0}},'
        + '"data":{},"module":"computers","occupancies":[],'
        + '"orientation":{"w":1,"x":0,"y":0,"z":0},"position":{"x":1,"y":2,"z":3},"type":"MiniComputer"}'
        + '],"pipes":[],"triangles":[],"version":2}}';
      const { ctx } = openFunnel(src);
      const blank = xenonComputers(ctx.bp);
      expect(blank[0]!.files).toEqual([{ name: 'main.xc', code: '' }]);
      expect(insertXcFile(ctx, 0, xcDiskFiles(blank[0]!)[0]!.name, 'print(42)\n')).toBe(true);
      const saved = serializeSave(ctx);
      expect(saved).toContain('"plain_code":"print(42)\\n"');       // in the SAVE
      const comp = xenonComputers(openFunnel(saved).bp)[0]!;
      expect(comp.entryName).toBe('main.xc');
      expect(comp.files[0]!.code).toBe('print(42)\n');              // reloads
    });

  test('xcDiskFiles maps the run-side main.xc back to the TRUE names', () => {
    const comp = xenonComputers(data('3381670618'))[0]!;
    // the craft ships a literal main.xc (the game runs it first — it IS the
    // entry) which INCLUDES Cede.main.xc + screen.xc; entryName is its name
    expect(comp.entryName).toBe('main.xc');
    expect(comp.files[0]!.name).toBe('main.xc');          // run-side entry
    const disk = xcDiskFiles(comp);
    expect(disk.map(f => f.name)).toEqual(['main.xc', 'Cede.main.xc', 'screen.xc']);
  });
});

describe('craft 3381670618 (the reported craft) extracts for the IDE', () => {
  const bp = data('3381670618');
  const comp = xenonComputers(bp)[0]!;

  test('the io-keyed screen(10,0) registers under "10" at the element size', () => {
    const s = comp.screens.find(x => x.alias === '10');
    expect(s).toBeDefined();
    expect(s!.label).toBe('dashboard-17');                 // io 10 = the Dashboard
    expect(s!.w).toBe(870);   // 145-unit element at the 6 px-per-unit screen scale                                // element 145×65 + 1
    expect(s!.h).toBe(390);
    expect(s!.ci).toBe(17);
  });

  test('hasDashboards is true here, false on a screenless craft', () => {
    expect(hasDashboards(bp)).toBe(true);
    expect(hasDashboards(data('3327182790'))).toBe(false);   // Cheap Exploration Plane
    expect(hasDashboards(data('9000005001'))).toBe(false);   // Label-only dashboards
  });

  test('the node graph of Cede.main.xc parses (io-addressed input nodes)', () => {
    expect(comp.files.some(f => f.code.includes('#NODES'))).toBe(true);
    expect(comp.channels.length).toBeGreaterThan(3);
    // io 3 = PilotSeat, io 4 = NavInstrument (the pins the program reads)
    const ios = new Set(comp.channels.map(c => c.io));
    expect([...ios].sort()).toEqual([3, 4]);
  });
});

describe('the Vars panel helpers (XENON-VARS feed)', () => {
  test('parseKv breaks the language KV serialization open', () => {
    expect(parseKv('.on{1}.red{255}')).toEqual([
      { k: 'on', v: '1' }, { k: 'red', v: '255' },
    ]);
    expect(parseKv('.alias{mining-drill}.broken{0}')).toEqual([
      { k: 'alias', v: 'mining-drill' }, { k: 'broken', v: '0' },
    ]);
    expect(parseKv('plain text')).toBeNull();
    expect(parseKv('')).toBeNull();
    expect(parseKv('starts .a{1} late')).toBeNull();     // not the whole string
  });
  test('varKind maps CODE_TYPE codes; artifacts are hidden', () => {
    expect(varKind(70)).toBe('num');
    expect(varKind(71)).toBe('text');
    expect(varKind(50)).toBe('num');                     // storage number
    expect(varKind(51)).toBe('text');
    expect(varKind(61)).toBe('array');
    expect(varKind(129)).toBe('object');                 // screen object
    expect(varKind(40)).toBe('const');
    expect(varVisible({ name: 'disp', t: 70, v: '1' })).toBe(true);
    expect(varVisible({ name: 'disp.init', t: 40, v: '' })).toBe(false);
    expect(varVisible({ name: '@fn.1', t: 70, v: '' })).toBe(false);
  });
});
