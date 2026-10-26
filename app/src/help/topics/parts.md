# Parts (components)
Tags: parts components catalog place gizmo move rotate delete selection real models proxy smear

Everything that is not a block or a hull triangle is a **component**: wings,
wheels, propellers, cockpits, lamps, dashboards…

## Placing

In Edit mode, open the parts catalog (the rows show live 3D previews; hover
spins them) → hold a part. A translucent real-model ghost docks on whatever
surface you hover. Two ways to land it:

* a **click** places it facing the file's +x;
* a **press-drag-release smear** aims its BACK along the drag and places on
  release. **Esc** drops the held part.

With ⇄ on, a mirrored twin is placed too when the plane is on.

## Selecting and moving

**✎ Modify** → click a part: it selects, the camera flies to it, the gizmo
attaches at its VISIBLE centre (so off-origin geometry spins in place, not
orbiting). Rings rotate (Shift = 15° snap), arrows translate (Shift = cell
snap). The inspector carries x/y/z + orientation sliders and the part's own
`data` rows — every edit applies LIVE, one rebuild per frame max.

**Delete** (or Backspace) removes the selected part and its mirror twin, and
renumbers every file reference that pointed into it (the game's flattened
`pipes`/`composite_builds` indices stay valid — the "Jimmy rule").

## Twins

A symmetric pair (mirrored across x within 5 cm) is a live twin pair:
EVERY edit — move, rotation (as mirror-twin motion), palette paint, joint
data, delete — propagates to the twin in mirrored unison. The ⇄ button on
the mode widget lights while the pair is live; a pair you dragged apart is
auto-flagged and stops propagating.

## Real models vs proxies

Parts render as their FULL game meshes by default; ⚙ can switch weak GPUs to
the decimated twins. A selected part glows gold (x-ray overlay + outline box)
through the hull. Cable pulses ride the real `data.pipes` graph when a
connected part is selected.
