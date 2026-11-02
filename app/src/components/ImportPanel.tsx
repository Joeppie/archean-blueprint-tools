// components/ImportPanel.tsx — the import SURFACE: file drop (all formats)
// + the live lattice preview canvas (0.25 m grid, 3 m frame boxes, ghost,
// quantised result, red non-manifold lines). Mounted by BOTH surfaces:
// the 🧊 workspace dialog (File ▸ Import) and the TOOLS ▸ Import 3D model
// placement flow (the zeppelin ritual: preview → ghost → ✔ Build).
// The loaders speak: GLB/glTF (+.bin/.png sidecars), OBJ (+MTL), STL, PLY,
// 3DS, DAE; .skp/.gsm answer with the export pointer (docs/IMPORT-3D.md).

import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { TDSLoader } from 'three/examples/jsm/loaders/TDSLoader.js';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CELL } from '../engine/format';
import type { Blueprint } from '../engine/format';
import { DEFAULT_PALETTE } from '../engine/palette';
import type { PaletteEntry } from '../engine/palette';
import { decodeSkinTri } from '../engine/latsphere';
import type { ImportResult, SrcMesh } from '../engine/import';

export default function ImportPanel(p: {
  bp: Blueprint;
  res: ImportResult | null;
  onSrcs: (srcs: SrcMesh[] | null, name: string) => void;
  srcName: string;
}) {
  const bp = p.bp;
  const fileRef = useRef<HTMLInputElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [loadErr, setLoadErr] = useState('');
  const [drag, setDrag] = useState(false);
  // 🎮 the game's OWN models: the dev pair knows the installed game
  // (blueprints.conf game_dir); a component = gltf + bins + pngs, exactly
  // what the game reads from its folder — so the picker serves the whole
  // folder (we: "all files CAN be read by the game, so we CAN READ THEM").
  // Machines/deploys without a game install: the probe 404s, button hides.
  const [gameModels, setGameModels] = useState<
    { module: string; name: string; files: string[] }[] | null>(null);
  const [gameOpen, setGameOpen] = useState(false);
  const [gameQ, setGameQ] = useState('');
  useEffect(() => {
    let live = true;
    fetch('/game-models/').then(r => (r.ok ? r.json() : null))
      .then(j => { if (live && j?.models?.length) setGameModels(j.models); })
      .catch(() => { /* no game dir on this machine */ });
    return () => { live = false; };
  }, []);

  // ---------- loaders ----------

  const soup = (g: THREE.BufferGeometry, base: THREE.Color | null,
    mapImage?: HTMLImageElement | HTMLCanvasElement): SrcMesh => {
    const geo = g.index ? g.toNonIndexed() : g;
    const pos = Float32Array.from(geo.getAttribute('position').array);
    const ca = geo.getAttribute('color');
    const uv = geo.getAttribute('uv');
    let col: Float32Array | undefined;
    // textured downloads (nearly every site model): bake each FACE's texture
    // average — the quantiser speaks palette slots, not image maps, so the
    // map's colour must become geometry colour at load time
    if (!ca && mapImage && uv && pos.length >= 9) {
      try {
        const N = 128;
        const cv = document.createElement('canvas');
        cv.width = N; cv.height = N;
        const cx = cv.getContext('2d');
        cx?.drawImage(mapImage, 0, 0, N, N);
        if (cx) {
          const px = cx.getImageData(0, 0, N, N).data;
          col = new Float32Array(pos.length);
          for (let t = 0; t < pos.length / 9; t++) {
            let su = 0, sv = 0;
            for (let k = 0; k < 3; k++) {
              su += uv.getX(t * 3 + k); sv += uv.getY(t * 3 + k);
            }
            const ix = Math.min(N - 1, Math.max(0,
              Math.round((((su / 3) % 1) + 1) % 1 * (N - 1))));
            const iy = Math.min(N - 1, Math.max(0,
              Math.round((1 - (((sv / 3) % 1) + 1) % 1) * (N - 1))));
            const o = (iy * N + ix) * 4;
            // canvas px = sRGB 0..255 → LINEAR, times the Kd factor (linear)
            for (let k = 0; k < 3; k++) {
              const t01 = Math.pow(px[o + k]! / 255, 2.2);
              const kd = base ? [base.r, base.g, base.b][k]! : 1;
              for (let v = 0; v < 3; v++) col[t * 9 + v * 3 + k] = t01 * kd;
            }
          }
        }
      } catch { /* tainted canvas (packed textures are same-origin): fall
                   through to the Kd colour */ }
    }
    if (!col && ca) {
      col = new Float32Array(pos.length);
      for (let i = 0, v = 0; v < pos.length; i++, v += 3)
        for (let k = 0; k < 3; k++)
          col[v + k] = k === 0 ? ca.getX(i) : k === 1 ? ca.getY(i) : ca.getZ(i);
      // PLY stores 0..255 ints (sRGB); three float colour attrs are linear
      let hi = 0;
      for (let i = 0; i < col.length; i++) hi = Math.max(hi, col[i]!);
      if (hi > 1.5) for (let i = 0; i < col.length; i++) col[i]! /= 255;
      if (ca.normalized) for (let i = 0; i < col.length; i++) col[i]! /= 255;
      if (hi > 1.5 || ca.normalized)
        for (let i = 0; i < col.length; i++) col[i] = Math.pow(col[i]!, 2.2);
    } else if (!col && base) {
      col = new Float32Array(pos.length);
      for (let v = 0; v < pos.length; v += 3)
        col.set([base.r, base.g, base.b], v);
    }
    return { pos, col };
  };

  const loadFiles = useCallback(async (files: File[]) => {
    setLoadErr('');
    const ext = (f: File) => (f.name.split('.').pop() ?? '').toLowerCase();
    // the primary model file, not files[0]: multi-select order is a coin
    // flip (Ctrl+click / drag pile) — the sidecars (.bin/.png/.mtl) follow
    const PRIMARY = ['glb', 'gltf', 'obj', 'stl', 'ply', '3ds', 'dae', 'skp', 'gsm'];
    const first = files.find(f => PRIMARY.includes(ext(f))) ?? files[0];
    if (!first) return;
    try {
      const out: SrcMesh[] = [];
      const pull = (obj: THREE.Object3D) => {
        obj.traverse(m => {
          const mesh = m as THREE.Mesh;
          if (!mesh.isMesh || !mesh.geometry) return;
          const mat = mesh.material as THREE.Material & {
            color?: THREE.Color; map?: THREE.Texture;
          };
          mesh.updateWorldMatrix(true, false);
          const g = mesh.geometry.clone() as THREE.BufferGeometry;
          g.applyMatrix4(mesh.matrixWorld);
          out.push(soup(g, mat?.color ?? null,
            mat?.map?.image as HTMLImageElement | undefined));
        });
      };
      const e = ext(first);
      if (e === 'glb' || e === 'gltf') {
        // a .gltf with sidecar .bin/.png: the dropped files resolve through
        // blob URLs (fetching 'Foo.bin' from the page URL would land on the
        // SPA fallback's index.html — HTML as a vertex buffer is exactly the
        // 'Float32Array out of bounds' the game .gltf files hit)
        const urls = new Map(files.filter(f => f !== first)
          .map(f => [f.name.toLowerCase(), URL.createObjectURL(f)]));
        let gltf;
        try {
          const manager = new THREE.LoadingManager();
          if (urls.size)
            manager.resolveURL = (u: string) => {
              const n = u.split(/[\\/]/).pop()!.toLowerCase();
              return urls.get(n) ?? u;
            };
          gltf = await new GLTFLoader(manager).parseAsync(
            await first.arrayBuffer(), '');
        } finally {
          urls.forEach(u => URL.revokeObjectURL(u));
        }
        pull(gltf.scene);
      } else if (e === 'obj') {
        // an .obj drop may carry its .mtl (Kd colours ride the collection;
        // textures are deliberately unread — the quantiser speaks palette
        // slots, not image maps)
        const ol = new OBJLoader();
        const mtl = files.find(f => ext(f) === 'mtl');
        if (mtl) ol.setMaterials(new MTLLoader().parse(await mtl.text(), ''));
        pull(ol.parse(await first.text()));
      } else if (e === 'stl') {
        const g = new STLLoader().parse(await first.arrayBuffer());
        out.push(soup(g, null));
      } else if (e === 'ply') {
        const g = new PLYLoader().parse(await first.arrayBuffer());
        out.push(soup(g, null));
      } else if (e === '3ds') {
        pull(new TDSLoader().parse(await first.arrayBuffer(), first.name));
      } else if (e === 'dae') {
        // SketchUp's native export (File ▸ Export ▸ Collada), Blender, Max,
        // Maya — ColladaLoader honours the file's <unit> scale and upAxis
        const dae = new ColladaLoader().parse(await first.text(), '');
        if (dae) pull(dae.scene);
      } else if (e === 'skp') {
        setLoadErr('a .skp is Trimble\'s proprietary SketchUp binary — no ' +
          'browser parser exists. File ▸ Export Model ▸ Collada (.dae) (or ' +
          'OBJ/STL) and drop THAT — .skp itself lands in the python tier ' +
          '(assimp reads it).');
        return;
      } else if (e === 'gsm') {
        setLoadErr('a .gsm is an Archicad LIBRARY PART (parametric GDL ' +
          'source, not a mesh — no public parser). In Archicad: File ▸ ' +
          'Libraries and Objects ▸ Export 3D Geometry… ▸ OBJ — then drop ' +
          'the .obj here.');
        return;
      } else {
        setLoadErr(`'${e}' not supported here — export GLB/glTF/OBJ/STL/PLY/` +
          `3DS/DAE (FBX and .blend: pre-bake in Blender, one menu hop)`);
        return;
      }
      if (!out.length) { setLoadErr('no meshes found'); return; }
      p.onSrcs(out, files.map(f => f.name).join(' + '));
    } catch (err) {
      setLoadErr(`⚠ ${String(err)}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** read a whole game component FOLDER (gltf + its .bin/.png sidecars —
   *  exactly what the game reads) and run it through the SAME loader */
  const loadGameModel = useCallback(async (
    m: { module: string; name: string; files: string[] }) => {
    setLoadErr('');
    try {
      const files: File[] = [];
      for (const f of m.files) {
        const r = await fetch(`/game-models/${encodeURIComponent(m.module)}`
          + `/${encodeURIComponent(m.name)}/${encodeURIComponent(f)}`);
        if (r.ok) files.push(new File([await r.blob()], f));
      }
      if (!files.length) { setLoadErr('the game folder served no files'); return; }
      await loadFiles(files);
    } catch (e) { setLoadErr(`⚠ ${String(e)}`); }
  }, [loadFiles]);

  // ---------- palette colour for a slot ----------

  const slotColor = useCallback((slot: number): THREE.Color => {
    const f = bp.data.colors?.[slot];
    const e: PaletteEntry | undefined =
      f && typeof f.r === 'number' && typeof f.g === 'number' &&
      typeof f.b === 'number' ? f as PaletteEntry : DEFAULT_PALETTE[slot] ?? undefined;
    const c = new THREE.Color();
    if (e) c.setRGB(e.r / 255, e.g / 255, e.b / 255, THREE.LinearSRGBColorSpace);
    else c.set(0xff00ff);
    return c;
  }, [bp]);

  // ---------- the preview scene ----------

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2.5, Math.max(1, devicePixelRatio)));
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a111c);
    const cam = new THREE.PerspectiveCamera(50, 1, 0.02, 6000);
    const ctl = new OrbitControls(cam, renderer.domElement);
    ctl.enableDamping = true;
    scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x2a2318, 1.15));
    const sun = new THREE.DirectionalLight(0xffffff, 1.3);
    sun.position.set(8, 14, 6);
    scene.add(sun);
    const disposables: { dispose(): void }[] = [renderer];
    const add = (o: THREE.Object3D) => {
      scene.add(o);
      o.traverse(x => {
        const m = x as THREE.Mesh;
        if ((m as THREE.Mesh).geometry) disposables.push(m.geometry);
        const mat = (m as THREE.Mesh).material;
        if (mat) (Array.isArray(mat) ? mat : [mat]).forEach(x2 => disposables.push(x2));
      });
    };
    const res = p.res;
    // bounds: ghost (metres) + blocks (cells)
    const mn = new THREE.Vector3(Infinity, Infinity, Infinity),
      mx = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    const eat = (x: number, y: number, z: number) => {
      mn.min(new THREE.Vector3(x, y, z)); mx.max(new THREE.Vector3(x, y, z));
    };
    const gh = res?.ghost;
    if (gh)
      for (let i = 0; i < gh.length; i += 3) eat(gh[i]!, gh[i + 1]!, gh[i + 2]!);
    for (const b of res?.blocks ?? []) {
      const c: [number, number, number] =
        [(b.frame_x ?? 0) * 12 + b.pos_x, (b.frame_y ?? 0) * 12 + b.pos_y,
          (b.frame_z ?? 0) * 12 + b.pos_z];
      eat((c[0] - 6) * CELL, (c[1] - 6) * CELL, (c[2] - 6) * CELL);
      eat((c[0] + b.size_x + 1 - 6) * CELL, (c[1] + b.size_y + 1 - 6) * CELL,
        (c[2] + b.size_z + 1 - 6) * CELL);
    }
    if (!isFinite(mn.x)) { mn.set(-3, -3, -3); mx.set(3, 3, 3); }
    const ctr = mn.clone().add(mx).multiplyScalar(0.5);
    const span = mx.clone().sub(mn).length();
    const d = Math.max(4, span);
    cam.position.set(ctr.x + d, ctr.y + d * 0.7, ctr.z + d * 1.3);
    ctl.target.copy(ctr);

    // ① ghost — the decimated source, translucent intent
    if (res && res.ghost.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(res.ghost.slice(), 3));
      add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({
        color: 0x7dffcf, transparent: true, opacity: 0.1, side: THREE.DoubleSide,
        depthWrite: false })));
    }
    // ② the lattice output, as the game renders it
    if (res && res.blocks.length) {
      const geo = new THREE.BoxGeometry(CELL, CELL, CELL);
      const inst = new THREE.InstancedMesh(geo,
        new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0.05 }),
        res.blocks.length);
      const m4 = new THREE.Matrix4();
      res.blocks.forEach((b, i) => {
        const c: [number, number, number] =
          [(b.frame_x ?? 0) * 12 + b.pos_x,
            (b.frame_y ?? 0) * 12 + b.pos_y, (b.frame_z ?? 0) * 12 + b.pos_z];
        m4.setPosition(
          (c[0] + (b.size_x + 1) / 2 - 6) * CELL,
          (c[1] + (b.size_y + 1) / 2 - 6) * CELL,
          (c[2] + (b.size_z + 1) / 2 - 6) * CELL);
        inst.setMatrixAt(i, m4);
        inst.setColorAt(i, slotColor(b.colors?.[0] ?? 4));
      });
      inst.instanceMatrix.needsUpdate = true;
      add(inst);
    }
    if (res && res.triangles.length) {
      const pos = new Float32Array(res.triangles.length * 9);
      const col = new Float32Array(res.triangles.length * 9);
      res.triangles.forEach((t, i) => {
        const g3 = decodeSkinTri(t);
        const c = slotColor(t.colors?.[0] ?? 4);
        g3.forEach((v, k) => {
          for (let a = 0; a < 3; a++) {
            pos[i * 9 + k * 3 + a] = (v[a as 0 | 1 | 2] - 6) * CELL;
            col[i * 9 + k * 3 + a] = [c.r, c.g, c.b][a]!;
          }
        });
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({
        vertexColors: true, side: THREE.DoubleSide })));
    }
    // ③ legality: non-manifold edges in red (never silent)
    if (res && res.nmEdges.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(res.nmEdges.slice(), 3));
      add(new THREE.LineSegments(g,
        new THREE.LineBasicMaterial({ color: 0xff3355 })));
    }
    // ④ the grid: cell lines on the ground, 3 m FRAME BOXES = the triangle
    //    window legal zone (FORMAT §Triangles), ±axis marks
    const c0 = Math.floor(mn.x / CELL + 6) - 2,
      c1 = Math.ceil(mx.x / CELL + 6) + 2,
      d0 = Math.floor(mn.z / CELL + 6) - 2,
      d1 = Math.ceil(mx.z / CELL + 6) + 2,
      gY = (Math.floor(mn.y / CELL + 6) - 2) * CELL;
    const minor: number[] = [], major: number[] = [];
    const W = (c: number) => (c - 6) * CELL;
    for (let c = c0; c <= c1; c++) {
      const t = c % 12 === 0 ? major : minor;
      t.push(W(c), gY, W(d0), W(c), gY, W(d1));
    }
    for (let c = d0; c <= d1; c++) {
      const t = c % 12 === 0 ? major : minor;
      t.push(W(c0), gY, W(c), W(c1), gY, W(c));
    }
    const mk = (pts: number[], color: number, op: number) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({
        color, transparent: op < 1, opacity: op })));
    };
    mk(minor, 0x2a3a55, 0.55);
    mk(major, 0x4b6a9b, 1);
    // frame boxes (12-cell = 3 m cubes) around the model
    const f0 = Math.floor((mn.x + 1.5) / 3), f1 = Math.floor((mx.x + 1.5) / 3),
      h0 = Math.floor((mn.y + 1.5) / 3), h1 = Math.floor((mx.y + 1.5) / 3),
      e0 = Math.floor((mn.z + 1.5) / 3), e1 = Math.floor((mx.z + 1.5) / 3);
    const segs: number[] = [];
    for (let fx = f0; fx <= f1; fx++)
      for (let fy = h0; fy <= h1; fy++)
        for (let fz = e0; fz <= e1; fz++) {
          const x = fx * 3, y = fy * 3, z = fz * 3;
          const P = [[x - 1.5, y - 1.5, z - 1.5], [x + 1.5, y - 1.5, z - 1.5],
            [x + 1.5, y - 1.5, z + 1.5], [x - 1.5, y - 1.5, z + 1.5],
            [x - 1.5, y + 1.5, z - 1.5], [x + 1.5, y + 1.5, z - 1.5],
            [x + 1.5, y + 1.5, z + 1.5], [x - 1.5, y + 1.5, z + 1.5]];
          const E: [number, number][] =
            [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7],
              [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
          for (const [a, b] of E)
            segs.push(...P[a]!, ...P[b]!);
        }
    mk(segs, 0x7dffcf, 0.16);
    const L = Math.max(4, span * 0.8);
    mk([0, 0, 0, L, 0, 0], 0xff6b6b, 0.9);
    mk([0, 0, 0, 0, L, 0], 0x8ef07d, 0.9);
    mk([0, 0, 0, 0, 0, L], 0x6bb6ff, 0.9);

    const resize = () => {
      const w = host.clientWidth || 480, h = host.clientHeight || 360;
      renderer.setSize(w, h);
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    let raf = 0;
    const loop = () => { ctl.update(); renderer.render(scene, cam); raf = requestAnimationFrame(loop); };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      ctl.dispose();
      disposables.forEach(d => d.dispose());
      renderer.domElement.remove();
    };
  }, [p.res, slotColor]);

  return (
    <div className="relative flex min-h-0 flex-1 gap-2">
      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden rounded bg-[#0a111c]"
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => {
          e.preventDefault(); setDrag(false);
          const items = Array.from(e.dataTransfer.items ?? [])
            .map(i => i.webkitGetAsEntry?.());
          if (items.some(i => i?.isDirectory)) {
            // a whole GAME COMPONENT FOLDER: the game reads a folder (gltf +
            // bins + pngs), so we read a folder too — walk the dropped
            // entries and feed the set through the same loader
            void (async () => {
              const out: File[] = [];
              const walk = async (en: FileSystemEntry) => {
                if (out.length > 200) return;
                if (en.isFile)
                  out.push(await new Promise<File>((res, rej) =>
                    (en as FileSystemFileEntry).file(res, rej)));
                else if (en.isDirectory) {
                  const rd = (en as FileSystemDirectoryEntry).createReader();
                  for (;;) {
                    const batch = await new Promise<FileSystemEntry[]>(
                      (res, rej) => rd.readEntries(res, rej));
                    if (!batch.length) break;
                    for (const c of batch) await walk(c);
                  }
                }
              };
              for (const en of items) if (en) await walk(en);
              if (out.length) await loadFiles(out);
            })();
            return;
          }
          const fl = e.dataTransfer.files;
          if (fl.length) void loadFiles(Array.from(fl));
        }}>
        <div ref={hostRef} data-testid="import-canvas" className="absolute inset-0" />
        {!p.srcName && !loadErr && (
          <div data-testid="import-drop"
            className={`absolute inset-0 grid place-items-center text-center text-[12px] ${drag ? 'outline outline-2 outline-[#7dffcf]' : ''}`}>
            <span className="text-[#5f7494]">drop a model here<br />
              <span className="text-[10px]">GLB · glTF (+.bin/.png) · OBJ (+.mtl) · STL · PLY · 3DS · DAE</span>
            </span>
          </div>
        )}
        {p.srcName && (
          <div className="absolute left-2 top-2 rounded bg-[#101a2b]/85 px-2 py-1 text-[10px] text-[#9fb4d0]">
            {p.srcName}
          </div>
        )}
        {loadErr && (
          <div data-testid="import-loaderr"
            className="absolute left-2 bottom-2 right-2 rounded bg-[#3a1622]/90 px-2 py-1 text-[11px] text-[#ff9d7d]">
            {loadErr}
          </div>
        )}
      </div>
      <div className="flex w-40 shrink-0 flex-col gap-1">
        <button data-testid="import-pick" className="ksp-btn w-full px-2 py-1 text-[11px]"
          onClick={() => fileRef.current?.click()}>
          📁 Model files…
        </button>
        <input ref={fileRef} type="file" multiple className="hidden" data-testid="import-input"
          accept=".glb,.gltf,.bin,.png,.jpg,.jpeg,.obj,.mtl,.stl,.ply,.3ds,.dae,.skp,.gsm"
          onChange={e => { const fl = e.target.files; if (fl?.length) void loadFiles(Array.from(fl)); e.target.value = ''; }} />
        {gameModels && (
          <button data-testid="import-gamemodels"
            title="browse the INSTALLED GAME's component models (gltf + bins + pngs, straight from the game folder)"
            className="ksp-btn w-full px-2 py-1 text-[11px]"
            onClick={() => { setGameOpen(true); setGameQ(''); }}>
            🎮 Game models…
          </button>
        )}
        {p.res?.ok && (
          <div data-testid="import-stats-mini"
            className="rounded bg-[#16233c] p-2 text-[10px] leading-relaxed tabular-nums text-[#c8d4e4]">
            <div>{(p.res.stats.srcTris).toLocaleString()} tris in</div>
            {p.res.stats.decTris !== p.res.stats.srcTris &&
              <div>{p.res.stats.decTris.toLocaleString()} after QEM</div>}
            <div>{p.res.stats.merged.toLocaleString()} coplanar merged</div>
            {p.res.stats.degenerate > 0 &&
              <div className="text-[#ffb37d]">{p.res.stats.degenerate.toLocaleString()} collapsed (raise span)</div>}
            <div>{p.res.blocks.length.toLocaleString()} blocks · {p.res.triangles.length.toLocaleString()} tris</div>
            <div className={p.res.stats.nonManifold ? 'text-[#ff6b6b]' : ''}>
              {p.res.stats.nonManifold} non-manifold</div>
            <div>{p.res.stats.massKg.toFixed(0)} kg</div>
          </div>
        )}
      </div>

      {gameOpen && gameModels && (
        <div data-testid="import-gamelist"
          className="absolute inset-0 z-10 flex flex-col rounded bg-[#0a111c]/95 p-2">
          <div className="flex gap-2 pb-2">
            <input data-testid="import-gameq" autoFocus value={gameQ}
              onChange={e => setGameQ(e.target.value)}
              placeholder="Search the game's components…"
              className="ksp-btn min-w-0 flex-1 px-2 py-1 text-[11px]" />
            <button data-testid="import-gameclose" className="ksp-btn px-2 py-1 text-[11px]"
              onClick={() => setGameOpen(false)}>✕</button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {gameModels
              .filter(m => !gameQ
                || `${m.module}/${m.name}`.toLowerCase().includes(gameQ.toLowerCase()))
              .slice(0, 500)
              .map(m => (
                <button key={m.module + m.name}
                  data-testid={`import-game-${m.name}`}
                  className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[11px] hover:bg-[#1c2c48]"
                  onClick={() => { setGameOpen(false); void loadGameModel(m); }}>
                  <span className="shrink-0 font-semibold text-[#e8edf4]">{m.name}</span>
                  <span className="truncate text-[10px] text-[#5f7494]">
                    {m.module} · {m.files.length} files</span>
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
