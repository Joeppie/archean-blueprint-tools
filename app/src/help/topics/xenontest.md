# Testing & Automating XenonCode — the Auto-test panel
Tags: testing test automation xenoncode automate automated headless AI agent scripting script diagnose diagnostics CI asserts bench buzzer bus snapshot programmatic xenontest craft diagnosis computer debug probe

**Want to automatically test a XenonCode program, run a probe on a craft's
computer, or let an AI agent diagnose a machine?** The IDE's **Auto ▸
test panel** (Xenon ▸ pick a computer → side tab **Auto**) is a tiny
scripting interface built for exactly that — no game engine, no hardware,
just the computer, its io bus, and assertions.

## The script format

A XenonTest script is a handful of plain lines:

```
name: buzzer-bench
program: |
  var $t = 0
  update
    $t += 1
    output_number("horn", 0, 0.8)
    output_number("horn", 1, 440)
cycles: 20
assert:
  - bus("horn", 0) == 0.8
  - bus("horn", 1) == 440
  - wave("horn") == "sawtooth"
  - prints == 0
  - cycles >= 20
```

* **`program:`** *(optional)* — XenonCode booted onto this computer for
  the test (it uses the same write-back as the disk editor, so it lands
  in the craft and the VM auto-reboots, exactly like editing a file).
  Omit it to test the craft's **own** programs — the diagnostic case.
* **`cycles:`** — the VM is advanced EXACTLY this many cycles,
  deterministically (the live loop is gated out during the run), so
  asserts see a known phase.
* **`assert:`** — expressions over the computer's live snapshot:
  `bus("alias", ch)` (last value written to that io channel),
  `amp("alias")` / `freq("alias")` / `wave("alias")` (per-device census —
  buzzers, lamps, anything on the bus), `cycles`, `prints`.
  Operators: `== != >= <= > <`.

Click **▶ run test** — every assert lists green ✓ or red with the actual
value, and the header reads e.g. `buzzer-bench: 5/5 PASS`.

## The programmatic door (for automation and AI agents)

The same runner is on the page as a plain function:

```js
await window.__XENONTEST__.run(`name: check
cycles: 20
assert:
  - bus("horn", 0) > 0.5`)
// -> [{ expr: 'bus("horn", 0) > 0.5', ok: true, actual: '0.8' }, ...]

window.__XENONTEST__.snapshot()
// -> { cycles, prints, bus: {"horn:0": 0.8, ...},
//      devices: [{ alias, type, mode, amp, freq, wave }, ...] }
```

`run()` returns JSON — point Playwright, a browser extension, or an
**AI agent** at it, read the asserts, and you can drive and diagnose any
craft's computer from the browser console: write probe programs, watch
the io bus, prove a hinge's angle changed, prove a buzzer sings
(the app exposes the WebAudio analyser level too, so “does it make
sound?” is a measurable assert). The fixture craft **Buzzer Bench**
(id `9000008001`) ships with the panel preset: one computer, one sawtooth
buzzer, one pilot seat — the smallest machine that proves the whole
signal chain.

## Diagnosing a craft

A quick check-up script for a craft you inherited:

```
name: checkup
cycles: 60
assert:
  - cycles >= 60          # the VM runs at all
  - prints == 0           # nothing crash-printing
  - amp("game-melody") >= 0   # the bus census answers per device
```

Run it against each computer in the Xenon ▾ menu: a computer that boots
but writes nothing, a channel that never moves, a buzzer wired to no
program — the asserts name the one that lies.
