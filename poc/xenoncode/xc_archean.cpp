// xc_archean.cpp — native POC host: runs a real workshop craft's XenonCode
// program on the DEV interpreter (batcholi/XenonCode) with a minimal Archean
// computer device shim.
//
// build: g++ -O2 -std=c++20 -I<XenonCode repo> xc_archean.cpp -o xc_archean
// run:   ./xc_archean <program-dir-with-main.xc> [cycles]
#define XENONCODE_IMPLEMENTATION
#include "XenonCode.hpp"
#include "XenonScreen.hpp"
#include "xc_archean_host.h"

#include <chrono>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iostream>
#include <thread>

using namespace std;
using XenonCode::Computer;
using XenonCode::Var;

// ---- the POC's one screen ("TrimsDash", 0) -------------------------------
static XenonScreen g_screen(640, 480, XENONCODE_COLOR(0, 0, 0, 255),
                                       XENONCODE_COLOR(8, 255, 255, 255));

static inline XenonScreen* screenOf(const Var& obj) {
	return reinterpret_cast<XenonScreen*>(static_cast<uint64_t>(obj));
}
static inline uint32_t packedColor(const Var& v) {
	return static_cast<uint32_t>(static_cast<uint64_t>(v));
}
static string varToString(const Var& v) { return string(v); }

// ---- device declaration (order = compile-time indices: stable) -----------
static XenonCode::Var::Type screenType;

static void archeanInit() {
	// language-level constants the programs use
	XenonCode::DeclareGlobalConstant("pi", 3.141592653589793238462643);
	XenonCode::DeclareGlobalConstant("2pi", 2 * 3.141592653589793238462643);
	// colour constants (packed RGBA as XenonScreen defines them)
	auto C = [](int r, int g, int b) { return (double)XENONCODE_COLOR(r, g, b, 255); };
	XenonCode::DeclareGlobalConstant("white", C(255, 255, 255));
	XenonCode::DeclareGlobalConstant("black", C(0, 0, 0));
	XenonCode::DeclareGlobalConstant("red", C(255, 0, 0));
	XenonCode::DeclareGlobalConstant("green", C(0, 255, 0));
	XenonCode::DeclareGlobalConstant("blue", C(0, 0, 255));
	XenonCode::DeclareGlobalConstant("yellow", C(255, 255, 0));
	XenonCode::DeclareGlobalConstant("cyan", C(0, 255, 255));
	XenonCode::DeclareGlobalConstant("magenta", C(255, 0, 255));
	XenonCode::DeclareGlobalConstant("orange", C(255, 165, 0));

	// entry points (computer.md): update runs every cycle after the timers
	XenonCode::DeclareEntryPoint("update");
	XenonCode::DeclareEntryPoint("shutdown");
	XenonCode::DeclareEntryPoint("click");
	XenonCode::DeclareEntryPoint("click_hold");
	XenonCode::DeclareEntryPoint("scroll");

	// the screen object (XenonScreen.hpp model)
	screenType = XenonCode::DeclareObjectType("screen", {
		{"char_h:number", [](Computer*, const Var& o, const vector<Var>&) -> Var {
			return (double)screenOf(o)->GetCharHeight(); }},
		{"char_w:number", [](Computer*, const Var& o, const vector<Var>&) -> Var {
			return (double)screenOf(o)->GetCharWidth(); }},
		{"size_x:number", [](Computer*, const Var& o, const vector<Var>&) -> Var {
			return (double)screenOf(o)->GetWidth(); }},
		{"size_y:number", [](Computer*, const Var& o, const vector<Var>&) -> Var {
			return (double)screenOf(o)->GetHeight(); }},
		{"text_size($n:number)", [](Computer*, const Var& o, const vector<Var>& a) -> Var {
			screenOf(o)->SetTextSize((uint32_t)(int64_t)a[0]); return {}; }},
		{"blank()", [](Computer*, const Var& o, const vector<Var>&) -> Var {
			screenOf(o)->Blank(); return {}; }},
		{"write($x:number,$y:number,$c:number,$t:text)", [](Computer*, const Var& o, const vector<Var>& a) -> Var {
			screenOf(o)->Write((uint32_t)(int64_t)a[0], (uint32_t)(int64_t)a[1],
			                   packedColor(a[2]), varToString(a[3]));
			return {}; }},
	});

	// device functions (computer.md / archean.md)
	XenonCode::DeclareDeviceFunction("screen:screen", [](Computer*, const vector<Var>&) -> Var {
		return Var(screenType, reinterpret_cast<uint64_t>(&g_screen));
	});
	XenonCode::DeclareDeviceFunction("input_number:number", [](Computer*, const vector<Var>& a) -> Var {
		int io = (int)(int64_t)a[0], ch = (int)(int64_t)a[1];
		auto i = xc_inputs.find(io);
		if (i == xc_inputs.end()) return 0.0;
		auto c = i->second.find(ch);
		return c == i->second.end() ? 0.0 : c->second;
	});
	XenonCode::DeclareDeviceFunction("input_text:text", [](Computer*, const vector<Var>& a) -> Var {
		int io = (int)(int64_t)a[0], ch = (int)(int64_t)a[1];
		auto i = xc_inputs.find(io);
		if (i == xc_inputs.end()) return string();
		auto c = i->second.find(ch);
		ostringstream s; s << c->second;
		return c == i->second.end() ? string() : s.str();
	});
	XenonCode::DeclareDeviceFunction("output_number", [](Computer*, const vector<Var>& a) -> Var {
		ostringstream s; s << (double)a[2];
		xc_eventLog.push_back("{\"e\":\"out\",\"io\":\"" + xc_jsonEscape(string(a[0]))
		                    + "\",\"port\":" + to_string((int64_t)a[1])
		                    + ",\"v\":" + s.str() + "}");
		return {};
	});
	XenonCode::DeclareDeviceFunction("output_text", [](Computer*, const vector<Var>& a) -> Var {
		xc_eventLog.push_back("{\"e\":\"out\",\"io\":\"" + xc_jsonEscape(string(a[0]))
		                    + "\",\"port\":" + to_string((int64_t)a[1])
		                    + ",\"v\":\"" + xc_jsonEscape(string(a[2])) + "\"}");
		return {};
	});
	XenonCode::DeclareDeviceFunction("print", [](Computer*, const vector<Var>& a) -> Var {
		string line;
		for (auto& v : a) { if (!line.empty()) line += " "; line += string(v); }
		xc_eventLog.push_back("{\"e\":\"print\",\"v\":\"" + xc_jsonEscape(line) + "\"}");
		return {};
	});
	XenonCode::DeclareDeviceFunction("delta_time:number", [](Computer*, const vector<Var>&) -> Var {
		return xc_dt;
	});
	XenonCode::DeclareDeviceFunction("time:number", [](Computer*, const vector<Var>&) -> Var {
		return xc_simTime;
	});
	XenonCode::DeclareDeviceFunction("game_mode:number", [](Computer*, const vector<Var>&) -> Var {
		return 0.0; // Creative
	});
	XenonCode::DeclareDeviceFunction("color:number", [](Computer*, const vector<Var>& a) -> Var {
		return (double)XENONCODE_COLOR((int)(int64_t)a[0], (int)(int64_t)a[1], (int)(int64_t)a[2], 255);
	});
	XenonCode::DeclareDeviceFunction("random:number", [](Computer*, const vector<Var>& a) -> Var {
		if (a.size() == 0) return xc_random01();
		double lo = a[0], hi = a[1];
		return floor(lo + xc_random01() * (hi - lo + 1));
	});

	// statements (io.0 / output.0) — the library writes through this
	XenonCode::SetOutputFunction([](Computer*, uint32_t io, const vector<Var>& a) {
		string line;
		for (auto& v : a) { if (!line.empty()) line += " | "; line += string(v); }
		xc_eventLog.push_back("{\"e\":\"out\",\"io\":" + to_string(io) + ",\"v\":\""
		                    + xc_jsonEscape(line) + "\"}");
	});
}

// ---- scripted pilot (the cheap exploration airplane's stick, io 11) ------
static void pilotAtCycle(int cycle) {
	xc_inputs[11].clear();
	auto set = [](int ch, double v) { xc_inputs[11][ch] = v; };
	if (cycle < 20) set(3, 1);              // Ctrl: throttle up (+5 / timer tick)
	if (cycle >= 5 && cycle < 8) set(15, 1);   // Aux 8: pitch trim down
	if (cycle >= 10 && cycle < 15) set(10, 1); // Aux 3: prop pitch up
	if (cycle >= 30 && cycle < 40) set(1, 0.5); // stick forward (elevator)
	if (cycle >= 50 && cycle < 52) set(12, 1);  // button: throttle reset
}

#ifndef __EMSCRIPTEN__
// ---- native runner --------------------------------------------------------
int main(int argc, char** argv) {
	if (argc < 2) {
		cerr << "usage: xc_archean <program-dir> [cycles]" << endl;
		return 1;
	}
	string dir = argv[1];
	int cycles = argc > 2 ? atoi(argv[2]) : 60;

	archeanInit();
	// compile main.xc (+ includes) with the dev compiler
	try {
		auto mainFile = XenonCode::GetParsedFile(dir, "main.xc");
		if (!Computer::CompileAssembly(dir, mainFile.lines, false)) {
			cerr << "compile failed" << endl;
			return 2;
		}
		cout << "[xc] compiled " << mainFile.lines.size() << " lines" << endl;
	} catch (XenonCode::CompileError& e) {
		cerr << "[xc] COMPILE ERROR: " << e.what() << endl;
		return 2;
	} catch (XenonCode::ParseError& e) {
		cerr << "[xc] PARSE ERROR: " << e.what() << endl;
		return 2;
	}

	Computer computer;
	computer.capability.ram = 65536;
	computer.capability.storage = 32;
	if (!computer.LoadProgram(dir)) { cerr << "[xc] load failed" << endl; return 3; }
	g_screen.Blank();
	bool realtime = getenv("XC_FAST") == nullptr;   // timers run on the real clock
	try {
		computer.RunInit();
		for (int c = 0; c < cycles; ++c) {
			xc_simTime += xc_dt;
			pilotAtCycle(c);
			xc_eventLog.push_back("{\"e\":\"cycle\",\"c\":" + to_string(c) + "}");
			computer.RunCycle();                 // tick + timers
			computer.RunEntryPoint("update");    // the computer device's cycle end
			if (realtime) this_thread::sleep_for(chrono::milliseconds(100));
		}
	} catch (XenonCode::RuntimeError& e) {
		cerr << "[xc] RUNTIME ERROR: " << e.what() << endl;
		return 4;
	}
	g_screen.Update();

	// ---- report: events + screen dump (PPM) --------------------------------
	ofstream ev("events.json");
	ev << "[";
	for (size_t i = 0; i < xc_eventLog.size(); ++i) {
		if (i) ev << ",";
		ev << xc_eventLog[i];
	}
	ev << "]\n";
	cout << "[xc] ran " << cycles << " cycles, " << xc_eventLog.size() << " events -> events.json" << endl;

	ofstream ppm("screen.ppm", ios::binary);
	ppm << "P6\n" << g_screen.GetWidth() << " " << g_screen.GetHeight() << "\n255\n";
	const uint8_t* px = g_screen.data();
	for (uint32_t y = 0; y < g_screen.GetHeight(); ++y) {
		for (uint32_t x = 0; x < g_screen.GetWidth(); ++x) {
			uint32_t p; memcpy(&p, px + (g_screen.GetWidth()*(size_t)y + x)*4, 4);
			char rgb[3] = { (char)XENONCODE_COLOR_R(p), (char)XENONCODE_COLOR_G(p),
			                (char)XENONCODE_COLOR_B(p) };
			ppm.write(rgb, 3);
		}
	}
	cout << "[xc] screen -> screen.ppm" << endl;
	return 0;
}

#else
// ---- browser (WASM) exports ------------------------------------------------
#include <emscripten/emscripten.h>
#include <filesystem>
#include <memory>

static unique_ptr<Computer> g_computer;
static int g_pilotScripted = 1;
static string g_evJson, g_err;
static int g_cycle = 0;

static string xc_drainEvents() {
	string s = "[";
	for (size_t i = 0; i < xc_eventLog.size(); ++i) { if (i) s += ","; s += xc_eventLog[i]; }
	s += "]";
	xc_eventLog.clear();
	return s;
}

extern "C" {

// upload one program source file (call for each, main.xc last is irrelevant)
EMSCRIPTEN_KEEPALIVE void xc_write_file(const char* name, const char* code) {
	std::filesystem::create_directories("/prog");
	ofstream f(string("/prog/") + name, ios::out | ios::trunc);
	f << code;
}

// compile /prog/main.xc (+ includes), load, run init; 0 = ok, 1 = error (xc_error)
EMSCRIPTEN_KEEPALIVE int xc_boot() {
	archeanInit();
	g_err.clear();
	try {
		auto mainFile = XenonCode::GetParsedFile("/prog", "main.xc");
		if (!Computer::CompileAssembly("/prog", mainFile.lines, false)) { g_err = "compile failed"; return 1; }
		g_computer = make_unique<Computer>();
		g_computer->capability.ram = 65536;
		g_computer->capability.storage = 32;
		if (!g_computer->LoadProgram("/prog")) { g_err = "load failed"; return 1; }
		g_screen.Blank();
		g_computer->RunInit();
		g_cycle = 0;
		return 0;
	} catch (XenonCode::ParseError& e) { g_err = "parse: " + string(e.what()); return 1; }
	  catch (XenonCode::CompileError& e) { g_err = "compile: " + string(e.what()); return 1; }
	  catch (XenonCode::RuntimeError& e) { g_err = "runtime: " + string(e.what()); return 1; }
}

// run one computer cycle (timers/tick + the update entry point); returns 0 ok
EMSCRIPTEN_KEEPALIVE int xc_cycle() {
	if (!g_computer) return 1;
	xc_simTime += xc_dt;
	if (g_pilotScripted) pilotAtCycle(g_cycle);
	++g_cycle;
	xc_eventLog.push_back("{\"e\":\"cycle\",\"c\":" + to_string(g_cycle - 1) + "}");
	try {
		g_computer->RunCycle();
		g_computer->RunEntryPoint("update");
	} catch (XenonCode::RuntimeError& e) {
		g_err = "runtime: " + string(e.what());
		g_computer.reset();
		return 1;
	}
	g_screen.Update();
	return 0;
}

// drained JSON event array (outputs/prints/screens) since last call
EMSCRIPTEN_KEEPALIVE const char* xc_events() { g_evJson = xc_drainEvents(); return g_evJson.c_str(); }
EMSCRIPTEN_KEEPALIVE const char* xc_error() { return g_err.c_str(); }
EMSCRIPTEN_KEEPALIVE void xc_set_input(int io, int ch, double v) { xc_inputs[io][ch] = v; }
EMSCRIPTEN_KEEPALIVE void xc_pilot_script(int on) { g_pilotScripted = on; }
EMSCRIPTEN_KEEPALIVE uint32_t xc_screen_w() { return g_screen.GetWidth(); }
EMSCRIPTEN_KEEPALIVE uint32_t xc_screen_h() { return g_screen.GetHeight(); }
EMSCRIPTEN_KEEPALIVE const uint8_t* xc_screen_pixels() {
	// RGBA-packed (r,g,b,a) bytes, row-major — blit straight into ImageData
	return g_screen.data();
}

}
int main() { return 0; }

#endif
