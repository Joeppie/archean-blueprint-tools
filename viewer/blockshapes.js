// blockshapes.js — geometry of build blocks, i.e. what each `blocks[].type`
// number means. Ported from the game's src/modules/ARCHEAN_build/BlockShapes.hh
// (GetPoints/GetFaces/ROTATIONS), via the game developer's own XenonViewer
// (viewer.xenontools.dev, js/blockshapes.js) — see NOTICE.md §2 for ownership.
//
// A block carries its SHAPE and ORIENTATION in its single `type` field:
//   0        cube (1 orientation)
//   1..12    slope (12)          — includes the thin tilted "rods" (type 4)
//   13..20   corner (8)
//   21..44   pyramid (24)
//   45..52   inverse corner (8)
//   255      component occupancy reservation, no geometry
export const SHAPE = { CUBE: 0, SLOPE: 1, CORNER: 2, PYRAMID: 3, INVCORNER: 4 };
export const OCCUPANCY_TYPE = 255;

const CUBE_INDEX = 0;
const SLOPE_INDEX = 1;
const CORNER_INDEX = 13;
const PYRAMID_INDEX = 21;
const INVCORNER_INDEX = 45;
const SHAPES_END_INDEX = 53;

// The 24 proper rotations, stored column-major (mat3: c0,c1,c2).
const ROTATIONS = [
  [1, 0, 0, 0, 1, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, -1, 0, 1, 0],
  [1, 0, 0, 0, -1, 0, 0, 0, -1],
  [1, 0, 0, 0, 0, 1, 0, -1, 0],
  [0, -1, 0, 1, 0, 0, 0, 0, 1],
  [0, 0, 1, 1, 0, 0, 0, 1, 0],
  [0, 1, 0, 1, 0, 0, 0, 0, -1],
  [0, 0, -1, 1, 0, 0, 0, -1, 0],
  [-1, 0, 0, 0, -1, 0, 0, 0, 1],
  [-1, 0, 0, 0, 0, -1, 0, -1, 0],
  [-1, 0, 0, 0, 1, 0, 0, 0, -1],
  [-1, 0, 0, 0, 0, 1, 0, 1, 0],
  [0, 1, 0, -1, 0, 0, 0, 0, 1],
  [0, 0, 1, -1, 0, 0, 0, -1, 0],
  [0, -1, 0, -1, 0, 0, 0, 0, -1],
  [0, 0, -1, -1, 0, 0, 0, 1, 0],
  [0, 0, -1, 0, 1, 0, 1, 0, 0],
  [0, 1, 0, 0, 0, 1, 1, 0, 0],
  [0, 0, 1, 0, -1, 0, 1, 0, 0],
  [0, -1, 0, 0, 0, -1, 1, 0, 0],
  [0, 0, -1, 0, -1, 0, -1, 0, 0],
  [0, -1, 0, 0, 0, 1, -1, 0, 0],
  [0, 0, 1, 0, 1, 0, -1, 0, 0],
  [0, 1, 0, 0, 0, -1, -1, 0, 0],
];

// type -> ROTATIONS index (slopes and inverse corners do not follow the
// natural order — this mirrors the game's GetRotationFromType table).
const TYPE_ROTATION = (() => {
  const table = new Uint8Array(256);
  const slope = [0, 1, 2, 3, 4, 5, 6, 7, 12, 13, 14, 15];
  slope.forEach((r, i) => { table[SLOPE_INDEX + i] = r; });
  for (let i = 0; i < 8; i++) table[CORNER_INDEX + i] = i;
  for (let i = 0; i < 24; i++) table[PYRAMID_INDEX + i] = i;
  const invcorner = [0, 1, 2, 3, 8, 9, 10, 11];
  invcorner.forEach((r, i) => { table[INVCORNER_INDEX + i] = r; });
  return table;
})();

// Unit vertices of each shape, inside the [0,1]³ cube.
const SHAPE_VERTICES = {
  [SHAPE.CUBE]: [
    [1, 1, 0], [0, 1, 0], [0, 1, 1], [1, 1, 1],
    [1, 0, 0], [0, 0, 0], [0, 0, 1], [1, 0, 1],
  ],
  [SHAPE.SLOPE]: [
    [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 0, 0], [0, 0, 0],
  ],
  [SHAPE.CORNER]: [
    [1, 1, 0], [0, 0, 0], [1, 0, 1], [1, 0, 0],
  ],
  [SHAPE.PYRAMID]: [
    [1, 1, 0], [0, 0, 1], [1, 0, 1], [1, 0, 0], [0, 0, 0],
  ],
  [SHAPE.INVCORNER]: [
    [1, 1, 0], [0, 1, 0], [0, 1, 1],
    [1, 0, 0], [0, 0, 0], [0, 0, 1], [1, 0, 1],
  ],
};

// Faces of each shape, in the exact order a block stores its 7 colour slots
// (blocks.colors[faceIndex] = palette slot). Indices [a,b,c,d,e,f] are two
// triangles (a,b,c)+(d,e,f); [a,b,c] is a single triangle.
const SHAPE_FACES = {
  [SHAPE.CUBE]: [
    [0, 1, 2, 2, 3, 0], // top
    [7, 6, 5, 5, 4, 7], // bottom
    [0, 3, 7, 7, 4, 0], // right
    [2, 1, 5, 5, 6, 2], // left
    [0, 4, 5, 5, 1, 0], // front
    [2, 6, 7, 7, 3, 2], // back
  ],
  [SHAPE.SLOPE]: [
    [0, 1, 2, 2, 3, 0], // slant
    [0, 3, 4],          // right
    [1, 5, 2],          // left
    [0, 4, 1, 1, 4, 5], // front
    [4, 3, 5, 5, 3, 2], // bottom
  ],
  [SHAPE.CORNER]: [
    [0, 1, 2], // slant
    [0, 2, 3], // right
    [0, 3, 1], // front
    [2, 1, 3], // bottom
  ],
  [SHAPE.PYRAMID]: [
    [0, 1, 2],          // back slant
    [0, 4, 1],          // left slant
    [0, 2, 3],          // right
    [0, 3, 4],          // front
    [1, 4, 2, 2, 4, 3], // bottom
  ],
  [SHAPE.INVCORNER]: [
    [0, 1, 2],          // top
    [6, 5, 4, 4, 3, 6], // bottom
    [0, 6, 3],          // right
    [2, 1, 5, 5, 1, 4], // left
    [0, 3, 1, 1, 3, 4], // front
    [2, 5, 6],          // back
    [0, 2, 6],          // slant
  ],
};

// Axis each face presents, in the shape's local frame and the face order
// above. `null` = slanted face: it looks several ways at once and can never
// be hidden by a neighbour.
const SHAPE_FACE_DIRS = {
  [SHAPE.CUBE]: [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, -1], [0, 0, 1]],
  [SHAPE.SLOPE]: [null, [1, 0, 0], [-1, 0, 0], [0, 0, -1], [0, -1, 0]],
  [SHAPE.CORNER]: [null, [1, 0, 0], [0, 0, -1], [0, -1, 0]],
  [SHAPE.PYRAMID]: [null, null, [1, 0, 0], [0, 0, -1], [0, -1, 0]],
  [SHAPE.INVCORNER]: [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, -1], [0, 0, 1], null],
};

// Faces covering the FULL side of the block's bounding box: only these can
// hide a neighbour's face (partial faces leave the view through).
const SHAPE_FULL_FACES = {
  [SHAPE.CUBE]: [true, true, true, true, true, true],
  [SHAPE.SLOPE]: [false, false, false, true, true],
  [SHAPE.CORNER]: [false, false, false, false],
  [SHAPE.PYRAMID]: [false, false, false, false, true],
  [SHAPE.INVCORNER]: [false, true, false, true, true, false, false],
};

// Unique edges per shape, for wireframe drawing.
const SHAPE_EDGES = {
  [SHAPE.CUBE]: [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]],
  [SHAPE.SLOPE]: [[0, 1], [4, 5], [5, 2], [2, 3], [3, 4], [0, 4], [1, 5], [0, 3], [1, 2]],
  [SHAPE.CORNER]: [[0, 1], [0, 2], [0, 3], [1, 2], [2, 3], [3, 1]],
  [SHAPE.PYRAMID]: [[0, 1], [0, 2], [0, 3], [0, 4], [1, 2], [2, 3], [3, 4], [4, 1]],
  [SHAPE.INVCORNER]: [[0, 1], [1, 2], [0, 2], [3, 4], [4, 5], [5, 6], [6, 3], [0, 3], [1, 4], [2, 5]],
};

export function getShapeFromType(type) {
  if (type === 0) return SHAPE.CUBE;
  if (type < CORNER_INDEX) return SHAPE.SLOPE;
  if (type < PYRAMID_INDEX) return SHAPE.CORNER;
  if (type < INVCORNER_INDEX) return SHAPE.PYRAMID;
  if (type < SHAPES_END_INDEX) return SHAPE.INVCORNER;
  return SHAPE.CUBE;
}

/** Does this block type's face `index` cover the full side of its bbox? */
export function isFullFace(type, index) {
  return SHAPE_FULL_FACES[getShapeFromType(type)][index] === true;
}

/** Face directions after the type's orientation is applied; null = slanted. */
export function getBlockFaceDirections(type) {
  const m = ROTATIONS[TYPE_ROTATION[type] || 0];
  return SHAPE_FACE_DIRS[getShapeFromType(type)].map((dir) => {
    if (!dir) return null;
    const [x, y, z] = dir;
    return [
      Math.round(m[0] * x + m[3] * y + m[6] * z),
      Math.round(m[1] * x + m[4] * y + m[7] * z),
      Math.round(m[2] * x + m[5] * y + m[8] * z),
    ];
  });
}

/**
 * Vertices of a block, in metres, in build/world frame.
 * @param {number} type   block type (shape + orientation)
 * @param {number[]} origin  min corner of the block, metres
 * @param {number[]} size    block dimensions, metres
 */
export function getBlockPoints(type, origin, size) {
  const shape = getShapeFromType(type);
  const m = ROTATIONS[TYPE_ROTATION[type] || 0];
  return SHAPE_VERTICES[shape].map(([vx, vy, vz]) => {
    const x = vx - 0.5, y = vy - 0.5, z = vz - 0.5;
    // rotate around the unit-cube centre, then scale to the block's box
    const rx = m[0] * x + m[3] * y + m[6] * z + 0.5;
    const ry = m[1] * x + m[4] * y + m[7] * z + 0.5;
    const rz = m[2] * x + m[5] * y + m[8] * z + 0.5;
    return [origin[0] + size[0] * rx, origin[1] + size[1] * ry, origin[2] + size[2] * rz];
  });
}

export function getBlockFaces(type) {
  return SHAPE_FACES[getShapeFromType(type)];
}

export function getBlockEdges(type) {
  return SHAPE_EDGES[getShapeFromType(type)];
}

/** Human-readable shape name, for the inspector. */
export function shapeName(type) {
  if (type === OCCUPANCY_TYPE) return 'occupancy';
  switch (getShapeFromType(type)) {
    case SHAPE.CUBE: return 'cube';
    case SHAPE.SLOPE: return 'slope';
    case SHAPE.CORNER: return 'corner';
    case SHAPE.PYRAMID: return 'pyramid';
    case SHAPE.INVCORNER: return 'inverse corner';
    default: return 'unknown';
  }
}
