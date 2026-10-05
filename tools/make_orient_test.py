#!/usr/bin/env python3
"""Generate testdata/orient-test/blueprint.json — a chirality probe craft.

Purpose: settle relative orientation between the two viewer conventions with
one glance. Around a central cell: six 1x1x1 cubes, one per face, each a
distinct colour (matte legacy slots). A 1.0x0.6 m Dashboard with a red 'TEST'
label faces +z (text readable from the +z side in the game). A Beacon stands
on the +x cube with a +45 deg file quaternion: in the GAME (R(q*)), its mast
leans toward +x (the red cube); raw-R(q) (the dev viewer) leans it toward -x.
A world label 'TEST' faces +z. components[].mirrorAxis is present (0 = the
game's per-component symmetry mirror flag, inert here).

Convention table (viewed from FILE +z looking toward -z):
  game (and our z-mirrored viewer): TEST readable, red cube LEFT (mirror flips
    the screen axes of a +z camera), beacon mast leans red, top blue, bottom
    yellow, cyan nearest, magenta farthest.
  dev viewer (raw numbers in RH): TEST MIRRORED, red cube RIGHT, beacon mast
    leans green, blue top, yellow bottom, cyan nearest.
Both are mirror-consistent; the beacon lean + cable-endpoint data side with
the game, not the raw render.
"""
import json, os

def block(slot, pos):
    x, y, z = pos
    return {"colors": [slot]*7, "frame_x": 0, "frame_y": 0, "frame_z": 0,
            "material": 0, "pos_x": x, "pos_y": y, "pos_z": z,
            "size_x": 0, "size_y": 0, "size_z": 0, "type": 0}

def occ_block(pos):  # type-255 occupancy mirror entry
    x, y, z = pos
    return {"colors": [0]*7, "frame_x": 0, "frame_y": 0, "frame_z": 0,
            "material": 0, "pos_x": x, "pos_y": y, "pos_z": z,
            "size_x": 0, "size_y": 0, "size_z": 0, "type": 255}

C = 0.125  # cell-6 centre = (6-5.5)*0.25

blueprint = {
    "author": "orient-test",
    "box_min": {"x": -1.0, "y": -1.0, "z": -1.0},
    "box_max": {"x": 1.0, "y": 1.5, "z": 1.5},
    "box_size": {"x": 2.0, "y": 2.5, "z": 2.5},
    "type": "Archean Build Blueprint",
    "version": 1,
    "datetime": "2026-10-05",
    "mass": 4.0,
    "workshop_item_id": "0000000000",
    "data": {
        "alias": "orient-test",
        "version": 2,
        "symmetry_axis": 0,
        "symmetry_axis_offset": 0,
        "indestructible": False,
        "composite_builds": [],
        "doors": [],
        "frames": [],
        "struts": [],
        "triangles": [],
        "pipes": [],
        "labels": [{
            "text": "TEST", "position": {"x": C, "y": 0.95, "z": C},
            "size": 1.0, "align_center": 1,
            "text_color": {"r": 255, "g": 0, "b": 0},
            "panel_color": {"r": 0, "g": 0, "b": 0, "a": 255},
            "metallic": 0, "roughness": 0,
            "dir_x": 0, "dir_y": 0, "dir_z": 1, "up_x": 0, "up_y": 1, "up_z": 0,
        }],
        # matte legacy family slots: 43 red, 46 green, 49 blue, 52 yellow,
        # 53 cyan, 56 magenta (v1 file: no data.colors palette)
        "blocks": [
            block(43, (7, 6, 6)),   # +x
            block(46, (5, 6, 6)),   # -x
            block(49, (6, 7, 6)),   # +y
            block(52, (6, 5, 6)),   # -y
            block(53, (6, 6, 7)),   # +z
            block(56, (6, 6, 5)),   # -z
            occ_block((7, 7, 6)),   # beacon occupancy mirror
        ],
        "components": [
            {   # TEST panel facing +z, readable from the +z side in the game
                "alias": "", "type": "Dashboard", "module": "ARCHEAN_build",
                "position": {"x": C - 0.5, "y": C - 0.3, "z": 1.0},
                "orientation": {"w": 1.0, "x": 0.0, "y": 0.0, "z": 0.0},
                "colors": [0, 3], "mirrorAxis": 0, "occupancies": [],
                "data": {"size_x": 100, "size_y": 60, "version": 0,
                         "metallic": 0, "roughness": 128,
                         "color": {"r": 255, "g": 255, "b": 255, "a": 255},
                         "hideConnector": True,
                         "elements": [{
                             "type": "Label", "text": "TEST",
                             "pos_x": 10, "pos_y": 15, "size_x": 80, "size_y": 30,
                             "textAlign": 16, "textSize": 8, "state": 0,
                             "mainColor": {"r": 255, "g": 0, "b": 0, "a": 255},
                             "baseColor": {"r": 255, "g": 255, "b": 255, "a": 255},
                             "baseMetallic": 0, "baseRoughness": 128,
                         }]},
            },
            {   # beacon on the +x (red) cube, +45 deg file quaternion:
                # game R(q*) leans the mast toward +x (red); raw R(q) leans -x
                "alias": "", "type": "Beacon", "module": "ARCHEAN_beacon",
                "position": {"x": 0.375, "y": 0.5, "z": C},
                "orientation": {"w": 0.92388, "x": 0.0, "y": 0.0, "z": 0.38268},
                "colors": [0, 3], "mirrorAxis": 0,
                "occupancies": [{"frame_x": 0, "frame_y": 0, "frame_z": 0,
                                 "pos_x": 7, "pos_y": 7, "pos_z": 6,
                                 "size_x": 0, "size_y": 0, "size_z": 0}],
                "data": {},
            },
        ],
    },
}

out = os.path.join(os.path.dirname(__file__), '..', 'testdata', '9000000001')
os.makedirs(out, exist_ok=True)
with open(os.path.join(out, 'blueprint.json'), 'w') as f:
    json.dump(blueprint, f, separators=(',', ':'), ensure_ascii=False)
print('wrote', out + '/blueprint.json')
