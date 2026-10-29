// HudDialog.tsx — the IDE of a HUD block (v1.14.0 P9 slice A; we: "Initiate
// this work, allow us to edit the code for at least HUDs that are contained
// within a HUD block, and establish a familiar environment, including the
// concept of screens and buttons, and worldsim, call that avatarsim in the
// case of the avatar (player). There should also be a beacons menu…").
//
// A HudController component (data.xc_files, FORMAT §HUD) opens a familiar
// IDE: the SAME CodeEditor (tabs, syntax, completion pool, find/goto), the
// SAME save law (files live IN the blueprint; save = doc write; the menu
// rows and layout mirror the computer IDE), and THE SAME Beacons tab — the
// global radio scope every HUD talks through. The HUD RUNTIME (panel/
// draw/beacon builtins executing on the VM → canvas) is slice B; this slice
// makes the programs editable, real-data-safe, and radio-visible.
import { useEffect, useMemo, useRef, useState } from 'react';
import FloatingWindow from './FloatingWindow';
import { CodeEditor, type CodeEditorHandle } from './CodeEditor';
import BeaconPanel from './BeaconPanel';
import type { XCFile } from '../engine/xenoncode';
import { projectFunctions, projectDecls } from '../engine/xcproject';
import type { XenonHud } from '../engine/xenoncode';

const MENU_HINT = 'F5 run = save the buffers to the HUD block · Ctrl+F find · Ctrl+G goto · ⛶ maximise';

export default function HudDialog(p: {
  hud: XenonHud;
  onClose: () => void;
  onFiles: (ci: number, files: XCFile[]) => void;
}) {
  const { hud } = p;
  const [files, setFiles] = useState<XCFile[]>(hud.files.map(f => ({ ...f })));
  const [dirty, setDirty] = useState<Set<number>>(new Set());
  const [tab, setTab] = useState(0);
  const [max, setMax] = useState(false);
  const [side, setSide] = useState<'beacons'>('beacons');
  const [pendingJump, setPendingJump] = useState<{ line: number; focus: boolean } | null>(null);
  const editorRef = useRef<CodeEditorHandle | null>(null);
  const [armedDel, setArmedDel] = useState(false);

  const funcs = useMemo(() => projectFunctions(files), [files]);
  const decls = useMemo(() => projectDecls(files), [files]);
  const onCode = tab < files.length;
  const file = files[tab];

  const save = () => {
    p.onFiles(hud.ci, files);
    setDirty(new Set());
  };
  const editChange = (v: string) => {
    setFiles(m => {
      if (tab >= m.length) return m;
      const n = [...m];
      n[tab] = { ...n[tab]!, code: v };
      return n;
    });
    setDirty(mm => new Set(mm).add(tab));
  };
  const jumpTo = (fileName: string, line1: number) => {
    const idx = files.findIndex(f => f.name === fileName);
    if (idx >= 0) { setTab(idx); setPendingJump({ line: line1, focus: true }); }
  };
  const addFile = () => {
    const name = `hud-file-${files.length + 1}.xc`;
    setFiles([...files, { name, code: '' }]);
    setDirty(m => new Set(m).add(files.length));
    setTab(files.length);
  };
  const delFile = () => {
    if (!armedDel) { setArmedDel(true); return; }
    setArmedDel(false);
    if (files.length <= 1) return;
    setFiles(files.filter((_, i) => i !== tab));
    setDirty(new Set());
    setTab(0);
  };

  // F5 = SAVE the buffers (the IDE key law: a computer RUNS them; a HUD has
  // no runtime YET — saving is the commit, same doc path, same reboot-free
  // rhythm), Ctrl+F/G = find/goto (the shared IDE key laws).
  const keys = useRef({ save, onCode });
  keys.current = { save, onCode };
  const keyH = useRef((e: KeyboardEvent) => {
    if (e.key === 'F5') { e.preventDefault(); keys.current.save(); }
    else if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'g')) {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable === true)) return;
      e.preventDefault();
      if (e.key === 'f') editorRef.current?.openSearch();
      else editorRef.current?.openGoto();
    }
  }).current;
  useEffect(() => {
    addEventListener('keydown', keyH);
    return () => removeEventListener('keydown', keyH);
  }, [keyH]);
  // the jump lands AFTER the tab's editor remounts (the XenonDialog law)
  useEffect(() => {
    if (!pendingJump) return;
    const h = window.setTimeout(
      () => editorRef.current?.jumpTo(pendingJump.line, pendingJump.focus), 60);
    setPendingJump(null);
    return () => window.clearTimeout(h);
  }, [pendingJump]);

  return (
    <FloatingWindow
      id="hud" testid="hud-dialog" minW={640} minH={380}
      maximized={max} onToggleMaximize={() => setMax(m => !m)}
      initial={(vw, vh) => {
        const w = Math.min(1180, vw * 0.92), h = vh * 0.86;
        return { x: (vw - w) / 2 + 30, y: (vh - h) / 2 + 20, w, h };
      }}
      className="font-mono xenon-ide"
      header={
        <div className="flex items-center justify-between gap-2 bg-[#1a2436] px-3 py-1.5 text-[13px]">
          <span className="min-w-0 flex-1 truncate font-bold tracking-wide">
            HUD IDE ({hud.alias})</span>
          <div className="flex shrink-0 items-center gap-3">
            <span data-testid="hud-dirty" className={`text-[10px] font-bold ${dirty.size ? 'text-[#ff5b5b]' : 'text-[#5d6a7d]'}`}>
              {dirty.size ? `● ${dirty.size} unsaved` : 'saved'}
            </span>
            <button data-testid="hud-max" className="text-[#8a93a0] hover:text-white"
              title={max ? 'restore' : 'maximise'}
              onClick={() => setMax(m => !m)} aria-label="maximise">{max ? '🗗' : '⛶'}</button>
            <button data-testid="hud-close" className="text-[#8a93a0] hover:text-white"
              onClick={p.onClose} aria-label="close">✕</button>
          </div>
        </div>
      }>
      {/* menu row — File owns the disk (save = write into the HUD block);
          the right side states the scope law */}
      <div className="flex items-center gap-2 border-b border-[#2b313b] bg-[#141b28] px-3 py-1 text-[11px] text-[#9fb0c8]">
        <button data-testid="hud-save" className="rounded bg-[#2b4a2b] px-2 py-0.5 text-[#b7ecb7] hover:bg-[#38603a]"
          title="commit the files into the HUD block (F5) — data.xc_files, doc-guaranteed"
          onClick={save}>💾 save{dirty.size ? ` (${dirty.size})` : ''}</button>
        <button data-testid="hud-new-file" className="rounded bg-[#1d2c46] px-2 py-0.5 text-[#cfe1ff] hover:bg-[#27395c]"
          title="add an include file to the HUD program" onClick={addFile}>+ file</button>
        <button data-testid="hud-del-file"
          className={`rounded px-2 py-0.5 ${armedDel ? 'bg-[#6a1b1b] text-[#ffd7d7] hover:bg-[#8a2424]' : 'bg-[#33202a] text-[#ffb3b3] hover:bg-[#4a2836]'}`}
          onClick={delFile}>{armedDel ? 'sure?' : '✕ delete tab'}</button>
        <span className="ml-auto hidden text-[10px] text-[#5d6a7d] md:inline">{MENU_HINT}</span>
      </div>

      <div className={`flex min-h-0 flex-1 gap-2 overflow-hidden p-2${max ? '' : ''}`}>
        {/* left: file tabs + the shared CodeEditor (the familiar environment:
            the very editor of the computer IDE — tabs, theme, completion,
            find/goto; the debugger gutters idle: no VM behind a HUD YET) */}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div data-testid="hud-tabstrip"
            className="flex shrink-0 items-center gap-1 overflow-x-auto rounded border border-[#2b313b] bg-[#121826] px-2 py-1 text-[12px] [scrollbar-width:thin]">
            {files.map((f, i) => (
              <button key={f.name} data-testid={`hud-tab-${i}`}
                onClick={() => { setTab(i); setArmedDel(false); }}
                className={`shrink-0 whitespace-nowrap rounded-t px-3 py-1 ${tab === i ? 'bg-[#10141f] text-[#8fd4ff]' : 'bg-[#1a2233] text-[#7d8aa0]'}`}>
                {f.name}{dirty.has(i) && <span className="text-[#ff5b5b]" title="unsaved changes"> ●</span>}
              </button>
            ))}
          </div>
          <div data-testid={`hud-code-${tab}`}
            className="min-h-0 flex-1 overflow-hidden rounded border border-[#232c3d] bg-[#0b0f18] text-[12px] leading-[1.45]">
            {onCode && file && (
              <CodeEditor ref={editorRef}
                file={file} tabKey={`hud:${hud.ci}:${tab}`}
                editable
                onChange={editChange} onSave={save}
                breaks={new Set<number>()} pausedLine={0}
                errors={undefined}
                funcs={funcs} decls={decls}
                varList={[]}
                devices={[]}
                getVar={() => undefined}
                debugActive={false}
                onToggleBreak={() => undefined}
                onLine={() => undefined}
                onRunTo={() => undefined}
                onGoDef={(f, l) => jumpTo(f, l)}
              />
            )}
          </div>
        </div>

        {/* right: THE BEACONS tab — the global radio scope (the same panel
            the computer IDE shows; beacons + HUD programs + your sends) */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex shrink-0 flex-wrap items-center gap-1">
            <button data-testid="hud-side-beacons" onClick={() => setSide('beacons')}
              className="shrink-0 rounded px-2 py-1 text-[10px] tracking-wide hover:bg-[#182236]">
              <span className={`rounded px-1 py-0.5 ${side === 'beacons' ? 'bg-[#1d2b42] text-[#8fd4ff]' : 'text-[#7d8aa0]'}`}>
                Beacons</span>
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
            <div data-testid="hud-runtime-note"
              className="rounded border border-[#2b313b] bg-[#10182a] px-2 py-1 text-[10px] leading-snug text-[#5d6a7d]">
              panel()/draw_*/button*/text() + beacon()/get("avatar_sensor_*") RUN on the HUD VM —
              the runtime (this program → canvas panels, live beacon traffic) lands in the next
              v1.14.x slice; saving here writes the HUD block&apos;s real data.xc_files.
            </div>
            {side === 'beacons' && <BeaconPanel />}
          </div>
        </div>
      </div>
    </FloatingWindow>
  );
}
