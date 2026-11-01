// Lector editor theme for CodeMirror 6.
// Reuses the warm "Lector" look (serif body, gold accent) and binds to VS Code
// theme tokens via CSS variables defined in styles/theme.css.
import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

// Structural / layout theme. Visual styling of markdown constructs (headings,
// marks, quotes…) lives in styles/editor.css so it can use the CSS variables.
export const lectorEditorTheme = EditorView.theme(
  {
    '&': {
      height: '100%',
      backgroundColor: 'var(--bg-primary)',
      color: 'var(--text-primary)',
      fontSize: '16.5px',
    },
    '.cm-scroller': {
      fontFamily: 'var(--font-sans)',
      lineHeight: '1.7',
      overflowX: 'hidden',
      padding: '12px 0 140px',
    },
    // Centered reading column, Bear-like width.
    '.cm-content': {
      maxWidth: '720px',
      margin: '0 auto',
      padding: '28px clamp(18px, 4vw, 48px)',
      caretColor: 'var(--accent-hover)',
    },
    '.cm-line': {
      padding: '0',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--accent-hover)',
      borderLeftWidth: '2px',
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
      backgroundColor: 'rgba(212, 165, 116, 0.25)',
    },
    '.cm-gutters': { display: 'none' },
    '.cm-activeLine': { backgroundColor: 'transparent' },
    // Search panel — keep it discreet and on-theme.
    '.cm-panels': {
      backgroundColor: 'var(--bg-secondary)',
      color: 'var(--text-primary)',
      borderTop: '1px solid var(--border)',
    },
    '.cm-textfield': {
      backgroundColor: 'var(--bg-primary)',
      border: '1px solid var(--border)',
      borderRadius: '6px',
      color: 'var(--text-primary)',
    },
    '.cm-button': {
      backgroundColor: 'var(--glass-bg)',
      border: '1px solid var(--border)',
      borderRadius: '6px',
      backgroundImage: 'none',
      color: 'var(--text-primary)',
    },
  },
  { dark: false }
);

// Syntax highlighting — mainly drives fenced-code-block colors. Markdown
// construct styling is handled by the live-preview plugin + editor.css, but a
// HighlightStyle gives us proper code coloring "for free".
export const lectorHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: '#a626a4' },
  { tag: [t.name, t.deleted, t.character, t.macroName], color: '#383a42' },
  { tag: [t.propertyName], color: '#4078f2' },
  { tag: [t.processingInstruction, t.string, t.inserted, t.special(t.string)], color: '#50a14f' },
  { tag: [t.function(t.variableName), t.labelName], color: '#4078f2' },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: '#986801' },
  { tag: [t.definition(t.name), t.separator], color: '#383a42' },
  { tag: [t.className], color: '#c18401' },
  { tag: [t.number, t.changed, t.annotation, t.modifier, t.self, t.namespace], color: '#986801' },
  { tag: [t.typeName], color: '#c18401' },
  { tag: [t.operator, t.operatorKeyword], color: '#a626a4' },
  { tag: [t.url, t.escape, t.regexp, t.link], color: '#50a14f' },
  { tag: [t.meta, t.comment], color: '#a0a1a7', fontStyle: 'italic' },
  { tag: t.invalid, color: '#e45649' },
]);

export const lectorTheme = [lectorEditorTheme, syntaxHighlighting(lectorHighlightStyle)];
