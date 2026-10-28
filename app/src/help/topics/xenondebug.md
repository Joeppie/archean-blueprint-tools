# Debugging XenonCode — breakpoints, frames, the console

Tags: debugger debug breakpoint breakpoints locals frame step stepping console xcdbg ai agent script headless automation api run to cursor write value inject timer update block console log analysis analyze xenoncode program counter plomo

## The debugger in the IDE

Open a computer's XenonCode IDE, pick a code tab, and click a line's
**gutter** — a red ● marks a breakpoint (the BREAKPOINTS strip lists them
all with their enclosing function). The program runs normally and PARKS
mid-cycle at the breakpoint: the pause pill shows `file:line`, the Vars
panel's top section shows the **Locals** of the frame you stopped in (its
arguments and block variables, with types), the globals tick below. Step
with **F10** (over) / **F11** (into), resume with **F8** or the Run menu.
**F5** runs the program fresh: it COMMITS the files (a commit re-boots the
computer on them, breakpoints included — the editor is always live, saving
is the commit).

A frame exists for `function @name` bodies **and** for the global-scope
blocks: `update`, `init`, `tick`, `timer frequency N`, `input N` — they
compile as named bodies with their own variables (v1.13.24: a break in an
`update` body is a frame labeled `update`, not "top level"). Plain
top-level lines have no locals — those variables are the globals.

Click a number/text value while paused to **edit** it: Enter writes it
into the program (validated by type), Esc cancels.

## The debug console — `window.__XCDBG__` (for scripts and AI agents)

Every debugger law is also a plain JS API on any page where a computer is
open — no DOM needed. Everything answers plain JSON-serialisable data, so
an agent driving the page (Playwright `page.evaluate`, the browser
console, a userscript) gets a text protocol:

| call | meaning |
|---|---|
| `__XCDBG__.status()` | `{status, cycles, paused, file, line, frame, worker}` |
| `__XCDBG__.files()` / `source(name)` | the disk: names + line counts / full text |
| `__XCDBG__.break(file, [lines])` | set breakpoints for a file (answers the live list) |
| `__XCDBG__.clear(file?)` / `breakpoints()` | remove / list |
| `__XCDBG__.run({cycles})` | resume (from a pause) until the next break / budget |
| `__XCDBG__.step('over'|'into')` | F10/F11 as a call: answers the new site + frame |
| `__XCDBG__.goto(file, line)` | run until that line executes, pause there |
| `__XCDBG__.frame()` | `{file, line, frame, locals:[{name, type, value, copy?}]}` |
| `__XCDBG__.locals()` / `globals()` | typed rows |
| `__XCDBG__.write(name, value, scope?)` | validated writeback into the VM (same law as the row editors); answers `{ok}` / `{ok:false, error}` |
| `__XCDBG__.io(io, ch, value)` | feed an input channel (the Bus-tab slider law) |
| `__XCDBG__.bus()` / `prints()` | the io-bus rows / the program's prints |

Typical agent session (the `e2e/xenondbg.spec.ts` spec is exactly this,
headless):

```js
__XCDBG__.io(11, 3, 1)                      // open the throttle-key channel
__XCDBG__.break('functions.xc', [10])       // $result += $increment
await __XCDBG__.run({ cycles: 500 })        // -> {paused:true, file:'functions.xc', line:10, frame:'@selectcase'}
const f = __XCDBG__.frame()                 // locals: [{name:'increment', type:'number', value:'5'}, …]
await __XCDBG__.write('$result', '42')      // inject -> the paused program resumes with 42
await __XCDBG__.step('over')                // one line forward, still parked
await __XCDBG__.goto('functions.xc', 31)    // frame: 'timer frequency 4', locals include $change
__XCDBG__.clear(); await __XCDBG__.run({ cycles: 30 })   // stream freely
```

Notes: on a localhost (isolated) origin the VM runs on a worker thread, so
pauses are **mid-cycle** — locals and writes are the parked VM's own state;
writes are accepted only while PAUSED there. `break()` answers an
`{error}` when the file is not on the disk (the answer lists the names).
The cycle budget bounds every call: a run never hangs a caller forever.
