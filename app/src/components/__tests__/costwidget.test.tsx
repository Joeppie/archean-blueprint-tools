// @vitest-environment jsdom
// Phase 3 (docs/TEST-PYRAMID.md): the VIEW ▸ Build cost panel DOM laws — the
// shopping list, the per-component rows and recipe-chain expansion, the
// structural sections (blocks / hull triangles / cables), the fold law and
// its localStorage persistence. CostWidget is a PURE (bp, rev) component fed
// by loadEconomy's fetch, so the browser legs of cost.spec retire here (L5)
// with the SAME crafts, the SAME shipped economy.json and the SAME green
// numbers (FluidPort ×4 · 4 kg Iron · 157 cells · 241 tris · 150.6 m ·
// ×7,362 · 74.8 m); the math itself is economy.test.ts's tier. cost.spec
// keeps the phone fit leg (panel width = device law).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { CostWidget } from '../CostWidget';
import { openFunnel } from '../../engine/edit';
import type { Blueprint } from '../../engine/format';

/** repo root, computed from this file (NEVER a machine path) */
const REPO = resolve(__dirname, '..', '..', '..', '..');

const ECON = JSON.parse(readFileSync(
  resolve(REPO, 'viewer/models/economy.json'), 'utf8'));

// the shipped table answers EVERY atlasJsonPaths candidate (the fetch seam
// is the only external call CostWidget makes)
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', (_path: string) =>
    Promise.resolve({ ok: true, json: async () => ECON } as unknown as Response));
});
afterEach(cleanup);

/** the real open funnel over the committed testdata craft (the tier e2e boots) */
const craft = (id: string): Blueprint =>
  openFunnel(readFileSync(resolve(REPO, 'testdata', id, 'blueprint.json'), 'utf8')).bp;

/** decks + a hull skin + 110 cable runs — the structural sections' fixture */
const STRUCTURE = '3732302108';
/** 4 FluidPorts, one inside a Build subgrid — the nested-content fixture */
const DOLPHIN = '3417786605';

const open = async (bp: Blueprint) => {
  render(<CostWidget bp={bp} rev={0} />);
  // the economy table lands through the mocked fetch — the shopping list is
  // the first thing that can only render after it
  await screen.findByTestId('cost-total');
};

describe('CostWidget — raw total + per-component breakdown (was cost.spec, retired)', () => {
  test("the dolphin's shopping list, FluidPort ×4, its chain to the constituents", async () => {
    await open(craft(DOLPHIN));
    const head = screen.getByTestId('cost-head');
    expect(head.textContent).toContain('parts');
    expect(head.textContent).toContain('cells');
    // the craft-wide shopping list carries the dolphin's biggest ore
    const iron = screen.getByTestId('cost-total-Iron');
    expect(iron.textContent).toContain('kg');
    // the FluidPort row: 4 of them (3 placed + 1 in a Build subgrid)
    const fpRow = screen.getByTestId('cost-row-FluidPort');
    expect(fpRow.textContent).toContain('×4');
    expect(fpRow.textContent).toContain('subgrid');
    // its summary is its per-part raw cost, scaled by 4: 4,000 g iron = 4 kg
    const sum = screen.getByTestId('cost-sum-FluidPort');
    expect(sum.textContent).toContain('Iron');
    expect(sum.textContent).toContain('4 kg');
    // open it: the constituents are the recipe's own inputs …
    fireEvent.click(screen.getByTestId('cost-open-FluidPort'));
    expect(screen.getByTestId('cost-detail-FluidPort')).toBeTruthy();
    expect(screen.getByTestId('cost-node-Casing').textContent).toContain('1 kg Iron');
    expect(screen.getByTestId('cost-node-Connector').textContent).toContain('Carbon');
    // … and a constituent expands further: Connector → Wire + Plastic
    fireEvent.click(screen.getByTestId('cost-expand-Connector'));
    expect(screen.getByTestId('cost-node-Wire')).toBeTruthy();
    expect(screen.getByTestId('cost-node-Plastic')).toBeTruthy();
    // collapsing hides the chain again (no stale tree)
    fireEvent.click(screen.getByTestId('cost-open-FluidPort'));
    expect(screen.queryByTestId('cost-detail-FluidPort')).toBeNull();
  });
  test('a recipe-less part is flagged, not silently free', async () => {
    await open(craft(DOLPHIN));
    expect(screen.getByTestId('cost-head').textContent).not.toContain('no economy data');
    expect(screen.getByTestId('cost-rows').textContent).toContain('Aileron');
    expect(screen.getByTestId('cost-total')).toBeTruthy();
  });
});

describe('CostWidget — blocks, hull triangles, cables (was cost.spec, retired)', () => {
  test('each species bills its own quantity with the physical measure', async () => {
    await open(craft(STRUCTURE));
    // BLOCKS — 157 aluminium cells on the deck, and the section says so
    expect(screen.getByTestId('cost-source-note-blocks').textContent).toContain('cells');
    const alu = screen.getByTestId('cost-source-row-blocks-AluminiumBlock');
    expect(alu.textContent).toContain('×157');
    expect(screen.getByTestId('cost-source-measure-blocks-AluminiumBlock').textContent)
      .toContain('157 cells');
    // a block row opens into ITS constituents (a cell = 1 AluminiumBlock)
    fireEvent.click(screen.getByTestId('cost-source-open-blocks-AluminiumBlock'));
    expect(screen.getByTestId('cost-source-detail-blocks-AluminiumBlock').textContent)
      .toContain('Aluminium');
    // HULL TRIANGLES — 241 tris over 34.5 m², billed in block items
    const triNote = screen.getByTestId('cost-source-note-triangles').textContent!;
    expect(triNote).toContain('241 tris');
    expect(triNote).toContain('m²');
    expect(screen.getByTestId('cost-source-row-triangles-AluminiumBlock').textContent)
      .toContain('×248');
    expect(screen.getByTestId('cost-source-measure-triangles-AluminiumBlock').textContent)
      .toContain('m²');
    // CABLES — the LENGTH the craft actually needs, plus the spool items
    const cabNote = screen.getByTestId('cost-source-note-cables').textContent!;
    expect(cabNote).toContain('110 runs');
    expect(cabNote).toContain('150.6 m');
    expect(screen.getByTestId('cost-source-row-cables-DataCable').textContent).toContain('×7,362');
    expect(screen.getByTestId('cost-source-measure-cables-DataCable').textContent)
      .toContain('74.8 m');
    // … and a cable's own constituents: Wire + Connector per spool batch
    fireEvent.click(screen.getByTestId('cost-source-open-cables-DataCable'));
    expect(screen.getByTestId('cost-source-detail-cables-DataCable')).toBeTruthy();
    expect(screen.getByTestId('cost-node-Wire')).toBeTruthy();
    expect(screen.getByTestId('cost-node-Connector')).toBeTruthy();
  });
});

describe('CostWidget — the fold law (was cost.spec, retired)', () => {
  test('sections fold, keep their header note, and the fold survives a reload', async () => {
    const bp = craft(STRUCTURE);
    await open(bp);
    // BLOCKS: folding hides the rows but keeps the header's summary
    expect(screen.getByTestId('cost-source-row-blocks-AluminiumBlock')).toBeTruthy();
    fireEvent.click(screen.getByTestId('cost-sec-blocks'));
    expect(screen.queryByTestId('cost-source-row-blocks-AluminiumBlock')).toBeNull();
    expect(screen.getByTestId('cost-source-note-blocks').textContent).toContain('cells');
    fireEvent.click(screen.getByTestId('cost-sec-blocks'));
    expect(screen.getByTestId('cost-source-row-blocks-AluminiumBlock')).toBeTruthy();
    // the raw-material list folds too
    fireEvent.click(screen.getByTestId('cost-sec-raw'));
    expect(screen.queryByTestId('cost-total')).toBeNull();
    fireEvent.click(screen.getByTestId('cost-sec-raw'));
    expect(screen.getByTestId('cost-total')).toBeTruthy();
    // a fold is a PREFERENCE: it comes back folded after a reload (the e2e
    // page.reload() is, at this tier, the same fresh-mount from localStorage)
    fireEvent.click(screen.getByTestId('cost-sec-components'));
    expect(screen.queryByTestId('cost-rows')).toBeNull();
    cleanup();
    render(<CostWidget bp={bp} rev={0} />);
    await screen.findByTestId('cost-source-note-blocks');
    expect(screen.queryByTestId('cost-rows')).toBeNull();
    expect(screen.getByTestId('cost-sec-components').getAttribute('aria-expanded')).toBe('false');
    // … and can be opened again (the state is not sticky-locked)
    fireEvent.click(screen.getByTestId('cost-sec-components'));
    expect(screen.getByTestId('cost-rows')).toBeTruthy();
  });
});
