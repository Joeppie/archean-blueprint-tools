# Component cost in raw materials
Tags: cost price raw materials ores resources ingredients recipe economy shopping list crafting fluidport budget build cost

**View mode** ▸ side panel ▸ **Component cost** answers "what do the parts on
this craft actually cost to build?" — every placed component unfolded through
the game's own **crafter recipes** down to terminal raw materials.

## What the numbers are

| Part of the readout | Meaning |
|---|---|
| Raw materials — all N parts | the craft-wide shopping list: each raw material and the TOTAL quantity every part consumes |
| Per component | one row per component TYPE, with the count on the craft (`×4`) and the raw cost of all of them |
| ▸ row | opens that part's recipe chain — its DIRECT constituents, each with its own raw cost, expandable further |
| one unit (…) | the row's per-part cost and crafter time (`×4` multiplies that by the count) |
| no recipe | a part the game never sells as a recipe (sensors, Dashboard …): it stays in the list, it just cannot be unfolded |
| subgrid | the part lives inside a subgrid (Build) — it is still material you have to craft |

Units are the game's own: raw **ores/molecules are grams** (1 000 g = 1 kg,
shown as `g` below 1 kg), crafted items and parts are counts.

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
first crafter recipe per item wins, an item without one is terminal.
Only **parts** are counted: blocks, frames, cables, struts and hull triangles
are structural and not part of this list. Re-run the extractor after a game
update.
