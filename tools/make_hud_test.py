#!/usr/bin/env python3
"""Craft the PLAYER HUD law fixture: testdata/hud/hudbench/ — a player HUD
folder in the game's exact layout (main.xc + one include), modeled on the
installed 'Homo Hud' and the subscribed speed item 3798785211 (we: "make it
possible to load a player HUD file … I subbed a workshop item that displays
player speed, but the Homo Hud also can do this").

The fixture exhibits, small and deterministic:
  · main.xc FIRST + the include file (the loader's order law),
  · a declared @speed_kph function in the include (the Library-tab index of
    the LOADED hud's own functions — the jump target),
  · the avatar_sensor_* get() pool the HUD runtime answers (hudpump
    AVATARSIM: speed + altitude — the exact reads both real speed HUDs use),
  · a panel(bottom, …) surface the runtime blits (the lit-pixels leg).

The app's /hud route serves <repo>/testdata/hud as the fixture floor, so
every e2e pin works on a fresh clone; the machine's installed hud_dir is a
superset (AGENTS § Blueprint folder tiers, key hud_dir — tools/config.py).
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'testdata', 'hud', 'hudbench')

MAIN = """; hudbench — the PLAYER HUD law fixture (tools/make_hud_test.py).
; The speed readout class, small: the avatar_sensor_speed the Homo Hud and
; the subscribed speed item both display, through a declared @function.
include "parse.xc"

var $panel = panel(bottom, 240, 90)

init
\t$panel.blank(color(16,20,32,220))
\t$panel.write(4,4,white,"hudbench")

tick
\tvar $kmh = @speed_kph(get("avatar_sensor_speed"))
\tvar $alt = round(get("avatar_sensor_altitude"))
\t$panel.blank(color(16,20,32,220))
\t$panel.write(4,4,white,"hudbench")
\t$panel.write(4,24,cyan,text("{0} km/h", $kmh))
\t$panel.write(4,48,green,text("alt {0} m", $alt))
"""

PARSE = """; the include the Library-tab leg indexes: @speed_kph is THIS hud's own
; declared function (click in the Library = jump to this line).
function @speed_kph($v : number) : number
\treturn $v * 3.6

function @clamped($v : number, $hi : number) : number
\tif $v > $hi
\t\treturn $hi
\treturn $v
"""


def main() -> int:
    os.makedirs(OUT, exist_ok=True)
    for name, body in (('main.xc', MAIN), ('parse.xc', PARSE)):
        p = os.path.join(OUT, name)
        with open(p, 'w', encoding='utf-8', newline='\n') as f:
            f.write(body)
        print(f'wrote {os.path.relpath(p, os.path.join(HERE, ".."))}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
