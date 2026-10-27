#!/usr/bin/env python3
# patch_xenon_vars.py — a documented patch on the pinned XenonCode checkout
# (build.sh applies it right after the lenient-numeric patch).
#
# WHY: the IDE's VARIABLES panel reads the RUNNING VM's global-scope
# variables (and the $var hover in the code). The open library keeps the
# compiler's name->slot map ("userVars", its own comment: "Temporary
# user-defined symbol maps") compile-time only, and Computer's RAM getters are
# private. Three small additions, all on the library's own data (names, slots,
# the storage-cache layout):
#   1) Implementation::globalVarDecls — an exported (name, type, slot) table,
#   2) declareVar RECORDS global-scope declarations into it (a fresh compile
#      clears it first),
#   3) Computer::DumpVarsJson() — a public JSON dump reading its own RAM
#      (numbers as strings) + the storage cache; KV text values ride verbatim
#      (the panel breaks them open).
import sys

path = sys.argv[1] if len(sys.argv) > 1 else 'upstream/XenonCode.hpp'
s = open(path).read()
orig = s

def one(old, new):
    global s
    assert s.count(old) == 1, f'anchor not unique/found: {old[:60]!r} (count {s.count(old)})'
    s = s.replace(old, new)

# 1) the exported table (struct Implementation)
one("""		static std::vector<std::string> entryPoints;
	};""",
"""		static std::vector<std::string> entryPoints;
		// PATCH XENON-VARS: exported table of global-scope variable
		// declarations (name, CODE_TYPE, slot) recorded by the compiler.
		struct GlobalVarDecl { std::string name; uint8_t type; uint32_t value; };
		static inline std::vector<GlobalVarDecl> globalVarDecls {};
	};""")

# 2) record global-scope declarations (declareVar)
one("""				ByteCode byteCode{uint8_t(type), index};
				if (name != "") {
					userVars[currentFunctionName][currentStackId].emplace(name, byteCode);
				}
				return byteCode;""",
"""				ByteCode byteCode{uint8_t(type), index};
				if (name != "") {
					userVars[currentFunctionName][currentStackId].emplace(name, byteCode);
				}
				// PATCH XENON-VARS: record global-scope declarations for the IDE
				if (name != "" && currentFunctionName == "" && stack.empty()) {
					Implementation::globalVarDecls.push_back({name, uint8_t(type), index});
				}
				return byteCode;""")

# 3a) a fresh compile starts a fresh table (CompileAssembly)
one("""			Assembly assembly(lines, verbose);""",
"""			Implementation::globalVarDecls.clear();   // PATCH XENON-VARS
			Assembly assembly(lines, verbose);""")

# 3b) the public dumper (Computer, next to IsLoaded)
one("""		bool IsLoaded() const {return assembly;}""",
"""		bool IsLoaded() const {return assembly;}
		
		// PATCH XENON-VARS: JSON dump of the program's GLOBAL variables for
		// the IDE — RAM rows read live (numbers as strings), STORAGE rows read
		// the storage cache; KV text values ride verbatim (the UI breaks them
		// open). Objects/arrays report an empty value (labels only).
		std::string DumpVarsJson() {
			auto esc = [](const std::string& in) {
				std::string o;
				for (char c : in) {
					if (c == '"') o += "\\\\\\"";
					else if (c == '\\\\') o += "\\\\\\\\";
					else if (c == '\\n') o += "\\\\n";
					else if ((unsigned char)c >= 32) o += c;
				}
				return o;
			};
			std::string out = "[";
			for (const auto& v : Implementation::globalVarDecls) {
				if (out.size() > 1) out += ",";
				out += "{\\"name\\":\\"" + esc(v.name) + "\\",\\"t\\":" + std::to_string((int)v.type) + ",\\"v\\":";
				switch (v.type) {
					case RAM_VAR_NUMERIC: {
						std::ostringstream s;
						s << MemGetNumeric(ByteCode{v.type, v.value});
						out += "\\"" + esc(s.str()) + "\\"";
						break;
					}
					case RAM_VAR_TEXT:
						out += "\\"" + esc(MemGetText(ByteCode{v.type, v.value}, ARRAY_INDEX_NONE)) + "\\"";
						break;
					case STORAGE_VAR_NUMERIC:
					case STORAGE_VAR_TEXT:
					case STORAGE_ARRAY_NUMERIC:
					case STORAGE_ARRAY_TEXT: {
						std::string nm = (assembly && v.value < assembly->storageRefs.size())
						               ? assembly->storageRefs[v.value] : v.name;
						auto it = storageCache.find(nm);
						out += "\\"" + esc(it != storageCache.end() && !it->second.empty() ? it->second[0] : "") + "\\"";
						break;
					}
					default:
						out += "\\"\\"";
				}
				out += "}";
			}
			return out + "]";
		}""")

if s != orig:
    open(path, 'w').write(s)
    print(f'XENON-VARS patch applied to {path}')
else:
    print(f'XENON-VARS patch already applied to {path}')
