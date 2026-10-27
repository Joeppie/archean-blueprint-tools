// xc_host.cpp — the XenonCode host: runs real craft programs on the DEV
// interpreter (batcholi/XenonCode) with a minimal Archean computer device shim.
//
// native:  g++ -O2 -std=c++20 -I<upstream> xc_host.cpp -o run/xc_run
//          ./run/xc_run <program-dir-with-main.xc> [cycles]   (XC_DIAL=… for hello)
// browser: see build.sh -> xenoncode.js + xenoncode.wasm
#define XENONCODE_IMPLEMENTATION
#include "XenonCode.hpp"
#include "XenonScreen.hpp"
#include "xc_host.h"

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

// ---- the screen registry --------------------------------------------------
// screen(aliasOrIoNumber, channelIndex) binds to a craft's Screen/HdScreen
// surface (a Dashboard element per wiki xenoncode/dashboard.md). The host
// pre-registers real surfaces (xc_add_screen) sized from the blueprint; an
// unregistered alias auto-creates a default surface so any program runs.
struct ScreenSlot {
	std::string key;                        // lowercased alias#channel
	std::unique_ptr<XenonScreen> scr;
};
static std::vector<ScreenSlot> g_screens;

static std::string xc_lower(std::string s) {
	for (auto& c : s) c = (char)tolower((unsigned char)c);
	return s;
}
static int xc_findScreen(const std::string& alias, int ch) {
	std::string key = xc_lower(alias) + "#" + std::to_string(ch);
	for (size_t i = 0; i < g_screens.size(); ++i)
		if (g_screens[i].key == key) return (int)i;
	return -1;
}
static int xc_addScreen(const std::string& alias, int ch, uint32_t w, uint32_t h) {
	int i = xc_findScreen(alias, ch);
	if (i >= 0) return i;
	g_screens.push_back({ xc_lower(alias) + "#" + std::to_string(ch),
		std::make_unique<XenonScreen>(w, h, XENONCODE_COLOR(0, 0, 0, 255),
		                              XENONCODE_COLOR(8, 255, 255, 255)) });
	return (int)g_screens.size() - 1;
}

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
	static bool declared = false;   // re-boot reuses the declarations (the
	if (declared) return;           // library asserts on duplicate names)
	declared = true;
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
	XenonCode::DeclareGlobalConstant("gray", C(128, 128, 128));
	XenonCode::DeclareGlobalConstant("grey", C(128, 128, 128));
	XenonCode::DeclareGlobalConstant("lime", C(0, 255, 128));
	XenonCode::DeclareGlobalConstant("navy", C(0, 0, 128));
	XenonCode::DeclareGlobalConstant("teal", C(0, 128, 128));
	XenonCode::DeclareGlobalConstant("purple", C(160, 32, 240));
	XenonCode::DeclareGlobalConstant("pink", C(255, 192, 203));
	XenonCode::DeclareGlobalConstant("brown", C(150, 90, 40));
	XenonCode::DeclareGlobalConstant("silver", C(192, 192, 192));
	// text alignment constants (XENONCODE_* bits in XenonScreen.hpp)
	XenonCode::DeclareGlobalConstant("top_left", (double)(4 | 1));
	XenonCode::DeclareGlobalConstant("top", 4.0);
	XenonCode::DeclareGlobalConstant("top_right", (double)(4 | 2));
	XenonCode::DeclareGlobalConstant("left", 1.0);
	XenonCode::DeclareGlobalConstant("center", 16.0);
	XenonCode::DeclareGlobalConstant("right", 2.0);
	XenonCode::DeclareGlobalConstant("bottom_left", (double)(8 | 1));
	XenonCode::DeclareGlobalConstant("bottom", 8.0);
	XenonCode::DeclareGlobalConstant("bottom_right", (double)(8 | 2));

	// entry points (computer.md): update runs every cycle after the timers
	XenonCode::DeclareEntryPoint("update");
	XenonCode::DeclareEntryPoint("shutdown");
	XenonCode::DeclareEntryPoint("click");
	XenonCode::DeclareEntryPoint("click_hold");
	XenonCode::DeclareEntryPoint("scroll");

	// the screen object (XenonScreen.hpp model)
	//
	// OVERLOADS: the library keys device functions by NAME, so a member may
	// carry exactly ONE declared prototype (declaring write/blank twice
	// throws "Cannot override a device object member"). The call sites are
	// not arity-checked, so we declare the WIDEST form and dispatch on the
	// runtime argument count inside one lambda — that is the variadic-member
	// pattern a real integration needs (the game's compiler is a superset of
	// the open library here).
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
			if (a.size() >= 1) screenOf(o)->SetTextSize((uint32_t)(int64_t)a[0]); return {}; }},
		// blank() / blank(color) — one declaration, runtime arity dispatch
		{"blank($c:number)", [](Computer*, const Var& o, const vector<Var>& a) -> Var {
			if (a.size() >= 1) screenOf(o)->Blank(packedColor(a[0]));
			else screenOf(o)->Blank();
			return {}; }},
		// color(c) — foreground
		{"color($c:number)", [](Computer*, const Var& o, const vector<Var>& a) -> Var {
			if (a.size() >= 1) screenOf(o)->SetFgColor(packedColor(a[0])); return {}; }},
		// write(x,y,color,text) / write(x,y,text) / write(text)
		{"write($x:number,$y:number,$c:number,$t:text)", [](Computer*, const Var& o, const vector<Var>& a) -> Var {
			XenonScreen* s = screenOf(o);
			if (a.size() >= 4) s->Write((uint32_t)(int64_t)a[0], (uint32_t)(int64_t)a[1],
			                            packedColor(a[2]), varToString(a[3]));
			else if (a.size() == 3) s->Write((uint32_t)(int64_t)a[0], (uint32_t)(int64_t)a[1],
			                              s->GetFgColor(), varToString(a[2]));
			else if (a.size() == 1) s->Write(s->GetFgColor(), varToString(a[0]));
			return {}; }},
		// pixel(x, y, color) — one framebuffer pixel (the wiki's draw_point;
		// kept as `pixel` too — XenonDraw-era programs use both names)
		{"pixel($x:number,$y:number,$c:number)", [](Computer*, const Var& o, const vector<Var>& a) -> Var {
			XenonScreen* s = screenOf(o);
			s->DrawPoint((int)(int64_t)a[0], (int)(int64_t)a[1], packedColor(a[2]));
			return {}; }},
		// the wiki's screen rendering API (xenoncode/dashboard.md), 1:1 with
		// the dev's XenonScreen.hpp primitives
		{"width:number", [](Computer*, const Var& o, const vector<Var>&) -> Var {
			return (double)screenOf(o)->GetWidth(); }},
		{"height:number", [](Computer*, const Var& o, const vector<Var>&) -> Var {
			return (double)screenOf(o)->GetHeight(); }},
		{"text_align($a:number)", [](Computer*, const Var& o, const vector<Var>& a) -> Var {
			if (a.size() >= 1) screenOf(o)->SetTextAlign((uint32_t)(int64_t)a[0]); return {}; }},
		{"newline_spacing($n:number)", [](Computer*, const Var& o, const vector<Var>& a) -> Var {
			if (a.size() >= 1) screenOf(o)->SetNewlineSpacing((uint32_t)(int64_t)a[0]); return {}; }},
		{"draw_point($x:number,$y:number,$c:number)", [](Computer*, const Var& o, const vector<Var>& a) -> Var {
			screenOf(o)->DrawPoint((int)(int64_t)a[0], (int)(int64_t)a[1], packedColor(a[2])); return {}; }},
		{"draw_line($x1:number,$y1:number,$x2:number,$y2:number,$c:number)", [](Computer*, const Var& o, const vector<Var>& a) -> Var {
			screenOf(o)->DrawLine((int)(int64_t)a[0], (int)(int64_t)a[1],
			                      (int)(int64_t)a[2], (int)(int64_t)a[3], packedColor(a[4])); return {}; }},
		// draw_rect(x1,y1,x2,y2,color[,fillcolor]) — the optional fill is the
		// overload pattern again (one declaration, runtime arity)
		{"draw_rect($x1:number,$y1:number,$x2:number,$y2:number,$c:number,$f:number)", [](Computer*, const Var& o, const vector<Var>& a) -> Var {
			screenOf(o)->DrawRect((int)(int64_t)a[0], (int)(int64_t)a[1], (int)(int64_t)a[2], (int)(int64_t)a[3],
			                      packedColor(a[4]), a.size() >= 6 ? packedColor(a[5]) : 0u); return {}; }},
		{"draw_triangle($x1:number,$y1:number,$x2:number,$y2:number,$x3:number,$y3:number,$c:number,$f:number)", [](Computer*, const Var& o, const vector<Var>& a) -> Var {
			screenOf(o)->DrawTriangle((int)(int64_t)a[0], (int)(int64_t)a[1], (int)(int64_t)a[2], (int)(int64_t)a[3],
			                          (int)(int64_t)a[4], (int)(int64_t)a[5], packedColor(a[6]),
			                          a.size() >= 8 ? packedColor(a[7]) : 0u); return {}; }},
		{"draw_circle($x:number,$y:number,$r:number,$c:number,$f:number)", [](Computer*, const Var& o, const vector<Var>& a) -> Var {
			screenOf(o)->DrawCircle((int)(int64_t)a[0], (int)(int64_t)a[1], (int)(int64_t)a[2], packedColor(a[3]),
			                        a.size() >= 5 ? packedColor(a[4]) : 0u); return {}; }},
		// draw_poly(color, x1, y1, x2, y2, ...) — variadic points: declare
		// two, walk the rest at runtime
		{"draw_poly($c:number,$x:number,$y:number)", [](Computer*, const Var& o, const vector<Var>& a) -> Var {
			vector<int> pts;
			for (size_t i = 1; i + 1 < a.size(); i += 2)
				pts.push_back((int)(int64_t)a[i]), pts.push_back((int)(int64_t)a[i + 1]);
			screenOf(o)->DrawPoly(packedColor(a[0]), pts); return {}; }},
	});

	// device functions (computer.md / archean.md)
	// screen(aliasOrIoNumber, channelIndex) — the registry surface for that
	// Screen/HdScreen; auto-creates a default 640x480 for unregistered names
	XenonCode::DeclareDeviceFunction("screen:screen", [](Computer*, const vector<Var>& a) -> Var {
		string alias = a.size() >= 1 ? xc_lower(string(a[0])) : "main";
		int ch = a.size() >= 2 ? (int)(int64_t)a[1] : 0;
		int i = xc_findScreen(alias, ch);
		if (i < 0) i = xc_addScreen(alias, ch, 640, 480);
		return Var(screenType, reinterpret_cast<uint64_t>(g_screens[i].scr.get()));
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
	computer.LoadStorage(dir + "/storage");
	xc_addScreen("main", 0, 640, 480);
	for (auto& s : g_screens) s.scr->Blank();
	const double dial = getenv("XC_DIAL") ? atof(getenv("XC_DIAL")) : 0.0;
	xc_inputs[1][7] = dial;   // the hello program's externally provided numer
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
	computer.SaveStorage(dir + "/storage");

	// ---- report: events + a PPM per screen ---------------------------------
	ofstream ev("events.json");
	ev << "[";
	for (size_t i = 0; i < xc_eventLog.size(); ++i) {
		if (i) ev << ",";
		ev << xc_eventLog[i];
	}
	ev << "]\n";
	cout << "[xc] ran " << cycles << " cycles, " << xc_eventLog.size() << " events -> events.json" << endl;
	for (auto& s : g_screens) {
		s.scr->Update();
		string fname = "screen-" + s.key + ".ppm";
		ofstream ppm(fname, ios::binary);
		ppm << "P6\n" << s.scr->GetWidth() << " " << s.scr->GetHeight() << "\n255\n";
		const uint8_t* px = s.scr->data();
		for (uint32_t y = 0; y < s.scr->GetHeight(); ++y) {
			for (uint32_t x = 0; x < s.scr->GetWidth(); ++x) {
				uint32_t p; memcpy(&p, px + (s.scr->GetWidth()*(size_t)y + x)*4, 4);
				char rgb[3] = { (char)XENONCODE_COLOR_R(p), (char)XENONCODE_COLOR_G(p),
				                (char)XENONCODE_COLOR_B(p) };
				ppm.write(rgb, 3);
			}
		}
		cout << "[xc] screen " << s.key << " -> " << fname << endl;
	}
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
		g_computer->LoadStorage("/prog/storage");   // survives reboots in-session
		for (auto& s : g_screens) s.scr->Blank();
		g_computer->RunInit();
		g_cycle = 0;
		return 0;
	} catch (XenonCode::ParseError& e) { g_err = "parse: " + string(e.what()); return 1; }
	  catch (XenonCode::CompileError& e) { g_err = "compile: " + string(e.what()); return 1; }
	  catch (XenonCode::RuntimeError& e) { g_err = "runtime: " + string(e.what()); return 1; }
	  catch (std::exception& e) { g_err = "error: " + string(e.what()); return 1; }
	  catch (...) { g_err = "unknown compile error"; return 1; }
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
	} catch (std::exception& e) {
		g_err = "error: " + string(e.what());
		g_computer.reset();
		return 1;
	}
	for (auto& s : g_screens) s.scr->Update();
	return 0;
}

// drained JSON event array (outputs/prints/screens) since last call
EMSCRIPTEN_KEEPALIVE const char* xc_events() { g_evJson = xc_drainEvents(); return g_evJson.c_str(); }
EMSCRIPTEN_KEEPALIVE const char* xc_error() { return g_err.c_str(); }
EMSCRIPTEN_KEEPALIVE void xc_set_input(int io, int ch, double v) { xc_inputs[io][ch] = v; }
EMSCRIPTEN_KEEPALIVE void xc_save_storage() { if (g_computer) g_computer->SaveStorage("/prog/storage"); }
EMSCRIPTEN_KEEPALIVE void xc_pilot_script(int on) { g_pilotScripted = on; }

// ---- screen registry (the craft's Screen/HdScreen surfaces) ---------------
EMSCRIPTEN_KEEPALIVE void xc_reset_screens() { g_screens.clear(); }
EMSCRIPTEN_KEEPALIVE int xc_add_screen(const char* alias, int ch, uint32_t w, uint32_t h) {
	return xc_addScreen(alias, ch, w, h);
}
EMSCRIPTEN_KEEPALIVE int xc_screen_count() { return (int)g_screens.size(); }
EMSCRIPTEN_KEEPALIVE const char* xc_screen_key(int i) {
	return (i >= 0 && i < (int)g_screens.size()) ? g_screens[i].key.c_str() : "";
}
EMSCRIPTEN_KEEPALIVE uint32_t xc_screen_w(int i) {
	return (i >= 0 && i < (int)g_screens.size()) ? g_screens[i].scr->GetWidth() : 0;
}
EMSCRIPTEN_KEEPALIVE uint32_t xc_screen_h(int i) {
	return (i >= 0 && i < (int)g_screens.size()) ? g_screens[i].scr->GetHeight() : 0;
}
EMSCRIPTEN_KEEPALIVE const uint8_t* xc_screen_pixels(int i) {
	// RGBA-packed (r,g,b,a) bytes, row-major — blit straight into ImageData
	if (i < 0 || i >= (int)g_screens.size()) return nullptr;
	g_screens[i].scr->Update();
	return g_screens[i].scr->data();
}

// the IDE's live parse (the wiki's Editor section: parse the current line on
// each keystroke): 0 = parses, 1 = error (xc_error carries the message)
EMSCRIPTEN_KEEPALIVE int xc_parse_line(const char* line, int lineno) {
	archeanInit();
	g_err.clear();
	try {
		(void)XenonCode::ParsedLine(line, lineno, false);
		return 0;
	} catch (XenonCode::ParseError& e) { g_err = e.what(); return 1; }
	  catch (...) { g_err = "parse error"; return 1; }
}

}
int main() { return 0; }

#endif
