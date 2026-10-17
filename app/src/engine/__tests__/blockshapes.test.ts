// Block shape/orientation table pins (ported BlockShapes.hh ranges + the
// GetRotationFromType quirks: slopes and inverse corners skip rotation rows).
import { describe, expect, test } from 'vitest';
import {
  OCCUPANCY_TYPE, SHAPE, getBlockEdges, getBlockFaceDirections, getBlockPoints,
  getShapeFromType, isFullFace, shapeName,
} from '../blockshapes';

describe('type ranges', () => {
  test('shape boundaries per type number', () => {
    expect(getShapeFromType(0)).toBe(SHAPE.CUBE);
    expect(getShapeFromType(1)).toBe(SHAPE.SLOPE);
    expect(getShapeFromType(12)).toBe(SHAPE.SLOPE);
    expect(getShapeFromType(13)).toBe(SHAPE.CORNER);
    expect(getShapeFromType(20)).toBe(SHAPE.CORNER);
    expect(getShapeFromType(21)).toBe(SHAPE.PYRAMID);
    expect(getShapeFromType(44)).toBe(SHAPE.PYRAMID);
    expect(getShapeFromType(45)).toBe(SHAPE.INVCORNER);
    expect(getShapeFromType(52)).toBe(SHAPE.INVCORNER);
  });
  test('shapeName + occupancy', () => {
    expect(shapeName(OCCUPANCY_TYPE)).toBe('occupancy');
    expect(shapeName(4)).toBe('slope');       // the thin tilted rod
    expect(shapeName(45)).toBe('inverse corner');
  });
});

describe('orientation table (GetRotationFromType)', () => {
  test('slope orientations jump: type 9 → rotation row 12, type 1 → row 1', () => {
    // slope type t = orientation (t−1): TYPE_ROTATION jumps 8..11 → 12..15
    // type 9 = orientation 8 → row 12, maps (x,y,z)→(−y,x,z)
    expect(getBlockFaceDirections(9)).toEqual(
      [null, [0, 1, 0], [0, -1, 0], [0, 0, -1], [1, 0, 0]]);
    // type 1 = orientation 0 → row 0 (identity): the raw local dirs
    expect(getBlockFaceDirections(1)).toEqual(
      [null, [1, 0, 0], [-1, 0, 0], [0, 0, -1], [0, -1, 0]]);
  });
  test('cube type 0 keeps the canonical face directions', () => {
    expect(getBlockFaceDirections(0)).toEqual([
      [0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, -1], [0, 0, 1],
    ]);
  });
  test('rotated slopes keep axis-aligned dirs with exactly one slant', () => {
    for (let t = 1; t <= 12; t++) {
      const dirs = getBlockFaceDirections(t);
      const slants = dirs.filter(d => d === null).length;
      expect(slants, `type ${t}`).toBe(1);
      for (const d of dirs) if (d) expect(Math.abs(d[0] + d[1] + d[2])).toBe(1);
    }
  });
  test('inverse corners use rotation rows 0..3 then 8..11', () => {
    // type 45 (row 0) faces +y up; type 49 (row 8: [−1,0,0;0,−1,0;0,0,1]) flips top to −y… top face dir:
    expect(getBlockFaceDirections(45)[0]).toEqual([0, 1, 0]);
    expect(getBlockFaceDirections(49)[0]).toEqual([0, -1, 0]);
  });
});

describe('geometry', () => {
  test('cube spans its unit cell from the origin corner', () => {
    const pts = getBlockPoints(0, [1, 2, 3], [0.25, 0.5, 1]);
    expect(pts.length).toBe(8);
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), zs = pts.map(p => p[2]);
    expect(Math.min(...xs)).toBeCloseTo(1, 10); expect(Math.max(...xs)).toBeCloseTo(1.25, 10);
    expect(Math.min(...ys)).toBeCloseTo(2, 10); expect(Math.max(...ys)).toBeCloseTo(2.5, 10);
    expect(Math.min(...zs)).toBeCloseTo(3, 10); expect(Math.max(...zs)).toBeCloseTo(4, 10);
  });
  test('full-face mask per shape (interior-culling gate)', () => {
    for (let f = 0; f < 6; f++) expect(isFullFace(0, f)).toBe(true);
    expect(isFullFace(1, 0)).toBe(false);     // slope slant
    expect(isFullFace(1, 3)).toBe(true); expect(isFullFace(1, 4)).toBe(true);
    expect(isFullFace(45, 0)).toBe(false);    // invcorner top is partial
    expect(isFullFace(45, 1)).toBe(true);
  });
  test('edge tables are index-valid', () => {
    const n: Record<number, number> = { 0: 8, 1: 6, 13: 4, 21: 5, 45: 7 };
    for (const [t, count] of Object.entries(n)) {
      const verts = getBlockPoints(+t, [0, 0, 0], [1, 1, 1]);
      expect(verts.length).toBe(count);
      for (const [a, b] of getBlockEdges(+t)) {
        expect(a).toBeLessThan(count); expect(b).toBeLessThan(count);
      }
    }
  });
});
