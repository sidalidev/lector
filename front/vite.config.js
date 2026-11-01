import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { randomBytes } from 'crypto';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('../package.json', 'utf-8'));

// Politique de sécurité du contenu, posée en tête de index.html : la même pour
// le web, Capacitor et Electron. Aucun script hors des fichiers de l'app,
// jamais 'unsafe-eval' ni de script en ligne.
// - 'wasm-unsafe-eval' : verovio (partitions) compile du WebAssembly ; cela
//   n'autorise ni eval ni new Function.
// - style-src 'unsafe-inline' : styles posés par React, Mermaid, KaTeX et abcjs.
// - connect-src : serveur de synchro (l'app mobile n'est pas sur son origine),
//   Anthropic et ElevenLabs appelés depuis le navigateur avec la clé de
//   l'utilisateur, sons de abcjs et de la guitare (données, jamais du code).
// - frame-src : vidéos YouTube, Vimeo, Rumble ; pages HTML locales intégrées
//   sur ordinateur (lector-local:).
const POLITIQUE = {
  'default-src': ["'self'"],
  'script-src': ["'self'", "'wasm-unsafe-eval'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'blob:', 'https:', 'http:', 'lector-local:'],
  'media-src': ["'self'", 'data:', 'blob:', 'https:', 'http:', 'lector-local:'],
  'font-src': ["'self'", 'data:'],
  'connect-src': [
    "'self'",
    'https://lector.dockerbop.fr',
    'https://api.anthropic.com',
    'https://api.elevenlabs.io',
    'https://paulrosen.github.io',
    'https://surikov.github.io',
  ],
  'frame-src': ['https://www.youtube.com', 'https://player.vimeo.com', 'https://rumble.com', 'lector-local:'],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
};

// En développement seulement : le préambule de React Refresh est un script en
// ligne (autorisé par un nonce tiré au démarrage) et Vite recharge par websocket.
function politique(nonce) {
  const p = { ...POLITIQUE };
  if (nonce) {
    p['script-src'] = [...p['script-src'], `'nonce-${nonce}'`];
    p['connect-src'] = [...p['connect-src'], 'ws://localhost:*'];
  }
  return Object.entries(p).map(([nom, valeurs]) => `${nom} ${valeurs.join(' ')}`).join('; ');
}

// Juste après <meta charset>, avant tout script.
function csp(nonce) {
  const charset = '<meta charset="UTF-8" />';
  return {
    name: 'lector-csp',
    transformIndexHtml(html) {
      if (!html.includes(charset)) throw new Error('index.html: <meta charset> not found, CSP not set');
      return html.replace(charset, `${charset}\n    <meta http-equiv="Content-Security-Policy" content="${politique(nonce)}" />`);
    },
  };
}

export default defineConfig(({ command }) => {
  const nonce = command === 'serve' ? randomBytes(16).toString('base64') : undefined;
  return {
    plugins: [react(), csp(nonce)],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    base: './',
    html: { cspNonce: nonce },
    build: {
      outDir: 'dist',
      rollupOptions: {
        output: {
          manualChunks: {
            'diagram-blocks': ['./src/components/DiagramBlocks.jsx'],
            'mermaid': ['mermaid'],
            'd3': ['d3'],
            'abcjs': ['abcjs'],
          },
        },
      },
    },
    server: {
      port: 5173,
      // Les dépendances (polices, KaTeX) sont dans le node_modules de la racine.
      fs: { allow: ['.', '../node_modules'] },
    },
  };
});
