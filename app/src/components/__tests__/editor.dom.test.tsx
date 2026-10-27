// @vitest-environment jsdom
// editor.dom.test.tsx — the BUILD DOCK / panel-editor DOM laws on the REAL
// Editor state machine through the Viewport-mock harness
// (docs/TEST-PYRAMID.md Phase 3, v1.12.5). Retired here (L5, same commit):
//   builddock.spec 'the dock shows brush, census, list, edit and the MIRROR
//   widget columns' · 'list row selects, ✕ deletes, one Ctrl+Z restores' ·
//   'SQUARE FIX: a block grows to a 10×10×10 square' · 'the MIRROR widget
//   switches the axis live — GLYPH chips' · 'tri list selects, ±cell move
//   round-trips, window refusal is honest' · 'mode law: TRIANGLES mode only
//   DROPS PINS, EDIT selects the prism (merged pick)';
//   panels.spec '✎ MODIFY opens EMPTY; a pick reveals the kind's editor'.
// The e2e legs keep what jsdom cannot state: real 3-D pick pixels, the pin
// 3-click ritual, ⤢/modebox (Viewport DOM), CSS-layout (grid columns) and
// the draws>0 repaint law. Values transcribed from the green e2e baseline.
import { beforeEach, describe, expect, test } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { mountEditor, setAxes, tick, type H } from './harness';
import { cornerWorld, triAt, triCorners } from '../../engine/tris';
import type { Blueprint } from '../../engine/format';

const bpOf = (h: H) => h.engine.blueprint as Blueprint;
const blocks = (h: H) => bpOf(h).data.blocks;
const tris = (h: H) => (bpOf(h).data.triangles ?? []) as Record<string, number>[];
const corners = (t: Record<string, number>) => triCorners(t as never);
const undo = () => fireEvent.keyDown(window, { key: 'z', ctrlKey: true });

beforeEach(() => {
  localStorage.clear();
  setAxes([]);                                       // the fake's craftMirrorAxes
});

describe('build dock — columns, list, square fix (was builddock e2e)', () => {
  let h: H;
  beforeEach(async () => {
    h = await mountEditor('9000005001');            // the testframe fixture
    fireEvent.click(screen.getByTestId('mode-edit'));
  });

  test('the dock shows brush, census, list, edit and the MIRROR widget columns', async () => {
    fireEvent.click(screen.getByTestId('ws-blocks'));
    for (const t of ['block-brush', 'block-census', 'block-list', 'block-edit',
      'block-list-search', 'mirror-widget', 'mirw-x', 'mirw-y', 'mirw-z', 'mirw-off'])
      expect(screen.getByTestId(t), t).toBeTruthy();
    // v1.11: the pre-placement SIZE UI is GONE
    for (const t of ['brush-square', 'brush-reset', 'brush-step-z-p', 'brush-axis-x', 'brush-chip'])
      expect(screen.queryByTestId(t), t).toBeNull();
    // every block listed (the e2e count law: rows === bp blocks)
    const rows = document.querySelectorAll('[data-testid^="block-row-"]');
    expect(rows.length).toBe(blocks(h).length);
  });

  test('list row selects, ✕ deletes, one Ctrl+Z restores', async () => {
    fireEvent.click(screen.getByTestId('ws-blocks'));
    const n0 = blocks(h).length;
    fireEvent.click(document.querySelector('[data-testid^="block-row-"]')!);
    expect(screen.getByTestId('block-edit').textContent).toMatch(/Block\[\d+\]/);
    const bi = +((screen.getByTestId('block-edit').textContent as string)
      .match(/Block\[(\d+)\]/)?.[1] ?? '-1');
    fireEvent.click(screen.getByTestId(`block-cut-${bi}`));
    await waitForLen(() => blocks(h).length, n0 - 1);
    undo();
    await waitForLen(() => blocks(h).length, n0);
    // the restored block list re-renders (the dock re-reads the bp)
    expect(document.querySelectorAll('[data-testid^="block-row-"]').length).toBe(n0);
  });

  test('SQUARE FIX: a block grows to a 10×10×10 square (frame borders do not cap)', async () => {
    fireEvent.click(screen.getByTestId('ws-blocks'));
    fireEvent.click(document.querySelector('[data-testid^="block-row-"]')!);
    expect(screen.getByTestId('block-edit').textContent).toMatch(/Block\[\d+\]/);
    for (const ax of ['x', 'y', 'z']) {
      const el = screen.getByTestId(`num-size ${ax}`) as HTMLInputElement;
      fireEvent.change(el, { target: { value: '9' } });
    }
    const bi = +((screen.getByTestId('block-edit').textContent as string)
      .match(/Block\[(\d+)\]/)?.[1] ?? '-1');
    const b = blocks(h)[bi]!;
    expect([b.size_x, b.size_y, b.size_z]).toEqual([9, 9, 9]);   // square
  });
});

describe('build dock — the MIRROR widget (was builddock e2e)', () => {
  test('axis chips switch the session mirror live; the lit plane toggles pairing; ⊘ kills it', async () => {
    setAxes(['x']);                                  // the gantry: x-mirrored data
    const h = await mountEditor('3732302108');
    fireEvent.click(screen.getByTestId('mode-edit'));   // the dock (ws row) rides EDIT
    // v1.11: the x chip is AUTO-lit (auto twin on a craft mirrored across x)
    expect(screen.getByTestId('mirw-x').getAttribute('aria-pressed')).toBe('true');
    // glyph contract (v1.11 ONE LINGO): the off chip wears plane+strike,
    // the axis chips wear the glyph + the letter
    expect(screen.getByTestId('mirw-off').querySelector('[data-g="mirror-off"]')).toBeTruthy();
    expect(screen.getByTestId('mirw-off').querySelector('[data-g="mirror-strike"]')).toBeTruthy();
    for (const a of ['x', 'y', 'z']) {
      expect(screen.getByTestId(`mirw-${a}`).querySelector('[data-g="mirror"]'), a).toBeTruthy();
      expect(screen.getByTestId(`mirw-${a}`).textContent, a).toContain(a);
    }
    fireEvent.click(screen.getByTestId('mirw-z'));
    expect(h.engine.mirrorAxis).toBe('z');
    fireEvent.click(screen.getByTestId('mirw-off'));
    expect(h.engine.mirrorAxis).toBe('off');
    fireEvent.click(screen.getByTestId('mirw-x'));
    expect(h.engine.mirrorAxis).toBe('x');
    // ONE LINGO: clicking the LIT plane stops pairing, clicking again re-arms
    expect(screen.getByTestId('mirw-x').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByTestId('mirw-x'));
    expect(screen.getByTestId('mirw-x').getAttribute('aria-pressed')).toBe('false');
    expect(localStorage.getItem('archean-app-plsym')).toBe('0');
    fireEvent.click(screen.getByTestId('mirw-x'));
    expect(screen.getByTestId('mirw-x').getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem('archean-app-plsym')).toBe('1');
  });
});

describe('build dock — triangle workspace (was builddock e2e)', () => {
  test('tri list selects, ±cell move round-trips, window refusal is honest', async () => {
    const h = await mountEditor('3732302108');       // the gantry: authored skin
    fireEvent.click(screen.getByTestId('mode-edit'));
    fireEvent.click(screen.getByTestId('ws-tris'));
    expect(screen.getByTestId('tri-list')).toBeTruthy();
    const row = document.querySelector('[data-testid^="tri-row-"]') as HTMLElement;
    expect(row).toBeTruthy();
    const idx = +(row.getAttribute('data-testid') ?? '').replace('tri-row-', '');
    fireEvent.click(row);
    expect(screen.getByTestId('tri-edit').textContent).toContain(`Triangle[${idx}]`);
    // GEOMETRY round-trip: the (frame, v) split re-normalises writer-style,
    // so the GLOBAL corners g = v + 12·frame are the exact measure.
    const before = corners(tris(h)[idx]!);
    fireEvent.click(screen.getByTestId('tri-move-x-p'));
    await waitFor(() => corners(tris(h)[idx]!)[0]![0] !== before[0]![0]);
    const mid = corners(tris(h)[idx]!);
    for (const [vi, c] of mid.entries())
      expect(c).toEqual([before[vi]![0]! + 1, before[vi]![1]!, before[vi]![2]!]);
    fireEvent.click(screen.getByTestId('tri-move-x-m'));
    await waitFor(() => JSON.stringify(corners(tris(h)[idx]!)) === JSON.stringify(before));
    // a corner push out of the frame-aligned vertex window: REFUSED visibly
    const v = screen.getByTestId('tri-v0-x') as HTMLInputElement;
    fireEvent.change(v, { target: { value: '-500' } });
    expect(screen.getByTestId('tri-msg').textContent).toContain('refused');
    expect(corners(tris(h)[idx]!)).toEqual(before);  // the record is byte-intact
  });
});

describe('pick routing — flavour law + Modify reveal (was builddock/panels e2e)', () => {
  test('TRIANGLES mode DROPS PINS on a prism face; MODIFY SELECTS the prism', async () => {
    const h = await mountEditor('3732302108');
    fireEvent.click(screen.getByTestId('mode-edit'));
    // the merged-pick hit the Viewport hands onBlockPick (a prism-owner probe):
    // aim the CENTROID of a real gantry triangle — triAt owns that point.
    const t0 = (h.engine.blueprint as Blueprint).data.triangles![0]!;
    const c = corners(t0 as never);
    const w = [0, 1, 2].map(i => c.map(g => cornerWorld(g)[i]!));
    const point: [number, number, number] = [
      (w[0]![0]! + w[0]![1]! + w[0]![2]!) / 3,
      (w[1]![0]! + w[1]![1]! + w[1]![2]!) / 3,
      (w[2]![0]! + w[2]![1]! + w[2]![2]!) / 3,
    ];
    expect(triAt(h.engine.blueprint as Blueprint, point), 'the centroid is the prism owner').toBe(0);
    const hit = { kind: 'tri', bi: -1, ci: -1, point };
    // ▵ TRIANGLES mode: the prism-face click DROPS A PIN — selects NOTHING
    fireEvent.click(screen.getByTestId('ws-tris'));
    h.clickAt(hit);
    await tick(50);
    expect(screen.getByTestId('tri-edit').textContent, 'placement never selects')
      .toContain('none selected');
    expect((h.engine.calls.setPinDraft ?? []).length, 'the draft rides the engine')
      .toBeGreaterThan(0);
    h.engine.pick = null;
    fireEvent.keyDown(window, { key: 'Escape' });   // live pins down
    // ✎ MODIFY: the SAME pixel SELECTS the prism (merged pick)
    fireEvent.click(screen.getByTestId('ws-edit'));
    h.clickAt(hit);
    await waitFor(() =>
      expect(screen.getByTestId('tri-edit').textContent).toContain('Triangle[0]'));
  });

  test('✎ MODIFY opens EMPTY; a pick reveals the kind’s editor (TODO G)', async () => {
    const h = await mountEditor('9000005001');
    fireEvent.click(screen.getByTestId('mode-edit'));
    // a fresh profile is ✎ MODIFY (ws default 'edit'): the dock carries the
    // hint and NO editor rows until you pick something (v1.11 dock law)
    expect(screen.getByTestId('ws-edit').getAttribute('aria-pressed')).toBe('true');
    const hint = screen.getByTestId('modify-hint');
    expect(hint.textContent).toMatch(/starts empty/i);
    expect(screen.queryByTestId('block-edit')).toBeNull();
    expect(screen.queryByTestId('tri-edit')).toBeNull();
    // a BLOCK pick → the block editor (the merged pick routing, same seam)
    h.clickAt({ kind: 'block', bi: 0, ci: -1, point: [0, 0, 0] });
    await tick(50);
    expect(screen.getByTestId('block-edit').textContent).toContain('Block[0]');
    expect(screen.queryByTestId('modify-hint'), 'the editor replaced the hint').toBeNull();
    // a SKY pick deselects — the hint returns
    h.clickAt(null);
    await tick(50);
    expect(screen.queryByTestId('block-edit')).toBeNull();
    expect(screen.getByTestId('modify-hint')).toBeTruthy();
    // a PART pick → the + Parts auto-jump (KNOWN ISSUE 10) + inspector
    h.clickAt({ kind: 'comp', ci: 0, bi: -1, point: [0, 0, 0] });
    await tick(50);
    expect(screen.getByTestId('ws-parts').getAttribute('aria-pressed'),
      'a Modify-mode part click auto-jumps to + Parts').toBe('true');
    expect(screen.getByTestId('inspector')).toBeTruthy();
    expect(h.engine.calls.select?.at(-1)?.[0]).toBe(0);   // the engine SELECTED it
  });
});

async function waitForLen(get: () => number, want: number, ms = 4000): Promise<void> {
  const t0 = Date.now();
  for (;;) {
    if (get() === want) return;
    if (Date.now() - t0 > ms) throw new Error(`length ${get()} never reached ${want}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}
