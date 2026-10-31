// xenonvm.test.ts — THE HEADLESS VM tier (docs/TEST-PYRAMID.md): the REAL
// dev's interpreter (the gitlink wasm) boots each corpus craft's actual
// XenonCode program in vitest — the laws the v1.13 xenon.spec legs pinned
// through the browser (boot, compile, paints-on-a-screen pixels, the alias
// io bus, the stick's algebra, the dashboard button press, the built-in
// panel size) are VM laws; the wasm runs identically on node, so they live
// HERE. The surviving e2e legs are the IDE DOM (tabs, side tabs, CodeMirror,
// the zoom window) and real-pointer plumbing.
//
// L5 transcriptions (measured green values, this tree):
//   PLANE 3294880085   trimsdash#0 300×150, 60 cycles → lit 2672 (>50 e2e);
//                      stick 0.8 → PitchControlJunction = −0.8 (e2e band <−0.3)
//   3381670618         10#0 870×390, lit 2040 (>10 e2e); $disp 1→0 on press(4,4)
//   BADGER 3326372833  57 files, print 'Smart Quad is ready' @cycle 20,
//                      mining-drill on the bus, pilot-screen#0 lit 73041 (>20 e2e)
//   INVADERS 3288012440 main#0 + computer-13#0 registered at 200×160 (v1.15.2
//                      BUILT-IN PLAIN TARGET: the authored panel, not 640×480)
import { describe, expect, it } from 'vitest';
import { bootSynthetic, bootVm } from './vmharness';

describe('Just-Plane-Easy FirstFlight — boot, paint, bus, stick (was xenon.spec leg 1)', () => {
  it('the shipped program compiles, runs and paints TrimsDash', async () => {
    const vm = await bootVm('3294880085');
    expect(vm.run.running, 'boot (compile) is clean').toBe(true);
    expect(vm.surface('trimsdash#0')).toEqual({ key: 'trimsdash#0', w: 300, h: 150 });
    vm.step(60);                                        // 2.4 s of game time
    expect(vm.lit('trimsdash#0')).toBeGreaterThan(50);  // the e2e canvas law
  }, 60_000);

  it('the io bus speaks the program\'s targets; the stick drives the pitch out', async () => {
    const vm = await bootVm('3294880085');
    vm.step(60);
    const targets = vm.outTargets();
    expect(targets.has('PitchControlJunction'), 'the junction streams outputs').toBe(true);
    expect(targets.has('Engine'), 'the engine streams outputs').toBe(true);
    // THE STICK LAW (e2e: raise the elevator channel and the junction value
    // follows): input_number(junction, 1) is the stick; the program answers
    // output_number = −(stick + trim), trim 0 fresh-boot → EXACTLY −0.8.
    vm.run.setInput(11, 1, 0.8);
    vm.step(60);
    expect(vm.out('PitchControlJunction')).toBeCloseTo(-0.8, 6);
  }, 60_000);
});

describe('craft 3381670618 — the reported craft (was xenon.spec leg, the button_rect fix)', () => {
  it('boots, registers the io-10 Dashboard at element size and paints', async () => {
    const vm = await bootVm('3381670618');
    expect(vm.run.running, 'button_rect compiles (the v1.13.x VOID fix)').toBe(true);
    expect(vm.surface('10#0')).toEqual({ key: '10#0', w: 870, h: 390 });
    vm.step(40);
    expect(vm.lit('10#0')).toBeGreaterThan(10);         // the e2e canvas law
  }, 120_000);

  it('the top-left disp button press flips $disp (the game\'s click law, VM side)', async () => {
    const vm = await bootVm('3381670618');
    vm.step(40);
    expect(vm.vars().get('disp')).toBe('1');
    vm.press('10#0', 4, 4);                             // the e2e 1:1-canvas click point
    vm.step(3);                                         // the click evaluates THIS cycle
    expect(vm.vars().get('disp')).toBe('0');            // the e2e vars-tab law (not '1')
  }, 120_000);
});

describe('the Badger — the 36k-line firmware (was the 240 s @slow boot leg)', () => {
  it('boots 57 files, the firmware prints its readiness, drives the drill, paints pilot-screen', async () => {
    const vm = await bootVm('3326372833');
    expect(vm.comp.files.length).toBe(57);
    expect(vm.run.running).toBe(true);
    let ready = false;
    for (let c = 0; c < 2000 && !ready; c += 20) {
      vm.step(20);
      ready = vm.events.some(e => e.e === 'print' && String(e.v).includes('Smart Quad is ready'));
    }
    expect(ready, 'the CONSOLE-tab line (e2e) is a print event').toBe(true);
    // THE ALIAS IO BUS (the e2e BUS tab shows 'mining-drill'): the drill is
    // addressed by component alias — the raw out target verbatim.
    expect(vm.out('mining-drill'), 'the drill is driven').toBeDefined();
    // the NAMED screen from the blueprint (Dashboard 'pilot-screen' element)
    // paints — 300×300 at the 6 px/unit screen scale (the e2e canvas law).
    expect(vm.surface('pilot-screen#0')).toEqual({ key: 'pilot-screen#0', w: 300, h: 300 });
    expect(vm.lit('pilot-screen#0')).toBeGreaterThan(20);
    // the firmware's globals list (the e2e Vars tab ≥1 row)
    expect(vm.run.vars().length).toBeGreaterThan(0);
  }, 180_000);
});

describe('THE SCREEN-VERSION law (ABI 15, v1.16.8 blit-skip foundation)', () => {
  it('idle cycles keep the counter; a write moves it; writes stay counted', async () => {
    // blank fires EXACTLY once (at $n == 3): the counter must move once.
    const vm = await bootSynthetic([
      'var $s = screen("bench", 0)',
      'var $n = 0',
      'update',
      '\tif $n == 3',
      '\t\t$s.blank(color(9,9,9,255))',
      '\t$n += 1',
    ].join('\n'), 200, 160);
    const v0 = vm.run.screenVersion('bench#0');
    expect(v0, 'the export exists (ABI 15)').toBeGreaterThanOrEqual(0);
    vm.step(2);
    const vIdle = vm.run.screenVersion('bench#0');
    expect(vIdle, 'pure-arithmetic cycles never move it').toBe(v0);
    vm.step(2);                                     // crosses the $n == 3 write
    const vWrote = vm.run.screenVersion('bench#0');
    expect(vWrote, 'the blank() write moved it').toBeGreaterThan(vIdle);
    vm.step(3);
    expect(vm.run.screenVersion('bench#0'), 'quiet again: stable').toBe(vWrote);
  }, 60_000);

  it('screen_copy counts as a write ON THE DESTINATION', async () => {
    // The blit lives in INIT (runs exactly once): a fresh virtualscreen
    // starts at counter 0, so dst>0 after boot IS the blit's count; quiet
    // update cycles must then keep it stable.
    const vm = await bootSynthetic([
      'var $a = virtualscreen(64, 64)',
      'var $b = virtualscreen(64, 64)',
      'init',
      '\t$a.blank(color(5,200,5,255))',
      '\tscreen_copy($a, $b, 0, 0, 0, 0, 64, 64)',
      'update',
      '\tvar $n = 0',
      '\t$n += 1',
    ].join('\n'), 200, 160);
    expect(vm.run.screenVersion('virtual#1#0'), 'the blit counted on dst').toBeGreaterThanOrEqual(1);
    const b1 = vm.run.screenVersion('virtual#1#0');
    vm.step(3);
    expect(vm.run.screenVersion('virtual#1#0'), 'no re-blit: stable').toBe(b1);
  }, 60_000);
});

describe('Space Invaders 3288012440 — the built-in screen gate (VM side)', () => {
  it('the game compiles; the plain target is the AUTHORED panel, not 640×480', async () => {
    // THE BUILT-IN PLAIN TARGET law (v1.15.2): every Computer registers its
    // integrated screen at the authored 200×160 BEFORE boot, so screen()
    // draws there (the v1.15.2 catch: 640×480 laid the game out at 40 % of
    // the panel). The e2e leg keeps the ▣ Screens gate button + cockpit keys.
    const vm = await bootVm('3288012440', c => c.find(x => x.ci === 13)!);
    expect(vm.run.running, 'game.xc + space_helpers.xc compile clean').toBe(true);
    expect(vm.surface('main#0')).toEqual({ key: 'main#0', w: 200, h: 160 });
    expect(vm.surface('computer-13#0')).toEqual({ key: 'computer-13#0', w: 200, h: 160 });
  }, 120_000);
});

describe('THE DEBUGGER STREAMS on the real VM (v1.13.31 contract, VM side)', () => {
  it('the tracking gate records NOTHING unarmed; armed, pairs + depths align', async () => {
    const vm = await bootVm('3294880085');
    vm.step(5);
    expect(vm.run.cyclePairs(), 'unarmed: zero per-line recording').toEqual([]);
    vm.run.debugTrack(true);
    vm.step(2);
    const pairs = vm.run.cyclePairs();
    expect(pairs.length, 'armed: the pair stream executes').toBeGreaterThan(0);
    const depths = vm.run.cycleDepths();
    expect(depths.length, 'v3: the depth stream is index-aligned with pairs')
      .toBe(pairs.length);
    const files = vm.run.sourceFiles();
    expect(files.length, 'THE SOURCEFILE TRUTH LAW: the VM owns the table').toBeGreaterThan(0);
    for (const p of pairs)
      expect(Math.floor(p / 1000000), `pair ${p} file idx in the VM's table`).toBeLessThan(files.length);
  }, 60_000);

  it('the PARK LAW: requestPause stops the cycle at the EXACT executing line', async () => {
    const vm = await bootVm('3294880085');
    vm.run.requestPause();
    const { pausedAt } = vm.run.cycle();
    expect(pausedAt, 'xc_cycle answers 2 with a site').not.toBeNull();
    const files = vm.run.sourceFiles();
    expect(files[pausedAt!.idx], 'the park site is a VM sourcefile + line')
      .toBeTruthy();
    expect(pausedAt!.line).toBeGreaterThan(0);
    vm.run.pauseCancel();
    vm.step(5);
    expect(vm.run.running, 'Start outranks a pending park').toBe(true);
  }, 60_000);
});

describe('NET-SCREEN screens on the VM tier (v1.16.12, the dev-kit flicker guard)', () => {
  it('the IDLE appkit computer (app-1) registers the router-net boards at ' +
    'the 6 px/unit size and NEVER WRITES them — the write counter stays 0, ' +
    'the never-written gate keeps its pixels unfetched (an idle pump that ' +
    'shipped its blank buffer fought the painted pushes of ChipOS frame by ' +
    'frame — the flicker the user saw)', async () => {
    const vm = await bootVm('3828773626', cs => cs.find(c => c.ci === 3)!);
    expect(vm.run.running).toBe(true);
    expect(vm.surface('main-screen#0')).toEqual({ key: 'main-screen#0', w: 300, h: 300 });
    vm.step(60);
    // seq ≤ 1 = constructor bg fill ONLY — app-1's appkit program never
    // paints the boards (it ships manifests/frames as TEXT to 'chipos').
    expect(vm.run.screenVersion('main-screen#0')).toBeLessThanOrEqual(1);
    expect(vm.run.screenVersion('secondary-screen#0')).toBeLessThanOrEqual(1);
    expect(vm.lit('main-screen#0')).toBe(0);
  }, 120_000);

  it('the chipos computer PAINTS the boards (the write counter moves) — ' +
    'one painter, eight lit panels', async () => {
    const vm = await bootVm('3828773626', cs => cs.find(c => c.ci === 4)!);
    expect(vm.run.running).toBe(true);
    vm.step(160);                                       // boot + wizard scan
    const painted = [0, 1, 2, 3, 4, 5, 6, 7]
      .filter(ch => vm.run.screenVersion(`main-screen#${ch}`) > 1);   // ≥ 2 = program-painted
    expect(painted.length).toBeGreaterThanOrEqual(6);   // the shell's panels
    expect(vm.lit('main-screen#0')).toBeGreaterThan(50);
  }, 120_000);
});

describe('button_circle (v1.16.13 ABI 18 — the round button twin)', () => {
  const CODE = [
    'var $h = 0',
    'var $s = screen("bench", 0)',
    '',
    'update',
    '\t$s.blank(black)',
    '\t$h = $s.button_circle(30, 30, 12, white)',
    '',
  ].join('\n');

  it('draws + evaluates true on a click INSIDE the circle, false outside', async () => {
    const vm = await bootSynthetic(CODE, 120, 120, 'bench');
    vm.step(3);
    expect(vm.vars().get('h')).toBe('0');
    vm.press('bench#0', 36, 30);          // dx=6, dy=0 ≤ r=12
    vm.step(1);
    expect(vm.vars().get('h')).toBe('1');
    vm.step(2);                            // click cleared
    expect(vm.vars().get('h')).toBe('0');
    vm.press('bench#0', 48, 48);          // dx=18, dy=18 → r²=256 < 648
    vm.step(1);
    expect(vm.vars().get('h')).toBe('0');
  }, 60_000);
});
