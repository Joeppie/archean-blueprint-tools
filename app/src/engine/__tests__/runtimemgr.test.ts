// runtimemgr.test.ts — the ONE-INTERPRETER guard (v1.14.1 slice B/D
// groundwork for the farm, REWRITE § P9): the shim is a single global
// interpreter, so a HUD boot closes a running computer pump and vice
// versa; releases name-match (a kill's release must not wipe the new claim).
import { beforeEach, expect, test } from 'vitest';
import { claimRuntime, releaseRuntime, runtimeOwner } from '../runtimemgr';

let killed: string[] = [];
const computer = { name: 'computer' as const, kill: () => killed.push('computer') };
const hud = { name: 'hud' as const, kill: () => killed.push('hud') };

beforeEach(() => { releaseRuntime('computer'); releaseRuntime('hud'); killed = []; });

test('first claim wins, nobody killed', () => {
  claimRuntime(computer);
  expect(runtimeOwner()).toBe('computer');
  expect(killed).toEqual([]);
});

test('a HUD claim KILLS the running computer (the module changes hands)', () => {
  claimRuntime(computer);
  claimRuntime(hud);
  expect(killed).toEqual(['computer']);
  expect(runtimeOwner()).toBe('hud');
});

test('re-claiming the same owner kills nobody (re-open, re-boot)', () => {
  claimRuntime(hud);
  claimRuntime(hud);
  expect(killed).toEqual([]);
  expect(runtimeOwner()).toBe('hud');
});

test('release is name-matched — a killed owner’s release never wipes the new claim', () => {
  claimRuntime(computer);
  claimRuntime(hud);          // computer.kill() → close() → releaseRuntime('computer')
  expect(runtimeOwner()).toBe('hud');   // the release ran BEFORE hud was set
  releaseRuntime('computer');           // a late stray release must not clear hud
  expect(runtimeOwner()).toBe('hud');
  releaseRuntime('hud');
  expect(runtimeOwner()).toBeNull();
});
