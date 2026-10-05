#!/usr/bin/env python3
"""Generate the landing-page craft gallery + viewer/workshop.json.

Scans testdata/<id>/blueprint.json, merges names from
tools/ws-names.tsv (tab-separated id<TAB>title, fetched from Steam,
rate-limit-friendly) with data.alias and a small curated table, writes
viewer/workshop.json ({id: {name, author}} — used for the viewer's
workshop link tooltip) and rewrites the gallery section of index.html
between the <!--GALLERY--> markers.

Items are linked two ways: open in our viewer (?open=) and the Steam
Workshop page (filedetails?id=). The game files themselves cannot be
fetched from the browser (Steam download needs the client / auth and
steamcommunity sends no CORS headers) — the Steam client's workshop
content dir is the ingest path, so this repo mirrors them under testdata/.
"""
import json, os, re

ROOT = os.path.join(os.path.dirname(__file__), '..')
CURATED = {   # titles Steam pages confirm; kept offline per AGENTS (no fetches at runtime)
    '3327182790': 'Cheap Exploration Plane',
    '3334591920': '7x-Port-a-MiningRig',
    '3334593406': 'port-a-power-plugin',
    '3334698274': "Jimmy's Adventure",
    '3347018068': 'Oh no.. it flies',
    '3348400160': 'Cede (outdated)',
    '3373508061': 'Transcede-1060 (outdated)',
    '3381670618': 'Dolphin-700 (Updated)',
    '3384910875': 'Glideon',
    '3385814436': 'Golden Throne',
    '3385870429': 'Christmas Present',
    '3385876909': 'Christmas Tree',
    '3386936607': 'Plain',
    '3404843025': 'Sprite 500 - RCS',
}
FEATURED = [('3481322297', 'the classic American semi truck'),
            ('3381670618', 'the arrow-shaped dolphin'),
            ('3334698274', 'the dashboard mosaic')]
SYNTH = {'9000000001'}          # viewer fixtures, not workshop items
# Gallery exclusions (user request): novelty/repeat builds kept in testdata/
# (regtest corpus) but not shown on the landing page.
EXCLUDE = {
    '3384910875',   # Glideon
    '3334593406',   # port-a-power-plugin
    '3347018068',   # Oh no.. it flies
    '3334591920',   # 7x-Port-a-MiningRig
}
NUMERIC_NAME = re.compile(r'^(Workshop item\s+)?[\d\s.,_\-]+$', re.U)  # "23", "Workshop item 3406025722"… (deleted/untitled) -> skip (user)

names = dict(CURATED)
tsv = os.path.join(ROOT, 'tools', 'ws-names.tsv')
if os.path.isfile(tsv):
    for line in open(tsv):
        parts = line.rstrip('\n').split('\t')
        if (len(parts) == 2 and not parts[1].startswith('<title>')
                and 'Error' not in parts[1] and parts[1] != 'Steam Workshop'):
            names.setdefault(parts[0], parts[1])

data, rows, skipped = {}, [], []
for d in sorted(os.listdir(os.path.join(ROOT, 'testdata'))):
    bp = os.path.join(ROOT, 'testdata', d, 'blueprint.json')
    if not (d.isdigit() and len(d) >= 6 and d not in SYNTH and d not in EXCLUDE and os.path.isfile(bp)):
        continue
    j = json.load(open(bp))
    alias = (j['data'].get('alias') or '').strip()
    name = names.get(d) or alias or ('Workshop item ' + d)
    if NUMERIC_NAME.match(name):
        skipped.append((d, name))
        continue
    author = j.get('author', '')
    data[d] = {'name': name, 'author': author}
    rows.append((d, name, author, os.path.isfile(os.path.join(ROOT, 'testdata', d, 'preview.jpg'))))

os.makedirs(os.path.join(ROOT, 'viewer'), exist_ok=True)
with open(os.path.join(ROOT, 'viewer', 'workshop.json'), 'w') as f:
    json.dump(data, f, indent=1, ensure_ascii=False)

def card(d, name, author, thumb):
    img = (f'<img src="testdata/{d}/preview.jpg" width="160" height="160" loading="lazy" alt="">'
           if thumb else
           '<div style="width:160px;height:160px;background:#1d2026;border-radius:8px;'
           'display:flex;align-items:center;justify-content:center;color:#567">no preview</div>')
    return (f'<div class="card"><a href="viewer/index.html?open=../testdata/{d}/blueprint.json">'
            f'{img}<div class="cn">{name}</div></a>'
            f'<div class="cm">{author} · <a href="https://steamcommunity.com/sharedfiles/'
            f'filedetails/?id={d}" target="_blank" rel="noopener">workshop ↗</a></div></div>')

feat = ' '.join(card(*next(r for r in rows if r[0] == i)) for i, _ in FEATURED)
rest = ' '.join(card(*r) for r in rows if r[0] not in dict(FEATURED))
gallery = f'''<!--GALLERY-->
<h2 style="font-size:20px;color:#fff;margin-top:34px">Craft gallery</h2>
<p class="muted">Click a craft to open it in the <a href="viewer/index.html">3D inspector</a>;
&#8599; opens the Steam Workshop page. Blueprint files come from the local Steam
workshop content dir (browser downloads from Steam need the client, so the repo
mirrors them under <code>testdata/</code> — game content belongs to the developer, see NOTICE.md).</p>
<div class="grid">{feat}</div>
<p class="muted" style="margin-top:18px">…and the rest of the corpus:</p>
<div class="grid">{rest}</div>
<!--/GALLERY-->'''

p = os.path.join(ROOT, 'index.html')
html = open(p).read()
html = re.sub(r'<!--GALLERY-->.*?<!--/GALLERY-->', gallery, html, flags=re.S)
if '<!--GALLERY-->' not in html:
    html = html.replace('</body>', gallery + '\n</body>')
style = '''.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:14px}
.card img{border-radius:8px;display:block;width:160px;height:160px;object-fit:cover}
.card a{color:#cfe3ee;text-decoration:none} .card a:hover .cn{color:#7dffcf}
.cn{font-weight:600;max-width:160px;margin-top:4px} .cm{color:#8aa;font-size:12px;max-width:160px}
'''
if '.grid{' not in html:
    html = html.replace('</style>', style + '</style>')
open(p, 'w').write(html)
print(f'gallery: {len(rows)} crafts, {sum(1 for r in rows if r[3])} previews; workshop.json written')
if skipped:
    print('skipped numeric-only names:', ', '.join(f'{d} ({n})' for d, n in skipped))
