// XenonDialog.tsx — the in-game-style XenonCode IDE for one craft computer
// (v1.13 line; the v1.13.x batch: EDITABLE code + the virtual-disk file
// dialog + live node values + clickable screens, all on the SHARED XenonPump
// so the bottom Screens dock and the 3-D dashboards ride the same VM).
//
// The look follows the in-game IDE (wiki xenoncode/ide.md): dark window,
// title bar, the File/Library/Computer menu row, ONE TAB PER HDD FILE
// ("all the files in that virtual computer's HDD will always be opened as
// Tabs"), line-numbered code, the "Program 'x' is running…" status lines,
// the green ON indicator. CTRL+S saves the current file and the computer
// AUTO-REBOOTS (the game's rule); CTRL+SHIFT+S saves all.
//
// Code view is VIRTUALIZED (windowed render + parse) — a 16k-line Badger
// file scrolls fully, no view cap. The file dialog creates/removes files on
// the craft's virtual disk (data.hdd.xc_files — baked into the blueprint
// json, so they persist through our save and travel with the craft).
//
// Node graphs: programs authored in the visual editor carry a
// `;#NODES {json}` header; the DOM cards show the LIVE values — io-addressed
// InputNodes print the value the program ACTUALLY read from its component
// (the shim's per-cycle input_number reports), OutputNodes the io-bus value.
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  parseKv, parseNodes, tokenize, varKind, xenonPump, xenonScreenBindings, xcDiskFiles,
  type XenonComputer, type XGraph, type XCFile,
} from '../engine/xenoncode';
import type { Engine } from '../engine/scene';
import { ScreenCanvas } from './ScreensDock';

const MAX_PARSE_LINES = 500;   // validation pass cap (over the VISIBLE window)
const ROW = 18;                // px row height of the code view (12px @ 1.5)

const TOK_COLOR: Record<string, string> = {
  kw: '#7ea6ff', type: '#7ea6ff', num: '#e6c07b', com: '#6a9955',
  op: '#d4d4d4', var: '#8fd48f', fn: '#c586c0', str: '#ce9178',
  fmt: '#d7ba7d', txt: '#d6dbe1',
};

const fmtVal = (v: number | string) =>
  typeof v === 'number' ? (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(3)) : String(v).slice(0, 12);

export default function XenonDialog(p: {
  comp: XenonComputer;
  engine?: Engine | null;
  onClose: () => void;
  /** the virtual disk changed — the Editor writes bp + doc and re-boots */
  onFiles: (ci: number, files: XCFile[]) => void;
}) {
  const { comp } = p;
  const [, setTick] = useState(0);
  const [tab, setTab] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [dirty, setDirty] = useState<Set<number>>(new Set());
  const [files, setFiles] = useState<XCFile[]>(() => xcDiskFiles(comp));
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newProg, setNewProg] = useState(false);
  const [armedDel, setArmedDel] = useState(false);
  const [vals, setVals] = useState<Record<string, number>>({});
  const [side, setSide] = useState<'vars' | 'screens' | 'bus' | 'console'>('screens');
  const [varQ, setVarQ] = useState('');
  const [scrQ, setScrQ] = useState('');
  const closeRef = useRef(p.onClose);
  closeRef.current = p.onClose;
  const editRef = useRef<HTMLTextAreaElement>(null);
  const pump = xenonPump;

  useEffect(() => pump.subscribe(() => setTick(t => t + 1)), [pump]);

  // Esc closes (subscribe ONCE through a ref — the v1.5.20 listener lesson);
  // Esc in the editor first COMMITS nothing — it reverts the draft.
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    addEventListener('keydown', h);
    return () => removeEventListener('keydown', h);
  }, []);

  // boot this computer on the pump (the pump is the single VM context: the
  // Screens dock and the 3-D feeds ride the SAME run)
  useEffect(() => {
    void pump.open(comp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comp.ci]);

  // the 3-D law: tell the engine which dashboards this computer drives
  useEffect(() => {
    p.engine?.setScreenFeeds(comp.screens
      .filter(s => s.ci != null)
      .map(s => ({ key: `${s.alias.toLowerCase()}#${s.channel}`, ci: s.ci!, channel: s.channel })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comp, p.engine]);

  const file = files[tab];
  const graph: XGraph | null = useMemo(() => parseNodes(files), [files]);
  const bindings = useMemo(() => xenonScreenBindings(comp), [comp]);
  const varList = useMemo(() => {
    const q = varQ.trim().toLowerCase();
    const all = [...pump.vars.values()];
    if (!q) return all;
    return all.filter(v => v.name.includes(q) || v.v.toLowerCase().includes(q)
      || (parseKv(v.v) ?? []).some(e => e.k.toLowerCase().includes(q) || e.v.toLowerCase().includes(q)));
  }, [pump.vars, varQ, pump.cycles]);
  const surfList = useMemo(() => {
    const q = scrQ.trim().toLowerCase();
    const all = [...pump.surfaces.values()];
    if (!q) return all;
    return all.filter(s => s.key.includes(q) || (bindings.get(s.key) ?? '').toLowerCase().includes(q));
  }, [pump.surfaces, scrQ, bindings, pump.cycles]);
  const status = tab === 100 ? 'nodes' : 'code';

  const save = (all: boolean) => {
    const next = [...files];
    if (!all && file) next[tab] = { ...file, code: draft };
    setFiles(next);
    setDirty(new Set());
    setEditing(false);
    p.onFiles(comp.ci, all
      ? next.map((f, i) => (i === tab && editing ? { ...f, code: draft } : f))
      : next);
  };

  // Ctrl+S / Ctrl+Shift+S (behind typing: from the textarea the draft rides
  // in — save() reads it through the closure ref pattern)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's') return;
      e.preventDefault();
      save(e.shiftKey);
    };
    addEventListener('keydown', h);
    return () => removeEventListener('keydown', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, tab, draft, editing]);

  const startEdit = () => {
    setDraft(file?.code ?? '');
    setEditing(true);
  };
  const editChange = (v: string) => {
    setDraft(v);
    setDirty(m => new Set(m).add(tab));
  };

  const addFile = () => {
    let name = newName.trim();
    if (!name) return;
    if (newProg) name = name.replace(/\.xc$/i, '').replace(/\.main$/i, '') + '.main.xc';
    else if (!/\.xc$/i.test(name)) name += '.xc';
    if (files.some(f => f.name.toLowerCase() === name.toLowerCase())) { setNewOpen(false); return; }
    setFiles([...files, { name, code: newProg ? `\ninit\n\nupdate\n\n` : '' }]);
    setDirty(m => new Set(m).add(files.length));
    setNewOpen(false); setNewName('');
    // creating a file saves it to the virtual disk (game CTRL+N)
    p.onFiles(comp.ci, [...files, { name, code: newProg ? '\ninit\n\nupdate\n\n' : '' }]);
  };
  const delFile = () => {
    if (!armedDel) { setArmedDel(true); return; }
    setArmedDel(false);
    if (files.length <= 1) return;
    const next = files.filter((_, i) => i !== tab);
    setFiles(next);
    setDirty(new Set());
    setEditing(false);
    setTab(0);
    p.onFiles(comp.ci, next);
  };

  const onCode = tab < files.length;
  const booting = pump.status === 'booting' || pump.status === 'idle';

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
            <span data-testid="xenon-on" className={`text-[11px] font-bold ${pump.status === 'running' ? 'text-[#3ddc55]' : 'text-[#ff5b5b]'}`}>
              {pump.status === 'running' ? 'ON' : 'OFF'}
            </span>
            <button data-testid="xenon-close" className="text-[#8a93a0] hover:text-white"
              onClick={p.onClose} aria-label="close">✕</button>
          </div>
        </div>
        {/* menu row — File is FUNCTIONAL (the virtual disk), in-game parity */}
        <div className="flex flex-wrap items-center gap-4 border-b border-[#2b313b] bg-[#141b28] px-3 py-1 text-[12px] text-[#9fb0c8]">
          <button data-testid="xenon-menu-file" className="hover:text-white"
            onClick={() => setNewOpen(v => !v)}>File ▾</button>
          <span className="text-[#3f4b5f]">Library</span>
          <button data-testid="xenon-reboot" className="hover:text-white"
            onClick={() => pump.reboot()}>Computer ▸ re-boot</button>
          <button data-testid="xenon-run" className="hover:text-white"
            onClick={() => (pump.status === 'running' ? pump.stopRunning() : pump.startRunning())}>
            {pump.status === 'running' ? 'Options ▸ stop' : 'Options ▸ run'}
          </button>
          <span className="text-[#3f4b5f]">Help</span>
          <span className="ml-auto text-[10px] text-[#5d6a7d]">cycles {pump.cycles} @ 10 Hz · CTRL+S save+reboot · screens clickable</span>
        </div>
        {/* the File dialog: virtual-disk operations (the files are BAKED INTO
            THE CRAFT json — add/remove them freely, they save with the craft) */}
        {newOpen && (
          <div data-testid="xenon-file-dialog"
            className="flex flex-wrap items-center gap-2 border-b border-[#2b313b] bg-[#10182a] px-3 py-1.5 text-[11px]">
            <span className="text-[#9fb0c8]">Virtual disk — {files.length} file(s):</span>
            {files.map((f, i) => (
              <span key={f.name} data-testid={`xenon-disk-${i}`}
                className={`rounded bg-[#1a2233] px-1.5 py-0.5 ${i === tab ? 'text-[#8fd4ff]' : 'text-[#7d8aa0]'}`}>
                {f.name}{dirty.has(i) ? ' ●' : ''}
              </span>
            ))}
            <span className="mx-2 text-[#3f4b5f]">|</span>
            <input data-testid="xenon-new-name" value={newName} placeholder="new-file / program-name"
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addFile(); }}
              className="w-44 rounded border border-[#2b3a52] bg-[#0b0f18] px-1.5 py-0.5 text-[11px]" />
            <label className="flex items-center gap-1 text-[#9fb0c8]">
              <input data-testid="xenon-new-prog" type="checkbox" checked={newProg}
                onChange={e => setNewProg(e.target.checked)} /> program (.main.xc)
            </label>
            <button data-testid="xenon-new-ok" className="rounded bg-[#2b4a2b] px-2 py-0.5 hover:bg-[#38603a]"
              onClick={addFile}>+ create</button>
            <button data-testid="xenon-del-file"
              className={`rounded px-2 py-0.5 ${armedDel ? 'bg-[#6a1b1b] hover:bg-[#8a2424]' : 'bg-[#33202a] hover:bg-[#4a2836]'}`}
              onClick={delFile}>{armedDel ? 'sure?' : '✕ delete tab'}</button>
          </div>
        )}
        {/* tabs — every HDD file, dirty-marked */}
        <div className="flex flex-wrap gap-1 border-b border-[#2b313b] bg-[#121826] px-2 pt-1.5 text-[12px]">
          {files.map((f, i) => (
            <button key={f.name} data-testid={`xenon-tab-${i}`}
              onClick={() => { setTab(i); setEditing(false); setArmedDel(false); }}
              className={`rounded-t px-3 py-1 ${tab === i ? 'bg-[#10141f] text-[#8fd4ff]' : 'bg-[#1a2233] text-[#7d8aa0]'}`}>
              {i === 0 ? `${comp.program}.main.xc` : f.name}{dirty.has(i) ? ' ●' : ''}
            </button>
          ))}
          {graph && (
            <button data-testid="xenon-tab-nodes" onClick={() => setTab(100)}
              className={`rounded-t px-3 py-1 ${tab === 100 ? 'bg-[#10141f] text-[#8fd4ff]' : 'bg-[#1a2233] text-[#7d8aa0]'}`}>
              ⌗ nodes ({graph.nodes.length})
            </button>
          )}
          {onCode && !editing && (
            <button data-testid="xenon-edit" className="ml-auto self-center rounded bg-[#1d2c46] px-2 py-0.5
                   text-[11px] hover:bg-[#27395c]" onClick={startEdit}>✎ edit</button>
          )}
          {onCode && editing && (<>
            <button data-testid="xenon-save" className="ml-auto self-center rounded bg-[#2b4a2b] px-2 py-0.5
                   text-[11px] hover:bg-[#38603a]" onClick={() => save(false)}>💾 save (Ctrl+S)</button>
            <button data-testid="xenon-save-all" className="self-center rounded bg-[#243a52] px-2 py-0.5
                   text-[11px] hover:bg-[#2f4c6b]" onClick={() => save(true)}>⇩ save all</button>
            <button data-testid="xenon-edit-cancel" className="self-center rounded px-2 py-0.5
                   text-[11px] text-[#8a93a0] hover:bg-[#27395c]" onClick={() => setEditing(false)}>↺ revert</button>
          </>)}
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-hidden p-2 md:grid-cols-[minmax(0,1fr)_330px]">
          {/* code / nodes */}
          <div data-testid={`xenon-code-${tab}`} data-mode={status}
            className="min-h-0 overflow-hidden rounded border border-[#232c3d] bg-[#0b0f18] text-[12px] leading-[1.45]">
            {onCode && !editing && file && (
              <CodeView code={file.code} tabKey={`${comp.ci}:${tab}:${pump.status}`} />
            )}
            {onCode && editing && (
              <textarea ref={editRef} data-testid="xenon-code-edit" value={draft}
                onChange={e => editChange(e.target.value)}
                spellCheck={false} autoCapitalize="off" autoCorrect="off"
                className="h-full w-full resize-none bg-[#0b0f18] p-2 text-[12px] leading-[18px]
                       text-[#d6dbe1] caret-white outline-none" />
            )}
            {tab === 100 && graph && <NodeGraph graph={graph} reads={pump.reads} bus={pump.bus} />}
          </div>

          {/* right: THE COMPUTER SIDE PANEL — tabbed: Vars / Screens / Bus /
              Console (v1.13.x: "the computer should have a side-panel you can
              tab through, you should be able to see variables there, which
              automatically breaks open its KV structure … one of the side
              tabs to be the screens and virtual screens … search
              names/values in vars, and also names of screens") */}
          <div className="flex min-h-0 flex-col gap-1.5">
            <div className="flex gap-1 text-[11px]">
              {([['vars', `Vars (${pump.vars.size})`],
                ['screens', `Screens (${pump.surfaces.size})`],
                ['bus', 'Bus'], ['console', 'Console']] as const).map(([k, label]) => (
                <button key={k} data-testid={`xenon-side-${k}`} onClick={() => setSide(k)}
                  className={`rounded px-2 py-0.5 ${side === k ? 'bg-[#243a52] text-[#8fd4ff]' : 'bg-[#1a2233] text-[#7d8aa0] hover:text-white'}`}>
                  {label}
                </button>
              ))}
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
            {side === 'vars' && (<>
              <input data-testid="xenon-var-search" value={varQ} placeholder="search names / values…"
                onChange={e => setVarQ(e.target.value)}
                className="rounded border border-[#2b3a52] bg-[#0b0f18] px-2 py-1 text-[11px] outline-none" />
              {varList.map(v => {
                const kv = parseKv(v.v);
                const kind = varKind(v.t);
                const storage = v.t === 50 || v.t === 51 || v.t === 60 || v.t === 61;
                return (
                  <div key={v.name} data-testid={`xenon-var-${v.name}`}
                    className="rounded border border-[#232c3d] bg-[#131a28] px-2 py-1 text-[11px]">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[#8fd48f]">${v.name}
                        {storage && <span className="ml-1 rounded bg-[#332a1a] px-1 text-[9px] text-[#e6c07b]">storage</span>}
                        {kind === 'object' && <span className="ml-1 text-[9px] text-[#5d6a7d]">screen obj</span>}
                      </span>
                      <span className="truncate text-right tabular-nums text-[#d6dbe1]" title={v.v}>
                        {kv ? `{${kv.length}}` : v.v === '' ? '·' : v.v.length > 28 ? v.v.slice(0, 28) + '…' : v.v}
                      </span>
                    </div>
                    {kv && (
                      <div className="ml-3 border-l border-[#2b3a52] pl-2">
                        {kv.map(e => (
                          <div key={e.k} data-testid={`xenon-kv-${v.name}-${e.k}`}
                            className="flex justify-between gap-2 text-[10px]">
                            <span className="text-[#7ea6ff]">.{e.k}</span>
                            <span className="truncate tabular-nums text-[#9fb0c8]">{e.v === '' ? '·' : e.v}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {varList.length === 0 && (
                <span className="text-[11px] text-[#5d6a7d]">
                  {pump.vars.size === 0 ? 'no variables yet (booting?)' : 'no variable matches'}
                </span>
              )}
            </>)}
            {side === 'screens' && (<>
              <input data-testid="xenon-screen-search" value={scrQ} placeholder="search screen names…"
                onChange={e => setScrQ(e.target.value)}
                className="rounded border border-[#2b3a52] bg-[#0b0f18] px-2 py-1 text-[11px] outline-none" />
              {booting && <span className="text-[11px] text-[#5d6a7d]">booting…</span>}
              {!booting && surfList.length === 0 && (
                <span className="text-[11px] text-[#5d6a7d]">no surfaces match</span>
              )}
              <div className="flex flex-wrap gap-2">
                {surfList.map(s => (
                  <label key={s.key} className="block text-[10px] text-[#5d6a7d]">
                    <ScreenCanvas surfKey={s.key} w={s.w} h={s.h} maxH={170}
                      testid={`xenon-screen-${s.key}`} />
                    <div>{bindings.get(s.key) ?? s.key}
                      {s.key.startsWith('virtual#') && <span className="ml-1 rounded bg-[#24304a] px-1 text-[9px] text-[#8fd4ff]">virtual</span>}
                    </div>
                  </label>
                ))}
              </div>
            </>)}
            {side === 'bus' && (<>
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
                        pump.setInput(c.io, c.ch, v);
                      }} />
                    <span className="text-right tabular-nums">{(vals[`${c.io}.${c.ch}`] ?? 0).toFixed(2)}</span>
                  </label>
                ))}
                {comp.channels.length === 0 && <span className="text-[#5d6a7d]">no input_number() channels detected</span>}
              </div>
              <div className="rounded border border-[#232c3d] bg-[#131a28] p-2 text-[11px]">
                <div className="mb-1 text-[10px] uppercase tracking-widest text-[#5d6a7d]">io bus (output_number)</div>
                <div className="grid grid-cols-[1fr_28px_64px] gap-x-2">
                  {[...pump.bus.entries()].slice(-24).map(([k, v]) => {
                    const [io, port] = k.split(':');
                    const dev = comp.devices.find(d => String(d.io) === io);
                    return (
                      <div key={k} className="contents">
                        <span className="truncate text-[#9fb0c8]" title={dev ? `io ${io} = ${dev.alias || dev.type}` : io}>
                          {dev ? `${dev.alias || dev.type}` : io}</span>
                        <span className="text-[#5d6a7d]">{port}</span>
                        <span className="text-right tabular-nums text-[#8fd48f]">{fmtVal(v)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>)}
            {side === 'console' && (
              <div data-testid="xenon-log" className="min-h-[70px] flex-1 overflow-y-auto rounded border border-[#232c3d] bg-[#0b0f18] p-2 text-[11px]">
                {pump.log.filter(e => e.e === 'print').slice(-60).map((e, i) => (
                  <div key={i} className="text-[#d6dbe1]">print: {String(e.v)}</div>
                ))}
                {pump.log.filter(e => e.e === 'print').length === 0 && (
                  <div className="text-[#5d6a7d]">no prints yet</div>
                )}
              </div>
            )}
            </div>
          </div>
        </div>

        {/* status lines (in-game parity) */}
        <div className="border-t border-[#2b313b] bg-[#141b28] px-3 py-1 text-[11px]">
          <div className={pump.status === 'error' ? 'text-[#ff5b5b]' : 'text-[#3ddc55]'}>
            {pump.status === 'error' ? `Program '${comp.program}' crashed: ${pump.error}`
              : `Program '${comp.program}' loaded`}</div>
          {pump.status === 'running' && <div className="text-[#7ea6ff]">Program '{comp.program}' is running…</div>}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// $var token with a LIVE hover readout: the tooltip shows the variable's
// current value; when it changes, the OLD value appears above it and fades
// out (the user's "watch it tick" ask). Values stream from pump.vars
// (XENON-VARS), refreshed at the 10 Hz pump cadence.

function VarToken(p: { name: string }) {
  const v = pumpVars().get(p.name);
  const cur = v?.v;
  const [hist, setHist] = useState<{ v: string; id: number } | null>(null);
  const last = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (cur !== undefined && last.current !== undefined && cur !== last.current)
      setHist({ v: last.current, id: ++histSeq });
    last.current = cur;
  }, [cur]);
  const [hov, setHov] = useState(false);
  const kv = cur ? parseKv(cur) : null;
  return (
    <span className="relative" onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}>
      {`$${p.name}`}
      {hov && (
        <span className="absolute bottom-full left-0 z-20 mb-0.5 flex flex-col items-start whitespace-pre rounded
                       border border-[#3a4a6a] bg-[#0b0f18] px-1.5 py-0.5 text-[10px] text-[#8fd48f] shadow-lg">
          {hist && (
            <span key={hist.id} className="var-fade text-[#c586c0]" onAnimationEnd={() => setHist(null)}>
              {hist.v === '' ? '·' : hist.v} →
            </span>
          )}
          <span>= {cur === undefined ? '·' : cur.length > 48 ? cur.slice(0, 48) + '…' : cur}
            {kv ? ` · {${kv.length} kv}` : ''}</span>
        </span>
      )}
    </span>
  );
}
let histSeq = 0;
const pumpVars = () => xenonPump.vars;

// ---------------------------------------------------------------------------
// The virtualized code view: windowed render of a file's lines (a 16k-line
// Badger main.xc scrolls FULLY — the fixed 1500-line view cap is retired);
// per-line validation runs the REAL compiler over the visible window.

function CodeView(p: { code: string; tabKey: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState({ a: 0, b: 150 });
  const lines = useMemo(() => p.code.split('\n'), [p.code]);

  const reRange = () => {
    const el = boxRef.current;
    if (!el) return;
    const a = Math.max(0, Math.floor(el.scrollTop / ROW) - 12);
    const b = Math.min(lines.length, Math.ceil((el.scrollTop + el.clientHeight) / ROW) + 12);
    setRange(r => (r.a === a && r.b === b ? r : { a, b }));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reRange, [lines.length, p.tabKey]);

  const run = xenonPump.run;
  const errs = useMemo(() => {
    const errs = new Map<number, string>();
    if (!run) return errs;
    const a = range.a, b = Math.min(range.b, a + MAX_PARSE_LINES);
    for (let i = a; i < b; i++) {
      const t = lines[i]?.trim() ?? '';
      if (!t || t.startsWith(';') || t.startsWith('//') || t.startsWith('#')) continue;
      const e = run.parseLine(lines[i]!, i + 1);
      if (e) errs.set(i, e);
    }
    return errs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, p.tabKey, lines, range.a, range.b]);

  return (
    <div ref={boxRef} data-testid="xenon-code-view" data-lines={lines.length}
      className="h-full overflow-auto" onScroll={reRange}>
      <div style={{ height: lines.length * ROW, position: 'relative' }}>
        {lines.slice(range.a, range.b).map((ln, k) => {
          const i = range.a + k;
          return (
            <div key={i} data-testid={errs.has(i) ? `xenon-err-${i}` : undefined}
              title={errs.get(i)}
              className={`flex ${errs.has(i) ? 'bg-[#3a1420]' : ''}`}
              style={{ position: 'absolute', top: i * ROW, left: 0, right: 0, height: ROW }}>
              <span className="w-11 shrink-0 select-none pr-2 text-right text-[10px] leading-[18px] text-[#3f4b5f]">{i + 1}</span>
              <span className="whitespace-pre text-[12px] leading-[18px]">
                {tokenize(ln).map((t, j) => t.t === 'var' && t.s.startsWith('$')
                  ? <VarToken key={j} name={t.s.slice(1).toLowerCase()} />
                  : <span key={j} style={{ color: TOK_COLOR[t.t] }}>{t.s}</span>)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The visual-program graph (#NODES): DOM cards + SVG wires, pan + zoom.
// Colours follow the in-game node editor (green inputs, purple outputs, blue
// math, orange utility); the LIVE values: InputNode = the value last READ
// from its io/channel's component, OutputNode = the io bus value per port.

function nodeColor(type: string): string {
  if (type.startsWith('Input')) return '#2e7d32';
  if (type.startsWith('Output')) return '#6a1b9a';
  if (type.startsWith('MathNode')) return '#1565c0';
  if (type.startsWith('Counter') || type.startsWith('Timer') || type.startsWith('PID')) return '#ef6c00';
  return '#37474f';
}

function NodeGraph(p: { graph: XGraph; reads: Map<string, number>; bus: Map<string, number | string> }) {
  const { graph } = p;
  const boxRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 20, y: 20, k: 0.6 });
  const drag = useRef<{ px: number; py: number } | null>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const xs = graph.nodes.map(n => n.x), ys = graph.nodes.map(n => n.y);
    const x2 = graph.nodes.map(n => n.x + n.w), y2 = graph.nodes.map(n => n.y + n.h);
    const bw = Math.max(...x2) - Math.min(...xs), bh = Math.max(...y2) - Math.min(...ys);
    const k = Math.min(el.clientWidth / (bw + 60), el.clientHeight / (bh + 60), 1.2);
    setView({ k, x: (el.clientWidth - bw * k) / 2 - Math.min(...xs) * k,
              y: (el.clientHeight - bh * k) / 2 - Math.min(...ys) * k });
  }, [graph]);

  const byId = useMemo(() => new Map(graph.nodes.map(n => [n.id, n])), [graph]);
  const minX = Math.min(...graph.nodes.map(n => n.x));
  const minY = Math.min(...graph.nodes.map(n => n.y));

  return (
    <div ref={boxRef} data-testid="xenon-nodes" className="relative h-full max-h-[560px] w-full overflow-hidden
         cursor-grab bg-[#0b0f18]"
      onPointerDown={e => { drag.current = { px: e.clientX - view.x, py: e.clientY - view.y }; }}
      onPointerMove={e => {
        if (!drag.current) return;
        setView(v => ({ ...v, x: e.clientX - drag.current!.px, y: e.clientY - drag.current!.py }));
      }}
      onPointerUp={() => { drag.current = null; }}
      onWheel={e => {
        const r = boxRef.current?.getBoundingClientRect();
        if (!r) return;
        const mx = e.clientX - r.left, my = e.clientY - r.top;
        setView(v => {
          const k2 = Math.min(4, Math.max(0.08, v.k * (e.deltaY < 0 ? 1.12 : 0.89)));
          return { k: k2, x: mx - ((mx - v.x) / v.k) * k2, y: my - ((my - v.y) / v.k) * k2 };
        });
      }}>
      <div className="absolute left-0 top-0" style={{ transform: `translate(${view.x}px,${view.y}px) scale(${view.k})`, transformOrigin: '0 0' }}>
        <svg className="absolute" width={1} height={1} style={{ left: minX, top: minY, overflow: 'visible', pointerEvents: 'none' }}>
          {graph.links.map((l, i) => {
            const a = byId.get(l.from), b = byId.get(l.to);
            if (!a || !b) return null;
            const ax = a.x + a.w, ay = a.y + a.h / 2;
            const by = b.y + 16 + (b.h - 20) * ((l.port + 0.5) / Math.max(b.inputs.length, 1));
            return <path key={i} d={`M ${ax - minX} ${ay - minY} C ${ax + 40 - minX} ${ay - minY}, ${b.x - 40 - minX} ${by - minY}, ${b.x - minX} ${by - minY}`}
              stroke="#8899c8" strokeWidth={1.4 / view.k} fill="none" />;
          })}
        </svg>
        {graph.nodes.map(n => {
          const isInput = n.type.startsWith('Input');
          const isOutput = n.type.startsWith('Output');
          const inVal = isInput && n.ioNumber != null ? p.reads.get(`${n.ioNumber}:${n.channel ?? 0}`) : undefined;
          return (
            <div key={n.id} data-testid={`xenon-node-${n.id}`}
              className="absolute overflow-hidden rounded border border-[#2b3a52] bg-[#16202e] text-[9px] leading-[12px]"
              style={{ left: n.x, top: n.y, width: Math.max(n.w, 90), height: n.h }}>
              <div className="h-[14px] truncate px-1 text-[10px] leading-[14px] text-white"
                style={{ background: nodeColor(n.type) }}>{n.title}</div>
              {(isInput || isOutput) && (
                <div className="px-1 pt-0.5 text-[#c8d4e8]">
                  {isInput ? `io ${n.ioNumber ?? '?'}  ch ${n.channel ?? '?'}` : `io ${n.ioNumber ?? '?'}  (write)`}
                  {isInput && (
                    <span data-testid={`xenon-nodeval-${n.id}`} className="ml-1 font-bold text-[#8fd48f]">
                      = {inVal === undefined ? '·' : fmtVal(inVal)}
                    </span>
                  )}
                </div>
              )}
              {n.inputs.map((src, i) => {
                const outV = isOutput && n.ioNumber != null ? p.bus.get(`${n.ioNumber}:${i}`) : undefined;
                const v = n.inputValues?.[i];
                const label = src ? (byId.get(src)?.title ?? '?')
                  : v !== undefined && v !== '' ? `= ${v}` : '·';
                return (
                  <div key={i} className="flex items-center justify-between px-1 text-[#9fb0c8]">
                    <span className="truncate">· {label}</span>
                    {outV !== undefined && (
                      <span data-testid={`xenon-nodeval-${n.id}-${i}`} className="shrink-0 font-bold text-[#8fd48f]">
                        {fmtVal(outV)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
