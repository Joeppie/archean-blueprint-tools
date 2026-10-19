#!/usr/bin/env python3
"""asset_space.py — classify each component model's glTF VERTEX SPACE.

Every glTF asset stores its mesh verts in one of two author spaces:
 * Z-UP   (Blender space): the game places them as (gx, -gz, gy)  -> the
   viewer must bake Rx(+90) = (x,-z,y) at load  ("unity-baked" types);
 * Y-UP   (already part-file space): placement uses the verts as-is.
The arbiter is the [COLLIDER] box: authored in the PART'S FILE FRAME
(position + ZYX-euler rotation from the .ini, NOT the axis-swapped box
alone — extract_models drops those fields, so this tool reads the .ini).
For every atlas type we build the node-tree cloud (raw .ini positions +
ZYX eulers, three.js semantics) over (a) raw glTF verts and (b) Rx(+90)
baked verts, and score each against every collider box: the axis-extent
mismatch sum after centre alignment. The class whose cloud fits strictly
better (by --margin, summed over axes) is baked; ties and near-ties stay
RAW — the current viewer look — so symmetric parts never flip silently.

The printed TS table lives in app/src/engine/models.ts (UNITY_BAKED_TYPES)
and must be re-run after game updates (same ritual as the conditional-parts
table, MATRIX.md §What the DATA files define).

  python3 tools/asset_space.py            # print the table
  python3 tools/asset_space.py --report   # per-type scores instead
"""
import argparse, json, math, re, sys, pathlib

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import config

REPO = pathlib.Path(__file__).resolve().parent.parent
MAN = json.loads((REPO / 'viewer/models/manifest.json').read_text())

Cinv = ((1,0,0),(0,0,-1),(0,1,0))  # Rx(+90): (x,-z,y)

def mm(A,B): return tuple(tuple(sum(A[i][k]*B[k][j] for k in range(3)) for j in range(3)) for i in range(3))
def mv(A,v): return tuple(sum(A[i][j]*v[j] for j in range(3)) for i in range(3))

def eul_zyx(e):  # three.js 'ZYX' = Rz @ Ry @ Rx, e=[x,y,z] DEG
    cx,sx=math.cos(math.radians(e[0])),math.sin(math.radians(e[0]))
    cy,sy=math.cos(math.radians(e[1])),math.sin(math.radians(e[1]))
    cz,sz=math.cos(math.radians(e[2])),math.sin(math.radians(e[2]))
    return mm(mm(((cz,-sz,0),(sz,cz,0),(0,0,1)),((cy,0,sy),(0,1,0),(-sy,0,cy))),((1,0,0),(0,cx,-sx),(0,sx,cx)))

def abs_xf(man, name):
    nodes = {**{j['name']: j for j in man['joints']},
             **{t['name']: t for t in man['targets']},
             **{x['name']: x for x in man['renderables']}}
    seq, cur = [], name
    while cur in nodes: seq.append(nodes[cur]); cur = nodes[cur].get('parent')
    seq.reverse()
    Racc, Tacc = ((1,0,0),(0,1,0),(0,0,1)), (0,0,0)
    for n in seq:
        Rl, Tl = eul_zyx(n['rotation']), n['position']
        Tacc = tuple(mv(Racc,Tl)[k]+Tacc[k] for k in range(3))
        Racc = mm(Racc, Rl)
    return Racc, Tacc

def cloud(man, geo):
    pts=[]
    for r in man['renderables']:
        if r['name'] not in geo: continue
        A,t = abs_xf(man, r['name'])
        for p in geo[r['name']]['prims']:
            v = p['lv'] if 'lv' in p else p['v']
            for i in range(0,len(v),3):
                q = mv(A,(v[i],v[i+1],v[i+2]))
                pts.append(tuple(q[k]+t[k] for k in range(3)))
    return pts

def bbox(pts):
    mn=[9e9]*3; mx=[-9e9]*3
    for p in pts:
        for k in range(3):
            mn[k]=min(mn[k],p[k]); mx[k]=max(mx[k],p[k])
    return mn,mx

def score(cl, box):
    (mn,mx),(ln,lx) = cl, box
    return sum(abs((mx[k]-mn[k])-(lx[k]-ln[k])) for k in range(3))

COLLIDER_RE = re.compile(r'\[COLLIDER[^\]]*\](.*?)(?=\n\[|\Z)', re.S)
def ini_colliders(ini_path):
    """full Unity-frame boxes: rotate min/max corners by the ZYX euler,
    translate by position."""
    out=[]
    for sec in COLLIDER_RE.findall(ini_path.read_text()):
        pos=[0.,0.,0.]; rot=[0.,0.,0.]; mn=None; mx=None
        for line in sec.splitlines():
            if not line.strip() or line[0]=='#': continue
            if '=' not in line: continue
            k,_,v = line.partition('='); k=k.strip(); v=v.strip()
            nums=[float(x) for x in v.split()] if re.match(r'^[-0-9eE.]+( +[-0-9eE.]+)*$', v) else None
            if k=='position' and nums: pos=nums
            elif k=='rotation' and nums: rot=nums
            elif k=='box_min' and nums: mn=nums
            elif k=='box_max' and nums: mx=nums
        if mn is None: continue
        R = eul_zyx(rot)
        corners=[mv(R,(x,y,z)) for x in (mn[0],mx[0]) for y in (mn[1],mx[1]) for z in (mn[2],mx[2])]
        out.append(([min(c[k] for c in corners)+pos[k] for k in range(3)],
                    [max(c[k] for c in corners)+pos[k] for k in range(3)]))
    return out

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--report', action='store_true')
    ap.add_argument('--margin', type=float, default=0.15)
    args = ap.parse_args()
    gdir = config.game_dir()
    rows=[]
    for T, man in sorted(MAN.items()):
        path = REPO / f'viewer/models/{T}.json'
        if not path.exists() or not man['colliders']:
            rows.append((T,'RAW',None,None,'no-geo/collider')); continue
        ini = next(iter(pathlib.Path(gdir).glob(f'modules/*/components/{T}/{T}.ini')), None)
        boxes = ini_colliders(ini) if ini else None
        if not boxes:
            rows.append((T,'RAW',None,None,'no-ini')); continue
        pts = cloud(man, json.loads(path.read_text()))
        if not pts: rows.append((T,'RAW',None,None,'no-verts')); continue
        raw = bbox(pts); bak = bbox([(p[0],-p[2],p[1]) for p in pts])
        s_raw = min(score(raw,b) for b in boxes); s_bak = min(score(bak,b) for b in boxes)
        cls = 'BAKE' if s_bak < s_raw - args.margin else 'RAW'
        note = '??both-poor' if min(s_raw,s_bak) > 0.6 else ''
        rows.append((T,cls,round(s_raw,2),round(s_bak,2),note))
    if args.report:
        for r in rows: print(f'{r[0]:28s} {r[1]:4s} raw={r[2]} bake={r[3]} {r[4]}')
    baked = sorted(T for T,c,_,_,_ in rows if c=='BAKE')
    print(f'\n// {len(baked)} of {len(rows)} types — regenerate with tools/asset_space.py')
    print('const UNITY_BAKED_TYPES: ReadonlySet<string> = new Set([')
    for T in baked: print(f"  '{T}',")
    print(']);')
    ambiguous = [r for r in rows if r[4]=='??both-poor']
    if ambiguous:
        print(f'\n// AMBIGUOUS (collider too loose to arbitrate, default RAW): '
              f'{", ".join(r[0] for r in ambiguous)}', file=sys.stderr)

main()
