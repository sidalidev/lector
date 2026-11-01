import './styles/theme.css';
import './styles/editor.css';
import { EditorSelection } from '@codemirror/state';
import { createEditor } from './editor/setup.js';
import { attachView, configureImageResolver, provideResolvedImage } from './editor/livePreview.js';

const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
const root = document.getElementById('root');

// Standalone demo content (used only when running outside VS Code, for visual checks).
const DEMO_DOC = `# Lector — éditeur hybride

Tu écris du **markdown** et le rendu se fait *inline*, comme dans **Bear**. Pas de panneau de preview séparé.

## Ce que ça gère

- Listes à puces avec un **gras**, de l'*italique*, du \`code inline\`
- [x] Cases à cocher cliquables
- [ ] Une tâche pas encore faite
- Un [lien stylé](https://exemple.fr) sans le bazar des parenthèses

> Une citation avec une barre à gauche, en italique atténué.

### Un bloc de code

\`\`\`js
function bonjour(nom) {
  return \`Salut \${nom} 👋\`
}
\`\`\`

### Un diagramme Mermaid

\`\`\`mermaid
flowchart LR
  A[Tu tapes] --> B{Rendu inline}
  B --> A
\`\`\`

---

Et un filet de séparation juste au-dessus.
`;

let view = null;
let applyingRemote = false;
let currentContent = '';

function mount(initialDoc) {
  view = createEditor({
    parent: root,
    doc: initialDoc,
    onChange: (content) => {
      if (applyingRemote) return;
      currentContent = content;
      vscode?.postMessage({ type: 'edit', content });
    },
  });
  currentContent = initialDoc;
  attachView(view);
  view.focus();
}

function setRemoteContent(content) {
  if (!view) {
    mount(content);
    return;
  }
  if (content === currentContent) return; // our own echo or no-op
  applyingRemote = true;
  try {
    const head = Math.min(view.state.selection.main.head, content.length);
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: content },
      selection: EditorSelection.cursor(head),
    });
    currentContent = content;
  } finally {
    applyingRemote = false;
  }
}

// Local image paths must be resolved to webview URIs by the extension host.
configureImageResolver((path) => vscode?.postMessage({ type: 'resolveUri', path }));

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg) return;
  if (msg.type === 'document') setRemoteContent(msg.content ?? '');
  else if (msg.type === 'resolvedUri') provideResolvedImage(msg.path, msg.uri);
});

if (vscode) {
  vscode.postMessage({ type: 'ready' });
} else {
  // Standalone preview (outside VS Code) — used for visual verification.
  fetch('./demo.md')
    .then((r) => (r.ok ? r.text() : DEMO_DOC))
    .catch(() => DEMO_DOC)
    .then((text) => mount(text));
}
