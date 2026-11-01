// Live-preview decorations for CodeMirror 6 — the "Bear-like" hybrid rendering.
//
// Strategy (same model as Obsidian Live Preview / Bear): the document IS the
// markdown source (so it round-trips losslessly back to the file), and we paint
// decorations on top:
//   • headings get sized/weighted lines, the leading "#" is hidden off the
//     active line;
//   • inline marks (** _ ` ~~ [] ()) are styled and HIDDEN unless the caret is
//     inside that node — moving the caret in reveals the raw markdown so you can
//     edit it;
//   • block constructs (images, mermaid, hr, task checkboxes) become inline
//     widgets when the caret is elsewhere.
import { Decoration, EditorView } from '@codemirror/view';
import { StateEffect, StateField } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { BulletWidget, CheckboxWidget, HrWidget, ImageWidget, MermaidWidget } from './widgets.js';

// ── Image URI resolution (round-trips through the extension host) ───────────
export const imageState = {
  cache: new Map(), // decoded path -> webview uri string | null (failed)
  pending: new Set(),
  requestFn: null, // (path:string) => void
  view: null,
};
export const refreshEffect = StateEffect.define();

export function configureImageResolver(requestFn) {
  imageState.requestFn = requestFn;
}
export function provideResolvedImage(path, uri) {
  imageState.cache.set(path, uri || null);
  imageState.pending.delete(path);
  if (imageState.view) imageState.view.dispatch({ effects: refreshEffect.of(null) });
}
function resolveImageSrc(rawSrc) {
  const src = rawSrc.replace(/^<|>$/g, '').trim();
  if (/^(https?:|data:|blob:|vscode-)/i.test(src)) return src;
  let path = src;
  try {
    path = decodeURIComponent(src);
  } catch {
    /* keep raw */
  }
  if (imageState.cache.has(path)) return imageState.cache.get(path);
  if (!imageState.pending.has(path)) {
    imageState.pending.add(path);
    if (imageState.requestFn) imageState.requestFn(path);
  }
  return null;
}

// ── Helpers ────────────────────────────────────────────────────────────────
const HIDE = Decoration.replace({});
const markCache = new Map();
function mark(cls) {
  let d = markCache.get(cls);
  if (!d) {
    d = Decoration.mark({ class: cls });
    markCache.set(cls, d);
  }
  return d;
}

function selOverlaps(sel, from, to) {
  for (const r of sel.ranges) {
    if (r.from <= to && r.to >= from) return true;
  }
  return false;
}
function lineActive(state, sel, pos) {
  const line = state.doc.lineAt(pos);
  return selOverlaps(sel, line.from, line.to);
}
function addLineDeco(out, state, from, to, cls) {
  let pos = from;
  while (pos <= to) {
    const line = state.doc.lineAt(pos);
    out.all.push(Decoration.line({ class: cls }).range(line.from));
    if (line.to >= to) break;
    pos = line.to + 1;
  }
}
// Like addLineDeco, but also flags the first/last lines so the CSS can round
// the corners of a multi-line run (used for fenced code blocks).
function addBlockLineDeco(out, state, from, to, cls, firstCls, lastCls) {
  const firstLine = state.doc.lineAt(from);
  const lastLine = state.doc.lineAt(to);
  let pos = from;
  while (pos <= to) {
    const line = state.doc.lineAt(pos);
    let c = cls;
    if (line.from === firstLine.from) c += ' ' + firstCls;
    if (line.from === lastLine.from) c += ' ' + lastCls;
    out.all.push(Decoration.line({ class: c }).range(line.from));
    if (line.to >= to) break;
    pos = line.to + 1;
  }
}
function pushHide(out, from, to) {
  if (from >= to) return;
  const r = HIDE.range(from, to);
  out.all.push(r);
  out.atomic.push(r);
}
function pushWidget(out, from, to, widget, block) {
  const r = Decoration.replace({ widget, block: !!block }).range(from, to);
  out.all.push(r);
  out.atomic.push(r);
}

function fenceChildText(state, ref, type) {
  const n = ref.node.getChild(type);
  return n ? state.doc.sliceString(n.from, n.to) : '';
}

// ── Node handlers ──────────────────────────────────────────────────────────
function handleNode(node, state, sel, out) {
  const name = node.name;

  // Headings -----------------------------------------------------------------
  let h = /^ATXHeading([1-6])$/.exec(name) || /^SetextHeading([1-2])$/.exec(name);
  if (h) {
    addLineDeco(out, state, node.from, node.to, `cm-lp-h${h[1]}`);
    return;
  }
  if (name === 'HeaderMark') {
    const parent = node.node.parent;
    const active = parent ? lineActive(state, sel, parent.from) : lineActive(state, sel, node.from);
    if (active) {
      out.all.push(mark('cm-lp-mark').range(node.from, node.to));
    } else {
      // hide the "#"(s) and the single following space to avoid an indent
      let end = node.to;
      if (state.doc.sliceString(end, end + 1) === ' ') end += 1;
      pushHide(out, node.from, end);
    }
    return;
  }

  // Inline emphasis ----------------------------------------------------------
  if (name === 'StrongEmphasis') return void out.all.push(mark('cm-lp-strong').range(node.from, node.to));
  if (name === 'Emphasis') return void out.all.push(mark('cm-lp-em').range(node.from, node.to));
  if (name === 'Strikethrough') return void out.all.push(mark('cm-lp-strike').range(node.from, node.to));
  if (name === 'InlineCode') return void out.all.push(mark('cm-lp-code-inline').range(node.from, node.to));

  if (name === 'EmphasisMark' || name === 'StrikethroughMark') {
    const parent = node.node.parent;
    const active = parent ? selOverlaps(sel, parent.from, parent.to) : false;
    if (active) out.all.push(mark('cm-lp-mark').range(node.from, node.to));
    else pushHide(out, node.from, node.to);
    return;
  }
  if (name === 'CodeMark') {
    const parent = node.node.parent;
    if (parent && parent.name === 'FencedCode') {
      out.all.push(mark('cm-lp-fence').range(node.from, node.to));
    } else {
      const active = parent ? selOverlaps(sel, parent.from, parent.to) : false;
      if (active) out.all.push(mark('cm-lp-mark').range(node.from, node.to));
      else pushHide(out, node.from, node.to);
    }
    return;
  }

  // Links & images -----------------------------------------------------------
  if (name === 'Link') return void out.all.push(mark('cm-lp-link').range(node.from, node.to));
  if (name === 'Image') {
    const active = selOverlaps(sel, node.from, node.to);
    const inner = state.doc.sliceString(node.from, node.to);
    const m = /^!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+[^)]*)?\)/.exec(inner);
    if (!active && m) {
      const resolved = resolveImageSrc(m[2]);
      if (resolved) {
        pushWidget(out, node.from, node.to, new ImageWidget(resolved, m[1]), false);
        return false; // skip children
      }
    }
    return; // active or unresolved: fall through so marks get dimmed
  }
  if (name === 'URL') {
    const parent = node.node.parent;
    if (parent && (parent.name === 'Link' || parent.name === 'Image')) {
      const active = selOverlaps(sel, parent.from, parent.to);
      if (active) out.all.push(mark('cm-lp-url').range(node.from, node.to));
      else pushHide(out, node.from, node.to);
    }
    return;
  }
  if (name === 'LinkMark') {
    const parent = node.node.parent;
    const active = parent ? selOverlaps(sel, parent.from, parent.to) : false;
    if (active) out.all.push(mark('cm-lp-mark').range(node.from, node.to));
    else pushHide(out, node.from, node.to);
    return;
  }

  // Blockquote ---------------------------------------------------------------
  if (name === 'Blockquote') {
    addLineDeco(out, state, node.from, node.to, 'cm-lp-quote');
    return;
  }
  if (name === 'QuoteMark') {
    const active = lineActive(state, sel, node.from);
    if (active) {
      out.all.push(mark('cm-lp-quotemark').range(node.from, node.to));
    } else {
      let end = node.to;
      if (state.doc.sliceString(end, end + 1) === ' ') end += 1;
      pushHide(out, node.from, end);
    }
    return;
  }

  // Lists & tasks ------------------------------------------------------------
  if (name === 'ListMark') {
    const text = state.doc.sliceString(node.from, node.to);
    if (/^[-*+]$/.test(text)) {
      const active = lineActive(state, sel, node.from);
      // A task item ("- [ ] …") renders only its checkbox — suppress the bullet
      // so we don't show both a dot and a checkbox.
      const item = node.node.parent;
      const isTask = item && item.getChild('Task');
      if (isTask) {
        if (active) out.all.push(mark('cm-lp-listmark').range(node.from, node.to));
        else {
          let end = node.to;
          if (state.doc.sliceString(end, end + 1) === ' ') end += 1;
          pushHide(out, node.from, end);
        }
        return;
      }
      if (!active) {
        let depth = 0;
        let p = node.node.parent;
        while (p) {
          if (p.name === 'BulletList' || p.name === 'OrderedList') depth++;
          p = p.parent;
        }
        pushWidget(out, node.from, node.to, new BulletWidget(depth - 1), false);
        return;
      }
      out.all.push(mark('cm-lp-listmark').range(node.from, node.to));
      return;
    }
    // ordered list marker ("1.") — keep the number, just tint it
    out.all.push(mark('cm-lp-listmark-ordered').range(node.from, node.to));
    return;
  }
  if (name === 'TaskMarker') {
    const text = state.doc.sliceString(node.from, node.to); // "[ ]" / "[x]"
    const checked = /\[[xX]\]/.test(text);
    const active = lineActive(state, sel, node.from);
    if (!active) {
      pushWidget(out, node.from, node.to, new CheckboxWidget(checked, node.from), false);
      return false;
    }
    out.all.push(mark('cm-lp-mark').range(node.from, node.to));
    return;
  }

  // Fenced code & mermaid ----------------------------------------------------
  if (name === 'FencedCode') {
    const info = fenceChildText(state, node, 'CodeInfo').trim().toLowerCase();
    const active = selOverlaps(sel, node.from, node.to);
    if (info === 'mermaid' && !active) {
      const code = fenceChildText(state, node, 'CodeText');
      pushWidget(out, node.from, node.to, new MermaidWidget(code), true);
      return false;
    }
    addBlockLineDeco(
      out,
      state,
      node.from,
      node.to,
      'cm-lp-codeblock-line',
      'cm-lp-codeblock-first',
      'cm-lp-codeblock-last',
    );
    return;
  }
  if (name === 'CodeInfo') return void out.all.push(mark('cm-lp-fence').range(node.from, node.to));

  // Horizontal rule ----------------------------------------------------------
  if (name === 'HorizontalRule') {
    const active = lineActive(state, sel, node.from);
    if (!active) {
      pushWidget(out, node.from, node.to, new HrWidget(), true);
      return false;
    }
    out.all.push(mark('cm-lp-hr-src').range(node.from, node.to));
    return;
  }
}

function buildDecorations(state) {
  const sel = state.selection;
  const tree = syntaxTree(state);
  const out = { all: [], atomic: [] };
  tree.iterate({
    enter: (node) => handleNode(node, state, sel, out),
  });
  return {
    decorations: Decoration.set(out.all, true),
    atomic: Decoration.set(out.atomic, true),
  };
}

// Block-level decorations (mermaid / hr widgets) must come from a StateField,
// not a ViewPlugin — CodeMirror forbids block decorations from plugins.
export const livePreviewField = StateField.define({
  create(state) {
    return buildDecorations(state);
  },
  update(value, tr) {
    const refreshed = tr.effects.some((e) => e.is(refreshEffect));
    if (tr.docChanged || tr.selection || refreshed) {
      return buildDecorations(tr.state);
    }
    return value;
  },
  provide: (field) => [
    EditorView.decorations.from(field, (v) => v.decorations),
    EditorView.atomicRanges.of((view) => view.state.field(field, false)?.atomic ?? Decoration.none),
  ],
});

// Lets async image resolution trigger a redraw.
export function attachView(view) {
  imageState.view = view;
}
