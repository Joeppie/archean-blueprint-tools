// xcdgb.test.ts — the DEBUG CONSOLE API (v1.13.24) on a fake pump: the
// semantics an AI agent codes against (break/run/step/frame/write) are
// pinned headless; the REAL pump + worker plumbing is e2e-pinned
// (e2e/xenondbg.spec.ts).
import { describe, expect, it } from 'vitest';
import { makeXcdbg } from '../xcdbg';
import type { XenonPump } from '../xenoncode';

function fakePump() {
  const subs = new Set<() => void>();
  const tick = () => subs.forEach(f => f());
  const p: Record<string, unknown> = {
    status: 'running', cycles: 0, paused: false, pausedFile: '', pausedLine: 0,
    wrun: null,
    comp: { files: [{ name: 'main.xc', code: 'a\nb\nc\n' }] },
    fileTable: ['main.xc'],
    vars: new Map([['num', { name: 'num', t: 70, v: '10' }]]),
    locals: [{ name: 'x', t: 70, v: '1', s: 0 }, { name: 'msg', t: 71, v: 'hi', s: 0 }],
    bus: new Map([['2:0', 5]]),
    prints: [{ e: 'print', v: 'hello' }],
    breaksMap: null, writes: [], step: '', to: null,
    setBreaksMap: (m: Record<string, number[]>) => { p.breaksMap = m; },
    startRunning: () => {
      clearInterval(p._iv as ReturnType<typeof setInterval>);
      p._iv = setInterval(() => {
        (p.cycles as number)++;
        if (p.breakHit && p.cycles === p.breakHit) {
          clearInterval(p._iv as ReturnType<typeof setInterval>);
          p.paused = true; p.pausedFile = 'main.xc'; p.pausedLine = 10;
        }
        if ((p.cycles as number) >= 40)
          clearInterval(p._iv as ReturnType<typeof setInterval>);
        tick();
      }, 2);
    },
    resume: () => { p.paused = false; },
    stepOver: () => { p.step = 'over'; setTimeout(() => { p.pausedLine = 11; tick(); }, 3); },
    stepInto: () => { p.step = 'into'; setTimeout(() => { p.pausedLine = 12; tick(); }, 3); },
    runTo: (f: string, l: number) => {
      p.to = [f, l];
      setTimeout(() => { p.paused = true; p.pausedFile = f; p.pausedLine = l; tick(); }, 3);
    },
    writeVar: async (name: string, t: number, v: string, scope: string) => {
      (p.writes as unknown[]).push({ name, t, v, scope });
      if (t === 70 && !/^[-+]?\d+$/.test(v)) return { ok: false, error: 'not a finite number' };
      return { ok: true };
    },
    localsFrame: () => '@f',
    subscribe: (cb: () => void) => { subs.add(cb); return () => subs.delete(cb); },
  };
  return p;
}

const dbg = (p: ReturnType<typeof fakePump>) => makeXcdbg(p as unknown as XenonPump);

describe('THE DEBUG CONSOLE (window.__XCDBG__)', () => {
  it('break/list/clear push by-file maps onto the pump', () => {
    const p = fakePump(); const d = dbg(p);
    expect(d.break('main.xc', [10, 11])).toEqual([
      { file: 'main.xc', line: 10 }, { file: 'main.xc', line: 11 }]);
    expect(p.breaksMap).toEqual({ 'main.xc': [10, 11] });
    d.break('other.xc', [3]);
    expect(p.breaksMap).toEqual({ 'main.xc': [10, 11] });  // unknown file refused
    d.clear('main.xc');
    expect(p.breaksMap).toEqual({});
    expect(d.breakpoints()).toEqual([]);
  });

  it('run resolves at the breakpoint with the pause site', async () => {
    const p = fakePump(); const d = dbg(p);
    p.breakHit = 5;
    const r = await d.run({ cycles: 30 });
    expect(r.paused).toBe(true);
    expect(r).toMatchObject({ file: 'main.xc', line: 10, frame: '@f' });
    expect(r.reached).toBe(true);
  });

  it('run stops honestly on the cycle budget', async () => {
    const p = fakePump(); const d = dbg(p);
    const r = await d.run({ cycles: 3 });
    expect(r.paused).toBe(false);
    expect(r.cycles).toBeGreaterThanOrEqual(3);
  });

  it('step advances the pause site (over/into)', async () => {
    const p = fakePump(); const d = dbg(p);
    Object.assign(p, { paused: true, pausedFile: 'main.xc', pausedLine: 10 });
    const r = await d.step('over');
    expect(p.step).toBe('over');
    expect(r.moved).toBe(true);
    expect(r.line).toBe(11);
    const r2 = await d.step('into');
    expect(p.step).toBe('into');
    expect(r2.line).toBe(12);
  });

  it('goto pauses at the requested line', async () => {
    const p = fakePump(); const d = dbg(p);
    const r = await d.goto('main.xc', 17);
    expect(r).toMatchObject({ paused: true, file: 'main.xc', line: 17 });
    expect(p.to).toEqual(['main.xc', 17]);
  });

  it('frame/globals answer typed rows', () => {
    const p = fakePump(); const d = dbg(p);
    Object.assign(p, { paused: true, pausedFile: 'main.xc', pausedLine: 10 });
    expect(d.frame()).toEqual({
      file: 'main.xc', line: 10, frame: '@f',
      locals: [
        { name: 'x', type: 'number', value: '1' },
        { name: 'msg', type: 'text', value: 'hi' },
      ],
    });
    expect(d.globals()).toEqual([{ name: 'num', type: 'number', value: '10' }]);
    expect(d.bus()).toEqual({ '2:0': 5 });
    expect(d.prints()).toEqual(['hello']);
  });

  it('write resolves scope+type from the rows and mirrors refusals', async () => {
    const p = fakePump(); const d = dbg(p);
    expect(await d.write('$x', '42')).toEqual({ ok: true });
    expect(p.writes).toEqual([{ name: 'x', t: 70, v: '42', scope: 'locals' }]);
    const bad = await d.write('x', 'abc');
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain('finite');
    expect((await d.write('nope', '1')).ok).toBe(false);
    expect(await d.write('num', '7', 'globals'))
      .toEqual({ ok: true });
    expect((p.writes as { scope: string }[]).at(-1)!.scope).toBe('globals');
  });

  it('files/source expose the disk for line-mapping', () => {
    const p = fakePump(); const d = dbg(p);
    expect(d.files()).toEqual([{ name: 'main.xc', lines: 4 }]); // the trailing newline opens a last line
    expect(d.source('main.xc')).toBe('a\nb\nc\n');
    expect(d.source('nope.xc')).toBeNull();
  });
});
