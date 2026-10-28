// Panel.dom.test.tsx — jsdom tier: the inspector's DATA rows for a Buzzer
// show the NAMED mode select (we: "component buzzer should have a better
// setting for its 'mode' so its named modes not just numerical values").
// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DataRows } from '../Panel';

afterEach(cleanup);

const buzzer = { type: 'Buzzer', data: { mode: 2 } } as any;

describe('Buzzer mode row (named modes)', () => {
  it('renders a select with the game tone names, current one chosen', () => {
    render(<DataRows comp={buzzer} compPath={['data', 'components', 0]}
      edits={{ dataField: vi.fn() } as any} ctx={{} as any} markDirty={() => {}} />);
    const sel = screen.getByTestId('data-mode') as HTMLSelectElement;
    expect(sel.value).toBe('2');
    const opts = [...sel.options].map(o => o.textContent);
    expect(opts).toEqual(['0 · sine', '1 · square', '2 · triangle', '3 · sawtooth']);
  });
  it('a change writes the numeric mode through dataField (file stays numeric)', () => {
    const dataField = vi.fn();
    render(<DataRows comp={buzzer} compPath={['data', 'components', 0]}
      edits={{ dataField } as any} ctx={{} as any} markDirty={() => {}} />);
    fireEvent.change(screen.getByTestId('data-mode'), { target: { value: '3' } });
    expect(dataField).toHaveBeenCalledWith({}, ['data', 'components', 0], 'mode', 3);
  });
  it('non-Buzzer parts keep the plain numeric row', () => {
    render(<DataRows comp={{ type: 'Lamp', data: { mode: 2 } } as any}
      compPath={['data', 'components', 1]}
      edits={{ dataField: vi.fn() } as any} ctx={{} as any} markDirty={() => {}} />);
    expect(screen.queryByTestId('data-mode')).toBeNull();
  });
});
