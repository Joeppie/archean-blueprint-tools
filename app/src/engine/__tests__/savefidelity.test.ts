// savefidelity.test.ts — the GAME stores and reads component orientation
// quaternions VERBATIM (proof: ISW-241's own files — workshop 3518436870
// (2025-07, no palette) and the game's 2026 re-save 3812927875 (palette
// embedded) carry BYTE-IDENTICAL orientation values for the same scene).
// So the editor MUST never rewrite an orientation it did not edit: the
// open→save funnel may embed the palette (the game does the same) but every
// components[].orientation stays exactly as loaded.
//
// The bug this pins (user 2026-10-20, in-game screenshots): opening a
// palette-less (2024-25) craft and saving conjugated EVERY quaternion
// (normalize rule 4), so the game — reading the values verbatim — placed the
// flipped rotations: ISW-241's caster wheel landed on TOP of the strut, and
// Jimmy's two-axis-tilted dashboard murals tore apart. Single-axis / 180°
// quaternions (w = 0 or pure-axis) conjugate to the SAME rotation, which is
// why only the multi-axis parts looked broken.
import { describe, expect, test } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { corpusDir } from '../../../tools/vite-corpus.ts';
import { emitDoc, parseDoc } from '../doc';
import { openFunnel, serializeSave } from '../edit';
import type { Blueprint } from '../format';
import { isLegacyFile } from '../format';

const CORPUS = corpusDir();
// repo-committed regression corpus (the built-in default corpus — the
// machine-local ARCHEAN_BLUEPRINTS override may point elsewhere, so pins on
// specific fixture ids read through this path)
const REPO_TESTDATA = new URL('../../../../testdata/', import.meta.url).pathname;

/** THE shipped open funnel (edit.ts openFunnel) + save — the exact path
 *  Editor.openText and File ▾ Save run. */
function funnel(text: string): { out: string; bp: Blueprint } {
  const { ctx } = openFunnel(text);
  return { out: serializeSave(ctx), bp: ctx.bp };
}

const files: [string, string][] = [];
if (existsSync(CORPUS)) {
  for (const e of readdirSync(CORPUS, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const p = `${CORPUS}/${e.name}/blueprint.json`;
    if (existsSync(p)) files.push([e.name, readFileSync(p, 'utf8')]);
  }
}

describe('open → save preserves component orientations VERBATIM', () => {
  test('the corpus is loaded', () => expect(files.length).toBeGreaterThan(80));

  test('palette-less (legacy) sources: every orientation byte-identical after save', () => {
    let checked = 0, legacyFiles = 0;
    for (const [id, text] of files) {
      const src = JSON.parse(text) as Blueprint;
      if (!isLegacyFile(src)) continue;                    // palette files below
      legacyFiles++;
      const { out } = funnel(text);
      const saved = JSON.parse(out) as Blueprint;
      src.data.components.forEach((c, ci) => {
        const q0 = c.orientation, q1 = saved.data.components[ci]?.orientation;
        if (!q0 || !q1) return;
        checked++;
        for (const k of ['w', 'x', 'y', 'z'] as const)
          expect(q0[k] === q1[k] || (Number.isNaN(q0[k]!) && Number.isNaN(q1[k]!)),
            `${id} comp ${ci} (${c.type}) orientation.${k} was rewritten by save `
            + `(${q0[k]} -> ${q1[k]}): the game stores quaternions VERBATIM, `
            + `so no migration step may touch them`).toBe(true);
      });
    }
    expect(legacyFiles).toBeGreaterThan(20);
    expect(checked).toBeGreaterThan(200);
  });

  test('the raw orientation LITERALS survive byte-for-byte (doc raw-literal store)', () => {
    // rule 4 used to flip n.raw too ("0.7071" → "-0.7071", "0.0" → "-0.0") —
    // compare the literal text slices of EVERY corpus file
    const lits = (s: string) => [...s.matchAll(/"orientation":\{[^}]*\}/g)].map(m => m[0]);
    for (const [id, text] of files) {
      const { out } = funnel(text);
      const before = lits(text);
      const after = lits(out);
      expect(after.length, `${id}: orientation count changed`).toBe(before.length);
      after.forEach((lit, i) =>
        expect(lit, `${id}: orientation #${i} literal changed`).toBe(before[i]));
    }
  });

  test('palette files: untouched save is byte-identical to the corpus file', () => {
    // repo-committed fixtures (always present, machine-independent)
    for (const id of ['3812927875', '3803780241', '9000004001']) {
      const text = readFileSync(`${REPO_TESTDATA}/${id}/blueprint.json`, 'utf8');
      const { out } = funnel(text);
      expect(out, `${id}: untouched palette craft must re-emit byte-identical`).toBe(text);
    }
  });

  test('legacy files KEEP the raw-quat display law after the funnel (flag survives palette embedding)', () => {
    // normalize embeds data.colors — if the engine re-derived the law from
    // the converted file it would flip to the conjugate chain and render
    // every legacy part mirror-rotated (the mural/"not flush" bug class).
    const text = readFileSync(`${REPO_TESTDATA}/3518436870/blueprint.json`, 'utf8');
    const { bp } = funnel(text);
    expect(bp.data.colors, 'funnel embedded the palette (migration as designed)').toBeTruthy();
    expect(isLegacyFile(bp), 'the RAW-quat law of the source file survives the migration').toBe(true);
  });

  test('undo re-open of the FIRST snapshot keeps the law too (same-text funnel)', () => {
    const text = readFileSync(`${REPO_TESTDATA}/3518436870/blueprint.json`, 'utf8');
    const first = funnel(text);
    const again = funnel(emitDoc(parseDoc(first.out)));
    const saved = JSON.parse(emitDoc(parseDoc(first.out))) as Blueprint;
    const again2 = JSON.parse(again.out) as Blueprint;
    saved.data.components.forEach((c, ci) => {
      const q0 = c.orientation, q1 = again2.data.components[ci]?.orientation;
      if (!q0 || !q1) return;
      for (const k of ['w', 'x', 'y', 'z'] as const) expect(Object.is(q0[k], q1[k])).toBe(true);
    });
  });
});
