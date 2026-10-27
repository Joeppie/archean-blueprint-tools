// @vitest-environment jsdom
// Phase 3 (docs/TEST-PYRAMID.md): the ToolDialog DOM laws, out of the browser.
// The modal is DEFINITION-GENERATED — the field grid from the ToolDef, the
// live preview gating OK, the OK ▸ confirm-box ▸ run flow (danger tools arm
// the red warning; Confirm runs and CLOSES, no inert second-OK), the
// Esc/✕/backdrop trio with the v1.5.20 Escape-subscribe-once law — all run on
// the SHIPPED TOOLS registry and the REAL open funnel over the SAME starter
// deck the e2e `gallery-new` opens. The values are tools.spec's green numbers
// (5 blocks change material; 35 faces on 5 blocks repaint; converted 5 blocks
// ▸ ≥12 triangles; every material 3, colours [4×7] untouched), transcribed
// before its legs retired (L5). tools.spec keeps the ≤95 % viewport + phone
// clear-zone pixel legs and the repaint law (stats().loads) that needs a
// scene; the tool→toast→undo integration stays in undo.spec.
import { afterEach, describe, expect, test } from 'vitest';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { ToolDialog, TOOLS, type ToolDef } from '../ToolsDialog';
import { newCraftDoc } from '../../engine/newcraft';
import { emitDoc } from '../../engine/doc';
import { openFunnel } from '../../engine/edit';
import type { Blueprint, Block } from '../../engine/format';
import type { EditCtx } from '../../engine/edit';

const tool = (id: string): ToolDef => TOOLS.find(t => t.id === id)!;

/** the EXACT blueprint `gallery-new` opens: newCraftDoc through the real funnel */
const starterDeck = () => {
  const { bp, ctx } = openFunnel(emitDoc(newCraftDoc()));
  return { bp, ctx };
};

/** an EMPTY craft — the refusal probe */
const emptyCraft = () =>
  openFunnel('{"author":"","data":{"blocks":[],"components":[],"version":2}}');

type H = { closed: () => number; applied: () => string[]; placed: () => number };

const renderTool = (
  t: ToolDef, bp: Blueprint, ctx: EditCtx, withPlace = false,
): H => {
  const state = { closed: 0, applied: [] as string[], placed: 0 };
  render(
    <ToolDialog tool={t} bp={bp} ctx={ctx}
      onClose={() => { state.closed++; }}
      onApplied={(m: string) => { state.applied.push(m); }}
      {...(withPlace ? { onPlaced: () => { state.placed++; } } : {})} />,
  );
  return { closed: () => state.closed, applied: () => state.applied, placed: () => state.placed };
};

const preview = () => screen.getByTestId('tool-preview').textContent ?? '';
const okBtn = () => screen.getByTestId('tool-ok') as HTMLButtonElement;
const blocksOf = (bp: Blueprint) => bp.data.blocks as Block[];

afterEach(cleanup);

describe('ToolDialog — fields are GENERATED from the ToolDef', () => {
  test('replace-all: long option lists render as native selects, showIf gates the pair', () => {
    const { bp, ctx } = starterDeck();
    renderTool(tool('replace-all'), bp, ctx);
    // target = a long-label pair → native select; materials target shows
    // destMaterial and hides destColor (showIf: target === 'colors')
    expect(screen.getByTestId('tool-select-target')).toBeTruthy();
    expect(screen.getByTestId('tool-field-destMaterial')).toBeTruthy();
    expect(screen.queryByTestId('tool-field-destColor')).toBeNull();
    fireEvent.change(screen.getByTestId('tool-select-target'), { target: { value: 'colors' } });
    expect(screen.getByTestId('tool-field-destColor')).toBeTruthy();
    expect(screen.queryByTestId('tool-field-destMaterial')).toBeNull();
  });
  test('replace-all: the dependent source options follow the target (optionsFor)', () => {
    const { bp, ctx } = starterDeck();
    renderTool(tool('replace-all'), bp, ctx);
    // material target → the MATERIALS chips (m0 = Composite is the default)
    expect(screen.getByTestId('tool-opt-source-m0')).toBeTruthy();
    fireEvent.change(screen.getByTestId('tool-select-target'), { target: { value: 'colors' } });
    // colour target → the colour sources (a long list: the native select)
    expect(screen.getByTestId('tool-select-source')).toBeTruthy();
    expect(screen.queryByTestId('tool-opt-source-m0')).toBeNull();
  });
  test('balloon: the TAIL fields exist only for the cylinder profile (+ fins)', () => {
    const { bp, ctx } = starterDeck();
    renderTool(tool('balloon'), bp, ctx, true);
    // the shipped default profile IS the cylinder (v1.9.0) → tail fields show
    expect(screen.getByTestId('tool-field-nose')).toBeTruthy();
    expect(screen.getByTestId('tool-field-tail')).toBeTruthy();
    expect(screen.getByTestId('tool-field-fins')).toBeTruthy();
    fireEvent.click(screen.getByTestId('tool-opt-profile-round'));
    expect(screen.queryByTestId('tool-field-nose')).toBeNull();
    expect(screen.queryByTestId('tool-field-fins')).toBeNull();
    fireEvent.click(screen.getByTestId('tool-opt-profile-cylinder'));
    expect(screen.getByTestId('tool-field-nose')).toBeTruthy();
    // finsize/oversize ride the fins toggle (showIf: finsOn)
    expect(screen.queryByTestId('tool-field-finsize')).toBeNull();
    fireEvent.click(screen.getByTestId('tool-opt-fins-on'));
    expect(screen.getByTestId('tool-field-finsize')).toBeTruthy();
    // every range field is slider + NUMBER BOX (the zeppelin reach, v1.7.2)
    expect(screen.getByTestId('tool-num-rx')).toBeTruthy();
    expect(screen.getByTestId('tool-range-rx')).toBeTruthy();
    // the paint is ONE control: finish chips + the new/nearest choice
    expect(screen.getByTestId('paint-finish-matte')).toBeTruthy();
    expect(screen.getByTestId('paint-how-new')).toBeTruthy();
  });
  test('the paint control is one row: a FINISH chip swap lights it alone', () => {
    const { bp, ctx } = starterDeck();
    renderTool(tool('balloon'), bp, ctx, true);
    fireEvent.click(screen.getByTestId('paint-finish-metal'));
    expect(screen.getByTestId('paint-finish-metal').className).toContain('on');
    expect(screen.getByTestId('paint-finish-matte').className).not.toContain('on');
    fireEvent.click(screen.getByTestId('paint-how-nearest'));
    expect(screen.getByTestId('paint-how-nearest').className).toContain('on');
    expect(screen.getByTestId('paint-how-new').className).not.toContain('on');
  });
});

describe('ToolDialog — the live preview gates OK', () => {
  test('the starter deck: 5 blocks change material — and OK is enabled', () => {
    const { bp, ctx } = starterDeck();
    renderTool(tool('replace-all'), bp, ctx);
    expect(preview()).toBe('5 blocks change material');   // tools.spec's line
    expect(okBtn().disabled).toBe(false);
  });
  test('an empty craft REFUSES: the preview says so, OK is disabled', () => {
    const { bp, ctx } = emptyCraft();
    renderTool(tool('replace-all'), bp, ctx);
    expect(preview()).toBe('nothing on this craft matches');
    expect(okBtn().disabled).toBe(true);
  });
});

describe('ToolDialog — Cancel / Esc / ✕ / backdrop (the subscribe-once law)', () => {
  test('Cancel closes and changes NOTHING (tools.spec leg 1)', () => {
    const { bp, ctx } = starterDeck();
    const before = JSON.parse(JSON.stringify(blocksOf(bp)));
    const h = renderTool(tool('replace-all'), bp, ctx);
    fireEvent.click(screen.getByTestId('tool-cancel'));
    expect(h.closed()).toBe(1);
    expect(JSON.parse(JSON.stringify(blocksOf(bp)))).toEqual(before);
  });
  test('Esc closes (window keydown; the v1.5.20 subscribe-once lesson)', () => {
    const { bp, ctx } = starterDeck();
    const h = renderTool(tool('replace-all'), bp, ctx);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(h.closed()).toBe(1);
  });
  test('✕ closes; a backdrop mousedown closes; a click INSIDE does not', () => {
    const { bp, ctx } = starterDeck();
    const h = renderTool(tool('replace-all'), bp, ctx);
    fireEvent.mouseDown(screen.getByTestId('tool-dialog-replace-all'));
    expect(h.closed()).toBe(0);
    fireEvent.mouseDown(screen.getByTestId('tool-backdrop-replace-all'));
    expect(h.closed()).toBe(1);
    cleanup();
    const h2 = renderTool(tool('hullify'), bp, ctx);
    fireEvent.click(screen.getByTestId('tool-close'));
    expect(h2.closed()).toBe(1);
  });
});

describe('ToolDialog — OK ▸ confirm ▸ run: replace-all MATERIALS (tools.spec, retired leg)', () => {
  test('composite deck ▸ aluminium: the data values, bp AND doc', () => {
    const { bp, ctx } = starterDeck();
    const h = renderTool(tool('replace-all'), bp, ctx);
    expect(preview()).toBe('5 blocks change material');   // the shipped default
    fireEvent.click(screen.getByTestId('tool-ok'));       // ▸ confirm box
    expect(screen.getByTestId('tool-confirm-box')).toBeTruthy();
    expect(preview()).toBe('5 blocks change material');   // the live readout rides in
    expect(screen.queryByTestId('tool-warning')).toBeNull(); // not a danger tool
    expect(blocksOf(bp).length).toBe(5);                  // confirm step mutates nothing
    fireEvent.click(screen.getByTestId('tool-confirm')); // runs + CLOSES
    expect(h.closed()).toBe(1);
    expect(h.applied()).toEqual(['re-materialled 5 blocks']);
    expect(blocksOf(bp).every(b => b.material === 3)).toBe(true);
    // colours untouched: the deck kept its slot-4 paint
    expect(blocksOf(bp)[0]!.colors).toEqual([4, 4, 4, 4, 4, 4, 4]);
    // the doc mirror (the save): the material literal is in the emitted text
    expect(emitDoc(ctx.doc)).toContain('"material":3');
  });
  test('Enter arms the confirm step, Enter runs it (footer idiom)', () => {
    const { bp, ctx } = starterDeck();
    const h = renderTool(tool('replace-all'), bp, ctx);
    const dialog = screen.getByTestId('tool-dialog-replace-all');
    fireEvent.keyDown(dialog, { key: 'Enter' });
    expect(screen.getByTestId('tool-confirm-box')).toBeTruthy();
    fireEvent.keyDown(dialog, { key: 'Enter' });
    expect(h.closed()).toBe(1);
    expect(blocksOf(bp).every(b => b.material === 3)).toBe(true);
  });
});

describe('ToolDialog — danger tool: hullify (tools.spec, retired leg)', () => {
  test('OK opens the info confirm box; Confirm converts + closes', () => {
    const { bp, ctx } = starterDeck();
    const h = renderTool(tool('hullify'), bp, ctx);
    expect(preview()).toMatch(/5 blocks ▸ \d+ triangles/);
    expect(preview()).toMatch(/shading flat/);             // the v1.5.12 default
    fireEvent.click(screen.getByTestId('tool-ok'));       // ▸ confirm box ONLY
    expect(blocksOf(bp).length).toBe(5);                  // nothing converted yet
    expect(screen.getByTestId('tool-confirm-box')).toBeTruthy();
    expect(screen.getByTestId('tool-warning').textContent)
      .toMatch(/rewrites hull geometry/i);                // danger arms the red line
    fireEvent.click(screen.getByTestId('tool-confirm')); // converts + closes
    expect(h.closed()).toBe(1);
    expect(blocksOf(bp).length).toBe(0);
    const tris = bp.data.triangles ?? [];
    expect(tris.length).toBeGreaterThanOrEqual(12);
    expect(tris.every(t => (t as { colors?: number[] }).colors?.length === 5)).toBe(true);
    expect(h.applied()[0]).toMatch(/^converted 5 blocks into \d+ hull triangles$/);
  });
});

describe('ToolDialog — COLOUR replace-all through the native select (tools.spec, retired leg)', () => {
  test('all faces ▸ hull paint: 35 faces on 5 blocks repaint, slot 51', () => {
    const { bp, ctx } = starterDeck();
    const h = renderTool(tool('replace-all'), bp, ctx);
    fireEvent.change(screen.getByTestId('tool-select-target'), { target: { value: 'colors' } });
    fireEvent.change(screen.getByTestId('tool-select-source'), { target: { value: 'all' } });
    fireEvent.change(screen.getByTestId('tool-select-destColor'), { target: { value: 'hull' } });
    expect(preview()).toBe('35 faces on 5 blocks repaint');   // the green e2e line
    fireEvent.click(screen.getByTestId('tool-ok'));
    fireEvent.click(screen.getByTestId('tool-confirm'));
    expect(h.applied()[0]).toBe('repainted 35 faces on 5 blocks');
    expect(blocksOf(bp).every(b => b.colors?.[0] === 51)).toBe(true);
  });
});
