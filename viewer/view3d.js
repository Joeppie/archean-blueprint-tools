// Archean blueprint live inspector — renders components + blocks of blueprint.json
// with Firefox-DevTools-style sliders on their attributes. See FORMAT.md for the
// file format. World mapping: world = (pos - 5.5) * 0.25 + frame * 3.0 per axis.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
// surface crashes in the document title (visible to headless test dumps)
addEventListener('error', (e) => { document.title = 'ERR ' + (e.message || 'load') + ' @' + e.lineno + ':' + e.colno; });
addEventListener('unhandledrejection', (e) => {
  const st = String(e.reason?.stack || '').split('\n').find(l => l.includes('view3d')) || '';
  document.title = 'ERR ' + (e.reason?.message || e.reason) + ' |' + st.trim().replace(/^at /, '').slice(0, 60);
});
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---- game component models (extracted from installed game modules) ----
// manifest: per-type metadata (mass, renderable node tree, joints, adapters,
// colliders); geometry fetched lazily per type. Material names color1/color2
// are the player-painted surfaces (blueprint colors.color1/color2).
const MODEL = { manifest: null, cache: {} };
// Default is LIGHT proxies (boxes + hexagon cylinders): the game ships dense
// raytracing-grade geometry that overloads raster GPUs. The checkbox swaps in
// the real game models on demand; the choice persists across sessions.
let realModelsOn = localStorage.getItem('archean-real-models') === '1';
function setRealModels(on) {
  realModelsOn = on;
  localStorage.setItem('archean-real-models', on ? '1' : '0');
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
const MAT_FIX = { 'data-connector': 0x2244cc, 'data-connector-m': 0x2244cc, glass: 0xbfd6e6 };
function modelMaterial(c, name) {
  if (name === 'color1') return compColor(c, 'color1', 0x9aa2ad);
  if (name === 'color2') return compColor(c, 'color2', 0x565d68);
  const col = MAT_FIX[name] ?? 0x8d949e;
  return { color: new THREE.Color(col), metal: 0.5, rough: 0.55, op: 1 };
}
function buildRealComponent(c, model, idx, low = false) {
  const { geo, info } = model;
  const g = new THREE.Group();
  // Placement truth is the .ini node tree (renderables/joints/targets, ZYX
  // euler like the game engine) — NOT the gltf node translations, which are
  // Blender authoring offsets (MiniComputer's model sits 3 m from its origin!).
  const nodes = new Map();
  const RAD = Math.PI / 180;
  const addNode = (n) => {
    const p = new THREE.Group();
    p.rotation.order = 'ZYX';
    p.position.set(...n.position);
    p.rotation.set(n.rotation[0] * RAD, n.rotation[1] * RAD, n.rotation[2] * RAD);
    (nodes.get(n.parent) || g).add(p);
    nodes.set(n.name, p);
  };
  for (const j of info.joints || []) addNode(j);
  for (const t of info.targets || []) addNode(t);
  for (const r of info.renderables) {
    addNode(r);
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
      let arr = byMat.get(prim.material);
      if (!arr) byMat.set(prim.material, arr = []);
      arr.push(gg);
    }
    for (const [mname, geos] of byMat) {
      const gg = geos.length > 1 ? mergeGeometries(geos, false) : geos[0];
      if (!gg) continue;
      const m = new THREE.Mesh(gg, mat(modelMaterial(c, mname)));
      m.userData.ci = idx;
      rg.add(m);
    }
  }
  // aileron: hinge the real flap like the game does (front ailerons droop)
  const jp = nodes.get('joint');
  if (jp && c.type === 'Aileron') jp.rotateX(-(c.position.z < 0 ? 0.785 : 0.12));
  // adapter nubs: queue in world space, merged into ONE mesh per port type (see adpFlush)
  const qo = new THREE.Quaternion(c.orientation.x, c.orientation.y, c.orientation.z, c.orientation.w);
  for (const a of info.adapters || []) {
    const p = new THREE.Vector3(...a.position).applyQuaternion(qo);
    adpQueue.push({ x: p.x + c.position.x, y: p.y + c.position.y, z: p.z + c.position.z,
                    t: a.type, ci: idx, lx: a.position[0], ly: a.position[1], lz: a.position[2] });
  }
  scheduleAdpFlush();
  g.userData.ci = idx;
  return g;
}

function syncAdapters(obj) {
  let hit = false;
  for (const a of adpQueue) if (a.ci === obj.userData.ci) {
    const p = new THREE.Vector3(a.lx, a.ly, a.lz).applyQuaternion(obj.quaternion);
    a.x = p.x + obj.position.x; a.y = p.y + obj.position.y; a.z = p.z + obj.position.z;
    hit = true;
  }
  if (hit) scheduleAdpFlush();
}

// merged adapter-nub meshes (big craft: hundreds of tiny spheres → 1 draw per type)
const adpQueue = [];
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

// ---------- three.js boilerplate ----------
const view = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
view.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fb4d8);
scene.fog = new THREE.Fog(0x8fb4d8, 40, 90);

const camera = new THREE.PerspectiveCamera(55, 1, 0.05, 300);
camera.position.set(-6.5, 3.4, -8.5);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.9, 0.5);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x444422, 1.1));
const sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
sun.position.set(-6, 10, -4);
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(120, 120),
  new THREE.MeshStandardMaterial({ color: 0x3d5a34, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const grid = new THREE.GridHelper(28, 112, 0x223322, 0x2c4429);
grid.position.y = 0.002;
scene.add(grid);

function onResize() {
  const w = view.clientWidth, h = view.clientHeight;
  renderer.setSize(w, h);
  invalidate();
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', onResize);

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

function palColor(slot, fallback = 0xaaaaaa) {
  const c = model.data.colors[slot];
  if (!c || typeof c !== 'object') return { color: new THREE.Color(fallback), metal: 0.4, rough: 0.7, op: 1 };
  return {
    color: new THREE.Color(`rgb(${c.r},${c.g},${c.b})`),
    metal: c.metallic, rough: (c.roughness ?? 7) / 7,
    op: clamp((c.opacity ?? 15) / 15, 0.05, 1),
  };
}
function compColor(comp, which, fallback) {
  const c = comp.colors?.[which];
  if (!c) return { color: new THREE.Color(fallback), metal: 0.5, rough: 0.6, op: 1 };
  return { color: new THREE.Color(`rgb(${c.r},${c.g},${c.b})`),
           metal: c.metallic, rough: clamp((c.roughness ?? 7) / 7, 0.05, 1),
           op: clamp((c.opacity ?? 15) / 15, 0.05, 1) };
}
function mat(spec, extra = {}) {
  return new THREE.MeshStandardMaterial({
    color: spec.color, metalness: spec.metal, roughness: spec.rough,
    transparent: spec.op < 1, opacity: spec.op, ...extra });
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (r, h, seg = 6) => new THREE.CylinderGeometry(r, r, h, seg);

// ---------- component proxies (pivot at local origin = comp.position) ----------
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
    // handle" sticking out past the edges) + flap hinged on the local -z edge.
    // Canards (the front pair) render with the flap deflected up, like the
    // saloon-door look in-game; main control surfaces sit near-neutral.
    const f = footprint(c);
    const g = new THREE.Group();
    const m = mat(compColor(c, 'color1', 0xdddddd));
    const plate = new THREE.Mesh(box(f.x, 0.045, f.z * 0.6), m);
    plate.position.z = f.z * 0.2;                  // fixed surface, rear 60% (original side)
    const rod = new THREE.Mesh(cyl(0.025, f.x + 0.5, 6), mat(compColor(c, 'color2', 0x999999)));
    rod.rotation.z = Math.PI / 2;
    rod.position.z = -f.z * 0.1;                   // hinge rod toward nose, as before
    const flap = new THREE.Mesh(box(f.x, 0.03, f.z * 0.4), m);
    flap.position.set(0, 0, -f.z * 0.3);           // moving flap = 40% (larger), nose side
    const pivot = new THREE.Group();
    pivot.position.z = -f.z * 0.1;
    pivot.add(flap);
    pivot.rotation.x = (c.position && c.position.z < 0 ? 1.05 : 0.12); // canards: saloon-door up
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
    // comb manifold (port positions traced from data.pipes): body along local
    // x (= world z, so a row of junctions touches side-by-side), inlet stub on
    // local -y (world -x), three outlet stubs on local +y (world +x).
    const g = new THREE.Group(), m = mat(compColor(c, 'color1', 0xdddddd));
    g.add(new THREE.Mesh(box(1.0, 0.22, 0.3), m));
    const inlet = new THREE.Mesh(cyl(0.045, 0.16), m);
    inlet.rotation.x = Math.PI / 2; inlet.position.y = -0.16;
    g.add(inlet);
    for (const x of [-0.33, 0, 0.33]) {
      const o = new THREE.Mesh(cyl(0.04, 0.16), m);
      o.rotation.x = Math.PI / 2; o.position.set(x, 0.16, 0);
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
let labelsOn = true;
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

// build merged geometry for a list of blocks (boxes + rods, vertex-coloured);
// offset shifts all positions (subgrids render relative to their host hinge)
function mergeBlocks(blocks, offset) {
  const bgeos = [];
  for (const b of blocks) {
    if (b.type === 255) continue;                                       // occupancy mirror
    const col = palColor(b.colors?.[0] ?? 0);
    const cx = occWorld(b, 'x') + offset.x, cy = occWorld(b, 'y') + offset.y, cz = occWorld(b, 'z') + offset.z;
    let g, m4 = new THREE.Matrix4();
    if (b.type === 4) {                                                 // rod along z
      g = new THREE.CylinderGeometry(0.028, 0.028, (b.size_z + 1) * CELL, 8);
      m4.makeRotationX(Math.PI / 2);
      m4.setPosition(cx, cy, cz + b.size_z * CELL / 2);
    } else {
      g = new THREE.BoxGeometry((b.size_x + 1) * CELL, (b.size_y + 1) * CELL, (b.size_z + 1) * CELL);
      m4.makeTranslation(cx + b.size_x * CELL / 2, cy + b.size_y * CELL / 2, cz + b.size_z * CELL / 2);
    }
    g.applyMatrix4(m4);
    const n = g.attributes.position.count, ca = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) { ca[k * 3] = col.color.r; ca[k * 3 + 1] = col.color.g; ca[k * 3 + 2] = col.color.b; }
    g.setAttribute('color', new THREE.Float32BufferAttribute(ca, 3));
    bgeos.push(g);
  }
  return bgeos.length ? mergeGeometries(bgeos, false) : null;
}

// subgrids: nested blueprint data inside 'Build' components (hatches/doors),
// linked to their hinge via data.composite_builds. In the blueprint they are
// stored in the CLOSED pose, using the same cell-grid encoding as the parent
// craft — the hinge's own orientation is the animation axis, not a transform.
function buildSubgrids() {
  subGroup.clear();
  for (const c of model.data.components) {
    if (c.type !== 'Build' || !c.data?.blocks?.length) continue;
    const bg = mergeBlocks(c.data.blocks, new THREE.Vector3());
    if (bg) subGroup.add(new THREE.Mesh(bg,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2,
                                       transparent: true, opacity: 0.97 })));
    for (const sc of c.data.components || []) {
      if (sc.type === 'Build') continue;
      const m = MODEL.manifest?.[sc.type] ? colliderProxy(sc) : (PROXY[sc.type] || PROXY2[sc.type] || defaultProxy)(sc);
      m.position.set(sc.position.x, sc.position.y, sc.position.z);
      m.quaternion.set(sc.orientation.x, sc.orientation.y, sc.orientation.z, sc.orientation.w);
      subGroup.add(m);
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
    mesh.position.set(c.position.x, c.position.y, c.position.z);
    mesh.quaternion.set(c.orientation.x, c.orientation.y, c.orientation.z, c.orientation.w);
    mesh.traverse(o => { o.userData.ci = i; });
    mesh.userData.ci = i;
    compGroup.add(mesh);
    compObjs[i] = mesh;
    if (INTERACT[c.type] || c.alias) {              // floating label above part
      const sp = makeLabel(c);
      sp.position.y = new THREE.Box3().setFromObject(mesh).max.y - mesh.position.y + 0.18;
      sp.userData.ci = i;
      sp.visible = labelsOn;
      mesh.add(sp);
    }
    const mp = atlas ? getModel(c.type) : null;
    if (mp) mp.then(mm => {
      if (!mm || !mm.geo || !compObjs.includes(mesh)) return;
      const real = buildRealComponent(c, mm, i, !realModelsOn);   // low by default
      real.position.copy(mesh.position);
      real.quaternion.copy(mesh.quaternion);
      real.userData.real = true;
      mesh.visible = false;
      mesh.userData.hasReal = true;
      const lab = mesh.children.find(o => o.userData.isLabel);
      if (lab) real.add(lab);                     // labels ride the visible model
      compGroup.add(real);
      (realMap.get(i) || realMap.set(i, []).get(i)).push(real);
      invalidate();
    });
  }

  // blocks: merge all into ONE vertex-coloured mesh; occupancy → one line mesh
  const oedges = [];
  for (const b of blocks) {
    if (b.type !== 255) continue;                                       // occupancy mirror box
    const s = new THREE.Box3(
      new THREE.Vector3(occWorld(b, 'x') - CELL / 2, occWorld(b, 'y') - CELL / 2, occWorld(b, 'z') - CELL / 2),
      new THREE.Vector3(occWorld(b, 'x') + b.size_x * CELL + CELL / 2,
                        occWorld(b, 'y') + b.size_y * CELL + CELL / 2,
                        occWorld(b, 'z') + b.size_z * CELL + CELL / 2));
    const sz = s.getSize(new THREE.Vector3()), ct = s.getCenter(new THREE.Vector3());
    const eg = new THREE.EdgesGeometry(box(sz.x, sz.y, sz.z));
    eg.applyMatrix4(new THREE.Matrix4().makeTranslation(ct.x, ct.y, ct.z));
    oedges.push(eg);
  }
  const bg = mergeBlocks(blocks, new THREE.Vector3());
  if (bg) blockGroup.add(new THREE.Mesh(bg,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2,
                                     transparent: true, opacity: 0.97 })));
  if (oedges.length) occGroup.add(new THREE.LineSegments(mergeGeometries(oedges, false),
    new THREE.LineBasicMaterial({ color: 0xff4444, transparent: true, opacity: 0.35 })));
  buildHull();
  buildPipes();
  buildSubgrids();
  invalidate();
}

import { fitHull } from './hullfit.js';

// hull triangles: world_ax = (v + W·frame)·p_ax + C_ax — vertices are SLOTS on
// a per-frame lattice (W slots per frame tile, see hullfit.js: W detected from
// cross-frame weld pairs). Constants fitted per file. Hull renders as solid
// plates (0.125 m, matching in-game skin) + a toggleable wireframe showing the
// raw triangle surfaces.
// TODO(future): aerodynamics with full 360° velocity vector (crafts fly along
// any axis — nose may be ±X/±Z; Y is always up), automatic search of the
// aerodynamically stable flight direction at low/high speed, and an ambiguity
// warning when the stability scan finds multiple stable directions.
const hullP = { W: 14, px: 0.2325, py: 0.2325, pz: 0.2325, Cx: -1.3, Cy: -4.2, Cz: -0.95 };
const HULL_T = 0.0625;                       // half-thickness of hull skin (m)
let hullOpacity = 1;
function hullPt(t, ax, i) {
  return (t[`v${i}_${ax}`] + hullP.W * t['frame_' + ax]) * hullP['p' + ax] + hullP['C' + ax];
}
// welded + mirrored hull triangles: shared lattice slots merge into single
// points (like the game's welded vertices); near-mirror vertex pairs average
// their |x| so the skin renders symmetric, and near-axis points snap to x=0.
function weldedTris() {
  const tris = model.data.triangles.map(t => ({
    c: t.colors?.[0] ?? 0,
    p: [0, 1, 2].map(i => [hullPt(t, 'x', i), hullPt(t, 'y', i), hullPt(t, 'z', i)]),
  }));
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
const hullWire = new THREE.Group(); scene.add(hullWire);
function buildHull() {
  hullGroup.clear(); hullWire.clear();
  // game renders hull triangles as thin solid plates (~0.125 m) — extrude
  // each triangle along its normal (top, bottom, 3 side walls);
  // low-opacity palette slots (canopy glass) go to a separate transparent mesh
  const T = HULL_T, pos = [], col = [], gpos = [], gcol = [], wpos = [];
  const push = (p, c, P = pos, C = col) => { P.push(...p); C.push(c.r, c.g, c.b); };
  let colv, gtarget;
  const off = (v, n, o) => v.map((x, i) => x + n[i] * o);
  const tri = (a, b, cc, n, o) => {
    push(off(a, n, o), colv, gtarget.P, gtarget.C);
    push(off(b, n, o), colv, gtarget.P, gtarget.C);
    push(off(cc, n, o), colv, gtarget.P, gtarget.C);
  };
  const gpush = (p, c) => push(p, c, gpos, gcol);
  for (const { c: slot, p } of weldedTris()) {
    const pc = palColor(slot);
    const glass = pc.op < 0.5;                       // canopy glass slot
    const c = glass ? new THREE.Color(0x9fb8cc) : pc.color;
    colv = c; gtarget = glass ? { P: gpos, C: gcol } : { P: pos, C: col };
    const e1 = p[1].map((v, i) => v - p[0][i]), e2 = p[2].map((v, i) => v - p[0][i]);
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const L = Math.hypot(...n) || 1;
    const u = n.map(x => x / L);
    const P = glass ? gpush : push;
    // top + bottom faces
    tri(p[0], p[1], p[2], u, T); tri(p[0], p[2], p[1], u, -T);
    // side walls
    for (let i = 0; i < 3; i++) {
      const a = p[i], b = p[(i + 1) % 3];
      P(a.map((v, k) => v + u[k] * T), c); P(b.map((v, k) => v + u[k] * T), c); P(b.map((v, k) => v - u[k] * T), c);
      P(a.map((v, k) => v + u[k] * T), c); P(b.map((v, k) => v - u[k] * T), c); P(a.map((v, k) => v - u[k] * T), c);
    }
    for (let i = 0; i < 3; i++) { wpos.push(...p[i], ...p[(i + 1) % 3]); }   // raw surface edges
  }
  const mk = (P, C, opts, grp = hullGroup) => {
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    hg.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
    hg.computeVertexNormals();
    grp.add(new THREE.Mesh(hg, new THREE.MeshStandardMaterial(Object.assign(
      { vertexColors: true, side: THREE.DoubleSide, flatShading: true, roughness: 0.5, metalness: 0.3 }, opts))));
  };
  mk(pos, col, { transparent: hullOpacity < 1, opacity: hullOpacity });
  mk(gpos, gcol, { transparent: true, opacity: 0.28 * hullOpacity, metalness: 0.9, roughness: 0.1,
                   depthWrite: false });
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3));
  hullWire.add(new THREE.LineSegments(wg,
    new THREE.LineBasicMaterial({ color: 0x7dffcf, transparent: true, opacity: 0.65 })));
}

// pipes: data.pipes segments are axis-aligned runs {start, dir(0..5=+x,-x,+y,-y,+z,-z),
// length}; connectors drawn as markers at the a/b endpoints
const DIRV = [[1,0,0],[0,1,0],[0,0,1],[-1,0,0],[0,-1,0],[0,0,-1]];
function buildPipes() {
  pipeGroup.clear();
  const segs = [], endsA = [], endsB = [];
  const sph = (pt) => {
    const g = new THREE.SphereGeometry(0.035, 8, 6);
    g.applyMatrix4(new THREE.Matrix4().makeTranslation(pt[0], pt[1], pt[2]));
    return g;
  };
  for (const p of model.data.pipes) {
    let cur = [p.segments[0].start.x, p.segments[0].start.y, p.segments[0].start.z];
    const aEnd = [...cur];
    for (const s of p.segments) {
      const d = DIRV[s.dir], L = s.length + 0.01;
      const g = new THREE.BoxGeometry(d[0] ? L : 0.022, d[1] ? L : 0.022, d[2] ? L : 0.022);
      g.applyMatrix4(new THREE.Matrix4().makeTranslation(
        cur[0] + d[0] * L / 2, cur[1] + d[1] * L / 2, cur[2] + d[2] * L / 2));
      segs.push(g);
      cur = cur.map((v, i) => v + d[i] * s.length);
    }
    endsA.push(sph(aEnd)); endsB.push(sph(cur));
  }
  const add = (geos, color, basic) => {
    if (!geos.length) return;
    const mg = mergeGeometries(geos, false);
    if (basic) mg.computeVertexNormals();
    pipeGroup.add(new THREE.Mesh(mg, basic
      ? new THREE.MeshBasicMaterial({ color })
      : new THREE.MeshStandardMaterial({ color, roughness: 0.9 })));
  };
  add(segs, 0x222228, false);
  add(endsA, 0x33ddff, true);
  add(endsB, 0x33ff88, true);
}
function hullAutoFit() {                       // centre hull bbox inside the craft box
  for (const ax of ['x', 'y', 'z']) {
    let lo = Infinity, hi = -Infinity;
    for (const t of model.data.triangles) for (let i = 0; i < 3; i++) {
      const w = (t[`v${i}_${ax}`] + hullP.W * t['frame_' + ax]) * hullP['p' + ax];
      lo = Math.min(lo, w); hi = Math.max(hi, w);
    }
    hullP[`C${ax}`] = (bpBox.min[ax] + bpBox.max[ax]) / 2 - (lo + hi) / 2;
  }
  buildHull();
  ['Cx', 'Cy', 'Cz'].forEach(k => hullRows[k] && hullRows[k].set(hullP[k], false));
}
let bpBox = { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
const hullRows = {};

// ---------- loading / saving ----------
function setModel(obj) {
  model = obj;
  // block-only files omit these keys — normalise so consumers can iterate freely
  model.data.triangles = model.data.triangles || [];
  model.data.pipes = model.data.pipes || [];
  model.data.colors = model.data.colors || [];   // some files ship no palette
  bpBox = { min: model.box_min, max: model.box_max };
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
    for (const k in hullRows) hullRows[k] && hullRows[k].set(hullP[k], false);
    toast(`hull fit: grid W=${fit.W} · pitch (${fit.px.toFixed(4)}, ${fit.py.toFixed(4)}, ${fit.pz.toFixed(4)}) m `
        + `· C (${fit.Cx.toFixed(2)}, ${fit.Cy.toFixed(2)}, ${fit.Cz.toFixed(2)}) · anchor ${fit.d.toFixed(1)}m`);
  }
  buildScene();
  buildList();
  buildInspector();
  calibrateCellMass();
  buildAero();
  buildFlight();
  buildHullList();
  $('filestatus').textContent = `— ${model.data.alias} · ${model.data.components.length} components`;
}

async function fetchDefault() {
  const open = new URLSearchParams(location.search).get('open');
  const urls = open ? [open] : ['blueprint.json', '../testdata/3812927875/blueprint.json'];
  for (const u of urls) {
    let r = null;
    try { r = await fetch(u, { cache: 'no-store' }); } catch { continue; }
    if (!r.ok) continue;
    setModel(await r.json());          // let scene-build bugs surface (window.onerror → title)
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
    setModel(JSON.parse(await (await fileHandle.getFile()).text()));
  } else {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json';
    inp.onchange = async () => setModel(JSON.parse(await inp.files[0].text()));
    inp.click();
  }
}

$('saveBtn').onclick = save;
$('openBtn').onclick = openFile;
addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); }
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'Escape') select(-1);
  if (e.key === 'g') grid.visible = !grid.visible;
  if (e.key === 'o') occGroup.visible = !occGroup.visible;
  if (e.key === 'h') hullGroup.visible = !hullGroup.visible;
  if (e.key === 'f' && selected >= 0) {
    controls.target.copy(compObjs[selected].position);
  }
});
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', async (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (f) setModel(JSON.parse(await f.text()));
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
renderer.domElement.addEventListener('pointermove', (e) => {
  const ci = pick(e);
  if (ci !== hovered) {
    hovered = ci;
    invalidate();
    renderer.domElement.style.cursor = ci >= 0 ? 'pointer' : '';
  }
});
renderer.domElement.addEventListener('pointerdown', (e) => {
  renderer.domElement.dataset.dx = e.clientX; renderer.domElement.dataset.dy = e.clientY;
});
renderer.domElement.addEventListener('pointerup', (e) => {
  const dx = Math.abs(e.clientX - (renderer.domElement.dataset.dx | 0));
  const dy = Math.abs(e.clientY - (renderer.domElement.dataset.dy | 0));
  if (dx < 4 && dy < 4) select(pick(e));
});

function select(i) {
  selected = i;
  invalidate();
  buildInspector();
  buildList();
  paintHighlights();
}
function paintHighlights() {
  compGroup.children.forEach((g, i) => {
    g.traverse(o => {
      if (!o.isMesh || !o.material.emissive) return;
      if (i === selected) o.material.emissive.setHex(0x995000);
      else if (i === hovered) o.material.emissive.setHex(0x222200);
      else o.material.emissive.setHex(0x000000);
    });
  });
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
  const set = (v, mark = true) => {
    rng.value = num.value = v;
    if (mark) { r.classList.add('mod'); markDirty(); }
  };
  rng.oninput = () => { num.value = rng.value; onInput(+rng.value); };
  num.oninput = () => { if (num.value === '') return; const v = +num.value;
                        if (isFinite(v)) { rng.value = v; onInput(v); } };
  rst.onclick = () => { r.classList.remove('mod'); onInput(+value, false); rng.value = num.value = value; };
  sec.appendChild(r);
  return { set, el: r };
}
function markDirty() {
  dirty = true;
  document.body.classList.add('dirty');
  if (model) updateReport();          // live CoM/aero feedback while dragging sliders
}

function secHeader(t) { const h = document.createElement('h3'); h.textContent = t; $('inspector').appendChild(h); }
function secBody() { const s = document.createElement('div'); s.className = 'sec'; $('inspector').appendChild(s); return s; }

function livePos(comp, obj, ax) {
  return (v) => {
    comp.position[ax] = v; obj.position[ax] = v;
    for (const r of realMap.get(obj.userData.ci) || []) r.position[ax] = v;
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
    comp.orientation = { w: q.w, x: q.x, y: q.y, z: q.z };
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
  btn('◀ nose 0.25', () => rz.set(p.z - 0.25));
  btn('tail 0.25 ▶', () => rz.set(p.z + 0.25));
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
    note.textContent = 'negative pitch = lean toward nose (−z)';
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
    obj.position.copy(new THREE.Vector3(comp.position.x, comp.position.y, comp.position.z));
    obj.quaternion.copy(orig[selected].q0);
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
function buildViewOpts() {
  const s = $('viewopts');
  const toggle = (label, target) => {
    const l = document.createElement('label');
    l.className = 'checkrow';
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = target.visible;
    cb.onchange = () => { target.visible = cb.checked; };
    l.append(cb, document.createTextNode(label));
    s.appendChild(l);
  };
  toggle('ground grid', grid);
  toggle('occupancy boxes (type-255)', occGroup);
  toggle('blocks', blockGroup);
  toggle('hull triangles', hullGroup);
  toggle('hull wireframe', hullWire);
  toggle('pipes & connectors', pipeGroup);
  toggle('subgrids (doors/hatches)', subGroup);
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

  const hs = document.createElement('div');
  hs.className = 'sec';
  const mk = (k, label, min, max) => {
    hullRows[k] = row(hs, label, min, max, 1 / 96, hullP[k], v => { hullP[k] = v; buildHull(); buildAero(); });
  };
  mk('px', 'pitch x (m/slot)', 0.05, 0.6);
  mk('py', 'pitch y', 0.05, 0.6); mk('pz', 'pitch z', 0.05, 0.6);
  mk('W', 'slots / frame tile', 4, 28);
  mk('Cx', 'offset x', -8, 8); mk('Cy', 'offset y', -8, 8); mk('Cz', 'offset z', -8, 8);
  row(hs, 'hull opacity', 0.1, 1, 0.05, hullOpacity, v => { hullOpacity = v; buildHull(); });
  const fit = document.createElement('button');
  fit.className = 'btn'; fit.textContent = 'auto-fit offsets to bounding box';
  fit.onclick = hullAutoFit;
  hs.appendChild(fit);
  const note = document.createElement('div');
  note.style.color = 'var(--dim)';
  note.style.marginTop = '4px';
  note.textContent = 'hull world = (v + W·frame)·pitch + C. Vertices are lattice slots; shared '
    + 'slots are welded points. W comes from cross-frame weld pairs (canopy ridge), pitches from '
    + 'the bounding box, y from aileron height. Nudge sliders to wrap the skin onto the components.';
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
const comMarker = new THREE.Group();
scene.add(comMarker);
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
let aeroPlates = [], flowPts = null, flowData = null, flowOn = false;
const flowGroup = new THREE.Group(); scene.add(flowGroup);
const aeroArrows = new THREE.Group(); scene.add(aeroArrows);
const flowState = { speed: 60, aoa: 4 };

function plateFromTri(t) {
  const p = [];
  for (let i = 0; i < 3; i++) p.push([hullPt(t, 'x', i), hullPt(t, 'y', i), hullPt(t, 'z', i)]);
  const a = p[0], b = p[1], c = p[2];
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const len = Math.hypot(...n) || 1e-9;
  return { name: 'hull', c: [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3],
           n: n.map(x => x / len), area: len / 2, R: Math.sqrt(len / 2 / Math.PI) + 0.15 };
}

function buildAero() {
  if (!model) return;
  aeroPlates = [];
  for (const t of model.data.triangles) aeroPlates.push(plateFromTri(t));
  for (const c of model.data.components) {
    const q = new THREE.Quaternion(c.orientation.x, c.orientation.y, c.orientation.z, c.orientation.w);
    const f = footprint(c);
    if (c.type === 'Aileron') {
      const n = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      const R = q.clone();
      aeroPlates.push({ name: c.position.z < 0 ? 'canard' : 'aileron',
        c: [c.position.x, c.position.y, c.position.z], n: [n.x, n.y, n.z],
        area: f.x * f.z * 0.72, R: 0.75 });
      const defl = c.position.z < 0 ? 1.05 : 0.12;
      const fl = new THREE.Vector3(0, Math.cos(defl), Math.sin(defl))
        .applyQuaternion(q).normalize();
      aeroPlates.push({ name: 'flap', c: [c.position.x, c.position.y, c.position.z],
        n: [fl.x, fl.y, fl.z], area: f.x * f.z * 0.3, R: 0.4 });
    } else if (c.type === 'SolarPanel') {
      const n = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      aeroPlates.push({ name: 'solar panel', c: [c.position.x, c.position.y, c.position.z],
        n: [n.x, n.y, n.z], area: f.x * f.z, R: 1.2 });
    } else if (c.type === 'SmallWheel') {
      aeroPlates.push({ name: 'wheel', bluff: true, c: [c.position.x, c.position.y, c.position.z],
        n: [0, 0, 1], area: Math.PI * 0.17 * 0.10, R: 0.3 });
    }
  }
  initFlow();
  updateReport();
}

function flowDir() {
  const seat = model?.data.components.find(c => c.type === 'PilotSeat');
  let up = [0, 0, -1];
  if (seat) {
    const q = new THREE.Quaternion(seat.orientation.x, seat.orientation.y, seat.orientation.z, seat.orientation.w);
    up = new THREE.Vector3(0, 0, -1).applyQuaternion(q).toArray();
  }
  // AoA: relative wind travels tail-ward and slightly upward (comes from front-below)
  const a = flowState.aoa * Math.PI / 180;
  const sp = Math.sin(a), cp = Math.cos(a);
  const tail = up.map(x => -x);                      // seat faces forward; wind travels to tail
  return [tail[0] * cp, sp, tail[2] * cp];
}

function sampleVel(p, dir, V) {
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
  return v;
}

function initFlow() {
  flowGroup.clear();
  const N = 2200;
  flowData = new Float32Array(N * 3);
  const b = model.box_min, B = model.box_max;
  for (let i = 0; i < N; i++) respawn(flowData, i * 3, b, B);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(flowData, 3));
  flowPts = new THREE.Points(g, new THREE.PointsMaterial({
    size: 0.09, sizeAttenuation: true, vertexColors: true, transparent: true, opacity: 0.95 }));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  flowGroup.add(flowPts);
  flowGroup.visible = flowOn;
  buildStreamlines();
}
// streamlines: integrate the same deflected velocity field both ways from a
// seed grid, so the eye can follow how air is routed around the craft.
// Blue = freestream speed, red = accelerated flow (stylized, not CFD).
function buildStreamlines() {
  for (const o of [...flowGroup.children]) if (o.isLine) flowGroup.remove(o);
  if (!model || !flowOn) return;
  const V = Math.max(1, flowState.speed), dir = flowDir();
  const b = model.box_min, B = model.box_max;
  const matS = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 });
  const ALL = [], ALLC = [];
  const colOf = (sp, arr) => {
    const c = new THREE.Color().setHSL(clamp(0.66 - (sp / V - 1) * 1.3, 0.02, 0.66), 0.95, 0.55);
    arr.push(c.r, c.g, c.b);
  };
  for (let y = b.y - 0.35; y <= B.y + 1.0; y += 0.45)
    for (let x = b.x - 0.5; x <= B.x + 0.5; x += 1.1) {
      const seed = [x, y, (b.z + B.z) / 2];
      const fwd = [], fc = [], back = [], bc = [];
      const walk = (sgn, pts, cs) => {
        let p = [...seed];
        for (let k = 0; k < 75; k++) {
          const v = sampleVel(p, dir, V);
          p = p.map((q, i) => q + sgn * v[i] * 0.07);
          pts.push(p[0], p[1], p[2]);
          colOf(Math.hypot(v[0], v[1], v[2]), cs);
          if (Math.abs(p[0]) > B.x + 2.5 || Math.abs(p[2]) > 16 || p[1] > B.y + 4 || p[1] < -1.5) break;
        }
      };
      walk(1, fwd, fc); walk(-1, back, bc);
      const pts = [], cs = [];
      for (let k = back.length - 3; k >= 0; k -= 3) { pts.push(back[k], back[k + 1], back[k + 2]); cs.push(bc[k], bc[k + 1], bc[k + 2]); }
      pts.push(...fwd); cs.push(...fc);
      for (let k = 0; k + 5 < pts.length; k += 3) {          // polyline → segments
        ALL.push(pts[k], pts[k + 1], pts[k + 2], pts[k + 3], pts[k + 4], pts[k + 5]);
        ALLC.push(cs[k], cs[k + 1], cs[k + 2], cs[k + 3], cs[k + 4], cs[k + 5]);
      }
    }
  if (ALL.length >= 6) {
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(ALL), 3));
    lg.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(ALLC), 3));
    flowGroup.add(new THREE.LineSegments(lg, matS));
  }
}
function respawn(arr, i, b, B) {
  const d = flowDir();
  for (let k = 0; k < 3; k++) arr[i + k] = b[k] + Math.random() * (B[k] - b[k]) + (B[k] - b[k]) * 0.55 * (d[k] < -0.001 ? -1 : d[k] > 0.001 ? 1 : 0);
  arr[i + 1] = model.box_min.y + Math.random() * (model.box_max.y - model.box_min.y) * 2.2;
}
function stepFlow(dt) {
  if (!flowData || !flowOn) return;
  const V = Math.max(1, flowState.speed), dir = flowDir();
  const b = model.box_min, B = model.box_max;
  const R = 1.6;
  const pos = flowPts.geometry.attributes.position.array;
  const col = flowPts.geometry.attributes.color.array;
  for (let i = 0; i < pos.length; i += 3) {
    const v = sampleVel([pos[i], pos[i + 1], pos[i + 2]], dir, V);
    const sp = Math.hypot(v[0], v[1], v[2]);
    pos[i] += v[0] * dt * 0.35; pos[i + 1] += v[1] * dt * 0.35; pos[i + 2] += v[2] * dt * 0.35;
    const t = clamp(sp / (V * 1.4), 0, 1);
    col[i] = 0.25 + t * 0.75; col[i + 1] = 0.45 + t * 0.3; col[i + 2] = 1 - t * 0.6;
    const out = pos[i] < b.x - R || pos[i] > B.x + R || pos[i + 2] < b.z - R || pos[i + 2] > B.z + R
             || pos[i + 1] > B.y + R;
    if (out) respawn(pos, i, b, B);
  }
  flowPts.geometry.attributes.position.needsUpdate = true;
  flowPts.geometry.attributes.color.needsUpdate = true;
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
  el.textContent =
`speed ${flowState.speed} m/s (${(flowState.speed * 3.6).toFixed(0)} km/h) · AoA ${flowState.aoa}° · q=${A.qd.toFixed(0)}Pa
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
  row(s, 'speed', 0, 160, 1, flowState.speed, v => { flowState.speed = v; updateReport(); buildStreamlines(); });
  row(s, 'AoA °', -8, 20, 0.5, flowState.aoa, v => { flowState.aoa = v; updateReport(); buildStreamlines(); });
  row(s, 'kg / block cell (0.25 m cube)', 0.2, 20, 0.05, cellMass, v => { cellMass = v; updateReport(); });
  const cal = document.createElement('button');
  cal.className = 'btn'; cal.textContent = 'calibrate cells to declared mass';
  cal.onclick = () => { calibrateCellMass(); buildFlight(); updateReport(); toast(`cell = ${cellMass.toFixed(2)} kg`); };
  const flowB = document.createElement('button');
  flowB.className = 'btn'; flowB.style.marginLeft = '4px';
  flowB.textContent = flowOn ? 'flow: on' : 'flow: off';
  flowB.onclick = () => { flowOn = !flowOn; flowGroup.visible = flowOn; buildStreamlines();
    flowB.textContent = flowOn ? 'flow: on' : 'flow: off'; };
  const comB = document.createElement('button');
  comB.className = 'btn'; comB.style.marginLeft = '4px';
  comB.textContent = 'CoM/arrows: ' + (aeroArrows.visible ? 'on' : 'off');
  comB.onclick = () => { aeroArrows.visible = comMarker.visible = !aeroArrows.visible;
    comB.textContent = 'CoM/arrows: ' + (aeroArrows.visible ? 'on' : 'off'); };
  s.appendChild(cal); s.appendChild(flowB); s.appendChild(comB);
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
      g.setAttribute('position', new THREE.Float32BufferAttribute(p.flat(), 3));
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xff3355, side: THREE.DoubleSide }));
      hullGroup.add(m);
      setTimeout(() => hullGroup.remove(m), 1400);
    };
    el.appendChild(d);
  });
}

// ---------- animate (on-demand: iGPUs idle at ~0% until something changes) ----------
let needsRender = true, perfT0 = 0, perfFrames = 0;
function invalidate() { needsRender = true; }
let lastT = 0;
function tick(t) {
  requestAnimationFrame(tick);
  const dt = Math.min(0.05, (t - lastT) / 1000 || 0.016);
  lastT = t;
  controls.update();                                  // 'change' event → invalidate
  if (flowOn) stepFlow(dt);
  if (perfT0) needsRender = true;
  if (!needsRender && !flowOn) return;
  needsRender = false;
  if (flowPts) flowPts.visible = flowOn;
  paintHighlights();
  renderer.render(scene, camera);
  const sel = selected >= 0 ? model.data.components[selected] : null;
  $('hud').textContent = sel
    ? `${sel.type}[${selected}]  pos(${fmt(sel.position.x)}, ${fmt(sel.position.y)}, ${fmt(sel.position.z)})` +
      `  pitch ${fmt(2 * Math.asin(clamp(-sel.orientation.x, -1, 1)) * 180 / Math.PI)}°`
    : 'Archean blueprint viewer — click a component';
  if (perfT0 && performance.now() >= perfT0) {
    perfFrames++;
    const el = performance.now() - perfT0;
    if (el > 1200 || (perfFrames >= 3 && el > 400)) {   // heavy scenes: 3 frames is plenty for draw stats
      document.title = `PERF fps=${(perfFrames / el * 1000).toFixed(1)} draw=${renderer.info.render.calls}`
        + ` tris=${renderer.info.render.triangles} geo=${renderer.info.memory.geometries}`;
      perfT0 = 0;
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
        type: t, module: 'x', alias: '', colors: {}, data: {},
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

// ---------- init ----------
if (location.search.includes('real')) realModelsOn = true;   // before buildViewOpts (checkbox state)
function applyCamQ() {                                        // ?cam=px,py,pz,tx,ty,tz
  const camQ = new URLSearchParams(location.search).get('cam');
  if (!camQ) return;
  const [x, y, z, tx = 0, ty = 0, tz = 0] = camQ.split(',').map(Number);
  camera.position.set(x, y, z);
  controls.target.set(tx, ty, tz);
  invalidate();
}
buildViewOpts();
buildFlight();
onResize();
if (location.search.includes('hull')) hullGroup.visible = true;
if (location.search.includes('occ')) occGroup.visible = true;
if (location.search.includes('flow')) flowOn = true;
if (location.search.includes('perf')) perfT0 = performance.now() + 1500;  // measure after load settles
loadModelManifest().then(fetchDefault).then(applyCamQ);
requestAnimationFrame(tick);
if (location.search.includes('proxytest')) runProxyTest();

// ---------- self-test (view3d.html?selftest): simulates slider edits + save ----------
if (location.search.includes('selftest')) {
  setTimeout(() => {
    try {
      const idx = model.data.components.findIndex(c => c.type === 'PilotSeat');
      select(idx);
      const comp = model.data.components[idx], obj = compObjs[idx];
      comp.position.z += 0.25; obj.position.z += 0.25;                     // like the z slider
      const q = new THREE.Quaternion()
        .setFromEuler(new THREE.Euler(-20 * Math.PI / 180, 0, 0, 'YXZ'))
        .multiply(obj.quaternion);                                          // like the pitch slider
      obj.quaternion.copy(q);
      comp.orientation = { w: q.w, x: q.x, y: q.y, z: q.z };
      const text = serialize(), ref = JSON.parse(text);
      const seat = ref.data.components[idx], occ = seat.occupancies[0];
      const mir = ref.data.blocks.find(b => b.type === 255 && b.size_x === 1 && b.size_y === 5
                 && b.size_z === 2 && b.pos_z === occ.pos_z);
      const ok1 = occ.pos_z === orig[idx].occ0[0].pos_z + 1;
      const ok3 = JSON.stringify(JSON.parse(text)) === text;
      document.title = 'SELFTEST ' + (ok1 && mir && ok3 ? 'PASS' : 'FAIL')
        + ' occ_z=' + occ.pos_z + ' mirror=' + !!mir
        + ' pitch=' + (2 * Math.asin(-seat.orientation.x) * 180 / Math.PI).toFixed(1) + '°';
    } catch (e) { document.title = 'SELFTEST ERR ' + e.message; }
  }, 1500);
}
