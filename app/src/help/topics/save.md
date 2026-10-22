# Saving, palettes and file fidelity
Tags: save file json palette colour color slot rgb v1 v2 legacy byte occupancy fidelity workshop

## Saving is byte-conservative

The app keeps the file's ORIGINAL literal text for everything you do not
touch — number styles ("13" vs "13.0" vs "1e-08"), key order, all of it.
Only edited fields are rewritten, in the game's own writer style (int-
modelled fields bare, double-modelled with a decimal). So a saved craft
re-opens in the game exactly as authored, plus your change. **Save**
(Ctrl+S) downloads the file; there is no upload.

* **Occupancy mirrors stay synced**: a part's `occupancies` and the
  matching type-255 `data.blocks` entries move together on every position
  edit and on every save.
* Orientations are NEVER rewritten — stored quaternion bytes ride along
  verbatim (the game keeps them across generations; rewriting them made
  old exports load flipped).

## Palettes: v1 vs v2

* v2 files embed their own 256-slot `data.colors` (r/g/b 0-255 linear,
  opacity 0-15, roughness 0-7, metallic 0|1).
* v1 files carry NO palette: slots resolve through the game's built-in
  legacy families (matte/polished/metal/glass). An all-purple craft is a
  missing built-in group, not a broken file — the app remaps v1 indices
  automatically. On open, a v1 palette is embedded, so custom colours work
  on every craft.

## Custom RGB

Any swatch dock's colour input → **+ new slot** writes your RGB into the
next free slot of THIS craft's palette (slots 0..10 stay engine-reserved);
**≈ nearest slot** reuses the closest existing colour instead of growing
the palette. Slot use-counts show on every swatch in the palette panel.

## Getting crafts in

Gallery cards load the cached corpus; **File ▸ Open file…** (or drag-drop
anywhere) loads a local `blueprint.json`; **File ▸ Refresh** redownloads a
workshop craft. A v1 export from the game opens directly — normalization
adds what the format expects but rewrites nothing you can see.
