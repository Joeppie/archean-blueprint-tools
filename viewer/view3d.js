// Archean blueprint live inspector — renders components + blocks of blueprint.json
// with Firefox-DevTools-style sliders on their attributes. See FORMAT.md for the
// file format. World mapping: world = (pos - 5.5) * 0.25 + frame * 3.0 per axis.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
// surface crashes in the document title (visible to headless test dumps)
addEventListener('error', (e) => { document.title = 'ERR ' + (e.message || 'load') + ' @' + e.lineno + ':' + e.colno; });
addEventListener('unhandledrejection', (e) => {
  const st = String(e.reason?.stack || '').split('\n').find(l => l.includes('view3d')) || '';
  document.title = 'ERR ' + (e.reason?.message || e.reason) + ' |' + st.trim().replace(/^at /, '').slice(0, 60);
});
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getBlockPoints, getBlockFaces, getBlockFaceDirections, isFullFace } from './blockshapes.js?v=142';
import { resolveColor } from './palette.js?v=142';

// ---- site-zoom cancel: the viewer ALWAYS loads at physical 100% ----
// Chrome SAVES page zoom per site (Ctrl+wheel sets it, Ctrl-F5 keeps it,
// only Ctrl+0 resets — and JS cannot call that reset). The lowest
// devicePixelRatio we have ever seen is the unzoomed baseline; the current
// ratio above it is saved zoom, which we counteract with inverse CSS zoom.
// Canvas + UI then occupy the same physical pixels as a 100% page, so the
// "stuck in a highly zoomed viewer" state cannot survive a load. Opt out
// with ?nozoom.
{
  try {
    if (!new URLSearchParams(location.search).has('nozoom')) {
      const SCREEN = [1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3];      // OS scales
      const STEP = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]; // Chrome zoom steps
      let base = Number(localStorage.getItem('archean-dpr-base')) || 0;
      const apply = () => {
        const d = devicePixelRatio;
        const known = base > 0 && d / base >= 0.6 && d / base <= 1.6;
        if (!known) {
          // No trustworthy baseline (incognito, monitor swap): factor the
          // dpr into standard OS scale × Chrome zoom step. dpr 1.5625 can
          // only be 125% screen × 125% site zoom — cancel that; dpr 1.5 is
          // a native 150% screen — leave it alone. Only ZOOM-IN is undone:
          // a deliberate Ctrl+wheel zoom-out (90%, 80%) is respected, and
          // excluding z<1 keeps 1.5625 from factoring as 175% screen × 90%.
          let best = null;
          for (const b of SCREEN)
            for (const z of STEP)
              if (z > 1.02 && Math.abs(b * z - d) < 0.015 &&
                  (!best || Math.abs(Math.log(z)) < Math.abs(Math.log(best[1]))))
                best = [b, z];
          base = best ? best[0] : d;
          localStorage.setItem('archean-dpr-base', String(Math.min(base, d)));
        }
        document.documentElement.style.zoom =
          Math.abs(d / base - 1) > 0.02 ? String(base / d) : '';
      };
      apply();
      addEventListener('resize', apply);            // zoom changes fire resize
    }
  } catch { /* localStorage blocked: leave zoom alone */ }
}

// ---- game component models (extracted from installed game modules) ----
// manifest: per-type metadata (mass, renderable node tree, joints, adapters,
// colliders); geometry fetched lazily per type. Material names color1/color2
// are the player-painted surfaces (blueprint colors.color1/color2).
const MODEL = { manifest: null, cache: {} };
// Default is LIGHT proxies (boxes + hexagon cylinders): the game ships dense
// raytracing-grade geometry that overloads raster GPUs. The checkbox swaps in
// the real game models on demand; the choice persists across sessions.
let realModelsOn = localStorage.getItem('archean-real-models-v2') === '1';   // v2 key: fresh defaults (real models OFF by default, user)
function setRealModels(on) {
  realModelsOn = on;
  localStorage.setItem('archean-real-models-v2', on ? '1' : '0');
  buildScene();               // rebuild: proxy-only (light) vs real geometry
}
async function loadModelManifest() {
  try { MODEL.manifest = await (await fetch('models/manifest.json')).json(); }
  catch { MODEL.manifest = null; }
}
function getModel(type) {
  if (!MODEL.manifest) return null;
  if (!(type in MODEL.cache))
    MODEL.cache[type] = fetch(`models/${type}.json`)
      .then(r => (r.ok ? r.json() : null))
      .then(geo => (geo ? { geo, info: MODEL.manifest[type] } : null))
      .catch(() => null);
  return MODEL.cache[type];
}
const ADAPTER_COL = { data: 0x2244cc, fluid: 0x22aa88, highvoltage: 0xcc8811, lowvoltage: 0xcc4444, item: 0x886622, heat: 0xcc2222 };
const ADP_GEO = new THREE.SphereGeometry(0.03, 8, 6);
// fallback materials for atlas files predating the materials table (glTF
// factors are LINEAR, like the game's own material colours)
const MAT_FIX = {
  'data-connector': { color: [0, 0.05, 0.5], metal: 1, rough: 1 },
  'data-connector-m': { color: [0, 0.05, 0.5], metal: 1, rough: 1 },
  glass: { color: [0.75, 0.84, 0.9, 0.4], metal: 0.1, rough: 0.1, alpha: 'BLEND' },
};
function modelMaterial(c, name, mats) {
  if (name === 'color1') return compColor(c, 'color1');
  if (name === 'color2') return compColor(c, 'color2');
  const m = mats?.[name] || MAT_FIX[name];
  if (m) return { color: new THREE.Color(...m.color.slice(0, 3)),
                  metal: m.metal ?? 1, rough: clamp(m.rough ?? 1, 0.03, 1),
                  op: m.alpha === 'BLEND' ? clamp(m.color[3] ?? 0.5, 0.05, 1) : 1 };
  return { color: new THREE.Color(0x8d949e), metal: 0.5, rough: 0.55, op: 1 };
}
// renderables the game only shows under a condition (client behaviour, same
// table as XenonViewer's CONDITIONAL_PARTS): a wheel's gltf contains BOTH tire
// toruses (only one is mounted, per data.reverse) and an optional mudguard —
// showing all of them stacks a double tire and a guard the craft never wore.
const DROP_PARTS = {
  Wheel: (c) => [...(c.data?.mudguard === false ? ['mudguard'] : []),
                  c.data?.reverse ? 'Torus' : 'TorusReverse'],
  BigWheel: (c) => [c.data?.reverse ? 'Torus' : 'TorusReverse'],
  // ToggleButton is a TWO-STATE device: .ini pairs axle/switch (rotation z −180
  // = pressed) with axle2/switch2 (z 0 = released) — the game shows exactly one
  // lever, keyed on data.state. base2 is the optional second-face plate, only
  // for isDualSided buttons. Rendering every part stacked a phantom lever
  // through the mount (dolphin 3417786605 door buttons: "misplaced").
  ToggleButton: (c) => [c.data?.state ? 'switch2' : 'switch',
                        c.data?.isDualSided ? null : 'base2'].filter(Boolean),
  PushButton: (c) => [c.data?.isDualSided ? null : 'base2'].filter(Boolean),
};
// The Dashboard's geometry is GENERATED by the game from `data` — its glTF is
// the 1.5×1 m editor template, NOT the panel (port of the XenonViewer
// scene.js buildDashboard under NOTICE §2). Units are CENTIMETRES: the board
// runs from the local origin (CORNER pivot, not centred) to
// (size_x/100, size_y/100, 0.01); the panel plane is local X·Y with normal
// +z; elements sit at pos_*/100 with size_*/100 between z 0.01 and 0.02; the
// dataport — the one glTF piece the game keeps — is re-centred at
// (w/2, h/2, 0). Colours are 0..255 LINEAR with metallic/roughness used
// straight off 0..255 (NOT the blocks' 0..7 / 0|1 scales — rounding those
// flattens the paint). Simplifications vs the client: buttons are painted
// main-colour faceplates (their extra glTF models are not in our atlas) and
// Label text uses a monospace face (the game ships xenon-pixel.ttf; we keep
// its 6×9 px grid, 8 px cell, 5 px/cm density, alpha threshold, nearest filter).
const dashMat = (c, metallic, roughness) => {
  const rough = (roughness ?? 0) / 255;
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color().setRGB((c?.r ?? 255) / 255, (c?.g ?? 255) / 255,
      (c?.b ?? 255) / 255, THREE.LinearSRGBColorSpace),
    roughness: Math.max(rough, 0.02),
    metalness: ((metallic ?? 0) / 255) * (1 - rough),
    envMapIntensity: (metallic ?? 0) > 127 ? 1.25 : 0,
  });
};
function dashTextTex(el) {
  const lines = String(el.text ?? '').split('\n');
  const longest = Math.max(0, ...lines.map(l => l.length));
  const ts = Math.max(1, el.textSize | 0);
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round((el.size_x || 0) * 5));
  cv.height = Math.max(1, Math.round((el.size_y || 0) * 5));
  const x = cv.getContext('2d', { willReadFrequently: true });
  // Canvas PRE-MIRROR (x → width−x). Our view chain mirrors the world on z,
  // so a RAW canvas reads MIRRORED from the plate's authored readable side.
  // Proven with the orient fixture (testdata/9000000001): the game and the
  // dev viewer both render 'TEST' readable from file +z for a +z-facing
  // plate; through our z-mirror only a pre-mirrored canvas matches. (v104's
  // rule; v105's revert was the regression the user re-reported.) Text
  // positions land exactly — the canvas mirror and the net view mirror cancel.
  x.fillStyle = '#fff'; x.textBaseline = 'alphabetic'; x.textAlign = 'left';
  x.font = `${8 * ts}px monospace`;
  x.translate(cv.width, 0); x.scale(-1, 1);
  const center = (el.textAlign ?? 16) === 16;   // textAlign 16 = centred
  let y = 3;
  for (const line of lines) {
    let px = center ? Math.ceil((cv.width - line.length * 6 * ts) / 2) : 3;
    for (const ch of line) { x.fillText(ch, px, y + 9 * ts); px += 6 * ts; }
    y += 9 * ts;
  }
  const img = x.getImageData(0, 0, cv.width, cv.height), p = img.data;
  const bg = el.baseColor || { r: 255, g: 255, b: 255 };
  const fg = el.mainColor || { r: 0, g: 0, b: 0 };
  for (let i = 0; i < p.length; i += 4) {
    const lit = p[i + 3] > 0;   // the engine lights a pixel with no half-tones
    p[i] = lit ? fg.r : bg.r; p[i + 1] = lit ? fg.g : bg.g;
    p[i + 2] = lit ? fg.b : bg.b; p[i + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;   // the few sRGB places in the format
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  return t;
}
function buildDashboard(c, model, idx, low) {
  const g = new THREE.Group();
  g.scale.z = -1;                          // standard mirror chain
  const d = c.data || {};
  const w = (Number(d.size_x) || 0) / 100, h = (Number(d.size_y) || 0) / 100;
  if (w <= 0 || h <= 0) return g;
  const board = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.01),
    dashMat(d.color, d.metallic, d.roughness));
  board.position.set(w / 2, h / 2, 0.005);
  board.userData.ci = idx;
  g.add(board);
  const dp = model.geo?.dataport;          // the one glTF piece the game keeps
  if (dp && !d.hideConnector) {
    const byMat = new Map();
    for (const prim of dp.prims) {
      const gg = new THREE.BufferGeometry();
      gg.setAttribute('position', new THREE.Float32BufferAttribute(low && prim.lv ? prim.lv : prim.v, 3));
      gg.setIndex(low && prim.li ? prim.li : prim.i);
      gg.computeVertexNormals();
      let arr = byMat.get(prim.material);
      if (!arr) byMat.set(prim.material, arr = []);
      arr.push(gg);
    }
    for (const [mname, geos] of byMat) {
      const gg = geos.length > 1 ? mergeGeometries(geos, false) : geos[0];
      if (!gg) continue;
      const m = new THREE.Mesh(gg, mat(modelMaterial(c, mname, model.info.materials)));
      m.userData.ci = idx;
      m.position.set(w / 2, h / 2, 0);     // centred behind the board
      g.add(m);
    }
  }
  for (const el of d.elements || []) {     // labels/screens/mouldings: generated boxes
    if (!el || !el.type) continue;
    const ew = (el.size_x || 0) / 100, eh = (el.size_y || 0) / 100;
    if (ew <= 0 || eh <= 0) continue;
    const ex = (el.pos_x || 0) / 100, ey = (el.pos_y || 0) / 100;
    const tex = el.type === 'Label' && el.text ? dashTextTex(el) : null;
    const body = dashMat(el.baseColor, el.baseMetallic, el.baseRoughness);
    const face = tex
      ? new THREE.MeshStandardMaterial({ map: tex, envMapIntensity: 0,
          roughness: Math.max((el.baseRoughness ?? 0) / 255, 0.02), metalness: 0 })
      : dashMat(el.mainColor, el.mainMetallic, el.mainRoughness);  // buttons/plates
    const m = new THREE.Mesh(new THREE.BoxGeometry(ew, eh, 0.01),
      [body, body, body, body, face, body]);   // +Z carries the text (BoxGeometry face order)
    m.position.set(ex + ew / 2, ey + eh / 2, 0.015);
    m.userData.ci = idx;
    g.add(m);
  }
  return g;
}
// Text baked INTO component geometry (MiniComputer 'CODE' buttons, HUD rows)
// follows the SAME rule as canvas text, proven with the orient fixture: the
// glyphs are authored readable from their plate's +normal (front) side in the
// game, and through our z-mirror that side renders mirrored — so the prim is
// mirrored IN-PLANE about its own bbox centre (x → 2cx−x): glyph order and
// shapes read correctly from the authored side, and mirroring about the
// centre (not x=0) keeps the string exactly where the file put it (HUD rows
// are symmetric; MiniComputer glyphs sit 5.5 mm off the button centre, and a
// flip about x=0 would push them 11 mm across it). Winding is restored by an
// index swap. (v105's local z-flip netted the raw geometry = still mirrored
// from the pilot side — same bug the fixture exposes for canvas text.)
const TEXT_MIRROR_X = new Set(['code_button_text', 'reboot_button_text',
                               'code', 'subscribe', 'codein', 'activein']);
function flipGeomX(gg) {
  gg.computeBoundingBox();
  const cx = (gg.boundingBox.min.x + gg.boundingBox.max.x) / 2;
  gg.applyMatrix4(new THREE.Matrix4().makeTranslation(2 * cx, 0, 0)
    .multiply(new THREE.Matrix4().makeScale(-1, 1, 1)));
  const gi = gg.getIndex();            // restore outward winding in the flipped space
  if (gi) {
    const a = gi.array;
    for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; }
    gi.needsUpdate = true;
  }
  gg.computeVertexNormals();
}
function buildRealComponent(c, model, idx, low = false) {
  const { geo, info } = model;
  if (c.type === 'Dashboard') return buildDashboard(c, model, idx, low);
  const g = new THREE.Group();
  g.scale.z = -1;          // raw .ini/gltf local space mirrored into view space
  // Placement truth is the .ini node tree (renderables/joints/targets, ZYX
  // euler like the game engine) — NOT the gltf node translations, which are
  // Blender authoring offsets (MiniComputer's model sits 3 m from its origin!).
  const nodes = new Map();
  const RAD = Math.PI / 180;
  const mkNode = (n) => {
    const p = new THREE.Group();
    p.rotation.order = 'ZYX';
    p.position.set(...n.position);
    p.rotation.set(n.rotation[0] * RAD, n.rotation[1] * RAD, n.rotation[2] * RAD);
    nodes.set(n.name, p);
  };
  // two passes: create every node, then link — a joint parented to a target
  // (or any forward reference) must not fall back to the root
  for (const j of info.joints || []) mkNode(j);
  for (const t of info.targets || []) mkNode(t);
  for (const r of info.renderables) mkNode(r);
  const link = (n) => (nodes.get(n.parent) || g).add(nodes.get(n.name));
  for (const n of [...(info.joints || []), ...(info.targets || []), ...info.renderables]) link(n);
  const drop = new Set(DROP_PARTS[c.type]?.(c) || []);
  for (const r of info.renderables) {
    if (drop.has(r.name)) continue;
    const nd = geo[r.name];
    if (!nd) continue;
    const rg = nodes.get(r.name);
    const byMat = new Map();          // merge same-material prims → fewer draws
    for (const prim of nd.prims) {
      const v = low && prim.lv ? prim.lv : prim.v;
      const i = low && prim.li ? prim.li : prim.i;
      const gg = new THREE.BufferGeometry();
      gg.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      gg.setIndex(i);
      gg.computeVertexNormals();
      if (TEXT_MIRROR_X.has(prim.material)) flipGeomX(gg);
      let arr = byMat.get(prim.material);
      if (!arr) byMat.set(prim.material, arr = []);
      arr.push(gg);
    }
    for (const [mname, geos] of byMat) {
      const gg = geos.length > 1 ? mergeGeometries(geos, false) : geos[0];
      if (!gg) continue;
      const m = new THREE.Mesh(gg, mat(modelMaterial(c, mname, info.materials)));
      m.userData.ci = idx;
      m.userData.node = r.name;                    // .ini node name (postest probes state parts)
      rg.add(m);
    }
  }
  // aileron: hinge the real flap like the game does (front ailerons droop)
  const jp = nodes.get('joint');
  if (jp && c.type === 'Aileron') jp.rotateX(aileronAngle(c));   // saved data.angle deflection
  // Beacon: the game's flashing red light is PROCEDURAL — the gltf carries no
  // lens material (just housing + mast), the game shader animates the flash.
  // Rendered straight, the part is a grey pin and users stop recognising it
  // ("beacon no longer looks like a beacon"). Give the mast tip a static
  // emissive red lens: the beacon's visual identity (no animation: the render
  // loop stays on-demand).
  if (c.type === 'Beacon') {
    for (const r of info.renderables) {
      const nd = geo[r.name];
      if (!nd) continue;
      let top = null;
      for (const prim of nd.prims) {
        if (prim.material !== 'body') continue;
        const v = low && prim.lv ? prim.lv : prim.v;
        for (let k = 1; k + 1 < v.length; k += 3)
          if (!top || v[k] > top[1]) top = [v[k - 1], v[k], v[k + 1]];
      }
      if (top) {
        const lens = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 10),
          new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff2222, envMapIntensity: 0 }));
        lens.position.set(top[0], top[1] + 0.03, top[2]);
        lens.userData.ci = idx;
        (nodes.get(r.name) || g).add(lens);
      }
    }
  }
  // adapter nubs: queue in world space, merged into ONE mesh per port type (see adpFlush)
  const qo = viewQuat(c.orientation);
  const po = viewPos(c.position);
  for (const a of info.adapters || []) {
    if (adpEndpoint.get(idx)?.has(a.name)) continue;   // cable port: nub drawn at the endpoint
    // Cable-free ports whose .ini adapter sits >0.5 m from the part origin are
    // BUILD-TIME flanges, not visible sockets: SolarPanel's spare data/lowv
    // ports are 1.0 m below the pivot (reaching into the deck at build time),
    // so their nubs rendered as "red & blue spheres sitting on the ground
    // plane right under the solar panel" (user report). Skip them.
    if (Math.hypot(a.position[0], a.position[1], a.position[2]) > 0.5) continue;
    const p = new THREE.Vector3(a.position[0], a.position[1], -a.position[2]).applyQuaternion(qo);
    adpQueue.push({ x: p.x + po.x, y: p.y + po.y, z: p.z + po.z,
                    t: a.type, ci: idx, lx: a.position[0], ly: a.position[1], lz: a.position[2] });
  }
  scheduleAdpFlush();
  g.userData.ci = idx;
  return g;
}

function syncAdapters(obj) {
  let hit = false;
  for (const a of adpQueue) if (a.ci === obj.userData.ci && a.lx != null) {
    // a.lx == null → endpoint nub: it belongs to the cable, not the part; it
    // stays at the game's endpoint when the part is moved in the viewer
    const p = new THREE.Vector3(a.lx, a.ly, -a.lz).applyQuaternion(obj.quaternion);
    a.x = p.x + obj.position.x; a.y = p.y + obj.position.y; a.z = p.z + obj.position.z;
    hit = true;
  }
  if (hit) scheduleAdpFlush();
}

// merged adapter-nub meshes (big craft: hundreds of tiny spheres → 1 draw per type)
const adpQueue = [];
// (ci, port name) → cable endpoint recorded by the GAME (data.pipes): the real
// connection point at the part's VISIBLE socket (may differ from the .ini
// adapter position). Nubs are drawn there when a cable exists (user:
// connection markers must sit where the cables physically are); cable-free
// ports keep the flange (skipped if >0.5 m from the part origin).
const adpEndpoint = new Map();
let adpTimer = 0;
function scheduleAdpFlush() {
  clearTimeout(adpTimer);
  adpTimer = setTimeout(() => {
    adpGroup.clear();
    const byT = new Map();
    for (const a of adpQueue) {
      const gg = ADP_GEO.clone().applyMatrix4(new THREE.Matrix4().makeTranslation(a.x, a.y, a.z));
      let arr = byT.get(a.t);
      if (!arr) byT.set(a.t, arr = []);
      arr.push(gg);
    }
    for (const [t, geos] of byT) {
      const gg = geos.length > 1 ? mergeGeometries(geos, false) : geos[0];
      if (gg) adpGroup.add(new THREE.Mesh(gg,
        mat({ color: new THREE.Color(ADAPTER_COL[t] ?? 0x33ddff), metal: 0.2, rough: 0.4, op: 1 })));
    }
    invalidate();
  }, 350);
}

const CELL = 0.25, FRAME = 3.0;
const cellW = (p) => (p - 5.5) * CELL;               // cell -> world metres
const occWorld = (o, ax) => cellW(o['pos_' + ax]) + o['frame_' + ax] * FRAME;

// ---------- file space → view space (Unity left-handed mirror) -----------
// The game runs on Unity: a LEFT-handed world. Drawing the file numbers raw
// in a right-handed Three.js scene renders the MIRROR IMAGE of the game view
// — beacons lean to the opposite side, steering casters pitch the wrong way,
// wheels sit inboard of their mounts, ailerons deflect inverted. This is not
// cosmetic: pipes settle it. data.pipes endpoints are game-computed world
// adapter positions, and they match p + R(q)·a for the CONJUGATED quaternion
// (0.000 m) but not the raw one (0.18–0.66 m) — i.e. the file's q is a
// left-handed rotation. The standard Unity→right-handed conversion mirrors
// z: VIEW = (x, y, −z) file-space, quaternion (w, x, y, −z).
// Conventions here:
//  * positions/quaternions entering the scene go through viewPos/viewQuat;
//  * component-local geometry keeps RAW .ini/gltf numbers — a root scale.z=−1
//    on the component object absorbs the mirror (the renderer flips winding
//    for negative-determinant matrices, sprites are unaffected);
//  * raw-coordinate subsystems (CoM marker, flow, aero arrows) live under
//    worldM (scale.z=−1); baked geometry (blocks, hull, pipes, occupancy)
//    mirrors z at emit time with the matching winding flip;
//  * model.data, serialize(), the inspector numbers and the reports stay in
//    RAW file space (selftest asserts the mirrored placements).
const viewPos = (p) => new THREE.Vector3(p.x, p.y, -p.z);
// Rotation STORAGE convention flips with the game generation:
// • Pre-palette files (no data.colors, 2024-2025 exports) store the Unity LH
//   quaternion RAW. Proof: the mosaic craft (3334698274) glues 49 dashboard
//   plates flat onto one hull wall — only raw R(q) makes every plate normal
//   parallel to the fitted wall plane (flushfrac 1.00 raw vs 0.00 conj);
//   conj renders them standing out of the wall at an angle (user: murals
//   "not flush", 'test' dash "rotated away from the seat" — in the raw game
//   the plate front is the local −z face, so raw faces the pilot dead-on).
// • 2026 files (data.colors present) store the CONJUGATE: ISW-241's own
//   data.pipes endpoints reproduce only under R(q*) (comptest 60/60, 0.000 m).
// Our view chain mirrors z, so legacy files convert as (w,−x,−y,z) and
// modern files as (w,x,y,−z). Saved files stay byte-exact: edits invert
// through rawFromView.
let LEGACY_Q = false;
const viewQuat = (q) => LEGACY_Q ? new THREE.Quaternion(-q.x, -q.y, q.z, q.w)
                                 : new THREE.Quaternion(q.x, q.y, -q.z, q.w);   // file {w,x,y,z}

// ---------- three.js boilerplate ----------
const view = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.max(1, Math.min(devicePixelRatio, 2.5)));  // floor 1: browser zoom-out pushes dpr <1 (canvas below CSS res = "zoomed in and grainy"); cap 2.5: Chrome SAVES per-site zoom, so HiDPI 150% zoom => dpr 3 — a 2.0 cap rendered 2/3 res = grainy (user's "stuck zoom after Ctrl-F5")
view.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fb4d8);
scene.fog = new THREE.Fog(0x8fb4d8, 40, 90);
// PBR metal has NO diffuse term: lights-only, chrome renders near-black
// (user: "metallic colours too dark, not enough reflection" — the game's
// raytracer reflects the world). PMREM studio env, baked once at startup,
// zero per-frame cost; only metal materials get envMapIntensity > 0, so
// matte/painted surfaces stay exactly as before.
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
}

const camera = new THREE.PerspectiveCamera(55, 1, 0.05, 300);
camera.position.set(-6.5, 3.4, 8.5);              // view space: nose (+z) toward camera
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.9, -0.5);
controls.enableDamping = true;
// Per-craft framing: the ISW-tuned defaults bury the camera in a 16 m truck
// (user: "deeply zoomed in, fades out when zooming out, moving behaves
// weird" — fixed fog(40,90) ate the far parts, fixed far=300 clipped the
// ground, and the orbit pivot sat inside the hull). Frame the bbox, scale
// fog/far to the model size; ?cam= still overrides afterwards.
function fitCameraToModel() {
  scene.updateMatrixWorld(true);   // matrixWorld is lazy: frame the CURRENT scene
  const box = new THREE.Box3();
  [compGroup, blockGroup, hullGroup, pipeGroup, subGroup].forEach(g => box.expandByObject(g));
  if (!isFinite(box.min.x)) return;
  const c = box.getCenter(new THREE.Vector3());
  const sz = box.getSize(new THREE.Vector3());
  const r = Math.max(1, sz.x, sz.y, sz.z);
  controls.target.copy(c);
  // Minimum framing distance: on a 1 m craft a 1.1 m camera reads as tiny
  // FOV + low res + ultra-sensitive orbit (user's "stuck in a zoomed
  // viewer" — no fly-to ran; the AUTO fit was the zoom). Small crafts get
  // a >= 3.6 m view; big crafts keep the 1.85r framing.
  const d = Math.max(r * 1.85, 3.6);
  camera.position.set(c.x + d * 0.6, c.y + Math.max(d * 0.34, 1.4), c.z + d * 0.72);
  camera.near = Math.max(0.05, r / 400);
  camera.far = Math.max(300, r * 10);
  scene.fog.near = Math.max(30, r * 2.5);
  scene.fog.far = Math.max(80, r * 7);
  camera.updateProjectionMatrix();
  controls.update();
}

scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x444422, 1.1));
const sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
sun.position.set(-6, 10, -4);
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(120, 120),
  new THREE.MeshStandardMaterial({ color: 0x3d5a34, roughness: 1, envMapIntensity: 0 }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const grid = new THREE.GridHelper(28, 112, 0x223322, 0x2c4429);
grid.position.y = 0.002;
scene.add(grid);

function onResize() {
  const w = view.clientWidth, h = view.clientHeight;
  renderer.setPixelRatio(Math.max(1, Math.min(devicePixelRatio, 2.5)));  // browser zoom changes dpr (fires resize); Chrome persists per-site zoom across reloads
  renderer.setSize(w, h);
  invalidate();
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', onResize);
// Back/forward returns the page from bfcache with the frozen camera (a zoom
// left in some cockpit), a residual damping velocity (weird camera glide) and
// a suspended render — the user's "deep zoom + fades + moves oddly after
// back/forward, fine on fresh open". Treat restore like a fresh open:
// refit framing to the craft, resize, and repaint.
addEventListener('pageshow', (e) => {
  if (!e.persisted) return;
  fitCameraToModel();
  onResize();
  invalidate();
});

// ---------- state ----------
let model = null;              // parsed blueprint, components kept live-synced
let orig = [];                 // per component: {pos0, q0, occ0[]} for save sync
const compGroup = new THREE.Group();   // clickable component proxies
const blockGroup = new THREE.Group();
const occGroup = new THREE.Group();    // type-255 occupancy boxes
const hullGroup = new THREE.Group();   // extruded hull plates
const pipeGroup = new THREE.Group();   // pipes/cables + port markers
const adpGroup = new THREE.Group();    // adapter/port nubs, merged across all components
const subGroup = new THREE.Group();    // subgrids: nested Build blueprints (hatches/doors)
scene.add(compGroup, blockGroup, occGroup, hullGroup, pipeGroup, adpGroup, subGroup);
occGroup.visible = false;
hullGroup.visible = true;

let selected = -1, hovered = -1, dirty = false;
let fileHandle = null;

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);
const toast = (msg) => { const t = $('toast'); t.textContent = msg; t.style.opacity = 1;
  clearTimeout(toast._h); toast._h = setTimeout(() => t.style.opacity = 0, 1800); };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = (v) => (Math.round(v * 1000) / 1000).toString();

// Game colour semantics (ported from the dev's XenonViewer, see NOTICE §2):
// palette/component colours are 0-255 LINEAR albedo (the engine's shaders
// take vec3(r,g,b)/255 raw — decoding them as sRGB darkens everything ~^2.2),
// roughness is a 0..7 scale, metallic is 0|1, and opacity <15 is transparent.
// The game's tracer lights every surface with diffuse when roughness>0 even
// for metallic=1 (a rough-steel plate sun-lit bright, chrome mirror-dark),
// so metalness is modelled as metallic·(1 − roughness/7).
function pbr(c) {
  const rough = clamp((c.roughness ?? 0) / 7, 0.03, 1);
  const op = c.opacity ?? 15;
  return {
    color: new THREE.Color().setRGB(c.r / 255, c.g / 255, c.b / 255, THREE.LinearSRGBColorSpace),
    metal: c.metallic ? Math.max(0, 1 - (c.roughness ?? 0) / 7) : 0,
    rough,
    op: op >= 15 ? 1 : clamp((op + 1) / 16, 0.02, 1),
  };
}
const matKey = (s) => s.color.getHex() + ',' + s.op.toFixed(3) + ',' + s.metal.toFixed(3) + ',' + s.rough.toFixed(3);
function palColor(slot) {
  return pbr(resolveColor(model?.data?.colors, slot, LEGACY_Q));
}
// component colours: same format as palette entries; the game's painted-material
// defaults stand in for missing fields (color1 = polished white, color2 = matte grey)
const COMP_COLOR_DEFAULTS = {
  color1: { r: 255, g: 255, b: 255, opacity: 15, roughness: 0, metallic: 0 },
  color2: { r: 204, g: 204, b: 204, opacity: 15, roughness: 7, metallic: 1 },
};
function compColor(comp, which, fallback) {
  let c = comp.colors?.[which];
  if (c == null && Array.isArray(comp.colors)) {
    // v1-format files store colours as PALETTE SLOT INDICES: [color1, color2]
    // (legacy editor; e.g. [48,48] = matte dark green). Resolve against the
    // file palette — the built-in table for v1 files, which have none.
    const idx = comp.colors[which === 'color2' ? 1 : 0];
    if (typeof idx === 'number') c = resolveColor(model.data?.colors, idx, LEGACY_Q);
  }
  if (!c) {
    if (fallback === undefined || fallback === null) return pbr(COMP_COLOR_DEFAULTS[which] || COMP_COLOR_DEFAULTS.color1);
    return { color: new THREE.Color(fallback), metal: 0.5, rough: 0.55, op: 1 };
  }
  const d = COMP_COLOR_DEFAULTS[which] || COMP_COLOR_DEFAULTS.color1;
  return pbr({ r: c.r ?? d.r, g: c.g ?? d.g, b: c.b ?? d.b,
               opacity: c.opacity ?? d.opacity, roughness: c.roughness ?? d.roughness,
               metallic: c.metallic ?? d.metallic });
}
function mat(spec, extra = {}) {
  return new THREE.MeshStandardMaterial({
    color: spec.color, metalness: spec.metal, roughness: spec.rough,
    envMapIntensity: spec.metal > 0.5 ? 1.25 : 0,
    transparent: spec.op < 1, opacity: spec.op, ...extra });
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (r, h, seg = 6) => new THREE.CylinderGeometry(r, r, h, seg);

// ---------- component proxies (pivot at local origin = comp.position) ----------
// In-game a loaded wheel hangs BELOW its mount: the suspension arm droops to
// −y. The blueprint stores the BUILD pose (arm horizontal: wheel centre 0.447 m
// off the pivot), so a file-accurate render buries the tire in the deck edge.
// Droop = the smallest world rotation about the (horizontal) axle that brings
// the arm to −y — a physical wheel-roll: the axle and tire plane are untouched,
// so rolling geometry stays exact. Vertical-axle casters (ISW crawler mounts)
// can't droop around their axle and keep the file pose. Pure display: edits
// write back through the undo in userData (saved quaternions stay file-exact).
const WHEEL_TYPES = new Set(['SmallWheel', 'Wheel', 'BigWheel']);
// FluidJunction display pose: builder-file cables are cached in the builder's
// FLAT frame (outlets up, row along the fuselage — the v0.91 look); the file
// quaternion's conjugate pose (standing comb, ports sideways) matches none of
// them, so the junction read as "sticking out" of its own pipes. Display pose
// = mirror-conjugate file quaternion (w,−x,−y,z): the model lies flat and
// aligns with its cables. Display-only: edits write back through wheelUndo,
// saved quaternions stay file-exact.
const JUNCTION_TYPES = new Set(['FluidJunction']);
function applyDisplayPose(obj, qV, qF) {
  obj.userData.wheelUndo = undefined;
  if (JUNCTION_TYPES.has(obj.userData.wType)) {
    // Builder-flat display pose, CONVENTION-INDEPENDENT: legacy files store
    // the builder pose RAW, 2026 files its CONJUGATE (LEGACY_Q), so in file
    // terms the flat comb is always (−x,−y,z,w). Deriving it from qV with
    // (−x,−y,−z,w) matches only the modern convention and conjugated legacy
    // junctions by 120° about (1,1,−1) — the RCS-infinity (3518436870) comb
    // stood on its end; postest rcs-fj-flat/rcs-fj-touch pin this.
    obj.quaternion.set(-qF.x, -qF.y, qF.z, qF.w);
    obj.userData.wheelUndo = obj.quaternion.clone().invert().multiply(qV);
    return;
  }
  if (obj.userData.wType === 'ToggleButton') {
    // Mount bake: the game mounts the button base_planes-FLUSH — the mount
    // face (plate front) sits on the surface facing the pilot, which bakes a
    // local yaw-180 into the model: plate covers the authored hull gap, the
    // lever hides in the wall (pressed state flips it UP out of a deck
    // mount). Raw file-quat placement puts the 0.24 m plate box 0.68 m
    // BEHIND the pivot = dolphin/Cede "gap in the fuselage, button further
    // back, away from cockpit". Pinned by postest btn-plate-flush/-lever-pose.
    obj.quaternion.copy(qV).multiply(new THREE.Quaternion(0, 1, 0, 0));   // yaw 180
    obj.userData.wheelUndo = obj.quaternion.clone().invert().multiply(qV);
    return;
  }
  if (!WHEEL_TYPES.has(obj.userData.wType)) { obj.quaternion.copy(qV); return; }
  const a = new THREE.Vector3(1, 0, 0).applyQuaternion(qV);   // axle
  const u = new THREE.Vector3(0, 1, 0).applyQuaternion(qV);   // suspension arm
  const c = -u.y, s = -new THREE.Vector3().crossVectors(a, u).y;   // cos/sin of arm→down
  const L = Math.hypot(c, s);
  if (L > 0.9 && c <= 0.02) {        // roll reachable: arm horizontal (90°) or tilted
    const phi = Math.atan2(s, c);
    obj.quaternion.setFromAxisAngle(a, phi).multiply(qV);
    obj.userData.wheelUndo = obj.quaternion.clone().invert().multiply(qV);
  } else obj.quaternion.copy(qV);
}
const rawFromView = (obj, q) => {                   // strip droop, mirror to file
  const t = obj.userData.wheelUndo ? q.clone().multiply(obj.userData.wheelUndo) : q;
  return LEGACY_Q ? { w: t.w, x: -t.x, y: -t.y, z: t.z }
                  : { w: t.w, x: t.x, y: t.y, z: -t.z };
};
// saved aileron deflection: components[].data.angle is in DEGREES (the .ini
// [JOINT] angular_x limits are −45/+45, so ISW-241's −4.609 = a gentle −4.6°
// droop — NOT radians; a normalized-rad reading gives 95.9°, past the
// physical joint limit). Axis = hinge span (local x); view-space sign is +.
const aileronAngle = c => {
  const a = (c.data && typeof c.data.angle === 'number') ? c.data.angle : 0;
  return a * Math.PI / 180;
};

function footprint(comp) {
  const o = comp.occupancies[0] || { size_x: 0, size_y: 0, size_z: 0 };
  return { x: (o.size_x + 1) * CELL, y: (o.size_y + 1) * CELL, z: (o.size_z + 1) * CELL };
}
const PROXY = {
  PilotSeat(c) {
    const up = mat(compColor(c, 'Material.003', 0x1a1a1a)), frame = mat(compColor(c, 'color2', 0x444444));
    const g = new THREE.Group();
    const add = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); g.add(o); };
    add(box(0.10, 0.20, 0.10), frame, 0, -0.10, 0);            // pedestal
    add(box(0.42, 0.07, 0.44), up, 0, 0.035, 0);               // seat pan
    add(box(0.42, 0.50, 0.07), up, 0, 0.32, 0.185);            // backrest (+z = tail, faces nose)
    add(box(0.22, 0.14, 0.07), up, 0, 0.64, 0.20);             // headrest
    add(box(0.06, 0.10, 0.40), frame, -0.24, 0.12, 0.02);      // armrests
    add(box(0.06, 0.10, 0.40), frame, 0.24, 0.12, 0.02);
    return g;
  },
  SmallWheel(c) {
    const g = new THREE.Group();
    const tire = new THREE.Mesh(cyl(0.17, 0.10, 8), mat(compColor(c, 'color1', 0x1c1c1c)));
    tire.rotation.z = Math.PI / 2;                             // axle along local X
    const hub = new THREE.Mesh(cyl(0.06, 0.13, 6), mat(compColor(c, 'color2', 0xcccccc)));
    hub.rotation.z = Math.PI / 2;
    g.add(tire, hub);
    return g;
  },
  Aileron(c) {
    // facsimile of the game model: control plate + hinge rod (the "broom
    // handle" on the [JOINT] axis at local y=0.181) + flap (the .ini
    // 'aileron' renderable, joint +0.07 y) hinged on the local -z edge.
    // Flap deflection = the SAVED control state, components[].data.angle in
    // DEGREES (.ini [JOINT] angular_x limits −45/+45; ISW-241: front canard
    // −4.609° gentle droop, rear pair ±0.096° ≈ neutral, saved mid-roll).
    const f = footprint(c);
    const g = new THREE.Group();
    const m = mat(compColor(c, 'color1', 0xdddddd));
    const plate = new THREE.Mesh(box(f.x, 0.045, f.z * 0.6), m);
    plate.position.z = f.z * 0.2;                  // fixed surface, rear 60% (original side)
    const rod = new THREE.Mesh(cyl(0.025, f.x + 0.5, 6), mat(compColor(c, 'color2', 0x999999)));
    rod.rotation.z = Math.PI / 2;
    rod.position.y = 0.181;                        // hinge rod on the [JOINT] axis line
    const flap = new THREE.Mesh(box(f.x, 0.03, f.z * 0.4), m);
    flap.position.set(0, 0.07, -f.z * 0.3);        // aileron node = joint +0.07 y (.ini)
    const pivot = new THREE.Group();
    pivot.position.set(0, 0.181, 0);               // .ini [JOINT] hinge, above the plate
    pivot.add(flap);
    pivot.rotation.x = aileronAngle(c);            // saved data.angle (degrees → rad, view +)
    g.add(plate, rod, pivot);
    return g;
  },
  SolarPanel(c) {
    // panel plane is local X-Y (normal local Z): quaternion maps local -Z to
    // world +Y, so the plate renders flat facing straight up (verified from q
    // and from the lowvoltage port position in data.pipes).
    const f = footprint(c);
    return new THREE.Mesh(box(f.x, f.z, 0.03),
      mat(compColor(c, 'color1', 0x102a88), { emissive: 0x001144 }));
  },
  FluidPort(c) {
    const g = new THREE.Group();
    const m = mat(compColor(c, 'color1', 0x222222));
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.05, 14, 10), m);
    const stub = new THREE.Mesh(cyl(0.03, 0.14), m);
    stub.rotation.x = Math.PI / 2; stub.position.z = 0.07;
    g.add(s, stub);
    return g;
  },
  FluidJunction(c) {
    // comb manifold, ports per the game .ini adapters: inlet on local −z,
    // four outlets (x ±0.375/±0.125) on local +z, body long axis local x
    const g = new THREE.Group(), m = mat(compColor(c, 'color1', 0xdddddd));
    g.add(new THREE.Mesh(box(1.0, 0.22, 0.3), m));
    const inlet = new THREE.Mesh(cyl(0.045, 0.16), m);
    inlet.rotation.x = Math.PI / 2; inlet.position.z = -0.16;
    g.add(inlet);
    for (const x of [-0.375, -0.125, 0.125, 0.375]) {
      const o = new THREE.Mesh(cyl(0.04, 0.16), m);
      o.rotation.x = Math.PI / 2; o.position.set(x, 0, 0.16);
      g.add(o);
    }
    return g;
  },
  RCS(c) {
    // nozzle along local -y; quaternion maps local -y -> world -z (nose-ward):
    // thrust points away from the nose (braking thruster, per craft behaviour)
    const g = new THREE.Group(), m = mat(compColor(c, 'color2', 0xcccccc));
    g.add(new THREE.Mesh(box(0.14, 0.2, 0.14), m));
    const n = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.18, 12), m);
    n.rotation.x = Math.PI / 2; n.position.y = -0.18;
    g.add(n);
    const fi = new THREE.Mesh(cyl(0.03, 0.1), m);
    fi.rotation.x = Math.PI / 2; fi.position.y = 0.14;   // fuel inlet, tail side
    g.add(fi);
    return g;
  },
};
const PROXY2 = {
  SmallTurboPump(c) {
    // rounded cylinder, axis local y (maps to world x: pump lies sideways
    // left-right in the craft). Ports from data.pipes: fluid-in at world -x
    // (local +y end), fluid-out at +x (local -y end), highvoltage on local -z.
    const g = new THREE.Group();
    const m = mat(compColor(c, 'color2', 0xbbbbbb));
    const pm = mat(compColor(c, 'color1', 0x333333));
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.36, 6, 14), m);
    body.rotation.z = Math.PI / 2;                  // local y axis
    g.add(body);
    for (const s of [1, -1]) {
      const nub = new THREE.Mesh(cyl(0.045, 0.14), pm);
      nub.rotation.z = Math.PI / 2; nub.position.y = s * 0.28;
      g.add(nub);
    }
    const hv = new THREE.Mesh(box(0.06, 0.05, 0.06), pm);
    hv.position.set(0, 0, -0.12);
    g.add(hv);
    return g;
  },
};
function defaultProxy(c) {
  // exact game collider footprint (from occupancies): box, axis-aligned
  const f = footprint(c);
  return new THREE.Mesh(box(f.x, f.y, f.z), mat(compColor(c, 'color1', 0x88aaff)));
}

// ---------- player-interactive labels ----------
// Components the player touches in-cockpit get a short floating label; an
// in-game alias (components[].alias) always wins and renders in blue.
const INTERACT = {
  Dashboard: 'dash', PushButton: 'button', ToggleButton: 'toggle', ArrowButton: 'arrow',
  Keyboard: 'keyboard', Numpad: 'numpad', Led: 'led', Buzzer: 'buzzer', Beacon: 'beacon',
  NavInstrument: 'nav', MiniNavInstrument: 'nav', HudController: 'hud',
  PilotSeat: 'seat', ToiletSeat: 'toilet', OwnerPad: 'pad',
  Computer: 'computer', MiniComputer: 'computer', Volume: 'volume',
};
let labelsOn = false;   // labels OFF by default (user): opt-in per session
function makeLabel(c) {
  const text = c.alias || INTERACT[c.type];
  const cv = document.createElement('canvas');
  let ctx = cv.getContext('2d');
  ctx.font = 'bold 44px monospace';
  const w = Math.max(72, Math.ceil(ctx.measureText(text).width) + 28);
  cv.width = w; cv.height = 64;
  ctx = cv.getContext('2d');
  ctx.fillStyle = 'rgba(8,12,16,0.72)';
  ctx.fillRect(0, 0, w, 64);
  ctx.font = 'bold 44px monospace';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = c.alias ? '#7fd0ff' : '#ffd479';
  ctx.fillText(text, 14, 34);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(cv), depthTest: false, transparent: true }));
  sp.scale.set(w / 64 * 0.3, 0.3, 1);
  sp.renderOrder = 10;
  sp.userData.isLabel = true;
  sp.raycast = () => {};                  // labels are never pick targets
  return sp;
}

// instant stand-in until the low-poly mesh loads: exact game collider box
function colliderProxy(c) {
  const col = MODEL.manifest?.[c.type]?.colliders?.[0];
  const g = new THREE.Group();
  if (col && col.max[0] - col.min[0] > 1e-6) {
    const b = new THREE.Mesh(
      box(col.max[0] - col.min[0], col.max[1] - col.min[1], col.max[2] - col.min[2]),
      mat(compColor(c, 'color1', 0x88aaff)));
    b.position.set((col.min[0] + col.max[0]) / 2, (col.min[1] + col.max[1]) / 2,
                   (col.min[2] + col.max[2]) / 2);
    g.add(b);
  } else {
    const f = footprint(c);
    g.add(new THREE.Mesh(box(f.x, f.y, f.z), mat(compColor(c, 'color1', 0x88aaff))));
  }
  return g;
}

// ---- block shapes -------------------------------------------------------
// blocks[].type encodes shape + orientation (cube/slope/corner/pyramid/
// inverse-corner, blockshapes.js, transcribed from the game's BlockShapes.hh).
// blocks.colors = 7 palette slots, one per face. Faces whose whole slice is
// covered by a neighbour's full face are interior walls → skipped (culling
// grid ported from the game developer's XenonViewer).
const CELLS_PER_FRAME = FRAME / CELL;                                  // 12
const C_ORIGIN = 4096, C_SPAN = 8192;
const cellKey = (x, y, z) => ((x + C_ORIGIN) * C_SPAN + (y + C_ORIGIN)) * C_SPAN + (z + C_ORIGIN);
const faceKey = (x, y, z, axis) => cellKey(x, y, z) * 3 + axis;
const blkCell = (b) => [b.frame_x * CELLS_PER_FRAME + b.pos_x,
                        b.frame_y * CELLS_PER_FRAME + b.pos_y,
                        b.frame_z * CELLS_PER_FRAME + b.pos_z];
const blkSpan = (b) => [b.size_x + 1, b.size_y + 1, b.size_z + 1];
function forEachFaceCell(b, dir, visit) {
  const axis = dir[0] ? 0 : dir[1] ? 1 : 2;
  const min = blkCell(b), size = blkSpan(b);
  // the face lives between two cells; file it on the lower-cell side
  const plane = dir[axis] > 0 ? min[axis] + size[axis] - 1 : min[axis] - 1;
  const u = (axis + 1) % 3, v = (axis + 2) % 3;
  const cell = [0, 0, 0];
  cell[axis] = plane;
  for (let i = 0; i < size[u]; i++)
    for (let j = 0; j < size[v]; j++) {
      cell[u] = min[u] + i; cell[v] = min[v] + j;
      visit(cell, axis);
    }
}
function buildFaceGrid(blocks) {
  const faces = new Map();
  blocks.forEach((b, index) => {
    if (b.type === 255) return;
    const dirs = getBlockFaceDirections(b.type);
    for (let f = 0; f < dirs.length; f++) {
      const dir = dirs[f];
      if (!dir || !isFullFace(b.type, f)) continue;
      const slot = b.colors?.[f] ?? b.colors?.[0] ?? 0;
      const opaque = resolveColor(model.data.colors, slot, LEGACY_Q).opacity >= 15;
      forEachFaceCell(b, dir, (cell, axis) => {
        const key = faceKey(cell[0], cell[1], cell[2], axis);
        const e = faces.get(key);
        if (!e) faces.set(key, [{ block: index, opaque }]);
        else if (!e.some((x) => x.block === index)) e.push({ block: index, opaque });
      });
    }
  });
  return faces;
}
function faceCovered(faces, b, index, faceDir, opaque) {
  if (!faceDir || Math.abs(faceDir[0]) + Math.abs(faceDir[1]) + Math.abs(faceDir[2]) !== 1) return false;
  const axis = faceDir[0] ? 0 : faceDir[1] ? 1 : 2;
  let covered = true;
  forEachFaceCell(b, faceDir, (cell) => {
    if (!covered) return;
    const entry = faces.get(faceKey(cell[0], cell[1], cell[2], axis)) || [];
    if (!entry.some((e) => e.block !== index && (!opaque || e.opaque))) covered = false;
  });
  return covered;
}

// ---- block geometry (algorithm ported from the dev's XenonViewer) --------
// Blocks render as merged geometry, ONE mesh per distinct palette colour
// (crafts use a handful of colours), with the game's interior-wall rules:
//  * full faces are cut cell-by-cell against the face grid; surviving cells
//    are stitched back into rectangles (a 3 m deck = 2 quads, not 144);
//  * partial faces (slope sides, corner slants) die when fully cell-covered;
//  * two blocks sharing the same partial-face footprint (a slope glued to a
//    slope) form an interior partition — both copies drop, else they z-fight.
// Every surviving face edge also goes into one wire geometry (face colour as
// vertex colour) so the wireframe overlay shows blocks and hull uniformly.
function faceFootprint(points, indices) {
  const uniq = new Set();
  for (const i of indices) { const p = points[i]; uniq.add(`${p[0].toFixed(4)},${p[1].toFixed(4)},${p[2].toFixed(4)}`); }
  return [...uniq].sort().join('|');
}
const cellM = (c) => c * CELL - FRAME / 2;
/** Quad covering spanU×spanV cells from `cell`, wound so its normal follows dir. */
function cellQuad(cell, axis, dir, spanU = 1, spanV = 1) {
  const u = (axis + 1) % 3, v = (axis + 2) % 3;
  const plane = cellM(cell[axis] + 1);       // a face lives between cells: plane = cell+1
  const corner = (du, dv) => {
    const p = [0, 0, 0];
    p[axis] = plane; p[u] = cellM(cell[u] + du); p[v] = cellM(cell[v] + dv);
    return p;
  };
  const quad = [corner(0, 0), corner(spanU, 0), corner(spanU, spanV), corner(0, spanV)];
  const e1 = quad[1].map((x, i) => x - quad[0][i]), e2 = quad[2].map((x, i) => x - quad[0][i]);
  const n = [e1[1]*e2[2]-e1[2]*e2[1], e1[2]*e2[0]-e1[0]*e2[2], e1[0]*e2[1]-e1[1]*e2[0]];
  return n[0]*dir[0] + n[1]*dir[1] + n[2]*dir[2] >= 0 ? quad : [quad[3], quad[2], quad[1], quad[0]];
}
function buildBlockGeometry(blocks, offset) {
  const faces = buildFaceGrid(blocks);
  const buckets = new Map();                 // matKey -> {pos:[], spec}
  const kept = [], footprints = new Map();
  const epos = [], ecol = [], eseen = new Set();
  const ek1 = (p) => `${Math.round(p[0]*1e3)},${Math.round(p[1]*1e3)},${Math.round(-p[2]*1e3)}`;
  const addEdge = (a, b, spec) => {
    const ka = ek1(a), kb = ek1(b), k = ka < kb ? ka + ';' + kb : kb + ';' + ka;
    if (eseen.has(k)) return;
    eseen.add(k);
    epos.push(a[0]+offset.x, a[1]+offset.y, -(a[2]+offset.z), b[0]+offset.x, b[1]+offset.y, -(b[2]+offset.z));
    ecol.push(spec.color.r, spec.color.g, spec.color.b, spec.color.r, spec.color.g, spec.color.b);
  };
  const push = (spec, pts) => {          // z-mirrored into view space, triangle winding flipped
    let bk = buckets.get(matKey(spec));
    if (!bk) buckets.set(matKey(spec), bk = { pos: [], spec });
    for (let i = 0; i + 2 < pts.length; i += 3)
      for (const p of [pts[i + 2], pts[i + 1], pts[i]])
        bk.pos.push(p[0] + offset.x, p[1] + offset.y, -(p[2] + offset.z));
  };
  blocks.forEach((b, index) => {
    if (b.type === 255) return;
    const origin = [occWorld(b, 'x') - CELL / 2, occWorld(b, 'y') - CELL / 2, occWorld(b, 'z') - CELL / 2];
    const size = [(b.size_x + 1) * CELL, (b.size_y + 1) * CELL, (b.size_z + 1) * CELL];
    const pts = getBlockPoints(b.type, origin, size);
    const tris = getBlockFaces(b.type);
    const dirs = getBlockFaceDirections(b.type);
    for (let f = 0; f < tris.length; f++) {
      const spec = palColor(b.colors?.[f] ?? b.colors?.[0] ?? 0);
      const opaque = spec.op >= 1;
      const dir = dirs[f];
      if (dir && isFullFace(b.type, f)) {    // full face: per-cell cull + rectangle stitch
        const axis = dir[0] ? 0 : dir[1] ? 1 : 2, u = (axis + 1) % 3, v = (axis + 2) % 3;
        const min = blkCell(b), sz = blkSpan(b);
        const free = new Uint8Array(sz[u] * sz[v]);
        let freeCount = 0;
        forEachFaceCell(b, dir, (cell) => {
          const entry = faces.get(faceKey(cell[0], cell[1], cell[2], axis)) || [];
          if (entry.some((e) => e.block !== index && (!opaque || e.opaque))) return;
          free[(cell[u] - min[u]) * sz[v] + (cell[v] - min[v])] = 1;
          freeCount++;
        });
        if (!freeCount) continue;
        const emit = (i, j, w, h) => {
          const cell = [0, 0, 0];
          cell[axis] = dir[axis] > 0 ? min[axis] + sz[axis] - 1 : min[axis] - 1;
          cell[u] = min[u] + i; cell[v] = min[v] + j;
          const q = cellQuad(cell, axis, dir, w, h);
          push(spec, [q[0], q[1], q[2], q[2], q[3], q[0]]);
          addEdge(q[0], q[1], spec); addEdge(q[1], q[2], spec);
          addEdge(q[2], q[3], spec); addEdge(q[3], q[0], spec);
        };
        for (let i = 0; i < sz[u]; i++)
          for (let j = 0; j < sz[v]; j++) {
            if (!free[i * sz[v] + j]) continue;
            let h = 1; while (j + h < sz[v] && free[i * sz[v] + j + h]) h++;
            let w = 1;
            grow: while (i + w < sz[u]) { for (let k = 0; k < h; k++) if (!free[(i + w) * sz[v] + j + k]) break grow; w++; }
            emit(i, j, w, h);
            for (let di = 0; di < w; di++) for (let dj = 0; dj < h; dj++) free[(i + di) * sz[v] + j + dj] = 0;
          }
        continue;
      }
      if (faceCovered(faces, b, index, dir, opaque)) continue;   // interior wall
      const fp = faceFootprint(pts, tris[f]);
      footprints.set(fp, (footprints.get(fp) || 0) + 1);
      kept.push({ pts, idx: tris[f], spec, fp });
    }
  });
  for (const face of kept) {
    if (footprints.get(face.fp) > 1) continue;                   // interior partition
    const P = face.idx.map((i) => face.pts[i]);
    push(face.spec, P);
    for (let t = 0; t + 2 < P.length; t += 3)
      for (const [a, b] of [[P[t], P[t+1]], [P[t+1], P[t+2]], [P[t+2], P[t]]]) addEdge(a, b, face.spec);
  }
  const meshes = [];
  for (const { pos, spec } of buckets.values()) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    meshes.push({ geo: g, spec });
  }
  return { meshes, edges: { pos: epos, col: ecol } };
}
function addBlockMeshes(group, blocks, offset) {
  const { meshes, edges } = buildBlockGeometry(blocks, offset);
  for (const { geo, spec } of meshes)
    group.add(new THREE.Mesh(geo, mat(spec, {
      side: spec.op < 1 ? THREE.DoubleSide : THREE.FrontSide,
      depthWrite: spec.op >= 1 })));
  return edges;
}

// subgrids: nested blueprint data inside 'Build' components (hatches/doors),
// linked to their hinge via data.composite_builds. In the blueprint they are
// stored in the CLOSED pose, using the same cell-grid encoding as the parent
// craft — the hinge's own orientation is the animation axis, not a transform.
function buildSubgrids() {
  subGroup.clear();
  for (const c of model.data.components) {
    if (c.type !== 'Build' || !c.data?.blocks?.length) continue;
    addBlockMeshes(subGroup, c.data.blocks, new THREE.Vector3());
    for (const sc of c.data.components || []) {
      if (sc.type === 'Build') continue;
      const m = MODEL.manifest?.[sc.type] ? colliderProxy(sc) : (PROXY[sc.type] || PROXY2[sc.type] || defaultProxy)(sc);
      m.position.copy(viewPos(sc.position));
      m.userData.wType = sc.type;
      applyDisplayPose(m, viewQuat(sc.orientation), sc.orientation);
      m.scale.z = -1;
      subGroup.add(m);
      // real/decimated geometry for nested parts too (Spider Mining Rover:
      // a Wheel lives in a hatch subgrid — the box stand-in alone read as a
      // "missing wheel"). ci = -1: nested parts are not list/select targets.
      const mp = MODEL.manifest?.[sc.type] ? getModel(sc.type) : null;
      if (mp) mp.then(mm => {
        if (!mm || !mm.geo || !subGroup.children.includes(m)) return;
        const real = buildRealComponent(sc, mm, -1, !realModelsOn);
        real.position.copy(m.position);
        real.quaternion.copy(m.quaternion);
        real.scale.z = -1;
        m.visible = false;
        real.raycast = () => {};
        real.traverse(o => { o.raycast = () => {}; });
        subGroup.add(real);
        invalidate();
      });
    }
  }
}

let compObjs = [];
const realMap = new Map();   // component index → real game-model groups (follow live edits)
function buildScene() {
  for (const g of [compGroup, blockGroup, occGroup, hullGroup]) {
    g.clear();
  }
  compObjs = [];
  realMap.clear();
  adpQueue.length = 0;
  adpGroup.clear();
  const { blocks, components } = model.data;

  for (const [i, c] of components.entries()) {
    if (c.type === 'Build') continue;   // editor construction-site ghost, not physical
    // Default = decimated real mesh (same shape as the game asset, squares +
    // hexagons, no micro-detail); checkbox swaps in the full raytracing-grade
    // geometry. Components without an atlas entry keep the hand proxies.
    const atlas = !!MODEL.manifest?.[c.type];
    const mesh = atlas ? colliderProxy(c) : (PROXY[c.type] || PROXY2[c.type] || defaultProxy)(c);
    mesh.position.copy(viewPos(c.position));
    mesh.userData.wType = c.type;
    applyDisplayPose(mesh, viewQuat(c.orientation), c.orientation);
    mesh.scale.z = -1;                              // hand proxies keep raw local geometry
    mesh.traverse(o => { o.userData.ci = i; });
    mesh.userData.ci = i;
    compGroup.add(mesh);
    compObjs[i] = mesh;
    if (INTERACT[c.type] || c.alias) {              // floating label above part
      const sp = makeLabel(c);
      const top = new THREE.Box3().setFromObject(mesh).max.y;
      sp.userData.ci = i;
      sp.userData.dy = top - mesh.position.y + 0.18;
      sp.position.set(mesh.position.x, top + 0.18, mesh.position.z);
      sp.visible = labelsOn;
      compGroup.add(sp);   // NEVER parented to the mirrored mesh: GPU sprite
                           // quads under a negative-determinant parent render
                           // mirrored text on some rasterizers
    }
    const mp = atlas ? getModel(c.type) : null;
    if (mp) mp.then(mm => {
      if (!mm || !mm.geo || !compObjs.includes(mesh)) return;
      const real = buildRealComponent(c, mm, i, !realModelsOn);   // low by default
      real.position.copy(mesh.position);
      real.quaternion.copy(mesh.quaternion);
      real.scale.z = -1;                            // (buildRealComponent root mirrors too)
      real.userData.real = true;
      mesh.visible = false;
      mesh.userData.hasReal = true;
      const lab = compGroup.children.find(o => o.userData.isLabel && o.userData.ci === i);
      if (lab) {                                   // labels ride the visible model
        lab.userData.dy = new THREE.Box3().setFromObject(real).max.y - real.position.y + 0.18;
        lab.position.y = real.position.y + lab.userData.dy;
      }
      compGroup.add(real);
      (realMap.get(i) || realMap.set(i, []).get(i)).push(real);
      invalidate();
    });
  }

  // blocks: merged meshes per palette colour + wire edges; the wireframe
  // overlay shows blocks and hull triangles uniformly; occupancy → 1 line mesh
  const oedges = [];
  for (const b of blocks) {
    if (b.type !== 255) continue;                                       // occupancy mirror box
    const s = new THREE.Box3(   // view-space (z-mirrored) occupancy box
      new THREE.Vector3(occWorld(b, 'x') - CELL / 2, occWorld(b, 'y') - CELL / 2,
                        -(occWorld(b, 'z') + b.size_z * CELL + CELL / 2)),
      new THREE.Vector3(occWorld(b, 'x') + b.size_x * CELL + CELL / 2,
                        occWorld(b, 'y') + b.size_y * CELL + CELL / 2,
                        -(occWorld(b, 'z') - CELL / 2)));
    const sz = s.getSize(new THREE.Vector3()), ct = s.getCenter(new THREE.Vector3());
    const eg = new THREE.EdgesGeometry(box(sz.x, sz.y, sz.z));
    eg.applyMatrix4(new THREE.Matrix4().makeTranslation(ct.x, ct.y, ct.z));
    oedges.push(eg);
  }
  const blkEdges = addBlockMeshes(blockGroup, blocks, new THREE.Vector3());
  if (oedges.length) occGroup.add(new THREE.LineSegments(mergeGeometries(oedges, false),
    new THREE.LineBasicMaterial({ color: 0xff4444, transparent: true, opacity: 0.35 })));
  buildHull();
  setBlockWire(blkEdges);
  buildPipes();
  buildSubgrids();
  // ground plane: never through the craft — blueprint y can dip below 0
  // (the VKG-955 truck builds down to y=-1.5), so park BOTH the grid and the
  // green ground plane just under the model's lowest point: the craft always
  // stands ON the ground, nothing renders below it (user rule).
  const gbb = new THREE.Box3().setFromObject(compGroup);
  gbb.expandByObject(blockGroup); gbb.expandByObject(subGroup); gbb.expandByObject(hullGroup);
  gbb.expandByObject(pipeGroup);
  const gy = isFinite(gbb.min.y) ? Math.min(0, gbb.min.y - 0.02) : 0;
  ground.position.y = gy;
  grid.position.y = gy + 0.002;
  applyHullOpacity();
  invalidate();
}

import { fitHull } from './hullfit.js?v=142';

// hull triangles: vertices live on the SAME lattice as blocks —
// world_ax = frame·3 − 1.5 + v·0.25 (see hullfit.js). The skin is a closed
// 0.05 m prism per triangle (the game's TRIANGLE_THICKNESS): colours[0] front,
// colours[1] back, colours[2..4] the side walls along edges v0-v1, v1-v2,
// v2-v0. Raw surface edges join the wireframe overlay (hullWire) alongside
// block edges — blocks and triangles are treated uniformly there.
// TODO(future): aerodynamics with full 360° velocity vector (crafts fly along
// any axis — nose may be ±X/±Z; Y is always up), automatic search of the
// aerodynamically stable flight direction at low/high speed, and an ambiguity
// warning when the stability scan finds multiple stable directions.
const hullP = { W: 12, px: 0.25, py: 0.25, pz: 0.25, Cx: -1.5, Cy: -1.5, Cz: -1.5 };
const HULL_T = 0.025;                        // half-thickness of hull skin (m)
let hullOpacity = Math.min(1, Math.max(0.1,
  Number(new URLSearchParams(location.search).get('op')) || 1));   // ?op= preset
// "hull" is blocks AND triangles (one skin, one slider): dim both groups,
// plus the wireframe overlay (v0.149 user: "make hull opacity pertain to
// blocks also" — the bright un-faded edges made the block dimming read as
// "nothing happens").
// Blocks are a closed skin — a view ray crosses TWO faces (enter+exit), so
// linear alpha composites back toward opaque and the slider "does nothing"
// (user report). Their alpha is sqrt-compensated: 1-(1-a)^2 == slider value.
// Hull triangles are single 0.05 m prisms seen through one face: linear.
function applyHullOpacity() {
  const effB = hullOpacity >= 1 ? 1 : 1 - Math.sqrt(1 - hullOpacity);
  for (const [grp, k] of [[blockGroup, effB], [hullGroup, hullOpacity],
                          [hullWire, hullOpacity]])
    grp.traverse(o => {
      if (!o.isMesh && !o.isLineSegments) return;
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
        const base = m.userData.op0 ?? (m.userData.op0 = m.opacity);
        m.opacity = base * k;
        m.transparent = m.opacity < 1;
        m.depthWrite = m.opacity >= 0.995;
      }
    });
}
function hullPt(t, ax, i) {
  return (t[`v${i}_${ax}`] + hullP.W * t['frame_' + ax]) * hullP['p' + ax] + hullP['C' + ax];
}
// welded + mirrored hull triangles: shared lattice slots merge into single
// points (like the game's welded vertices); near-mirror vertex pairs average
// their |x| so the skin renders symmetric, and near-axis points snap to x=0.
function weldedTris() {
  const tris = model.data.triangles.map(t => ({
    c: [0, 1, 2, 3, 4].map(k => t.colors?.[k] ?? t.colors?.[0] ?? 0),
    p: [0, 1, 2].map(i => [hullPt(t, 'x', i), hullPt(t, 'y', i), -hullPt(t, 'z', i)]),
  }));                                            // z-mirrored into view space
  const K = p => `${Math.round(p[0] * 40)},${Math.round(p[1] * 40)},${Math.round(p[2] * 40)}`;
  const map = new Map(), canon = [];
  const idx = tris.map(t => t.p.map(p => {
    const k = K(p);
    if (!map.has(k)) { map.set(k, canon.length); canon.push(p); }
    return map.get(k);
  }));
  const used = new Set();
  const cand = (a, b) => canon[a][0] * canon[b][0] < 0 &&
    Math.abs(canon[a][1] - canon[b][1]) < 0.12 && Math.abs(canon[a][2] - canon[b][2]) < 0.12 &&
    Math.abs(canon[a][0] + canon[b][0]) < 0.3;
  for (let a = 0; a < canon.length; a++) {
    if (used.has(a)) continue;
    let bj = -1, bd = 0.3;
    for (let b = 0; b < canon.length; b++) {
      if (b === a || used.has(b) || !cand(a, b)) continue;
      const d = Math.abs(canon[a][0] + canon[b][0]);
      if (d < bd) { bd = d; bj = b; }
    }
    if (bj >= 0) {
      const m = (Math.abs(canon[a][0]) + Math.abs(canon[bj][0])) / 2;
      canon[a] = [Math.sign(canon[a][0]) * m, ...canon[a].slice(1)];
      canon[bj] = [Math.sign(canon[bj][0]) * m, ...canon[bj].slice(1)];
      used.add(bj);
    }
  }
  for (const p of canon) if (Math.abs(p[0]) < 0.15) p[0] = 0;
  return tris.map((t, i) => ({ c: t.c, p: idx[i].map(j => canon[j]) }));
}
const hullWire = new THREE.Group(); hullWire.visible = false; scene.add(hullWire);   // wireframe OFF by default (user): checkbox derives visibility
let blockWireObj = null;
function setBlockWire(e) {
  if (blockWireObj) { hullWire.remove(blockWireObj); blockWireObj.geometry.dispose(); blockWireObj = null; }
  if (!e.pos.length) return;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(e.pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(e.col, 3));
  blockWireObj = new THREE.LineSegments(g,
    new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55 }));
  hullWire.add(blockWireObj);
}
function buildHull() {
  hullGroup.clear(); hullWire.clear();
  const T = HULL_T, wpos = [];
  const buckets = new Map();                 // matKey -> {pos:[], spec}
  const add = (spec, pts) => {
    let bk = buckets.get(matKey(spec));
    if (!bk) buckets.set(matKey(spec), bk = { pos: [], spec });
    for (const p of pts) bk.pos.push(p[0], p[1], p[2]);
  };
  for (const { c, p } of weldedTris()) {
    const e1 = p[2].map((v, i) => v - p[0][i]), e2 = p[1].map((v, i) => v - p[0][i]);
    // cross of the FLIPPED winding: z-mirrored vertices invert the raw normal,
    // so this is the game's front normal carried into view space
    const n = [e1[1]*e2[2] - e1[2]*e2[1], e1[2]*e2[0] - e1[0]*e2[2], e1[0]*e2[1] - e1[1]*e2[0]];
    const u = n.map(x => x / (Math.hypot(...n) || 1));
    const F = p.map(v => v.map((x, i) => x + u[i] * T));      // front face (+normal)
    const B = p.map(v => v.map((x, i) => x - u[i] * T));      // back face
    add(palColor(c[0]), [F[2], F[1], F[0]]);                  // windings flipped for z-mirror
    add(palColor(c[1]), [B[0], B[1], B[2]]);
    for (let i = 0; i < 3; i++) {                             // side walls (prism)
      const j = (i + 1) % 3;
      add(palColor(c[2 + i]), [B[j], B[i], F[i], F[j], B[j], F[i]]);
      wpos.push(...p[i], ...p[j]);                            // raw surface edges
    }
  }
  for (const { pos, spec } of buckets.values()) {
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    hg.computeVertexNormals();
    const s = { ...spec, op: spec.op * hullOpacity };
    hullGroup.add(new THREE.Mesh(hg, new THREE.MeshStandardMaterial({
      color: s.color, metalness: s.metal, roughness: s.rough,
      envMapIntensity: s.metal > 0.5 ? 1.25 : 0,
      transparent: s.op < 1, opacity: s.op, depthWrite: s.op >= 1,
      side: THREE.DoubleSide, flatShading: true })));
  }
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3));
  hullWire.add(new THREE.LineSegments(wg,
    new THREE.LineBasicMaterial({ color: 0x7dffcf, transparent: true, opacity: 0.65 })));
  if (blockWireObj) hullWire.add(blockWireObj);   // blocks ride the same overlay
}

// pipes: data.pipes segments are axis-aligned runs {start, dir(0..5=+x,-x,+y,-y,+z,-z),
// length}; connectors drawn as markers at the a/b endpoints
const DIRV = [[1,0,0],[0,1,0],[0,0,1],[-1,0,0],[0,-1,0],[0,0,-1]];
const DIRVM = DIRV.map(d => [d[0], d[1], -d[2]]);   // view-space (z-mirrored) dirs
// Recorded endpoints ARE the connection points: the game writes the cable tip
// at the part's VISIBLE socket (ISW battery: cable tip at the front-face
// socket, while the .ini adapters are the 2x2 terminal grid on the other face
// — snapping nubs to adapter positions unseats them from the cables, v0.99
// regression). Paths are drawn EXACTLY as recorded: no re-routing, no
// per-segment shifts (axis-aligned joints break apart under taper shifts).
const pipeEndsV = [];                             // [{ci, port, v}] — consumed by ?comptest
function buildPipes() {
  pipeGroup.clear();
  adpEndpoint.clear();
  pipeEndsV.length = 0;
  pipePolys.length = 0;
  clearSurges();                              // paths change on rebuild
  const segs = [], endsA = [], endsB = [];
  const sph = (pt) => {
    const g = new THREE.SphereGeometry(0.035, 8, 6);
    g.applyMatrix4(new THREE.Matrix4().makeTranslation(pt[0], pt[1], pt[2]));
    return g;
  };
  const setEp = (ci, port, v) => {
    let m = adpEndpoint.get(ci);
    if (!m) adpEndpoint.set(ci, m = new Map());
    m.set(port, v);
  };
  const portType = (ci, name) => {
    const ad = MODEL.manifest?.[model.data.components[ci]?.type]?.adapters?.find(a => a.name === name);
    return ad ? ad.type : /^(fluid|data|power|lowvoltage|highvoltage)/.exec(name)?.[0] ?? 'connector';
  };
  for (const p of model.data.pipes) {
    // Every segment tube anchors at ITS OWN start (view z-mirrored): the game's
    // cables are NOT a straight chain — joints have 0.04-0.14 m offsets between
    // seg[i].start + dir·len and seg[i+1].start (rounded cap smoothing). The
    // old chained cur += dir·len drifted every pipe and left the endpoint
    // spheres far off the real ports (user's "green spheres don't match").
    const aE = new THREE.Vector3(p.segments[0].start.x, p.segments[0].start.y, -p.segments[0].start.z);
    let cur = aE;
    const pts = [];                           // surge polyline (a-end → b-end)
    for (const s of p.segments) {
      const d = DIRVM[s.dir], L = s.length + 0.01;
      const st = new THREE.Vector3(s.start.x, s.start.y, -s.start.z);
      cur = st.clone().add(new THREE.Vector3(d[0], d[1], d[2]).multiplyScalar(s.length));
      pts.push(st.clone(), cur.clone());
      const g = new THREE.BoxGeometry(d[0] ? L : 0.022, d[1] ? L : 0.022, d[2] ? L : 0.022);
      g.applyMatrix4(new THREE.Matrix4().makeTranslation(
        st.x + d[0] * L / 2, st.y + d[1] * L / 2, st.z + d[2] * L / 2));
      segs.push(g);
    }
    pipePolys.push(pts);
    endsA.push(sph(aE.toArray())); endsB.push(sph(cur.toArray()));
    setEp(p.a_component, p.a_port, aE); setEp(p.b_component, p.b_port, cur);
    pipeEndsV.push({ ci: p.a_component, port: p.a_port, v: aE },
                   { ci: p.b_component, port: p.b_port, v: cur });
  }
  // cable-port nubs sit at the game's endpoint (dedup via the map; type from the
  // manifest adapter so the colour matches the port family)
  for (const [ci, m] of adpEndpoint)
    for (const [port, v] of m)
      adpQueue.push({ x: v.x, y: v.y, z: v.z, t: portType(ci, port), ci, lx: null });
  const add = (geos, color, basic) => {
    if (!geos.length) return;
    const mg = mergeGeometries(geos, false);
    if (basic) mg.computeVertexNormals();
    pipeGroup.add(new THREE.Mesh(mg, basic
      ? new THREE.MeshBasicMaterial({ color })
      : new THREE.MeshStandardMaterial({ color, roughness: 0.9, envMapIntensity: 0 })));
  };
  add(segs, 0x222228, false);
  add(endsA, 0x33ddff, true);
  add(endsB, 0x33ff88, true);
  scheduleAdpFlush();
}
// hull lattice is EXACT (hullfit.js: W=12, pitch=0.25, C=−1.5) and applied
// silently per file in setModel — the manual fit button + offset sliders were
// approximation-era leftovers, removed v0.149 (user: "remove the autofit
// offsets… these things just complicate things").

// ---------- loading / saving ----------
let wsNames = null;
function setModel(obj, srcName) {
  model = obj;
  // workshop link (header): real numeric item ids get a ↗ to the Steam page
  { const w = document.getElementById('wslink');
    if (w) {
      const id = String(model.workshop_item_id || '');
      if (/^\d{6,}$/.test(id) && id !== '0000000000' && id !== '9000000001') {
        w.href = 'https://steamcommunity.com/sharedfiles/filedetails/?id=' + id;
        w.style.display = '';
        const nm = () => w.title = (wsNames && wsNames[id] && wsNames[id].name)
          || (model.data.alias || 'Workshop page for this craft');
        nm();
        if (!wsNames) fetch('workshop.json').then(r => r.ok ? r.json() : null)
          .then(j => { if (j) { wsNames = j; nm(); } }).catch(() => {});
      } else w.style.display = 'none';
    } }
  // rotation storage convention (see viewQuat): palette-bearing files are
  // 2026-generation = conjugate; palette-less = raw Unity LH
  LEGACY_Q = !(Array.isArray(model.data.colors) && model.data.colors.length > 0);
  // block-only files omit these keys — normalise so consumers can iterate freely
  model.data.triangles = model.data.triangles || [];
  model.data.pipes = model.data.pipes || [];
  model.data.colors = model.data.colors || [];   // some files ship no palette
  // Display anchoring (user: the frame·3 anchor offset "makes zero sense"
  // for viewing — it is WHERE THE BUILDER STOOD: Jimmy sits at x=1102 m).
  // Shift the craft's minimal frame to the origin. The shift is a multiple
  // of 3.0 m = 12 cells, so every cell-grid index stays an exact integer
  // (model.cv); craft anchored at frame (0,0,0) — ISW and most of the
  // corpus — get moff = 0 and are bit-identical to before. Saved files are
  // untouched: this is a view-only transform, reports stay raw.
  { const fs = model.data.components;
    const fx0 = fs.length ? Math.min(...fs.map(c => c.frame_x | 0)) : 0;
    const fy0 = fs.length ? Math.min(...fs.map(c => c.frame_y | 0)) : 0;
    const fz0 = fs.length ? Math.min(...fs.map(c => c.frame_z | 0)) : 0;
    model.moff = [-3 * fx0, -3 * fy0, -3 * fz0];
    model.cv = [12 * fx0, 12 * fy0, 12 * fz0];   // raw cell = decode(p − moff) = decode(p) + 12f0
    for (const o of [compGroup, blockGroup, hullGroup, hullWire, pipeGroup, adpGroup, subGroup, occGroup, worldM, surgeGroup])
      o.position.set(model.moff[0], model.moff[1], model.moff[2]);
    for (const k of ['x', 'y', 'z']) { model.box_min[k] += model.moff['xyz'.indexOf(k)]; model.box_max[k] += model.moff['xyz'.indexOf(k)]; } }
  orig = model.data.components.map(c => ({
    pos0: { ...c.position },
    occ0: c.occupancies.map(o => ({ ...o })),
  }));
  selected = -1;
  dirty = false;
  document.body.classList.remove('dirty');
  ensureOrigQ();
  // generic hull-grid fit for this file (no per-blueprint constants)
  const fit = fitHull(model);
  if (fit) {
    Object.assign(hullP, fit);
    toast(`hull fit: grid W=${fit.W} · pitch (${fit.px.toFixed(4)}, ${fit.py.toFixed(4)}, ${fit.pz.toFixed(4)}) m `
        + `· C (${fit.Cx.toFixed(2)}, ${fit.Cy.toFixed(2)}, ${fit.Cz.toFixed(2)}) · anchor ${fit.d.toFixed(1)}m`);
  }
  buildScene();
  fitCameraToModel();          // frame the loaded craft (fog/far scaled)
  buildList();
  buildInspector();
  calibrateCellMass();
  buildAero();
  buildFlight();
  buildHullList();
  // ?open=../testdata/<id>/ files have no workshop alias — show the source
  // id/filename (was: literal 'undefined' in the header, user screenshot)
  $('filestatus').textContent = `— ${model.data.alias || srcName || 'craft'} · ${model.data.components.length} components`;
}

async function fetchDefault() {
  const open = new URLSearchParams(location.search).get('open');
  const urls = open ? [open] : ['blueprint.json', '../testdata/3812927875/blueprint.json'];
  for (const u of urls) {
    let r = null;
    try { r = await fetch(u, { cache: 'no-store' }); } catch { continue; }
    if (!r.ok) continue;
    setModel(await r.json(), u.split('/').slice(-2, -1)[0]);   // let scene-build bugs surface (window.onerror → title)
    return;
  }
  toast('no blueprint.json — drop a file or use “Open file…”');
}

function serialize() {
  const out = structuredClone(model);
  const blocks = out.data.blocks;
  out.data.components.forEach((c, i) => {
    const o = orig[i];
    const cells = {
      x: Math.round((c.position.x - o.pos0.x) / CELL),
      y: Math.round((c.position.y - o.pos0.y) / CELL),
      z: Math.round((c.position.z - o.pos0.z) / CELL),
    };
    c.occupancies.forEach((occ, k) => {
      const b0 = o.occ0[k];
      occ.pos_x = b0.pos_x + cells.x; occ.pos_y = b0.pos_y + cells.y; occ.pos_z = b0.pos_z + cells.z;
      for (const bl of blocks) {                                // keep type-255 mirror in sync
        if (bl.type === 255 && bl.size_x === b0.size_x && bl.size_y === b0.size_y && bl.size_z === b0.size_z
            && bl.pos_x === b0.pos_x && bl.pos_y === b0.pos_y && bl.pos_z === b0.pos_z
            && bl.frame_x === b0.frame_x && bl.frame_y === b0.frame_y && bl.frame_z === b0.frame_z) {
          bl.pos_x += cells.x; bl.pos_y += cells.y; bl.pos_z += cells.z;
        }
      }
    });
  });
  return JSON.stringify(out);                                    // matches game compact format
}

async function save() {
  if (!model) return;
  const text = serialize();
  if (fileHandle) {
    const w = await fileHandle.createWritable();
    await w.write(text); await w.close();
    toast(`saved ${fileHandle.name}`);
  } else {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = 'blueprint.json'; a.click(); URL.revokeObjectURL(a.href);
    toast('downloaded — overwrite blueprint.json (Chrome/Edge “Open file…” enables direct save)');
  }
  dirty = false;
  document.body.classList.remove('dirty');
}

async function openFile() {
  if (window.showOpenFilePicker) {
    [fileHandle] = await window.showOpenFilePicker({
      mode: 'readwrite', types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }] });
    setModel(JSON.parse(await (await fileHandle.getFile()).text()), fileHandle.name.replace(/\.json$/i, ''));
  } else {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json';
    inp.onchange = async () => setModel(JSON.parse(await inp.files[0].text()), inp.files[0].name.replace(/\.json$/i, ''));
    inp.click();
  }
}

$('saveBtn').onclick = save;
$('openBtn').onclick = openFile;
addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); }
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'Escape') select(-1);
  // shortcuts drive the SAME checkboxes as the mouse (v0.147): the checkbox
  // change handler owns exclusivity + visibility, so flip through it.
  const kb = (k) => { const t = viewToggles[k]; if (t) { t.cb.checked = !t.cb.checked;
                       t.cb.dispatchEvent(new Event('change')); } };
  if (e.key === 'g') kb('grid');
  if (e.key === 'o') kb('occ');
  if (e.key === 'h') kb('hull');
  if (e.key === 'f' && selected >= 0) {
    controls.target.copy(compObjs[selected].position);
  }
});
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', async (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (f) setModel(JSON.parse(await f.text()), f.name.replace(/\.json$/i, ''));
});

// ---------- selection & picking ----------
const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
function pick(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  ptr.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ptr, camera);
  const hits = ray.intersectObjects(compGroup.children, true);
  return hits.length ? hits[0].object.userData.ci : -1;
}
// No hover picking (PERF.md #1, user): pointermove fired a recursive
// raycast over every component mesh — during orbit drags too — costing
// 1-10 ms per event on component-heavy crafts. Picking now happens on a
// DELIBERATE press only: one raycast at pointerdown (the moment a drag
// starts), reused by the click test in pointerup.
// Ring presses need NO pick special-case: a ring DRAG moves the pointer, so
// the deliberate-press test below never selects on it; a zero-move press is a
// real click — the trackball applies zero rotation, the click selects.
let downPick = -1;
renderer.domElement.addEventListener('pointerdown', (e) => {
  renderer.domElement.dataset.dx = e.clientX; renderer.domElement.dataset.dy = e.clientY;
  downPick = pick(e);                            // the ONLY scene raycast loop
});
renderer.domElement.addEventListener('pointerup', (e) => {
  const dx = Math.abs(e.clientX - (renderer.domElement.dataset.dx | 0));
  const dy = Math.abs(e.clientY - (renderer.domElement.dataset.dy | 0));
  if (dx < 4 && dy < 4) select(downPick, true);  // canvas click = the ONLY fly trigger (list: dblclick)
});

function select(i, doFly) {
  selected = i;
  invalidate();
  buildInspector();
  buildList();
  paintHighlights();
  syncGizmo();               // rotate gizmo follows the selection
  startSurges(i);              // cable power-surge: fires on every selection
  if (doFly) flyTo(i);         // camera fly is manual-only (canvas click / list dblclick)
}

// ---------- rotate gizmo (Blender-style, v0.150; order fix v0.151) ----------
// Rings on the selected part; the big outer ring is a free trackball, Shift
// snaps to 15°. WYSIWYG ORDER semantics live in the PURE gizmoSpinRing/
// gizmoSpinEye model below (space='local' = intrinsic spin about each ring's
// currently-drawn axis). v0.150 shipped world space — fixed view axes
// spinning while the rings visibly moved with the part: after a 90° pitch
// the next ring no longer spun the axis it showed (user: "I expect it to
// rotate according to what is shown"). Written
// back through the exact inverse of the display chain, so saved files stay
// byte-consistent for BOTH quaternion conventions (rawFromView also strips
// the wheel-droop / junction / button display poses).
// THE PROXY IS MANDATORY: TransformControls writes the ATTACHED object's
// quaternion raw, while components must be written through our pipeline
// (applyGizmoOrientation → dirty flag, realMap mirrors, syncAdapters, and
// rawFromView for the file quaternion incl. droop/junction display-pose
// undo) — and component roots carry scale.z=−1, which would feed negative
// scale into the control's world math. Decompose of the component chain
// yields qv·Ry(π) (THREE absorbs negative det by negating sx) — the RIGHT
// gizmo frame, since its axes are the part's VISIBLE raw axes; see
// applyGizmoOrientation below for the exact round-trip. Pinned by
// ?gizmatest (order algebra + live writeback) and selftest `gizmo=true`.
let gizmoOn = true;
// ---------- gizmo rotation model (PURE — validated by ?gizmatest) ----------
// WYSIWYG order-of-operations, Blender-style: dragging ring k by θ spins the
// part about the axis that ring is DRAWN ALONG right now — the part's own
// axis — i.e. the INTRINSIC update  q ← q·R(e_k, θ), which equals the
// world-space premultiply R(q·e_k, θ)·q through the currently-visible axis.
// Successive drags compose in drag order: after a 90° pitch, the ring that
// now reads as "roll" truly spins the apparent axis (world-space mode, which
// we had first, spins old view axes while the rings visibly moved — the part
// then never turns the way the gesture shows, user report v0.150).
// The big trackball ring instead spins about the camera eye axis (extrinsic,
// inherently screen-consistent). TransformControls space='local' implements
// exactly these two rules; the model functions below are the contract the
// gizmo tests assert, independent of any UI.
const _gUnit = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
const gizmoSpinRing = (q, k, ang) =>
  q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(_gUnit[k], ang)).normalize();
const gizmoSpinEye = (q, eye, ang) =>
  new THREE.Quaternion().setFromAxisAngle(eye.clone().normalize(), ang).multiply(q).normalize();
const gizmoCol = (q, k) => _gUnit[k].clone().applyQuaternion(q);   // visible ring axis
const gizmoShot = new URLSearchParams(location.search).get('shot'); // render stop for screenshots
const gizmoProxy = new THREE.Object3D(); gizmoProxy.name = 'rotProxy';
scene.add(gizmoProxy);
const tctl = new TransformControls(camera, renderer.domElement);
tctl.setMode('rotate');
tctl.space = 'local';                 // ring = part axis (see model above)
tctl.setSize(0.8);
tctl.addEventListener('objectChange', () => applyGizmoOrientation(gizmoProxy.quaternion));
tctl.addEventListener('mouseDown', () => { controls.enabled = false; });
tctl.addEventListener('mouseUp', () => {
  controls.enabled = true;
  buildInspector();                    // rebases the euler sliders on the new pose
  paintHighlights();
  invalidate();
});
scene.add(tctl.getHelper());
const _gq = new THREE.Quaternion();
function syncGizmoPose() {
  const o = compObjs?.[selected];
  if (!o) return;
  scene.updateMatrixWorld(true);
  gizmoProxy.position.setFromMatrixPosition(o.matrixWorld);
  if (!tctl.dragging) gizmoProxy.quaternion.copy(o.getWorldQuaternion(_gq));
}
function syncGizmo() {
  const o = selected >= 0 ? compObjs?.[selected] : null;
  if (gizmoOn && o) { syncGizmoPose(); tctl.attach(gizmoProxy); }
  else tctl.detach();
}
// Proxy pose = obj.quaternion·RY180: THREE decompose() absorbs a negative
// scale by NEGATING SX, so getWorldQuaternion() on the scale.z=−1 root is
// qv·Ry(π), not qv. That stripped frame is the RIGHT gizmo frame — its axes
// are the part's VISIBLE raw axes (x̂, ŷ, −ẑ, the mirror flips z) — and in
// it a local-mode ring drag (P ← P·R(e_k,θ)) maps back by qv ← P·RY180 into
// exactly the WYSIWYG world form qv' = R(drawn axis, θ)·qv. Components must
// still be written through our pipeline (applyGizmoOrientation → dirty
// flag, realMap mirrors, syncAdapters, rawFromView for the file quaternion
// incl. droop/junction display-pose undo). The scene-root proxy also keeps
// the negative-scale root out of the control's own world math. A plain copy
// (no ·RY180) was the v0.150 writeback bug: the part rendered 180° off its
// rings (?gizmatest live/proxy pins). Pinned by ?gizmatest (order algebra +
// live writeback) and selftest `gizmo=true`.
const GIZMO_Y180 = new THREE.Quaternion(0, 1, 0, 0);      // Ry(π), self-inverse
function applyGizmoOrientation(qW) {
  const i = selected, o = compObjs?.[i];
  if (!o) return;
  const qv = qW.clone().multiply(GIZMO_Y180);             // undo decompose's sx flip
  o.quaternion.copy(qv);
  for (const r of realMap.get(i) || []) r.quaternion.copy(qv);
  model.data.components[i].orientation = rawFromView(o, qv);
  syncAdapters(o);
  markDirty();
  invalidate();
}
// Shift = 15° snap, Blender-style
addEventListener('keydown', (e) => { if (e.key === 'Shift') tctl.setRotationSnap(Math.PI / 12); });
addEventListener('keyup', (e) => { if (e.key === 'Shift') tctl.setRotationSnap(null); });
// ---------- selection fly-in + glow ----------
// Fly-in: animate camera+target onto the component (~0.5 s, smoothstep) from
// the current heading — an in-flight pan+approach. The landing spot is picked
// from candidate view directions and validated with a raycast: the first
// direction with a clear line of sight to the part (no hull/blocks/other
// parts in between) wins, so the camera never parks inside a wall; it never
// lands below the ground plane. A user drag cancels the flight.
let fly = null;
const flyRay = new THREE.Raycaster();
flyRay.camera = camera;         // Sprite.raycast (labels) dereferences it
// Landing-spot search: score every candidate direction by how much geometry
// sits between the camera and the part's centre. A fully buried part (cabin
// interior, engine bay) must still end up VISIBLE and on ITS OWN side:
// directions are scored by (occluder count, angle to the part's outward
// normal), so the camera lands in the clear spot nearest the part's exposed
// face — never on the far side of the craft. Distance shrinks for small
// parts so deeply enclosed ones get a genuinely close, unobstructed look.
function flyTo(i) {
  const o = compObjs?.[i];
  if (!o) return;
  const bb = new THREE.Box3().setFromObject(o);
  if (!isFinite(bb.min.x)) return;
  const c = bb.getCenter(new THREE.Vector3());
  const sz = bb.getSize(new THREE.Vector3());
  const r = Math.max(sz.x, sz.y, sz.z, 0.35);
  const dist = Math.min(6, Math.max(0.75, r * 3.4 + 0.4));
  const mc = new THREE.Box3();
  [compGroup, blockGroup].forEach(g => mc.expandByObject(g));
  const out = isFinite(mc.min.x)
    ? c.clone().sub(mc.getCenter(new THREE.Vector3())).setY(r * 0.4)
    : new THREE.Vector3(0, 0.4, 1);
  if (!isFinite(out.x) || out.lengthSq() < 1e-4) out.set(0, 0.4, 1);
  out.normalize();
  const dirs = [out,
    new THREE.Vector3(0.7, 0.5, 0.55).normalize(), new THREE.Vector3(-0.7, 0.5, 0.55).normalize(),
    new THREE.Vector3(0.55, 0.45, -0.8).normalize(), new THREE.Vector3(-0.55, 0.45, -0.8).normalize(),
    new THREE.Vector3(0, 0.95, 0.3).normalize(), new THREE.Vector3(0.92, 0.4, 0.15).normalize(),
    camera.position.clone().sub(controls.target).normalize()];
  const occ = [compGroup, blockGroup];
  if (hullGroup.visible) occ.push(hullGroup);
  let best = null;
  for (const d of dirs) {
    const from = c.clone().addScaledVector(d, dist);
    flyRay.set(from, c.clone().sub(from).normalize());
    flyRay.near = 0; flyRay.far = dist - r * 0.55;
    const score = flyRay.intersectObjects(occ, true)
      .filter(h => h.object.userData.ci !== i && !h.object.userData.isLabel
                   && !h.object.userData.isXray).length;
    const ang = d.angleTo(out);
    if (!best || score < best[0] || (score === best[0] && ang < best[1])) best = [score, ang, d];
    if (!score && d === dirs[0]) break;                       // exposed side: instant
  }
  const dir = best[2];
  const p1 = c.clone().addScaledVector(dir, dist);
  p1.y = Math.max(p1.y, ground.position.y + 0.15);
  fly = { p0: camera.position.clone(), g0: controls.target.clone(), p1, g1: c,
          t0: performance.now(), dur: 520 };
  invalidate();
}
controls.addEventListener('start', () => { fly = null; });   // user takes over
const selBox = new THREE.Box3Helper(new THREE.Box3(), 0x7dffcf);
selBox.visible = false;
selBox.raycast = () => {};                                   // never pickable
selBox.material.depthTest = false;                           // border reads
selBox.material.transparent = true;                          // through everything
selBox.renderOrder = 20;
scene.add(selBox);
function paintHighlights() {
  compGroup.children.forEach((g, i) => {
    g.traverse(o => {
      if (!o.isMesh || !o.material.emissive) return;
      if (i === selected) { o.material.emissive.setHex(0xb85a00); o.material.emissiveIntensity = 1.7; }
      else if (i === hovered) { o.material.emissive.setHex(0x222200); o.material.emissiveIntensity = 1; }
      else { o.material.emissive.setHex(0x000000); o.material.emissiveIntensity = 1; }
    });
  });
  // selection outline: the clearest "what is selected" cue (stays in sync
  // with live edits — this runs on every frame we render)
  if (selected >= 0 && compObjs?.[selected]) {
    const bb = new THREE.Box3().setFromObject(compObjs[selected]);
    selBox.box.copy(bb);
    selBox.visible = isFinite(bb.min.x);
  } else selBox.visible = false;
  // incandescent X-ray layer: synced every rendered frame (tracks sliders
  // live; rebuilt on selection change, model rebuild, proxy→real swap)
  if (selKey !== selected || selPairs.some(([o]) => !o.parent)) rebuildSelXray();
  for (const [o, ov] of selPairs) ov.matrix.copy(o.matrix);
  for (const f of flashes)
    f.mat.opacity = 0.6 * Math.pow(1 - (performance.now() - f.t0) / f.dur, 2);
}

// ---------- cable power-surge + incandescent X-ray highlight ----------
// Selecting a component sends a travelling glow along every connected pipe
// (data.pipes = the cable graph); on arrival the far component blips briefly.
// Paths are the exact drawn cable polylines (per-segment anchored, joint
// zigzag included). Pulses, blips and the selection incandescence all render
// additive with depthTest off — they shine THROUGH the hull (user: "visible
// above anything else, like an incandescence effect"). The on-demand loop
// wakes only while an animation lives.
const pipePolys = [];                       // per-pipe view-space polyline
const surgeGroup = new THREE.Group();
surgeGroup.raycast = () => {};
scene.add(surgeGroup);
const surgeGeo = new THREE.SphereGeometry(0.055, 10, 8);
let surges = [], flashes = [];
const selXrayMat = new THREE.MeshBasicMaterial({ color: 0xff7a20, transparent: true,
  opacity: 0.3, blending: THREE.AdditiveBlending, depthTest: false,
  depthWrite: false, side: THREE.DoubleSide });
let selPairs = [], selKey = -1;
function rebuildSelXray() {
  for (const [, ov] of selPairs) ov.parent && ov.parent.remove(ov);
  selPairs = []; selKey = selected;
  compObjs?.[selected]?.traverse(o => {
    if (!o.isMesh) return;
    const ov = new THREE.Mesh(o.geometry, selXrayMat);
    ov.matrixAutoUpdate = false; ov.matrix.copy(o.matrix);
    ov.renderOrder = 15; ov.raycast = () => {}; ov.userData.isXray = true;
    o.parent.add(ov);
    selPairs.push([o, ov]);
  });
}
function clearSurges() {
  surges.forEach(s => { surgeGroup.remove(s.mesh); s.mesh.material.dispose(); });
  surges = [];
  flashes.forEach(f => { scene.remove(f.grp); f.mat.dispose(); });
  flashes = [];
}
function buildFlash(ci, color = 0x9fe0ff, dur = 620) {   // X-ray blip (arrival / source)
  const grp = new THREE.Group(), mat = new THREE.MeshBasicMaterial({ color,
    transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending,
    depthTest: false, depthWrite: false, side: THREE.DoubleSide });
  grp.raycast = () => {};
  compObjs?.[ci]?.traverse(o => {
    if (!o.isMesh) return;
    o.updateWorldMatrix(true, false);
    const ov = new THREE.Mesh(o.geometry, mat);
    ov.matrixAutoUpdate = false; ov.matrix.copy(o.matrixWorld);
    ov.renderOrder = 16; ov.raycast = () => {}; ov.userData.isXray = true;
    grp.add(ov);
  });
  scene.add(grp);
  flashes.push({ ci, grp, mat, t0: performance.now(), dur });
}
function startSurges(ci) {
  clearSurges();
  if (!model || ci < 0) return;
  // source blip on the SELECTED part: makes the origin of the bolts
  // unmistakable (Jimmy aileron report: far-end travel read as "the prop
  // on the other side fired them")
  buildFlash(ci, 0xffb347, 500);
  model.data.pipes.forEach((p, pi) => {
    let pts = pipePolys[pi], to = -1;
    if (p.a_component === ci) to = p.b_component;
    else if (p.b_component === ci) { to = p.a_component; pts = pts.slice().reverse(); }
    else return;
    if (!pts || pts.length < 2) return;
    const cum = [0];
    for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + pts[k].distanceTo(pts[k - 1]));
    const total = cum[cum.length - 1];
    if (total < 0.05) return;
    const mesh = new THREE.Mesh(surgeGeo, new THREE.MeshBasicMaterial({ color: 0xaef3ff,
      transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending,
      depthTest: false, depthWrite: false }));
    mesh.renderOrder = 17; mesh.raycast = () => {};
    mesh.position.copy(pts[0]);
    surgeGroup.add(mesh);
    surges.push({ pts, cum, total, mesh, to, t0: performance.now(),
                  dur: Math.min(1600, Math.max(550, total * 300)) });
  });
  if (surges.length) invalidate();
}
function stepSurges(now) {
  surges = surges.filter(s => {
    const u = (now - s.t0) / s.dur;
    if (u < 1) {
      let d = u * s.total, k = 1;
      while (k < s.cum.length - 1 && s.cum[k] < d) k++;
      const t = (d - s.cum[k - 1]) / Math.max(1e-6, s.cum[k] - s.cum[k - 1]);
      s.mesh.position.lerpVectors(s.pts[k - 1], s.pts[k], Math.min(1, Math.max(0, t)));
      return true;
    }
    surgeGroup.remove(s.mesh); s.mesh.material.dispose();
    buildFlash(s.to);
    return false;
  });
  flashes = flashes.filter(f => {
    if (now - f.t0 < f.dur) return true;
    scene.remove(f.grp); f.mat.dispose();
    return false;
  });
  if (surges.length || flashes.length) invalidate();
}

// ---------- component list ----------
function buildList() {
  const list = $('complist'), q = $('filter').value.toLowerCase();
  list.innerHTML = '';
  model?.data.components.forEach((c, i) => {
    if (q && !c.type.toLowerCase().includes(q)) return;
    const d = document.createElement('div');
    d.innerHTML = `<span class="i">${String(i).padStart(2, '0')}</span> <span class="t">${c.type}</span>`
                + (c.alias ? ` “${c.alias}”` : '');
    if (i === selected) d.classList.add('sel');
    d.onclick = () => select(i);
    d.ondblclick = () => select(i, true);          // dblclick = fly to part
    list.appendChild(d);
  });
}
$('filter').oninput = buildList;

// ---------- DevTools-style inspector ----------
function row(sec, label, min, max, step, value, onInput) {
  const r = document.createElement('div');
  r.className = 'row';
  r.innerHTML = `<label>${label}</label>`;
  const rng = document.createElement('input');
  Object.assign(rng, { type: 'range', min, max, step, value });
  const num = document.createElement('input');
  Object.assign(num, { type: 'number', min, max, step, value });
  const rst = document.createElement('span');
  rst.className = 'rst'; rst.textContent = '⟲'; rst.title = 'reset';
  r.append(rng, num, rst);
  // set() MUST run onInput — presets/⟲ previously only moved the thumb while
  // the model (and the part on screen) stayed put (dead-button bug, v0.147).
  const set = (v, mark = true) => {
    rng.value = num.value = String(v);
    onInput(+v, mark);
    if (mark) { r.classList.add('mod'); markDirty(); }
    // programmatic .value assignment fires NO 'input' event, so the global
    // input→invalidate listener never saw ⟲/presets — sliders moved while the
    // picture stayed frozen (user v0.149: "reset... changes sliders but no
    // visual update is triggered"). Repaint from here.
    invalidate();
  };
  rng.oninput = () => { num.value = rng.value; onInput(+rng.value); };
  num.oninput = () => { if (num.value === '') return; const v = +num.value;
                        if (isFinite(v)) { rng.value = v; onInput(v); } };
  rst.onclick = () => { r.classList.remove('mod'); set(+value, false); };
  sec.appendChild(r);
  return { set, thumb: (v) => { rng.value = num.value = String(v); }, el: r };
}
function markDirty() {
  dirty = true;
  document.body.classList.add('dirty');
  if (model) updateReport();          // live CoM/aero feedback while dragging sliders
  if (gizmoOn && tctl.object === gizmoProxy) syncGizmoPose();   // rings track position edits
}

function secHeader(t) { const h = document.createElement('h3'); h.textContent = t; $('inspector').appendChild(h); }
function secBody() { const s = document.createElement('div'); s.className = 'sec'; $('inspector').appendChild(s); return s; }

function livePos(comp, obj, ax) {
  return (v) => {
    comp.position[ax] = v;                        // data stays in RAW file space
    obj.position[ax] = ax === 'z' ? -v : v;       // object lives in view space
    for (const r of realMap.get(obj.userData.ci) || []) r.position[ax] = ax === 'z' ? -v : v;
    syncAdapters(obj);
    markDirty();
  };
}
function liveRot(comp, obj, q0) {
  const qd = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ');
  const delta = { p: 0, y: 0, r: 0 };
  return (kind) => (deg, mark = true) => {
    delta[kind] = deg * Math.PI / 180;
    e.set(delta.p, delta.y, delta.r);
    qd.setFromEuler(e);
    obj.quaternion.copy(qd).multiply(q0);
    for (const r of realMap.get(obj.userData.ci) || []) r.quaternion.copy(obj.quaternion);
    syncAdapters(obj);
    const q = obj.quaternion;
    comp.orientation = rawFromView(obj, q);         // view quaternion → file (droop stripped)
    if (mark) markDirty();
  };
}

function buildInspector() {
  const insp = $('inspector');
  insp.innerHTML = '';
  const name = $('selname');
  if (selected < 0) { name.innerHTML = '<span class="none">nothing selected — click a component</span>'; return; }

  const comp = model.data.components[selected];
  const obj = compObjs[selected];
  const q0 = obj.quaternion.clone();          // base for rotation deltas = current live rotation
  name.innerHTML = `<b>${comp.type}</b>[${selected}] · ${comp.module}`;

  secHeader('Position (m)');
  const body = secBody();
  const p = comp.position;
  const rx = row(body, 'x', p.x - 2, p.x + 2, 0.005, p.x, livePos(comp, obj, 'x'));
  const ry = row(body, 'y', p.y - 1.5, p.y + 1.5, 0.005, p.y, livePos(comp, obj, 'y'));
  const rz = row(body, 'z', p.z - 2, p.z + 2, 0.005, p.z, livePos(comp, obj, 'z'));
  const foot = document.createElement('div');
  foot.className = 'presets';
  const btn = (t, fn) => { const b = document.createElement('button'); b.className = 'btn'; b.textContent = t;
    b.onclick = fn; foot.appendChild(b); };
  btn('nose 0.25 ▶', () => rz.set(p.z - 0.25));
  btn('◀ tail 0.25', () => rz.set(p.z + 0.25));
  btn('up 0.1', () => ry.set(p.y + 0.1));
  body.appendChild(foot);

  secHeader('Rotation (° deltas, world axes)');
  const rb = secBody();
  const setR = liveRot(comp, obj, q0.clone());
  const rp = row(rb, 'pitch', -180, 180, 0.5, 0, setR('p'));
  rp.el.title = 'world-axis pitch delta; near ±90° the yaw/pitch decomposition gets ambiguous (gimbal lock) — orientation itself is stored as a quaternion and stays exact';
  const ryw = row(rb, 'yaw', -180, 180, 0.5, 0, setR('y'));
  const rrl = row(rb, 'roll', -180, 180, 0.5, 0, setR('r'));
  if (comp.type === 'PilotSeat') {
    const presets = document.createElement('div');
    presets.className = 'presets';
    const pb = (t, v) => { const b = document.createElement('button'); b.className = 'btn'; b.textContent = t;
      b.onclick = () => rp.set(-v); presets.appendChild(b); };
    pb('lean fwd 12°', 12); pb('20°', 20); pb('30°', 30); pb('45°', 45); pb('upright', 0);
    rb.appendChild(presets);
    const note = document.createElement('div');
    note.style.color = 'var(--dim)';
    note.textContent = 'negative pitch = lean toward nose (view +z)';
    rb.appendChild(note);
  }

  secHeader('Component data');
  const db = secBody();
  let shown = 0;
  for (const [k, v] of Object.entries(comp.data ?? {})) {
    if (typeof v === 'boolean') {
      shown++;
      const l = document.createElement('label');
      l.className = 'checkrow';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = v;
      cb.onchange = () => { comp.data[k] = cb.checked; markDirty(); };
      l.append(cb, document.createTextNode(k));
      db.appendChild(l);
    } else if (typeof v === 'number') {
      shown++;
      row(db, k, Math.min(v - 10, -100), Math.max(v + 10, 100), 0.1, v, (nv) => {
        comp.data[k] = nv; markDirty(); });
    } else if (typeof v === 'string' && v.length <= 80) {
      shown++;
      const d = document.createElement('div');
      d.className = 'checkrow';
      d.innerHTML = `<span style="color:var(--dim);font-family:monospace">${k}</span>`;
      const ti = document.createElement('input');
      ti.type = 'text'; ti.value = v;
      ti.oninput = () => { comp.data[k] = ti.value; markDirty(); };
      d.appendChild(ti);
      db.appendChild(d);
    } else if (v && typeof v === 'object') {
      const d = document.createElement('div');
      d.className = 'checkrow';
      d.innerHTML = `<span style="color:var(--dim)">${k} — ${Array.isArray(v) ? `${v.length} items` : 'object'} (not editable here)</span>`;
      db.appendChild(d);
    }
  }
  if (!shown) db.innerHTML = '<span style="color:var(--dim)">no editable fields</span>';

  secHeader('Actions');
  const ab = secBody();
  const reset = document.createElement('button');
  reset.className = 'btn';
  reset.textContent = '⟲ reset this component';
  reset.onclick = () => {
    comp.position = { ...orig[selected].pos0 };
    obj.position.copy(viewPos(comp.position));
    obj.userData.wheelUndo = undefined;
    obj.userData.wType = comp.type;
    applyDisplayPose(obj, viewQuat(orig[selected].q0), orig[selected].q0);
    comp.orientation = { ...orig[selected].q0 };
    buildInspector();
    markDirty();
    toast('component reset');
  };
  ab.appendChild(reset);
}

// capture pristine quaternions (from the file as loaded) for the reset button
function ensureOrigQ() {
  orig.forEach((o, i) => {
    if (!o.q0) {
      const q = model.data.components[i].orientation;
      o.q0 = new THREE.Quaternion(q.x, q.y, q.z, q.w);
    }
  });
}

// ---------- view options ----------
// keyed registry so keyboard shortcuts (and ?uitest) can flip a toggle and
// keep its checkbox in sync — the g/o/h keys used to move groups behind a
// stale checkbox, and 'h' only hid the triangles while blocks stayed.
// (cb.onchange also invalidates: the on-demand loop would otherwise show
// nothing until the next camera interaction — "checkbox does nothing".)
const viewToggles = {};
function buildViewOpts() {
  const s = $('viewopts');
  const toggle = (key, label, targets) => {
    const arr = Array.isArray(targets) ? targets : [targets];
    const l = document.createElement('label');
    l.className = 'checkrow';
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = arr.every(t => t.visible);
    cb.onchange = () => { for (const t of arr) t.visible = cb.checked; invalidate(); };
    l.append(cb, document.createTextNode(label));
    s.appendChild(l);
    viewToggles[key] = { cb, arr };
    return cb;
  };
  toggle('grid', 'ground grid', grid);
  toggle('occ', 'occupancy boxes (type-255)', occGroup);
  // blocks and hull triangles are ONE thing in-game — the hull skin (the
  // user: "they're one and the same thing to us") — so they share a toggle
  const tHull = toggle('hull', 'hull (blocks + triangles)', [blockGroup, hullGroup]);
  const tWire = toggle('wire', 'wireframe (hull)', hullWire);
  // mutually exclusive (user): solid triangles under a wire overlay cost the
  // full fill rate for zero added readability; drawing one replaces the other
  const excl = (a, b) => a.addEventListener('change', () => {
    if (a.checked && b.checked) { b.checked = false; b.dispatchEvent(new Event('change')); }
  });
  excl(tHull, tWire); excl(tWire, tHull);
  if (tWire.checked && tHull.checked) { tHull.checked = false; tHull.dispatchEvent(new Event('change')); }
  toggle('pipes', 'pipes & connectors', [pipeGroup, adpGroup]);
  toggle('subs', 'subgrids (doors/hatches)', subGroup);
  const rl = document.createElement('label');
  rl.className = 'checkrow';
  const rcb = document.createElement('input');
  rcb.type = 'checkbox'; rcb.checked = realModelsOn;
  rcb.onchange = () => setRealModels(rcb.checked);
  rl.append(rcb, document.createTextNode('real game models (off = same-shape low-poly)'));
  s.appendChild(rl);
  const ll = document.createElement('label');
  ll.className = 'checkrow';
  const lcb = document.createElement('input');
  lcb.type = 'checkbox'; lcb.checked = labelsOn;
  lcb.onchange = () => {
    labelsOn = lcb.checked;
    compGroup.traverse(o => { if (o.userData.isLabel) o.visible = labelsOn; });
    invalidate();
  };
  ll.append(lcb, document.createTextNode('labels on interactive/aliased parts'));
  s.appendChild(ll);
  // manual cure for the zoom saga: clears our saved dpr baseline + any
  // inverse CSS zoom we applied. (Chrome's own site-zoom entry can only be
  // cleared by Ctrl+0 in the browser — pages may not touch it.)
  const zb = document.createElement('button');
  zb.className = 'btn';
  zb.textContent = '⟲ reset page zoom (view scale)';
  zb.title = 'Clears the viewer\'s dpr baseline + inverse zoom. If the page is still big, Chrome itself has a saved site zoom: press Ctrl+0.';
  zb.onclick = () => {
    document.documentElement.style.zoom = '';
    try { localStorage.removeItem('archean-dpr-base'); } catch {}
    invalidate();
  };
  s.appendChild(zb);

  const hs = document.createElement('div');
  hs.className = 'sec';
  // rotate gizmo (v0.150, user: "when you select a component you can rotate
  // its axes in an intuitive way, like in blender"): rings attach to the
  // selection, world axes, outer ring = free trackball, Shift = 15° snap.
  const gl = document.createElement('label');
  gl.className = 'checkrow';
  const gcb = document.createElement('input');
  gcb.type = 'checkbox';
  gcb.checked = localStorage.getItem('archean-gizmo') !== '0';    // default ON
  gizmoOn = gcb.checked;
  gcb.onchange = () => {
    gizmoOn = gcb.checked;
    localStorage.setItem('archean-gizmo', gizmoOn ? '1' : '0');
    syncGizmo();
    invalidate();
  };
  gl.append(gcb, document.createTextNode('rotate gizmo on selection (Shift = 15° snap)'));
  hs.append(gl);
  // Hull-lattice pitch/offset sliders + the auto-fit button REMOVED in v0.149
  // (user: "these things just complicate things"): the exact lattice
  // (W=12, pitch=0.25, C=−1.5) that fitHull() proves per file is applied
  // silently on load — there is nothing left to tune by hand.
  row(hs, 'hull opacity', 0.1, 1, 0.05, hullOpacity,
    v => { hullOpacity = v; buildHull(); applyHullOpacity(); });
  const note = document.createElement('div');
  note.style.color = 'var(--dim)';
  note.style.marginTop = '4px';
  note.textContent = 'dims the whole hull skin: blocks, triangle plates and their wireframes.';
  hs.appendChild(note);
  s.appendChild(hs);
}

// ---------- mass & center of mass ----------
// Component masses are estimates (kg); structural blocks = cellMass per 0.25m
// cell. On load, cellMass is calibrated so the total matches blueprint.mass —
// this verifies CoM bookkeeping, and the implied density is shown as a
// plausibility check. Volume-block masses are not in the blueprint.
const COMP_MASS = { PilotSeat: 40, MiniComputer: 2, HudController: 1, Beacon: 1,
  Aileron: 5, SmallWheel: 4, SmallTurboPump: 6, PowerConverter: 2, LowVoltageBattery: 8,
  SolarPanel: 6, FluidJunction: 1, FluidPort: 0.5, RCS: 2, TiltSensor: 0.5, OwnerPad: 1 };
let cellMass = 1.5;
// raw-space subsystems: CoM/flow/arrows are computed from FILE coordinates and
// display through one z-mirror group (physics itself is mirror-consistent)
const worldM = new THREE.Group(); worldM.scale.z = -1; scene.add(worldM);
const comMarker = new THREE.Group();
worldM.add(comMarker);
(function () {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xff8800 }));
  const ax = new THREE.Mesh(new THREE.SphereGeometry(0.015, 6, 4),
    new THREE.MeshBasicMaterial({ color: 0xffcc00 }));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.012, 8, 32),
    new THREE.MeshBasicMaterial({ color: 0xff8800 }));
  ring.rotation.x = Math.PI / 2;
  comMarker.add(m, ring);
})();

function massModel() {
  let compSum = 0, cells = 0, mx = 0, my = 0, mz = 0, tot = 0;
  for (const c of model.data.components) {
    const m = MODEL.manifest?.[c.type]?.mass ?? COMP_MASS[c.type] ?? 2;
    compSum += m;
    mx += m * c.position.x; my += m * c.position.y; mz += m * c.position.z; tot += m;
  }
  for (const b of model.data.blocks) {
    if (b.type === 255) continue;
    const n = (b.size_x + 1) * (b.size_y + 1) * (b.size_z + 1);
    cells += n;
    const m = n * cellMass;
    mx += m * (occWorld(b, 'x') + b.size_x * CELL / 2);
    my += m * (occWorld(b, 'y') + b.size_y * CELL / 2);
    mz += m * (occWorld(b, 'z') + b.size_z * CELL / 2);
    tot += m;
  }
  return { compSum, cells, tot, com: [mx / tot, my / tot, mz / tot],
           declared: model.mass, density: cellMass / (CELL ** 3) };
}

function calibrateCellMass() {
  const { compSum, cells, declared } = massModel();
  cellMass = Math.max(0.01, (declared - compSum) / cells);
}

function updateCoM() {
  const mm = massModel();
  comMarker.position.set(...mm.com);
  comMarker.visible = comMarker.visible;   // controlled by UI checkbox
  return mm;
}

// ---------- aerodynamics (stylized plate model — not CFD) ----------
// Flow: freestream relative wind = -forward*V. Forward = PilotSeat facing
// (seat quaternion × (0,0,-1)), i.e. "the direction the pilot faces".
// Thin-plate normal force Cn = 2π·sinα·cosα (clamped), boxes/wheels as bluff
// bodies. Gives sane comparative numbers per element, not certifiable data.
let aeroPlates = [], flowPts = null, flowData = null, flowTrails = null, flowOn = false;
let flowFast = null, flowLUT = null;   // big-dot fast layer + speed colour ramp
// 3D windsock HUD: camera-anchored top-of-screen, translucent, aims along
// flowDir() and flutters with turbulence/speed — the classic tunnel reference
// for what the streamlines/particles are showing (user request)
const windHud = new THREE.Group();
let sockPivot = null, sockLabel = null;
{ const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.52, 6),
    new THREE.MeshBasicMaterial({ color: 0xc8d2d8, transparent: true, opacity: 0.8, depthTest: false }));
  pole.position.y = 0.26;
  sockPivot = new THREE.Group(); sockPivot.position.y = 0.44;
  const segL = 0.2;
  [[0xff7a1a, 0], [0xf2f2f2, 1], [0xff7a1a, 2]].forEach(([c, i]) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.083 + (2 - i) * 0.028, 0.083 + (2 - i - 1) * 0.028, segL, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85, depthTest: false, side: THREE.DoubleSide }));
    m.rotation.x = Math.PI / 2;          // axis y -> z: tail (wide) streams +z downwind
    m.position.z = i * segL + segL / 2;
    sockPivot.add(m);
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.083, 0.01, 6, 14),
    new THREE.MeshBasicMaterial({ color: 0x2a2a2a, transparent: true, opacity: 0.85, depthTest: false }));
  ring.position.z = 0.004;
  sockPivot.add(ring);
  windHud.add(pole, sockPivot);
  { const cv = document.createElement('canvas'); cv.width = 160; cv.height = 48;
    const tx = new THREE.CanvasTexture(cv);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tx, transparent: true,
      opacity: 0.9, depthTest: false }));
    spr.scale.set(0.52, 0.156, 1);
    spr.position.set(0, -0.16, 0);
    spr.renderOrder = 30;
    windHud.add(spr);
    sockLabel = { cv, tx, spr, last: '' };
  }
  windHud.traverse(o => { o.renderOrder = 30; o.raycast = () => {}; });
  scene.add(camera);                     // camera children (the HUD) render
  camera.add(windHud);
  windHud.position.set(0, 1.18, -3.4);
  windHud.visible = false;
}
function updateWindHud(tms) {
  if (!windHud.visible) return;
  const V = flowState.speed;
  const dv = flowDir();                                    // view-space travel dir
  const dcam = new THREE.Vector3(dv[0], dv[1], -dv[2])     // view -> scene (z mirror)
    .applyQuaternion(camera.quaternion.clone().invert()).normalize();   // world -> cam
  sockPivot.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dcam);
  // droop: only airflow inflates the sock horizontal; in little wind it hangs
  // down the pole (user). ~70 deg droop at 0 m/s, level by 45 m/s
  const infl = clamp(V / 45, 0, 1);
  sockPivot.rotateOnAxis(new THREE.Vector3(1, 0, 0), (1 - infl) * 1.22);
  // flutter ∝ real wind: at 0 m/s the sock is dead still (user), turbulence
  // adds the gustiness on top once there IS wind
  const A = flowState.turb * 0.38 * Math.min(1, V / 25);
  const t = tms * 0.001;
  sockPivot.rotateOnAxis(new THREE.Vector3(0, 1, 0), Math.sin(t * 1.9) * A);
  sockPivot.rotateOnAxis(new THREE.Vector3(1, 0, 0), Math.sin(t * 1.3 + 1) * A * 0.7);
  sockPivot.rotateOnAxis(new THREE.Vector3(1, 0.4, 0).normalize(), Math.sin(t * 4.1) * A * 0.35);
  // speed readout, redrawn only when the text changes
  if (sockLabel) {
    const txt = `${Math.round(V)} m/s`;
    if (txt !== sockLabel.last) {
      sockLabel.last = txt;
      const g = sockLabel.cv.getContext('2d');
      g.clearRect(0, 0, 160, 48);
      g.fillStyle = 'rgba(8,12,16,0.45)';
      g.fillRect(0, 8, 160, 34);
      g.font = 'bold 26px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = infl > 0.55 ? '#eaf4ff' : infl > 0.2 ? '#ffd9a0' : '#9fb4c4';
      g.fillText(txt, 80, 25);
      sockLabel.tx.needsUpdate = true;
    }
  }
}
let flowSm = null, flowSmT = null;      // EMA-smoothed speed/turb per particle
let flowAge = null, flowAgeMax = null;  // particle lifetimes (anti-piling)
let flowPhase = null;                   // per-particle turbulence phase (anti-striping)
// colour map (user's): blue = slow, green/yellow = mid, red = fast; local
// speed normalised on 2x freestream. 64-entry LUT: stepFlow is per-frame.
function flowLutAt(t, out) {          // t in 0..1 -> linear rgb into out[0..2]
  if (!flowLUT) {
    flowLUT = new Float32Array(64 * 3);
    const c = new THREE.Color();
    for (let k = 0; k < 64; k++) {
      c.setHSL(0.66 - (k / 63) * 0.64, 1.0, 0.55);
      flowLUT[k * 3] = c.r; flowLUT[k * 3 + 1] = c.g; flowLUT[k * 3 + 2] = c.b;
    }
  }
  const li = (Math.min(1, Math.max(0, t)) * 63) | 0;
  out[0] = flowLUT[li * 3] * 1.7; out[1] = flowLUT[li * 3 + 1] * 1.7; out[2] = flowLUT[li * 3 + 2] * 1.7;
}
const flowMode = { m: 'off' };          // three-way wind-tunnel toggle: 'off' | 'lines' | 'wind'
function setFlowMode(m) {
  flowMode.m = m; flowOn = m === 'wind';
  flowGroup.visible = m !== 'off';
  windHud.visible = m !== 'off';
  if (flowPts) flowPts.visible = m === 'wind';
  if (flowFast) flowFast.visible = m === 'wind';
  if (flowTrails) flowTrails.mesh.visible = m === 'wind';
  for (const o of flowGroup.children)
    if (o.isLine && !o.userData.isTrail || o.userData.isLineHot) o.visible = m === 'lines';
  if (m === 'lines' && !flowGroup.children.some(o => o.userData.isLineHot)) buildStreamlines();
  invalidate();
}
const flowGroup = new THREE.Group(); worldM.add(flowGroup);
const aeroArrows = new THREE.Group(); worldM.add(aeroArrows);
const flowState = { speed: 60, aoa: 4, az: 0, turb: 0.35 };

// ---------- thrust (display + flow direction suggestion) ----------
// Local thrust axes from each propulsor's [TARGET thrust/plasma] node in the
// game .ini (exhaust side -> reaction pushes the craft the other way):
// Big/MiniThruster & Propeller thrust = local -y, SmallThruster = +y.
// Weights are per-class display ratios (the blueprint has no newton figures).
// Arrows render in VIEW space; file-space nose (-z) shows as view +z.
// RCS is SPECIAL: the unit is a fixed multi-nozzle blob (no joint/gimbal in
// its .ini) that the GAME can fire in 5 selectable directions — the blueprint
// stores NOTHING about which. Its lone [TARGET thrust] sits at local +z with
// rotation 0 (not even aimed like the jets' -90; the model's bell flare is on
// +y, so the TARGET is a template pose at best): trusting it drew a
// straight-DOWN thrust arrow at the ISW's nose pod (user: "we have no
// downward pointing propulsion of any kind"). Display rule (user): an RCS is
// propulsion ONLY when nothing else propels the craft, and then "normally it
// pushes backward" — arrow points tail-ward along −flight heading (cockpit
// first, fallback fly-view-+z). FluidPort/FluidJunction are no more
// propulsors than wheels are — they never enter this table.
const THRUST = {
  BigThruster:   { ax: [0, -1, 0], w: 1.0 },
  MiniThruster:  { ax: [0, -1, 0], w: 0.4 },
  SmallThruster: { ax: [0,  1, 0], w: 0.15 },
  RCS:           { ax: null,       w: 0.25 },   // direction = −heading, below
  Propeller:     { ax: [0, -1, 0], w: 0.6 },
};
let thrustArrowsOn = true;
const flowSrc = { mode: 'auto' };          // 'auto' | 'thrust' | 'seat'
let netThrust = null;                                 // {v:[x,y,z] view|null, w, n}
const thrustGroup = new THREE.Group(); worldM.add(thrustGroup);
function buildThrustArrows() {
  thrustGroup.clear();
  netThrust = null;
  if (!model) return;
  const matA = new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0.95 });
  const matN = new THREE.MeshBasicMaterial({ color: 0x53e0ff, transparent: true, opacity: 0.95 });
  let acc = [0, 0, 0], wsum = 0, n = 0;
  let accM = [0, 0, 0], wsumM = 0, nM = 0;      // MAIN drive net (direction)
  // RCS blob rule (see THRUST): treated as propulsion only when it is the
  // SOLE class — "normally it pushes backward, and that's only considered if
  // there's no other props or jets" (user). Its normal push = tail-ward,
  // opposite the flight heading (cockpit first, same source auto flow uses;
  // heading only — a reclined seat is comfort, not yaw).
  const comps = model.data.components;
  const rcsOnly = comps.some(c => c.type === 'RCS')
    && !comps.some(c => c.type in THRUST && c.type !== 'RCS');
  let back = seatFwd() || [0, 0, 1];
  { const fh = Math.hypot(back[0], back[2]);
    back = fh > 0.15 ? [back[0] / fh, 0, back[2] / fh]
      : back.map(x => x / (Math.hypot(...back) || 1)); }
  back = back.map(x => -x);
  comps.forEach((c, i) => {
    const th = THRUST[c.type];
    if (!th) return;
    const o = compObjs?.[i];
    if (!o) return;
    if (c.type === 'RCS' && !rcsOnly) return;   // attitude control beside
                                                // real engines: not drawn
    // axis in the component's VIEW-local frame (x, y, -z), rotated by the
    // display quaternion the mesh actually carries
    const ax = c.type === 'RCS' ? new THREE.Vector3(...back)
      : new THREE.Vector3(th.ax[0], th.ax[1], -th.ax[2])
          .applyQuaternion(o.quaternion).normalize();
    const twoWay = c.type === 'Propeller';     // props thrust BOTH ways:
    if (!twoWay) acc = acc.map((x, k) => x + ax.toArray()[k] * th.w);   // not in the net
    // MAIN DRIVE = BigThruster only; an RCS-ONLY craft has nothing else, so
    // its normal backward push IS its main drive. Mini/Small are landing/trim
    // jets: the old all-RCS main net tilted the ISW's flow to 'wind from
    // below' (user: cockpit, not RCS, defines the flight direction).
    if ((c.type === 'BigThruster' || (c.type === 'RCS' && rcsOnly)) && !twoWay) {
      accM = accM.map((x, k) => x + ax.toArray()[k] * th.w); wsumM += th.w; nM++;
    }
    wsum += th.w; n++;
    const len = 0.45 + th.w * 1.15;
    const g = new THREE.Group();
    const shaft = new THREE.Mesh(cyl(0.035, twoWay ? len * 2 : len), matA);
    shaft.rotation.x = Math.PI / 2;                    // cylinder axis y -> z
    shaft.position.z = twoWay ? 0 : len / 2;
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.26, 10), matA);
    head.rotation.x = Math.PI / 2;
    head.position.z = len + 0.1;
    g.add(shaft, head);
    if (twoWay) {
      const head2 = head.clone();
      head2.rotation.x = -Math.PI / 2;
      head2.position.z = -len - 0.1;
      g.add(head2);
    }
    g.position.copy(o.position);
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), ax);
    g.raycast = () => {};
    thrustGroup.add(g);
  });
  if (n) {
    const L = Math.hypot(...acc);
    // Symmetric RCS banks net to ~0: normalized noise would send the flow
    // in a random direction (the ISW rendered vertical streamlines). Below
    // 15% of total class the net is declared ~0 and flow falls back to seat.
    const strong = L > 0.15 * wsum;
    const LM = Math.hypot(...accM);
    netThrust = {
      v: strong ? acc.map(x => x / L) : null, w: wsum, n,
      // auto flow direction uses ONLY the main drive; null = fall back cockpit
      main: nM > 0 && LM > 0.15 * wsumM ? accM.map(x => x / LM) : null,
    };
    if (strong) {
      const dir = new THREE.Vector3(...netThrust.v);
      const b = model.box_min, B = model.box_max;
      const len = 1.4 + wsum * 0.25;
      const g = new THREE.Group();
      const shaft = new THREE.Mesh(cyl(0.07, len), matN);
      shaft.rotation.x = Math.PI / 2; shaft.position.z = len / 2;
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.6, 12), matN);
      head.rotation.x = Math.PI / 2; head.position.z = len + 0.22;
      g.add(shaft, head);
      g.position.set((b[0] + B[0]) / 2, (b[1] + B[1]) / 2 + 1.1, (b[2] + B[2]) / 2);
      g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      g.raycast = () => {};
      thrustGroup.add(g);
    }
  }
  thrustGroup.visible = thrustArrowsOn;
}
// Cockpit axis (view space): "cockpits almost always face in the right
// direction, so fall back on that assumption if there is ambiguity; the
// PilotSeat with a connection to a Computer takes precedence if contested".
function seatFwd() {
  const comps = model?.data.components;
  if (!comps) return null;
  const seats = [];
  comps.forEach((c, i) => { if (c.type === 'PilotSeat') seats.push(i); });
  if (!seats.length) return null;
  let best = seats[0];
  if (seats.length > 1) {
    const term = new Set();
    comps.forEach((c, i) => {
      if (c.type === 'Computer' || c.type === 'MiniComputer' || c.type === 'OwnerPad') term.add(i);
    });
    const adj = new Map();
    const link = (a, b) => {
      if (a == null || b == null) return;
      if (!adj.has(a)) adj.set(a, new Set()); adj.get(a).add(b);
      if (!adj.has(b)) adj.set(b, new Set()); adj.get(b).add(a);
    };
    (model.data.pipes || []).forEach(p => link(p.a_component, p.b_component));
    const hitsComp = (s) => {
      const seen = new Set([s]), q = [s];
      while (q.length) {
        const x = q.pop();
        if (term.has(x)) return true;
        for (const y of adj.get(x) || []) if (!seen.has(y)) { seen.add(y); q.push(y); }
      }
      return false;
    };
    const win = seats.find(hitsComp);
    if (win != null) best = win;
  }
  const o = compObjs?.[best];
  // LEGACY (raw-quat) files place with a 180-deg-yawed frame (viewQuat
  // (w,-x,-y,z) = modern composed with Rz(180)), so the seat's facing axis
  // is local -z there: measuring +z on Jimmy (v1 file) read the cockpit
  // backwards -> auto wind came from the tail (user: 'all cockpits face the
  // other way, including the computer-linked one').
  return o ? new THREE.Vector3(0, 0, LEGACY_Q ? -1 : 1).applyQuaternion(o.quaternion).toArray() : [0, 0, 1];
}
function flowDir() {
  // Relative wind travels opposite to flight. Auto: MAIN drive net (rockets);
  // landing jets / prop craft are ambiguous, so the cockpit wins (user). The
  // RCS blob enters the nets only as a sole-class backward push (see THRUST).
  // 'flow src' cycles auto/seat/thrust; ?flowsrc= presets it. 'thrust' mode
  // = user override, uses the full net (all thrusters, RCS included).
  const useT = flowSrc.mode === 'thrust' ? netThrust?.v : null;
  // auto = COCKPIT FIRST (user: 'cockpits almost always face in the right
  // direction'): the United airliner's 2 gimbal-tilted BigThrusters netted
  // downward and auto chose 'wind from below' — thrust is only the suggestion
  // for cockpits-less craft (rockets, missiles), and 'thrust' mode = override.
  const f0 = useT ? useT.slice()
    : seatFwd() || netThrust?.main || [0, 0, 1];   // default: fly view +z
  // Use the seat's HEADING (yaw) only. A chair's pitch/roll is a comfort
  // axis: feeding it through raw made reclining the ISW seat shrink the
  // (un-normalised) wind vector — the whole tunnel slowed to cos(pitch)
  // AND pitched — "pitch the chair and the wind direction and speed
  // change" (user). Craft attitude is the AoA slider's job, unit length
  // always; the cockpit-first rule cares which way the pilot FACES.
  const fh = Math.hypot(f0[0], f0[2]);
  const fwd = fh > 0.15 ? [f0[0] / fh, 0, f0[2] / fh]
    : f0.map(x => x / (Math.hypot(...f0) || 1));   // near-vertical (thrust-override
                                                   // net straight up/down): keep 3D

  // 'wind from side' azimuth: rotate the flight axis in yaw before taking
  // the wind direction — props produce thrust BOTH ways (user), so the
  // direction must stay user-controllable, not implied by thrust sign.
  // AoA lives in the WIND-AXIS system: tilt the relative wind (tail-ward,
  // rising) FIRST, then yaw the whole vector with the azimuth. The old
  // order glued the +y tilt to the world, so reversing az=180 kept the
  // 'attack' face on the nose side and drove rising flow into the tail +
  // belly gap (ground blockage): front/back behaved drastically different
  // on near-symmetric Jimmy (user). Now az=180 is a true mirror of az=0.
  const a = flowState.aoa * Math.PI / 180;
  const w = [-fwd[0] * Math.cos(a), Math.sin(a), -fwd[2] * Math.cos(a)];
  const azr = flowState.az * Math.PI / 180;
  const ca = Math.cos(azr), sa = Math.sin(azr);
  return [w[0] * ca + w[2] * sa, w[1], -w[0] * sa + w[2] * ca];
}

function plateFromTri(t) {
  const p = [];
  for (let i = 0; i < 3; i++) {
    // VIEW space (z-mirrored): the flow field, streamlines and seeds all
    // live in the view frame — plates in raw file coords deflected the
    // mirrored craft's opposite side (old 'blocks/components not taken
    // into account' symptom, part 1 of 2).
    p.push([hullPt(t, 'x', i), hullPt(t, 'y', i), -hullPt(t, 'z', i)]);
  }
  const a = p[0], b = p[1], c = p[2];
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const len = Math.hypot(...n) || 1e-9;
  return { name: 'hull', c: [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3],
           n: n.map(x => x / len), area: len / 2, R: Math.sqrt(len / 2 / Math.PI) + 0.15 };
}

// Solid 0.25 m cells (VIEW space): every block (type != 255) plus every
// component's `occupancies` box. sampleVel pushes flow around these, so the
// streamlines wrap the actual voxel hull and protruding parts — the blocks
// ARE taken into account (part 2 of 2 of the user report).
let solidCells = null;
let extGrid = null;                     // {b0:[ix,iy,iz], n:[nx,ny,nz], ext:Uint8Array, counts}
const cellKeyV = (x, y, z) => ((x + 4096) * 8192 + (y + 4096)) * 8192 + (z + 4096);
// Pure voxelization + sealing of a blueprint's `data` in VIEW space (z
// mirrored). Exact universal lattice (W=12, pitch=0.25, C=−1.5, FORMAT.md),
// so it needs no per-file hull fit → selftest can run it on any file.
// ext: 1 = exterior (wind), 2 = cabin (ray-enclosed, windless), 0 = solid/sealed.
function sealStats(data) {
  const cells = new Set();
  const add = (fx, fy, fz, px, py, pz, sx, sy, sz) => {
    // world = (pos + 12·frame)·0.25 − 1.375  (AGENTS: (pos−5.5)·0.25 + frame·3;
    // (12f)·0.25 IS the 3f — do not add frame·3 again, that was the old
    // double-pitch bug making the voxel shell 3 m off at frame ≥ 1)
    for (let i = 0; i <= sx; i++)
      for (let j = 0; j <= sy; j++)
        for (let k = 0; k <= sz; k++)
          cells.add(cellKeyV(
            Math.round(px + i + fx * 12 - 5.5),
            Math.round(py + j + fy * 12 - 5.5),
            -Math.round(pz + k + fz * 12 - 5.5)));
  };
  for (const b of data.blocks || [])
    if (b.type !== 255) add(b.frame_x, b.frame_y, b.frame_z, b.pos_x, b.pos_y, b.pos_z, b.size_x, b.size_y, b.size_z);
  // hull-triangle skins (ISW-241's hull is 21 big prisms; Golden Throne has
  // NO blocks): rasterize each triangle into every cell its surface crosses
  // (0.11 m sampling: every crossed 0.25 m cell gets a hit even on 45° faces),
  // so wind blocks at and seals behind triangle-only hulls.
  const hpt = (t, ax, i) => (t['v' + i + '_' + ax] + 12 * t['frame_' + ax]) * 0.25 - 1.5;
  let triBudget = 500000;
  for (const t of data.triangles || []) {
    const a = [hpt(t, 'x', 0), hpt(t, 'y', 0), -hpt(t, 'z', 0)];
    const e1 = [hpt(t, 'x', 1) - a[0], hpt(t, 'y', 1) - a[1], -hpt(t, 'z', 1) - a[2]];
    const e2 = [hpt(t, 'x', 2) - a[0], hpt(t, 'y', 2) - a[1], -hpt(t, 'z', 2) - a[2]];
    const el = Math.hypot(...e1), e2l = Math.hypot(...e2), e3 = Math.hypot(e1[0] - e2[0], e1[1] - e2[1], e1[2] - e2[2]);
    const n = Math.min(110, Math.max(1, Math.ceil(Math.max(el, e2l, e3) / 0.11)));
    triBudget -= (n + 1) * (n + 2) / 2;
    if (triBudget < 0) break;
    for (let i = 0; i <= n; i++)
      for (let j = 0; j <= n - i; j++) {
        const u = i / n, v = j / n;
        cells.add(cellKeyV(
          Math.round((a[0] + e1[0] * u + e2[0] * v) / 0.25),
          Math.round((a[1] + e1[1] * u + e2[1] * v) / 0.25),
          Math.round((a[2] + e1[2] * u + e2[2] * v) / 0.25)));
      }
  }
  for (const c of data.components || []) {
    // Build = editor construction-site ghost: its own position/occupancies
    // sit far outside the bbox (skip), but its nested blocks are the real
    // closed hatch/door geometry at true grid coords (keep).
    if (c.type !== 'Build')
      for (const o of c.occupancies || [])
        add(o.frame_x, o.frame_y, o.frame_z, o.pos_x, o.pos_y, o.pos_z, o.size_x, o.size_y, o.size_z);
    if (c.type === 'Build' && c.data?.blocks)            // closed hatches seal the hull
      for (const b of c.data.blocks)
        if (b.type !== 255) add(b.frame_x, b.frame_y, b.frame_z, b.pos_x, b.pos_y, b.pos_z, b.size_x, b.size_y, b.size_z);
  }
  // Flood-fill from the padded bbox corner: cells not reachable from outside
  // are SEALED INTERIOR — the wind simulation skips them entirely (user:
  // "wind shouldnt be simulated in something enclosed").
  // Grid from the CELL extent, not the file box: workshop files' box_min/max
  // can clip subgrid geometry (BionicDolphin: 16 m box around a 46 m craft).
  let mnx = 1e9, mny = 1e9, mnz = 1e9, mxx = -1e9, mxy = -1e9, mxz = -1e9;
  for (const k of cells) {
    const z = (k % 8192) - 4096, t = Math.floor(k / 8192);
    const y = (t % 8192) - 4096, x = Math.floor(t / 8192) - 4096;
    if (x < mnx) mnx = x; if (y < mny) mny = y; if (z < mnz) mnz = z;
    if (x > mxx) mxx = x; if (y > mxy) mxy = y; if (z > mxz) mxz = z;
  }
  if (mnx > mxx) return { cells, sealedCount: 0, tooBig: true };       // no geometry
  const b0 = [mnx - 3, mny - 3, mnz - 3];
  const n = [mxx - mnx + 7, mxy - mny + 7, mxz - mnz + 7];
  const size = n[0] * n[1] * n[2];
  if (size > 1600000) return { cells, sealedCount: 0, tooBig: true };   // huge craft: skip sealing
  const solid = new Uint8Array(size), ext = new Uint8Array(size);
  const idx = (x, y, z) => ((y * n[0]) + x) * n[2] + z;
  let solidCount = 0;
  for (const k of cells) {
    const z = (k % 8192) - 4096, t = Math.floor(k / 8192);
    const y = (t % 8192) - 4096, x = Math.floor(t / 8192) - 4096;
    const gx = x - b0[0], gy = y - b0[1], gz = z - b0[2];
    if (gx >= 0 && gy >= 0 && gz >= 0 && gx < n[0] && gy < n[1] && gz < n[2] && !solid[idx(gx, gy, gz)]) {
      solid[idx(gx, gy, gz)] = 1; solidCount++;
    }
  }
  const q = new Int32Array(size);
  let qh = 0, qt = 0;
  q[qt++] = 0; ext[0] = 1;                               // (b0 corner = always outside)
  while (qh < qt) {
    const c = q[qh++];
    // decode MUST match idx = (y*n[0] + x)*n[2] + z: the old (y = %n[1],
    // x = /(n[2]*n[1])) swapped strides turned the 6-neighbour flood into a
    // phantom walk on non-cubic grids, marking sealed interiors wind-open
    // (the mosaic craft's 'leaked' cabin: the shell never leaked)
    const z = c % n[2], t2 = Math.floor(c / n[2]); const x = t2 % n[0], y = Math.floor(t2 / n[0]);
    const nb = [[x + 1, y, z], [x - 1, y, z], [x, y + 1, z], [x, y - 1, z], [x, y, z + 1], [x, y, z - 1]];
    for (const [a, b2, d] of nb) {
      if (a < 0 || b2 < 0 || d < 0 || a >= n[0] || b2 >= n[1] || d >= n[2]) continue;
      const i2 = idx(a, b2, d);
      if (solid[i2] || ext[i2]) continue;
      ext[i2] = 1; q[qt++] = i2;
    }
  }
  // Ray-enclosure pass: cells the flood reached through intake/gap LEAKS
  // that are nevertheless fully shell-enclosed (axial rays in all 6
  // directions hit solid) are CABIN cells — the "Dolphin interior with the
  // doors closed" case: voxel shells of block-built crafts leak through
  // intakes, so pure flood fill alone under-seals. Verified: BionicDolphin
  // (testdata/3417786605) → 253 cabin cells; ISW-241 → 0 (open-tail tube,
  // physically wind-swept: correct).
  // 1-cell PINHOLES count as wall (mosaic crafts art their shells with
  // single-cell holes; the game's pressurisation doesn't leak through those):
  // an open scan cell flanked by solid on both sides IN THE WALL PLANE is
  // bridged. Real openings (doors, tail ramps) flank air -> still leak.
  const sAt = (x, y, z) => (x >= 0 && y >= 0 && z >= 0 && x < n[0] && y < n[1] && z < n[2])
    ? !!solid[idx(x, y, z)] : false;
  for (let i = 0; i < size; i++) {
    if (solid[i] || !ext[i]) continue;
    const z = i % n[2], t2 = Math.floor(i / n[2]); const x = t2 % n[0], y = Math.floor(t2 / n[0]);
    let enc = true;
    for (let d = 0; d < 6 && enc; d++) {
      const ax = d >> 1, sgn = (d & 1) ? -1 : 1;
      for (let a = x + sgn;; a += sgn) {
        if (ax === 0) {
          if (a < 0 || a >= n[0]) { enc = false; break; }
          if (solid[idx(a, y, z)]) break;
          if ((sAt(a, y + 1, z) && sAt(a, y - 1, z)) || (sAt(a, y, z + 1) && sAt(a, y, z - 1))) break;
        } else if (ax === 1) {
          if (a < 0 || a >= n[1]) { enc = false; break; }
          if (solid[idx(x, a, z)]) break;
          if ((sAt(x + 1, a, z) && sAt(x - 1, a, z)) || (sAt(x, a, z + 1) && sAt(x, a, z - 1))) break;
        } else {
          if (a < 0 || a >= n[2]) { enc = false; break; }
          if (solid[idx(x, y, a)]) break;
          if ((sAt(x + 1, y, a) && sAt(x - 1, y, a)) || (sAt(x, y + 1, a) && sAt(x, y - 1, a))) break;
        }
      }
    }
    if (enc) ext[i] = 2;                                          // no-wind cabin
  }
  let sealedCount = 0, sealedSample = null, extCount = 0;
  for (let i = 0; i < size; i++) {
    if (ext[i] === 1) extCount++;
    if (!solid[i] && ext[i] !== 1) {
      sealedCount++;
      if (!sealedSample) {
        const z = i % n[2], t2 = Math.floor(i / n[2]); const x = t2 % n[0], y = Math.floor(t2 / n[0]);
        sealedSample = [(x + b0[0] + 0.5) * 0.25, (y + b0[1] + 0.5) * 0.25, (z + b0[2] + 0.5) * 0.25];
      }
    }
  }
  return { cells, b0, n, ext, extCount, solidCount, sealedCount, sealedSample };
}
function buildSolid() {
  solidCells = null;
  extGrid = null;
  if (!model) return;
  const r = sealStats(model.data);
  solidCells = r.cells;
  extGrid = r.tooBig ? null : r;
}
function inExterior(p) {
  if (!extGrid) return true;
  const cv = model ? model.cv : [0, 0, 0];   // display anchoring (see setModel)
  const gx = Math.round(p[0] / 0.25) + cv[0] - extGrid.b0[0];
  const gy = Math.round(p[1] / 0.25) + cv[1] - extGrid.b0[1];
  const gz = Math.round(p[2] / 0.25) + cv[2] - extGrid.b0[2];
  const n = extGrid.n;
  if (gx < 0 || gy < 0 || gz < 0 || gx >= n[0] || gy >= n[1] || gz >= n[2]) return true;
  return extGrid.ext[((gy * n[0]) + gx) * n[2] + gz] === 1;
}

function buildAero() {
  if (!model) return;
  aeroPlates = [];
  for (const t of model.data.triangles) aeroPlates.push(plateFromTri(t));
  for (const c of model.data.components) {
    const q = viewQuat(c.orientation);                 // VIEW-space pose
    const f = footprint(c);
    const P = [c.position.x, c.position.y, -c.position.z];
    if (c.type === 'Aileron') {
      const n = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      aeroPlates.push({ name: c.position.z < 0 ? 'canard' : 'aileron',
        c: P, n: [n.x, n.y, n.z],
        area: f.x * f.z * 0.72, R: 0.75 });
      const defl = c.position.z < 0 ? 1.05 : 0.12;
      const fl = new THREE.Vector3(0, Math.cos(defl), -Math.sin(defl))   // mirror z
        .applyQuaternion(q).normalize();
      aeroPlates.push({ name: 'flap', c: P, n: [fl.x, fl.y, fl.z], area: f.x * f.z * 0.3, R: 0.4 });
    } else if (c.type === 'SolarPanel') {
      const n = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      aeroPlates.push({ name: 'solar panel', c: P, n: [n.x, n.y, n.z], area: f.x * f.z, R: 1.2 });
    } else if (c.type === 'SmallWheel') {
      aeroPlates.push({ name: 'wheel', bluff: true, c: P,
        n: [0, 0, 1], area: Math.PI * 0.17 * 0.10, R: 0.3 });
    }
  }
  buildSolid();
  buildThrustArrows();
  initFlow();
  updateReport();
}

function sampleVel(p, dir, V) {
  if (extGrid && !inExterior(p)) return [0, 0, 0];   // sealed interior: no wind
  const cv = model ? model.cv : [0, 0, 0];   // display anchoring cell shift
  let v = [dir[0] * V, dir[1] * V, dir[2] * V];
  for (const pl of aeroPlates) {
    const d = (p[0] - pl.c[0]) * pl.n[0] + (p[1] - pl.c[1]) * pl.n[1] + (p[2] - pl.c[2]) * pl.n[2];
    if (Math.abs(d) > 0.5) continue;
    const qd = [(p[0] - pl.c[0]) - d * pl.n[0], (p[1] - pl.c[1]) - d * pl.n[1], (p[2] - pl.c[2]) - d * pl.n[2]];
    const r2 = qd[0] ** 2 + qd[1] ** 2 + qd[2] ** 2, R2 = pl.R * pl.R;
    if (r2 > (R2 + 0.5)) continue;
    const w = Math.exp(-d * d / 0.08) * (r2 < R2 ? 1 : Math.exp(-(r2 - R2) / 0.6));
    const vn = v[0] * pl.n[0] + v[1] * pl.n[1] + v[2] * pl.n[2];
    const s = d >= 0 ? 1 : -1;
    v[0] += pl.n[0] * s * V * 0.9 * w + (vn < 0 ? -pl.n[0] * vn * 1.6 * w : 0);
    v[1] += pl.n[1] * s * V * 0.9 * w + (vn < 0 ? -pl.n[1] * vn * 1.6 * w : 0);
    v[2] += pl.n[2] * s * V * 0.9 * w + (vn < 0 ? -pl.n[2] * vn * 1.6 * w : 0);
  }
  // voxel hull + component occupancy cells (VIEW-space 0.25 m grid): radial
  // push-out from solid cell centres kills inflow and bends the stream —
  // blocks and components now shape the flow, not just the hull triangles.
  if (solidCells && solidCells.size) {
    const cx = Math.floor(p[0] / 0.25), cy = Math.floor(p[1] / 0.25), cz = Math.floor(p[2] / 0.25);
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        for (let k = -1; k <= 1; k++) {
          const rx = cx + i + cv[0], ry = cy + j + cv[1], rz = cz + k + cv[2];
          if (!solidCells.has(cellKeyV(rx, ry, rz))) continue;
          const d = [p[0] - (rx + 0.5) * 0.25 - model.moff[0], p[1] - (ry + 0.5) * 0.25 - model.moff[1], p[2] - (rz + 0.5) * 0.25 - model.moff[2]];
          const r = Math.hypot(d[0], d[1], d[2]);
          if (r > 0.62 || r < 1e-6) continue;
          // influence width 0.1->0.3: with a ~0.3 m reach, each crossed cell
          // boundary delivered one discrete 0.25 m kick -> particles climbed
          // the hull in cell-sized STAIRS (user). Overlapping neighbours
          // make the push continuous; particles hug surfaces as ramps.
          const w = Math.exp(-(Math.max(0, r - 0.18) ** 2) / 0.3);
          const nx = d[0] / r, ny = d[1] / r, nz = d[2] / r;
          const vn = v[0] * nx + v[1] * ny + v[2] * nz;
          // incidence-proportional push-out: the old base 0.6·V fired along
          // EVERY cell normal (roof normals launched front-wind streamlines
          // into the sky = 'radically different' front vs back, user). Now
          // push scales with incoming normal velocity: head-on = strong
          // stagnation, grazing = gentle hug. Front/back behave alike.
          const g = (V * 0.12 + (vn < 0 ? -1.9 * vn : -0.25 * vn)) * w;
          v[0] += nx * g; v[1] += ny * g; v[2] += nz * g;
        }
  }
  // Stylized WAKE DEFICIT (user: 'the response to geometry seems really
  // premature / magical'): inviscid thin-plate flow has NO separation — the
  // air behind a blunt barge ran at full freestream, so the flow appeared
  // to ignore the hull entirely. Real tunnels leave a slow, turbulent wake
  // downstream of the body: walk up to 3 m UPSTREAM along the flow; the
  // first solid cell casts a deficit cone (~60 % at the face, e-folds in
  // 3.5 m). 4th return value = deficit fraction (turbulence/wave coupling).
  let wake = 0;
  if (solidCells && solidCells.size) {
    for (let s = 1; s <= 12; s++) {
      const qx = Math.floor((p[0] - dir[0] * s * 0.25) / 0.25) + cv[0];
      const qy = Math.floor((p[1] - dir[1] * s * 0.25) / 0.25) + cv[1];
      const qz = Math.floor((p[2] - dir[2] * s * 0.25) / 0.25) + cv[2];
      if (solidCells.has(cellKeyV(qx, qy, qz))) { wake = 0.6 * Math.exp(-s * 0.25 / 3.5); break; }
    }
    if (wake) { v[0] *= 1 - wake; v[1] *= 1 - wake; v[2] *= 1 - wake; }
  }
  return wake ? [v[0], v[1], v[2], wake] : v;
}

let flowN = 0;
function flowBudget() {
  // sampleVel scans ALL aeroPlates per particle: hull triangles ARE the
  // sim cost. The game itself approximates physics as crafts grow (user) —
  // mirror that: fewer particles on plate-heavy crafts (giant 6.3 MB craft
  // measured 13 ms/frame at 2200 -> 700 puts it back in budget).
  if (location.search.includes('flowlow')) return 500;           // headless shots
  // measured cost driver = solid-cell lookup pressure (237k-cell giant
  // cost 13 ms at 2200 pts; 16k-cell crafts run full rate at 3 ms)
  const c = solidCells ? solidCells.size : 0, p = aeroPlates.length;
  let n = 2200;
  if (c > 400000) n = 500; else if (c > 100000) n = 900; else if (c > 40000) n = 1400;
  if (p > 6000) n = Math.min(n, 900); else if (p > 2500) n = Math.min(n, 1400);
  return n;
}
function initFlow() {
  flowGroup.clear();
  const N = flowBudget();
  flowN = N;
  flowData = new Float32Array(N * 3);
  flowSm = new Float32Array(N); flowSmT = new Float32Array(N);   // colour EMA
  flowAge = new Float32Array(N); flowAgeMax = new Float32Array(N);
  flowPhase = new Float32Array(N);
  for (let i = 0; i < N; i++) { flowAgeMax[i] = 2 + Math.random() * 5; flowPhase[i] = Math.random() * 6.283; }   // 2..7 s
  const b = model.box_min, B = model.box_max;
  for (let i = 0; i < N; i++) respawn(flowData, i * 3, b, B);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(flowData, 3));
  flowPts = new THREE.Points(g, new THREE.PointsMaterial({
    size: 0.09, sizeAttenuation: true, vertexColors: true, transparent: true, opacity: 0.95,
    // depthTest TRUE: X-ray particles showed the far-side flow THROUGH the
    // hull — the wing's occlusion shadow in that field read as an offset
    // ghost 'echo' of the plane (user: United airliner, low wind)
    depthTest: true }));
  flowPts.renderOrder = 12;
  flowPts.raycast = () => {};
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  flowGroup.add(flowPts);
  // fast-flow layer: accelerated air (over canopy, in gaps) draws as BIG dots
  // (user: diverted wind should be 'thicker'); shares the position buffer so
  // moving it costs nothing, its own colour buffer hides slow particles
  // (black + additive = invisible).
  const gf = new THREE.BufferGeometry();
  gf.setAttribute('position', g.attributes.position);
  gf.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  flowFast = new THREE.Points(gf, new THREE.PointsMaterial({
    size: 0.2, sizeAttenuation: true, vertexColors: true, transparent: true, opacity: 0.95,
    depthTest: true, blending: THREE.AdditiveBlending }));
  flowFast.renderOrder = 13;
  flowFast.raycast = () => {};
  flowGroup.add(flowFast);
  // motion trails: prev->cur segments, additive, depthTest off so the wind
  // reads over the hull (the plain wavy lines alone read as 'not good enough')
  flowTrails = {
    pos: new Float32Array(N * 6),
    col: new Float32Array(N * 6),
  };
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.BufferAttribute(flowTrails.pos, 3));
  tg.setAttribute('color', new THREE.BufferAttribute(flowTrails.col, 3));
  const tmesh = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending,
    depthWrite: false, depthTest: true }));   // real smoke: hidden by the hull
  tmesh.renderOrder = 11;
  tmesh.raycast = () => {};
  tmesh.userData.isTrail = true;                 // not a streamline (mode filter)
  flowGroup.add(tmesh);
  flowTrails.mesh = tmesh;
  flowOn = flowMode.m === 'wind';
  flowGroup.visible = flowMode.m !== 'off';
  windHud.visible = flowMode.m !== 'off';   // ?flow/?lines on load
  flowPts.visible = flowMode.m === 'wind';
  buildStreamlines();
}
// streamlines: integrate the same deflected velocity field both ways from a
// seed grid, so the eye can follow how air is routed around the craft.
// Blue = freestream speed, red = accelerated flow (stylized, not CFD).
function buildStreamlines() {
  const _b0 = performance.now();
  for (const o of [...flowGroup.children])
    if ((o.isLine && !o.userData.isTrail) || o.userData.isLineHot) flowGroup.remove(o);
  if (!model || flowMode.m !== 'lines') return;
  const V = Math.max(1, flowState.speed), dir = flowDir();
  const b = model.box_min, B = model.box_max;
  const matS = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 });
  const ALL = [], ALLC = [], ALLF = [], ALLFC = [];
  const rgb = [0, 0, 0];
  // DEVIATION map (user: show velocity DIFFERENCES, blue=low red=high):
  // freestream = blue, slowed flow = deep blue, accelerated = yellow->red.
  // The old absolute map put freestream mid-ramp = green = ground colour,
  // so 4 m/s streamlines were invisible over the plane (user's dolphin shot).
  const gA = 2.0 * V / (V + 40);
  const devT = (sp) => clamp(0.5 + (sp / V - 1) * gA, 0, 1);
  // Colour INTENSITY uses ABSOLUTE deviation (dynamic pressure scales V²):
  // at 25 m/s the nose sees ±3 m/s = muted ramp; at 150 m/s ±45 m/s = full
  // blue/red. Inviscid pattern SHAPE is speed-invariant (physics), so the
  // intensity is the honest visible answer to the speed slider (user).
  const colOf = (sp, arr) => { flowLutAt(devT(sp), rgb); arr.push(rgb[0], rgb[1], rgb[2]); };
  // Seed plane PERPENDICULAR to the flow, one body-radius upstream — the old
  // fixed x·y/z-centre grid only made sense for pure tailward flow; with wind
  // azimuth / vertical thrust flow it seeded inside the hull.
  const dv = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize();
  const cen = new THREE.Vector3((b.x + B.x) / 2, (b.y + B.y) / 2, (b.z + B.z) / 2);
  const ref = Math.abs(dv.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const e1 = ref.cross(dv).normalize();
  const e2 = new THREE.Vector3().crossVectors(dv, e1).normalize();
  const rad = Math.hypot(B.x - b.x, B.y - b.y, B.z - b.z) / 2 * 1.1 + 0.5;
  const sga = location.search.includes('flowlow') ? 1.1 : 0.55;   // coarser seed grid
  const R2 = (rad + 6.5) * (rad + 6.5);   // lines survive far past the craft (user: 'start long enough ahead')
  const FA = 0.055;                                            // 'thick line' offset
  const FASTOFF = [[0, 0, 0],
    [e1.x * FA, e1.y * FA, e1.z * FA], [-e1.x * FA, -e1.y * FA, -e1.z * FA],
    [e2.x * FA, e2.y * FA, e2.z * FA], [-e2.x * FA, -e2.y * FA, -e2.z * FA]];
  for (let a = -rad; a <= rad; a += sga * 1.7)
    for (let c2 = -rad; c2 <= rad; c2 += sga) {
      if (a * a + c2 * c2 > rad * rad) continue;              // disc, not square
      const seed = cen.clone().addScaledVector(dv, -(rad + 5))   // generous approach run-in
        .addScaledVector(e1, a).addScaledVector(e2, c2);
      const seedA = [seed.x, seed.y, seed.z];
      const ph = a * 0.9 + c2 * 1.4;                          // wake meander phase
      const fwd = [], fc = [], back = [], bc = [], spsF = [], spsB = [];
      const walk = (sgn, pts, cs, sps) => {
        let p = [...seedA];
        // heading low-pass + speed EMA: a 0.35 m step through the 0.25 m
        // voxel field flips cell normals frame to frame — raw integration
        // drew lightning-bolt zigzags coloured by the spiking |v| (a rainbow
        // 'turbulence' cloud around the craft, user screenshot). Limiting the
        // turn rate per step keeps smooth hull-hugging bends; 1-cell spikes
        // average out, colours stop flickering.
        let hx = sgn * dir[0], hy = sgn * dir[1], hz = sgn * dir[2];
        let spSm = V;
        for (let k = 0; k < 160; k++) {
          const v = sampleVel(p, dir, V);
          let sp = Math.hypot(v[0], v[1], v[2]);
          pts.push(p[0], p[1], p[2]);
          spSm += clamp(sp - spSm, -0.12 * V, 0.12 * V);
          sps.push(spSm);
          // wake meander (speed response): every stylised deflection scales
          // with V, so inviscid streamline SHAPE is V-invariant -> the speed
          // slider changed nothing at all (user). Wake unsteadiness grows
          // with speed (stylised Reynolds effect): lateral sine in the
          // accelerated/shear region, amplitude ∝ V.
          // wake meander (the speed response): gated to DECELERATED flow
          // BEHIND the body mid-plane — the wake. The old gate fired on
          // >2 % acceleration, i.e. on nose-flow over the hull: at 150 m/s
          // that whipped 25 deg waves into clean upstream air and streamlines
          // 'magically happened 10 m in front of' the craft (user); the
          // inflow side (shape-invariant, as incompressible flow is) then
          // showed nothing changing with the speed slider. Real tunnels:
          // pattern is speed-invariant, only the wake gets unsteady with
          // Reynolds number — so the waves live in the wake only, amplitude
          // ∝ V: speed 25 = glass-smooth, 150 = full vortex-street billow.
          const wkx = p[0] - cen.x, wky = p[1] - cen.y, wkz = p[2] - cen.z;
          const wake = wkx * dv.x + wky * dv.y + wkz * dv.z;   // + = downstream
          const wm = wake > 0 ? clamp(Math.max(1 - spSm / V, 0.7 * (spSm / V - 1), (v[3] || 0) * 1.3), 0, 0.7) : 0;   // wake deficit + shear-layer billow (rear half only)
          if (wm > 0.05) {
            const mg = Math.sin(k * 0.55 + ph) * wm * V * 0.45 * Math.min(1.6, V / 60);
            v[0] += e1.x * mg; v[1] += e1.y * mg; v[2] += e1.z * mg;
            sp = Math.hypot(v[0], v[1], v[2]);
          }
          colOf(spSm, cs);
          if (sp < V * 0.03) break;                           // sealed interior /
          const dx = p[0] - cen.x, dy = p[1] - cen.y, dz = p[2] - cen.z;  //   stagnation
          if (dx * dx + dy * dy + dz * dz > R2) break;
          const inv = 1 / Math.max(sp, 1e-3);
          const nx = sgn * v[0] * inv, ny = sgn * v[1] * inv, nz = sgn * v[2] * inv;
          const a = 0.3;                                      // heading smoothing
          hx += (nx - hx) * a; hy += (ny - hy) * a; hz += (nz - hz) * a;
          const hl = Math.max(1e-3, Math.hypot(hx, hy, hz));
          // constant 0.35 m spatial steps: speed-scaled steps (0.07·V = 4 m at
          // 60 m/s) leapt straight over the 3 m-wide craft, so side-wind flow
          // never resolved the hull and "didn't cover the craft" (user)
          p = [p[0] + hx / hl * 0.35, p[1] + hy / hl * 0.35, p[2] + hz / hl * 0.35];
        }
      };
      walk(1, fwd, fc, spsF); walk(-1, back, bc, spsB);
      if (fwd.length + back.length < 12) continue;
      const pts = [], cs = [], sps = [];
      for (let k = back.length - 3; k >= 0; k -= 3) { pts.push(back[k], back[k + 1], back[k + 2]); cs.push(bc[k], bc[k + 1], bc[k + 2]); }
      for (let k = spsB.length - 1; k >= 0; k--) sps.push(spsB[k]);
      pts.push(...fwd); cs.push(...fc); sps.push(...spsF);
      for (let k = 0; k + 5 < pts.length; k += 3) {          // polyline → segments
        ALL.push(pts[k], pts[k + 1], pts[k + 2], pts[k + 3], pts[k + 4], pts[k + 5]);
        ALLC.push(cs[k], cs[k + 1], cs[k + 2], cs[k + 3], cs[k + 4], cs[k + 5]);
        // high-speed flow (deflected/accelerated: >1.25·V) gets a THICK hot-red
        // render: 4 offset copies (1px GL lines can't widen) = user "thicker, red"
        const pm = (sps[k / 3] + sps[k / 3 + 1]) / 2;
        if (pm > V * 1.15) {   // accelerated: hot + thick (matches gain-2 map)
          for (const o of FASTOFF) {
            ALLF.push(
              pts[k] + o[0], pts[k + 1] + o[1], pts[k + 2] + o[2],
              pts[k + 3] + o[0], pts[k + 4] + o[1], pts[k + 5] + o[2]);
            ALLFC.push(1, 0.28, 0.1, 1, 0.28, 0.1);
          }
        }
      }
    }
  if (ALL.length >= 6) {
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(ALL), 3));
    lg.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(ALLC), 3));
    flowGroup.add(new THREE.LineSegments(lg, matS));
  }
  if (ALLF.length >= 6) {                     // accelerated flow: hot + thick
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(ALLF), 3));
    lg.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(ALLFC), 3));
    const hot = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false }));
    hot.userData.isTrail = true;              // not removed by streamline rebuild
    hot.userData.isLineHot = true;
    flowGroup.add(hot);
  }
  perfBuild += performance.now() - _b0;
}
function respawn(arr, i, b, B) {
  // Seed UNIFORMLY in bbox inflated by 2.5 m. The old span-scaled upstream
  // shell (0.55·span per axis) put every seed beyond the kill-margin on long
  // craft (dolphin: 25 m out), so particles died the frame they spawned and
  // respawned on that shell — a boiling rainbow cloud 'far ahead of the
  // craft' (user screenshot). Uniform works for any flow direction.
  const M = 1.3;   // MUST stay < the kill margin R (2.6) in stepFlow: spawning
                    // outside it parks particles (instant respawn in place, user)
  for (let att = 0; att < 24; att++) {
    arr[i] = b.x - M + Math.random() * (B.x - b.x + 2 * M);
    arr[i + 1] = b.y - M + Math.random() * (B.y - b.y + 2 * M);
    arr[i + 2] = b.z - M + Math.random() * (B.z - b.z + 2 * M);
    if (!extGrid || inExterior([arr[i], arr[i + 1], arr[i + 2]])) break;   // never seed inside a sealed hull
  }
  if (flowTrails) {                       // trail anchors to the spawn point
    flowTrails.pos[i * 2] = arr[i]; flowTrails.pos[i * 2 + 1] = arr[i + 1]; flowTrails.pos[i * 2 + 2] = arr[i + 2];
    flowTrails.pos[i * 2 + 3] = arr[i]; flowTrails.pos[i * 2 + 4] = arr[i + 1]; flowTrails.pos[i * 2 + 5] = arr[i + 2];
  }
}
function stepFlow(dt) {
  if (!flowData || !flowOn) return;
  const _t0 = perfW0 ? performance.now() : 0;
  const V = Math.max(1, flowState.speed), dir = flowDir();
  const b = model.box_min, B = model.box_max;
  const R = 2.6, tt = performance.now() * 0.0006;   // > respawn margin M (1.3)
  const pos = flowPts.geometry.attributes.position.array;
  const col = flowPts.geometry.attributes.color.array;
  const tp = flowTrails && flowTrails.pos, tc = flowTrails && flowTrails.col;
  const rgb = [0, 0, 0];
  const fc = flowFast && flowFast.geometry.attributes.color.array;
  for (let i = 0, j = 0; i < pos.length; i += 3, j += 6) {
    const px = pos[i], py = pos[i + 1], pz = pos[i + 2];
    const v = sampleVel([px, py, pz], dir, V);
    const sp0 = Math.hypot(v[0], v[1], v[2]);
    // animated turbulence: sinusoidal field, amplitude rising in the
    // wake/shear (where |v| departs from freestream) — laminar far field
    // stays calm blue, separated flow around edges boils red-magenta.
    const wake = clamp(sp0 / V - 1, 0, 1.5) + clamp(v[3] || 0, 0, 1) * 1.3 + 0.12;   // deficit = shear = boiling
    let ta = 0;
    if (flowState.turb > 0 && sp0 > 1e-3) {
      // per-particle phase offset: a shared-phase sine field organises the
      // particles into marching wavy bands — the 'nonsensical echo' the user
      // screenshotted from behind-wind on the ISW. Random phase per particle
      // decorrelates them into eddies.
      const s = 0.7, A = V * 0.16 * flowState.turb * wake, ph = flowPhase[i / 3];
      const tx = A * Math.sin(py * s + tt * 3.5 + ph) * Math.cos(pz * s * 1.3 - tt * 2.8 + ph * 0.7);
      const ty = A * Math.sin(pz * s * 1.1 - tt * 3.2 + ph * 1.3) * Math.cos(px * s - tt * 3.8 + ph);
      const tz = A * Math.sin(px * s * 0.9 + tt * 4.2 + ph * 0.4) * Math.cos(py * s * 1.2 + tt * 2.3 + ph * 1.1);
      v[0] += tx; v[1] += ty; v[2] += tz;
      ta = Math.hypot(tx, ty, tz) / V;
    }
    // Brownian jitter: particles otherwise lane onto voxel-cell boundaries
    // and pile up in stagnation zones into 'spark clusters' (user)
    v[0] += (Math.random() - 0.5) * V * 0.10;
    v[1] += (Math.random() - 0.5) * V * 0.10;
    v[2] += (Math.random() - 0.5) * V * 0.10;
    const sp = Math.hypot(v[0], v[1], v[2]);
    pos[i] += v[0] * dt * 0.35; pos[i + 1] += v[1] * dt * 0.35; pos[i + 2] += v[2] * dt * 0.35;
    const t = clamp(sp / (V * 1.35), 0, 1), tr0 = clamp(ta * 2.2, 0, 1);
    // EMA-smooth speed & turbulence per particle (raw |v| jumps between LUT
    // entries frame to frame = rainbow confetti, user: 'is that right?')
    const pi3 = i / 3;
    const td = clamp(0.5 + (sp / V - 1) * 2.0 * V / (V + 40), 0, 1);   // deviation map: ABSOLUTE intensity (∝V², speed-slider responsive)
    const t2 = flowSm[pi3] + clamp(td - flowSm[pi3], -0.06, 0.06); flowSm[pi3] = t2;
    const tr = flowSmT[pi3] + clamp(tr0 - flowSmT[pi3], -0.06, 0.06); flowSmT[pi3] = tr;
    flowLutAt(t2, rgb);
    // turbulence pushes the colour to hot magenta: 'when wind causes
    // turbulence, it could be visible' (user)
    // stagnation bubbles (inflow vs plate push-out cancel) parked glowing
    // dots mid-air ('inexplicable drag'): real smoke DISSIPATES there, so
    // fade slow particles out as they crawl
    const fade = clamp(sp / (V * 0.15), 0, 1);
    col[i] = (rgb[0] * (1 - tr) + tr) * fade;
    col[i + 1] = (rgb[1] * (1 - tr) + tr * 0.1) * fade;
    col[i + 2] = (rgb[2] * (1 - tr) + tr * 0.9) * fade;
    if (fc) {                                     // fast layer: big red dots
      if (t2 > 0.8) {   // sp > ~1.15V: accelerated (gain-2 map)
        fc[i] = col[i]; fc[i + 1] = col[i + 1]; fc[i + 2] = col[i + 2];
        col[i] *= 0.2; col[i + 1] *= 0.2; col[i + 2] *= 0.2;   // dim the small dot
      } else { fc[i] = 0; fc[i + 1] = 0; fc[i + 2] = 0; }
    }
    if (tp) {                                     // trail: prev -> new
      tp[j] = px; tp[j + 1] = py; tp[j + 2] = pz;
      tp[j + 3] = pos[i]; tp[j + 4] = pos[i + 1]; tp[j + 5] = pos[i + 2];
      tc[j] = col[i] * 0.15; tc[j + 1] = col[i + 1] * 0.15; tc[j + 2] = col[i + 2] * 0.15;
      tc[j + 3] = col[i]; tc[j + 4] = col[i + 1]; tc[j + 5] = col[i + 2];
    }
    // lifetime cap: stagnation makes particles LINGER, so slow zones keep
    // receiving new arrivals -> glowing dust clumps (user's spark clusters)
    const pi0 = i / 3;
    flowAge[pi0] += dt;
    let out = pos[i] < b.x - R || pos[i] > B.x + R || pos[i + 2] < b.z - R || pos[i + 2] > B.z + R
             || pos[i + 1] > B.y + R || sp < V * 0.06 || flowAge[pi0] > flowAgeMax[pi0];
    // hard rule (user): particles must not be inside a sealed hull, and if
    // one gets there (fast step, seeding edge case) it DIES this frame —
    // no visible frame at all, not just the zero-velocity fade
    if (!out && extGrid && !inExterior([pos[i], pos[i + 1], pos[i + 2]])) out = true;
    if (out) { respawn(pos, i, b, B); flowAge[pi0] = 0;
      flowSm[pi0] = flowSmT[pi0] = 0; }   // fresh colour EMA at the new seed
  }
  flowPts.geometry.attributes.position.needsUpdate = true;
  flowPts.geometry.attributes.color.needsUpdate = true;
  if (fc) flowFast.geometry.attributes.color.needsUpdate = true;
  if (tp) {
    flowTrails.mesh.geometry.attributes.position.needsUpdate = true;
    flowTrails.mesh.geometry.attributes.color.needsUpdate = true;
  }
  if (perfW0) { perfFlow += performance.now() - _t0; perfFlowN++; }
}

function computeAero() {
  const V = flowState.speed, qd = 0.5 * 1.225 * V * V;
  const dir = flowDir(), dl = Math.hypot(...dir) || 1, u = dir.map(x => x / dl);
  const fx = { x: 0, y: 0, z: 0 }, cp = { x: 0, y: 0, z: 0 };
  const byKind = {};
  for (const pl of aeroPlates) {
    const s = u[0] * pl.n[0] + u[1] * pl.n[1] + u[2] * pl.n[2];
    const cn = pl.bluff ? 1.05
      : Math.min(2.2, 2 * Math.PI * Math.abs(s) * Math.sqrt(Math.max(0, 1 - s * s)));
    const F = qd * pl.area * cn;
    const f = [pl.n[0] * F * s, pl.n[1] * F * s, pl.n[2] * F * s];   // flow pushes surface along n
    fx.x += f[0]; fx.y += f[1]; fx.z += f[2];
    const w = Math.hypot(f[0], f[1], f[2]);
    cp.x += pl.c[0] * w; cp.y += pl.c[1] * w; cp.z += pl.c[2] * w;
    const e = byKind[pl.name] || (byKind[pl.name] = { n: 0, A: 0, F: 0 });
    e.n++; e.A += pl.area; e.F += w;
  }
  const totF = Math.hypot(fx.x, fx.y, fx.z) || 1e-9;
  return { byKind,
    bodyDrag: fx.x * u[0] + fx.y * u[1] + fx.z * u[2],   // force along relative wind = drag
    bodyLift: fx.y, fx,
    cp: { x: cp.x / totF, y: cp.y / totF, z: cp.z / totF }, V, qd };
}

function dirLabel(v) {
  const [x, y, z] = v;                          // VIEW space: +z = nose
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  if (az >= ax && az >= ay) return z > 0 ? 'nose-ward' : 'tail-ward';
  if (ax >= ay) return x > 0 ? 'right-ward' : 'left-ward';
  return y > 0 ? 'up-ward' : 'down-ward';
}

function updateReport() {
  if (!model) return;
  const mm = updateCoM();
  const A = computeAero();
  const el = $('aeroreport');
  if (!el) return;
  const rows = Object.entries(A.byKind).sort((a, b) => b[1].F - a[1].F)
    .map(([k, e]) => `${k.padEnd(12)} ${String(e.n).padStart(3)}×  A=${e.A.toFixed(2)}m²  F=${e.F.toFixed(1)}N`)
    .join('\n');
  const fwd = flowDir();
  const dl = Math.hypot(...fwd) || 1;
  const axial = (A.cp.x - mm.com[0]) * (fwd[0] / dl) + (A.cp.z - mm.com[2]) * (fwd[2] / dl);
  const mac = model.box_max.z - model.box_min.z;
  const azA = Math.abs(flowState.az);
  const azL = azA < 5 ? 'nose' : azA > 175 ? 'tail'
    : `${azA}° ${flowState.az > 0 ? 'from left' : 'from right'}`;
  el.textContent =
`speed ${flowState.speed} m/s (${(flowState.speed * 3.6).toFixed(0)} km/h) · AoA ${flowState.aoa}° · wind from ${azL} · turb ${flowState.turb.toFixed(2)} · q=${A.qd.toFixed(0)}Pa${flowN && flowN < 2200 ? ` · sim ${flowN} pts (large-craft approx)` : ''}
thrust: ${netThrust ? `${netThrust.n} engine${netThrust.n > 1 ? 's' : ''} · class Σ${netThrust.w.toFixed(2)}${netThrust.v ? ` · net ${dirLabel(netThrust.v)}` : ' · net ~0 (symmetric bank)'} · flow src: ${flowSrc.mode === 'thrust' ? 'thrust (override)' : flowSrc.mode === 'seat' ? 'cockpit' : seatFwd() ? 'cockpit' : netThrust.main ? 'main thrust' : 'nose default'}` : 'no thrusters · flow src: ' + (flowSrc.mode === 'thrust' ? 'none' : 'cockpit')}${extGrid && extGrid.sealedCount > 0 ? `
sealed interior: ${extGrid.sealedCount.toLocaleString()} cells windless (doors closed)` : ''}
mass: declared ${mm.declared.toFixed(1)} kg | computed ${mm.tot.toFixed(1)} kg (${mm.compSum.toFixed(0)} kg parts
      + ${mm.cells} cells × ${cellMass.toFixed(2)} kg → ${mm.density.toFixed(0)} kg/m³) ${
        Math.abs(mm.tot - mm.declared) / mm.declared < 0.02 ? '✔ matches' : '⚠ MISMATCH'}
CoM  x=${mm.com[0].toFixed(2)} y=${mm.com[1].toFixed(2)} z=${mm.com[2].toFixed(2)}
CoP  x=${A.cp.x.toFixed(2)} y=${A.cp.y.toFixed(2)} z=${A.cp.z.toFixed(2)}
static margin (CoM ahead of CoP): ${(axial / mac * 100).toFixed(1)}% MAC ${axial > 0.05 ? '✔ stable' : axial < -0.05 ? '⚠ unstable' : '≈ neutral'}
drag ≈ ${A.bodyDrag.toFixed(1)} N · lift ≈ ${A.bodyLift.toFixed(1)} N · L/D ${
  Math.abs(A.bodyDrag) > 0.01 ? Math.abs(A.bodyLift / A.bodyDrag).toFixed(2) : '∞'}
${rows}
(stylized thin-plate + bluff-body model, sea-level air — comparative insight, not CFD)`;
  aeroArrows.clear();
  const org = new THREE.Vector3(...mm.com);
  const fcol = new THREE.Vector3(A.fx.x, A.fx.y, A.fx.z);
  if (fcol.lengthSq() > 1e-6) fcol.normalize(); else fcol.set(0, 1, 0);
  aeroArrows.add(new THREE.ArrowHelper(fcol, org, 1.2, 0xff4444, 0.2, 0.12));            // net aero force (drag dir)
  aeroArrows.add(new THREE.ArrowHelper(new THREE.Vector3(0, A.bodyLift >= 0 ? 1 : -1, 0), org,
    1.2, 0x44ff66, 0.2, 0.12));                                                          // lift
}

// ---------- flight UI ----------
function buildFlight() {
  const s = $('flight');
  s.innerHTML = '';
  // rebuild ~120 ms after the last drag event (PERF.md #2: a full rebuild
  // per pointer-event ate the whole frame budget); wind mode reads flowState
  // live and needs no rebuild at all
  const debLines = (() => {
    let h = 0;
    return () => { clearTimeout(h); h = setTimeout(() => {
      if (flowMode.m === 'lines') { buildStreamlines(); invalidate(); }
    }, 120); };
  })();
  row(s, 'speed', 0, 160, 1, flowState.speed, v => { flowState.speed = v; updateReport(); debLines(); });
  row(s, 'AoA °', -8, 20, 0.5, flowState.aoa, v => { flowState.aoa = v; updateReport(); debLines(); });
  row(s, 'wind from side °', -180, 180, 5, flowState.az, v => { flowState.az = v; updateReport(); debLines(); });
  row(s, 'turbulence', 0, 1, 0.05, flowState.turb, v => { flowState.turb = v; });
  row(s, 'kg / block cell (0.25 m cube)', 0.2, 20, 0.05, cellMass, v => { cellMass = v; updateReport(); });
  // the 'calibrate cells to declared mass' button was removed (v0.149, user:
  // "I don't understand what that even means"): the calibration runs
  // AUTOMATICALLY on load (setModel), which is what the report's ✔ compares.
  // three-way wind-tunnel toggle: none / streamlines / animated wind
  const FM = [['off', '⏻ off'], ['lines', '≋ streamlines'], ['wind', '💨 wind']];
  const fbtns = [];
  const setFM = () => fbtns.forEach((b, i) => {
    const on = flowMode.m === FM[i][0];
    b.style.background = on ? '#2b6a8f' : '';
    b.style.borderColor = on ? '#53e0ff' : '';
  });
  for (const [m, lab] of FM) {
    const b = document.createElement('button');
    b.className = 'btn'; b.style.marginLeft = '4px'; b.textContent = lab;
    b.title = m === 'lines' ? 'static streamlines around the craft'
      : m === 'wind' ? 'animated wind particles + turbulence trails' : 'no flow display';
    b.onclick = () => { setFlowMode(m); setFM(); };
    fbtns.push(b); s.appendChild(b);
  }
  setFM();
  const comB = document.createElement('button');
  comB.className = 'btn'; comB.style.marginLeft = '4px';
  comB.textContent = 'CoM/arrows: ' + (aeroArrows.visible ? 'on' : 'off');
  comB.onclick = () => { aeroArrows.visible = comMarker.visible = !aeroArrows.visible;
    comB.textContent = 'CoM/arrows: ' + (aeroArrows.visible ? 'on' : 'off'); };
  const thB = document.createElement('button');
  thB.className = 'btn'; thB.style.marginLeft = '4px';
  thB.textContent = 'thrust: ' + (thrustArrowsOn ? 'shown' : 'hidden');
  thB.onclick = () => { thrustArrowsOn = !thrustArrowsOn; thrustGroup.visible = thrustArrowsOn;
    invalidate();
    thB.textContent = 'thrust: ' + (thrustArrowsOn ? 'shown' : 'hidden'); };
  const fsB = document.createElement('button');
  fsB.className = 'btn'; fsB.style.marginLeft = '4px';
  fsB.title = 'Direction the air flows past: net thrust (auto = thrust when the bank is asymmetric, seat nose otherwise)';
  fsB.textContent = 'flow src: ' + flowSrc.mode;
  fsB.onclick = () => {
    flowSrc.mode = flowSrc.mode === 'auto' ? 'seat' : flowSrc.mode === 'seat' ? 'thrust' : 'auto';
    buildStreamlines(); updateReport();
    fsB.textContent = 'flow src: ' + flowSrc.mode;
  };
  s.appendChild(comB); s.appendChild(thB); s.appendChild(fsB);
  const pre = document.createElement('pre');
  pre.id = 'aeroreport';
  pre.style.cssText = 'margin:6px 0 2px;padding:6px;background:var(--panel2);border-radius:4px;font-size:11px;white-space:pre-wrap;color:#cfe';
  s.appendChild(pre);
  updateReport();
}

// ---------- hull element list ----------
function buildHullList() {
  const el = $('hulllist');
  el.innerHTML = '';
  if (!model) return;
  $('hullcount').textContent = `— ${model.data.triangles.length} triangles (toggle in view options)`;
  model.data.triangles.forEach((t, i) => {
    const p = [];
    for (let k = 0; k < 3; k++) p.push([hullPt(t, 'x', k), hullPt(t, 'y', k), hullPt(t, 'z', k)]);
    const e1 = p[1].map((x, j) => x - p[0][j]), e2 = p[2].map((x, j) => x - p[0][j]);
    const area = Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]) / 2;
    const d = document.createElement('div');
    d.style.cssText = 'padding:2px 10px;cursor:pointer;font-family:monospace;';
    d.textContent = `tri ${String(i).padStart(2, '0')}  ${area.toFixed(2)} m²  f(${t.frame_x},${t.frame_y},${t.frame_z})  c${t.colors?.[0] ?? 0}`;
    d.onmouseenter = () => d.style.background = '#2a2836';
    d.onmouseleave = () => d.style.background = '';
    d.onclick = () => {
      hullGroup.visible = true;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(
        p.map((v) => [v[0], v[1], -v[2]]).flat(), 3));          // into view space
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xff3355, side: THREE.DoubleSide }));
      hullGroup.add(m);
      setTimeout(() => hullGroup.remove(m), 1400);
    };
    el.appendChild(d);
  });
}

// ---------- animate (on-demand: iGPUs idle at ~0% until something changes) ----------
let needsRender = true, perfFrames = 0, perfFlowN = 0, perfFlow = 0, perfBuild = 0, loadMs = 0;
let perfW0 = 0, perfArm = 0;   // real-clock window: start (ms) + arm timestamp
let invalSeq = 0;                 // repaint counter: pins assert edits repaint
function invalidate() { needsRender = true; invalSeq++; }
let lastT = 0;
function tick(t) {
  requestAnimationFrame(tick);
  const dt = Math.min(0.05, (t - lastT) / 1000 || 0.016);
  lastT = t;
  if (fly) {
    const u = Math.min(1, (performance.now() - fly.t0) / fly.dur);
    const e = u * u * (3 - 2 * u);                       // smoothstep ease
    camera.position.lerpVectors(fly.p0, fly.p1, e);
    controls.target.lerpVectors(fly.g0, fly.g1, e);
    if (u >= 1) fly = null;
    invalidate();
  }
  stepSurges(performance.now());              // cable pulses + arrival blips
  controls.update();                                  // 'change' event → invalidate
  if (windHud.visible) { updateWindHud(t); invalidate(); }   // sock flutters

  if (labelsOn) for (const o of compGroup.children)   // labels follow dragged/moved parts
    if (o.userData.isLabel) {
      const m = compObjs[o.userData.ci];
      if (m) o.position.set(m.position.x, m.position.y + o.userData.dy, m.position.z);
    }
  if (flowOn) stepFlow(dt);
  { const nowR = Date.now();
    if (perfArm && !perfW0 && nowR >= perfArm) { perfW0 = nowR; perfFrames = 0; }
    if (perfW0 && nowR - perfW0 < 1600) needsRender = true; }
  if (!loadMs && model) {
    loadMs = performance.now();
    if (perfOn) perfArm = Date.now() + 800;   // measure the live scene
  }
  if (!needsRender && !flowOn) return;
  needsRender = false;
  { const wm = flowMode.m === 'wind';
    if (flowPts) flowPts.visible = wm;
    if (flowFast) flowFast.visible = wm;
    if (flowTrails) flowTrails.mesh.visible = wm; }
  paintHighlights();
  renderer.render(scene, camera);
  const sel = selected >= 0 ? model.data.components[selected] : null;
  $('hud').textContent = sel
    ? `${sel.type}[${selected}]  pos(${fmt(sel.position.x)}, ${fmt(sel.position.y)}, ${fmt(sel.position.z)})` +
      `  pitch ${fmt(2 * Math.asin(clamp(-sel.orientation.x, -1, 1)) * 180 / Math.PI)}°`
    : 'Archean blueprint viewer — click a component';
  if (perfW0) {
    perfFrames++;
    const elR = Date.now() - perfW0;
    if (elR >= 1500 || (perfFrames >= 3 && elR >= 250)) {
      document.title = `PERF fps=${(perfFrames / Math.max(1, elR) * 1000).toFixed(1)} draw=${renderer.info.render.calls}` +
        ` flowms=${perfFlowN ? (perfFlow / perfFlowN).toFixed(2) : '-'} buildms=${perfBuild.toFixed(0)} loadms=${loadMs.toFixed(0)}`
        + ` tris=${renderer.info.render.triangles} geo=${renderer.info.memory.geometries}` +
        ` plates=${aeroPlates.length} cells=${solidCells ? solidCells.size : 0} windpts=${flowN}`;
      perfW0 = 0;
    }
  }
}
controls.addEventListener('change', invalidate);
addEventListener('input', invalidate, true);
addEventListener('keydown', invalidate);

// ---------- proxy verification (?proxytest) ----------
// For every component type in the model atlas: build both the light proxy and
// the real game geometry from the same fake component, compare bounding boxes.
// Proxies are approximations; 35% max per-axis deviation is the tolerance.
async function runProxyTest() {
  await loadModelManifest();
  const lines = [];
  let pass = 0, tot = 0;
  for (const t of Object.keys(MODEL.manifest || {})) {
    tot++;
    try {
      const mm = await getModel(t);
      if (!mm) { lines.push(`${t} SKIP (no geometry)`); continue; }
      const col = (mm.info.colliders && mm.info.colliders[0]) ||
                  { min: [-0.15, -0.15, -0.15], max: [0.15, 0.15, 0.15] };
      const cells = [0, 1, 2].map(a => Math.max(0, Math.round((col.max[a] - col.min[a]) / CELL) - 1));
      const fake = {
        type: t, module: 'x', alias: '', colors: {},
        data: t === 'Dashboard' ? { size_x: 60, size_y: 40 } : {},
        // dashboard = GENERATED geometry (centimetres: 60×40 cm = 0.6×0.4 m
        // board, corner pivot); proxy + real paths must agree on that box
        position: { x: 0, y: 0, z: 0 }, orientation: { w: 1, x: 0, y: 0, z: 0 },
        occupancies: [{ frame_x: 0, frame_y: 0, frame_z: 0, pos_x: 5.5, pos_y: 5.5, pos_z: 5.5,
                        size_x: cells[0], size_y: cells[1], size_z: cells[2] }],
      };
      const p = buildRealComponent(fake, mm, 1e9, true);     // decimated (default view)
      const r = buildRealComponent(fake, mm, 1e9, false);    // full game geometry
      const dp = new THREE.Box3().setFromObject(p).getSize(new THREE.Vector3());
      const dr = new THREE.Box3().setFromObject(r).getSize(new THREE.Vector3());
      const rel = Math.max(...['x', 'y', 'z'].map(a => Math.abs(dp[a] - dr[a]) / Math.max(dr[a], 0.05)));
      const ok = rel <= 0.35;
      if (ok) pass++;
      lines.push(`${t.padEnd(24)} ${ok ? 'OK ' : 'BAD'} proxy ${dp.x.toFixed(2)}×${dp.y.toFixed(2)}×${dp.z.toFixed(2)}`
               + `  real ${dr.x.toFixed(2)}×${dr.y.toFixed(2)}×${dr.z.toFixed(2)}  maxdiff ${(rel * 100).toFixed(0)}%`);
    } catch (e) { lines.push(`${t} ERR ${e.message}`); }
  }
  document.body.insertAdjacentHTML('beforeend', `<pre id="out" style="white-space:pre-wrap">${lines.join('\n')}</pre>`);
  const bad = lines.filter(l => l.includes(' BAD')).slice(0, 4).map(l => l.trim().split(' ')[0]).join(',');
  document.title = `PROXYTEST ${pass}/${tot} PASS bad=${bad || 'none'}`;
}

// ---------- component connector test (?comptest) ----------
// data.pipes endpoints ARE the game's own record of where every port sits
// (0.000 m verified, FORMAT.md § Handedness). One sweep over the default
// craft (ISW-241) tests every component that has a cable: each endpoint must
// have (1) an adapter nub, (2) a cable tube, and (3) the owning component's
// MODEL SURFACE within tolerance — so a wrong component pose shows up as a
// model-vertex miss even when the data-driven nub/tube are right.
// PilotSeat is exempt: the user moved it in the editor (its pitch is not
// axis-aligned, and its pose is not derivable from the .ini).
// Beacon is exempt too: the game records its cable endpoints in the
// connector's own upright frame (p + (0,−0.145,±0.062) for ALL orientations),
// which no reading of the .ini adapter reproduces — the .ini model placement
// and the data-driven tube/nub are each correct in their own frame.
async function runCompTest() {
  let tw = Date.now();      // wait for the blueprint to load (setModel)
  while (!model && Date.now() - tw < 10000) await new Promise(r => setTimeout(r, 100));
  const t0 = Date.now();   // let real models load (they are fetched async)
  while (Date.now() - t0 < 8000 && compObjs.some((m, i) =>
      m && MODEL.manifest?.[m.userData.wType] && !realMap.has(i)))
    await new Promise(r => setTimeout(r, 100));
  await new Promise(r => setTimeout(r, 600));    // adapter nubs merge on a 350 ms debounce
  const d = model.data, lines = [];
  let pass = 0, tot = 0;
  const nubVerts = [], tubeVerts = [];
  const grab = (o, arr) => { const a = o.geometry.attributes.position;
    for (let i = 0; i < a.count; i++) arr.push(new THREE.Vector3().fromBufferAttribute(a, i).applyMatrix4(o.matrixWorld)); };
  adpGroup.updateMatrixWorld(true);
  adpGroup.traverse(o => { if (o.geometry) grab(o, nubVerts); });
  const tube0 = pipeGroup.children[0];          // merged tube mesh (children[1..] = end spheres)
  if (tube0) { tube0.updateWorldMatrix(true, true); grab(tube0, tubeVerts); }
  const modelVerts = (ci) => {
    const objs = realMap.get(ci), root = (objs && objs.length && objs[0]) || compObjs[ci];
    root.updateWorldMatrix(true, true);
    const out = [];
    root.traverse(o => { if (o.isMesh) { const a = o.geometry.attributes.position;
      for (let i = 0; i < a.count; i++) out.push(new THREE.Vector3().fromBufferAttribute(a, i).applyMatrix4(o.matrixWorld)); } });
    return out;
  };
  const minDist = (v, arr) => { let m = 1e9; for (const w of arr) m = Math.min(m, v.distanceTo(w)); return m; };
  d.pipes.forEach((p, pi) => {
    const ends = pipeEndsV.slice(pi * 2, pi * 2 + 2);   // shared model with buildPipes
    for (const e of ends) {
      tot++;
      const type = d.components[e.ci].type;
      const dn_ = minDist(e.v, nubVerts), dt = minDist(e.v, tubeVerts);
      const exempt = type === 'PilotSeat' || type === 'Beacon' || type === 'SolarPanel';
      // SolarPanel exempt from the model-surface check: its geometry is a thin
      // plate with vertices only at the 4 corners (1.44 m wide), and the cable
      // tip sits at the plate's edge mid-region ~0.6 m from the nearest corner
      // — nub+tube carry its alignment.
      const dm = exempt ? 0 : minDist(e.v, modelVerts(e.ci));
      const ok = dn_ <= 0.06 && dt <= 0.06 && (exempt || dm <= 0.35);
      if (ok) pass++;
      else lines.push(`pipe${pi} ${type}#${e.ci} port ${e.port}`
        + ` nub=${dn_.toFixed(3)} tube=${dt.toFixed(3)} model=${exempt ? 'exempt' : dm.toFixed(3)}`);
    }
  });
  document.body.insertAdjacentHTML('beforeend',
    `<pre id="out" style="white-space:pre-wrap">${lines.join('\n') || 'all connectors aligned'}</pre>`);
  document.title = `COMPTEST ${pass}/${tot} PASS bad=${lines.length ? lines[0].split(' ')[1] : 'none'}`;
}

// ---------- position tests (?postest&open=<craft>) ----------
// Placement FIXTURES: named positional/boundary checks on the rendered scene,
// keyed per workshop id — these are craft-specific ground-truth probes, the
// deliberate exception to regtest's "generic only" rule (fixtures are allowed
// to name constants; the suite auto-skips craft without a fixture list).
// Expected values come from the game's own records: file positions and
// data.pipes endpoints (pipeEndsV). One junction lesson drives the RCS set:
// FluidJunctions of ISW-241 (modern, conjugate quats) and RCS-infinity
// (3518436870, legacy raw quats) are byte-identical in the files — they must
// render byte-identical, comb flat, ports touching their cable endpoints.
// Report: <pre id=out> lines 'PASS/FAIL name: detail' + title
// 'POSTEST pass/total PASS bad=names' (headless) — quick, positions only.
const POSTESTS = {
  '3812927875': (ctx) => {
    const { fjBoxes, fjIdx } = ctx;
    T('isw-fj-flat', () => {                       // display pose: comb lies flat
      for (const [ci, bb] of fjBoxes) {
        const sy = bb.getSize(tmpV).y;
        if (sy > 0.40) return `FJ#${ci} bbox y-size ${sy.toFixed(2)} m (expect ≤0.40: flat)`;
      }
      return true;
    });
    T('isw-fj-row', () => {                        // row along z at one height
      const cs = fjIdx.map(ci => fjBoxes.find(a => a[0] === ci)[1]
        .getCenter(new THREE.Vector3()));
      const ys = cs.map(v => v.y), zs = cs.map(v => v.z).sort((a, b) => a - b);
      if (Math.max(...ys) - Math.min(...ys) > 0.02) return `y spread ${(Math.max(...ys) - Math.min(...ys)).toFixed(2)}`;
      for (let i = 1; i < zs.length; i++)
        if (Math.abs(zs[i] - zs[i - 1] - 1) > 0.02) return `z gap ${zs[i] - zs[i - 1]}`;
      return true;
    });
    T('isw-fj-cable-side', () => {                 // cables leave below the deck
      for (const e of pipeEndsV.filter(e => fjIdx.includes(e.ci))) {
        const bb = fjBoxes.find(a => a[0] === e.ci)[1];
        if (e.v.y > bb.getCenter(tmpV).y + 0.06) return `pipe end y=${e.v.y.toFixed(2)} above comb mid y=${tmpV.y.toFixed(2)}`;
        if (e.v.y < bb.min.y - 0.35) return `pipe end y=${e.v.y.toFixed(2)} far below comb y=${bb.min.y.toFixed(2)}`;
      }
      return true;
    });
    T('isw-fj-touch', () => {                      // ports at their comb sockets
      // 0.20 m: cable tips sit on the VISIBLE socket (FORMAT.md), which sits
      // 0.14 m off the proxy collider box; a rotated pose lands 0.27+ m off.
      for (const e of pipeEndsV.filter(e => fjIdx.includes(e.ci))) {
        const bb = fjBoxes.find(a => a[0] === e.ci)[1];
        const d = bb.distanceToPoint(e.v);
        if (d > 0.20) return `port ${e.port} ${d.toFixed(2)} m off bbox`;
      }
      return true;
    });
  },
  '3518436870': (ctx) => {
    const { fjBoxes, fjIdx, comps } = ctx;
    T('rcs-fj-flat', () => {                       // legacy raw-quat file: same flat comb
      for (const [ci, bb] of fjBoxes) {
        const sy = bb.getSize(tmpV).y;
        if (sy > 0.40) return `FJ#${ci} bbox y-size ${sy.toFixed(2)} m (expect ≤0.40: flat, matches ISW byte-identical quat)`;
      }
      return true;
    });
    T('rcs-fj-row', () => {                        // row height ≈ file position y 0.88
      for (const [ci, bb] of fjBoxes) {
        const y = bb.getCenter(tmpV).y, fy = comps[ci].position.y;
        if (Math.abs(y - fy) > 0.25) return `FJ#${ci} centre y=${y.toFixed(2)} vs file y=${fy.toFixed(2)}`;
      }
      return true;
    });
    T('rcs-fj-cable-side', () => {
      for (const e of pipeEndsV.filter(e => fjIdx.includes(e.ci))) {
        const bb = fjBoxes.find(a => a[0] === e.ci)[1];
        if (e.v.y > bb.getCenter(tmpV).y + 0.06) return `pipe end y=${e.v.y.toFixed(2)} above comb mid y=${tmpV.y.toFixed(2)}`;
        if (e.v.y < bb.min.y - 0.35) return `pipe end y=${e.v.y.toFixed(2)} far below comb y=${bb.min.y.toFixed(2)}`;
      }
      return true;
    });
    T('rcs-fj-touch', () => {
      for (const e of pipeEndsV.filter(e => fjIdx.includes(e.ci))) {
        const bb = fjBoxes.find(a => a[0] === e.ci)[1];
        const d = bb.distanceToPoint(e.v);
        if (d > 0.20) return `port ${e.port} ${d.toFixed(2)} m off bbox (pose rotated?)`;
      }
      return true;
    });
  },
};
// harness state at module scope: the POSTESTS fixture closures above capture
// this scope, so T/tmpV must live here (runPosTest resets the counters).
const tmpV = new THREE.Vector3();
let ptLines = [], ptPass = 0, ptTot = 0;
const T = (name, fn) => {
  ptTot++;
  let r = true;
  try { r = fn(); } catch (e) { r = 'threw ' + e.message; }
  if (r === true) { ptPass++; ptLines.push(`PASS ${name}`); }
  else ptLines.push(`FAIL ${name}: ${r}`);
};
// generic button suite: runs on EVERY postest craft (all 24 corpus craft
// have buttons, 22 legacy + 2 modern — this is the format-pair sweep).
// Derivation from the .ini (no rendered-state trust): ToggleButton lever =
// node at (0,−0.16,0) under JOINT axle/axle2 with ZYX euler (18°,0,∓180°),
// so the state-keyed lever centre sits at
//     pivot + qV · mirror_z( Rz(0|−π)·Rx(18°) · (0,−0.16,−0.018) )
// — mirror_z = the viewer's root scale.z=−1, qV = viewQuat (legacy-raw vs
// modern-conjugate aware). A state-agnostic renderer (both levers, or the
// wrong one) fails one-lever; a convention bug fails lever-pose.
const nodeMeshes = (root, name) => {
  const out = [];
  root.traverse(o => { if (o.userData.node === name) out.push(o); });
  return out;
};
function btnSuite(ctx) {
  const { comps, objs } = ctx;
  const RAD = Math.PI / 180;
  // decimated/real models are added to realMap (proxy root hidden) — probe
  // the visible root, same pattern as comptest
  const rootOf = (i) => realMap.get(i)?.[0] || objs[i];
  T('btn-one-lever', () => {
    for (const [i, c] of comps.entries()) {
      if (c.type !== 'ToggleButton' || !objs[i]) continue;
      const on = ['switch', 'switch2'].filter(n => nodeMeshes(rootOf(i), n).length);
      if (on.length !== 1) {
        const tags = [];
        rootOf(i).traverse(o => { if (o.userData.node) tags.push(o.userData.node); });
        return `TB#${i} renders ${on.length} levers — have tags=[${tags.join(',')}]`;
      }
    }
    return true;
  });
  T('btn-lever-pose', () => {
    // Game MOUNTS the button base_planes-flush (mount face = plate front,
    // cockpit side), baking a local yaw-180 into the model: the plate covers
    // the hull gap facing the pilot, the lever hides in the wall. Raw
    // file-quat placement puts the plate BEHIND the pivot (dolphin/Cede:
    // "gap in the fuselage, button further back"). View-space lever centre:
    //   pivot + qV · mirror_z( yaw180 · Rx(18°) · Rz(0|−π) · (0,−0.16,−0.018) )
    // (pressed = axle z−180: lever flips UP out of the mount, deck buttons).
    for (const [i, c] of comps.entries()) {
      if (c.type !== 'ToggleButton' || !objs[i]) continue;
      const lever = nodeMeshes(rootOf(i), c.data?.state ? 'switch' : 'switch2')[0];
      if (!lever) return `TB#${i} state=${!!c.data?.state} lever mesh missing`;
      const off = new THREE.Vector3(0, -0.16, -0.018);
      off.applyEuler(new THREE.Euler(18 * RAD, 0, c.data?.state ? -Math.PI : 0, 'ZYX'));
      off.applyEuler(new THREE.Euler(0, Math.PI, 0));           // baked yaw-180
      off.z = -off.z;                                           // root scale.z = −1
      const exp = viewPos(c.position).add(off.applyQuaternion(viewQuat(c.orientation)));
      const d = new THREE.Box3().setFromObject(lever).getCenter(tmpV).distanceTo(exp);
      if (d > 0.07)
        return `TB#${i} lever centre ${tmpV.toArray().map(v => v.toFixed(2))} vs mounted ${exp.toArray().map(v => v.toFixed(2))} (${d.toFixed(2)} m)`;
    }
    return true;
  });
  T('btn-plate-flush', () => {
    // plate (base) centre under the mount bake: pivot + qV·(0,−0.059,+0.334)
    // view = plate box 0.08 in FRONT of the mount face (file −z = cockpit);
    // raw placement puts it 0.34 BEHIND the pivot (into/behind the wall).
    for (const [i, c] of comps.entries()) {
      if (c.type !== 'ToggleButton' || !objs[i]) continue;
      const base = nodeMeshes(rootOf(i), 'base')[0];
      if (!base) return `TB#${i} base mesh missing`;
      const off = new THREE.Vector3(0, 0.05, 0.335);   // base bbox centre, yaw180+mirror
      const exp = viewPos(c.position).add(off.applyQuaternion(viewQuat(c.orientation)));
      const d = new THREE.Box3().setFromObject(base).getCenter(tmpV).distanceTo(exp);
      if (d > 0.08)
        return `TB#${i} plate centre ${tmpV.toArray().map(v => v.toFixed(2))} vs mounted ${exp.toArray().map(v => v.toFixed(2))} (${d.toFixed(2)} m — raw yaw?)`;
    }
    return true;
  });
  T('btn-base-single', () => {
    for (const [i, c] of comps.entries()) {
      if (!['ToggleButton', 'PushButton'].includes(c.type) || !objs[i]) continue;
      if (c.data?.isDualSided) continue;
      if (nodeMeshes(rootOf(i), 'base2').length)
        return `${c.type}#${i} draws base2 on a single-sided button (z-fight ghost)`;
    }
    return true;
  });
}
async function runPosTest() {
  let tw = Date.now();
  while (!model && Date.now() - tw < 10000) await new Promise(r => setTimeout(r, 100));
  if (!model) { document.title = 'POSTEST ERR no model'; return; }
  await new Promise(r => setTimeout(r, 600));      // scene built + merged
  const t0 = Date.now();                           // real/low models load async
  while (Date.now() - t0 < 8000 && compObjs.some((m, i) =>
      m && MODEL.manifest?.[m.userData.wType] && !realMap.has(i)))
    await new Promise(r => setTimeout(r, 100));
  compGroup.updateMatrixWorld(true);
  const id = String(model.workshop_item_id ?? '');
  const suite = POSTESTS[id];
  ptLines = []; ptPass = 0; ptTot = 0;
  const fjIdx = model.data.components
    .map((c, i) => c.type === 'FluidJunction' && compObjs[i] ? i : -1).filter(i => i >= 0);
  const fjBoxes = fjIdx.map(ci => [ci, new THREE.Box3().setFromObject(compObjs[ci])]);
  const btnCtx = { comps: model.data.components, objs: compObjs, fjIdx, fjBoxes };
  btnSuite(btnCtx);                                    // generic, every craft
  if (suite) suite(btnCtx);
  document.body.insertAdjacentHTML('beforeend',
    `<pre id="out" style="white-space:pre-wrap">${ptLines.join('\n') || 'no fixtures for ' + id}</pre>`);
  const bad = ptLines.filter(l => l.startsWith('FAIL')).map(l => l.slice(5, l.indexOf(':')));
  document.title = `POSTEST ${ptPass}/${ptTot} ${bad.length ? 'FAIL' : 'PASS'}${suite ? '' : ' SKIP'} bad=${bad.join(',') || 'none'}`;
}

// ---------- ?gizmatest: rotation-order contract for the rotate gizmo ----------
// Works on a SYNTHETIC single-component blueprint (one PilotSeat, identity
// orientation) with the camera focused IN FRONT of the seat (pilot faces the
// camera) — the user-suggested isolation for "rotate as it is SHOWN".
// Structure per user: the spin algebra lives in the pure gizmoSpinRing/
// gizmoSpinEye functions (UI-free, asserted here directly); TransformControls
// is configured to implement exactly that rule (space='local' applies
// q·R(e_k,θ) = R(visible axis,θ)·q); the writeback (applyGizmoOrientation →
// rawFromView) is the UNCHANGED v0.150 blueprint path, proven to carry the
// chained pose into the file quaternion bit-true.
// ?gizmatest&shot=1|2|3 leaves the demo scene at before / +pitch90 /
// +pitch90+roll90 for headless screenshots.
async function runGizmoTest() {
  const fails = []; let nPins = 0;
  const ok = (nm, cond) => { nPins++; if (!cond) fails.push(nm); };
  try {
    let tw = Date.now();   // let the default load finish (manifest + scene) first
    while (!model && Date.now() - tw < 10000) await new Promise(r => setTimeout(r, 100));
    if (!model) { document.title = 'GIZMATEST ERR no baseline'; return; }
    // one-component blueprint; data.colors PRESENT so LEGACY_Q=false
    const seatBp = () => ({ version: 2, mass: 40, type: 'Archean Build Blueprint',
      author: 'gizmatest', datetime: '2026-10-09 00:00:00', workshop_item_id: 9000000002,
      box_min: { x: -0.4, y: 0, z: -0.4 }, box_max: { x: 0.4, y: 0.9, z: 0.4 },
      box_size: { x: 0.8, y: 0.9, z: 0.8 },
      data: { alias: 'gizmatest seat', colors: [
          { r: 200, g: 200, b: 200, opacity: 15, roughness: 0, metallic: 0 },
          { r: 90, g: 90, b: 90, opacity: 15, roughness: 0, metallic: 0 }],
        components: [{ type: 'PilotSeat', module: 'ARCHEAN_pilot_seat',
          position: { x: 0, y: 0, z: 0 }, frame_x: 0, frame_y: 0, frame_z: 0,
          orientation: { w: 1, x: 0, y: 0, z: 0 },
          colors: { color1: 0, color2: 1 }, data: {}, occupancies: [] }],
        blocks: [], triangles: [], pipes: [] } });
    const aimCamera = () => { camera.position.set(0, 0.55, 2.6);
      controls.target.set(0, 0.3, 0); camera.lookAt(controls.target);
      controls.update(); invalidate(); };
    if (!realModelsOn) setRealModels(true);      // a recognizable seat for shots
    setModel(seatBp(), 'gizmatest seat');
    select(0);
    aimCamera();

    // ---- A. the pure contract, generic (UI-free) pose ----
    const D90 = Math.PI / 2, TH = 1.0;
    const q0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.28, 0.7, -0.15, 'YXZ'));
    const qAx = (a, t) => new THREE.Quaternion().setFromAxisAngle(a.clone().normalize(), t);
    for (const k of ['x', 'y', 'z']) {          // each ring spins about ITS axis
      const q1 = gizmoSpinRing(q0, k, TH), a = gizmoCol(q0, k);
      const others = ['x', 'y', 'z'].filter(j => j !== k);
      ok('ring' + k, gizmoCol(q1, k).dot(a) > 1 - 1e-6
        && others.every(j => gizmoCol(q1, j).dot(
             gizmoCol(q0, j).applyQuaternion(qAx(a, TH))) > 0.9999));
    }
    // WYSIWYG identity: intrinsic == world premultiply about the VISIBLE axis
    ok('equiv', Math.abs(gizmoSpinRing(q0, 'x', TH)
      .dot(qAx(gizmoCol(q0, 'x'), TH).multiply(q0).clone())) > 0.9999);
    // the user's case: pitch 90° THEN roll 90° — order matters, and the second
    // step spins about the ring's axis as MOVED BY the first step
    const qP = gizmoSpinRing(q0, 'x', D90), qPR = gizmoSpinRing(qP, 'y', D90);
    const qRP = gizmoSpinRing(gizmoSpinRing(q0, 'y', D90), 'x', D90);
    ok('noncommute', 1 - Math.abs(qPR.dot(qRP)) > 0.2);
    // world-frame view of the same chain: forward vector a-turns about the
    // visible X ring, THEN turns about the (moved) visible Y ring
    const za = gizmoCol(q0, 'z').applyQuaternion(qAx(gizmoCol(q0, 'x'), D90));
    const zb = za.applyQuaternion(qAx(gizmoCol(qP, 'y'), D90));
    ok('chain', gizmoCol(qPR, 'z').dot(zb) > 0.9999);
    // trackball: extrinsic spin about the camera eye axis
    const eye = new THREE.Vector3(0.3, 0.4, 1);
    ok('eye', Math.abs(gizmoSpinEye(q0, eye, TH)
      .dot(qAx(eye, TH).multiply(q0).clone())) > 0.9999);
    // shipped configuration = the rule the model describes
    ok('config', tctl.mode === 'rotate' && tctl.space === 'local');

    // ---- B. scene proof through the REAL writeback path ----
    const obj = compObjs[0], comp = model.data.components[0];
    scene.updateMatrixWorld(true);
    const qv0 = obj.getWorldQuaternion(new THREE.Quaternion());   // stripped frame = qv·RY180
    const projN = (q) => { const p = new THREE.Vector3(0, 0, 1)   // proxy +z = part raw −z = nose
        .applyQuaternion(q).add(camera.position).project(camera); return [p.x, p.y]; };
    const qv1 = gizmoSpinRing(gizmoSpinRing(qv0, 'x', D90), 'y', D90);   // proxy-frame chain
    const n0 = projN(qv0);
    applyGizmoOrientation(qv1);
    scene.updateMatrixWorld(true);
    ok('file', Math.abs(viewQuat(comp.orientation)
      .dot(qv1.clone().multiply(GIZMO_Y180))) > 0.9999);          // mesh qv = P·RY180
    ok('live', Math.abs(obj.getWorldQuaternion(new THREE.Quaternion())
      .dot(qv1)) > 0.9999);                                       // decompose tracks the rings
    const n1 = projN(qv1);
    ok('nose', Math.hypot(n1[0] - n0[0], n1[1] - n0[1]) > 0.4);  // swung visibly on screen
    ok('proxy', Math.abs(gizmoProxy.quaternion.dot(qv1)) > 0.9999);  // rings track the part

    // ---- C. demo state for screenshots (before / +pitch / +pitch+roll) ----
    setModel(seatBp(), 'gizmatest seat');
    select(0);
    aimCamera();
    scene.updateMatrixWorld(true);
    const qv = compObjs[0].getWorldQuaternion(new THREE.Quaternion());
    const step = Math.min(2, Math.max(0, (gizmoShot | 0) - 1));
    const demoQ = [qv, gizmoSpinRing(qv, 'x', D90),
                   gizmoSpinRing(gizmoSpinRing(qv, 'x', D90), 'y', D90)][step];
    if (step > 0) applyGizmoOrientation(demoQ);
    invalidate();
    document.title = fails.length ? 'GIZMATEST FAIL ' + fails.join(',')
                                  : `GIZMATEST PASS n=${nPins}`;
  } catch (e) {
    document.title = 'GIZMATEST ERR ' + e.message + ' @'
      + String(e.stack).split(String.fromCharCode(10))[1].trim().slice(0, 70);
  }
}

// ---------- UI sweep (?uitest) ----------
// Headless click-through of the whole panel: every checkbox/button/slider/⟲
// the user can touch gets driven through its REAL handler, plus behaviours
// the pure-state pins cannot reach (filter, list click, keyboard shortcuts,
// checkbox↔group sync, dirty-flag lifecycle, preset buttons). Failing pins
// land in the title; captured window errors go to #out.
async function runUiTest() {
  const fails = [], errs = [];
  const collect = (e) => errs.push(String((e && (e.message || e.reason)) || e));
  addEventListener('error', collect);
  addEventListener('unhandledrejection', collect);
  let nPins = 0;   // counted dynamically: the title can never desync the pins
  const ok = (nm, cond) => { nPins++; if (!cond) fails.push(nm); };
  const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const setIn = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
  const btn = (root, t) => [...root.querySelectorAll('button')].find(b => b.textContent.includes(t));
  const numRow = (root, label) => [...root.querySelectorAll('.row')]
    .find(r => r.querySelector('label')?.textContent === label)?.querySelector('input[type=number]');
  const cbL = (t) => [...document.querySelectorAll('#panel input[type=checkbox]')]
    .find(c => (c.parentElement.textContent || '').includes(t));
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const settle = async (pred, ms = 4000) => { const t0 = Date.now();
    while (!pred() && Date.now() - t0 < ms) await sleep(50); return pred(); };

  // filter: typing narrows the list to matching types; clearing restores it
  { const tot = model.data.components.length;
    setIn($('filter'), 'wheel');
    const rows = [...$('complist').children];
    const only = rows.length > 0 && rows.every(d => d.textContent.includes('Wheel'));
    setIn($('filter'), '');
    ok('filter', only && $('complist').children.length === tot); }

  // list click: a row selects — header names it and the inspector builds
  { const d = $('complist').children[3], idx = +d.querySelector('.i').textContent;
    click(d);
    ok('listclick', selected === idx && $('selname').textContent.includes(model.data.components[idx].type)
       && $('inspector').querySelectorAll('.row').length >= 6); }

  // rotate gizmo attaches on selection — to the scene-root PROXY, never the
  // mirrored mesh (attaching under worldM would mirror Y/Z drags, see gizmo
  // section); toggling the checkbox detaches/reattaches
  { ok('gizmo', selected >= 0 && tctl.object === gizmoProxy
      && tctl.getHelper().parent === scene);
    const gcb = cbL('rotate gizmo');
    click(gcb);
    const off = tctl.object == null;
    click(gcb);
    ok('gizmo2', off && tctl.object === gizmoProxy); }

  // number edit moves RAW data; the row ⟲ restores it
  { const si = model.data.components.findIndex(c => c.type === 'PilotSeat');
    select(si);
    const comp = model.data.components[si], x0 = comp.position.x;
    const nx = numRow($('inspector'), 'x');
    setIn(nx, x0 + 0.375);
    const moved = Math.abs(comp.position.x - (x0 + 0.375)) < 1e-9 && document.body.classList.contains('dirty');
    click(nx.parentElement.querySelector('.rst'));
    ok('editreset', moved && Math.abs(comp.position.x - x0) < 1e-12);

    // presets actually MOVE the part (nose = raw z −0.25, up = +0.1)
    const z0 = comp.position.z, y0 = comp.position.y;
    click(btn($('inspector'), 'nose 0.25')); click(btn($('inspector'), 'up 0.1'));
    ok('presets', Math.abs(comp.position.z - (z0 - 0.25)) < 1e-9
       && Math.abs(comp.position.y - (y0 + 0.1)) < 1e-9);

    // Actions-reset returns position to the file state
    click([...$('inspector').querySelectorAll('button')].find(b => b.textContent.includes('reset this component')));
    ok('compreset', ['x', 'y', 'z'].every(k => Math.abs(comp.position[k] - orig[si].pos0[k]) < 1e-12));

    // PilotSeat lean preset bends the seat from its just-reset pose
    const qb = compObjs[si].quaternion.clone();
    click(btn($('inspector'), 'lean fwd 12°'));
    ok('seatpreset', compObjs[si].quaternion.angleTo(qb) > 0.15);   // ≥12° applied
    select(-1); }

  // ⟲ must RE-PAINT (v0.149 user: "resetting a component doesnt immediatley
  // reset it, it changes sliders but no visual update is triggered"):
  // set() assigns .value programmatically — no 'input' event — and the click
  // itself scheduled no redraw, so the picture lagged the data
  { const si = model.data.components.findIndex(c => c.type === 'PilotSeat');
    select(si);
    const nx = numRow($('inspector'), 'x');
    setIn(nx, +nx.value + 0.25);
    const s0 = invalSeq;
    click(nx.parentElement.querySelector('.rst'));
    ok('resetpaint', invalSeq > s0
      && Math.abs(model.data.components[si].position.x - (+nx.value + 0.25 - 0.25)) < 1e-9);
    select(-1); }

  // component-data checkbox writes through to comp.data
  { const di = model.data.components.findIndex(c => c.data
      && Object.values(c.data).some(v => typeof v === 'boolean'));
    let pass = false;
    if (di >= 0) {
      select(di);
      const cb = $('inspector').querySelector('.checkrow input[type=checkbox]');
      const d0 = model.data.components[di].data;
      const k = Object.keys(d0).find(k => typeof d0[k] === 'boolean');
      if (cb) { const before = d0[k]; click(cb);
        pass = d0[k] === !before; click(cb); pass = pass && d0[k] === before; }
      select(-1);
    }
    ok('dataedit', pass); }

  // keys g/o/h flip groups AND stay synced with their checkboxes; 'h' moves
  // blocks+triangles together (ONE hull); Esc deselects
  { select(model.data.components.findIndex(c => c.type === 'PilotSeat'));
    const keyd = (k) => dispatchEvent(new KeyboardEvent('keydown', { key: k }));
    let pass = true;
    for (const [k, tk, groups] of [['g', 'grid', [grid]], ['o', 'occ', [occGroup]],
                                   ['h', 'hull', [blockGroup, hullGroup]]]) {
      const t = viewToggles[tk], v0 = groups.every(o => o.visible);
      keyd(k);
      if (!(groups.every(o => o.visible) === !v0 && t.cb.checked === !v0)) pass = false;
      keyd(k);
      if (!(groups.every(o => o.visible) === v0 && t.cb.checked === v0)) pass = false;
    }
    keyd('Escape');
    ok('keys', pass && selected === -1); }

  // real-models checkbox swaps proxies<->real geometry AND persists
  { const cb = cbL('real game models');
    if (!cb.checked) click(cb);
    const on = await settle(() => realModelsOn && realMap.size > 0);
    click(cb);
    const off = await settle(() => !realModelsOn && realMap.size === 0);
    ok('realmodels', on && off && localStorage.getItem('archean-real-models-v2') === '0'); }

  // three-way wind buttons switch modes (lines actually built)
  { const f = $('flight');
    click(btn(f, 'streamlines'));
    const lines = flowMode.m === 'lines' && flowGroup.children.some(o => o.isLine && !o.userData.isTrail);
    click(btn(f, 'wind')); const wind = flowMode.m === 'wind';
    click(btn(f, 'off'));
    ok('flow', lines && wind && flowMode.m === 'off'); }

  // flow-src cycles auto → seat → thrust → auto
  { const fsB = btn($('flight'), 'flow src:'), seq = [];
    for (let i = 0; i < 3; i++) { click(fsB); seq.push(fsB.textContent.replace('flow src: ', '')); }
    ok('flowsrc', seq.join(',') === 'seat,thrust,auto' && flowSrc.mode === 'auto'); }

  // CoM/arrows + thrust display buttons flip their groups
  { const com0 = aeroArrows.visible, th0 = thrustGroup.visible;
    click(btn($('flight'), 'CoM/arrows:'));
    const com = aeroArrows.visible === !com0 && comMarker.visible === !com0;
    click(btn($('flight'), 'thrust:'));
    ok('flightbtns', com && thrustGroup.visible === !th0); }

  // hull-opacity slider dims blocks + skin + wireframes together (the
  // lattice sliders/auto-fit button are gone — exact fit is silent)
  { const nO = numRow($('viewopts'), 'hull opacity');
    setIn(nO, 0.55);
    const bm = blockGroup.children.filter(o => o.isMesh);
    ok('hullui', Math.abs(hullOpacity - 0.55) < 1e-9 && bm.length > 0
      && bm.every(o => o.material.opacity < 0.5)
      && (!blockWireObj || blockWireObj.material.opacity < 0.55));
    setIn(nO, 1); }

  // hull-list row click flashes that triangle into the hull group
  { const n0 = hullGroup.children.length, row0 = $('hulllist').children[0];
    if (row0) { click(row0); ok('hulllist', hullGroup.children.length === n0 + 1); }
    else ok('hulllist', false); }

  // header workshop link: real numeric ids point at the Steam page
  { const w = $('wslink'), id = String(model.workshop_item_id || '');
    ok('wslink', /^\d{6,}$/.test(id) && id !== '0000000000'
      ? w.href.includes('steamcommunity.com') && w.href.includes(id)
      : w.style.display === 'none'); }

  // dirty-flag lifecycle: an edit marks dirty, the Save button clears it
  { const nO = numRow($('viewopts'), 'hull opacity');
    setIn(nO, 0.95);
    const dirtied = document.body.classList.contains('dirty');
    click($('saveBtn'));
    ok('dirty', dirtied && !document.body.classList.contains('dirty'));
    setIn(nO, 1); }

  // zoom-cure button clears the saved dpr baseline without throwing
  { localStorage.setItem('archean-dpr-base', '1');
    click(btn($('viewopts'), 'reset page zoom'));
    ok('zoombtn', localStorage.getItem('archean-dpr-base') === null); }

  // labels checkbox flips labelsOn + label visibility
  { const cb = cbL('labels on interactive'), v0 = labelsOn;
    click(cb);
    const vis = labelsOn === !v0
      && [...compGroup.children].some(o => o.userData.isLabel && o.visible === labelsOn);
    click(cb);
    ok('labels', vis && labelsOn === v0); }

  // calibrated cell mass reproduces the declared craft total (report ✔)
  { const mm = massModel();
    ok('mass', mm.declared > 0 && Math.abs(mm.tot - mm.declared) / mm.declared < 0.02); }

  // SWEEP: EVERY touchable panel control gets its real handler fired
  // (open/save excluded: file pickers + downloads cannot run headless)
  let n = 0;
  { const ctrls = [...document.querySelectorAll('#panel input, #panel button, #panel .rst')]
      .filter(el => !['openBtn', 'saveBtn'].includes(el.id));
    for (const el of ctrls) {
      n++;
      const ty = (el.type || '').toLowerCase();
      try {
        if (el.classList.contains('rst') || el.tagName === 'BUTTON') click(el);
        else if (ty === 'checkbox') click(el);
        else if (ty === 'range') setIn(el, (+el.min + +el.max) / 2);
        else if (ty === 'number') { const v = parseFloat(el.value);
          if (Number.isFinite(v)) setIn(el, v + (+el.step || 1)); }
        else if (ty === 'text') setIn(el, 'uitest');
      } catch (e) { errs.push('ctrl:' + e); }
    }
    let parsed = false;
    try { JSON.parse(serialize()); parsed = true; } catch { /* fail below */ }
    ok('sweep', n > 30 && parsed); }

  ok('no-errors', errs.length === 0);

  document.title = fails.length ? 'UITEST FAIL ' + fails.join(',')
                                : `UITEST PASS n=${nPins} ctrls=${n}`;
  if (errs.length) {
    const pre = document.createElement('pre'); pre.id = 'out';
    pre.textContent = errs.slice(0, 20).join('\n');
    document.body.appendChild(pre);
  }
}

// ---------- init ----------
if (location.search.includes('real')) realModelsOn = true;   // before buildViewOpts (checkbox state)
function applyCamQ() {                              // ?cam=px,py,pz,tx,ty,tz · ?sel=idx
  const q = new URLSearchParams(location.search);
  const camQ = q.get('cam');
  if (camQ) {
    const [x, y, z, tx = 0, ty = 0, tz = 0] = camQ.split(',').map(Number);
    camera.position.set(x, y, -z);                           // URLs stay in FILE space
    controls.target.set(tx, ty, -tz);
  }
  const si = Number(q.get('sel'));                // deep-link a selection (+fly-in)
  if (Number.isInteger(si) && si >= 0 && model?.data.components[si]) select(si);
  invalidate();
}
buildViewOpts();
// flight panel expand/close (v0.149 user request), remembered like the other
// view prefs (the sweep/tests still drive controls inside a closed <details>)
{ const fsec = $('flightsec');
  if (localStorage.getItem('archean-flight-open') === '0') fsec.open = false;
  fsec.addEventListener('toggle',
    () => localStorage.setItem('archean-flight-open', fsec.open ? '1' : '0')); }
buildFlight();
onResize();
if (location.search.includes('hull')) hullGroup.visible = true;
if (location.search.includes('occ')) occGroup.visible = true;
if (location.search.includes('nosub')) subGroup.visible = false;   // debug: hide subgrids
{ const q0 = new URLSearchParams(location.search);        // ?flow = wind, ?lines = streamlines
  if (q0.has('lines')) flowMode.m = 'lines';
  if (q0.has('flow') || q0.has('wind')) flowMode.m = 'wind';
  const azv = parseFloat(q0.get('az')); if (Number.isFinite(azv)) flowState.az = azv;
  const spv = parseFloat(q0.get('speed')); if (Number.isFinite(spv)) flowState.speed = spv; }
{ const fsP = new URLSearchParams(location.search).get('flowsrc');   // ?flowsrc=seat|thrust|auto
  if (fsP === 'seat' || fsP === 'thrust' || fsP === 'auto') flowSrc.mode = fsP; }
const perfOn = location.search.includes('perf');   // arm at load-complete (below), not wall-clock
loadModelManifest().then(fetchDefault).then(applyCamQ);
requestAnimationFrame(tick);
if (location.search.includes('proxytest')) runProxyTest();
if (location.search.includes('comptest')) runCompTest();
if (location.search.includes('postest')) runPosTest();
if (location.search.includes('uitest')) setTimeout(runUiTest, 1500);
if (location.search.includes('gizmatest')) runGizmoTest();

// ---------- self-test (view3d.html?selftest): simulates slider edits + save ----------
if (location.search.includes('selftest')) {
  setTimeout(async () => {
    try {
      const idx = model.data.components.findIndex(c => c.type === 'PilotSeat');
      select(idx);
      const comp = model.data.components[idx], obj = compObjs[idx];
      comp.position.z += 0.25; obj.position.z -= 0.25;                       // like the z slider (raw +0.25 = view −z)
      const q = new THREE.Quaternion()
        .setFromEuler(new THREE.Euler(-20 * Math.PI / 180, 0, 0, 'YXZ'))
        .multiply(obj.quaternion);                                          // like the pitch slider (negative = lean fwd)
      obj.quaternion.copy(q);
      comp.orientation = { w: q.w, x: q.x, y: q.y, z: -q.z };
      const text = serialize(), ref = JSON.parse(text);
      const seat = ref.data.components[idx], occ = seat.occupancies[0];
      const mir = ref.data.blocks.find(b => b.type === 255 && b.size_x === 1 && b.size_y === 5
                 && b.size_z === 2 && b.pos_z === occ.pos_z);
      const ok1 = occ.pos_z === orig[idx].occ0[0].pos_z + 1;
      const ok3 = JSON.stringify(JSON.parse(text)) === text;
      // view-space handedness (default craft ISW-241): the beacon's mast must
      // lean toward the NOSE (view +z). Its 180° quaternion read raw points the
      // mast at the tail — exactly the user's "points the wrong way" bug.
      const bi = model.data.components.findIndex(c => c.type === 'Beacon');
      const mast = bi >= 0 ? new THREE.Vector3(0, 1, 0).applyQuaternion(compObjs[bi].quaternion) : null;
      const ok4 = !!mast && mast.z > 0.9 && Math.abs(mast.x) < 0.2;
      // wheels hang below the mount in-game (suspension droop, display-only):
      // the ISW front caster's centre must sit BELOW its pivot, not at deck height
      const wi = model.data.components.findIndex(c =>
        c.type === 'SmallWheel' && Math.abs(c.orientation.x) > 0.5);   // the front caster
      const wc = new THREE.Vector3(0, 0.447, 0).applyQuaternion(compObjs[wi].quaternion);
      const ok6 = wc.y < -0.3;
      // FluidJunction flat display pose: builder-file cables attach from
      // ABOVE (outlets up, row along the fuselage), so the inlet faces DOWN
      const ji = model.data.components.findIndex(c => c.type === 'FluidJunction');
      const jdir = new THREE.Vector3(0, 0, 1).applyQuaternion(compObjs[ji].quaternion);
      const ok7 = jdir.y < -0.9;
      // aileron deflection = saved data.angle in DEGREES (.ini joint limits
      // ±45°): the ISW front canard (−4.609°) droops its leading edge a few
      // degrees below the hinge, view tip dir = qV · Mz · R_x(rad) · (0,0,1)
      const ac = model.data.components.find(c =>
        c.type === 'Aileron' && c.data && c.data.angle < -3);
      const aqp = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(1, 0, 0), ac.data.angle * Math.PI / 180);
      const at = new THREE.Vector3(0, 0, 1).applyQuaternion(aqp);
      at.z = -at.z; at.applyQuaternion(viewQuat(ac.orientation));
      const ok8 = at.y < -0.03 && at.y > -0.3;   // drooping, within joint limits
      // v1-format files (23 of 24 corpus files!) carry NO data.colors palette:
      // slots must resolve against the built-in legacy groups (dashboard
      // mosaic craft lives in 40..56: slot 48 = matte dark green [1,8,1]);
      // v1 component colours are [slot,slot] palette INDICES, not dicts
      const lc = resolveColor(null, 48), lc2 = resolveColor(null, 53);
      const v1c = compColor({ colors: [48, 42] }, 'color1');
      // v1 family-base remap: v1 polished starts at 80 (v2: 84) — slot 81 must
      // resolve to v2-85 [16,16,16] in v1 files (the purple-block fix), and
      // stay the magenta marker for modern files (255,0,255)
      const l3 = resolveColor(null, 81, true), l4 = resolveColor(null, 81);
      const ok9 = lc.r === 1 && lc.g === 8 && lc.b === 1 && lc2.b === 255
        && Math.abs(v1c.color.r - 1 / 255) < 1e-3 && Math.abs(v1c.color.g - 8 / 255) < 1e-3
        && l3.r === 16 && l3.g === 16 && l3.b === 16 && l4.r === 255 && l4.g === 0 && l4.b === 255;
      // Beacon reads as a beacon: the game's red flash is procedural (no lens
      // material in the gltf), so the viewer adds an emissive red lens at the
      // mast tip of every real/low beacon model (user: "beacon no longer
      // looks like a beacon")
      let ok10 = false;
      { const mm = await getModel('Beacon');
        if (mm?.geo) {
          const rg = buildRealComponent(model.data.components[bi], mm, bi, true);
          rg.traverse(o => { if (o.material?.emissive?.getHex() === 0xff2222) ok10 = true; });
        } }
      // orient-fixture rules (testdata/9000000001, pixel-proven side-by-side
      // with the dev viewer): dashboard canvas text must be PRE-MIRRORED and
      // baked text prims mirrored in-plane about their own centre, so both
      // read correctly from the plate's authored (+normal) side through our
      // z-mirror. ok11: left-aligned 'AB' lands on the canvas RIGHT edge.
      const ok11 = (() => {
        const t = dashTextTex({ text: 'AB', textSize: 2, textAlign: 17, size_x: 40, size_y: 12,
          mainColor: { r: 255, g: 0, b: 0 }, baseColor: { r: 0, g: 0, b: 0 } });
        const cv = t.image, cx = cv.getContext('2d', { willReadFrequently: true });
        const d = cx.getImageData(0, 0, cv.width, cv.height).data;
        let left = 0, right = 0;
        for (let i = 0, px = 0; i < d.length; i += 4, px++)
          if (d[i] > 200 && d[i + 1] < 100) (px % cv.width < cv.width / 2 ? left++ : right++);
        return right > 20 && left === 0;   // pre-mirrored: left-aligned text lands right
      })();
      // ok12: flipGeomX mirrors about the bbox centre (triangle (0,0)(1,0)(0,1)
      // → first vertex at x=1) — glyph order flips, position is preserved.
      const ok12 = (() => {
        const tg = new THREE.BufferGeometry();
        tg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
        tg.setIndex([0, 1, 2]);
        flipGeomX(tg);
        return Math.abs(tg.attributes.position.array[0] - 1) < 1e-6;
      })();
      // ok13: legacy rotation convention (no data.colors => RAW Unity LH
      // quaternions): the mosaic craft's man-mural constellation (dash 235's
      // wall: 17 coplanar dashboards, spread 0.26 m) is flush only under raw
      // R(q) (|dot| 0.999); conjugate quaternions tilt every plate ~45° out
      // of the wall (|dot| 0.70 = user's "not flush" screenshots).
      let ok13 = false;
      {
        const ms = await (await fetch('../testdata/3334698274/blueprint.json')).json();
        const dc = ms.data.components[235];
        if (dc.type === 'Dashboard') {
          const qv = new THREE.Quaternion(-dc.orientation.x, -dc.orientation.y,
                                         dc.orientation.z, dc.orientation.w);   // legacy view rule
          const n = new THREE.Vector3(0, 0, -1).applyQuaternion(qv);   // +Z face through scale.z=−1
          const npl = new THREE.Vector3(0.69337, 0.63691, -0.33702).normalize();  // view wall normal
          ok13 = Math.abs(n.dot(npl)) > 0.98;
        }
      }
      // ok14: ground fit — the green plane and grid sit just UNDER the
      // lowest rendered geometry (truck 3481322297 builds to y=-1.5:
      // nothing may render below ground; user rule), ISW included.
      const gbb2 = new THREE.Box3().setFromObject(compGroup);
      gbb2.expandByObject(blockGroup); gbb2.expandByObject(subGroup);
      gbb2.expandByObject(hullGroup); gbb2.expandByObject(pipeGroup);
      const ok14 = Math.abs(ground.position.y - Math.min(0, gbb2.min.y - 0.02)) < 0.01
        && Math.abs(grid.position.y - ground.position.y) < 0.005;
      // ok15: cable power-surge — selecting the PilotSeat must spawn one
      // travelling pulse per connected pipe, aimed at the directly
      // connected component. Re-triggered here: the awaited mural test
      // advances virtual time, so the select()-spawned pulses already ran.
      startSurges(idx);
      const ok15 = surges.length >= 1 && surges.every(s => s.to >= 0 && s.total > 0.05);
      // ok16: the surge must fire a SOURCE blip on the SELECTED component
      // (Jimmy aileron report: far-end travel read as "the prop fired
      // them") and the selection border must render through geometry.
      const ok16 = flashes.length >= 1 && flashes[0].ci === idx
        && selBox.material.depthTest === false;
      clearSurges();
      // ok17: thrust indication — every propulsor (ISW RCS bank) feeds a
      // normalized net-thrust vector, and per-engine + net arrows are built
      const nThr = model.data.components.filter(c => c.type in THRUST).length;
      // windsock HUD: camera child, aims its +z (tail) downwind in camera
      // space: dot(sock z, flowDir in cam space) ~ 1 (ok19)
      let ok19 = false;
      { setFlowMode('wind'); updateWindHud(performance.now());   // aim once (rAF has not run)
        if (windHud.visible && sockPivot && windHud.parent === camera) {
          const dv = flowDir();
          const dcam = new THREE.Vector3(dv[0], dv[1], -dv[2])
            .applyQuaternion(camera.quaternion.clone().invert()).normalize();
          const z = new THREE.Vector3(0, 0, 1).applyQuaternion(sockPivot.quaternion);
          ok19 = z.dot(dcam) > 0.93;
        }
        setFlowMode('off'); }
      // ok20: hull-solid and wireframe are mutually exclusive (user)
      let ok20 = false;
      { const cbs = [...document.querySelectorAll('input[type=checkbox]')];
        const find = t => cbs.find(c => (c.parentElement.textContent || '').includes(t));
        const h = find('hull (blocks + triangles)'), w = find('wireframe (hull)');
        if (h && w) {
          w.checked = true; w.dispatchEvent(new Event('change'));
          const a = !h.checked && !blockGroup.visible && hullWire.visible;
          h.checked = true; h.dispatchEvent(new Event('change'));
          ok20 = a && !w.checked && blockGroup.visible && !hullWire.visible;
        } }
      // ok21: physics-LOD budget — normal crafts keep all 2200 particles
      const ok21 = flowPts && flowPts.geometry.attributes.position.count === 2200 && flowN === 2200;
      // ok22: clicking a component on the canvas selects it via the
      // pointerdown raycast (no hover path exists anymore)
      let ok22 = false;
      { const si = compObjs.findIndex(o => !!o);
        if (si >= 0) {
          const v = new THREE.Vector3(); compObjs[si].getWorldPosition(v); v.project(camera);
          const r = renderer.domElement.getBoundingClientRect();
          const x = r.left + (v.x * 0.5 + 0.5) * r.width, y = r.top + (-v.y * 0.5 + 0.5) * r.height;
          const ev = (t) => renderer.domElement.dispatchEvent(new PointerEvent(t,
            { clientX: x, clientY: y, bubbles: true, pointerId: 1, isPrimary: true }));
          const prev = selected;
          ev('pointerdown'); ev('pointerup');
          ok22 = selected === si;
          fly = null; select(prev, false);       // undo camera side effects
        } }
      // ok23: streamlines are undisturbed UPSTREAM of the body mid-plane
      // (user: 'things magically happen 10 m in front of Jimmy'). Every line
      // vertex with dot(p-cen,dir) < 0 must sit laterally within 0.45 m of
      // its seed ring radius (straight run-in + heading low-pass tolerance).
      let ok23 = false;
      { setFlowMode('lines');
        const dvL = new THREE.Vector3(...flowDir()).normalize();
        const bL = model.box_min, BL = model.box_max;
        const cenL = new THREE.Vector3((bL.x + BL.x) / 2, (bL.y + BL.y) / 2, (bL.z + BL.z) / 2);
        const seedR = [];
        { const ref = Math.abs(dvL.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
          const e1L = ref.cross(dvL).normalize();
          const e2L = new THREE.Vector3().crossVectors(dvL, e1L).normalize();
          const radL = Math.hypot(BL.x - bL.x, BL.y - bL.y, BL.z - bL.z) / 2 * 1.1 + 0.5;
          for (let a = -radL; a <= radL; a += 1.7)
            for (let c2 = -radL; c2 <= radL; c2 += 0.55)
              if (a * a + c2 * c2 <= radL * radL) seedR.push(Math.hypot(a, c2));
        }
        let worst = 0;
        for (const o of flowGroup.children) {
          if (!o.isLine || o.userData.isTrail || o.userData.isLineHot) continue;
          const pos = o.geometry.attributes.position.array;
          for (let i = 0; i < pos.length; i += 3) {
            const px = pos[i] - cenL.x, py = pos[i + 1] - cenL.y, pz = pos[i + 2] - cenL.z;
            if (px * dvL.x + py * dvL.y + pz * dvL.z >= 0) continue;     // wake side: waves allowed
            const t = px * dvL.x + py * dvL.y + pz * dvL.z;
            const ux = px - t * dvL.x, uy = py - t * dvL.y, uz = pz - t * dvL.z;
            const lat = Math.hypot(ux, uy, uz);
            let m = 1e9;
            for (const r of seedR) { const d = Math.abs(lat - r); if (d < m) m = d; }
            if (m > worst) worst = m;
          }
        }
        ok23 = worst < 0.45 && flowGroup.children.some(o => o.isLine && !o.userData.isTrail);
        setFlowMode('off'); }
      // ok24: wake deficit — air directly behind Jimmy's tail is slowed
      // (>25 % deficit), air ahead of the nose is at freestream
      let ok24 = false;
      { const dvW = flowDir();
        const bl = model.box_min, Bg = model.box_max;
        const cW = [(bl.x + Bg.x) / 2, (bl.y + Bg.y) / 2, (bl.z + Bg.z) / 2];
        const ext = Math.abs((Bg.x - bl.x) / 2 * dvW[0]) + Math.abs((Bg.y - bl.y) / 2 * dvW[1]) + Math.abs((Bg.z - bl.z) / 2 * dvW[2]);
        const VB = 60;
        // mid-way between axis and hull TOP skin: the ISW tail centre is its
        // open engine duct (air, casts no wake); the top skin is solid
        const yTop = (Bg.y + cW[1]) / 2 - 0.15;
        const pb = [cW[0] + dvW[0] * (ext + 1.5), yTop, cW[2] + dvW[2] * (ext + 1.5)];
        const pf = [cW[0] - dvW[0] * (ext + 1.5), yTop, cW[2] - dvW[2] * (ext + 1.5)];
        const vb = sampleVel(pb, dvW, VB), vf = sampleVel(pf, dvW, VB);
        ok24 = Math.hypot(vb[0], vb[1], vb[2]) < VB * 0.75 && (vb[3] || 0) > 0.3
          && Math.hypot(vf[0], vf[1], vf[2]) > VB * 0.95 && !(vf[3] > 0);
      }
      // ok25: chair pitch is a COMFORT axis — pitching the pilot seat must
      // not steer the wind (user: 'pitch the chair and the wind direction
      // and speed change'); wind keeps heading + unit length
      let ok25 = false;
      { const seatCi = model.data.components.findIndex(c => c.type === 'PilotSeat');
        const so = seatCi >= 0 ? compObjs[seatCi] : null;
        if (so) {
          const d0 = flowDir();
          const q = so.quaternion.clone();
          so.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.35));
          const d1 = flowDir();
          so.quaternion.copy(q);
          ok25 = d0[0] * d1[0] + d0[1] * d1[1] + d0[2] * d1[2] > 0.9999
            && Math.abs(Math.hypot(...d0) - 1) < 0.01 && Math.abs(Math.hypot(...d1) - 1) < 0.01;
        } }
      // ok26: display anchoring — ISW is built at frame (0,0,0), so the
      // v0.140 moff/cv display transform must be a pure no-op (bit-identical)
      const ok26 = model.moff[0] === 0 && model.moff[1] === 0 && model.moff[2] === 0
        && model.cv[0] === 0 && model.cv[1] === 0 && model.cv[2] === 0
        && isFinite(model.box_min.x) && blockGroup.position.lengthSq() === 0;
      // ok27: rotate gizmo writeback shape — a 0.7 rad drag about view +y
      // (the trackball's world-premultiply form) applied to the PilotSeat
      // must land VERBATIM in the mesh quaternion and round-trip the file
      // quaternion (viewQuat∘rawFromView = id): the seat's saved pitch makes
      // the z component nonzero, so any mirror/conjugation slip in the chain
      // fails (v0.150 shipped exactly such a flipZ step; ?gizmatest covers
      // the ring-order semantics, this pins the writeback path)
      let ok27 = false;
      (function () {
        const ci = model.data.components.findIndex(c => c.type === 'PilotSeat');
        select(ci);
        const o = compObjs[ci];
        scene.updateMatrixWorld(true);
        const q0 = o.getWorldQuaternion(new THREE.Quaternion());   // visible pose
        const drag = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.7);
        const pq = drag.multiply(q0);                              // what TControls computes
        applyGizmoOrientation(pq);
        const qf = model.data.components[ci].orientation;
        const want = pq.clone().multiply(GIZMO_Y180);   // proxy frame → mesh frame
        ok27 = Math.abs(viewQuat(qf).dot(want)) > 0.9999           // file → view decode
          && Math.abs(o.quaternion.dot(want)) > 0.9999             // live mesh pose
          && dirty;
        select(-1);
      })();
      const ok17 = nThr > 0 && !!netThrust && netThrust.n === nThr
        && thrustGroup.children.length === nThr + (netThrust.v ? 1 : 0)
        && (!netThrust.v || Math.abs(Math.hypot(...netThrust.v) - 1) < 0.02)
        // ISW = sole-class RCS blob: the blueprint stores none of the game's
        // 5 selectable fire directions, so it displays the NORMAL mode —
        // push BACKWARD along −cockpit heading = view (0,0,−1) (user: "no
        // downward propulsion"; the old .ini-TARGET-axis guess drew a
        // straight-down arrow at the nose pod). RCS is excluded from the
        // nets entirely when real engines coexist. Auto flow still takes the
        // cockpit first; aoa 4° keeps |y| = sin4° ≈ 0.07.
        && !!netThrust.main && netThrust.main[2] < -0.97
        && Math.abs(netThrust.main[0]) < 0.05 && Math.abs(netThrust.main[1]) < 0.05
        && netThrust.v[2] < -0.97 && Math.abs(flowDir()[1]) < 0.2;
      // ok18: sealed-hull wind exclusion (user: no wind inside enclosed
      // craft): BionicDolphin (block hull, hatches stored closed) has a
      // ray-enclosed cabin of 100+ cells that is windless, its far field
      // windy; the live ISW grid exists and its far field is exterior.
      const dp = await (await fetch('../testdata/3417786605/blueprint.json')).json();
      const seal = sealStats(dp.data);
      const sp = seal.sealedSample;
      const sgx = Math.round(sp[0] / 0.25) - seal.b0[0];
      const sgy = Math.round(sp[1] / 0.25) - seal.b0[1];
      const sgz = Math.round(sp[2] / 0.25) - seal.b0[2];
      const ok18 = !!extGrid && inExterior([model.box_min.x - 2, 0, 0])
        && seal.sealedCount > 100
        && seal.ext[((sgy * seal.n[0]) + sgx) * seal.n[2] + sgz] !== 1
        && seal.ext[0] === 1;
      // picking must work through the mirrored component transforms
      // (camera aimed at the selected component: load framing is
      // per-craft now, the pin must not depend on it)
      {
        const bb = new THREE.Box3().setFromObject(obj);
        const c = bb.getCenter(new THREE.Vector3());
        controls.target.copy(c);
        camera.position.copy(c).add(new THREE.Vector3(1.2, 0.8, 1.5));
        camera.near = 0.01; camera.far = 100; camera.updateProjectionMatrix();
        camera.updateMatrixWorld(true);
      }
      ray.setFromCamera(new THREE.Vector2(0, 0), camera);
      const ok5 = ray.intersectObjects(compGroup.children, true)
        .some(h => h.object.userData.ci >= 0);
      document.title = 'SELFTEST ' + (ok1 && mir && ok3 && ok4 && ok5 && ok6 && ok7 && ok8 && ok9 && ok10 && ok11 && ok12 && ok13 && ok14 && ok15 && ok16 && ok17 && ok18 && ok19 && ok20 && ok21 && ok22 && ok23 && ok24 && ok25 && ok26 && ok27 ? 'PASS' : 'FAIL')
        + ' occ_z=' + occ.pos_z + ' mirror=' + !!mir
        + ' pitch=' + (2 * Math.asin(-seat.orientation.x) * 180 / Math.PI).toFixed(1) + '°'
        + ' beacon=' + (mast ? mast.x.toFixed(2) : 'none') + ' droop=' + wc.y.toFixed(2)
        + ' junction=' + jdir.y.toFixed(2) + ' aileron=' + at.y.toFixed(2)
        + ' pick=' + ok5 + ' palette=' + ok9 + ' lens=' + ok10
        + ' dashmirror=' + ok11 + ' textx=' + ok12 + ' mural=' + ok13 + ' ground=' + ok14
        + ' surges=' + ok15 + ' bolts=' + ok16 + ' thrust=' + ok17 + ' seal=' + ok18 + ' sock=' + ok19 + ' excl=' + ok20 + ' windpts=' + ok21 + ' click=' + ok22 + ' inflow=' + ok23 + ' wake=' + ok24 + ' seatpitch=' + ok25 + ' anchor=' + ok26 + ' gizmo=' + ok27
        + ' cabin=' + seal.sealedCount;
    } catch (e) { document.title = 'SELFTEST ERR ' + e.message + ' @' + String(e.stack).split(String.fromCharCode(10))[1].trim().slice(0, 70); }
  }, 1500);
}
