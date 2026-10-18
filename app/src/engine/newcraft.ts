// newcraft.ts — the "New craft" document: a minimal but FULLY v2 blueprint,
// key-ordered like the game's writer. One PilotSeat on a 3×3-cell deck
// plate so the editor opens on something you can immediately click, extend
// in blocks mode, and wire. (Byte-exact writer style only matters for the
// round-trip of EXISTING files — pinned in edit.test — a fresh doc just has
// to parse everywhere, so plain docFromValue is enough here.)

import { docFromValue, type DocNode } from './doc';

export function newCraftDoc(alias = 'New craft'): DocNode {
  const deck = (pos_z: number) => ({
    colors: [4, 4, 4, 4, 4, 4, 4], frame_x: 0, frame_y: 0, frame_z: 0, material: 0,
    pos_x: 4, pos_y: 5, pos_z, size_x: 4, size_y: 0, size_z: 0, type: 0,
  });
  return docFromValue({
    author: '',
    box_max: { x: 1.5, y: 2.0, z: 1.5 },
    box_min: { x: -1.5, y: 0.0, z: -1.5 },
    box_size: { x: 3.0, y: 2.0, z: 3.0 },
    data: {
      alias,
      blocks: [deck(4), deck(5), deck(6)],
      colors: new Array(256).fill(null),
      components: [{
        alias: '',
        colors: {
          color1: { b: 255, g: 255, metallic: 0, opacity: 15, r: 255, roughness: 0 },
          color2: { b: 204, g: 204, metallic: 1, opacity: 15, r: 204, roughness: 7 },
        },
        data: { emitPlayerToken: true, smoothControls: false },
        mirrorAxis: 0,
        module: 'ARCHEAN_avatar',
        occupancies: [{ frame_x: 0, frame_y: 0, frame_z: 0,
          pos_x: 5, pos_y: 7, pos_z: 5, size_x: 1, size_y: 3, size_z: 1 }],
        orientation: { w: 1.0, x: 0.0, y: 0.0, z: 0.0 },
        position: { x: 0.0, y: 1.0, z: 0.0 },
        type: 'PilotSeat',
      }],
      composite_builds: [],
      doors: [],
      frames: [],
      indestructible: true,
      labels: [],
      pipes: [],
      struts: [],
      symmetry_axis: 1,
      symmetry_axis_offset: { x: 0, y: 0, z: 0 },
      triangles: [],
      version: 2,
    },
    datetime: new Date().toISOString().slice(0, 19).replace('T', ' '),
    mass: 140.0,
    type: 'Archean Build Blueprint',
    version: 1,
    workshop_item_id: 0,
  });
}
