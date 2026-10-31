// xcdocs.test.ts — THE COVERAGE LAW (v1.16.14, the user: "there is no
// descriptions on the function names for e.g. blank; nothing shows up when
// mouseovering, telling me what it is or where it comes from"): every name
// in the analyzer's vocabulary, the panel/beacon members, the keyword/
// section words and the global constants MUST resolve through xcDoc with a
// signature, a description and an origin. `blank` firing this feature was
// exactly a vocabulary entry with no doc.
import { describe, expect, it } from 'vitest';
import { xcDoc, XC_DOC_VOCAB_SOURCES } from '../xcdocs';

describe('THE COVERAGE LAW — every vocabulary word answers the hover', () => {
  it('every language function (interpreter) has a doc', () => {
    const missing = XC_DOC_VOCAB_SOURCES.lang.filter(n => !xcDoc(n));
    expect(missing).toEqual([]);
  });
  it('every shim function (device + screen members) has a doc', () => {
    const missing = XC_DOC_VOCAB_SOURCES.shim.filter(n => !xcDoc(n));
    expect(missing).toEqual([]);
  });
  it('panel/beacon members + keywords/sections have docs', () => {
    const names = [...XC_DOC_VOCAB_SOURCES.panel, ...XC_DOC_VOCAB_SOURCES.beacon,
      ...XC_DOC_VOCAB_SOURCES.keywords];
    const missing = names.filter(n => !xcDoc(n));
    expect(missing).toEqual([]);
  });
});

describe('the entries answer WHAT and WHERE FROM', () => {
  it('blank: the screen member (the name that fired the feature)', () => {
    const d = xcDoc('blank')!;
    expect(d.desc).toMatch(/clear|fill/i);
    expect(d.origin).toMatch(/shim|screen/i);
  });
  it('print names its console; white names its color; init names its section', () => {
    expect(xcDoc('print')!.desc).toMatch(/console/i);
    expect(xcDoc('white')!.origin).toMatch(/color constant/i);
    expect(xcDoc('init')!.origin).toMatch(/keyword|section/i);
    expect(xcDoc('init')!.desc).toMatch(/once|powered/i);
  });
  it('language functions carry the interpreter origin', () => {
    expect(xcDoc('size')!.origin).toMatch(/interpreter/i);
    expect(xcDoc('lerp')!.desc).toMatch(/interpolat/i);
  });
  it('set_position answers as the HUD panel member (ABI 14)', () => {
    const d = xcDoc('set_position')!;
    expect(d.desc).toMatch(/panel/i);
    expect(d.origin).toMatch(/panel/i);
  });
});
