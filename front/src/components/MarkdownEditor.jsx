import { useRef, useEffect, memo } from 'react';
import { EditorView, lineNumbers, highlightActiveLine, keymap } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { history, historyKeymap } from '@codemirror/commands';
import { foldGutter, bracketMatching, indentOnInput, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import './MarkdownEditor.css';

const fontSizeCompartment = new Compartment();

function makeFontSizeExtension(size) {
  return EditorView.theme({
    '&': { fontSize: `${size}px` },
    '.cm-gutters': { fontSize: `${size * 0.75}px` },
  });
}

// `extensions` : extensions CodeMirror en plus, fournies par l'appelant. Le
// document partagé (collab/) y passe la liaison Yjs : l'historique et le
// contenu viennent alors du Y.Text, pas de `content` ni de history().
function MarkdownEditor({ content, onChange, fontSize = 16, autoFocus = false, extensions = null }) {
  const partage = !!extensions;
  const containerRef = useRef(null);
  const viewRef = useRef(null);
  const onChangeRef = useRef(onChange);

  // Keep onChange ref fresh
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Create editor on mount
  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: content || '',
      extensions: [
        ...(extensions || []),
        lineNumbers(),
        highlightActiveLine(),
        ...(partage ? [] : [history()]),
        foldGutter(),
        bracketMatching(),
        closeBrackets(),
        indentOnInput(),
        syntaxHighlighting(defaultHighlightStyle),
        markdown({ base: markdownLanguage }),
        EditorView.lineWrapping,
        fontSizeCompartment.of(makeFontSizeExtension(fontSize)),
        keymap.of([
          ...defaultKeymap.filter(k => k.key !== 'Mod-f' && k.key !== 'Mod-h'),
          ...(partage ? [] : historyKeymap),
          ...closeBracketsKeymap,
          indentWithTab,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current?.(update.state.doc.toString());
          }
        }),
        EditorView.theme({
          '&': {
            height: '100%',
            flex: '1',
          },
          '.cm-scroller': {
            overflow: 'auto',
            fontFamily: "var(--font-mono)",
            lineHeight: '1.7',
          },
          '.cm-content': {
            maxWidth: '800px',
            margin: '0 auto',
            padding: '32px clamp(16px, 3vw, 36px)',
            caretColor: 'var(--accent-primary)',
          },
          '.cm-gutters': {
            background: 'var(--bg-primary)',
            border: 'none',
            color: 'var(--text-muted)',
            opacity: '0.5',
            transition: 'opacity 0.2s',
          },
          '&.cm-focused .cm-gutters': {
            opacity: '1',
          },
          '.cm-activeLineGutter': {
            background: 'transparent',
            color: 'var(--text-secondary)',
          },
          '.cm-activeLine': {
            background: 'var(--bg-secondary)',
            borderRadius: '2px',
          },
          '.cm-cursor': {
            borderLeftColor: 'var(--accent-primary)',
            borderLeftWidth: '2px',
          },
          '.cm-foldGutter': {
            color: 'var(--text-muted)',
          },
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    if (autoFocus) {
      requestAnimationFrame(() => view.focus());
    }

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []); // mount only

  // Sync content from outside (file switch)
  useEffect(() => {
    const view = viewRef.current;
    if (!view || partage) return;
    const currentDoc = view.state.doc.toString();
    if (content !== currentDoc) {
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: content || '' },
      });
    }
  }, [content]);

  // Dynamic font size
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: fontSizeCompartment.reconfigure(makeFontSizeExtension(fontSize)),
    });
  }, [fontSize]);

  return <div ref={containerRef} className="markdown-editor-container" />;
}

export default memo(MarkdownEditor);
