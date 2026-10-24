# Wire mode
Tags: wire pipes cables wiring auto-wire junction ports endpoints census disconnect reconnect unplug cable label hover overview network router battery hub input output direction candidate

**Wire** (∿) is the cable workspace — the craft's `data.pipes` graph as a
dock under the viewport, with a live **3-D hover label**: rest the cursor on
any cable and a gold chip prints where it goes —
`Propeller[9].lowvoltage ↔ Computer[0].data_port.001` — while the cable
itself gold-lights through the hull.

## What is wired to what

The dock has three columns (they stack on a phone):

| column | what it is |
| --- | --- |
| **Ports** | per-kind census: `data 20/27 connected` … plus the Auto-wire buttons |
| **Networks** | every CONNECTED group per kind, ordered `sources → hubs → devices`: `MiniComputer[14] → Aileron[4], Beacon[26], …` — click any chip to select that part |
| **Cables** | every cable as one row `Type[9].port ↔ Type[0].port`; hovering a row gold-lights that cable in the scene |

## Disconnect / reconnect (every component)

- **Cables list**: each row ends in a ✕ — that disconnects the cable.
  **Ctrl+Z** brings it back exactly.
- **This part**: select a component (list, viewport or a Networks chip) and
  its ports list shows each wired port with its partner (`⇄ data-port ↔
  MiniComputer[14].data_port.010`) and its own ✕; free ports are `○`.
- To reconnect: click the freed `○` port, pick a candidate part from the
  ranked list, then pick the exact port. The pairing writes the blueprint
  AND the save text — the game sees the same cables the editor draws.

## Logical candidates — the ranking, and why it never overrules you

The game's own adapter names say what each port IS: `lowvoltage-input`
(the junction's single upstream socket), `lowvoltage-port.NNN` (its
downstream outputs), `fluid-in`/`fluid-out`, and on a DataBridge literally
`data-computer.1` / `data-device.0`. The editor derives from that:

- **direction** — an input never pairs with an input, an output never with
  an output; a hub's INPUT faces batteries/other hubs, never a device; a
  junction output never feeds back into a source.
- **topology** — sources (batteries, generators, solar panels) feed hubs
  (*Junction, *Bridge, routers, computers); hubs feed devices; power never
  runs device-to-device; a plain pump→tank fluid edge is fine only when
  both sides are named for it.

When you arm a port, candidates sort by that logic FIRST (the canonical
partner type, then distance within each class — each row states its reason,
e.g. `device ← hub · 1.4 m`). The ranking only ORDERS the list: every
compatible port stays listed and pickable, and a pairing you choose by hand
is never rejected or "corrected" by the heuristic.

## Auto-wiring is button-only — and honest

Auto-wire runs ONLY when you press its button; it never fires on open, edit
or save, and it NEVER touches an existing cable (your decisions win). It
fills free ports through the stages above. A port with no compatible
partner **stays open and says why** in the Warnings list — it no longer
force-pairs leftovers. (That old "last resort" pass is what wired control
surfaces into a junction's battery-side input — the junction input is
upstream and now provably stays free for the power source.) The naive
nearest-pair button stays as a fallback escape hatch.

## What the census checks

A cable's first/last segment ends ARE its connection points: the game
writes the cable tips at the part's VISIBLE socket. The panel flags a pipe
whose named endpoint component does not own that port (a stale reference),
so you can see broken wiring instead of guessing.

## Deleting keeps the graph honest

Deleting a component prunes every pipe entry and composite-build reference
pointing into its subtree and RENUMBERS the later ones (the files index the
FLATTENED component array). This is the fix for the classic corruption:
delete a part → the game says a computer's power cable "connects to an
aileron". If a file was already mangled by an old build, the census keeps
reporting those claims — repair them by disconnecting the stale cable rows.

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

Cables also draw like the game: ROUND hoses (fluid and HV are cylinders),
each segment in its own recorded colour (dark-red low voltage, orange high
voltage, white chrome fluid — older saves write near-black sheaths), with
elbow spheres at direction changes, sagging chains for flexible data runs,
and a black collar at every plug seat. The two flat species: the ITEM ducts
are square exactly as the file flags them, and DATA runs draw as a THIN
square bus (the file keeps its real radius — this is the viewport read).
