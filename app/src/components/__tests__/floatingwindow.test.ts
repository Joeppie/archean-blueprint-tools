// floatingwindow.test.ts - the movable-window geometry law: stored rects
// reopen as-is while reachable; an off-screen title bar reopens at INITIAL
// ("if they are moved off screen, re-opening them fixes"); drags clamp so
// the title strip stays reachable.
import { describe, expect, it } from 'vitest';
import { bestRect, clampRect, rectOnScreen, type Rect } from '../FloatingWindow';

const R = (x: number, y: number, w = 800, h = 600): Rect => ({ x, y, w, h });

describe('window geometry', () => {
  it('keeps a stored rect whose title strip is on screen', () => {
    expect(rectOnScreen(R(10, 20), 1280, 800)).toBe(true);
    expect(bestRect(R(10, 20), R(100, 100), 1280, 800)).toEqual(R(10, 20));
  });
  it('reopens at the initial rect when the stored one is off-screen', () => {
    expect(rectOnScreen(R(3000, 20), 1280, 800)).toBe(false);   // far right
    expect(rectOnScreen(R(10, -120), 1280, 800)).toBe(false);   // above the top
    const initial = R(240, 40);
    expect(bestRect(R(3000, 20), initial, 1280, 800)).toEqual(initial);
    expect(bestRect(undefined, initial, 1280, 800)).toEqual(initial);
  });
  it('clamps drags so the title strip stays reachable, sizes to viewport', () => {
    const far = clampRect(R(-10_000, -900, 800, 600), 1280, 800, 360, 240);
    expect(rectOnScreen(far, 1280, 800)).toBe(true);
    expect(far.y).toBe(0);
    const big = clampRect(R(0, 0, 9999, 9999), 1280, 800, 360, 240);
    expect(big.w).toBeLessThanOrEqual(1280);
    expect(big.h).toBeLessThanOrEqual(800);
    const tiny = clampRect(R(10, 10, 10, 10), 1280, 800, 360, 240);
    expect(tiny.w).toBe(360);
  });
});
