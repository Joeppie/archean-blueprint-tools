#!/usr/bin/env python3
# patch_xenon_debug.py — a documented patch on the pinned XenonCode checkout
# (build.sh applies it, after patch_xenon_vars.py).
#
# WHY: the IDE's BREAKPOINT/STEP debugger (F9 break, F10/F11 step, F8
# resume). The library's VM runs a whole cycle to completion with no hook,
# so we add the smallest thing that gives the host real power: the
# interpreter RECORDS the source lines it executes each cycle (behind a
# flag — one branch per LINENUMBER opcode, off = free). The host then:
#   · pauses the pump at the cycle that TOUCHED a breakpoint line,
#   · steps exactly one 10 Hz cycle per F10 (step == one computer cycle —
#     true line-stepping would need suspend/resume in the interpreter,
#     which the library's architecture has no room for),
#   · reports the executed lines so the UI can light them up.
# RunCode's LINENUMBER case is the single line-boundary on the hot path.
import sys

path = sys.argv[1] if len(sys.argv) > 1 else 'upstream/XenonCode.hpp'
s = open(path).read()
orig = s

def one(old, new):
    global s
    assert s.count(old) == 1, f'anchor not unique/found: {old[:60]!r} (count {s.count(old)})'
    s = s.replace(old, new)

# 1) the tracking table (namespace Implementation, next to the XENON-VARS table)
one("""		static inline std::vector<GlobalVarDecl> globalVarDecls {};
	};""",
"""		static inline std::vector<GlobalVarDecl> globalVarDecls {};
		// PATCH XENON-DEBUG: executed-line tracking for the IDE debugger
		static inline bool trackLines = false;
		static inline std::vector<int> cycleLines {};
	};""")

# 2) the hook on the hot path (RunCode's LINENUMBER case)
one("""						case LINENUMBER:{
							currentLine = code.value;
						}break;""",
"""						case LINENUMBER:{
							currentLine = code.value;
							// PATCH XENON-DEBUG: record the executed line
							if (Implementation::trackLines
							    && Implementation::cycleLines.size() < 200000) {
								Implementation::cycleLines.push_back(currentLine);
							}
						}break;""")

# 3) the public switches (Computer, next to the XENON-VARS dumper)
one("""		bool IsLoaded() const {return assembly;}""",
"""		bool IsLoaded() const {return assembly;}
		
		// PATCH XENON-DEBUG: line-tracking switch + drain (sorted, unique)
		static void DebugTrack(bool on) {
			Implementation::trackLines = on;
			Implementation::cycleLines.clear();
		}
		static std::vector<int> DebugTakeLines() {
			auto& v = Implementation::cycleLines;
			std::sort(v.begin(), v.end());
			v.erase(std::unique(v.begin(), v.end()), v.end());
			std::vector<int> out;
			out.swap(v);
			return out;
		}""")

if s != orig:
    open(path, 'w').write(s)
    print(f'XENON-DEBUG patch applied to {path}')
else:
    print(f'XENON-DEBUG patch already applied to {path}')
