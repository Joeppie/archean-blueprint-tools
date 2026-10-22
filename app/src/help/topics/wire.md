# Wire mode
Tags: wire pipes cables wiring auto-wire junction ports endpoints census

**Wire** (∿) shows the craft's cable graph — `data.pipes` — as a dock under
the viewport: every cable, its endpoint components and ports, plus warnings
for claims that do not match the physical truth.

## What the census checks

A cable's first/last segment ends ARE its connection points: the game
writes the cable tips at the part's VISIBLE socket. The panel flags a pipe
whose named endpoint component does not own that port (a stale reference),
so you can see broken wiring instead of guessing.

## Auto-wiring is button-only

The "naive auto-wire" actions run ONLY when you press their button — they
never fire on open, edit or save. Use them to (re)drop cables onto nearby
ports, then check the census again.

## Deleting keeps the graph honest

Deleting a component prunes every pipe entry and composite-build reference
pointing into its subtree and RENUMBERS the later ones (the files index the
FLATTENED component array). This is the fix for the classic corruption:
delete a part → the game says a computer's power cable "connects to an
aileron". If a file was already mangled by an old build, the census keeps
reporting those claims — repair them by deleting the stale cable rows.

> Cables draw exactly as recorded: every segment anchors at its own `start`
> (joints carry real offsets), so tube paths are never assumed straight.
