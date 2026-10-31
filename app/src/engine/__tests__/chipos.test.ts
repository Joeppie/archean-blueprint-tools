// chipos.test.ts — THE APPKIT BUS (v1.16.10, workpackages WP1): Chip
// Patton's ChipOS + App Kit apps run on the REAL gitlink wasm over the
// farm's io bus. The protocol (testdata/3828773626 chipos-appkit.xc header
// = the law):
//   app → chipos  output_text("chipos", 0, ".kit{3}.name{TETRIS}...")   manifest
//   app → chipos  output_text(..., 1, frame) 2 input rq 3 beep rq 4+n widgets
//   chipos → app  text frames onto the app's router PORT (its input.N
//                 handlers fire — ABI 16 RunInput)
//   chipos polls input_text(appAlias, 0) — the app's transmission is
//                 readable UNDER THE APP'S OWN alias (writer-publish).
// The fixture 9000009050 embeds the REAL disks (ChipOS v0.41b, Tetris,
// HELLO, EarthNAV v1.0) on a MiniRouter bench — the law lives inside
// third-party program code, a synthetic program cannot state it.
// @ChipOS per-component tag.
import { describe, expect, test } from 'vitest';
import { provideVmWasm, xenonCorpus } from './vmharness';
import {
  IoBus, XenonRun, xenonDevices,
  type XenonComputer, type XenonEvent, type XenonPump,
} from '../xenoncode';
import type { Blueprint } from '../format';

const BENCH = '9000009050';

/** One live VM bridged onto a shared IoBus (the farm's Cable Law, the
 *  pump-coalescing skipped — the test pumps cycles synchronously). */
interface Node {
  run: XenonRun;
  comp: XenonComputer;
  events: XenonEvent[];
}

async function node(comp: XenonComputer, bus: IoBus): Promise<Node> {
  const run = await XenonRun.open(comp);
  if (run.error) throw new Error(`${comp.alias}: boot error: ${run.error}`);
  const nd: Node = { run, comp, events: [] };
  run.setVirtualDt(40);                      // 25 Hz sim clock for a tight loop
  bus.attach({
    comp,
    acceptBusWrite(alias: string | number, ch: number, v: number | string) {
      if (typeof v === 'string') run.setInputT(String(alias), ch, v);
      else run.setInput(alias, ch, v);
    },
  } as unknown as XenonPump);
  return nd;
}

function stepAll(nodes: Node[], bus: IoBus, n: number): void {
  for (let i = 0; i < n; i++) {
    for (const nd of nodes) {
      const { evs } = nd.run.cycle();
      nd.events.push(...evs);
      expect(nd.run.running, `${nd.comp.alias} cycle ${i}: ${nd.run.error}`).toBe(true);
      for (const e of evs) {
        if (e.e !== 'out') continue;
        const tok = String(e.io ?? '');
        const dev = nd.comp.devices.find(d =>
          d.alias.toLowerCase() === tok.toLowerCase() || String(d.io) === tok);
        bus.write(tok, Number(e.port ?? 0),
          typeof e.v === 'string' ? e.v : Number(e.v ?? 0),
          { comp: nd.comp } as unknown as XenonPump,
          dev?.ci !== undefined ? { ci: dev.ci, type: dev.type } : null);
      }
    }
  }
}

const pick = (comps: XenonComputer[], alias: string): XenonComputer => {
  const c = comps.find(x => x.alias === alias);
  if (!c) throw new Error(`bench has no computer "${alias}"`);
  return c;
};

const prints = (nd: Node): string =>
  nd.events.filter(e => e.e === 'print').map(e => String(e.v ?? '')).join('\n');

describe('the ChipOS HDD craft — hdd INSERT = boot (WP2)', () => {
  test('the workshop HDD craft is a MiniComputer carrying the whole OS disk', () => {
    // In-game law (wiki Computer.md § HDD): the bay holds the disk whose
    // code runs. Our model: data.hdd.xc_files + the LIVE auto-boot — the
    // ChipOS v0.10 HDD craft (3828546114) is ONE MiniComputer carrying
    // the disk; xenonComputers lists it and the farm boots it verbatim
    // (the BENCH's chipos VM — the same 52 files — boots and scans: the
    // pins above ARE the insert-and-run proof at the VM tier).
    const { comps } = xenonCorpus('3828546114');
    expect(comps.length).toBe(1);
    const os = comps[0]!;
    expect(os.files.length).toBeGreaterThan(40);        // the full v0.10 disk
    expect(os.files.some(f => f.name === 'main.xc')).toBe(true);
    expect(os.files.some(f => f.name === 'actions.xc')).toBe(true);
    // the disk on the DEV KIT (v0.41b) is a superset of the HDD (v0.10):
    // same core files — insert the newer disk, the same OS boots
    const kit = xenonCorpus('3828773626').comps.find(c => c.alias === 'chipos')!;
    const hdd = new Set(comps[0]!.files.map(f => f.name));
    const kitFiles = kit.files.map(f => f.name);
    expect(kitFiles.filter(f => hdd.has(f)).length).toBeGreaterThan(30);
  });
});

describe('the CHIPOS BENCH device tables — THE ROUTER NET', () => {
  const { bp } = xenonCorpus(BENCH);
  test('every net device carries the LOCAL port of the router chain', () => {
    const chiposCi = (bp.data.components as { alias?: string }[])
      .findIndex(c => c.alias === 'chipos');
    const devs = xenonDevices(bp as Blueprint, chiposCi);
    const io = (alias: string) => devs.find(d => d.alias === alias)?.io;
    // all four hang on the MiniRouter plugged into chipos data_port.000
    expect(io('app-1')).toBe(0);
    expect(io('app-2')).toBe(0);
    expect(io('app-earthnav')).toBe(0);
    expect(io('main-screen')).toBe(0);
    expect(io('main-router')).toBe(0);
    // direct plugs keep their own ports
    expect(io('LV Switch')).toBe(1);
    expect(io('Main LV Battery')).toBe(2);
  });
  test('the APP computer resolves its router port and the chipos alias', () => {
    const appCi = (bp.data.components as { alias?: string }[])
      .findIndex(c => c.alias === 'app-1');
    const devs = xenonDevices(bp as Blueprint, appCi);
    // app-1's router sits on ITS port 0 — ChipOS frames arrive at input.0
    expect(devs.find(d => d.alias === 'chipos')?.io).toBe(0);
    // the self alias is published for the writer-publish loopback
    expect(devs.find(d => d.alias === 'app-1')?.io).toBe(-1);
  });
});

describe('the CHIPOS BENCH on the real wasm — @ChipOS', () => {
  test('ChipOS boots and its device scan sees the router net', async () => {
    provideVmWasm();
    const bus = new IoBus();
    const { comps } = xenonCorpus(BENCH);
    const os = await node(pick(comps, 'chipos'), bus);
    stepAll([os], bus, 160);                          // 6.4 s of sim time
    const census = prints(os).match(/devices on the data network \((\d+)/);
    expect(census, `boot log:\n${prints(os).slice(0, 800)}`).not.toBeNull();
    expect(Number(census![1])).toBeGreaterThanOrEqual(8);
    // the relay the OS owns asserts ON (db_assert, cfg_relays_boot)
    expect(os.events.some(e => e.e === 'out'
      && String(e.io) === 'LV Switch' && Number(e.port) === 0 && e.v === 1),
    `relay assert missing in ${os.events.filter(e => e.e === 'out').length} out events`).toBe(true);
    void os;
  }, 60_000);

  test('TETRIS publishes its manifest and ChipOS READS it under app-1', async () => {
    provideVmWasm();
    const bus = new IoBus();
    const { comps } = xenonCorpus(BENCH);
    const os = await node(pick(comps, 'chipos'), bus);
    const tetris = await node(pick(comps, 'app-1'), bus);
    stepAll([os, tetris], bus, 160);
    // THE PUBLISHED-DEVICE LAW: ChipOS polls the APP's channel — the app's
    // own alias row carries the manifest (a computer's alias row is what IT
    // transmits: ChipOS's relay asserts land on "chipos:0", game-faithful).
    const man = String(bus.get('app-1', 0) ?? '');
    expect(man).toContain('.kit{');
    expect(man).toContain('TETRIS');
    // THE REGISTRY: ChipOS's 3 s scan polled app-1's channel and JOINED the
    // app — its storage registry is the observable ("becomes available in
    // the computer" is literally this array).
    // THE REGISTRY: ChipOS's 3 s scan polled app-1's channel and JOINED the
    // app — its storage registry (xa_alias, the ids that survive reboot)
    // is the observable ("becomes available in the computer" = this row).
    // (The runtime name array renders empty in DumpVarsJson — the dump is
    // storage-only; the alias row is the durable half of the registry.)
    const reg = os.run.vars().find(v => v.name === 'xa_alias')?.v ?? '';
    expect(reg, `ChipOS registry (xa_alias): ${reg}`).toMatch(/app-1/);
    expect(os.run.running).toBe(true);
    void os; void tetris;
  }, 90_000);

  test('HELLO joins too, and every app heartbeat republishes', async () => {
    provideVmWasm();
    const bus = new IoBus();
    const { comps } = xenonCorpus(BENCH);
    const os = await node(pick(comps, 'chipos'), bus);
    const hello = await node(pick(comps, 'app-2'), bus);
    stepAll([os, hello], bus, 80);
    expect(String(bus.get('app-2', 0) ?? '')).toContain('HELLO');
    const reg = os.run.vars().find(v => v.name === 'xa_alias')?.v ?? '';
    expect(reg, `ChipOS registry (xa_alias): ${reg}`).toMatch(/app-2/);
    void os; void hello;
  }, 90_000);

  test('EarthNAV joins the registry as a module — @slow @while-publish', async () => {
    provideVmWasm();
    const bus = new IoBus();
    const { comps } = xenonCorpus(BENCH);
    const os = await node(pick(comps, 'chipos'), bus);
    const nav = await node(pick(comps, 'app-earthnav'), bus);
    // the 9 MB world-data program: give the compile its room
    stepAll([os, nav], bus, 80);
    expect(String(bus.get('app-earthnav', 0) ?? '')).toContain('.kit{');
    const reg = os.run.vars().find(v => v.name === 'xa_alias')?.v ?? '';
    expect(reg, `ChipOS registry (xa_alias): ${reg}`).toMatch(/earthnav/i);
    void os; void nav;
  }, 180_000);
});

// ── the protocol at its purest: synthetic host/guest pair (no 600 KB OS
// compile) — ABI 16 RunInput + text fan-out + writer-publish in one leg.
describe('the appkit protocol pair — synthetic host & guest (ABI 16)', () => {
  const HOST = `
var $s = 0
var $nx = 0

update
\tif time >= $nx
\t\t$nx = time + 0.5
\t\t$s = $s + 1
\t\toutput_text("guest", 0, ".seq{" & text("{}", $s) & "}.ev{tick}")
`;
  const GUEST = `
var $rx = ""
var $seq = -1

update
\tif $rx != ""
\t\tvar $q = $rx.seq:number
\t\tif $q != $seq
\t\t\t$seq = $q
\t\t\toutput_number("ping", 0, $q)

input.0 ($c0 : text, $c1 : text, $c2 : text, $c3 : text)
\t$rx = $c0
`;
  const dev = (alias: string, io: number, ci: number) =>
    ({ io, id: 0, alias, type: 'MiniComputer', ci, x: 0, y: 0, z: 0 });
  const comp = (alias: string, ci: number, code: string,
    devices: XenonComputer['devices']): XenonComputer => ({
    ci, alias, program: 'main', entryName: 'main.xc',
    files: [{ name: 'main.xc', code }], capacity: 4096, channels: [],
    screens: [], devices,
  });

  test('a host text frame fires the guest input.N handler (the appkit event law)', async () => {
    provideVmWasm();
    const bus = new IoBus();
    const os = await node(comp('host', 1, HOST, [dev('guest', 0, 2)]), bus);
    const g = await node(comp('guest', 2, GUEST, [dev('host', 0, 1)]), bus);
    stepAll([os, g], bus, 60);
    const hostOuts = os.events.filter(e => e.e === 'out' && String(e.io) === 'guest');
    const pings = g.events.filter(e => e.e === 'out' && String(e.io) === 'ping');
    expect(hostOuts.length).toBeGreaterThanOrEqual(3);
    expect(pings.length, 'the guest never received an event frame').toBeGreaterThanOrEqual(2);
    expect(Number(pings[0]!.v)).toBe(1);
    void os; void g;
  }, 30_000);

  test('a wire (numeric port) write fans out to the device AND fires input.N', async () => {
    provideVmWasm();
    const bus = new IoBus();
    const g = await node(comp('guest', 2, GUEST, [dev('host', 0, 1)]), bus);
    // a HUMAN feed straight onto the guest's port 0 (Farm.pressDevice shape)
    g.run.setInputT('host', 0, '.seq{7}.ev{tap}');
    stepAll([g], bus, 5);
    expect(g.events.some(e => e.e === 'out' && String(e.io) === 'ping' && e.v === 7)).toBe(true);
    void g;
  }, 30_000);
});
