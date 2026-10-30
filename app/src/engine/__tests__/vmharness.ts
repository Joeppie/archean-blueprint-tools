// vmharness.ts — the HEADLESS VM (docs/TEST-PYRAMID.md, the Xenon twin of
// the v1.12.1 headless Engine): the REAL dev's interpreter (the gitlink
// wasm) boots a craft's actual XenonCode program in vitest — cycles pumped
// by hand, screen PIXELS read from the shim's RAM buffers, io events and
// vars from the same JSON the pump parses. This is the file that lets the
// "does the program compile, run, paint and react" class leave the browser;
// the surviving e2e legs are the IDE DOM and the real-pointer/audio plumbing.
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { XenonRun, xenonComputers, type XenonComputer, type XenonEvent } from '../xenoncode';
import type { Blueprint } from '../format';
import { corpusText } from './harness';

/** feed the emscripten factory from disk (the sealwasm precedent): outside a
 *  browser the `?url` fetch path does not exist — the glue is built
 *  -sENVIRONMENT=web, so its node fs read is tree-shaken and there is no
 *  wasmBinary option. The harness therefore SERVES the shipped bytes at the
 *  exact URL the app's `?url` import resolves to: the SAME glue + wasm
 *  artifact the browser boots, no rebuild, no fork of the boot path.
 *  Called once per vitest file — every XenonRun.open gets its OWN module
 *  instance (the farm's law), so runs never share screens/devices. */
let provided = false;
export function provideVmWasm(): void {
  if (provided) return;
  const bytes = readFileSync(resolve(__dirname, '..', 'xenoncode', 'xenoncode.wasm'));
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (u: RequestInfo | URL, o?: RequestInit) => {
    if (String(typeof u === 'object' && 'url' in u ? u.url : u).includes('xenoncode.wasm'))
      return new Response(bytes.slice(0), { status: 200,
        headers: { 'content-type': 'application/wasm' } });
    return realFetch(u as RequestInfo, o);
  }) as typeof fetch;
  provided = true;
}

/** a corpus blueprint through the plain JSON extractor (no Engine needed —
 *  xenonComputers reads the raw data.hdd.xc_files). */
export function xenonCorpus(id: string): { bp: Blueprint; comps: XenonComputer[] } {
  const text = corpusText(id);
  if (!text) throw new Error(`corpus craft ${id} not present (config tiers)`);
  const bp = JSON.parse(text) as Blueprint;
  return { bp, comps: xenonComputers(bp) };
}

/** A live VM: the run + every event it has answered since boot. */
export interface Vm {
  run: XenonRun;
  comp: XenonComputer;
  events: XenonEvent[];
  cycles: number;
  /** pump n cycles, collecting events; throws on a program error (an
   *  uncompilable program is a red test, not a silent stall). */
  step(n: number): void;
  /** the LAST recorded 'out' event for a device alias (io resolved through
   *  the comp's device table), or undefined. */
  out(alias: string): number | undefined;
  /** every out-event target seen (io verbatim), for census legs. */
  outTargets(): Set<string>;
  /** lit RGBA pixels on one surface (the e2e litPixels law: sum(r+g+b) > 90). */
  lit(key: string): number;
  surface(key: string): { w: number; h: number } | undefined;
  press(key: string, x: number, y: number): void;
  vars(): Map<string, string>;
}

export async function bootVm(id: string, pick?: (comps: XenonComputer[]) => XenonComputer): Promise<Vm> {
  provideVmWasm();
  const { comps } = xenonCorpus(id);
  const comp = pick ? pick(comps) : comps[0];
  if (!comp) throw new Error(`craft ${id} has no programmable computer`);
  const run = await XenonRun.open(comp);
  if (run.error) throw new Error(`craft ${id} program boot error: ${run.error}`);
  const vm: Vm = {
    run, comp, events: [], cycles: 0,
    step(n: number) {
      for (let i = 0; i < n; i++) {
        const { evs, pausedAt } = run.cycle();
        if (pausedAt) throw new Error('the VM answered a PAUSE with none armed');
        vm.events.push(...evs);
        vm.cycles++;
        if (!run.running) throw new Error(`program error at cycle ${vm.cycles}: ${run.error}`);
      }
    },
    out(alias) {
      // bus keys are the program's RAW target (the clocks.test law): the
      // PLANE writes aliases verbatim; numeric-io programs ride the device
      // table's io.
      const a = alias.toLowerCase();
      const dev = comp.devices.find(d => d.alias.toLowerCase() === a);
      const target = dev ? String(dev.io).toLowerCase() : a;
      for (let i = vm.events.length - 1; i >= 0; i--) {
        const e = vm.events[i]!;
        if (e.e !== 'out') continue;
        const io = String(e.io ?? '').toLowerCase();
        if ((io === a || io === target) && typeof e.v === 'number') return e.v;
      }
      return undefined;
    },
    outTargets() {
      return new Set(vm.events.filter(e => e.e === 'out').map(e => String(e.io ?? '')));
    },
    lit(key) {
      const px = run.screenPixels(key);
      if (!px) return -1;
      let lit = 0;
      for (let i = 0; i < px.length; i += 4)
        if (px[i]! + px[i + 1]! + px[i + 2]! > 90) lit++;
      return lit;
    },
    surface(key) {
      return run.screenMeta().find(s => s.key.toLowerCase() === key.toLowerCase());
    },
    press(key, x, y) { run.screenClick(key, x, y); },
    vars() { return new Map(run.vars().map(v => [v.name.replace(/^\$/, '').toLowerCase(), v.v])); },
  };
  return vm;
}
