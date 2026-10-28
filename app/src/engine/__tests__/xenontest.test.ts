// xenontest.test.ts — the XenonTest script engine (v1.13.7): the format
// the Autotest panel and window.__XENONTEST__ speak — the interface for
// automating/diagnosing XenonCode (AI agents included, we: "so we can have
// an interface for AI agents in the future that want to test/run
// xenoncode"). Pure tier: parse + assert evaluation.
import { describe, expect, it } from 'vitest';
import { parseXenonTest, evalAssert, type XenonSnap } from '../xenontest';

const SNAP: XenonSnap = {
  cycles: 25,
  prints: 0,
  bus: { 'bench-horn:0': 0.8, 'bench-horn:1': 660 },
  devices: [{ alias: 'bench-horn', type: 'Buzzer', mode: 3, amp: 0.8, freq: 660, wave: 'sawtooth' }],
};

describe('parseXenonTest', () => {
  it('reads name, cycles and asserts', () => {
    const t = parseXenonTest(
      'name: bench\ncycles: 20\nassert:\n  - cycles >= 20\n  - prints == 0\n');
    expect(t.error).toBeUndefined();
    expect(t.name).toBe('bench');
    expect(t.cycles).toBe(20);
    expect(t.asserts).toEqual(['cycles >= 20', 'prints == 0']);
    expect(t.program).toBeNull();
  });
  it('reads a program: | block verbatim until the next key', () => {
    const t = parseXenonTest(
      'program: |\n  var $t = 0\n  update\n    $t += 1\ncycles: 5\nassert:\n  - cycles >= 5\n');
    expect(t.error).toBeUndefined();
    expect(t.program).toBe('var $t = 0\nupdate\n  $t += 1');
    expect(t.cycles).toBe(5);
  });
  it('rejects unknown keys and bad blocks', () => {
    expect(parseXenonTest('bogus: 1').error).toContain('unknown key');
    expect(parseXenonTest('program: x\n').error).toContain("program must be");
    expect(parseXenonTest('!bad').error).toContain("expected 'key:'");
  });
});

describe('evalAssert', () => {
  const ok = (e: string) => expect(evalAssert(e, SNAP).ok).toBe(true);
  const no = (e: string) => expect(evalAssert(e, SNAP).ok).toBe(false);

  it('bus() by alias+channel', () => {
    ok('bus("bench-horn", 0) == 0.8');
    ok('bus("bench-horn", 1) >= 440');
    ok('bus("ghost", 0) == 0');               // missing row reads 0
  });
  it('amp/freq/wave read the device census', () => {
    ok('amp("bench-horn") == 0.8');
    ok('freq("bench-horn") == 660');
    ok('wave("bench-horn") == "sawtooth"');
    no('wave("bench-horn") == "square"');
    no('amp("ghost") > 0');
  });
  it('counters', () => {
    ok('cycles >= 20');
    ok('prints == 0');
    no('cycles < 20');
  });
  it('operators + actual readback', () => {
    ok('bus("bench-horn", 0) != 0.2');
    ok('bus("bench-horn", 0) > 0.5');
    ok('bus("bench-horn", 0) <= 0.8');
    no('bus("bench-horn", 0) > 0.8');
    const r = evalAssert('amp("ghost") == 0.8', SNAP);
    expect(r.actual).toBe('0');
    expect(evalAssert('nonsense', SNAP).actual).toBe('parse error');
  });
});
