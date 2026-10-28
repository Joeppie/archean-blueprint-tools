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

#include <algorithm>
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
	// this cycle's input (wiki computer.md/dashboard.md): a click delivered
	// by the host (xc_screen_click) is visible to button_rect/button and the
	// clicked/click_x/click_y values DURING the cycle, then cleared.
	bool clicked = false; int clickX = 0, clickY = 0;
	double scroll = 0.0;
};
static std::vector<ScreenSlot> g_screens;
static std::map<XenonScreen*, size_t> g_slotByPtr;  // object -> slot INDEX
                                                  // (the vector reallocates —
                                                  // pointers into it dangle)
// the computer-integrated-screen click the built-in values read (the last
// slot clicked this cycle — a Computer has ONE screen, MiniComputers route
// their dashboards' clicks through the same shape)
static bool g_anyClicked = false;
static int g_anyClickX = 0, g_anyClickY = 0;
static double g_anyScroll = 0.0;
// input_number/input_text reads this cycle (the IDE's node cards show the
// values a program ACTUALLY read: drained as {"e":"in"} events per cycle)
static std::map<std::pair<int, int>, double> g_reads;

static inline ScreenSlot* slotOf(const Var& obj);
static inline bool xc_buttonHit(ScreenSlot* s, int x, int y, int w, int h) {
	if (!s || !s->clicked) return false;
	int xa = std::min(x, x + w), xb = std::max(x, x + w);
	int ya = std::min(y, y + h), yb = std::max(y, y + h);
	return s->clickX >= xa && s->clickX < xb && s->clickY >= ya && s->clickY < yb;
}
static void xc_clickAt(size_t idx, int x, int y) {
	if (idx >= g_screens.size()) return;
	auto& s = g_screens[idx];
	s.clicked = true; s.clickX = x; s.clickY = y;
	g_anyClicked = true; g_anyClickX = x; g_anyClickY = y;
}

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
	g_slotByPtr[g_screens.back().scr.get()] = g_screens.size() - 1;
	return (int)g_screens.size() - 1;
}

static inline XenonScreen* screenOf(const Var& obj) {
	return reinterpret_cast<XenonScreen*>(static_cast<uint64_t>(obj));
}
// null-guarded member target: a zero object var (fresh RAM mid-vars_init on a
// REBOOT — the registry survives, the program's $screen globals restart at 0)
// must never segfault the host; members on it are no-ops, getters 0.
static inline XenonScreen* Scr(const Var& obj) {
	uint64_t p = static_cast<uint64_t>(obj);
	return p ? reinterpret_cast<XenonScreen*>(p) : nullptr;
}
static inline ScreenSlot* slotOf(const Var& obj) {
	auto i = g_slotByPtr.find(screenOf(obj));
	return i == g_slotByPtr.end() ? nullptr : &g_screens[i->second];
}
static int xc_indexOf(const string& key) {
	string k = xc_lower(key);
	for (size_t i = 0; i < g_screens.size(); ++i) if (g_screens[i].key == k) return (int)i;
	return -1;
}

// ---- component inspection table (JS fills it from the blueprint) ----------
struct DevInfo {
	int id; string alias, type; int port;
	double x, y, z, sx, sy, sz, mass;
};
static vector<DevInfo> g_devs;
// canned WORLD data for ALIAS-only devices (no cable ⇒ no live source):
// the simulator supplies plausible instrument readings from the game's OWN
// channel tables so firmware with presence gates boots — the Badger's
// startup gate checks device_type("nav") + input_text("nav",13) (the
// MiniNavInstrument 'Celestial' text channel). Panel sliders
// (xc_set_input_a) override any channel.
static map<int, map<int, string>> xc_inputs_txt;
// PROGRAM-SIDE worldsim hooks (the WORLD tab's counterpart, v1.13.x):
// setworldsim(name, v) overrides a worldsim channel FROM INSIDE the program
// (the pump honours it every cycle until the program releases it with
// v = 9e99); getworldsim(name) answers the channel's CURRENT effective
// value — the pump streams every row's value back via xc_worldsim_sync.
// In the game these are the firmware's own nop functions; in the editor
// they are the API into the world sim.
// virtualscreen() naming counter (file scope: the REBOOT law resets it -
// it used to be a static INSIDE the device lambda, which lives once per
// process, so every reboot named fresh virtual#N slots while the old ones
// lingered forever - surfaces drifted and piled up per reboot)
static int g_nextVirtual = 0;
static map<string, double> g_wsProgram;    // name -> active program override
static map<string, double> g_wsEffective;  // name -> last effective value
static map<int, int> g_devByIo;        // computer io port → table index
static map<string, int> g_devByAlias;  // lowercased alias → table index
// computer.md: input_/output_ take an aliasOrIoNumber — resolve a TEXT arg
// through the device table (a cabled device reads on its io port; an
// ALIAS-only device — the Badger's 82 — reads on a synthetic 1000+id port
// that xc_set_input_a wires the panel sliders to).
static int xc_ioOf(const Var& a) {
	if (a.type == Var::Text) {
		auto i = g_devByAlias.find(xc_lower(string(a)));
		if (i == g_devByAlias.end()) return -1;
		const DevInfo& d = g_devs[i->second];
		return d.port >= 0 ? d.port : 1000 + d.id;
	}
	return (int)(int64_t)a;
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
			return (double)(Scr(o) ? Scr(o)->GetCharHeight() : 0); }},
		{"char_w:number", [](Computer*, const Var& o, const vector<Var>&) -> Var {
			return (double)(Scr(o) ? Scr(o)->GetCharWidth() : 0); }},
		{"size_x:number", [](Computer*, const Var& o, const vector<Var>&) -> Var {
			return (double)(Scr(o) ? Scr(o)->GetWidth() : 0); }},
		{"size_y:number", [](Computer*, const Var& o, const vector<Var>&) -> Var {
			return (double)(Scr(o) ? Scr(o)->GetHeight() : 0); }},
		{"text_size($n:number)", [](Computer*, const Var& o, const vector<Var>& a) -> Var {
			if (auto* S = Scr(o)) if (a.size() >= 1) S->SetTextSize((uint32_t)(int64_t)a[0]); return {}; }},
		// blank() / blank(color) — one declaration, runtime arity dispatch
		{"blank($c:number)", [](Computer*, const Var& o, const vector<Var>& a) -> Var {
			if (auto* S = Scr(o)) { if (a.size() >= 1) S->Blank(packedColor(a[0])); else S->Blank(); }
			return {}; }},
		// color(c) — foreground
		{"color($c:number)", [](Computer*, const Var& o, const vector<Var>& a) -> Var {
			if (auto* S = Scr(o)) { if (a.size() >= 1) S->SetFgColor(packedColor(a[0])); } return {}; }},
		// write(x,y,color,text) / write(x,y,text) / write(text)
		{"write($x:number,$y:number,$c:number,$t:text)", [](Computer*, const Var& o, const vector<Var>& a) -> Var {
			XenonScreen* s = Scr(o); if (!s) return {};
			if (a.size() >= 4) s->Write((uint32_t)(int64_t)a[0], (uint32_t)(int64_t)a[1],
			                            packedColor(a[2]), varToString(a[3]));
			else if (a.size() == 3) s->Write((uint32_t)(int64_t)a[0], (uint32_t)(int64_t)a[1],
			                              s->GetFgColor(), varToString(a[2]));
			else if (a.size() == 1) s->Write(s->GetFgColor(), varToString(a[0]));
			return {}; }},
		// pixel(x, y) — GET the packed colour of one framebuffer pixel
		// (wiki computer.md/dashboard.md: "returns the current color"; the
		// POC's (x,y,color) point-SETTER was a misread — drawing is
		// draw_point, and programs use pixel() as a getter)
		{"pixel($x:number,$y:number):number", [](Computer*, const Var& o, const vector<Var>& a) -> Var {
			XenonScreen* s = Scr(o); if (!s) return {};
			int x = (int)(int64_t)a[0], y = (int)(int64_t)a[1];
			if (x < 0 || y < 0 || x >= (int)s->GetWidth() || y >= (int)s->GetHeight()) return 0.0;
			return (double)s->GetPixel(x, y); }},
		// the wiki's screen rendering API (xenoncode/dashboard.md), 1:1 with
		// the dev's XenonScreen.hpp primitives
		{"width:number", [](Computer*, const Var& o, const vector<Var>&) -> Var {
			return (double)(Scr(o) ? Scr(o)->GetWidth() : 0); }},
		{"height:number", [](Computer*, const Var& o, const vector<Var>&) -> Var {
			return (double)(Scr(o) ? Scr(o)->GetHeight() : 0); }},
		{"text_align($a:number)", [](Computer*, const Var& o, const vector<Var>& a) -> Var {
			if (auto* S = Scr(o)) if (a.size() >= 1) S->SetTextAlign((uint32_t)(int64_t)a[0]); return {}; }},
		{"newline_spacing($n:number)", [](Computer*, const Var& o, const vector<Var>& a) -> Var {
			if (auto* S = Scr(o)) if (a.size() >= 1) S->SetNewlineSpacing((uint32_t)(int64_t)a[0]); return {}; }},
		{"draw_point($x:number,$y:number,$c:number)", [](Computer*, const Var& o, const vector<Var>& a) -> Var {
			if (auto* _S = Scr(o)) _S->DrawPoint((int)(int64_t)a[0], (int)(int64_t)a[1], packedColor(a[2])); return {}; }},
		{"draw_line($x1:number,$y1:number,$x2:number,$y2:number,$c:number)", [](Computer*, const Var& o, const vector<Var>& a) -> Var {
			if (auto* _S = Scr(o)) _S->DrawLine((int)(int64_t)a[0], (int)(int64_t)a[1],
			                      (int)(int64_t)a[2], (int)(int64_t)a[3], packedColor(a[4])); return {}; }},
		// draw_rect(x1,y1,x2,y2,color[,fillcolor]) — the optional fill is the
		// overload pattern again (one declaration, runtime arity)
		{"draw_rect($x1:number,$y1:number,$x2:number,$y2:number,$c:number,$f:number)", [](Computer*, const Var& o, const vector<Var>& a) -> Var {
			if (auto* _S = Scr(o)) _S->DrawRect((int)(int64_t)a[0], (int)(int64_t)a[1], (int)(int64_t)a[2], (int)(int64_t)a[3],
			                      packedColor(a[4]), a.size() >= 6 ? packedColor(a[5]) : 0u); return {}; }},
		{"draw_triangle($x1:number,$y1:number,$x2:number,$y2:number,$x3:number,$y3:number,$c:number,$f:number)", [](Computer*, const Var& o, const vector<Var>& a) -> Var {
			if (auto* _S = Scr(o)) _S->DrawTriangle((int)(int64_t)a[0], (int)(int64_t)a[1], (int)(int64_t)a[2], (int)(int64_t)a[3],
			                          (int)(int64_t)a[4], (int)(int64_t)a[5], packedColor(a[6]),
			                          a.size() >= 8 ? packedColor(a[7]) : 0u); return {}; }},
		{"draw_circle($x:number,$y:number,$r:number,$c:number,$f:number)", [](Computer*, const Var& o, const vector<Var>& a) -> Var {
			if (auto* _S = Scr(o)) _S->DrawCircle((int)(int64_t)a[0], (int)(int64_t)a[1], (int)(int64_t)a[2], packedColor(a[3]),
			                        a.size() >= 5 ? packedColor(a[4]) : 0u); return {}; }},
		// draw_poly(color, x1, y1, x2, y2, ...) — variadic points: declare
		// two, walk the rest at runtime
		{"draw_poly($c:number,$x:number,$y:number)", [](Computer*, const Var& o, const vector<Var>& a) -> Var {
			vector<int> pts;
			for (size_t i = 1; i + 1 < a.size(); i += 2)
				pts.push_back((int)(int64_t)a[i]), pts.push_back((int)(int64_t)a[i + 1]);
			if (auto* _S = Scr(o)) _S->DrawPoly(packedColor(a[0]), pts); return {}; }},
		// button_rect(x, y, w, h, color):number — draws AND "evaluates to
		// true if clicked" (wiki computer.md:143 + dashboard.md:84). The
		// void declaration was craft 3381670618's compile error: `if
		// $screen.button_rect(...)` needs a return value.
		{"button_rect($x:number,$y:number,$w:number,$h:number,$c:number):number", [](Computer*, const Var& o, const vector<Var>& a) -> Var {
			int x = (int)(int64_t)a[0], y = (int)(int64_t)a[1], w = (int)(int64_t)a[2], h = (int)(int64_t)a[3];
			if (auto* _S = Scr(o)) _S->DrawRect(x, y, x + w, y + h, packedColor(a[4]));
			return xc_buttonHit(slotOf(o), x, y, w, h) ? 1.0 : 0.0; }},
		// legacy button(x, y, color, width, height):number — the older
		// width/height-parameter form (computer.md:156 — the COLOUR is the
		// 3rd argument, unlike button_rect)
		{"button($x:number,$y:number,$c:number,$w:number,$h:number):number", [](Computer*, const Var& o, const vector<Var>& a) -> Var {
			int x = (int)(int64_t)a[0], y = (int)(int64_t)a[1], w = (int)(int64_t)a[3], h = (int)(int64_t)a[4];
			if (auto* _S = Scr(o)) _S->DrawRect(x, y, x + w, y + h, packedColor(a[2]));
			return xc_buttonHit(slotOf(o), x, y, w, h) ? 1.0 : 0.0; }},
		// legacy draw(x, y, color, width, height) — computer.md:155
		{"draw($x:number,$y:number,$c:number,$w:number,$h:number)", [](Computer*, const Var& o, const vector<Var>& a) -> Var {
			int x = (int)(int64_t)a[0], y = (int)(int64_t)a[1], w = (int)(int64_t)a[3], h = (int)(int64_t)a[4];
			if (auto* _S = Scr(o)) _S->DrawRect(x, y, x + w, y + h, packedColor(a[2]));
			return {}; }},
		// click state of THIS surface (dashboard.md "Built-in values")
		{"clicked:number", [](Computer*, const Var& o, const vector<Var>&) -> Var {
			ScreenSlot* s = slotOf(o); return s && s->clicked ? 1.0 : 0.0; }},
		{"click_x:number", [](Computer*, const Var& o, const vector<Var>&) -> Var {
			ScreenSlot* s = slotOf(o); return s ? (double)s->clickX : 0.0; }},
		{"click_y:number", [](Computer*, const Var& o, const vector<Var>&) -> Var {
			ScreenSlot* s = slotOf(o); return s ? (double)s->clickY : 0.0; }},
		{"scroll:number", [](Computer*, const Var& o, const vector<Var>&) -> Var {
			ScreenSlot* s = slotOf(o); return s ? s->scroll : 0.0; }},
	});

	// ---- component inspection (computer.md "Component Inspection") ---------
	// The blueprint-side device table: JS fills it from the blueprint (io
	// ports via data_port cables, graph-walked through routers) before boot.
	XenonCode::DeclareDeviceFunction("device_count:number", [](Computer*, const vector<Var>&) -> Var {
		return (double)g_devs.size();
	});
	auto devDescribe = [](const DevInfo& d) -> Var {
		auto esc = [](string s) { string o; for (char c : s) if (c != '{' && c != '}') o += c; return o; };
		ostringstream s;
		s << ".id{" << d.id << "}.alias{" << esc(d.alias) << "}.port{" << d.port
		  << "}.type{" << esc(d.type) << "}.temp{288}.damage{0}.broken{0}"
		  << ".x{" << d.x << "}.y{" << d.y << "}.z{" << d.z << "}"
		  << ".size_x{" << d.sx << "}.size_y{" << d.sy << "}.size_z{" << d.sz << "}"
		  << ".mass{" << d.mass << "}";
		return Var(s.str());
	};
	auto devFind = [](const Var& a, int& out) -> bool {
		if (a.type == Var::Text) {
			string key = xc_lower(string(a));
			auto i = g_devByAlias.find(key);
			if (i == g_devByAlias.end()) return false;
			out = i->second;
		} else {
			int io = (int)(int64_t)a;
			auto i = g_devByIo.find(io);
			if (i == g_devByIo.end()) return false;
			out = i->second;
		}
		return true;
	};
	// NOTE: lambdas capturing locals are fine — DeclareDeviceFunction takes
	// std::function; devFind/devDescribe are copied in.
	XenonCode::DeclareDeviceFunction("device:text", [devFind, devDescribe](Computer*, const vector<Var>& a) -> Var {
		int i = -1;
		if (!a.size() || !devFind(a[0], i)) return Var(string(""));
		return devDescribe(g_devs[i]);
	});
	XenonCode::DeclareDeviceFunction("device_at:text", [devDescribe](Computer*, const vector<Var>& a) -> Var {
		int i = (int)(int64_t)a[0];
		if (i < 0 || i >= (int)g_devs.size()) return Var(string(""));
		return devDescribe(g_devs[i]);
	});
	XenonCode::DeclareDeviceFunction("device_type:text", [devFind](Computer*, const vector<Var>& a) -> Var {
		int i = -1;
		if (!a.size() || !devFind(a[0], i)) return Var(string(""));
		return g_devs[i].type;
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
	// ---- the Computer's integrated screen (dashboard.md "First Use": plain
	// blank(red) / write(0,0,white,"Hello") with no $screen variable). These
	// global render functions target the "main" surface; the click built-ins
	// read this cycle's click (computer.md "Built-in values").
	auto ms = []() -> XenonScreen* {
		int i = xc_findScreen("main", 0);
		if (i < 0) i = xc_addScreen("main", 0, 640, 480);
		return g_screens[i].scr.get();
	};
	auto msSlot = []() -> ScreenSlot* {
		int i = xc_findScreen("main", 0);
		return i < 0 ? nullptr : &g_screens[i];
	};
	XenonCode::DeclareDeviceFunction("blank($c:number)", [ms](Computer*, const vector<Var>& a) -> Var {
		if (a.size() >= 1) ms()->Blank(packedColor(a[0])); else ms()->Blank();
		return {}; });
	XenonCode::DeclareDeviceFunction("write($x:number,$y:number,$c:number,$t:text)", [ms](Computer*, const vector<Var>& a) -> Var {
		XenonScreen* s = ms();
		if (a.size() >= 4) s->Write((uint32_t)(int64_t)a[0], (uint32_t)(int64_t)a[1], packedColor(a[2]), varToString(a[3]));
		else if (a.size() == 3) s->Write((uint32_t)(int64_t)a[0], (uint32_t)(int64_t)a[1], s->GetFgColor(), varToString(a[2]));
		else if (a.size() == 1) s->Write(s->GetFgColor(), varToString(a[0]));
		return {}; });
	XenonCode::DeclareDeviceFunction("text_size($n:number)", [ms](Computer*, const vector<Var>& a) -> Var {
		ms()->SetTextSize((uint32_t)(int64_t)a[0]); return {}; });
	XenonCode::DeclareDeviceFunction("text_align($a:number)", [ms](Computer*, const vector<Var>& a) -> Var {
		ms()->SetTextAlign((uint32_t)(int64_t)a[0]); return {}; });
	XenonCode::DeclareDeviceFunction("newline_spacing($n:number)", [ms](Computer*, const vector<Var>& a) -> Var {
		ms()->SetNewlineSpacing((uint32_t)(int64_t)a[0]); return {}; });
	XenonCode::DeclareDeviceFunction("draw_point($x:number,$y:number,$c:number)", [ms](Computer*, const vector<Var>& a) -> Var {
		ms()->DrawPoint((int)(int64_t)a[0], (int)(int64_t)a[1], packedColor(a[2])); return {}; });
	XenonCode::DeclareDeviceFunction("draw_line($x1:number,$y1:number,$x2:number,$y2:number,$c:number)", [ms](Computer*, const vector<Var>& a) -> Var {
		ms()->DrawLine((int)(int64_t)a[0], (int)(int64_t)a[1], (int)(int64_t)a[2], (int)(int64_t)a[3], packedColor(a[4])); return {}; });
	XenonCode::DeclareDeviceFunction("draw_rect($x1:number,$y1:number,$x2:number,$y2:number,$c:number,$f:number)", [ms](Computer*, const vector<Var>& a) -> Var {
		ms()->DrawRect((int)(int64_t)a[0], (int)(int64_t)a[1], (int)(int64_t)a[2], (int)(int64_t)a[3],
		               packedColor(a[4]), a.size() >= 6 ? packedColor(a[5]) : 0u); return {}; });
	XenonCode::DeclareDeviceFunction("draw_triangle($x1:number,$y1:number,$x2:number,$y2:number,$x3:number,$y3:number,$c:number,$f:number)", [ms](Computer*, const vector<Var>& a) -> Var {
		ms()->DrawTriangle((int)(int64_t)a[0], (int)(int64_t)a[1], (int)(int64_t)a[2], (int)(int64_t)a[3],
		                   (int)(int64_t)a[4], (int)(int64_t)a[5], packedColor(a[6]),
		                   a.size() >= 8 ? packedColor(a[7]) : 0u); return {}; });
	XenonCode::DeclareDeviceFunction("draw_circle($x:number,$y:number,$r:number,$c:number,$f:number)", [ms](Computer*, const vector<Var>& a) -> Var {
		ms()->DrawCircle((int)(int64_t)a[0], (int)(int64_t)a[1], (int)(int64_t)a[2], packedColor(a[3]),
		                 a.size() >= 5 ? packedColor(a[4]) : 0u); return {}; });
	XenonCode::DeclareDeviceFunction("draw_poly($c:number,$x:number,$y:number)", [ms](Computer*, const vector<Var>& a) -> Var {
		vector<int> pts;
		for (size_t i = 1; i + 1 < a.size(); i += 2)
			pts.push_back((int)(int64_t)a[i]), pts.push_back((int)(int64_t)a[i + 1]);
		ms()->DrawPoly(packedColor(a[0]), pts); return {}; });
	XenonCode::DeclareDeviceFunction("pixel($x:number,$y:number):number", [ms](Computer*, const vector<Var>& a) -> Var {
		int x = (int)(int64_t)a[0], y = (int)(int64_t)a[1];
		XenonScreen* s = ms();
		if (x < 0 || y < 0 || x >= (int)s->GetWidth() || y >= (int)s->GetHeight()) return 0.0;
		return (double)s->GetPixel(x, y); });
	XenonCode::DeclareDeviceFunction("button_rect($x:number,$y:number,$w:number,$h:number,$c:number):number",
		[ms, msSlot](Computer*, const vector<Var>& a) -> Var {
		int x = (int)(int64_t)a[0], y = (int)(int64_t)a[1], w = (int)(int64_t)a[2], h = (int)(int64_t)a[3];
		ms()->DrawRect(x, y, x + w, y + h, packedColor(a[4]));
		return xc_buttonHit(msSlot(), x, y, w, h) ? 1.0 : 0.0; });
	XenonCode::DeclareDeviceFunction("button($x:number,$y:number,$c:number,$w:number,$h:number):number",
		[ms, msSlot](Computer*, const vector<Var>& a) -> Var {
		int x = (int)(int64_t)a[0], y = (int)(int64_t)a[1], w = (int)(int64_t)a[3], h = (int)(int64_t)a[4];
		ms()->DrawRect(x, y, x + w, y + h, packedColor(a[2]));
		return xc_buttonHit(msSlot(), x, y, w, h) ? 1.0 : 0.0; });
	XenonCode::DeclareDeviceFunction("draw($x:number,$y:number,$c:number,$w:number,$h:number)", [ms](Computer*, const vector<Var>& a) -> Var {
		int x = (int)(int64_t)a[0], y = (int)(int64_t)a[1], w = (int)(int64_t)a[3], h = (int)(int64_t)a[4];
		ms()->DrawRect(x, y, x + w, y + h, packedColor(a[2]));
		return {}; });
	XenonCode::DeclareDeviceFunction("clicked:number", [](Computer*, const vector<Var>&) -> Var {
		return g_anyClicked ? 1.0 : 0.0; });
	XenonCode::DeclareDeviceFunction("click_x:number", [](Computer*, const vector<Var>&) -> Var {
		return (double)g_anyClickX; });
	XenonCode::DeclareDeviceFunction("click_y:number", [](Computer*, const vector<Var>&) -> Var {
		return (double)g_anyClickY; });
	XenonCode::DeclareDeviceFunction("char_w:number", [ms](Computer*, const vector<Var>&) -> Var {
		return (double)ms()->GetCharWidth(); });
	XenonCode::DeclareDeviceFunction("char_h:number", [ms](Computer*, const vector<Var>&) -> Var {
		return (double)ms()->GetCharHeight(); });
	XenonCode::DeclareDeviceFunction("screen_w:number", [ms](Computer*, const vector<Var>&) -> Var {
		return (double)ms()->GetWidth(); });
	XenonCode::DeclareDeviceFunction("screen_h:number", [ms](Computer*, const vector<Var>&) -> Var {
		return (double)ms()->GetHeight(); });
	// virtualscreen(w, h) — code-created off-screen buffer (computer.md
	// "Virtual Screen Function", cap 10000x10000 in game — WE MATCH THE GAME
	// CAP NOW: Chip's Mario skins its whole sprite atlas through a
	// virtualscreen(10000, 600); our old 4096 cap truncated the atlas and
	// every sprite past x=4096 smeared on screen — "when we get far in a
	// level, things get smeared"). 96 buffers as the POC's memory guard.
	XenonCode::DeclareDeviceFunction("virtualscreen:screen", [](Computer*, const vector<Var>& a) -> Var {
		uint32_t w = (uint32_t)clamp((int64_t)a[0], (int64_t)1, (int64_t)10000);
		uint32_t h = (uint32_t)clamp((int64_t)a[1], (int64_t)1, (int64_t)10000);
		int i = xc_addScreen("virtual#" + to_string(g_nextVirtual++), 0, w, h);
		return Var(screenType, reinterpret_cast<uint64_t>(g_screens[i].scr.get()));
	});
	// screen_copy(src, dst, sx, sy, dx, dy, w, h [, tint, rotation, bilinear])
	// — the sprite-copy fast path (the Badger's attitude-display atlas uses
	// rotation + bilinear). Overload pattern: widest declaration, the three
	// optional args are read by runtime arity.
	XenonCode::DeclareDeviceFunction("screen_copy", [](Computer*, const vector<Var>& a) -> Var {
		XenonScreen* s = Scr(a[0]);                 // PATCH-safety: a rebooted VM's
		XenonScreen* d = Scr(a[1]);                 // $screens restart at 0 — no-op
		if (!s || !d) return {};
		int sx = (int)(int64_t)a[2], sy = (int)(int64_t)a[3];
		int dx = (int)(int64_t)a[4], dy = (int)(int64_t)a[5];
		int w = (int)(int64_t)a[6], h = (int)(int64_t)a[7];
		int64_t tint = a.size() >= 9 ? (int64_t)a[8] : -1;
		double rot = a.size() >= 10 ? (double)a[9] : 0.0;
		bool bil = a.size() >= 11 ? (double)a[10] != 0 : false;
		auto get = [s](int x, int y) -> uint32_t {
			if (x < 0 || y < 0 || x >= (int)s->GetWidth() || y >= (int)s->GetHeight()) return 0u;
			const uint8_t* p = s->data() + ((size_t)y * s->GetWidth() + x) * 4;
			uint32_t v; memcpy(&v, p, 4); return v;
		};
		double rad = rot * 3.14159265358979 / 180.0;
		// INTEGER-BLIT FAST PATH (v1.13.4 perf, we: "Mario runs quite slow
		// on the pixel phone"): with rot == 0 the bilinear sample grid is
		// the integer grid — the 4-sample float blend collapses to a plain
		// row copy. Mario blits thousands of sprite pixels per cycle; the
		// per-pixel float blend dominated the VM cycle (20 cycles/s on
		// desktop, 11 on a throttled ≈ phone CPU).
		if (rot == 0.0) {
			const uint32_t* sdat = reinterpret_cast<const uint32_t*>(s->data());
			uint32_t* ddat = reinterpret_cast<uint32_t*>(d->data());
			for (int j = 0; j < h; ++j) {
				int yy = sy + j; if (yy < 0 || yy >= (int)s->GetHeight()) continue;
				int dyY = dy + j; if (dyY < 0 || dyY >= (int)d->GetHeight()) continue;
				const uint32_t* srow = sdat + (size_t)yy * s->GetWidth();
				uint32_t* drow = ddat + (size_t)dyY * d->GetWidth();
				int i0 = 0, i1 = w;
				if (dx + i0 < 0) i0 = -(dx + i0);
				if (dx + i1 > (int)d->GetWidth()) i1 = (int)d->GetWidth() - dx;
				int j0 = 0, j1 = h;   // clamp source x too
				(void)j0; (void)j1;
				for (int i = i0; i < i1; ++i) {
					int xx = sx + i; if (xx < 0 || xx >= (int)s->GetWidth()) continue;
					uint32_t p = srow[xx];
					if (tint >= 0) {
						uint32_t t = uint32_t(tint);
						for (int sh2 = 0; sh2 < 24; sh2 += 8)
							p = (p & ~(255u << sh2))
							    | (((((p >> sh2) & 255) * ((t >> sh2) & 255)) >> 8) << sh2);
					} else if (!p) {
						continue;                      // transparent source pixel
					}
					drow[dx + i] = p;
				}
			}
			d->Dirty();
			return {};
		}
		double cs = cos(rad), sn = sin(rad);
		double cx = w / 2.0, cy = h / 2.0;
		for (int j = 0; j < h; ++j) {
			for (int i = 0; i < w; ++i) {
				// rotate the destination pixel back into source space
				double ox = i - cx, oy = j - cy;
				int u, v2;
				if (bil) {
					// bilinear: sample 4 neighbours and blend
					double fx = ox * cs + oy * sn + cx + sx;
					double fy = -ox * sn + oy * cs + cy + sy;
					int x0 = (int)floor(fx), y0 = (int)floor(fy);
					double ax = fx - x0, ay = fy - y0;
					uint32_t p00 = get(x0, y0), p10 = get(x0 + 1, y0),
					           p01 = get(x0, y0 + 1), p11 = get(x0 + 1, y0 + 1);
					auto ch = [](uint32_t p, int sh) { return double((p >> sh) & 255); };
					uint32_t out = 0, sh = 0;
					for (; sh < 32; sh += 8) {
						double t = (ch(p00, sh) * (1 - ax) + ch(p10, sh) * ax) * (1 - ay)
						         + (ch(p01, sh) * (1 - ax) + ch(p11, sh) * ax) * ay;
						out |= uint32_t(t + 0.5) << sh;
					}
					u = dx + i; v2 = dy + j;
					if (u < 0 || v2 < 0 || u >= (int)d->GetWidth() || v2 >= (int)d->GetHeight()) continue;
					if (tint >= 0) {
						uint32_t t = uint32_t(tint);
						for (int sh2 = 0; sh2 < 24; sh2 += 8)
							out = (out & ~(255u << sh2))
							      | (((((out >> sh2) & 255) * ((t >> sh2) & 255)) >> 8) << sh2);
					}
					memcpy(d->data() + ((size_t)v2 * d->GetWidth() + u) * 4, &out, 4);
					d->Dirty();
					continue;
				}
				u = int(ox * cs + oy * sn + cx + sx);
				v2 = int(-ox * sn + oy * cs + cy + sy);
				uint32_t p = get(u, v2);
				int ddx = dx + i, ddy = dy + j;
				if (!p && tint < 0) continue;                       // transparent source pixel
				if (d->GetPixel(ddx, ddy) && !p && tint < 0) continue;
				if (tint >= 0) {
					uint32_t t = uint32_t(tint);
					for (int sh2 = 0; sh2 < 24; sh2 += 8)
						p = (p & ~(255u << sh2))
						    | (((((p >> sh2) & 255) * ((t >> sh2) & 255)) >> 8) << sh2);
				}
				if (ddx < 0 || ddy < 0 || ddx >= (int)d->GetWidth() || ddy >= (int)d->GetHeight()) continue;
				memcpy(d->data() + ((size_t)ddy * d->GetWidth() + ddx) * 4, &p, 4);
				d->Dirty();
			}
		}
		return {};
	});
	XenonCode::DeclareDeviceFunction("input_number:number", [](Computer*, const vector<Var>& a) -> Var {
		int io = xc_ioOf(a[0]), ch = (int)(int64_t)a[1];
		if (io < 0) { g_reads[{0, ch}] = 0.0; return 0.0; }   // unknown alias: 0, game-quiet
		auto i = xc_inputs.find(io);
		double v = 0.0;
		if (i != xc_inputs.end()) {
			auto c = i->second.find(ch);
			if (c != i->second.end()) v = c->second;
		}
		g_reads[{io, ch}] = v;      // the IDE's node cards show REAL reads
		return v;
	});
	XenonCode::DeclareDeviceFunction("input_text:text", [](Computer*, const vector<Var>& a) -> Var {
		int io = xc_ioOf(a[0]), ch = (int)(int64_t)a[1];
		if (io < 0) return string();
		auto t = xc_inputs_txt.find(io);
		if (t != xc_inputs_txt.end()) {
			auto tc = t->second.find(ch);
			if (tc != t->second.end()) return tc->second;          // seeded text channel
		}
		auto i = xc_inputs.find(io);
		if (i == xc_inputs.end()) return string();
		auto c = i->second.find(ch);
		if (c == i->second.end()) return string();
		ostringstream s; s << c->second;
		return s.str();
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
	// computer.md built-in VALUES (value-position device functions)
	XenonCode::DeclareDeviceFunction("tick:number", [](Computer*, const vector<Var>&) -> Var {
		return (double)xc_tickCount;
	});
	XenonCode::DeclareDeviceFunction("system_frequency:number", [](Computer*, const vector<Var>&) -> Var {
		return 1.0 / xc_dt;                         // our pump cadence (v1.13.2:
	});                                           // follows xc_set_cycle_ms
	XenonCode::DeclareDeviceFunction("system_ram:number", [](Computer*, const vector<Var>&) -> Var {
		return 65536.0;
	});
	XenonCode::DeclareDeviceFunction("system_ipc:number", [](Computer*, const vector<Var>&) -> Var {
		return 0.0;                                 // 0 = unlimited (POC)
	});
	XenonCode::DeclareDeviceFunction("ipc:number", [](Computer*, const vector<Var>&) -> Var {
		return 0.0;
	});
	XenonCode::DeclareDeviceFunction("programs_count:number", [](Computer*, const vector<Var>&) -> Var {
		return (double)g_programCount;
	});
	// "user" and "owner" (the board-button example: player usernames)
	XenonCode::DeclareDeviceFunction("user:text", [](Computer*, const vector<Var>&) -> Var {
		return Var(string("builder"));
	});
	XenonCode::DeclareDeviceFunction("owner:text", [](Computer*, const vector<Var>&) -> Var {
		return Var(string("builder"));
	});
	XenonCode::DeclareDeviceFunction("username:text", [](Computer*, const vector<Var>&) -> Var {
		return Var(string("builder"));
	});
	// colour channel extractors (the wiki's colour helpers)
	XenonCode::DeclareDeviceFunction("color_r:number", [](Computer*, const vector<Var>& a) -> Var {
		return (double)((uint32_t)(uint64_t)a[0] & 255);
	});
	XenonCode::DeclareDeviceFunction("color_g:number", [](Computer*, const vector<Var>& a) -> Var {
		return (double)(((uint32_t)(uint64_t)a[0] >> 8) & 255);
	});
	XenonCode::DeclareDeviceFunction("color_b:number", [](Computer*, const vector<Var>& a) -> Var {
		return (double)(((uint32_t)(uint64_t)a[0] >> 16) & 255);
	});
	XenonCode::DeclareDeviceFunction("color_a:number", [](Computer*, const vector<Var>& a) -> Var {
		return (double)(((uint32_t)(uint64_t)a[0] >> 24) & 255);
	});
	// program control (POC: the loaded program IS the running one)
	XenonCode::DeclareDeviceFunction("program_name:text", [](Computer*, const vector<Var>&) -> Var {
		return Var(string("main"));
	});
	XenonCode::DeclareDeviceFunction("load_program", [](Computer*, const vector<Var>&) -> Var {
		xc_eventLog.push_back("{\"e\":\"print\",\"v\":\"load_program: POC no-op\"}");
		return {};
	});
	XenonCode::DeclareDeviceFunction("reboot", [](Computer*, const vector<Var>&) -> Var {
		xc_eventLog.push_back("{\"e\":\"print\",\"v\":\"reboot: POC no-op\"}");
		return {};
	});
	XenonCode::DeclareDeviceFunction("game_mode:number", [](Computer*, const vector<Var>&) -> Var {
		return 0.0; // Creative
	});
	XenonCode::DeclareDeviceFunction("color:number", [](Computer*, const vector<Var>& a) -> Var {
		int alpha = a.size() >= 4 ? (int)(int64_t)a[3] : 255;   // color(r,g,b,a) (screen.xc)
		return (double)XENONCODE_COLOR((int)(int64_t)a[0], (int)(int64_t)a[1], (int)(int64_t)a[2], alpha);
	});
	// crafting/item table reads (archean.md "Crafting Recipes") — the POC has
	// no world economy: honest empty/label answers (the app's economy.json is
	// the real table if a future host wants it)
	XenonCode::DeclareDeviceFunction("get_recipes_categories:text", [](Computer*, const vector<Var>&) -> Var {
		return Var(string(""));
	});
	XenonCode::DeclareDeviceFunction("get_recipes:text", [](Computer*, const vector<Var>&) -> Var {
		return Var(string(""));
	});
	XenonCode::DeclareDeviceFunction("get_recipe:text", [](Computer*, const vector<Var>&) -> Var {
		return Var(string(""));
	});
	XenonCode::DeclareDeviceFunction("get_recipe_label:text", [](Computer*, const vector<Var>& a) -> Var {
		string s = string(a[0]);
		auto dot = s.find('.');
		return Var(dot == string::npos ? s : s.substr(dot + 1));
	});
	XenonCode::DeclareDeviceFunction("get_item_value_unit:text", [](Computer*, const vector<Var>& a) -> Var {
		string s = string(a[0]);
		auto dot = s.find('.');
		if (dot != string::npos) s = s.substr(dot + 1);
		for (auto& c : s) if (c == '_') c = ' ';
		ostringstream out;
		out << s << " " << (double)a[1];
		return Var(out.str());
	});
	XenonCode::DeclareDeviceFunction("setworldsim:number", [](Computer*, const vector<Var>& a) -> Var {
		string n = xc_lower(string(a[0]));
		double v = a.size() >= 2 ? (double)a[1] : 0.0;
		if (v >= 1e30) g_wsProgram.erase(n);   // release: the expression resumes
		else g_wsProgram[n] = v;
		return v;
	});
	XenonCode::DeclareDeviceFunction("getworldsim:number", [](Computer*, const vector<Var>& a) -> Var {
		string n = xc_lower(string(a[0]));
		auto i = g_wsEffective.find(n);
		if (i != g_wsEffective.end()) return i->second;
		auto p = g_wsProgram.find(n);
		return p != g_wsProgram.end() ? p->second : 0.0;
	});
	// device values the built-in programs read (crafter touchscreen logic):
	// progress = current craft progress 0..1, fluid_level = connected tank
	// level; the craft verbs are recorded as bus events (the game runs them
	// on the craft, we simulate the io contract).
	XenonCode::DeclareDeviceFunction("progress:number", [](Computer*, const vector<Var>&) -> Var { return 0.0; });
	XenonCode::DeclareDeviceFunction("fluid_level:number", [](Computer*, const vector<Var>&) -> Var { return 0.0; });
	XenonCode::DeclareDeviceFunction("cancel_craft", [](Computer*, const vector<Var>&) -> Var {
		xc_eventLog.push_back("{\"e\":\"out\",\"io\":\"crafter\",\"port\":2,\"v\":0}");
		return {};
	});
	XenonCode::DeclareDeviceFunction("start_craft", [](Computer*, const vector<Var>& a) -> Var {
		xc_eventLog.push_back("{\"e\":\"out\",\"io\":\"crafter\",\"port\":0,\"v\":\"" + xc_jsonEscape(string(a[0])) + "\"}");
		return {};
	});
	XenonCode::DeclareDeviceFunction("enough_power:number", [](Computer*, const vector<Var>&) -> Var { return 1.0; });
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

// End of one cycle (both runners): the program body has SEEN this cycle's
// click (button_rect + the clicked/click_x/click_y built-ins), so deliver
// the click/scroll entry points (computer.md: per-screen with the surface as
// ref — `click.$screen`; plain for the integrated screen), report the
// input_number reads this cycle as "in" events (the IDE's node cards show
// the values a program ACTUALLY read), then clear the per-cycle input state.
static void xc_endCycle(Computer& computer) {
	for (auto& s : g_screens) {
		if (!s.clicked) continue;
		Var ref(screenType, reinterpret_cast<uint64_t>(s.scr.get()));
		std::vector<Var> args{Var((double)s.clickX), Var((double)s.clickY)};
		computer.RunEntryPoint("click", ref, args);
		computer.RunEntryPoint("click_hold", ref, args);
	}
	if (g_anyClicked) {
		std::vector<Var> args{Var((double)g_anyClickX), Var((double)g_anyClickY)};
		computer.RunEntryPoint("click", {}, args);
		computer.RunEntryPoint("click_hold", {}, args);
	}
	for (auto& s : g_screens) {
		if (!s.scroll) continue;
		Var ref(screenType, reinterpret_cast<uint64_t>(s.scr.get()));
		std::vector<Var> args{Var(s.scroll)};
		computer.RunEntryPoint("scroll", ref, args);
	}
	if (g_anyScroll) {
		std::vector<Var> args{Var(g_anyScroll)};
		computer.RunEntryPoint("scroll", {}, args);
	}
	for (auto&[k, v] : g_reads) {
		ostringstream s; s << v;
		xc_eventLog.push_back("{\"e\":\"in\",\"io\":" + to_string(k.first)
		                    + ",\"port\":" + to_string(k.second) + ",\"v\":" + s.str() + "}");
	}
	g_reads.clear();
	for (auto& s : g_screens) { s.clicked = false; s.scroll = 0.0; }
	g_anyClicked = false; g_anyClickY = g_anyClickX = 0; g_anyScroll = 0.0;
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

	auto computer = make_unique<Computer>();      // fresh object per boot, like xc_boot
	computer->capability.ram = xc_ramCap;
	computer->capability.storage = xc_storageCap;
	if (!computer->LoadProgram(dir)) { cerr << "[xc] load failed" << endl; return 3; }
	Computer::DebugTrack(true);   // native: lines.json snapshot at cycle 5 (debugger triage)
	computer->LoadStorage(dir + "/storage");
	xc_addScreen("main", 0, 640, 480);
	for (auto& s : g_screens) s.scr->Blank();
	const double dial = getenv("XC_DIAL") ? atof(getenv("XC_DIAL")) : 0.0;
	xc_inputs[1][7] = dial;   // the hello program's externally provided numer
	bool realtime = getenv("XC_FAST") == nullptr;   // timers run on the real clock
	try {
		computer->RunInit();
		for (int c = 0; c < cycles; ++c) {
			xc_simTime += xc_dt;
			xc_tickCount++;
			pilotAtCycle(c);
			xc_eventLog.push_back("{\"e\":\"cycle\",\"c\":" + to_string(c) + "}");
			if (c == 10 && getenv("XC_REBOOT")) { // mid-run reboot (the Badger's strict-off state)
				computer->SaveStorage(dir + "/storage");
				computer = make_unique<Computer>();
				computer->capability.ram = xc_ramCap;
				computer->capability.storage = xc_storageCap;
				if (!computer->LoadProgram(dir)) { cerr << "[xc] reboot reload failed" << endl; return 3; }
				if (!getenv("XC_REBOOT_NOSTORE")) computer->LoadStorage(dir + "/storage");
			}
			computer->RunCycle();                // tick + timers
			computer->RunEntryPoint("update");   // the computer device's cycle end
			xc_endCycle(*computer);               // click/scroll events + input reads
			if (c == 5) {
				auto ls = Computer::DebugTakeLines();
				ofstream lf("lines.json");
				lf << "[";
				for (size_t i = 0; i < ls.size(); ++i) { if (i) lf << ","; lf << ls[i]; }
				lf << "]\n";
			}
			if (realtime) this_thread::sleep_for(chrono::milliseconds(100));
		}
	} catch (XenonCode::RuntimeError& e) {
		cerr << "[xc] RUNTIME ERROR: " << e.what() << endl;
		return 4;
	}
	computer->SaveStorage(dir + "/storage");
	{ std::ofstream vf("vars.json"); vf << computer->DumpVarsJson(); }
	cout << "[xc] vars.json written (XENON-VARS)" << endl;

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
#include <iterator>
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
	{ std::error_code ec; g_programCount = (int)std::distance(
		std::filesystem::directory_iterator("/prog", ec), std::filesystem::directory_iterator()); }
	try {
		auto mainFile = XenonCode::GetParsedFile("/prog", "main.xc");
		if (!Computer::CompileAssembly("/prog", mainFile.lines, false)) { g_err = "compile failed"; return 1; }
		g_computer = make_unique<Computer>();
		g_computer->capability.ram = xc_ramCap;
		g_computer->capability.storage = xc_storageCap;
		g_wsProgram.clear(); g_wsEffective.clear();
		// THE REBOOT LAW (we: "it doesnt clear the virtual screens, that it
		// needs to"): the VM's runtime world dies with the VM - VIRTUAL
		// screens (virtualscreen() buffers) are destroyed and the naming
		// counter restarts (the program re-creates them in vars_init, the
		// game's behaviour); the PHYSICAL surfaces (the craft's registered
		// dashboards/screens) are hardware: they persist, blanked. External
		// io values and the per-cycle read reports are the VM's world too.
		for (auto it = g_screens.begin(); it != g_screens.end();) {
			if (it->key.rfind("virtual#", 0) == 0) {
				g_slotByPtr.erase(it->scr.get());
				it = g_screens.erase(it);
			} else ++it;
		}
		g_nextVirtual = 0;
		xc_inputs.clear();
		xc_inputs_txt.clear();
		g_reads.clear();
		if (!g_computer->LoadProgram("/prog")) { g_err = "load failed"; return 1; }
		g_computer->LoadStorage("/prog/storage");   // survives reboots in-session
		for (auto& s : g_screens) { s.scr->Blank(); s.clicked = false; s.scroll = 0.0; }
		g_reads.clear();
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
	// REAL-TIME dt (v1.13.4, we: "Mario runs quite slow on the pixel
	// phone"): a slow CPU drops the cycles/s BELOW the pump's 25 Hz —
	// with a fixed dt the game then advances in SLOW MOTION. Feed the
	// interpreter the real interval between cycles instead (clamped to
	// the game's own clamp so a stalled tab cannot teleport sprites);
	// a 25 Hz pump keeps the fixed 40 ms cadence anyway.
	{
		static double lastNow = -1.0;
		const double now = emscripten_get_now();
		if (lastNow > 0) {
			double d = (now - lastNow) / 1000.0;
			if (d > 0.12) d = 0.12;
			if (d < 0.001) d = 0.001;
			xc_dt = d;
		}
		lastNow = now;
	}
	xc_simTime += xc_dt;
	xc_tickCount++;
	if (g_pilotScripted) pilotAtCycle(g_cycle);
	++g_cycle;
	xc_eventLog.push_back("{\"e\":\"cycle\",\"c\":" + to_string(g_cycle - 1) + "}");
	try {
		g_computer->RunCycle();
		g_computer->RunEntryPoint("update");
		xc_endCycle(*g_computer);            // click/scroll entry points + reads
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
// the IDE's VARIABLES panel: JSON of the program's global variables
// [{name, t (CODE_TYPE), v (string)}] — live RAM + the storage cache
static string g_varsJson;
EMSCRIPTEN_KEEPALIVE const char* xc_vars() {
	g_varsJson = g_computer ? g_computer->DumpVarsJson() : "[]";
	return g_varsJson.c_str();
}
// XENON-DEBUG: line-tracking switch + the lines executed since the last
// drain (the pump pauses the cycle that TOUCHED a breakpoint line)
EMSCRIPTEN_KEEPALIVE void xc_debug_track(int on) { Computer::DebugTrack(on); }
static string g_linesJson;
EMSCRIPTEN_KEEPALIVE const char* xc_cycle_lines() {
	g_linesJson = "[";
	auto v = Computer::DebugTakeLines();
	for (size_t i = 0; i < v.size(); ++i) { if (i) g_linesJson += ","; g_linesJson += std::to_string(v[i]); }
	g_linesJson += "]";
	return g_linesJson.c_str();
}
// XENON-DEBUG v2 (ABI 6): the EXECUTION-ORDER (file * 1000000 + line) pair
// stream — the debugger steps lines by walking this list, breakpoints stop
// AT the first executed pair. Order preserved (no sort, no unique).
static string g_pairsJson;
EMSCRIPTEN_KEEPALIVE const char* xc_cycle_pairs() {
	g_pairsJson = "[";
	auto v = Computer::DebugTakePairs();
	for (size_t i = 0; i < v.size(); ++i) { if (i) g_pairsJson += ","; g_pairsJson += std::to_string(v[i]); }
	g_pairsJson += "]";
	return g_pairsJson.c_str();
}
// XENON-DEBUG v2 stop-hook seam (the interpreter calls this at each
// executed line when tracking). v1.13.17 TRUE LINE STEPPING: under
// Emscripten the hook is an EM_JS — the STEP LAW below runs in JS and on a
// stop SLEEPS IN PLACE (Atomics.wait on the SharedArrayBuffer handed in as
// Module.XC_SAB by the worker host). The worker thread freezes mid-update
// with the interpreter's C++ stack intact (function locals, nested @call
// frames survive); the MAIN thread stays fully alive: UI paints, keys
// respond, and the next F10/F8 lands as an Atomics.notify that wakes the
// exact line. Native runner + main-thread page hosts: Module.XC_SAB is
// absent and the hook is inert — the pair stream remains the channel.
//
// i32 layout on the SharedArrayBuffer (the app's XenonWorkerRun is the
// other end; library_xc.js documents the protocol):
//   0 cmd main->worker: 0 none 1 over 2 into 3 runTo 4 resume 5 pause
//   1 state worker->main: 0 running 1 PAUSED
//   2 paused file idx  3 paused line  4 reason 1 bp 2 step 3 cursor 4 pause
//   5/6 ref pair (over/into)   7/8 over body range (lo>hi = top level)
//   9/10 runTo target          11 bp count, 12.. (file,line) pairs (max 64)
#ifdef __EMSCRIPTEN__
EM_JS(void, xc_hook_js, (int file, int line), {
  var M = (typeof Module !== 'undefined') ? Module : null;
  if (!M) return;
  var H = M.__xcHook;
  if (!H) {
    if (!M.XC_SAB) return;                       // main-thread host: inert
    H = M.__xcHook = { i32: new Int32Array(M.XC_SAB) };
  }
  var i = H.i32;
  var cmd = Atomics.load(i, 0);
  if (cmd === 4) { Atomics.store(i, 0, 0); Atomics.store(i, 1, 0); }
  var reason = 0;
  if (cmd === 5) reason = 4;
  else if (cmd === 1) {                          // step OVER
    if (!(file === i[5] && line === i[6])) {
      var inScope = file === i[5] && i[7] <= i[8] && line >= i[7] && line <= i[8];
      if (!inScope) reason = 2;
    }
  } else if (cmd === 2) {                        // step INTO
    if (!(file === i[5] && line === i[6])) reason = 2;
  } else if (cmd === 3) {                        // run to cursor
    if (file === i[9] && line === i[10]) reason = 3;
  }
  if (!reason) {                                 // breakpoints
    var n = Math.min(64, i[11] | 0);
    for (var k = 0; k < n; k++)
      if (i[12 + 2 * k] === file && i[13 + 2 * k] === line) { reason = 1; break; }
  }
  if (!reason) return;
  Atomics.store(i, 0, 0);                        // consume the command
  i[2] = file; i[3] = line; i[4] = reason;
  Atomics.store(i, 1, 1);                        // PAUSED —
  Atomics.notify(i, 1);
  for (;;) {
    Atomics.wait(i, 0, 0, 100000000);            // sleep IN PLACE: the whole
    if (Atomics.load(i, 0) !== 0) break;         // interpreter stack parks
  }                                             // right here
  var c = Atomics.load(i, 0);
  Atomics.store(i, 1, 0);
  if (c === 4) Atomics.store(i, 0, 0);           // resume consumed; a step
  Atomics.notify(i, 1);                          // command stays PENDING
});
#endif
extern "C" void xc_debug_hook(int file, int line) {
#ifdef __EMSCRIPTEN__
  xc_hook_js(file, line);
#else
  (void)file; (void)line;
#endif
}
EMSCRIPTEN_KEEPALIVE const char* xc_error() { return g_err.c_str(); }
EMSCRIPTEN_KEEPALIVE void xc_set_input(int io, int ch, double v) { xc_inputs[io][ch] = v; }
// the panel drives an ALIAS-addressed channel (same resolution as xc_ioOf)
EMSCRIPTEN_KEEPALIVE void xc_set_input_a(const char* alias, int ch, double v) {
	auto i = g_devByAlias.find(xc_lower(alias));
	if (i == g_devByAlias.end()) return;
	const DevInfo& d = g_devs[i->second];
	xc_inputs[d.port >= 0 ? d.port : 1000 + d.id][ch] = v;
}
// The IDE's screen canvases route user interaction in (pixel coords of the
// surface). The click is visible to button_rect/button and the clicked
// built-ins for ONE cycle, then cleared by xc_endCycle.
EMSCRIPTEN_KEEPALIVE void xc_screen_click(int idx, double x, double y) {
	xc_clickAt(idx < 0 ? SIZE_MAX : (size_t)idx, (int)x, (int)y);
}
EMSCRIPTEN_KEEPALIVE void xc_screen_scroll(int idx, double delta) {
	if (idx < 0 || idx >= (int)g_screens.size()) return;
	g_screens[idx].scroll += delta;
	g_anyScroll += delta;
}
EMSCRIPTEN_KEEPALIVE int xc_screen_index(const char* key) { return xc_indexOf(key); }
EMSCRIPTEN_KEEPALIVE void xc_save_storage() { if (g_computer) g_computer->SaveStorage("/prog/storage"); }
EMSCRIPTEN_KEEPALIVE void xc_pilot_script(int on) { g_pilotScripted = on; }

// ---- screen registry (the craft's Screen/HdScreen surfaces) ---------------
EMSCRIPTEN_KEEPALIVE void xc_reset_screens() {
	g_screens.clear(); g_slotByPtr.clear(); g_nextVirtual = 0;
}
EMSCRIPTEN_KEEPALIVE int xc_add_screen(const char* alias, int ch, uint32_t w, uint32_t h) {
	return xc_addScreen(alias, ch, w, h);
}
// component table (call after xc_reset_devices, before xc_boot)
EMSCRIPTEN_KEEPALIVE void xc_reset_devices() {
	g_devs.clear(); g_devByIo.clear(); g_devByAlias.clear();
	// a fresh open owns a fresh world: external io values, the seeded
	// texts, the per-cycle read reports and the worldsim feeds are the
	// device's runtime state - they reset with it (the re-open path leaves
	// NOTHING of the previous session but the storage dir, the game's rule)
	xc_inputs.clear(); xc_inputs_txt.clear(); g_reads.clear();
	g_wsProgram.clear(); g_wsEffective.clear();
}
// capability from the blueprint (hdd capacity = the game's storage limit);
// RAM: the POC is generous (the game's XPU64 spec is not in the files)
EMSCRIPTEN_KEEPALIVE void xc_set_capability(uint32_t ram, uint32_t storage) {
	if (ram) xc_ramCap = ram;
	if (storage) xc_storageCap = storage;
}
static void xc_seedWorld(const DevInfo& d) {
	if (d.port >= 0) return;              // cabled devices: the sliders are the source
	int io = 1000 + d.id;
	string t = xc_lower(d.type);
	auto seed = [&](int ch, double v) { xc_inputs[io][ch] = v; };
	auto seedT = [&](int ch, const char* v) { xc_inputs_txt[io][ch] = v; };
	if (t == "mininavinstrument" || t == "navinstrument") {
		seed(0, 12); seed(1, 0); seed(2, 1450); seed(3, 1450);       // airspd, vs, alt, terr
		seed(6, 42); seed(7, 42);                                     // heading, course
		seed(8, 51.5); seed(9, -0.1);                                 // lat, lon
		seed(13, 1); seedT(13, "EARTH"); seedT(0, "EARTH");           // Celestial
		seed(17, 6.6e6); seed(18, 6.7e6);                             // peri, apo
	} else if (t == "dockingport" || t == "groundanchor") {
		seed(0, 1);                                                   // present/latched
	} else if (t == "angularvelocitysensor") {
		seed(0, 0.01); seed(1, 0.01); seed(2, 0.01);
	} else if (t == "densitysensor") { seed(0, 1.225); }
	else if (t == "solarsensor") { seed(0, 0.9); }
	else if (t == "temperaturesensor") { seed(0, 288); }
	else if (t == "speedsensor") { seed(0, 0); }
	else if (t == "vehiclephysicssensor") { seed(0, 0); }
	else if (t == "lowvoltagebattery" || t == "highvoltagebattery") { seed(0, 0.8); }
}

EMSCRIPTEN_KEEPALIVE void xc_add_device(int id, int io, const char* alias, const char* type,
                                        int port, double x, double y, double z,
                                        double sx, double sy, double sz, double mass) {
	int i = (int)g_devs.size();
	g_devs.push_back({ id, alias, type, port, x, y, z, sx, sy, sz, mass });
	if (io >= 0) g_devByIo[io] = i;
	string a = xc_lower(alias);
	if (!a.empty()) g_devByAlias[a] = i;
	xc_seedWorld(g_devs.back());
}
// worldsim bridge: the pump READS the program overrides each cycle, pushes
// the effective row values back, and clears the tables on a fresh boot.
static string g_wsJson;
EMSCRIPTEN_KEEPALIVE const char* xc_worldsim_overrides() {
	string s = "{";
	bool first = true;
	for (auto& kv : g_wsProgram) {
		if (!first) s += ",";
		first = false;
		s += "\"" + kv.first + "\":"; s += std::to_string(kv.second);
	}
	s += "}";
	g_wsJson = s;
	return g_wsJson.c_str();
}
EMSCRIPTEN_KEEPALIVE void xc_worldsim_sync(const char* name, double v) {
	g_wsEffective[xc_lower(name)] = v;
}
EMSCRIPTEN_KEEPALIVE void xc_worldsim_clear() { g_wsProgram.clear(); g_wsEffective.clear(); }

// ABI stamp: the app checks this at boot (XC_ABI in engine/xenoncode.ts) and
// warns ONCE on drift — new device/shim exports must bump it.
EMSCRIPTEN_KEEPALIVE int xc_abi() { return 7; }   // 7: the stop-hook is LIVE (library_xc.js + Module.XC_SAB worker stepping); 6: xc_cycle_pairs + hook seam; 5: xc_set_cycle_ms
EMSCRIPTEN_KEEPALIVE void xc_set_cycle_ms(int ms) {
	// the app's pump cadence (CYCLE_MS): delta_time / system_frequency
	// follow it, so dt-driven programs (Chip's Mario, physics on
	// clamp(delta_time,0,0.12)) run in real time at 25 Hz.
	if (ms > 0) xc_dt = ms / 1000.0;
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
