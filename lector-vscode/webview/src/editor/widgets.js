// Inline/block widgets used by the live-preview plugin.
import { WidgetType } from '@codemirror/view';

let mermaidPromise = null;
let mermaidCounter = 0;
function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => {
      const mermaid = m.default ?? m;
      mermaid.initialize({
        startOnLoad: false,
        theme: 'neutral',
        securityLevel: 'strict', // untrusted .md → keep mermaid's DOMPurify sanitization on
        fontFamily: 'var(--font-sans)',
      });
      return mermaid;
    });
  }
  return mermaidPromise;
}

// ── List bullet (replaces -, *, + with a proper • / ◦) ─────────────────────
export class BulletWidget extends WidgetType {
  constructor(depth) {
    super();
    this.depth = depth || 0;
  }
  eq(other) {
    return other.depth === this.depth;
  }
  toDOM() {
    const s = document.createElement('span');
    s.className = 'cm-lp-bullet';
    s.textContent = this.depth % 2 === 1 ? '◦' : '•';
    return s;
  }
  ignoreEvent() {
    return false;
  }
}

// ── Horizontal rule ────────────────────────────────────────────────────────
export class HrWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const hr = document.createElement('hr');
    hr.className = 'cm-lp-hr';
    return hr;
  }
  ignoreEvent() {
    return false;
  }
}

// ── Task checkbox (clickable, toggles source) ──────────────────────────────
export class CheckboxWidget extends WidgetType {
  constructor(checked, pos) {
    super();
    this.checked = checked;
    this.pos = pos; // position of the "[" in "[ ]" / "[x]"
  }
  eq(other) {
    return other.checked === this.checked && other.pos === this.pos;
  }
  toDOM(view) {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'cm-lp-checkbox';
    box.checked = this.checked;
    box.addEventListener('mousedown', (e) => e.preventDefault());
    box.addEventListener('click', (e) => {
      e.preventDefault();
      const insert = this.checked ? '[ ]' : '[x]';
      view.dispatch({
        changes: { from: this.pos, to: this.pos + 3, insert },
      });
    });
    return box;
  }
  ignoreEvent() {
    return false;
  }
}

// ── Inline image ───────────────────────────────────────────────────────────
export class ImageWidget extends WidgetType {
  constructor(src, alt) {
    super();
    this.src = src;
    this.alt = alt || '';
  }
  eq(other) {
    return other.src === this.src && other.alt === this.alt;
  }
  toDOM() {
    const wrap = document.createElement('span');
    wrap.className = 'cm-lp-img-wrap';
    const img = document.createElement('img');
    img.className = 'cm-lp-img';
    img.src = this.src;
    img.alt = this.alt;
    img.onerror = () => {
      wrap.classList.add('cm-lp-img-broken');
      wrap.textContent = `🖼️ ${this.alt || this.src}`;
    };
    if (this.alt) {
      const cap = document.createElement('span');
      cap.className = 'cm-lp-img-cap';
      cap.textContent = this.alt;
      wrap.appendChild(img);
      wrap.appendChild(cap);
    } else {
      wrap.appendChild(img);
    }
    return wrap;
  }
  ignoreEvent() {
    return false;
  }
}

// ── Mermaid diagram ────────────────────────────────────────────────────────
export class MermaidWidget extends WidgetType {
  constructor(code) {
    super();
    this.code = code;
  }
  eq(other) {
    return other.code === this.code;
  }
  toDOM() {
    const wrap = document.createElement('div');
    wrap.className = 'cm-lp-mermaid';
    wrap.textContent = 'Rendering diagram…';
    const id = `cm-mermaid-${mermaidCounter++}`;
    loadMermaid()
      .then((mermaid) => mermaid.render(id, this.code))
      .then(({ svg }) => {
        wrap.innerHTML = svg;
      })
      .catch((err) => {
        wrap.classList.add('cm-lp-mermaid-error');
        const pre = document.createElement('pre');
        pre.textContent = this.code;
        wrap.innerHTML = '';
        const msg = document.createElement('div');
        msg.className = 'cm-lp-mermaid-msg';
        msg.textContent = `Mermaid error: ${err?.message ?? err}`;
        wrap.appendChild(msg);
        wrap.appendChild(pre);
      });
    return wrap;
  }
  ignoreEvent() {
    return false;
  }
}
