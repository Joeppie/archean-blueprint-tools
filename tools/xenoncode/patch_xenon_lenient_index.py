#!/usr/bin/env python3
# patch_xenon_lenient_index.py — a documented patch on the pinned XenonCode
# checkout (build.sh applies it with the other two).
#
# WHY: the game's compiled binary treats an OUT-OF-RANGE text/array index as
# junk and returns a neutral value; the open library throws
# RuntimeError("Invalid array indexing"/"Invalid text indexing") and the VM
# dies mid-program. The first crack was stoll-on-junk (the lenient-numeric
# patch, v1.12.12 — "the Badger's first settings read"); this is the SAME
# CLASS one state deeper: Chip's Badger, rebooted on its OWN written storage,
# walks the strict-off path and settings.xc reads `$access_buffers.$side`
# (member index on a text var that starts EMPTY) — the game shows an empty
# field, the library crashed the computer (our repro: XC_REBOOT=1 native run
# of the Badger disk dies in standby-runtime.xc / settings.xc).
#
# LAW APPLIED (the game's observable behaviour, as with lenient-numeric):
#   GET  out-of-range array element / text char  -> 0.0 / ""
#   GET  empty storage scalar                    -> 0.0 / ""
#   SET  array index >= size                     -> GROW (the game's storage
#        arrays are built by indexed writes; pad with "0" / 0.0)
#   SET  text char index out of range            -> skip the write (no crash)
# Transformations are FUNCTION-SCOPED (signature -> closing brace) and every
# one asserts its site count, so an upstream bump fails loudly.
import re
import sys

path = sys.argv[1] if len(sys.argv) > 1 else 'upstream/XenonCode.hpp'
s = open(path).read()
orig = s
n = 0

def fn_slice(sig):
    """(start, end) of a member function whose slice ends at its 2-tab `}`."""
    i = s.index(sig)
    j = s.index('\n\t\t}\n', i)
    return i, j + 5

def xform(sig, pairs, label, min_n=1):
    """Apply (regex, repl) replacements inside the function slice."""
    global s, n
    i, j = fn_slice(sig)
    body = s[i:j]
    before = body
    hits = 0
    for pat, repl in pairs:
        body, c = re.subn(pat, repl, body)
        assert c >= 1, f'{label}: pattern hit 0: {pat[:60]!r}'
        hits += c
    assert body != before and hits >= min_n, f'{label}: no change'
    s = s[:i] + body + s[j:]
    n += hits

THROW_IDX = r'if \(([^)]+)\) \{\s*throw RuntimeError\("Invalid array indexing"\);\s*\}'
# the condition may contain balanced calls (utf8length(x)) — one nesting level
THROW_TXT = r'if \(((?:[^()]|\([^()]*\))*)\) \{\s*throw RuntimeError\("Invalid text indexing"\);\s*\}'

# GET storage: empty scalar / OOB element -> neutral
xform('double StorageGetNumeric(', [
    (r'if \(storage\.empty\(\)\) \{\s*throw RuntimeError\("Invalid array indexing"\);\s*\}\s*return ToDouble\(storage\[0\]\);',
     'if (storage.empty()) return 0.0;   // PATCH XENON-LENIENT-INDEX\n\t\t\t\treturn ToDouble(storage[0]);'),
    (r'if \(arrIndex >= storage\.size\(\)\) \{\s*throw RuntimeError\("Invalid array indexing"\);\s*\}\s*return ToDouble\(storage\[arrIndex\]\);',
     'if (arrIndex >= storage.size()) return 0.0;   // PATCH XENON-LENIENT-INDEX\n\t\t\t\treturn ToDouble(storage[arrIndex]);'),
], 'StorageGetNumeric')

xform('const std::string& StorageGetText(', [
    (r'auto& storage = GetStorage\(arr\);',
     'auto& storage = GetStorage(arr);\n\t\t\t// PATCH XENON-LENIENT-INDEX: empty/OOB text reads return "" (the Badger\'s\n\t\t\t// `$access_buffers.$side` on an unwritten text var is LEGAL in game)\n\t\t\tstatic const std::string xc_no_text;'),
    (r'if \(storage\.empty\(\)\) \{\s*throw RuntimeError\("Invalid array indexing"\);\s*\}\s*return storage\[0\];',
     'if (storage.empty()) return xc_no_text;\n\t\t\t\treturn storage[0];'),
    (r'if \(arrIndex >= storage\.size\(\)\) \{\s*throw RuntimeError\("Invalid array indexing"\);\s*\}\s*return storage\[arrIndex\];',
     'if (arrIndex >= storage.size()) return xc_no_text;\n\t\t\t\treturn storage[arrIndex];'),
], 'StorageGetText', min_n=3)

# SET storage: indexed writes GROW the array (the game builds arrays by index)
xform('void StorageSet(double value,', [
    (r'if \(arrIndex == ARRAY_INDEX_NONE\) \{\s*storage\[0\] = ToStringHighPrecision\(value\);',
     'if (arrIndex == ARRAY_INDEX_NONE) {\n\t\t\t\tif (storage.empty()) storage.emplace_back("0");   // PATCH XENON-LENIENT-INDEX\n\t\t\t\tstorage[0] = ToStringHighPrecision(value);'),
    (r'if \(arrIndex >= storage\.size\(\)\) \{\s*throw RuntimeError\("Invalid array indexing"\);\s*\}\s*storage\[arrIndex\] = ToStringHighPrecision\(value\);',
     'if (arrIndex >= storage.size()) storage.resize(arrIndex + 1, "0");   // PATCH XENON-LENIENT-INDEX\n\t\t\t\tstorage[arrIndex] = ToStringHighPrecision(value);'),
], 'StorageSet(double)')

xform('void StorageSet(const std::string& value,', [
    (r'if \(arrIndex == ARRAY_INDEX_NONE\) \{\s*storage\[0\] = value;',
     'if (arrIndex == ARRAY_INDEX_NONE) {\n\t\t\t\tif (storage.empty()) storage.emplace_back("");   // PATCH XENON-LENIENT-INDEX\n\t\t\t\tstorage[0] = value;'),
    (r'if \(arrIndex >= storage\.size\(\)\) \{\s*throw RuntimeError\("Invalid array indexing"\);\s*\}\s*storage\[arrIndex\] = value;',
     'if (arrIndex >= storage.size()) storage.resize(arrIndex + 1, "0");   // PATCH XENON-LENIENT-INDEX\n\t\t\t\tstorage[arrIndex] = value;'),
], 'StorageSet(string)')

# GET RAM numeric array: OOB -> 0.0
xform('double MemGetNumeric(', [
    (r'if \(__builtin_expect\(arrIndex == ARRAY_INDEX_NONE \|\| arrIndex >= arr\.size\(\), 0\)\) \{\s*throw RuntimeError\("Invalid array indexing"\);\s*\}\s*return arr\[arrIndex\];',
     'if (arrIndex == ARRAY_INDEX_NONE || arrIndex >= arr.size()) return 0.0;   // PATCH XENON-LENIENT-INDEX\n\t\t\t\t\treturn arr[arrIndex];'),
], 'MemGetNumeric')

# GET RAM text array: OOB -> ""
xform('std::string MemGetText(ByteCode ref, uint32_t arrIndex) {', [
    (r'if \(arrIndex == ARRAY_INDEX_NONE \|\| arrIndex >= arr\.size\(\)\) \{\s*throw RuntimeError\("Invalid array indexing"\);\s*\}\s*return arr\[arrIndex\];',
     'if (arrIndex == ARRAY_INDEX_NONE || arrIndex >= arr.size()) return std::string();   // PATCH XENON-LENIENT-INDEX\n\t\t\t\t\treturn arr[arrIndex];'),
    (THROW_TXT, r'if (\1) { return std::string(); }   // PATCH XENON-LENIENT-INDEX'),
], 'MemGetText', min_n=2)

# SET RAM arrays: grow; SET text chars: skip
xform('void MemSet(double value,', [
    (r'if \(__builtin_expect\(arrIndex == ARRAY_INDEX_NONE \|\| arrIndex >= arr\.size\(\), 0\)\) throw RuntimeError\("Invalid array indexing"\);\s*arr\[arrIndex\] = value;',
     'if (arrIndex == ARRAY_INDEX_NONE) break;\n\t\t\t\t\tif (arrIndex >= arr.size()) arr.resize(arrIndex + 1, 0.0);   // PATCH XENON-LENIENT-INDEX\n\t\t\t\t\tarr[arrIndex] = value;'),
], 'MemSet(double)')

xform('void MemSet(const std::string& value,', [
    (r'if \(arrIndex == ARRAY_INDEX_NONE\) \{\s*storage\[0\] = value;',
     'if (arrIndex == ARRAY_INDEX_NONE) {\n\t\t\t\t\tif (storage.empty()) storage.emplace_back("");   // PATCH XENON-LENIENT-INDEX (storage[0] on empty was UB)\n\t\t\t\t\tstorage[0] = value;'),
    (r'if \(arrIndex == ARRAY_INDEX_NONE \|\| arrIndex >= arr\.size\(\)\) \{\s*throw RuntimeError\("Invalid array indexing"\);\s*\}\s*arr\[arrIndex\] = value;',
     'if (arrIndex == ARRAY_INDEX_NONE) break;\n\t\t\t\t\tif (arrIndex >= arr.size()) arr.resize(arrIndex + 1, std::string());   // PATCH XENON-LENIENT-INDEX\n\t\t\t\t\tarr[arrIndex] = value;'),
    (THROW_TXT, r'if (\1) { return; }   // PATCH XENON-LENIENT-INDEX: OOB text write skipped'),
], 'MemSet(string)', min_n=3)

assert 'PATCH XENON-LENIENT-INDEX' in s
open(path, 'w').write(s)
print(f'XENON-LENIENT-INDEX patch applied to {path} ({n} sites)')
