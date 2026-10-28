// CodeEditor.tsx — the XenonCode IDE's REAL editor (CodeMirror 6).
//
// Replaces the v1.13 read-view + textarea pair (we: "when I edit code, I
// need syntax highlighting, I should have go to definition as a right click
// menu and hovering over a function should tell me its signature and where
// it lives"):
//  - XenonCode syntax highlighting (StreamLanguage: ';' comments and ';#'
//    directives, $vars, @functions, types, strings, numbers, operators),
//  - a BREAKPOINT GUTTER (click toggles; the paused line gets a gold ▶ and
//    a row wash; compile errors wash red),
//  - a RIGHT-CLICK MENU: Go to Definition · Run to Cursor · Toggle
//    Breakpoint · Cut/Copy/Paste · Save,
//  - HOVER: `@name` → signature + `file:line`; `$var` → its LIVE value,
//  - Ctrl+Click = go to definition; completion on ordinary typing plus
//    `$` / `@` triggers (device aliases complete inside output_number("…")),
//  - dark oneDark theme, viewport-virtualised (the Badger's 16k main.xc
//    opens instantly — the old read view needed its own paging code).
// One EditorView per visible tab (the parent remounts by tabKey).
import {
  forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState,
} from 'react';
import { Compartment, Prec, EditorState, RangeSetBuilder, type Extension } from '@codemirror/state';
import {
  Decoration, EditorView, GutterMarker, ViewPlugin, hoverTooltip, keymap, lineNumbers,
  gutter, type BlockInfo, type DecorationSet, type ViewUpdate,
} from '@codemirror/view';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { StreamLanguage } from '@codemirror/language';
import {
  autocompletion, closeCompletion, completionStatus, startCompletion,
  type Completion, type CompletionContext, type CompletionResult,
} from '@codemirror/autocomplete';
import { closeSearchPanel, openSearchPanel, searchKeymap, searchPanelOpen } from '@codemirror/search';
import { requestThumb } from '../engine/thumbs';
import { oneDark } from '@codemirror/theme-one-dark';
import { tags as t } from '@lezer/highlight';
import {
  XC_KEYWORDS, XC_LIB_DOC, XC_LIB_FNS, XC_SCREEN_MEMBERS, XC_GLOBAL_CONSTS, definitionOf,
  functionTokenAt, ioCallAt, opensBlockLine, type XCDecl, type XCFile, type XCFunction,
} from '../engine/xcproject';

// ── XenonCode language ────────────────────────────────────────────────
const KEYWORDS = new Set(XC_KEYWORDS);
const LIB = new Set(XC_LIB_FNS);
// v1.13.27: the game's global constants (colors/alignment/pi — declared by
// the shim, see tools/xenoncode/xc_host.cpp archeanInit); highlighted with
// the library family and completed with their value/meaning
const CONSTS = new Set(XC_GLOBAL_CONSTS.map(c => c.name));
const TYPES = new Set(['number', 'text', 'bool', 'array', 'storage']);

const xcLanguage = StreamLanguage.define({
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match(/^;.*/)) return 'comment';
    if (stream.match(/^\/\/.*/)) return 'comment';
    if (stream.match(/^"[^"]*"/) || (stream.match(/^"/) && stream.skipToEnd())) return 'string';
    if (stream.match(/^\$[\w.]+/)) return 'var';
    if (stream.match(/^@[\w.]+/)) return 'fn';
    if (stream.match(/^\d+(\.\d+)?([eE][+-]?\d+)?/)) return 'number';
    const w = stream.match(/^[\w.]+/);
    const s = w && w !== true ? w[0] : null;
    if (s) {
      if (KEYWORDS.has(s)) return 'keyword';
      if (LIB.has(s) || CONSTS.has(s)) return 'stdFn';
      if (TYPES.has(s)) return 'type';
      return 'name';
    }
    if (stream.match(/^[{}()[\]]/)) return 'bracket';
    if (stream.match(/^[,;:]/)) return 'punct';
    if (stream.match(/^[=+\-*/%<>!&|^~?]+/)) return 'operator';
    stream.next();
    return null;
  },
  tokenTable: {
    comment: t.lineComment,
    string: t.string,
    var: t.variableName,
    fn: t.function(t.name),
    stdFn: t.standard(t.function(t.name)),
    number: t.number,
    keyword: t.keyword,
    type: t.typeName,
    name: t.name,
    bracket: t.bracket,
    punct: t.punctuation,
    operator: t.operator,
  },
  languageData: {
    commentTokens: { line: ';' },
    closeBrackets: { brackets: ['(', '[', '{', '"'] },
    // the indent unit is a TAB everywhere (the game's scope grammar):
    // Tab/indentMore and our Enter agree with the corpus style
    indentUnit: '\t',
  },
});

// ── gutter markers ────────────────────────────────────────────────────
// This @codemirror/view paints markers via elementClass (on the gutter
// cell) + toDOM (the cell's node) — the old toElement() is not in the
// protocol (verified on the installed dist).
class BreakMarker extends GutterMarker {
  elementClass = 'xc-bp';
  toDOM() {
    const e = document.createElement('span');
    e.textContent = '●';
    return e;
  }
  eq() { return true; }
}
class PausedMarker extends GutterMarker {
  elementClass = 'xc-paused-mark';
  toDOM() {
    const e = document.createElement('span');
    e.textContent = '▶';
    return e;
  }
  eq() { return true; }
}
const BP_M = new BreakMarker();
const PAUSED_M = new PausedMarker();

export interface CodeEditorHandle {
  /** Reveal + center a 1-based line and put the caret on it. */
  jumpTo(line1: number): void;
  cursorLine(): number;           // 1-based
  focus(): void;
  /** Open CodeMirror's find panel (the IDE's Ctrl+F, from any focus). */
  openSearch(): void;
  /** Close an open find panel; true = a panel was open and got closed. */
  closeSearch(): boolean;
  /** Open the Ctrl+G go-to-line box (the IDE's relay from a dead zone). */
  openGoto(): void;
}

export interface CodeEditorProps {
  file: XCFile;
  tabKey: string;                 // remount per tab (fresh editor state)
  editable: boolean;
  onChange?: (v: string) => void;
  onSave?: () => void;
  breaks: Set<number>;            // 1-based, THIS file
  pausedLine: number;             // 1-based, 0 = not paused here
  errors?: Map<number, string>;   // 1-based line -> compiler message (red rows)
  funcs: XCFunction[];            // the project function index
  decls: XCDecl[];                // declared variables (completion pool)
  varList: { name: string; v: string; type?: string }[];  // live globals
  devices: { alias: string; type: string }[];
  getVar: (name: string) => { v: string; type: string } | undefined;
  debugActive: boolean;           // VM running → Run to Cursor offered
  onToggleBreak: (line1: number) => void;
  onRunTo: (line1: number) => void;
  onGoDef: (file: string, line1: number) => void;
  onLine: (line1: number) => void;   // caret moved (F9's target)
  /** io-CALL hover (v1.13.26): caret on input_number/output_number/… —
   *  the dialog resolves the DEVICE (alias/io), the channel's game
   *  MEANING and the live value; the tooltip paints `lines` and, when a
   *  component `type` comes back, its catalog-preview thumbnail (the SAME
   *  engine/thumbs.ts renderer the placement menu rows use — we: "a view
   *  of the component's normal appearance like in the menu where it's
   *  placed from"). null = nothing to say. */
  ioInfo?: (fn: string, arg: string, channel: number) =>
    { type: string; lines: string[] } | null;
  /** Ctrl+Click on an io call — the dialog flies the 3-D view to the
   *  device (we: "…and display the 3d view…"). */
  onIoClick?: (fn: string, arg: string, channel: number) => void;
}

function lineDecoExt(breaks: Set<number>, pausedLine: number,
  errors: Map<number, string> | undefined): Extension {
  // paused/error row washes, viewport-scoped (breaks ride the GUTTER, the
  // line itself stays unstyled so the code keeps its colours)
  void breaks;
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = this.build(view); }
    update(u: ViewUpdate) {
      if (u.viewportChanged || u.transactions.length) this.decorations = this.build(u.view);
    }
    build(view: EditorView): DecorationSet {
      const b = new RangeSetBuilder<import('@codemirror/view').Decoration>();
      const add: { from: number; cls: string }[] = [];
      for (const r of view.visibleRanges) {
        const first = view.state.doc.lineAt(r.from).number;
        const last = view.state.doc.lineAt(r.to).number;
        for (let ln = first; ln <= last; ln++) {
          const cls = [pausedLine === ln ? 'xc-line-paused' : '',
            errors?.has(ln) ? 'xc-line-error' : ''].filter(Boolean).join(' ');
          if (cls) add.push({ from: view.state.doc.line(ln).from, cls });
        }
      }
      add.sort((a, c) => a.from - c.from);
      for (const a of add) b.add(a.from, a.from, Decoration.line({ class: a.cls }));
      return b.finish();
    }
  }, { decorations: (v) => v.decorations });
}

function CodeEditorInner(p: CodeEditorProps, ref: React.Ref<CodeEditorHandle>) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const propsRef = useRef(p);
  propsRef.current = p;
  const [menu, setMenu] = useState<{ x: number; y: number; line1: number;
    token: string | null } | null>(null);
  // Ctrl+G go-to-line (v1.13.26, we: "ctrl-g needs to go to a certain
  // line") — a tiny in-editor box (this CM vintage ships no go-to-line)
  const [gotoLn, setGotoLn] = useState<string | null>(null);
  const roC = useMemo(() => new Compartment(), []);
  const decoC = useMemo(() => new Compartment(), []);

  useEffect(() => {
    if (!hostRef.current) return;

    const completionSource = (context: CompletionContext): CompletionResult | null => {
      const s = propsRef.current;
      const word = context.matchBefore(/[A-Za-z0-9_.\-]*$/);
      const before = context.state.doc.sliceString(Math.max(0, context.pos - 60), context.pos);
      // device aliases inside a device-function string: output_number("g…
      if (/output_number|input_number|input_text|output_text/.test(before)
          && /"\s*[\w.\-]*$/.test(before) && word) {
        const opts = s.devices
          .filter(d => d.alias.toLowerCase().startsWith(word.text.toLowerCase()))
          .map(d => ({ label: d.alias, type: 'string', detail: d.type,
            apply: `"${d.alias}"`, info: `${d.type} (device alias)` }));
        if (opts.length) {
          return { from: context.pos - word.text.length, options: opts,
            validFor: /^[\w.\-]*$/ };
        }
      }
      // '.' → screen members
      const dot = context.matchBefore(/(\w|\.)+\.\w*/);
      if (dot && dot.text.includes('.')) {
        const tail = dot.text.slice(dot.text.lastIndexOf('.') + 1);
        const opts = XC_SCREEN_MEMBERS
          .filter(m => m.startsWith(tail)).map(m => ({ label: m, type: 'keyword',
            detail: 'screen member' }));
        if (opts.length) return { from: context.pos - tail.length, options: opts };
      }
      // '@' → declared functions (declaring file rides as detail)
      const at = context.matchBefore(/@[\w.]*$/);
      if (at) {
        const w = at.text.slice(1);
        const opts = s.funcs
          .filter(f => f.name.toLowerCase().startsWith(w.toLowerCase()))
          .map(f => ({ label: '@' + f.name, type: 'function',
            detail: `${f.file}:${f.line}`, info: f.display }));
        if (opts.length) return { from: context.pos - w.length, options: opts };
      }
      // '$' → live globals FIRST (the actual situation), then disk declares
      const dollar = context.matchBefore(/\$[\w.]*$/);
      if (dollar) {
        const w = dollar.text;
        const seen = new Set<string>();
        const opts: Completion[] = [];
        for (const v of s.varList)
          if (v.name.startsWith(w) && !seen.has(v.name)) {
            seen.add(v.name);
            opts.push({ label: v.name, type: 'variable',
              detail: `= ${v.v.slice(0, 24)}` });
          }
        for (const d of s.decls)
          if (d.name.startsWith(w) && !seen.has(d.name)) {
            seen.add(d.name);
            opts.push({ label: d.name, type: 'variable', detail: `${d.file}:${d.line}` });
          }
        if (opts.length) return { from: context.pos - w.length, options: opts };
      }
      // bare word → library + keywords + declared functions (v1.13.26:
      // library entries complete WITH their signature and meaning — we:
      // "autocomplete should suggest them when typing")
      const w = context.matchBefore(/[\w]+$/);
      if (w && w.text.length >= 1) {
        const opts = [
          ...XC_LIB_DOC.filter(f => f.name.startsWith(w.text))
            .map(f => ({ label: f.name, type: 'keyword', detail: 'library',
              info: `${f.sig} — ${f.desc}` })),
          // the game's global constants (v1.13.27, we: "red, green which
          // seem to be built in constants are not recognized")
          ...XC_GLOBAL_CONSTS.filter(c => c.name.startsWith(w.text))
            .map(c => ({ label: c.name, type: 'constant',
              detail: c.kind === 'color' ? 'color' : c.kind === 'align' ? 'alignment' : 'number',
              info: c.hex ? `${c.hex} — packed RGBA color constant` : c.desc })),
          ...XC_KEYWORDS.filter(k => k.startsWith(w.text))
            .map(k => ({ label: k, type: 'keyword' })),
          ...s.funcs.filter(f => f.name.startsWith(w.text))
            .map(f => ({ label: f.name, type: 'function', detail: f.file,
              info: `${f.display} — declared in ${f.file}:${f.line}` })),
        ];
        if (opts.length) return { from: w.from, options: opts };
      }
      return null;
    };

    const hover = hoverTooltip((view: EditorView, pos: number) => {
      const s = propsRef.current;
      const line = view.state.doc.lineAt(pos);
      const col = pos - line.from;
      const tok = functionTokenAt(line.text, col);
      if (tok) {
        const idx = line.text.indexOf('@' + tok);
        const def = definitionOf(s.funcs, tok);
        const dom = document.createElement('div');
        dom.className = 'xc-hover';
        dom.innerHTML = def
          ? `<b>${def.display}</b><div>defined in ${def.file}:${def.line}</div>`
          : `<b>@${tok}</b><div>not declared on this disk</div>`;
        return { pos: line.from + idx, end: line.from + idx + tok.length + 1,
          create: () => ({ dom }) };
      }
      // io CALL (v1.13.26, we: "when mouseovering a io write/read to a
      // specific port … resolve what kind of device it is and what its
      // current values are … read from the device itself"): the dialog
      // owns the resolution (it has the device table + channel table +
      // live reads/bus); we only paint.
      const ioc = ioCallAt(line.text, col);
      if (ioc && s.ioInfo) {
        const info = s.ioInfo(ioc.fn, ioc.arg, ioc.channel);
        if (info && info.lines.length) {
          const dom = document.createElement('div');
          dom.className = 'xc-hover xc-io-tip';
          const row = document.createElement('div');
          row.className = 'xc-io-row';
          if (info.type) {
            // the part's catalog thumbnail — the placement menu's own
            // live-model renderer (engine/thumbs.ts, one shared GL
            // context, async fill), the part as it looks when placed
            const img = document.createElement('img');
            img.width = 30;
            img.height = 30;
            img.className = 'xc-io-thumb';
            img.setAttribute('data-testid', 'xc-io-thumb');
            row.appendChild(img);
            requestThumb(img, info.type);
          }
          const txt = document.createElement('div');
          txt.innerHTML = `<b>${info.lines[0]}</b>`
            + info.lines.slice(1).map(l => `<div>${l}</div>`).join('');
          row.appendChild(txt);
          dom.appendChild(row);
          const idx = Math.max(0, line.text.indexOf(ioc.fn, Math.max(0, col - ioc.fn.length)));
          return { pos: line.from + idx, end: line.from + idx + ioc.fn.length,
            create: () => ({ dom }) };
        }
      }
      const around = line.text.slice(Math.max(0, col - 24), col + 24);
      const m = /\$[\w.]+/.exec(around);
      if (m) {
        const v = s.getVar(m[0]);
        const dom = document.createElement('div');
        dom.className = 'xc-hover';
        dom.innerHTML = v ? `<b>${m[0]}</b> · ${v.type}<div>= ${v.v.slice(0, 60)}</div>`
          : `<b>${m[0]}</b><div>not a live global</div>`;
        const idx = line.text.indexOf(m[0], Math.max(0, col - 24));
        return { pos: line.from + idx, end: line.from + idx + m[0].length,
          create: () => ({ dom }) };
      }
      return null;
    });

    const bpGutter = gutter({
      class: 'xc-break-gutter',
      // EVERY line renders a clickable cell (empty lines too — the click
      // target IS the feature: click-to-toggle a breakpoint anywhere)
      renderEmptyElements: true,
      lineMarker: (view: EditorView, line: BlockInfo) => {
        const s = propsRef.current;
        const ln = view.state.doc.lineAt(line.from).number;
        if (s.breaks.has(ln)) return BP_M;
        if (s.pausedLine === ln) return PAUSED_M;
        return null;
      },
      lineMarkerChange: () => true,
    });

    const trigger = (key: string) => (view: EditorView) => {
      view.dispatch(view.state.replaceSelection(key));
      startCompletion(view);
      return true;
    };

    const state = EditorState.create({
      doc: p.file.code,
      extensions: [
        oneDark,
        lineNumbers(),
        bpGutter,
        xcLanguage,
        roC.of([EditorState.readOnly.of(!p.editable), EditorView.editable.of(p.editable)]),
        decoC.of(lineDecoExt(p.breaks, p.pausedLine, p.errors)),
        // Escape over an OPEN completion popup closes the popup and STOPS
        // there (v1's popup stopPropagation law). CM's completion keymap
        // consumes Escape WITHOUT stopping propagation, so the window's
        // Esc-closes-the-IDE handler eats the same keystroke — a
        // Prec.high binding ahead of it is the only clean stop. The v1.13.25
        // FIND panel gets the SAME guard: Esc closes find, never the IDE.
        Prec.high(keymap.of([{ key: 'Escape', stopPropagation: true, run: (view) => {
          if (searchPanelOpen(view.state)) { closeSearchPanel(view); view.focus(); return true; }
          if (!completionStatus(view.state)) return false;
          closeCompletion(view);
          return true;
        } }])),
        autocompletion({ override: [completionSource] }),
        hover,
        keymap.of([
          { key: 'Ctrl-s', run: () => { propsRef.current.onSave?.(); return true; } },
          // ENTER auto-indent (v1.13.26, we: "after hitting enter on an
          // init,update etc. block, the next line should automatically
          // indent, same with a function"): at the end of an OPENING line
          // (xcproject.opensBlockLine) land one unit deeper; anywhere
          // else the current line's indent is carried. Handled HERE (not
          // defaultKeymap's newlineAndIndent — this CM vintage's stream
          // indent() cannot see the previous line). NOTE: CM6 normalizes a
          // TYPED '\n' (keyboard.type) to the Enter keymap too — code
          // AUTHORED through the keyboard must rely on this indent, not
          // carry manual tabs (tab + auto-indent = mixed indent = the
          // compiler's 'Invalid scope'; the xenonfresh/worldsim legs
          // learned this the red way).
          { key: 'Enter', run: (view) => {
            if (!propsRef.current.editable) return false;
            const st = view.state;
            const pos = st.selection.main.head;
            const line = st.doc.lineAt(pos);
            const atEnd = pos - line.from >= line.text.trimEnd().length;
            const indent = /^\s*/.exec(line.text)?.[0] ?? '';
            // ONE UNIT = a TAB: XenonCode's compiler scopes block bodies by
            // TAB indent (a 2-space body parses as GLOBAL scope — measured
            // 'Invalid first word' on the fresh leg)
            const text = atEnd
              ? (opensBlockLine(line.text) ? `\n${indent}\t` : `\n${indent}`)
              : '\n';
            // selection EXPLICITLY at the insert's end: a bare changes-only
            // dispatch maps the cursor BEFORE the inserted text (measured:
            // the next typed word landed on the PREVIOUS line)
            view.dispatch({ changes: { from: pos, insert: text },
              selection: { anchor: pos + text.length }, scrollIntoView: true });
            return true;
          } },
          // Ctrl+G go-to-line (v1.13.26)
          { key: 'Ctrl-g', run: () => { setGotoLn(''); return true; } },
          { key: '$', run: trigger('$') },
          { key: '@', run: trigger('@') },
          // Escape over an OPEN completion popup closes the popup and stops
          // there (v1's popup stopPropagation law: without it the window
          // handler eats the same Escape and the whole IDE closes)
          { key: 'Escape', run: (view) => {
            if (!completionStatus(view.state)) return false;
            closeCompletion(view);
            return true;
          } },
          // v1.13.26: defaultKeymap (we: "Tab needs to not move the cursor
          // out of the editor when editing xenoncode"). CM deliberately
          // keeps Tab = focus-move by DEFAULT (accessibility) — the indent
          // Tab is the separate indentWithTab binding; defaultKeymap also
          // brings arrows/Home/End/Ctrl-A/Ctrl-End/Enter-newline. Ours
          // ABOVE them, the find keys below keep their scope.
          ...defaultKeymap,
          indentWithTab,
          ...searchKeymap,
        ]),

        EditorView.updateListener.of(u => {
          if (u.docChanged && propsRef.current.editable)
            propsRef.current.onChange?.(u.state.doc.toString());
          if (u.selectionSet)
            propsRef.current.onLine(u.state.doc.lineAt(u.state.selection.main.head).number);
        }),
      ],
    });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    // gutter breakpoint toggles + Ctrl+Click go-to-definition ride PLAIN
    // listeners on view.dom: @codemirror/view binds both EditorView^
    // domEventHandlers and plugin eventHandlers to the CONTENT node, and
    // the gutters live outside it (verified on the installed 6.3x)
    const onMD = (e: Event) => {
      const me = e as MouseEvent;
      const el = (me.target as HTMLElement)?.closest?.('.xc-break-gutter .cm-gutterElement');
      if (!el) return;
      const pos = view.posAtCoords({ x: me.clientX, y: me.clientY });
      if (pos == null) return;
      propsRef.current.onToggleBreak(view.state.doc.lineAt(pos).number);
      me.preventDefault();
    };
    const onClick = (e: Event) => {
      const me = e as MouseEvent;
      if (!(me.ctrlKey || me.metaKey)) return;
      const pos = view.posAtCoords({ x: me.clientX, y: me.clientY });
      if (pos == null) return;
      const line = view.state.doc.lineAt(pos);
      // io CALL (v1.13.26): Ctrl+Click flies the 3-D view to the device
      const ioc = ioCallAt(line.text, pos - line.from);
      if (ioc && propsRef.current.onIoClick) {
        propsRef.current.onIoClick(ioc.fn, ioc.arg, ioc.channel);
        return;
      }
      const tok = functionTokenAt(line.text, pos - line.from);
      const def = tok ? definitionOf(propsRef.current.funcs, tok) : null;
      if (def) propsRef.current.onGoDef(def.file, def.line);
    };
    view.dom.addEventListener('mousedown', onMD);
    view.dom.addEventListener('click', onClick);
    return () => {
      view.dom.removeEventListener('mousedown', onMD);
      view.dom.removeEventListener('click', onClick);
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.tabKey, p.file.name]);

  // debugger decorations follow the props (breaks/paused/errors change rarely)
  const decoTag = `${[...p.breaks].sort().join(',')}|${p.pausedLine}|${[...(p.errors?.keys() ?? [])].sort().join(',')}`;
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: decoC.reconfigure(lineDecoExt(p.breaks, p.pausedLine, p.errors)),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decoTag]);

  // read-only ⇄ edit
  useEffect(() => {
    viewRef.current?.dispatch({ effects: roC.reconfigure([
      EditorState.readOnly.of(!p.editable), EditorView.editable.of(p.editable)]) });
  }, [p.editable, roC]);

  // external doc changes (save round-trip, revert, tab data refreshed):
  // replace when the buffer is out of sync (never fights an active edit)
  useEffect(() => {
    const view = viewRef.current;
    if (!view || p.editable) return;
    if (view.state.doc.toString() !== p.file.code)
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: p.file.code } });
  }, [p.file.code, p.editable, p.tabKey]);

  useImperativeHandle(ref, () => ({
    jumpTo(line1: number) {
      const view = viewRef.current;
      if (!view) return;
      const ln = Math.max(1, Math.min(line1, view.state.doc.lines));
      view.dispatch({ selection: { anchor: view.state.doc.line(ln).from },
        scrollIntoView: true });
      view.focus();
    },
    cursorLine() {
      const view = viewRef.current;
      return view ? view.state.doc.lineAt(view.state.selection.main.head).number : 1;
    },
    focus() { viewRef.current?.focus(); },
    openSearch() {
      const view = viewRef.current;
      if (!view) return;
      openSearchPanel(view);      // opens the panel + focuses its input
    },
    /** Esc over an OPEN find panel: close it, report true (the IDE's window
     *  Esc handler must then NOT close the window — popup stopPropagation
     *  law). True only when a panel actually closed. The panel's input
     *  keydown never reaches the editor-content keymap (the panel lives
     *  outside view.dom), so this window-side check is the real guard;
     *  the Prec.high binding covers Esc from the editor content. */
    closeSearch(): boolean {
      const view = viewRef.current;
      if (!view || !searchPanelOpen(view.state)) return false;
      closeSearchPanel(view);
      view.focus();
      return true;
    },
    openGoto() { setGotoLn(''); },
  }), []);

  // ── right-click menu ──
  const openMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const view = viewRef.current;
    if (!view) return;
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
    if (pos == null) return;
    const line = view.state.doc.lineAt(pos);
    view.dispatch({ selection: { anchor: pos } });
    setMenu({ x: e.clientX, y: e.clientY, line1: line.number,
      token: functionTokenAt(line.text, pos - line.from) });
  };
  const item = (label: string, testid: string, on: () => void, disabled = false) => (
    <button key={testid} data-testid={testid} disabled={disabled}
      className={`block w-full px-3 py-1 text-left text-[11px] ${disabled ? 'text-[#4b5566]' : 'hover:bg-[#27395c]'}`}
      onClick={() => { setMenu(null); on(); }}>{label}</button>
  );
  const def = menu?.token ? definitionOf(p.funcs, menu.token) : null;

  return (
    <div style={{ height: '100%', position: 'relative' }} onContextMenu={openMenu}>
      <div ref={hostRef} data-testid="xc-editor" data-lines={p.file.code.split('\n').length}
        style={{ height: '100%', overflow: 'hidden' }} />
      {gotoLn !== null && (
        <div data-testid="xc-goto"
          className="absolute right-2 top-2 z-50 flex items-center gap-1.5 rounded border border-[#2b3a52] bg-[#141b2b] px-2 py-1 shadow-xl">
          <span className="text-[10px] text-[#9fb0c8]">go to line</span>
          <input data-testid="xc-goto-input" autoFocus value={gotoLn} placeholder="N"
            onChange={e => setGotoLn(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                const n = parseInt(gotoLn, 10);
                const view = viewRef.current;
                if (view && Number.isFinite(n)) {
                  const ln = Math.max(1, Math.min(n, view.state.doc.lines));
                  view.dispatch({ selection: { anchor: view.state.doc.line(ln).from },
                    scrollIntoView: true });
                }
                // focus the editor SYNCHRONOUSLY (the input is then not
                // focused, so the state-update unmount below cannot drop
                // focus to <body>); a setTimeout(0) re-focus raced the
                // next keystroke and made the jump flaky (measured)
                viewRef.current?.focus();
                setGotoLn(null);
              } else if (e.key === 'Escape') {
                e.stopPropagation();               // popup stopPropagation law
                viewRef.current?.focus();
                setGotoLn(null);
              }
            }}
            className="w-16 rounded border border-[#3a5a82] bg-[#0b0f18] px-1 py-0.5 text-[11px] tabular-nums outline-none" />
        </div>
      )}
      {menu && (
        <div data-testid="xc-ctxmenu" role="menu"
          className="fixed z-50 min-w-44 rounded border border-[#2b3a52] bg-[#141b2b] py-1 font-mono shadow-xl"
          style={{ left: menu.x, top: menu.y }}
          onMouseLeave={() => setMenu(null)}>
          {item(`Go to Definition${menu.token ? ` (@${menu.token})` : ''}`, 'ctx-godef',
            () => { if (def) p.onGoDef(def.file, def.line); }, !def)}
          {item('Run to Cursor', 'ctx-runtocursor',
            () => p.onRunTo(menu.line1), !p.debugActive)}
          {item(p.breaks.has(menu.line1) ? 'Remove Breakpoint' : 'Add Breakpoint',
            'ctx-breakpoint', () => p.onToggleBreak(menu.line1))}
          <div className="my-1 border-t border-[#2b313b]" />
          {item('Cut', 'ctx-cut', () => document.execCommand('cut'), !p.editable)}
          {item('Copy', 'ctx-copy', () => document.execCommand('copy'))}
          {item('Paste', 'ctx-paste', async () => {
            try {
              const text = await navigator.clipboard.readText();
              const view = viewRef.current;
              if (view && text) {
                const r = view.state.selection.main;
                view.dispatch({ changes: { from: r.from, to: r.to, insert: text },
                  selection: { anchor: r.from + text.length } });
              }
            } catch { /* clipboard permission: the click is the gesture */ }
          }, !p.editable)}
          <div className="my-1 border-t border-[#2b313b]" />
          {item('Save', 'ctx-save', () => p.onSave?.(), !p.editable)}
        </div>
      )}
    </div>
  );
}

const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(CodeEditorInner);
export { CodeEditor };

// styles (style-mod keeps CM core styled; ours ride the editor classes)
if (typeof document !== 'undefined' && !document.querySelector('#xc-editor-css')) {
  const css = document.createElement('style');
  css.id = 'xc-editor-css';
  css.textContent = `
.xc-break-gutter { width: 18px; min-width: 18px; }
.xc-break-gutter .cm-gutterElement { cursor: pointer; text-align: center; font-size: 10px; }
.xc-bp { color: #ff5b5b; }
.xc-paused-mark { color: #e6c07b; }
.xc-line-paused { background: rgba(230,192,123,.16) !important; }
.xc-line-error { background: rgba(255,60,60,.14) !important; }
.xc-hover { font-family: ui-monospace, monospace; font-size: 11px; padding: 4px 6px;
  max-width: 340px; color: #cfe1ff; }
.xc-hover b { color: #8fd4ff; }
.xc-io-row { display: flex; gap: 8px; align-items: center; }
.xc-io-thumb { flex: none; border-radius: 3px; background: #1d2b42;
  border: 1px solid #3a4a6a; }
.cm-editor { height: 100%; }
.cm-editor .cm-scroller { font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px; line-height: 1.45; }
.cm-tooltip.xc-tip, .cm-tooltip { font-family: ui-monospace, monospace; }
`;
  document.head.appendChild(css);
}
