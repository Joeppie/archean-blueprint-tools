// XenonDialog.tsx — the in-game-style XenonCode IDE for one craft computer
// (v1.13 batch: "add Xenon in the menu, list all computers, clicking one
// opens a pop-up with its code that looks like it does in-game").
//
// The look follows the in-game IDE screenshots: dark blue window, title bar
// "XenonCode IDE (Computer)", the File/Library/Computer/Options/Help menu
// row, file tabs, line-numbered code, the "Program 'x' Loaded / is
// running…" status lines, the green ON indicator. The CODE itself is
// highlighted by the dev's OWN token classes (their CodeMirror mode +
// tmLanguage — engine/xenoncode.tokenize) and validated per line with the
// interpreter's parser (the wiki's Editor spec: "run the parse on the
// current line"), so a red line is the real compiler complaining.
//
// Screens: screen(alias, ch) surfaces (Dashboard Screen/HdScreen elements)
// are registered at boot and blitted from the dev's XenonScreen
// framebuffer at 10 Hz. Nodes: programs authored in the visual editor carry
// a `;#NODES {json}` header — parseNodes renders that graph (pan/zoom).
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  XenonRun, parseNodes, tokenize,
  type XenonComputer, type XenonEvent, type XGraph,
} from '../engine/xenoncode';

const MAX_CODE_LINES = 1500;   // view + validation cap (Badger main.xc = 16k lines)

const TOK_COLOR: Record<string, string> = {
  kw: '#7ea6ff', type: '#7ea6ff', num: '#e6c07b', com: '#6a9955',
  op: '#d4d4d4', var: '#8fd48f', fn: '#c586c0', str: '#ce9178',
  fmt: '#d7ba7d', txt: '#d6dbe1',
};

export default function XenonDialog(p: { comp: XenonComputer; onClose: () => void }) {
  const { comp } = p;
  const [run, setRun] = useState<XenonRun | null>(null);
  const [status, setStatus] = useState<'booting' | 'running' | 'stopped' | 'error'>('booting');
  const [msg, setMsg] = useState(`Loading program '${comp.program}'…`);
  const [tab, setTab] = useState(0);
  const [log, setLog] = useState<XenonEvent[]>([]);
  const [bus, setBus] = useState<Map<string, number | string>>(new Map());
  const [vals, setVals] = useState<Record<string, number>>({});
  const [cycles, setCycles] = useState(0);
  const runRef = useRef<XenonRun | null>(null);
  const canvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const closeRef = useRef(p.onClose);
  closeRef.current = p.onClose;

  const graph = useMemo(() => parseNodes(comp.files), [comp]);

  // Esc closes (subscribe ONCE through a ref — the v1.5.20 listener lesson)
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    addEventListener('keydown', h);
    return () => removeEventListener('keydown', h);
  }, []);

  // boot the program on the dev's interpreter
  useEffect(() => {
    let dead = false;
    XenonRun.open(comp).then(r => {
      if (dead) { r.stop(); return; }
      if (r.error) { setStatus('error'); setMsg(`Program '${comp.program}' failed: ${r.error}`); }
      else { setStatus('running'); setMsg(`Program '${comp.program}' is running…`); }
      runRef.current = r; setRun(r);
      for (const c of comp.channels) r.setInput(c.io, c.ch, 0);
    });
    return () => { dead = true; if (runRef.current) runRef.current.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comp]);

  // 10 Hz cycle pump (the game's computer cadence) + screen blit
  useEffect(() => {
    if (!run || status !== 'running') return;
    let raf = 0, last = 0, n = 0;
    const step = (t: number) => {
      raf = requestAnimationFrame(step);
      if (t - last < 100) return;
      last = t;
      const evs = run.cycle();
      if (evs.length) {
        setLog(l => [...l.slice(-180), ...evs.filter(e => e.e !== 'cycle')]);
        setBus(b => {
          const m = new Map(b);
          for (const e of evs) if (e.e === 'out') m.set(`${e.io}:${e.port}`, e.v ?? '');
          return m;
        });
      }
      setCycles(++n);
      if (run.error) { setStatus('error'); setMsg(`Program '${comp.program}' crashed: ${run.error}`); }
      for (const s of run.screenInfo(16)) {
        const cv = canvasRefs.current.get(s.key);
        if (!cv) continue;
        if (cv.width !== s.w) cv.width = s.w;
        if (cv.height !== s.h) cv.height = s.h;
        cv.getContext('2d')?.putImageData(new ImageData(s.pixels as Uint8ClampedArray<ArrayBuffer>, s.w, s.h), 0, 0);
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [run, status, comp.program]);

  // per-line validation with the interpreter's own parser
  const lineErrs = useMemo(() => {
    const errs = new Map<number, string>();
    if (!run) return errs;
    const lines = (comp.files[tab]?.code.split('\n') ?? []).slice(0, MAX_CODE_LINES);
    lines.forEach((ln, i) => {
      const t = ln.trim();
      // '#NODES' is a compiler directive line, not a statement
      if (!t || t.startsWith(';') || t.startsWith('//') || t.startsWith('#')) return;
      const e = run.parseLine(ln, i + 1);
      if (e) errs.set(i, e);
    });
    return errs;
  }, [run, comp, tab]);

  const toggleRun = () => {
    if (!runRef.current) return;
    if (status === 'running') { runRef.current.stop(); setStatus('stopped'); setMsg(`Program '${comp.program}' stopped.`); }
    else if (status !== 'error') { runRef.current.running = true; setStatus('running'); setMsg(`Program '${comp.program}' is running…`); }
  };
  const reboot = () => {
    const r = runRef.current;
    if (!r) return;
    if (r.reboot()) { setStatus('running'); setMsg(`Program '${comp.program}' is running…`); setLog([]); setBus(new Map()); }
    else { setStatus('error'); setMsg(`Re-boot failed: ${r.error}`); }
  };

  const file = comp.files[tab];
  const onCode = tab === 0 || tab < comp.files.length;

  return (
    <div data-testid="xenon-dialog" className="fixed inset-0 z-40 grid place-items-center
         bg-black/60 p-2" onMouseDown={e => { if (e.target === e.currentTarget) p.onClose(); }}>
      <div className="flex max-h-[92dvh] w-[min(1150px,96vw)] flex-col overflow-hidden rounded-lg
           border border-[#3a4a6a] bg-[#10141f]/[.97] text-[#d6dbe1] shadow-2xl"
        style={{ fontFamily: 'ui-monospace, Menlo, Consolas, monospace' }}>
        {/* title bar */}
        <div className="flex items-center justify-between bg-[#1a2436] px-3 py-1.5 text-[13px]">
          <span className="font-bold tracking-wide">XenonCode IDE ({comp.alias || comp.program})</span>
          <div className="flex items-center gap-3">
            <span data-testid="xenon-on" className={`text-[11px] font-bold ${status === 'running' ? 'text-[#3ddc55]' : 'text-[#ff5b5b]'}`}>
              {status === 'running' ? 'ON' : 'OFF'}
            </span>
            <button data-testid="xenon-close" className="text-[#8a93a0] hover:text-white"
              onClick={p.onClose} aria-label="close">✕</button>
          </div>
        </div>
        {/* menu row (in-game parity; functional bits: Computer) */}
        <div className="flex items-center gap-4 border-b border-[#2b313b] bg-[#141b28] px-3 py-1 text-[12px] text-[#9fb0c8]">
          <span>File</span><span>Library</span>
          <button data-testid="xenon-reboot" className="hover:text-white" onClick={reboot}>Computer ▸ re-boot</button>
          <button data-testid="xenon-run" className="hover:text-white" onClick={toggleRun}>
            {status === 'running' ? 'Options ▸ stop' : 'Options ▸ run'}
          </button>
          <span>Help</span>
          <span className="ml-auto text-[10px] text-[#5d6a7d]">cycles {cycles} @ 10 Hz · inputs are external numerics</span>
        </div>
        {/* tabs */}
        <div className="flex flex-wrap gap-1 border-b border-[#2b313b] bg-[#121826] px-2 pt-1.5 text-[12px]">
          {comp.files.map((f, i) => (
            <button key={f.name} data-testid={`xenon-tab-${i}`} onClick={() => setTab(i)}
              className={`rounded-t px-3 py-1 ${tab === i ? 'bg-[#10141f] text-[#8fd4ff]' : 'bg-[#1a2233] text-[#7d8aa0]'}`}>
              {i === 0 ? `${comp.program}.main.xc` : f.name}
            </button>
          ))}
          {graph && (
            <button data-testid="xenon-tab-nodes" onClick={() => setTab(100)}
              className={`rounded-t px-3 py-1 ${tab === 100 ? 'bg-[#10141f] text-[#8fd4ff]' : 'bg-[#1a2233] text-[#7d8aa0]'}`}>
              ⌗ nodes ({graph.nodes.length})
            </button>
          )}
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-hidden p-2 md:grid-cols-[minmax(0,1fr)_330px]">
          {/* code / nodes */}
          <div data-testid={`xenon-code-${tab}`} className="min-h-0 overflow-auto rounded border border-[#232c3d] bg-[#0b0f18] text-[12px] leading-[1.45]">
            {onCode && file && (() => {
              const lines = file.code.split('\n');
              const shown = lines.slice(0, MAX_CODE_LINES);
              return (<>
                {shown.map((ln, i) => (
                  <div key={i} data-testid={lineErrs.has(i) ? `xenon-err-${i}` : undefined}
                    title={lineErrs.get(i)}
                    className={`flex ${lineErrs.has(i) ? 'bg-[#3a1420]' : ''}`}>
                    <span className="w-9 shrink-0 select-none pr-2 text-right text-[#3f4b5f]">{i + 1}</span>
                    <span className="whitespace-pre">
                      {tokenize(ln).map((t, j) => (
                        <span key={j} style={{ color: TOK_COLOR[t.t] }}>{t.s}</span>
                      ))}
                    </span>
                  </div>
                ))}
                {lines.length > MAX_CODE_LINES && (
                  <div className="px-9 py-2 text-[11px] text-[#5d6a7d]">
                    … {lines.length - MAX_CODE_LINES} more lines in this file
                    ({lines.length.toLocaleString()} total — the view is capped at
                    {MAX_CODE_LINES.toLocaleString()} for responsiveness)
                  </div>
                )}
              </>);
            })()}
            {tab === 100 && graph && <NodeGraph graph={graph} />}
          </div>

          {/* right: screens, inputs, bus, console */}
          <div className="flex min-h-0 flex-col gap-2 overflow-y-auto">
            <div className="rounded border border-[#232c3d] bg-[#131a28] p-2">
              <div className="mb-1 text-[10px] uppercase tracking-widest text-[#5d6a7d]">Screens</div>
              <div className="flex flex-wrap gap-2">
                {(run?.screenInfo() ?? []).length === 0 && !run && (
                  <span className="text-[11px] text-[#5d6a7d]">booting…</span>
                )}
                {(run?.screenInfo(16) ?? []).map(s => (
                  <label key={s.key} className="block text-[10px] text-[#5d6a7d]">
                    <canvas key={s.key} width={s.w} height={s.h}
                      data-testid={`xenon-screen-${s.key}`}
                      ref={el => { if (el) canvasRefs.current.set(s.key, el); else canvasRefs.current.delete(s.key); }}
                      className="max-w-[300px] rounded-sm border border-[#2b313b] bg-black"
                      style={{ width: 'auto', maxHeight: 200, imageRendering: 'pixelated' }} />
                    <div>{s.key}</div>
                  </label>
                ))}
                {(run?.screenCount() ?? 0) > 16 && (
                  <span className="text-[11px] text-[#5d6a7d]">+{(run?.screenCount() ?? 0) - 16} more surfaces (virtual buffers)</span>
                )}
                {comp.screens.length === 0 && run && (
                  <span className="text-[11px] text-[#5d6a7d]">no Screen elements bound — program auto-screens shown</span>
                )}
              </div>
            </div>

            <div className="rounded border border-[#232c3d] bg-[#131a28] p-2 text-[11px]">
              <div className="mb-1 text-[10px] uppercase tracking-widest text-[#5d6a7d]">
                Inputs (io · channel → value)</div>
              {comp.channels.map(c => (
                <label key={`${c.io}.${c.ch}`} className="grid grid-cols-[86px_1fr_44px] items-center gap-2">
                  <span className="text-[#9fb0c8]" title={`io ${c.io}`}>
                  {comp.devices.find(d => d.io === c.io)?.alias || c.io} · ch {c.ch}</span>
                  <input type="range" min={-1} max={1} step={0.05}
                    data-testid={`xenon-in-${c.io}-${c.ch}`}
                    value={vals[`${c.io}.${c.ch}`] ?? 0}
                    onChange={e => {
                      const v = +e.target.value;
                      setVals(m => ({ ...m, [`${c.io}.${c.ch}`]: v }));
                      runRef.current?.setInput(c.io, c.ch, v);
                    }} />
                  <span className="text-right tabular-nums">{(vals[`${c.io}.${c.ch}`] ?? 0).toFixed(2)}</span>
                </label>
              ))}
              {comp.channels.length === 0 && <span className="text-[#5d6a7d]">no input_number() channels detected</span>}
            </div>

            <div className="rounded border border-[#232c3d] bg-[#131a28] p-2 text-[11px]">
              <div className="mb-1 text-[10px] uppercase tracking-widest text-[#5d6a7d]">io bus (output_number)</div>
              <div className="grid grid-cols-[1fr_28px_64px] gap-x-2">
                {[...bus.entries()].slice(-24).map(([k, v]) => {
                  const [io, port] = k.split(':');
                  const dev = comp.devices.find(d => String(d.io) === io);
                  return (
                    <div key={k} className="contents">
                      <span className="truncate text-[#9fb0c8]" title={dev ? `io ${io} = ${dev.alias || dev.type}` : io}>
                        {dev ? `${dev.alias || dev.type}` : io}</span>
                      <span className="text-[#5d6a7d]">{port}</span>
                      <span className="text-right tabular-nums text-[#8fd48f]">
                        {typeof v === 'number' ? v.toFixed(3) : String(v).slice(0, 12)}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div data-testid="xenon-log" className="min-h-[70px] flex-1 overflow-y-auto rounded border border-[#232c3d] bg-[#0b0f18] p-2 text-[11px]">
              {log.filter(e => e.e === 'print').slice(-60).map((e, i) => (
                <div key={i} className="text-[#d6dbe1]">print: {String(e.v)}</div>
              ))}
              {log.filter(e => e.e === 'print').length === 0 && (
                <div className="text-[#5d6a7d]">no prints yet</div>
              )}
            </div>
          </div>
        </div>

        {/* status lines (in-game parity) */}
        <div className="border-t border-[#2b313b] bg-[#141b28] px-3 py-1 text-[11px]">
          <div className={status === 'error' ? 'text-[#ff5b5b]' : 'text-[#3ddc55]'}>
            {status === 'error' ? msg : `Program '${comp.program}' loaded`}</div>
          {status === 'running' && <div className="text-[#7ea6ff]">Program '{comp.program}' is running…</div>}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The visual-program graph (#NODES): node cards + bezier wires, pan + zoom.
// Colours follow the in-game node editor: green inputs, purple outputs,
// blue math, orange utility.

function nodeColor(type: string): string {
  if (type.startsWith('Input')) return '#2e7d32';
  if (type.startsWith('Output')) return '#6a1b9a';
  if (type.startsWith('MathNode')) return '#1565c0';
  if (type.startsWith('Counter') || type.startsWith('Timer')) return '#ef6c00';
  return '#37474f';
}

function NodeGraph(p: { graph: XGraph }) {
  const { graph } = p;
  const ref = useRef<HTMLCanvasElement>(null);
  const view = useRef({ x: 0, y: 0, k: 1 });
  const drag = useRef<{ px: number; py: number } | null>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const box = cv.getBoundingClientRect();
    cv.width = box.width * devicePixelRatio;
    cv.height = box.height * devicePixelRatio;
    // fit the graph into the canvas once
    const xs = graph.nodes.map(n => n.x), ys = graph.nodes.map(n => n.y);
    const x2 = graph.nodes.map(n => n.x + n.w), y2 = graph.nodes.map(n => n.y + n.h);
    const bw = Math.max(...x2) - Math.min(...xs), bh = Math.max(...y2) - Math.min(...ys);
    const k = Math.min(box.width / (bw + 60), box.height / (bh + 60), 1.4);
    view.current = { k, x: (box.width - bw * k) / 2 - Math.min(...xs) * k,
                     y: (box.height - bh * k) / 2 - Math.min(...ys) * k };
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  const draw = () => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const { x, y, k } = view.current;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.fillStyle = '#0b0f18';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.translate(x, y);
    ctx.scale(k, k);
    const byId = new Map(graph.nodes.map(n => [n.id, n]));
    // wires
    ctx.strokeStyle = '#8899c8';
    ctx.lineWidth = 1.4 / k;
    for (const l of graph.links) {
      const a = byId.get(l.from), b = byId.get(l.to);
      if (!a || !b) continue;
      const ax = a.x + a.w, ay = a.y + a.h / 2;
      const bx = b.x, by = b.y + 16 + (b.h - 20) * ((l.port + 0.5) / Math.max(b.inputs.length, 1));
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.bezierCurveTo(ax + 40, ay, bx - 40, by, bx, by);
      ctx.stroke();
    }
    // nodes
    for (const n of graph.nodes) {
      ctx.fillStyle = '#16202e';
      ctx.fillRect(n.x, n.y, n.w, n.h);
      ctx.fillStyle = nodeColor(n.type);
      ctx.fillRect(n.x, n.y, n.w, 14);
      ctx.fillStyle = '#e6ecf5';
      ctx.font = '10px ui-monospace, monospace';
      ctx.fillText(n.title.slice(0, Math.floor(n.w / 6.5)), n.x + 3, n.y + 11);
      ctx.fillStyle = '#9fb0c8';
      ctx.font = '9px ui-monospace, monospace';
      // io-addressed nodes carry their binding in the graph: show it (the
      // in-game cards show input.<io> + channel; the POC had the info parsed
      // but never drawn — the "inputs are empty" report)
      const ioLine = n.type.startsWith('Input')
        ? `io ${n.ioNumber ?? '?'}  channel ${n.channel ?? '?'}`
        : n.type.startsWith('Output')
          ? `io ${n.ioNumber ?? '?'}  (write)` : null;
      if (ioLine) {
        ctx.fillStyle = '#c8d4e8';
        ctx.fillText(ioLine, n.x + 6, n.y + 24);
      }
      n.inputs.forEach((src, i) => {
        const py = n.y + (ioLine ? 36 : 22) + (n.h - (ioLine ? 34 : 20)) * ((i + 0.5) / Math.max(n.inputs.length, 1));
        ctx.fillStyle = '#8899c8';
        ctx.beginPath();
        ctx.arc(n.x, py, 2.4 / k, 0, 7);
        ctx.fill();
        const v = n.inputValues?.[i];
        const label = src ? (byId.get(src)?.title ?? '?')
          : v !== undefined && v !== '' ? `= ${v}` : '·';
        ctx.fillStyle = '#9fb0c8';
        ctx.fillText(String(label).slice(0, Math.floor((n.w - 10) / 5.6)), n.x + 6, py + 3);
      });
      ctx.fillStyle = '#8899c8';
      ctx.beginPath();
      ctx.arc(n.x + n.w, n.y + n.h / 2, 2.4 / k, 0, 7);
      ctx.fill();
      ctx.strokeStyle = '#2b3a52';
      ctx.lineWidth = 1 / k;
      ctx.strokeRect(n.x, n.y, n.w, n.h);
    }
  };

  return (
    <canvas ref={ref} data-testid="xenon-nodes" className="h-[520px] w-full cursor-grab"
      onPointerDown={e => { drag.current = { px: e.clientX - view.current.x, py: e.clientY - view.current.y }; }}
      onPointerMove={e => {
        if (!drag.current) return;
        view.current.x = e.clientX - drag.current.px;
        view.current.y = e.clientY - drag.current.py;
        draw();
      }}
      onPointerUp={() => { drag.current = null; }}
      onWheel={e => {
        const cv = ref.current;
        if (!cv) return;
        const r = cv.getBoundingClientRect();
        const mx = e.clientX - r.left, my = e.clientY - r.top;
        const v = view.current, k2 = Math.min(4, Math.max(0.15, v.k * (e.deltaY < 0 ? 1.12 : 0.89)));
        v.x = mx - ((mx - v.x) / v.k) * k2;
        v.y = my - ((my - v.y) / v.k) * k2;
        v.k = k2;
        draw();
      }} />
  );
}
