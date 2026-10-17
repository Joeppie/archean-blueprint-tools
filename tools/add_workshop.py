#!/usr/bin/env python3
"""Add a locally-subscribed Steam Workshop craft to the corpus + gallery.

    python3 tools/add_workshop.py 3481322297

Steam item downloads require the Steam client (browser fetches are blocked:
getfiles.cgi needs login and steamcommunity sends no CORS headers), so the
item must be subscribed in the game/client first. This copies
<workshop_content>/<id>/blueprint.json (+ preview.png -> 320px preview.jpg
thumbnail) into <blueprints>/<id>/, then regenerates the landing gallery.
Both folders resolve through tools/config.py (ARCHEAN_WORKSHOP /
ARCHEAN_BLUEPRINTS env or blueprints.conf — no hardcoded Steam paths).
Workshop page link: https://steamcommunity.com/sharedfiles/filedetails/?id=<id>
"""
import os, shutil, subprocess, sys

sys.path.insert(0, os.path.dirname(__file__))
import config

ROOT = config.ROOT
CONTENT = config.workshop_content_dir()

def main(wid):
    src = os.path.join(CONTENT, wid)
    bp = os.path.join(src, 'blueprint.json')
    if not os.path.isfile(bp):
        sys.exit(f'not found: {bp}\n'
                 f'subscribe to https://steamcommunity.com/sharedfiles/filedetails/?id={wid} '
                 f'in the Archean client first (content dir: {CONTENT})')
    dst = os.path.join(config.blueprints_dir(), wid)
    os.makedirs(dst, exist_ok=True)
    shutil.copy2(bp, os.path.join(dst, 'blueprint.json'))
    prev = os.path.join(src, 'preview.png')
    if os.path.isfile(prev):
        try:
            from PIL import Image
            im = Image.open(prev).convert('RGB')
            im.thumbnail((320, 320))
            im.save(os.path.join(dst, 'preview.jpg'), quality=78)
        except ImportError:
            shutil.copy2(prev, os.path.join(dst, 'preview.png'))
    print('added', dst)
    subprocess.run([sys.executable, os.path.join(ROOT, 'tools', 'make_landing.py')], check=True)
    print('workshop page: https://steamcommunity.com/sharedfiles/filedetails/?id=' + wid)

if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1].strip())
