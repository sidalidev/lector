import { useState, useEffect, memo } from 'react';
import { Copy, Check } from 'lucide-react';
import { t } from '../services/i18n'

// Coloration du code : le cœur de highlight.js et la grammaire du langage ne
// se téléchargent qu'au premier bloc de code qui en a besoin. Le texte brut
// s'affiche tout de suite, la couleur arrive ensuite.
const LANGAGES = {
  bash: () => import('highlight.js/lib/languages/bash'),
  c: () => import('highlight.js/lib/languages/c'),
  cpp: () => import('highlight.js/lib/languages/cpp'),
  csharp: () => import('highlight.js/lib/languages/csharp'),
  css: () => import('highlight.js/lib/languages/css'),
  diff: () => import('highlight.js/lib/languages/diff'),
  dockerfile: () => import('highlight.js/lib/languages/dockerfile'),
  go: () => import('highlight.js/lib/languages/go'),
  ini: () => import('highlight.js/lib/languages/ini'),
  java: () => import('highlight.js/lib/languages/java'),
  javascript: () => import('highlight.js/lib/languages/javascript'),
  json: () => import('highlight.js/lib/languages/json'),
  kotlin: () => import('highlight.js/lib/languages/kotlin'),
  lua: () => import('highlight.js/lib/languages/lua'),
  makefile: () => import('highlight.js/lib/languages/makefile'),
  markdown: () => import('highlight.js/lib/languages/markdown'),
  php: () => import('highlight.js/lib/languages/php'),
  python: () => import('highlight.js/lib/languages/python'),
  ruby: () => import('highlight.js/lib/languages/ruby'),
  rust: () => import('highlight.js/lib/languages/rust'),
  scss: () => import('highlight.js/lib/languages/scss'),
  sql: () => import('highlight.js/lib/languages/sql'),
  swift: () => import('highlight.js/lib/languages/swift'),
  typescript: () => import('highlight.js/lib/languages/typescript'),
  xml: () => import('highlight.js/lib/languages/xml'),
  yaml: () => import('highlight.js/lib/languages/yaml'),
};
const ALIAS = {
  sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash',
  h: 'c', 'c++': 'cpp', hpp: 'cpp', cs: 'csharp',
  patch: 'diff', docker: 'dockerfile', golang: 'go', toml: 'ini',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  kt: 'kotlin', make: 'makefile', md: 'markdown',
  py: 'python', rb: 'ruby', rs: 'rust',
  ts: 'typescript', tsx: 'typescript',
  html: 'xml', svg: 'xml', vue: 'xml', yml: 'yaml',
};

let coeur = null;
const charges = new Map();

/** HTML colorié par highlight.js (déjà échappé par lui), ou null. */
async function colorier(code, langage) {
  const nom = ALIAS[langage] || langage;
  if (!LANGAGES[nom]) return null;
  coeur ||= import('highlight.js/lib/core').then((m) => m.default);
  const hljs = await coeur;
  if (!charges.has(nom)) {
    charges.set(nom, LANGAGES[nom]().then((m) => hljs.registerLanguage(nom, m.default)));
  }
  await charges.get(nom);
  return hljs.highlight(code, { language: nom, ignoreIllegals: true }).value;
}

export default memo(function CodeBlock({ children, language }) {
  const [copied, setCopied] = useState(false);
  const [html, setHtml] = useState(null);
  const codeString = String(children).replace(/\n$/, '');
  const langage = (language || '').toLowerCase();

  useEffect(() => {
    let vivant = true;
    setHtml(null);
    if (langage) colorier(codeString, langage).then((h) => { if (vivant) setHtml(h); }).catch(() => {});
    return () => { vivant = false; };
  }, [codeString, langage]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(codeString);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <div className="code-block-wrapper">
      <button className={`code-copy-btn ${copied ? 'copied' : ''}`} onClick={handleCopy} title={t('code.copy')}>
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      <pre className="code-block" data-language={langage || undefined}>
        {html != null
          ? <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
          : <code>{codeString}</code>}
      </pre>
    </div>
  );
})
