// @vitest-environment jsdom
// Phase 3 seed (docs/TEST-PYRAMID.md): the MIRROR GLYPH (v1.11, ui.tsx) —
// the dashed plane + solid triangle + reflected ghost, and the red strike
// line ONLY on the off state. The dock's mirw-* chips' engine behaviour (the
// axis state) is an Engine law and stays e2e; the glyph's DOM identity — the
// data-g contract builddock.spec reaches through the full app — is fully
// expressible at this tier.
import { describe, expect, test } from 'vitest';
import { render } from '@testing-library/react';
import { MirrorGlyph } from '../ui';

describe('MirrorGlyph — the mirror rule in one mark', () => {
  test('the lit state: data-g="mirror", plane + solid + ghost, NO strike', () => {
    const { container } = render(<MirrorGlyph />);
    const svg = container.querySelector('svg[data-g="mirror"]');
    expect(svg).toBeTruthy();
    expect(container.querySelector('[data-g="mirror-strike"]')).toBeNull();
    expect(svg!.querySelectorAll('path')).toHaveLength(2);   // solid + ghost
  });
  test('the OFF state: data-g="mirror-off" wears the red strike line', () => {
    const { container } = render(<MirrorGlyph strike />);
    expect(container.querySelector('svg[data-g="mirror-off"]')).toBeTruthy();
    const strike = container.querySelector('line[data-g="mirror-strike"]');
    expect(strike).toBeTruthy();
    expect(strike!.getAttribute('stroke')).toBe('#ff6b6b');
  });
  test('the size prop drives the box', () => {
    const { container } = render(<MirrorGlyph size={24} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('24');
    expect(svg.getAttribute('height')).toBe('24');
  });
});
