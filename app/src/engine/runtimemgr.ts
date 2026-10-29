// runtimemgr.ts — THE RUNTIME OWNER (v1.14.1 P9 slice B/D groundwork;
// REWRITE § P9 slice C).
//
// THE GROUND TRUTH: the XenonCode shim is ONE global interpreter (g_screens,
// g_devs, g_computer in xc_host.cpp) — the wasm module a XenonRun boots
// OWNS it. The ComputerFarm (P9 slice C) is precisely the work that lifts
// that; until then exactly ONE runtime — the computer pump OR a HUD pump —
// may own the module, and opening one KILLS the other. This is the seam
// both pumps claim through: when the farm lands, `claimRuntime` becomes the
// registry of co-owners sharing a per-craft IoBus, and no call site changes.
type Owner = { name: 'computer' | 'hud'; kill: () => void };
let owner: Owner | null = null;

/** Take the module: the previous owner (a DIFFERENT runtime) is closed
 *  first, synchronously. */
export function claimRuntime(next: Owner): void {
  if (owner && owner.name !== next.name) {
    const prev = owner;
    owner = null;                       // kill's releaseRuntime must not
    prev.kill();                        // clear the NEW claim
  }
  owner = next;
}

export function releaseRuntime(name: Owner['name']): void {
  if (owner?.name === name) owner = null;
}

export function runtimeOwner(): Owner['name'] | null {
  return owner?.name ?? null;
}
