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

## Where a cable plugs in (v1.8.1)

The round grey sockets you see on tanks, ports and machines in the game ARE
the parts' `.ini` adapter ports — the editor computes each one's live pose
(`position + R(q)·adapter`, the same raw-quat law the models use) and the
cable ends follow it: a recorded tip that still sits on its socket stub is
kept verbatim (it encodes how deep the plug was seated), a tip left behind by
a moved or turned part re-seats onto the socket. Move a part and its cables
ride with it — the game re-routes the paths at save; the editor keeps them
plugged in while you work.

And the wire always connects **in the connector's direction**: the cable bar
touching a socket runs along the socket's axis and continues straight for a
short lead (twice the cable's radius) before the route may bend, so plugs
enter the round sockets head-on with a visible neck, never stab in at an
angle. (A cached route that dives straight back into the part gets a plain
lead-in instead of a folded wire.)

Cables also draw like the game: ROUND hoses (fluid and HV are cylinders;
only the item ducts are square), each segment in its own recorded colour
(navy data, dark-red low voltage, orange high voltage, white chrome fluid —
older saves write near-black sheaths), with elbow spheres at direction
changes, sagging chains for flexible data runs, and a black collar at every
plug seat.
