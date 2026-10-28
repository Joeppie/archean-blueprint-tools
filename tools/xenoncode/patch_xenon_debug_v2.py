#!/usr/bin/env python3
# patch_xenon_debug_v2.py — the XENON-DEBUG v2 commit on the fork's `archean`
# branch (applied once, committed — NOT run by build.sh; the scripts here
# document/re-derive the branch commits when rebasing onto newer upstream).
#
# WHY: the IDE debugger steps LINES now (F10 = next executed line, breakpoints
# stop AT the first executed pair), which needs two things v1 lacks:
#   1. the executed-line stream per FILE — LINENUMBER values are file-local,
#      so with 57 include files (the Badger) bare line numbers are ambiguous.
#      The SOURCEFILE opcode carries the file index right before the lines of
#      that file, so we record (file, line) PAIRS in EXECUTION ORDER (no sort,
#      no unique — v1 DebugTakeLines dedup destroyed exactly the order the
#      stepper needs; call/return nesting interleaves naturally in the pairs).
#   2. a DEBUG STOP-HOOK SEAM: at each executed line the interpreter calls the
#      weak extern `xc_debug_hook(file, line)`. The device shim (xc_host.cpp)
#      supplies it: today a recorder, and the Worker+Atomics debugger host
#      (approved 2026-10-28) implements the blocking pause in the SAME seam —
#      the interpreter needs no further change for mid-cycle stops, because
#      RunCode's function-call recursion lives on the C++ stack and the
#      worker simply SLEEPS inside the hook, keeping the continuation intact.
#
# Anchors are unique in XenonCode.hpp at the archean tip (XENON-DEBUG v1).
import sys

path = sys.argv[1] if len(sys.argv) > 1 else 'upstream/XenonCode.hpp'
s = open(path).read()

def one(old, new):
    global s
    assert s.count(old) == 1, f'anchor not unique/found: {old[:60]!r} (count {s.count(old)})'
    s = s.replace(old, new)

# 1) the weak hook seam + the ordered (file,line) pair stream
one("""	struct Implementation {""",
"""	// PATCH XENON-DEBUG v2: the debug stop-hook seam. The shim (xc_host.cpp)
	// supplies a strong definition; builds without one link fine (the address
	// of a weak function is null when it has no definition, and we guard).
	extern "C" { void xc_debug_hook(int /*file*/, int /*line*/) __attribute__((weak)); }
	struct Implementation {""")

one("""		// PATCH XENON-DEBUG: executed-line tracking for the IDE debugger
		static inline bool trackLines = false;
		static inline std::vector<int> cycleLines {};""",
"""		// PATCH XENON-DEBUG: executed-line tracking for the IDE debugger
		static inline bool trackLines = false;
		static inline std::vector<int> cycleLines {};
		// PATCH XENON-DEBUG v2: current source-file index (SOURCEFILE opcode)
		// + the EXECUTION-ORDER (file<<16 | line) pair stream
		static inline uint32_t dbgFile = 0;
		static inline std::vector<int> cyclePairs {};""")

# 2) SOURCEFILE tracks the file index for the pairs
one("""						case SOURCEFILE:{
							if (code.value < assembly->sourceFiles.size()) {
								currentFile = assembly->sourceFiles[code.value];
							}
						}break;""",
"""						case SOURCEFILE:{
							if (code.value < assembly->sourceFiles.size()) {
								currentFile = assembly->sourceFiles[code.value];
								// PATCH XENON-DEBUG v2: the file for the pairs
								if (Implementation::trackLines) {
									Implementation::dbgFile = code.value;
								}
							}
						}break;""")

# 3) LINENUMBER: record the ordered pair + fire the stop-hook seam
one("""						case LINENUMBER:{
							currentLine = code.value;
							// PATCH XENON-DEBUG: record the executed line
							if (Implementation::trackLines
							    && Implementation::cycleLines.size() < 200000) {
								Implementation::cycleLines.push_back(currentLine);
							}
						}break;""",
"""						case LINENUMBER:{
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
						}break;""")

# 4) public API: drain the ordered pairs; DebugTrack resets the new state
one("""		static std::vector<int> DebugTakeLines() {
			auto& v = Implementation::cycleLines;
			std::sort(v.begin(), v.end());
			v.erase(std::unique(v.begin(), v.end()), v.end());
			std::vector<int> out;
			out.swap(v);
			return out;
		}""",
"""		static std::vector<int> DebugTakeLines() {
			auto& v = Implementation::cycleLines;
			std::sort(v.begin(), v.end());
			v.erase(std::unique(v.begin(), v.end()), v.end());
			std::vector<int> out;
			out.swap(v);
			return out;
		}
		// PATCH XENON-DEBUG v2: drain the EXECUTION-ORDER pair stream
		// (file * 1000000 + line). No sort, no unique: the debugger steps
		// the program by walking this stream.
		static std::vector<int> DebugTakePairs() {
			std::vector<int> out;
			out.swap(Implementation::cyclePairs);
			return out;
		}""")

one("""		static void DebugTrack(bool on) {
			Implementation::trackLines = on;
			Implementation::cycleLines.clear();
		}""",
"""		static void DebugTrack(bool on) {
			Implementation::trackLines = on;
			Implementation::cycleLines.clear();
			Implementation::cyclePairs.clear();      // PATCH XENON-DEBUG v2
			Implementation::dbgFile = 0;             // PATCH XENON-DEBUG v2
		}""")

open(path, 'w').write(s)
print('XENON-DEBUG v2 patch applied to', path)
