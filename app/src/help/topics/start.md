# Quick start
Tags: start gallery open new craft place save first steps begin

The Inspector opens on the **gallery** — every craft in the corpus as a card.
Click a card to inspect it; **New craft** (gallery only) starts an empty one.
Inside a craft, the top bar holds *File · Edit · Tools · Help* plus six mode
tiles: **View · Info · Modify · Wire · Flight · Wind**.

## The thirty-second tour

1. **View** (⌖) — inspect only. Orbit with the left mouse drag, zoom with the
   wheel, pan with the right drag. Clicks select *nothing* here — that is
   deliberate. **Info** (ℹ) opens the vessel's amounts beside the same clean
   canvas: mass, centre of mass, part census, the ⚖ Lift widget, Build cost.
2. **Edit** (✎) — the editing mode, with ONE mode control in its bottom
   dock (v1.11 — one tri-state row, not nested flips):
   * **✎ Modify** — clicking the craft *selects anything*: a part gets the
     gizmo + inspector, a block face selects the block, a hull prism
     selects the triangle (pins + centroid widget). `Delete` removes.
   * **+ Blocks** — clicking a surface *places* a 1×1×1 block (the brush's
     paint + material; **⇧ Shift** continues the aimed block's shape).
   * **+ Triangles** — clicking *drops a pin*; three pins become a hull
     triangle inheriting the brush paint.
3. **Wire** (∿) — the cable graph: which `data.pipes` connect what, with
   warnings for references that point at nothing.
4. **Flight** (➤) — mass/CoM, thrust nets and control-surface analysis.
5. **Wind** (≋) — the stylized airflow: streamlines around the hull.

## Edit something

* Rotate a part: **✎ Modify** → click it → drag a gizmo ring (hold **Shift**
  for 15° snaps). Move: drag an arrow (Shift snaps to the 0.25 m cells).
* Place a block: mode row ▸ **+ Blocks**, pick a shape and paint in the
  dock's brush, then click a surface — the block lands, the widget (✥ ⟳ ⤢)
  transforms it.
* Everything is undoable: **Ctrl+Z** / **Ctrl+Y**, or Edit ▾ Undo/Redo. A
  whole slider drag is one undo step.

## Get it out again

**Save** (or Ctrl+S) downloads the blueprint file — byte-identical for
everything you did not touch, so the game re-opens it exactly. *File ▸ Save
as…* lets you rename it.

> Nothing ever uploads. The app reads and writes only local files; the
> gallery crafts are cached downloads.
