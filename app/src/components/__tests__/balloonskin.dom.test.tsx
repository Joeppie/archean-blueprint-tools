// @vitest-environment jsdom
// balloonskin.dom.test.tsx — the GENERATE BALLOON dialog's PREVIEW laws on
// the SHIPPED ToolDef over the real open funnel (Phase 3, v1.12.5).
// Retired here (L5, same commit as sphereskin.spec.ts legs):
//  • 'the sliders retune the plan (worker) and the preview prints the
//    deviation line'  → test 1 (dev −0.xx/+0.xx m, lift@SL trio, the
//    plan scaling with the number boxes, the round sag stays 0.0x);
//  • 'the number box reaches past the slider, and needles refuse honestly'
//    → test 2 (r=20 box > 5000 triangles, the 0.5/1/12 needle stores, the
//    0.05³ honest refusal + OK disabled, ⚖ Fix re-enables OK);
//  • 'BOTH bodies store the needle' (PREVIEW/token half) → test 3
//    ('cylinder + N% nose / N% tail', nose 90, tail 15, fields visible);
//    the STORE half is latsphere.test 'the needle the ELLIPSOID refuses
//    becomes a small storable skin' (+ the needle nose/tail blend);
//  • 'paint is ONE control: the finish rides the committed palette slot'
//    (PREVIEW half) → test 3 ('matte paint' → 'metal paint'); the COMMIT
//    half is tooldoc 'the shipped sphere commit writes the picked finish
//    into the saved slot' (#c9c9c9 = 201 · metallic 1 · roughness 0).
// The e2e legs keep what jsdom cannot state: the worker round-trip itself,
// the movable ghost, ✔ Build → file, the TAIL build-to-file ritual.
import { afterEach, describe, expect, test } from 'vitest';
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { ToolDialog, TOOLS, type ToolDef } from '../ToolsDialog';
import { newCraftDoc } from '../../engine/newcraft';
import { emitDoc } from '../../engine/doc';
import { openFunnel } from '../../engine/edit';
import type { Blueprint } from '../../engine/format';
import type { EditCtx } from '../../engine/edit';

const balloon = (): ToolDef => TOOLS.find(t => t.id === 'balloon')!;
const starter = () => openFunnel(emitDoc(newCraftDoc()));

const renderTool = (bp: Blueprint, ctx: EditCtx) =>
  render(<ToolDialog tool={balloon()} bp={bp} ctx={ctx}
    onClose={() => { /* closed */ }} onApplied={() => { /* applied */ }}
    onPlaced={() => { /* staged */ }} />);

const preview = () => screen.getByTestId('tool-preview').textContent ?? '';
const okBtn = () => screen.getByTestId('tool-ok') as HTMLButtonElement;
const setNum = (key: string, v: number) =>
  fireEvent.change(screen.getByTestId(`tool-num-${key}`), { target: { value: String(v) } });
const trisIn = () => {
  const m = preview().match(/(\d+) triangles/);
  return m ? +m[1]! : 0;
};
const settled = (pred: (t: string) => boolean, ms = 60_000) =>
  waitFor(() => {
    const t = preview();
    if (!pred(t)) throw new Error(`preview line: ${t}`);
  }, { timeout: ms });

afterEach(cleanup);

describe('balloon dialog — the preview laws (was sphereskin e2e)', () => {
  test('the ellipsoid prints the DEVIATION + lift lines; the boxes retune the plan', async () => {
    const { bp, ctx } = starter();
    renderTool(bp, ctx);
    // the shipped default is the CYLINDER; the deviation lineage is the
    // ELLIPSOID's — pick the round hull EXPLICITLY (the e2e re-pin law)
    fireEvent.click(screen.getByTestId('tool-opt-profile-round'));
    await settled(t => /triangles/.test(t) && /dev −0\.\d\d\/\+0\.\d\d m/.test(t));
    expect(preview()).toMatch(/lift@SL vacuum .* · He .* · H₂ /);
    const small = trisIn();
    setNum('rx', 8); setNum('ry', 8); setNum('rz', 8);
    await settled(() => trisIn() > small * 8, 30_000);
    // the sag stays ROUND at zeppelin size (the pin the old suites lacked)
    expect(preview()).toMatch(/dev −0\.0\d\/\+0\.\d\d m/);
  }, 120_000);

  test('the number box reaches past the slider: r=20 plans a zeppelin-plus skin', async () => {
    const { bp, ctx } = starter();
    renderTool(bp, ctx);
    fireEvent.click(screen.getByTestId('tool-opt-profile-round'));   // the e2e's explicit ELLIPSOID
    // a 20 m radius is over the slider's 8 m reach — the box takes it
    setNum('rx', 20); setNum('ry', 20); setNum('rz', 20);
    await settled(() => trisIn() > 5000, 60_000);            // zeppelin-plus
  }, 120_000);

  test('a needle (0.5/1/12) stores on the cylinder; an honest refusal at 0.05³; ⚖ Fix re-enables OK', async () => {
    const { bp, ctx } = starter();
    renderTool(bp, ctx);                                     // default = cylinder
    setNum('rx', 0.5); setNum('ry', 1); setNum('rz', 12);
    await settled(t => /\d+ triangles/.test(t) && !/nothing to place/.test(t), 60_000);
    cleanup();
    const s2 = starter();
    renderTool(s2.bp, s2.ctx);
    setNum('rx', 0.05); setNum('ry', 0.05); setNum('rz', 0.05);
    await settled(t => /nothing to place/.test(t), 30_000);
    expect(okBtn().disabled).toBe(true);                     // the honest refusal
    // THE REPAIR (user 2026-10-22): ⚖ Fix probes a nearest placeable blend
    fireEvent.click(screen.getByTestId('tool-fix'));
    await settled(() => trisIn() > 0 && !/nothing to place/.test(preview()), 90_000);
    expect(okBtn().disabled).toBe(false);
  }, 180_000);

  test('nose/tail print SEPARATELY and retune independently; the paint is ONE control', async () => {
    const { bp, ctx } = starter();
    renderTool(bp, ctx);                                     // cylinder default
    await settled(t => /cylinder \+ \d+% nose \/ \d+% tail/.test(t), 30_000);
    expect(screen.getByTestId('tool-field-nose')).toBeTruthy();
    expect(screen.getByTestId('tool-field-tail')).toBeTruthy();
    expect(screen.getByTestId('tool-field-facets')).toBeTruthy();
    // the v1.7.3 fields are ONE row + the preview names the FINISH
    expect(preview()).toMatch(/matte paint/);
    fireEvent.click(screen.getByTestId('paint-finish-metal'));
    await settled(t => /metal paint/.test(t), 30_000);
    // nose reaches PAST the old 70 cap; the tail retunes independently
    fireEvent.change(screen.getByTestId('tool-range-nose'), { target: { value: '90' } });
    await settled(t => /90% nose/.test(t) && /\d+ triangles/.test(t), 30_000);
    fireEvent.change(screen.getByTestId('tool-range-tail'), { target: { value: '15' } });
    await settled(t => /15% tail/.test(t) && /\d+ triangles/.test(t), 30_000);
  }, 120_000);
});
