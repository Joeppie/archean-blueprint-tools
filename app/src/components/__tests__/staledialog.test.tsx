// @vitest-environment jsdom
// Phase 3: the open-gate dialog's DOM laws (the CHOICE is the law — the
// IndexedDB state machine behind it stays the e2e integration tier).
import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import StaleDialog from '../StaleDialog';
import type { CacheInfo, CraftState } from '../../crafts';

afterEach(cleanup);

const renderGate = (state: CraftState, cached: CacheInfo | null = { saved: Date.UTC(2026, 9, 10) } as CacheInfo) => {
  const calls: string[] = [];
  render(<StaleDialog name="ISW-241" state={state} cached={cached}
    meta={{ mtime: Date.UTC(2026, 9, 20) } as never}
    onDownload={() => calls.push('download')} onCached={() => calls.push('cached')} />);
  return calls;
};

describe('StaleDialog — the open gate (v1.9.4 law)', () => {
  test('stale: the amber heading, the meaning line, BOTH dates', () => {
    renderGate('stale');
    expect(screen.getByTestId('stale-open-dialog').textContent).toContain('Edited since cached');
    expect(screen.getByTestId('stale-open-dialog').textContent).toContain('ISW-241');
    const text = screen.getByTestId('stale-open-dialog').textContent!;
    expect(text).toContain('cached 2026-10-10');           // the cache stamp
    expect(text).toContain('file changed 2026-10-20');     // the folder's newer mtime
    expect(text).toContain('Nothing is used or replaced without your choice');
  });
  test('unknown: the unversioned heading + the saved date, no mtime claim', () => {
    renderGate('unknown');
    const text = screen.getByTestId('stale-open-dialog').textContent!;
    expect(text).toContain('Cached copy unversioned');
    expect(text).toContain('saved 2026-10-10');
    expect(text).not.toContain('file changed');
  });
  test('missing stamps print the honest "unknown", never a fake date', () => {
    renderGate('stale', {} as CacheInfo);
    const text = screen.getByTestId('stale-open-dialog').textContent!;
    expect(text).toContain('cached unknown');
  });
  test('the two doors ARE the interface: each fires exactly its callback', () => {
    const calls = renderGate('stale');
    fireEvent.click(screen.getByTestId('stale-download'));
    fireEvent.click(screen.getByTestId('stale-usecached'));
    expect(calls).toEqual(['download', 'cached']);         // nothing auto-fires
  });
});
