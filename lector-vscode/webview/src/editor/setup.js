// Builds the CodeMirror 6 editor used inside the Lector webview.
import { EditorView, keymap, drawSelection, dropCursor, rectangularSelection } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { history, defaultKeymap, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { bracketMatching, indentOnInput } from '@codemirror/language';
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { GFM } from '@lezer/markdown';
import { lectorTheme } from './lectorTheme.js';
import { livePreviewField } from './livePreview.js';

export function createEditor({ parent, doc = '', onChange }) {
  const state = EditorState.create({
    doc,
    extensions: [
      history(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      rectangularSelection(),
      EditorView.lineWrapping,
      indentOnInput(),
      bracketMatching(),
      markdown({
        base: markdownLanguage,
        codeLanguages: languages,
        extensions: [GFM],
        addKeymap: true,
      }),
      lectorTheme,
      livePreviewField,
      highlightSelectionMatches(),
      search({ top: true }),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged && typeof onChange === 'function') {
          onChange(u.state.doc.toString(), u);
        }
      }),
    ],
  });

  return new EditorView({ state, parent });
}
