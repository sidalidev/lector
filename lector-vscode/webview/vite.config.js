import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: '../dist/webview',
    emptyOutDir: true,
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks: {
          mermaid: ['mermaid'],
          d3: ['d3'],
          codemirror: [
            '@codemirror/view',
            '@codemirror/state',
            '@codemirror/language',
            '@codemirror/lang-markdown',
            '@codemirror/language-data',
          ],
        },
      },
    },
  },
});
