// xc_archean_host.h — POC device shim: the ARCHEAN_computer device side of
// XenonCode, minimal enough to run a real workshop craft's program.
//
// XenonCode (github.com/batcholi/XenonCode, by the game's dev) ships the
// LANGUAGE core (XenonCode.hpp: parser/compiler/VM) and the SCREEN model
// (XenonScreen.hpp) as open source; the DEVICE functions (screen(), input_*,
// output_*, colours, entry points) live in the game binary. This header is a
// minimal re-implementation of that device side for the POC — the names and
// signatures follow the official XenonCode pages shipped with the game
// (Archean-game/wiki/en/xenoncode/{computer,archean,dashboard}.md) and the
// real workshop programs that use them.
//
// The same host compiles natively (g++) and for the browser (emscripten →
// WASM), so the POC runs the DEV interpreter, not a re-implementation.
#pragma once
#include <cstdio>
#include <map>
#include <string>
#include <vector>

static const char* XC_COLORS[] = {
	"white", "black", "red", "green", "blue", "yellow", "cyan", "magenta",
	"orange", "purple", "brown", "gray", "grey", "lime", "navy", "teal",
	"maroon", "olive", "pink", "silver", "aqua", nullptr
};

// io index → channel → value (the pilot seat / buttons write these in game)
inline std::map<int, std::map<int, double>> xc_inputs;
// event log (outputs / prints) drained by the host per cycle
inline std::vector<std::string> xc_eventLog;
inline double xc_simTime = 0.0;
inline double xc_lastPrintTime = -1.0;
inline double xc_dt = 0.1;
inline uint64_t xc_rngState = 88172645463325252ULL;

inline std::string xc_jsonEscape(const std::string& s) {
	std::string o;
	for (char c : s) {
		switch (c) {
			case '"': o += "\\\""; break;
			case '\\': o += "\\\\"; break;
			case '\n': o += "\\n"; break;
			case '\t': o += "\\t"; break;
			default: if ((unsigned char)c >= 32) o += c;
		}
	}
	return o;
}

inline double xc_random01() {
	xc_rngState ^= xc_rngState << 13;
	xc_rngState ^= xc_rngState >> 7;
	xc_rngState ^= xc_rngState << 17;
	return double(xc_rngState % 1000000) / 1000000.0;
}
