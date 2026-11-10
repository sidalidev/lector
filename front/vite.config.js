import { defineConfig } from 'vite';
import { randomBytes } from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import { createHash } from 'crypto';

const pkg = JSON.parse(readFileSync('../package.json', 'utf-8'));

// Politique de sécurité du contenu, posée en tête de index.html : la même pour
// le web, Capacitor et Electron. Aucun script hors des fichiers de l'app,
// jamais 'unsafe-eval', ni WebAssembly, ni script en ligne.
// - style-src 'unsafe-inline' : styles posés par Preact et CodeMirror.
// - connect-src : serveur de synchro et relais de co-écriture seulement (l'app
//   mobile n'est pas sur son origine). Aucun autre service n'est appelé.
// - frame-src : vidéos YouTube, Vimeo, Rumble citées dans une note ; pages
//   HTML locales intégrées sur ordinateur (lector-local:).
const POLITIQUE = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'blob:', 'https:', 'http:', 'lector-local:'],
  'media-src': ["'self'", 'data:', 'blob:', 'https:', 'http:', 'lector-local:'],
  'font-src': ["'self'", 'data:'],
  'connect-src': [
    "'self'",
    'https://lector.dockerbop.fr',
    'https://lector.sidali.dev',
    // Co-écriture : relais WebSocket (docs/collab-design.md). 'self' couvre la
    // même origine dans les navigateurs récents ; écrit en clair pour les autres.
    'wss://lector.dockerbop.fr',
    'wss://lector.sidali.dev',
  ],
  'frame-src': ['https://www.youtube.com', 'https://player.vimeo.com', 'https://rumble.com', 'lector-local:'],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
  // Service worker de l'app web (sw.js, même origine).
  'worker-src': ["'self'"],
};

// En développement seulement : Vite recharge par websocket ; un nonce tiré au
// démarrage couvre tout script en ligne qu'il ajouterait.
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

// Service worker (src/sw.js) : écrit dans dist/sw.js au build, avec les
// règles de src/utils/swRegles.js et la liste des fichiers du build. Pas de
// dépendance : quelques lignes suffisent pour une coquille en cache.
function serviceWorker() {
  return {
    name: 'lector-sw',
    apply: 'build',
    // Après le plugin HTML de Vite : index.html est alors dans le bundle.
    enforce: 'post',
    generateBundle(_options, bundle) {
      const fichiers = Object.keys(bundle).filter((f) => f !== 'index.html')
      const publics = readdirSync('public')
      const tous = [...fichiers, ...publics].sort()
      // La version change avec le moindre fichier (noms à hash et index.html) :
      // le navigateur voit un nouveau sw.js à chaque déploiement.
      const empreinte = createHash('sha256')
      for (const f of tous) empreinte.update(f)
      const index = bundle['index.html']
      empreinte.update(index ? String(index.source) : '')
      const regles = readFileSync('src/utils/swRegles.js', 'utf-8').replace(/^export /gm, '')
      const corps = readFileSync('src/sw.js', 'utf-8')
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: `const FICHIERS = ${JSON.stringify(tous)};\nconst VERSION = ${JSON.stringify(empreinte.digest('hex').slice(0, 16))};\n${regles}\n${corps}`,
      });
    },
  };
}

export default defineConfig(({ command }) => {
  const nonce = command === 'serve' ? randomBytes(16).toString('base64') : undefined;
  return {
    plugins: [csp(nonce), serviceWorker()],
    // Preact à la place de React (même API par preact/compat, ~40 Ko gzip de
    // moins au démarrage). Le JSX est compilé par esbuild, sans Babel.
    esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
    resolve: {
      alias: [
        { find: /^react$/, replacement: 'preact/compat' },
        { find: /^react-dom$/, replacement: 'preact/compat' },
        { find: /^react-dom\/client$/, replacement: 'preact/compat/client' },
        { find: /^react\/jsx-runtime$/, replacement: 'preact/jsx-runtime' },
        { find: /^react\/jsx-dev-runtime$/, replacement: 'preact/jsx-dev-runtime' },
      ],
    },
    optimizeDeps: { include: ['preact', 'preact/compat', 'preact/hooks', 'preact/jsx-runtime'] },
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    base: './',
    html: { cspNonce: nonce },
    build: {
      outDir: 'dist',
      rollupOptions: {
        output: {
          // Par fonction, pas par liste : une liste range aussi les dépendances
          // communes (React, aides de Vite) dans un morceau lourd, que l'entrée
          // importait alors toujours, même sur la page /d/ d'un invité.
          manualChunks(id) {
            if (id.includes('vite/preload-helper') || id.includes('commonjsHelpers')) return 'vendor';
            if (/node_modules\/(preact|lucide-react)\//.test(id)) return 'vendor';
            // Textes de l'interface : partagés par l'app et la page /d/.
            if (id.includes('/src/services/i18n') || id.includes('/src/locales/')) return 'i18n';
            return undefined;
          },
        },
      },
    },
    server: {
      port: 5173,
      // Les dépendances (polices, KaTeX) sont dans le node_modules de la racine.
      fs: { allow: ['.', '../node_modules'] },
      // API locale derrière /v1 (chaîne et relais de co-écriture, WebSocket compris).
      // LECTOR_API : l'API de test des tests de bout en bout.
      proxy: {
        '/v1': { target: process.env.LECTOR_API || 'http://localhost:3456', ws: true, changeOrigin: false },
      },
    },
  };
});
