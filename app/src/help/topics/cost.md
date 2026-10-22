# Build cost in raw materials
Tags: cost price raw materials ores resources ingredients recipe economy shopping list crafting fluidport budget build cost cables wire blocks triangles struts frames hull steel beam rod spool

**View mode** ▸ side panel ▸ **Build cost** answers "what does this craft
actually cost to build?" — every part, block, hull triangle, cable, frame beam
and strut unfolded through the game's own **crafter recipes** down to terminal
raw materials.

## What the numbers are

| Part of the readout | Meaning |
|---|---|
| Raw materials — whole craft | the craft-wide shopping list: every raw material and the TOTAL quantity the whole build consumes |
| Per component | one row per component TYPE, with the count on the craft (`×4`) and the raw cost of all of them |
| Blocks | per block MATERIAL: the cell count the craft asks for, as `<Material>Block` items |
| Hull triangles | per material: triangle count and surface area, billed as block items |
| Cables | per cable class: the LENGTH of the runs on the craft and the spool items that length costs |
| Frames / Struts | frame beams (`SteelBeam`) and rods (`SteelRod`) |
| ▾ section header | every group (raw materials, per component, blocks, hull triangles, cables, frames, struts) folds — the folded header keeps its summary line, and the fold is remembered for the next visit |
| ▸ row | opens that line's recipe chain — its DIRECT constituents, each with its own raw cost, expandable further |
| one unit (…) | a component row's per-part cost and crafter time (`×4` multiplies that by the count) |
| no recipe | a part the game never sells as a recipe (sensors …): it stays in the list, it just cannot be unfolded |
| subgrid | the part lives inside a subgrid (Build) — it is still material you have to craft |
| via tool | a Dashboard board: the game bills the **DashboardTool** once, however many boards the craft carries |

Units are the game's own: raw **ores/molecules are grams** (`g` below 1 kg,
`kg` below 1 t, then `t`), crafted items and parts are counts. Cable and strut
rows also print the physical metres they stand for.

## How the structural items are counted

The game's own Blueprint-tool content list (`GetBlueprintContents`, ported by
the dev viewer's cost panel and by `tools/game_data.py`):

* **Blocks** cost their FULL cell rectangle `(sizeX+1)(sizeY+1)(sizeZ+1)` —
  the shape/orientation is free; occupancy reservations (type 255) cost
  nothing. One cell = one `<Material>Block` item (Composite, Concrete, Steel,
  Aluminium, Glass, Lead, Titanium).
* **Hull triangles** cost `max(ceil(area · 0.05 m ÷ 0.25³), 1)` block items —
  the prism's volume in cell cubes, rounded UP, and never less than one item.
* **Cables** cost the length of every pipe, in centimetres, so **1 spool unit
  = 1 cm**. The game truncates **per SEGMENT**, not per run: two 1.5 cm
  segments cost 2 cm, not 3. The recipe pays out a 100 m spool (10 000 units)
  per batch. Sub-centimetre plug stubs therefore charge nothing — the section
  still shows the real run length.
* **Frames** cost one `SteelBeam` per LIT beam flag (a 3 m frame cube carries
  up to 12 beams), not one per frame record.
* **Struts** cost `ceil(length · 100)` `SteelRod` (one rod = 1 cm of strut).
* Subgrid (Build) content is counted; the Build construction ghosts are not.

## Example — FluidPort

One FluidPort is crafted from **1 Casing + 1 Connector**:

* Casing = 1 000 g Iron
* Connector = Wire + Plastic → 1 g Copper + 125 g Carbon + 125 g Silicon each
* Plastic = 125 g Carbon + 125 g Silicon

so a FluidPort costs **1 000 g Iron · 1 g Copper · 250 g Carbon · 250 g
Silicon** — open the row and each constituent shows this same breakdown for
itself.

## Where the data comes from

`viewer/models/economy.json`, generated from the installed game by
`tools/extract_economy.py` (items + crafter recipes of
`modules/*/config.yaml`) — the same tables the game's own content list uses:
first crafter recipe per item wins, an item without one is terminal. Re-run
the extractor after a game update.
