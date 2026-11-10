import { useRef, useEffect, memo } from 'react';
import { EditorView, lineNumbers, highlightActiveLine, keymap, drawSelection } from '@codemirror/view';
import { EditorState, Compartment, Prec, Transaction } from '@codemirror/state';
import { history, historyKeymap } from '@codemirror/commands';
import { foldGutter, bracketMatching, indentOnInput, syntaxHighlighting, defaultHighlightStyle, LanguageSupport } from '@codemirror/language';
// Pas markdown() : sa valeur par défaut embarque le langage HTML, donc aussi
// JavaScript et CSS (un tiers de l'éditeur). La grammaire Markdown (GFM), la
// suite des listes à Entrée et le collage d'URL en lien suffisent.
import { markdownLanguage, markdownKeymap, pasteURLAsLink } from '@codemirror/lang-markdown';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { modeEcriture, optionsApercu } from './editor/livePreview/index.js';
import { surlignages, creerApi } from './editor/apiEditeur.js';
import { inscrire, desinscrire } from '../services/editeurCourant.js';
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
// `content` peut alors être une fonction, lue à la création de l'éditeur : le
// texte reçu entre le rendu et le montage (effet différé) n'est pas perdu.
// `options` : images locales et liens de note (voir livePreview/options.js).
// `principal` : l'éditeur de la note ouverte ; le sommaire et la recherche le
// pilotent (services/editeurCourant.js) et la page défile autour de lui.
function MarkdownEditor({ content, onChange, fontSize = 16, autoFocus = false, extensions = null, options = null, principal = false, readOnly = false, onView = null }) {
  const partage = !!extensions;
  const containerRef = useRef(null);
  const viewRef = useRef(null);
  const onChangeRef = useRef(onChange);
  // Textes envoyés au parent et pas encore revenus en `content`. Les effets
  // passent après coup : quand un ancien texte revient, l'utilisateur a pu
  // taper depuis. Le réappliquer effacerait sa frappe et relancerait un
  // aller-retour sans fin entre deux versions.
  const emis = useRef([]);

  // Keep onChange ref fresh
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Create editor on mount
  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: (typeof content === 'function' ? content() : content) || '',
      extensions: [
        ...(extensions || []),
        ...(options ? [optionsApercu.of(options)] : []),
        ...(readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []),
        surlignages(),
        // Curseur dessiné par l'éditeur (le natif ne s'épaissit pas) : voir livePreview.css.
        drawSelection({ cursorBlinkRate: 1100 }),
        // Mis en forme par défaut ; « Show Markdown syntax » rend le mode source.
        modeEcriture({ source: [lineNumbers(), highlightActiveLine(), foldGutter(), syntaxHighlighting(defaultHighlightStyle)] }),
        ...(partage ? [] : [history()]),
        bracketMatching(),
        closeBrackets(),
        indentOnInput(),
        new LanguageSupport(markdownLanguage),
        Prec.high(keymap.of(markdownKeymap)),
        pasteURLAsLink,
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
            const texte = update.state.doc.toString();
            if (!partage) emis.current.push(texte);
            onChangeRef.current?.(texte);
          }
        }),
        EditorView.theme({
          // L'éditeur principal grandit avec le texte : c'est la page qui défile.
          '&': principal ? { minHeight: '100%' } : {
            height: '100%',
            flex: '1',
          },
          '.cm-scroller': {
            overflow: principal ? 'visible' : 'auto',
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
          '.cm-cursor, .cm-dropCursor': {
            borderLeft: '3px solid var(--accent-primary)',
            borderRadius: '2px',
            marginLeft: '-1px',
            // Le curseur glisse d'une position à l'autre au lieu de sauter.
            transition: 'left 90ms cubic-bezier(.2,.8,.2,1), top 90ms cubic-bezier(.2,.8,.2,1)',
          },
          // Clignotement en fondu plutôt qu'en tout ou rien (les noms d'animation de
          // CodeMirror restent : il relance le cycle à chaque frappe).
          '.cm-cursorLayer': {
            animationTimingFunction: 'ease-in-out !important',
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
    const api = principal ? creerApi(view) : null;
    if (api) inscrire(api);
    onView?.(view);

    if (autoFocus) {
      requestAnimationFrame(() => view.focus());
    }

    return () => {
      if (api) desinscrire(api);
      onView?.(null);
      view.destroy();
      viewRef.current = null;
    };
  }, []); // mount only

  // Sync content from outside (file switch)
  useEffect(() => {
    const view = viewRef.current;
    if (!view || partage) return;
    // Un texte venu de l'éditeur lui-même : rien à appliquer, on oublie les plus anciens.
    const i = emis.current.lastIndexOf(content);
    if (i !== -1) { emis.current = emis.current.slice(i + 1); return; }
    emis.current = [];
    const currentDoc = view.state.doc.toString();
    if (content !== currentDoc) {
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: content || '' },
        // Texte venu d'ailleurs : Cmd+Z ne doit pas le défaire.
        annotations: Transaction.addToHistory.of(false),
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
