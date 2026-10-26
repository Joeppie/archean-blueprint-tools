// sealwasm.ts — the JS seam of the WASM SEALED-ENVELOPE port
// (wasm/seal.ts, AssemblyScript; REWRITE.md §WASM candidates). atmo's
// sealedEnvelopeVolume tries the compiled module when it is loaded and
// falls back to the pure-JS twin (the reference, pinned equal over the
// corpus in sealwasm.test.ts) whenever it is not — so behaviour is
// identical before the module boots, in vitest, and on any engine without
// WebAssembly.
//
// The module is NOT imported statically: the browser Editor fires
// initSealWasmFetch(seal.wasm?url) once at boot (off the render path);
// tests feed bytes synchronously. Memory layout (fixed addresses, see
// wasm/seal.ts): blocks i32 @0, tri vertices f64 @1 MiB, OUT i32[2] @17 MiB.
import { hullVertex } from './hullfit';
import type { Block, Triangle } from './format';

const TRIS = 1048576;          // tri-vertex bytes start
const OUT = 17825792;          // 17 MiB: i32[2] insideFree, wallc
const P3 = 0.25 ** 3;

let instance: WebAssembly.Instance | null = null;

/** AssemblyScript's runtime imports abort(msg,file,line,col) — our module
 *  has no asserts (--noAssert) and no allocation failure mode below the
 *  256-page memory cap it is compiled with, so any abort is a bug: surface
 *  it loudly (the JS twin computed the answer the caller wanted). */
const imports = { env: { abort(): never { throw new Error('seal.wasm abort'); } } };

export const sealWasmReady = (): boolean => instance !== null;

/** Synchronous instantiation (node/vitest, cached bytes). */
export function initSealWasmBytes(bytes: ArrayBufferView | ArrayBuffer): boolean {
  try {
    instance = new WebAssembly.Instance(
      new WebAssembly.Module(bytes as BufferSource), imports);
    return true;
  } catch {
    instance = null;
    return false;
  }
}

/** Browser boot: fetch + instantiate (fire-and-forget; every call before it
 *  completes uses the JS twin). */
export async function initSealWasmFetch(url: string): Promise<boolean> {
  try {
    const r = await fetch(url);
    if (!r.ok) return false;
    const { instance: inst } = await WebAssembly.instantiate(await r.arrayBuffer(), imports);
    instance = inst;
    return true;
  } catch {
    return false;
  }
}

/** The module's answer, or null = use the JS twin (module absent, inputs
 *  over the serialisation capacity, grid over the module's cell budget). */
export function sealedEnvelopeWasm(
  tris: readonly Triangle[], blocks: readonly Block[]): { m3: number; cells: number } | null {
  const inst = instance;
  if (!inst) return null;
  const nB = blocks.length, nT = tris.length;
  if (nB * 24 > TRIS || nT * 72 > OUT - TRIS) return null;      // capacity
  const memory = inst.exports['memory'] as WebAssembly.Memory;
  const run = inst.exports['sealed'] as (nB: number, nT: number) => number;
  // serialise (fresh views every call — the buffer grows between calls)
  const inB = new Int32Array(memory.buffer, 0, nB * 6);
  for (let i = 0; i < nB; i++) {
    const b = blocks[i]!;
    inB[i * 6] = (b.frame_x ?? 0) * 12 + b.pos_x;
    inB[i * 6 + 1] = (b.frame_y ?? 0) * 12 + b.pos_y;
    inB[i * 6 + 2] = (b.frame_z ?? 0) * 12 + b.pos_z;
    inB[i * 6 + 3] = b.size_x; inB[i * 6 + 4] = b.size_y; inB[i * 6 + 5] = b.size_z;
  }
  const inT = new Float64Array(memory.buffer, TRIS, nT * 9);
  for (let i = 0; i < nT; i++) {
    const t = tris[i]!;
    for (const v of [0, 1, 2] as const) {
      const p = hullVertex(t, v);
      inT[i * 9 + v * 3] = p.x; inT[i * 9 + v * 3 + 1] = p.y; inT[i * 9 + v * 3 + 2] = p.z;
    }
  }
  if (run(nB, nT) !== 1) return null;                            // honest fallback
  const out = new Int32Array(memory.buffer, OUT, 2);
  const insideFree = out[0]!, wallc = out[1]!;
  const env = insideFree > 0 ? insideFree + wallc : 0;
  return { m3: env * P3, cells: env };
}
