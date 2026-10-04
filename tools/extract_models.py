#!/usr/bin/env python3
"""Extract component models from installed Archean game modules.

The game ships, per component, a gltf (positions/normals/indices, materials
named color1/color2/data-connector/...) and an .ini describing the entity:
mass, collider box, renderable node tree, joints (with angular limits) and
adapters (port positions). This script packs all of it into one JSON atlas
consumed by the viewer, so components render with the game's real geometry
and real colours (color1 = baseColor, color2 = mainColor from the blueprint).

Usage:
    python3 extract_models.py <path-to-Archean-game> [-o models/components.json]

Example:
    python3 extract_models.py ~/.local/share/Steam/steamapps/common/Archean/Archean-game
"""
import argparse
import json
import math
import struct
import sys
from pathlib import Path

COMPONENT_TYPE_DIRS = "components"   # modules/<module>/components/<Type>/<Type>.gltf


def parse_ini(path):
    """Minimal .ini reader: sections [TYPE name] with key = value lines."""
    sections = {}
    cur = None
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith((";", "#")):
            continue
        if line.startswith("[") and line.endswith("]"):
            typ, _, name = line[1:-1].partition(" ")
            cur = (typ, name.strip())
            sections[cur] = {}
        elif "=" in line and cur:
            k, _, v = line.partition("=")
            sections[cur][k.strip()] = v.strip()
    return sections


def vec(s, n=None):
    parts = [float(x) for x in s.split()]
    return parts if n is None else parts[:n]


def read_gltf(gltf_path):
    """Return {node_name: [ {material, v:[..], n:[..], i:[..]} ]} from gltf+bin."""
    g = json.loads(gltf_path.read_text())
    bins = []
    for buf in g.get("buffers", []):
        uri = buf.get("uri")
        bins.append((gltf_path.parent / uri).read_bytes() if uri else b"")

    def accessor(idx):
        a = g["accessors"][idx]
        bv = g["bufferViews"][a["bufferView"]]
        raw = bins[bv.get("buffer", 0)]
        off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        ncomp = {"SCALAR": 1, "VEC3": 3, "VEC2": 2}[a["type"]]
        ct = a["componentType"]
        fmt = {5120: "b", 5121: "B", 5122: "h", 5123: "H", 5125: "I", 5126: "f"}[ct]
        esz = struct.calcsize(fmt)
        count = a["count"] * ncomp
        return list(struct.unpack(f"<{count}{fmt}", raw[off:off + count * esz]))

    comps = {}
    for node in g.get("nodes", []):
        if "mesh" not in node:
            continue
        prims = []
        for prim in g["meshes"][node["mesh"]]["primitives"]:
            v = accessor(prim["attributes"]["POSITION"])
            i = accessor(prim["indices"]) if "indices" in prim else list(range(len(v) // 3))
            prims.append({
                "material": g["materials"][prim["material"]]["name"] if "material" in prim else "base",
                "v": [round(x, 3) for x in v], "i": i,
            })   # normals recomputed by the viewer (computeVertexNormals)
        comps[node["name"]] = {
            "prims": prims,
            "translation": node.get("translation", [0, 0, 0]),
            "rotation": node.get("rotation", [0, 0, 0, 1]),
        }
    return comps


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("game_dir", help="Archean-game directory (contains modules/)")
    ap.add_argument("-o", "--out", default="models/components.json")
    args = ap.parse_args()
    mods = Path(args.game_dir) / "modules"
    if not mods.is_dir():
        sys.exit(f"no modules/ under {args.game_dir}")

    atlas = {}
    for ini in sorted(mods.glob(f"*/{COMPONENT_TYPE_DIRS}/*/*.ini")):
        typ = ini.stem
        gltf = ini.with_suffix(".gltf")
        if not gltf.exists():
            continue
        sec = parse_ini(ini)
        ent = {k: v for (t, k), v in sec.items() if t == "ENTITY"}
        ekey = next(iter(ent), typ)
        entry = {"module": ini.parts[-4], "mass": float(ent.get(ekey, {}).get("mass", 1) or 1),
                 "nodes": {}, "renderables": [], "joints": [], "adapters": [], "colliders": []}
        try:
            comps = read_gltf(gltf)
        except Exception as e:
            print(f"skip {typ}: gltf {e}", file=sys.stderr)
            continue
        for (t, name), kv in sec.items():
            rec = {k: kv[k] for k in kv}
            if t == "RENDERABLE":
                entry["renderables"].append({
                    "name": name, "parent": rec.get("parent"),
                    "position": vec(rec.get("position", "0 0 0")),
                    "rotation": vec(rec.get("rotation", "0 0 0"))})
            elif t == "JOINT":
                entry["joints"].append({
                    "name": name, "parent": rec.get("parent"),
                    "position": vec(rec.get("position", "0 0 0")),
                    "rotation": vec(rec.get("rotation", "0 0 0")),
                    "limits": vec(rec.get("angular_x", "")) if "angular_x" in rec else None})
            elif t == "ADAPTER":
                entry["adapters"].append({
                    "name": name, "type": rec.get("type", ""),
                    "position": vec(rec.get("position", "0 0 0")),
                    "rotation": vec(rec.get("rotation", "0 0 0"))})
            elif t == "COLLIDER":
                entry["colliders"].append({
                    "name": name, "parent": rec.get("parent"),
                    "min": vec(rec.get("box_min", "0 0 0")),
                    "max": vec(rec.get("box_max", "0 0 0"))})
        # attach gltf geometry by node name
        for r in entry["renderables"]:
            c = comps.get(r["name"])
            if c:
                entry["nodes"][r["name"]] = c
        if not entry["renderables"] and comps:      # single-mesh components
            for name, c in comps.items():
                entry["renderables"].append({"name": name, "parent": None,
                                             "position": [0, 0, 0], "rotation": [0, 0, 0]})
                entry["nodes"][name] = c
        atlas[typ] = entry

    outdir = Path(args.out)          # treat --out as a directory
    outdir.mkdir(parents=True, exist_ok=True)
    manifest = {}
    for typ, entry in atlas.items():
        geo = entry.pop("nodes", {})
        # gltf node transforms stay with the geometry file
        for name, c in geo.items():
            c.pop("rotation", None)   # transforms live in renderables (Euler deg)
        (outdir / f"{typ}.json").write_text(json.dumps(geo, separators=(",", ":")))
        manifest[typ] = entry
    (outdir / "manifest.json").write_text(json.dumps(manifest, separators=(",", ":")))
    import os
    total = sum(os.path.getsize(p) for p in outdir.iterdir())
    print(f"{len(atlas)} components -> {outdir}/ ({total/1024:.0f} kB total, lazy-loaded per type)")


if __name__ == "__main__":
    main()
