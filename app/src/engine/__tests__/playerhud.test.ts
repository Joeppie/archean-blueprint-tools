// playerhud.test.ts — the PLAYER HUD loader laws (v1.17.0, we: "make it
// possible to load a player HUD file"). Pure/node tier: the fixture-floor
// listing (testdata/hud/hudbench — tools/make_hud_test.py), main.xc-FIRST
// order, the .xc-only filter, the folder-name alias, the save-target law
// (installed IN PLACE, workshop/fixture as a hud_dir COPY), the traversal
// guard, and the file-picker extraction. The browser legs (menu, IDE,
// Library tab, runtime pixels, POST round-trip) live in e2e/playerhud.spec.ts.
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { playerHudFromFiles, PLAYER_HUD_CI } from '../playerhud';
import { hudPump } from '../hudpump';
import { provideVmWasm } from './vmharness';
import { listPlayerHuds, readPlayerHudProgram, writeHudFiles, hudSaveTarget, hudDir }
  from '../../../tools/vite-corpus';

describe('the /hud listing (fixture floor = testdata/hud)', () => {
  it('serves the hudbench fixture, main.xc FIRST', () => {
    const e = listPlayerHuds().find(h => h.name === 'hudbench');
    expect(e, 'the fixture floor is always served').toBeTruthy();
    expect(e!.files[0]).toBe('main.xc');
    expect(e!.files).toContain('parse.xc');
  });
  it('reads the program: main.xc first, real bytes', () => {
    const p = readPlayerHudProgram('hudbench');
    expect(p).toBeTruthy();
    expect(p!.files.map(f => f.name)).toEqual(['main.xc', 'parse.xc']);
    expect(p!.files[0]!.code).toContain('@speed_kph(get("avatar_sensor_speed"))');
    expect(p!.files[1]!.code).toContain('function @speed_kph');
  });
  it('the name guard refuses traversal', () => {
    expect(readPlayerHudProgram('../../etc')).toBeNull();
    expect(hudSaveTarget('a/b')).toBeNull();
  });
});

describe('the save-target law', () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'hudsave-'));
  const savedHud = process.env.ARCHEAN_HUD;
  process.env.ARCHEAN_HUD = tmp;
  afterAll(() => {
    if (savedHud === undefined) delete process.env.ARCHEAN_HUD;
    else process.env.ARCHEAN_HUD = savedHud;
    rmSync(tmp, { recursive: true, force: true });
  });

  it('a fixture/workshop item saves as a COPY into the hud dir, never in place', () => {
    const target = hudSaveTarget('hudbench')!;
    expect(target).toBe(path.join(hudDir(), 'hudbench'));
    expect(target).not.toContain(path.join('testdata', 'hud'));
  });
  it('writeHudFiles round-trips .xc bytes; main.xc-first names survive', () => {
    const dir = hudSaveTarget('hudbench')!;
    writeHudFiles(dir, [
      { name: 'main.xc', code: '; edited\n' },
      { name: 'parse.xc', code: '; tuned\n' },
    ]);
    expect(readFileSync(path.join(dir, 'main.xc'), 'utf8')).toBe('; edited\n');
    expect(readPlayerHudProgram('hudbench')!.files[0]!.code).toBe('; edited\n');
  });
  it('bad file names are refused (only .xc, no traversal)', () => {
    expect(() => writeHudFiles(tmp, [{ name: '../evil.xc', code: '' }])).toThrow();
    expect(() => writeHudFiles(tmp, [{ name: 'evil.txt', code: '' }])).toThrow();
    expect(() => writeHudFiles(tmp, [{ name: 'xc_program.bin', code: '' }])).toThrow();
  });
});

describe('the file-picker extraction (works in EVERY build)', () => {
  const files = [
    { name: 'parse.xc', rel: 'homo/parse.xc', text: 'function @round(){}' },
    { name: 'main.xc', rel: 'homo/main.xc', text: 'include "parse.xc"' },
    { name: 'xc_program.bin', rel: 'homo/xc_program.bin', text: 'ÿÿ' },
  ];
  it('main.xc FIRST, includes follow, the .bin is dropped, the folder names it', () => {
    const p = playerHudFromFiles(files);
    expect(p.name).toBe('homo');
    expect(p.files.map(f => f.name)).toEqual(['main.xc', 'parse.xc']);
    expect(p.files[0]!.code).toContain('include');
  });
  it('a folder without main.xc is refused (the entry law)', () => {
    expect(() => playerHudFromFiles(files.slice(0, 1))).toThrow(/main\.xc/);
  });
  it('the synthetic ci is NEGATIVE — it never collides with a component index', () => {
    expect(PLAYER_HUD_CI).toBeLessThan(0);
  });
});

describe('THE HUD CADENCE LAW (v1.16.13 — set_cps is the program’s own voice)', () => {
  // (the user: "setCPS in HUDS lets code change its actual interval, but
  // this is done in its init. We should support that way of doing it. We
  // cannot preparse the init, because it can actually run and should run
  // in the same scope") — the pump READS set_cps live: init runs as a
  // cycle, the arm() after that tick adopts 1000/n.
  it('set_cps(10) from init moves the pump to a 100 ms cadence', async () => {
    provideVmWasm();
    await hudPump.open({ ci: -9, alias: 'cpsbench', files: [
      { name: 'main.xc', code: 'var $n = 0\n\ninit\n\tset_cps(10)\n\nupdate\n\t$n = $n + 1\n' },
    ] });
    await new Promise(r => setTimeout(r, 900));   // init + re-arm + settle
    expect(hudPump.cadenceMs()).toBe(100);
    hudPump.close();
  }, 20_000);

  it('no set_cps → the 25 Hz CYCLE_MS law stands', async () => {
    provideVmWasm();
    await hudPump.open({ ci: -9, alias: 'cpsbench', files: [
      { name: 'main.xc', code: 'init\n\tprint(1)\n' },
    ] });
    await new Promise(r => setTimeout(r, 400));
    expect(hudPump.cadenceMs()).toBe(40);
    hudPump.close();
  }, 20_000);
});
