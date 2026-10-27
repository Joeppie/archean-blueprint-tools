// @vitest-environment jsdom
// Phase 3 seed (docs/TEST-PYRAMID.md): the LiftWidget's own DOM laws — the
// fold (persisted), the SEALED-envelope readout on a craft whose blocks seal
// the outside flood, the per-gas rows and the weight-limit ladder. The widget
// tolerates `engine: null` (mass 0), so its envelope/lift laws live here
// cheaply; the numbers are the same atmo.ts physics the atmo.test.ts tier
// pins (vacuum lift = V × 1.225 kg·m⁻³ @ SL). The e2e lift legs stay where
// they are (sphereskin pins the widget riding a BUILT balloon through the
// real dialog→ghost→Build ritual — integration, this file never claims it).
import { beforeEach, describe, expect, test, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { LiftWidget } from '../LiftWidget';
import { GASES } from '../../engine/atmo';
import type { Blueprint } from '../../engine/format';

// a closed 5×5×5-cell block shell (the v1.11 sealed-flood law): 98 wall cells
// around a 27-cell core → the sealed envelope is the FULL cube: 125 cells
const shell = (): Blueprint => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blocks: any[] = [];
  for (let x = 0; x < 5; x++)
    for (let y = 0; y < 5; y++)
      for (let z = 0; z < 5; z++)
        if (x === 0 || y === 0 || z === 0 || x === 4 || y === 4 || z === 4)
          blocks.push({
            colors: [0, 0, 0, 0, 0, 0, 0],
            frame_x: 0, pos_x: x, frame_y: 0, pos_y: y, frame_z: 0, pos_z: z,
            material: 0, size_x: 0, size_y: 0, size_z: 0, type: 0,
          });
  return { data: { blocks, triangles: [] } } as unknown as Blueprint;
};

const empty = (): Blueprint =>
  ({ data: { blocks: [], triangles: [] } }) as unknown as Blueprint;

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('LiftWidget — fold + sealed envelope', () => {
  test('the EMPTY readout speaks enclosed blocks + skin, not triangles alone (was phoneux e2e)', () => {
    // v1.11.1 copy law: the empty state explains the sealed-flood rule
    // (enclosed BLOCKS and/or a skin; walls alone displace no lift) and
    // points at Generate balloon — the outdated triangles-only wording is
    // GONE (the phoneux pin transcribed).
    render(<LiftWidget engine={null} bp={empty()} rev={0} />);
    fireEvent.click(screen.getByTestId('lift-toggle'));
    const body = screen.getByTestId('lift-widget').textContent ?? '';
    expect(body).toContain('enclosed blocks');
    expect(body).toContain('Generate balloon');
    expect(body, 'the outdated triangles-only wording is gone').not.toContain('no hull triangles yet');
  });

  test('a sealed block shell reports its envelope, per-gas rows and the ladder', () => {
    render(<LiftWidget engine={null} bp={shell()} rev={0} />);
    // collapsed one-liner: 125 cells × 0.25³ = 1.953 m³, vacuum lift 2 kg
    expect(screen.getByTestId('lift-head').textContent).toContain('2 m³');
    expect(screen.getByTestId('lift-head').textContent).toContain('vacuum 2 kg');
    fireEvent.click(screen.getByTestId('lift-toggle'));
    expect(screen.getByTestId('lift-body')).toBeTruthy();
    expect(screen.getByTestId('lift-sealed').textContent).toContain('sealed hull');
    // 125 cells = 1.953 m³ (fmt 1 dp → 2)
    expect(screen.getByTestId('lift-volume').textContent).toBe('2 m³');
    for (const g of GASES)
      expect(screen.getByTestId(`lift-row-${g.id}`)).toBeTruthy();
    // engine null → mass 0 → every margin is positive, nothing says sinks
    expect(screen.getByTestId('lift-gases').textContent).not.toContain('sinks');
    // the weight-limit ladder: 6 altitude steps
    expect(screen.getAllByTestId('lift-altitudes')[0]!.querySelectorAll('tbody tr')).toHaveLength(6);
  });
  test('an open craft says so honestly: no envelope, the sealing advice', () => {
    render(<LiftWidget engine={null} bp={empty()} rev={0} />);
    expect(screen.getByTestId('lift-head').textContent).toContain('no sealed envelope');
    fireEvent.click(screen.getByTestId('lift-toggle'));
    expect(screen.getByTestId('lift-widget').textContent).toContain('nothing sealed yet');
    expect(screen.queryByTestId('lift-gases')).toBeNull();
  });
  test('the fold is a PREFERENCE: a fresh mount comes back open', () => {
    render(<LiftWidget engine={null} bp={shell()} rev={0} />);
    fireEvent.click(screen.getByTestId('lift-toggle'));          // open (persist)
    cleanup();
    render(<LiftWidget engine={null} bp={shell()} rev={0} />);
    expect(screen.getByTestId('lift-body')).toBeTruthy();
  });
});
