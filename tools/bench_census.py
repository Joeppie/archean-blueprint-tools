#!/usr/bin/env python3
"""bench-census: for every composite_builds pair in the corpus, extract the
GAME's own baked display pose (Build.position/orientation) — when non-identity
this IS the in-game panel transform — and compare against candidate joint-line
laws built from the master's mount + .ini joint key.

usage: python3 tools/bench_census.py [craft ...]"""
import json, math, sys, os
sys.path.insert(0, os.path.dirname(__file__))
import config

MAN = json.load(open(os.path.join(os.path.dirname(__file__), '..', 'viewer', 'models', 'manifest.json')))

def qrot(q, v):
    w, x, y, z = q
    m = [[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)],
         [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)],
         [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]]
    return tuple(sum(m[i][j]*v[j] for j in range(3)) for i in range(3))

def qa(deg, v):
    a = deg*math.pi/180; s = math.sin(a/2); c = math.cos(a/2)
    return (c, v[0]*s, v[1]*s, v[2]*s)

def qm(a, b):
    aw, ax, ay, az = a; bw, bx, by, bz = b
    return (aw*bw-ax*bx-ay*by-az*bz, aw*bx+ax*bw+ay*bz-az*by,
            aw*by-ax*bz+ay*bw+az*bx, aw*bz+ax*by-ay*bx+az*bw)

def qconj(a):
    w, x, y, z = a; return (w, -x, -y, -z)

def eulerZYX(rx, ry, rz):
    return qm(qa(rz, (0, 0, 1)), qm(qa(ry, (0, 1, 0)), qa(rx, (1, 0, 0))))

def axis_angle(q):
    """(axis, deg) of a quat; handle w<0 and 0/180 deg."""
    w, x, y, z = q
    if w < 0: x, y, z, w = -x, -y, -z, -w
    s = math.sqrt(x*x + y*y + z*z)
    if s < 1e-9: return ((1, 0, 0), 0.0)
    ax = (x/s, y/s, z/s)
    return (ax, 2*math.degrees(math.atan2(s, w)))

def qtup(o): return (o['w'], o['x'], o['y'], o['z'])
def vtup(p): return (p['x'], p['y'], p['z'])

E = {'x': (1, 0, 0), 'y': (0, 1, 0), 'z': (0, 0, 1)}
CE = {'x': (1, 0, 0), 'y': (0, 0, 1), 'z': (0, -1, 0)}    # C·ê   content-basis map
CME = {'x': (1, 0, 0), 'y': (0, 0, -1), 'z': (0, 1, 0)}   # C⁻¹·ê

def flatten(comps):
    out = []
    def rec(lst):
        for c in lst:
            if c['type'] == 'Build' and isinstance(c.get('data'), dict):
                rec(c['data'].get('components') or [])
            out.append(c)
    rec(comps)
    return out

def laws(mq, jn):
    qAxle = eulerZYX(*jn['rotation'])
    key = jn.get('axis') or 'x'
    return {
        'chain R·qA·ê ': qrot(mq, qrot(qAxle, E[key])),
        'R·qA·C·ê    ': qrot(mq, qrot(qAxle, CE[key])),
        'R·qA·C⁻¹·ê  ': qrot(mq, qrot(qAxle, CME[key])),
        'R·ê         ': qrot(mq, E[key]),
        'R·C⁻¹·ê     ': qrot(mq, CME[key]),
        'R·C·ê       ': qrot(mq, CE[key]),
    }

def fmt(v): return f"({v[0]:+.2f}{v[1]:+.2f}{v[2]:+.2f})"

def scan(fp):
    bp = json.load(open(fp))
    d = bp.get('data') or {}
    flat = flatten(d.get('components') or [])
    out = []
    for j in d.get('composite_builds') or []:
        b = flat[j['slaveBuildId']] if j['slaveBuildId'] < len(flat) else None
        m = flat[j['component']] if j['component'] < len(flat) else None
        if not b or b['type'] != 'Build' or not m: continue
        bp_ = qtup(b['orientation']); bpos = vtup(b['position'])
        ang = axis_angle(bp_)
        identity_bench = ang[1] < 1e-6 and all(abs(v) < 1e-6 for v in bpos)
        md = m.get('data') or {}
        master_ang = md.get('angle'); master_pos = md.get('pos')
        jn = (MAN.get(m['type']) or {}).get('joints')
        jn = jn[0] if jn else None
        out.append((m['type'], identity_bench, ang, bpos, master_ang, master_pos,
                    qtup(m['orientation']), jn, m['position']))
    return out

def main(paths):
    tot = {'baked': 0, 'flat': 0}
    score = {}
    for fp in paths:
        rows = scan(fp)
        shown = False
        for (mt, ident, ang, bpos, mang, mpos, mq, jn, mpp) in rows:
            if ident:
                tot['flat'] += 1
                continue
            tot['baked'] += 1
            if not jn: continue
            # ground truth: bench rotation axis+angle about a line; its DIRECTION = ang[0]
            gdir, gdeg = ang
            if abs(mang or 0) < 1e-6: continue   # bench baked but angle 0: skip law check
            if not shown:
                print(f"\n== {os.path.basename(os.path.dirname(fp))} ==")
                shown = True
            print(f"  {mt:<10} angle {mang:>7.1f}  bench dir {fmt(gdir)} deg {gdeg:6.1f}  (bench sign vs angle: {'same' if (gdeg>0)==((mang or 0)%360<180) else 'flipped'})")
            for name, v in laws(mq, jn).items():
                dot = sum(a*b_ for a, b_ in zip(v, gdir))
                ok = abs(abs(dot) - 1) < 0.05   # parallel or antiparallel
                score.setdefault(name, [0, 0])
                score[name][0 if ok else 1] += 1
                print(f"     {name} {fmt(v)} dot={dot:+.3f} {'COLLINEAR' if ok else ''}")
    print(f"\nbench census: baked poses {tot['baked']}, identity {tot['flat']}")
    print("law collinearity vs game-baked bench axis:")
    for name, (ok, bad) in sorted(score.items(), key=lambda kv: -kv[1][0]):
        print(f"  {name}  collinear {ok:3d}  miss {bad:3d}")

if __name__ == '__main__':
    root = config.blueprints_dir()
    paths = sys.argv[1:] or sorted(
        os.path.join(root, s, 'blueprint.json') for s in os.listdir(root)
        if os.path.exists(os.path.join(root, s, 'blueprint.json')))
    main(paths)
