// xenonpump.test.ts — THE PUMP FEED LAW (v1.16.9, we: "when I open space
// invaders, the computer's screen never updates unless I open the xenoncode
// screens at least once before"). The Computer's 3-D face is fed by the
// scene key (wsDeviceSlug 'computer_13#0'); the GAME draws on the plain
// target 'main#0' — the pump's mirror shares main#0's pixels under the face
// key, and the mirror can only share what was FETCHED: 'main#0' must enter
// the want-set whenever a face/canvas asks for its mirror key. Before the
// fix, the want-set carried only the face's VM twin (never written by the
// program — black forever) and the face lived only while some Screens-tab
// canvas happened to request main#0.
// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { XenonPump } from '../xenoncode';
import { provideVmWasm, xenonCorpus } from './vmharness';

beforeAll(() => provideVmWasm());

describe('THE PUMP FEED LAW (deviceScreen key fed from the plain target)', () => {
  it('the Space Invaders Computer face gets live pixels with NO canvas open', async () => {
    const { comps } = xenonCorpus('3288012440');
    const comp = comps.find(c => c.ci === 13)!;
    const sc = comp.screens.find(s => s.deviceScreen)!;
    const feedKey = `${sc.alias.replace(/-/g, '_')}#0`;   // wsDeviceSlug = the scene's key
    const pump = new XenonPump();
    pump.setFeedKeys([feedKey]);                          // the 3-D scene ONLY — no canvases
    await pump.open(comp);
    const deadline = Date.now() + 60_000;
    let lum = 0;
    while (Date.now() < deadline && lum < 1000) {
      await new Promise(r => setTimeout(r, 250));
      const px = pump.surfaces.get(feedKey)?.pixels;
      if (px) {
        lum = 0;
        for (let i = 0; i < px.length; i += 64) lum += px[i]! + px[i + 1]! + px[i + 2]!;
      }
    }
    pump.close();
    expect(lum, 'the game screen reaches the face key with no canvas open').toBeGreaterThan(1000);
  }, 90_000);
});
