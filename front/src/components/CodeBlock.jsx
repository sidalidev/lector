import { useState, memo } from 'react';
// PrismAsyncLight : cœur minuscule, chaque langage est chargé à la demande
// (le build Prism complet embarquait les 300 langages dans le bundle principal)
import SyntaxHighlighter from 'react-syntax-highlighter/dist/esm/prism-async-light';
import codeTheme, { lineNumberStyle } from './codeTheme';
import { Copy, Check } from 'lucide-react';
import { t } from '../services/i18n'

export default memo(function CodeBlock({ children, language, ...props }) {
  const [copied, setCopied] = useState(false);
  const codeString = String(children).replace(/\n$/, '');

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
      <SyntaxHighlighter
        style={codeTheme}
        lineNumberStyle={lineNumberStyle}
        language={language || 'text'}
        PreTag="div"
        className="code-block"
        {...props}
        showLineNumbers
      >
        {codeString}
      </SyntaxHighlighter>
    </div>
  );
})
