// doc.ts pins: raw number literals survive emit untouched; EDITED numbers
// adopt the replaced literal's style (int stays int-style, float keeps ".0"
// and two-digit exponents — the game writer's int/double split).
import { describe, expect, test } from 'vitest';
import { docGet, docSetNumber, emitDoc, parseDoc } from '../doc';

describe('raw-literal document', () => {
  test('int/float literal styles survive untouched', () => {
    const src = '{"a":1.0,"b":1,"c":0.0,"d":[3,3,40],"e":1e-08,"f":-3.0,"g":16}';
    expect(emitDoc(parseDoc(src))).toBe(src);
  });
  test('edited float keeps float style; edited int stays bare', () => {
    const root = parseDoc('{"y":1.0,"type":3,"tiny":1e-08}');
    expect(docSetNumber(root, ['y'], 2)).toBe(true);
    expect(docSetNumber(root, ['type'], 45)).toBe(true);
    expect(docSetNumber(root, ['tiny'], 2e-8)).toBe(true);
    expect(emitDoc(root)).toBe('{"y":2.0,"type":45,"tiny":2e-08}');
  });
  test('nested paths + misses', () => {
    const root = parseDoc('{"data":{"components":[{"position":{"x":0.5}}]}}');
    expect(docGet(root, ['data', 'components', 0, 'position', 'x'])?.kind).toBe('num');
    expect(docGet(root, ['data', 'components', 7, 'x'])).toBeUndefined();
    expect(docSetNumber(root, ['data', 'components', 0, 'position', 'x'], 1.25)).toBe(true);
    expect(emitDoc(root)).toContain('"x":1.25');
  });
  test('strings: unicode raw + escapes round-trip', () => {
    const root = parseDoc('{"s":"é\\"tab\\tend","u":"A"}');
    const s = (docGet(root, ['s']) as { value: string }).value;
    expect(s).toBe('é"tab\tend');
    expect(emitDoc(root)).toBe('{"s":"é\\"tab\\tend","u":"A"}');
  });
  test('bad json throws ParseError, not silent junk', () => {
    expect(() => parseDoc('{"a":1,}')).toThrow();
    expect(() => parseDoc('{"a":1')).toThrow();
    expect(() => parseDoc('{"a":01.2}x')).toThrow();
  });
});
