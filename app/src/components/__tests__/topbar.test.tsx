// @vitest-environment jsdom
// Phase 3 (docs/TEST-PYRAMID.md): the TopBar MENU laws — the Tools ▾ list is
// the TOOLS registry rendered, the Edit ▾ Undo/Redo carry the Editor's
// history state, and the vessel-information TODO stays DISABLED and visible
// (the v1.7 declared-todo rule). These are the DOM half of tools.spec's
// 'the menu lists the registry' leg, which retired with it (L5); the
// mode-tile re-click law (KNOWN ISSUE 13: an active tile drops to ⌖ View)
// is the same prop contract panels.spec leans on — pinned once, cheaply,
// at the component tier.
import { afterEach, describe, expect, test } from 'vitest';
import type { ComponentProps } from 'react';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import TopBar from '../TopBar';
import { TOOLS } from '../ToolsDialog';

const renderBar = (over: Record<string, unknown> = {}) => {
  const calls: string[] = [];
  const p = {
    mode: 'edit' as const, onMode: (m: string) => calls.push(`mode:${m}`),
    dirty: false, title: 'TESTCRAFT', craftId: null,
    canUndo: false, canRedo: false,
    onUndo: () => calls.push('undo'), onRedo: () => calls.push('redo'),
    onNew: () => calls.push('new'), onOpen: () => calls.push('open'),
    onSave: () => calls.push('save'), onClose: () => calls.push('close'),
    onBack: () => calls.push('back'),
    tools: TOOLS.map(({ id, label, icon }) => ({ id, label, icon })),
    onTool: (id: string) => calls.push(`tool:${id}`),
    onHelp: () => calls.push('help'),
    ...over,
  };
  render(<TopBar {...(p as ComponentProps<typeof TopBar>)} />);
  return { calls };
};

afterEach(cleanup);

describe('TopBar — Tools ▾ lists the registry', () => {
  test('every TOOLS entry is a menu item; the footer says more tools follow', () => {
    renderBar();
    fireEvent.click(screen.getByTestId('tools-menu'));
    for (const t of TOOLS)
      expect(screen.getByTestId(`tool-${t.id}`)).toBeTruthy();
    expect(screen.getByTestId('tools-dropdown').textContent).toContain('more tools to follow');
  });
  test('picking an entry calls onTool with its id', () => {
    const { calls } = renderBar();
    fireEvent.click(screen.getByTestId('tools-menu'));
    fireEvent.click(screen.getByTestId('tool-replace-all'));
    expect(calls).toContain('tool:replace-all');
  });
});

describe('TopBar — Edit ▾ carries the history + TODO state', () => {
  test('Undo/Redo are DISABLED without history; a canUndo prop lights Undo', () => {
    renderBar();
    fireEvent.click(screen.getByTestId('edit-menu'));
    expect((screen.getByTestId('edit-undo') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('edit-redo') as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    renderBar({ canUndo: true });
    fireEvent.click(screen.getByTestId('edit-menu'));
    expect((screen.getByTestId('edit-undo') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId('edit-undo'));
    // (calls via the fresh render's spy is not captured here — the disabled
    // STATE is the law; the wiring call path is Editor-level, e2e undo.spec)
  });
  test('the vessel-information TODO rows stay listed and DISABLED', () => {
    renderBar();
    fireEvent.click(screen.getByTestId('edit-menu'));
    for (const id of ['edit-vessel-name', 'edit-vessel-author', 'edit-vessel-code'])
      expect((screen.getByTestId(id) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('TopBar — mode tiles (the KNOWN ISSUE 13 contract)', () => {
  test('a tile arms its mode; RE-CLICKING the ACTIVE tile drops to ⌖ clean', () => {
    const { calls } = renderBar();
    fireEvent.click(screen.getByTestId('mode-wire'));
    expect(calls).toContain('mode:wire');
    // mode prop is 'edit' → clicking the ACTIVE edit tile = drop to clean
    fireEvent.click(screen.getByTestId('mode-edit'));
    expect(calls).toContain('mode:clean');
  });
});
