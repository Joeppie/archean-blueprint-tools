// components/ImportDialog.tsx — THE PREVIEW LAW surface (docs/IMPORT-3D.md §7).
//
// Import never runs blind: a live 3-D preview over the 0.25 m lattice grid,
// the 3 m FRAME BOXES drawn (= the triangle-window legal zone), a translucent
// ghost of the decimated source, the QUANTISED result rendered as the game
// renders it, and red overlays for every legality problem the engine counted.
// Every knob requantises live; the preview runs the SAME engine/import.ts the
// Import button commits with (the hullify preview/apply pair law).
//
// Formats: GLB/glTF, OBJ (+MTL colour pairs), STL, PLY, 3DS (TDSLoader) load
// in-browser (the three.js loaders — the download-site corpus). FBX/.blend
// go through the python tier (tools/import_model.py) — pre-bake to GLB.
// .gsm (Archicad GDL library part) is parametric SOURCE, not a mesh — the
// loader answers with the export-to-OBJ pointer.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { TDSLoader } from 'three/examples/jsm/loaders/TDSLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import FloatingWindow from './FloatingWindow';
import type { EditCtx } from '../engine/edit';
import { appendTrianglesDoc } from '../engine/edit';
import { docArrayInsert, docFromValue } from '../engine/doc';
import { CELL } from '../engine/format';
import { DEFAULT_PALETTE } from '../engine/palette';
import type { PaletteEntry } from '../engine/palette';
import { decodeSkinTri } from '../engine/latsphere';
import { IMPORT_DEFAULTS, runImport } from '../engine/import';
import type { ImportOptions, ImportResult, SrcMesh } from '../engine/import';

const MAT_NAMES = ['composite', 'steel', 'aluminium', 'force field',
  'timber', 'titanium', 'glass'];

export default function ImportDialog(p: {
  ctx: EditCtx;
  onClose: () => void;
  onApplied: (message: string) => void;
}) {
  const bp = p.ctx.bp;
  const fileRef = useRef<HTMLInputElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [srcs, setSrcs] = useState<SrcMesh[] | null>(null);
  const [srcName, setSrcName] = useState('');
  const [loadErr, setLoadErr] = useState('');
  const [o, setO] = useState<ImportOptions>({ ...IMPORT_DEFAULTS });
  const [showGhost, setShowGhost] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<ImportResult | null>(null);
  const [drag, setDrag] = useState(false);

  const set = <K extends keyof ImportOptions>(k: K, v: ImportOptions[K]) =>
    setO(s => ({ ...s, [k]: v }));

  // ---------- loaders ----------

  const soup = (g: THREE.BufferGeometry, base: THREE.Color | null): SrcMesh => {
    const geo = g.index ? g.toNonIndexed() : g;
    const pos = Float32Array.from(geo.getAttribute('position').array);
    const ca = geo.getAttribute('color');
    let col: Float32Array | undefined;
    if (ca) {
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
    } else if (base) {
      col = new Float32Array(pos.length);
      for (let v = 0; v < pos.length; v += 3)
        col.set([base.r, base.g, base.b], v);
    }
    return { pos, col };
  };

  const loadFiles = useCallback(async (files: File[]) => {
    setLoadErr('');
    const first = files[0];
    if (!first) return;
    const ext = (f: File) => (f.name.split('.').pop() ?? '').toLowerCase();
    try {
      const out: SrcMesh[] = [];
      const pull = (obj: THREE.Object3D) => {
        obj.traverse(m => {
          const mesh = m as THREE.Mesh;
          if (!mesh.isMesh || !mesh.geometry) return;
          const mat = mesh.material as THREE.Material & { color?: THREE.Color };
          mesh.updateWorldMatrix(true, false);
          const g = mesh.geometry.clone() as THREE.BufferGeometry;
          g.applyMatrix4(mesh.matrixWorld);
          out.push(soup(g, mat?.color ?? null));
        });
      };
      const e = ext(first);
      if (e === 'glb' || e === 'gltf') {
        const gltf = await new GLTFLoader().parseAsync(
          await first.arrayBuffer(), '');
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
      } else if (e === 'gsm') {
        setLoadErr('a .gsm is an Archicad LIBRARY PART (parametric GDL ' +
          'source, not a mesh — no public parser). In Archicad: File ▸ ' +
          'Libraries and Objects ▸ Export 3D Geometry… ▸ OBJ — then drop ' +
          'the .obj here.');
        return;
      } else {
        setLoadErr(`'${e}' not supported here — export GLB/glTF/OBJ/STL/PLY/` +
          `3DS (FBX and .blend: pre-bake in Blender, one menu hop)`);
        return;
      }
      if (!out.length) { setLoadErr('no meshes found'); return; }
      setSrcs(out);
      setSrcName(files.map(f => f.name).join(' + '));
    } catch (err) {
      setLoadErr(`⚠ ${String(err)}`);
    }
  }, []);

  // ---------- live quantise ----------

  const optsKey = JSON.stringify(o);
  useEffect(() => {
    if (!srcs) return;
    let live = true;
    setBusy(true);
    runImport(srcs, JSON.parse(optsKey) as ImportOptions)
      .then(r => { if (live) { setRes(r); setBusy(false); } })
      .catch(e => {
        if (live) { setRes(null); setLoadErr(`⚠ quantise: ${String(e)}`);
          setBusy(false); }
      });
    return () => { live = false; };
  }, [srcs, optsKey]);

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
    const fitTo = (r: ImportResult | null) => {
      // bounds: ghost (metres) + blocks (cells)
      let mn = new THREE.Vector3(Infinity, Infinity, Infinity),
        mx = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
      const eat = (x: number, y: number, z: number) => {
        mn.min(new THREE.Vector3(x, y, z)); mx.max(new THREE.Vector3(x, y, z));
      };
      const gh = r?.ghost;
      if (gh)
        for (let i = 0; i < gh.length; i += 3)
          eat(gh[i]!, gh[i + 1]!, gh[i + 2]!);
      for (const b of r?.blocks ?? []) {
        const c: [number, number, number] =
          [(b.frame_x ?? 0) * 12 + b.pos_x, (b.frame_y ?? 0) * 12 + b.pos_y,
            (b.frame_z ?? 0) * 12 + b.pos_z];
        eat((c[0] - 6) * CELL, (c[1] - 6) * CELL, (c[2] - 6) * CELL);
        eat((c[0] + b.size_x + 1 - 6) * CELL, (c[1] + b.size_y + 1 - 6) * CELL,
          (c[2] + b.size_z + 1 - 6) * CELL);
      }
      if (!isFinite(mn.x)) { mn.set(-3, -3, -3); mx.set(3, 3, 3); }
      return { mn, mx, ctr: mn.clone().add(mx).multiplyScalar(0.5),
        span: mx.clone().sub(mn).length() };
    };

    const build = () => {
      scene.children.filter(c => c.type === 'Group').forEach(c => scene.remove(c));
      const r = res;
      const { mn, mx, ctr, span } = fitTo(r);
      const d = Math.max(4, span);
      cam.position.set(ctr.x + d, ctr.y + d * 0.7, ctr.z + d * 1.3);
      ctl.target.copy(ctr);

      const world = new THREE.Group();
      // ① ghost — the decimated source, translucent intent
      if (showGhost && r && r.ghost.length) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(r.ghost.slice(), 3));
        add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({
          color: 0x7dffcf, transparent: true, opacity: 0.1, side: THREE.DoubleSide,
          depthWrite: false })));
      }
      // ② the lattice output, as the game renders it
      if (r && r.blocks.length) {
        const geo = new THREE.BoxGeometry(CELL, CELL, CELL);
        const inst = new THREE.InstancedMesh(geo,
          new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0.05 }),
          r.blocks.length);
        const m4 = new THREE.Matrix4();
        r.blocks.forEach((b, i) => {
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
      if (r && r.triangles.length) {
        const pos = new Float32Array(r.triangles.length * 9);
        const col = new Float32Array(r.triangles.length * 9);
        r.triangles.forEach((t, i) => {
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
      if (r && r.nmEdges.length) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(r.nmEdges.slice(), 3));
        add(new THREE.LineSegments(g,
          new THREE.LineBasicMaterial({ color: 0xff3355 })));
      }
      // ④ the grid: cell lines on the ground, 3 m FRAME BOXES = the triangle
      //    window legal zone (FORMAT §Triangles), ±axis marks
      if (showGrid) {
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
      }
      world.add();
      scene.add(world);
    };
    build();
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
  }, [res, showGhost, showGrid, slotColor]);

  // ---------- commit ----------

  const commit = () => {
    if (!res?.ok) return;
    const ctx = p.ctx;
    for (const b of res.blocks) {
      ctx.bp.data.blocks.push(b);
      docArrayInsert(ctx.doc, ['data', 'blocks'],
        ctx.bp.data.blocks.length - 1, docFromValue(b));
    }
    if (res.triangles.length) appendTrianglesDoc(ctx, res.triangles);
    p.onApplied(`imported ${res.blocks.length} blocks · ${res.triangles.length} ` +
      `skin triangles (${res.stats.cells} cells, ${res.stats.massKg.toFixed(0)} kg)`);
    p.onClose();
  };

  // ---------- controls ----------

  const s = res?.stats;
  const canImport = !!res?.ok && !busy &&
    (res.blocks.length > 0 || res.triangles.length > 0);
  const row = 'flex items-center gap-2 text-[11px] leading-5';
  const num = (label: string, k: 'span' | 'budget', min: number, max: number, step: number) => (
    <label className={row}>
      <span className="w-24 shrink-0 text-[#9fb4d0]">{label}</span>
      <input data-testid={`import-${k}`} type="range" min={min} max={max} step={step}
        value={o[k]} className="min-w-0 flex-1"
        onChange={e => set(k, Number(e.target.value))} />
      <span className="w-12 text-right tabular-nums">{o[k]}</span>
    </label>
  );
  const chk = (label: string, v: boolean, on: (b: boolean) => void, id: string) => (
    <label className={row}>
      <input data-testid={id} type="checkbox" checked={v} onChange={e => on(e.target.checked)} />
      <span className="text-[#9fb4d0]">{label}</span>
    </label>
  );
  const stats = useMemo(() => s && [
    ['source tris', s.srcTris, 'import-stat-src'],
    ['after decimate', s.decTris, 'import-stat-dec'],
    ['degenerate', s.degenerate, 'import-stat-degen'],
    ['cells', s.cells, 'import-stat-cells'],
    ['blocks', s.blocks, 'import-stat-blocks'],
    ['skin tris', s.skinTris, 'import-stat-skin'],
    ['rescued (split)', s.rescued, 'import-stat-rescued'],
    ['skipped', s.skipped, 'import-stat-skipped'],
    ['non-manifold', s.nonManifold, 'import-stat-nonmanifold'],
    ['mass kg', Math.round(s.massKg), 'import-stat-mass'],
  ] as [string, number, string][], [s]);

  return (
    <FloatingWindow id="import" testid="import-dock" fullNarrow
      initial={(vw, vh) => {
        const w = Math.min(1180, vw - 24);
        return { x: Math.max(12, (vw - w) / 2), y: 18, w, h: vh - 36 };
      }}
      header={<span data-testid="import-title" className="flex items-center gap-2">
        🧊 Import 3D model
        <span className="text-[10px] text-[#9fb4d0]">
          {srcName || 'drop a GLB / glTF / OBJ+MTL / STL / PLY / 3DS'}
        </span>
      </span>}>
      <div className="flex h-full min-h-0 gap-2 p-2 text-[#e8edf4]"
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => {
          e.preventDefault(); setDrag(false);
          const fl = e.dataTransfer.files;
          if (fl.length) void loadFiles(Array.from(fl));
        }}>
        <div className={`w-72 shrink-0 space-y-2 overflow-y-auto rounded p-2 ${drag ? 'outline outline-2 outline-[#7dffcf]' : 'bg-[#16233c]'}`}>
          <button data-testid="import-pick" className="ksp-btn w-full px-2 py-1 text-[11px]"
            onClick={() => fileRef.current?.click()}>
            📁 Model file…
          </button>
          <input ref={fileRef} type="file" multiple className="hidden" data-testid="import-input"
            accept=".glb,.gltf,.obj,.mtl,.stl,.ply,.3ds,.gsm"
            onChange={e => { const fl = e.target.files; if (fl?.length) void loadFiles(Array.from(fl)); e.target.value = ''; }} />
          {loadErr && <div data-testid="import-loaderr" className="text-[11px] text-[#ff9d7d]">{loadErr}</div>}

          <div className="flex gap-1 pt-1">
            {(['blocks', 'skin'] as const).map(m => (
              <button key={m} data-testid={`import-mode-${m}`}
                className={`ksp-btn flex-1 px-2 py-1 text-[11px] ${o.mode === m ? 'bg-[#2b4368] outline outline-1 outline-[#7dffcf]' : ''}`}
                onClick={() => set('mode', m)}>
                {m === 'blocks' ? '🧱 Blocks' : '🔺 Skin'}
              </button>
            ))}
          </div>

          {num('span (cells)', 'span', 4, 160, 2)}
          <label className={row}>
            <span className="w-24 shrink-0 text-[#9fb4d0]">source up</span>
            <select data-testid="import-up" className="ksp-btn px-1 text-[11px]"
              value={o.up} onChange={e => set('up', e.target.value as 'y' | 'z')}>
              <option value="y">Y-up (glTF/OBJ)</option>
              <option value="z">Z-up (STL/CAD)</option>
            </select>
            <select data-testid="import-yaw" className="ksp-btn px-1 text-[11px]"
              value={o.yaw}
              onChange={e => set('yaw', Number(e.target.value) as 0 | 90 | 180 | 270)}>
              {[0, 90, 180, 270].map(v => <option key={v} value={v}>{v}°</option>)}
            </select>
          </label>
          {([[0, 'x'], [1, 'y'], [2, 'z']] as const).map(([i, ax]) => (
            <label key={ax} className={row}>
              <span className="w-24 shrink-0 text-[#9fb4d0]">offset {ax}</span>
              <input data-testid={`import-offset-${i}`} type="range" min={-96} max={96}
                value={o.offset[i]} className="min-w-0 flex-1"
                onChange={e => {
                  const n = [...o.offset] as [number, number, number];
                  n[i] = Number(e.target.value);
                  set('offset', n);
                }} />
              <span className="w-12 text-right tabular-nums">{o.offset[i]}</span>
            </label>
          ))}

          {chk('optimise mesh (decimate)', o.decimate, v => set('decimate', v), 'import-decimate')}
          {o.decimate && num('triangle budget', 'budget', 100, 20000, 100)}
          {o.mode === 'blocks' &&
            chk('hollow (shell only)', o.shell, v => set('shell', v), 'import-shell')}
          {chk('source colours', o.perTriColor, v => set('perTriColor', v), 'import-colors')}
          {!o.perTriColor && (
            <label className={row}>
              <span className="w-24 shrink-0 text-[#9fb4d0]">palette slot</span>
              <input data-testid="import-slot" type="number" min={11} max={255} value={o.slot}
                className="ksp-btn w-20 px-1 text-[11px]"
                onChange={e => set('slot', Math.max(11, Math.min(255, Number(e.target.value) || 11)))} />
            </label>
          )}
          <label className={row}>
            <span className="w-24 shrink-0 text-[#9fb4d0]">material</span>
            <select data-testid="import-material" className="ksp-btn px-1 text-[11px]"
              value={o.material}
              onChange={e => set('material', Number(e.target.value))}>
              {MAT_NAMES.map((n, i) => <option key={n} value={i}>{i} {n}</option>)}
            </select>
          </label>

          <div className="border-t border-[#243654] pt-1">
            {chk('ghost (source mesh)', showGhost, setShowGhost, 'import-ghost')}
            {chk('lattice grid + frame boxes', showGrid, setShowGrid, 'import-grid')}
          </div>

          <button data-testid="import-ok" disabled={!canImport}
            className="ksp-btn w-full px-2 py-1 text-[11px] font-bold disabled:opacity-40"
            onClick={commit}>
            {busy ? 'computing…' : `⬇ Import into this craft${!res?.ok && res?.reason ? ` — ${res.reason}` : ''}`}
          </button>
        </div>

        <div className="relative min-w-0 flex-1 overflow-hidden rounded bg-[#0a111c]">
          <div ref={hostRef} data-testid="import-canvas" className="absolute inset-0" />
          {busy && <div className="absolute left-2 top-2 rounded bg-[#101a2b]/85 px-2 py-1 text-[11px]">quantising…</div>}
          {!srcs && !busy && (
            <div className="absolute inset-0 grid place-items-center text-[12px] text-[#5f7494]">
              drop a 3D model here — it previews on the 0.25 m lattice
            </div>
          )}
          {res && !res.ok && res.reason && srcs && (
            <div data-testid="import-reason"
              className="absolute left-2 bottom-2 rounded bg-[#3a1622]/90 px-2 py-1 text-[11px] text-[#ff9d7d]">
              {res.reason}
            </div>
          )}
          {stats && (
            <div data-testid="import-stats"
              className="absolute right-2 top-2 grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 rounded bg-[#101a2b]/85 px-3 py-2 text-[11px] tabular-nums">
              {stats.map(([lab, v, id]) => (
                <div key={id} className="contents">
                  <span className="text-[#9fb4d0]">{lab}</span>
                  <span data-testid={id}
                    className={`text-right ${id === 'import-stat-nonmanifold' && v ? 'text-[#ff6b6b]' : ''}`}>
                    {v.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </FloatingWindow>
  );
}
