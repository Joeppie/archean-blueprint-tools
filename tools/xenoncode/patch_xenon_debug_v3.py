#!/usr/bin/env python3
# patch_xenon_debug_v3.py — the XENON-DEBUG v3 commit on the fork's `archean`
# branch (applied once, committed — NOT run by build.sh; the scripts here
# document/re-derive the branch commits when rebasing onto newer upstream).
#
# WHY (the v1.13.31 debugger workpackages, workpackages.md):
#   1. WP1 (main-thread mode): the pair recorder shared the cycleLines
#      200k cap, and the main-thread pump never drains cycleLines — a chatty
#      program killed pair recording GLOBALLY after a few cycles, so
#      breakpoints stopped firing. The caps become per-stream.
#   2. WP4: F10 step-OVER landed inside in-file callees — the pair stream
#      carries no call depth. The Computer's recursion_depth is in scope at
#      the LINENUMBER opcode, so we record a parallel DEPTH stream and hand
#      the depth to the stop-hook seam (xc_debug_hook(file,line,depth)).
#      Step-over = first fresh pair of the paused file at depth <= paused.
#   3. WP6: the main-thread host pays an EM_JS boundary crossing at EVERY
#      executed line although its debugger is the pair-stream walk. The hook
#      CALL gains a hookLive gate the host arms (worker = 1, main = 0).
#   4. WP7: exact-line PAUSE for hosts that cannot sleep the interpreter
#      (the main-thread pump): a pause REQUEST records (file,line) at the
#      next executed line and throws DebugPause — RunCode's C++ frame
#      unwinds, the VM survives (locals live in RAM slots), and the host
#      sees xc_cycle() return 2 with the exact stop site.
#
# Anchors are unique in XenonCode.hpp at the archean tip (XENON-DEBUG v2 +
# XENON-ENTRYPOINT-FRAME).
import sys

path = sys.argv[1] if len(sys.argv) > 1 else 'upstream/XenonCode.hpp'
s = open(path).read()
orig = s

def one(old, new):
    global s
    assert s.count(old) == 1, f'anchor not unique/found: {old[:60]!r} (count {s.count(old)})'
    s = s.replace(old, new)

# 1) the stop-hook seam gains the call depth
one("""	extern "C" { void xc_debug_hook(int /*file*/, int /*line*/) __attribute__((weak)); }""",
"""	// PATCH XENON-DEBUG v3: the seam carries the call depth (step-over over
	// in-file callees — the pair stream alone cannot express it).
	extern "C" { void xc_debug_hook(int /*file*/, int /*line*/, int /*depth*/) __attribute__((weak)); }""")

# 2) Implementation state: depth stream, per-stream caps, pause seam, hook gate
one("""		// PATCH XENON-DEBUG v2: current source-file index (SOURCEFILE opcode)
		// + the EXECUTION-ORDER (file<<16 | line) pair stream
		static inline uint32_t dbgFile = 0;
		static inline std::vector<int> cyclePairs {};""",
"""		// PATCH XENON-DEBUG v2: current source-file index (SOURCEFILE opcode)
		// + the EXECUTION-ORDER (file<<16 | line) pair stream
		static inline uint32_t dbgFile = 0;
		static inline std::vector<int> cyclePairs {};
		// PATCH XENON-DEBUG v3: parallel CALL-DEPTH stream (Computer
		// recursion_depth at the executed line) — the debugger's step-over
		// law stops at depth <= the paused depth
		static inline std::vector<int> cycleDepth {};
		// v3: gate on the hook CALL (main-thread hosts: the pair stream IS
		// the debugger; the EM_JS per-line crossing is pure cost there)
		static inline bool hookLive = false;
		// v3: exact-line PAUSE REQUEST for hosts that cannot sleep the
		// interpreter — the next executed LINENUMBER records the site and
		// throws DebugPause (the host sees xc_cycle() return 2)
		struct DebugPause {};
		static inline volatile bool pauseRequest = false;
		static inline int pauseFile = 0;
		static inline int pauseLine = 0;""")

# 2b) SOURCEFILE updates the hook's file index UNCONDITIONALLY: the hook
#     evaluates runTo/breakpoint FILE checks while trackLines is OFF — a
#     frozen dbgFile reports every untracked line as file 0 (the v1.13.31
#     audit caught the worker's run-to-cursor dying on untracked streams)
one("\t\t\t\t\t\t\t\tif (code.value < assembly->sourceFiles.size()) {\n"
    "\t\t\t\t\t\t\t\t\tcurrentFile = assembly->sourceFiles[code.value];\n"
    "\t\t\t\t\t\t\t\t\t// PATCH XENON-DEBUG v2: the file for the pairs\n"
    "\t\t\t\t\t\t\t\t\tif (Implementation::trackLines) {\n"
    "\t\t\t\t\t\t\t\t\t\tImplementation::dbgFile = code.value;\n"
    "\t\t\t\t\t\t\t\t\t}\n"
    "\t\t\t\t\t\t\t\t}",
    "\t\t\t\t\t\t\t\tif (code.value < assembly->sourceFiles.size()) {\n"
    "\t\t\t\t\t\t\t\t\tcurrentFile = assembly->sourceFiles[code.value];\n"
    "\t\t\t\t\t\t\t\t\t// PATCH XENON-DEBUG v2: the file for the pairs —\n"
    "\t\t\t\t\t\t\t\t\t// v3: UNCONDITIONAL (one store per SOURCEFILE\n"
    "\t\t\t\t\t\t\t\t\t// opcode): the hook evaluates runTo/breakpoint FILE\n"
    "\t\t\t\t\t\t\t\t\t// checks while trackLines is off; a frozen dbgFile\n"
    "\t\t\t\t\t\t\t\t\t// would report every untracked line as file 0\n"
    "\t\t\t\t\t\t\t\t\tImplementation::dbgFile = code.value;\n"
    "\t\t\t\t\t\t\t\t}")

# 3) the LINENUMBER opcode: caps + depth + hook gate + pause seam
one("""						case LINENUMBER:{
							currentLine = code.value;
							// PATCH XENON-DEBUG: record the executed line
							if (Implementation::trackLines
							    && Implementation::cycleLines.size() < 200000) {
								Implementation::cycleLines.push_back(currentLine);
								// PATCH XENON-DEBUG v2: ordered (file,line)
								// pair + the stop-hook seam. The hook runs on
								// the interpreter stack: a blocking host (the
								// worker debugger) SLEEPS HERE mid-cycle and
								// resumes with the continuation intact.
								Implementation::cyclePairs.push_back(
								    int(Implementation::dbgFile) * 1000000 + int(currentLine));
								if (&xc_debug_hook != nullptr) {
									xc_debug_hook(int(Implementation::dbgFile), int(currentLine));
								}
							}
						}break;""",
"""						case LINENUMBER:{
							currentLine = code.value;
							// PATCH XENON-DEBUG v3: pause-request seam —
							// OUTSIDE the tracking gate (a predictable-false
							// branch is free; pausing must work untracked)
							if (__builtin_expect(Implementation::pauseRequest, 0)) {
								Implementation::pauseRequest = false;
								Implementation::pauseFile = int(Implementation::dbgFile);
								Implementation::pauseLine = currentLine;
								throw Implementation::DebugPause{};
							}
							// PATCH XENON-DEBUG: record the executed line
							if (Implementation::trackLines) {
								// v3: PER-STREAM caps (sharing the lines cap
								// killed pairs when lines were never drained)
								if (Implementation::cycleLines.size() < 200000)
									Implementation::cycleLines.push_back(currentLine);
								if (Implementation::cyclePairs.size() < 200000) {
									// PATCH XENON-DEBUG v2: ordered (file,line)
									// pair — the main-thread pump's stream
									Implementation::cyclePairs.push_back(
									    int(Implementation::dbgFile) * 1000000 + int(currentLine));
									// PATCH XENON-DEBUG v3: parallel depth row
									Implementation::cycleDepth.push_back(int(recursion_depth));
								}
							}
							// v3: the stop-hook CALL — gated by hookLive ONLY
							// (worker hosts arm it, main-thread hosts stay
							// inert), NOT by trackLines: the hook IS the
							// worker's debugger and must service pending
							// commands (breakpoints, steps, runTo, parks)
							// even while the pump records nothing. The hook
							// runs on the interpreter stack: a blocking host
							// (the worker debugger) SLEEPS HERE mid-cycle and
							// resumes with the continuation intact.
							if (Implementation::hookLive && &xc_debug_hook != nullptr) {
								xc_debug_hook(int(Implementation::dbgFile), int(currentLine),
								              int(recursion_depth));
							}
						}break;""")

# 4) public API: depth drain, pause-request + site readers, hook gate, resets
one("""		static void DebugTrack(bool on) {
			Implementation::trackLines = on;
			Implementation::cycleLines.clear();
			Implementation::cyclePairs.clear();      // PATCH XENON-DEBUG v2
			Implementation::dbgFile = 0;             // PATCH XENON-DEBUG v2
		}""",
"""		static void DebugTrack(bool on) {
			Implementation::trackLines = on;
			Implementation::cycleLines.clear();
			Implementation::cyclePairs.clear();      // PATCH XENON-DEBUG v2
			Implementation::dbgFile = 0;             // PATCH XENON-DEBUG v2
			Implementation::cycleDepth.clear();      // PATCH XENON-DEBUG v3
		}
		// PATCH XENON-DEBUG v3: drain the call-depth stream (index-aligned
		// with DebugTakePairs — the host drains both per cycle)
		static std::vector<int> DebugTakeDepths() {
			std::vector<int> out;
			out.swap(Implementation::cycleDepth);
			return out;
		}
		// v3: the exact-line pause seam (the host's cycle call catches
		// Implementation::DebugPause, reads the site, keeps the Computer)
		static void DebugPauseRequest() { Implementation::pauseRequest = true; }
		// v3: cancel an armed park (▶/F8/re-boot: START outranks a ⏸ that
		// has not reached its stop line — a late park would yank the UI)
		static void DebugPauseCancel() { Implementation::pauseRequest = false; }
		static int  DebugPauseFile() { return Implementation::pauseFile; }
		static int  DebugPauseLine() { return Implementation::pauseLine; }
		// v3: arm/disarm the per-line stop-hook CALL
		static void HookLive(bool on) { Implementation::hookLive = on; }""")

if s != orig:
    open(path, 'w').write(s)
    print('XENON-DEBUG v3 patch applied to', path)
else:
    print('XENON-DEBUG v3 patch already applied to', path)
