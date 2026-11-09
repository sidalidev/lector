import { defineConfig } from '@playwright/test'
import { ENV_TEST, PORT_TEST } from './back-test.js'

export default defineConfig({
  timeout: 30000,
  retries: 0,
  // Démarre l'API de test (:3457) et le front (:5173) automatiquement.
  webServer: [
    {
      // API sur une base SQLite jetable dans back/.test-data/, recréée à chaque
      // lancement. Jamais réutilisée : on veut toujours une base neuve et cet
      // environnement (limites basses, anti-abus coupé).
      command: 'node scripts/serveur-test.js',
      cwd: '../back',
      url: `http://localhost:${PORT_TEST}/v1/health`,
      env: ENV_TEST,
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: 'npx vite --port 5173',
      cwd: '../front',
      // Le proxy /v1 de Vite (WebSocket du partage compris) vise l'API de test.
      env: { LECTOR_API: `http://localhost:${PORT_TEST}` },
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 30000,
    },
  ],
  projects: [
    {
      name: 'api',
      testDir: './api',
      use: {
        baseURL: `http://localhost:${PORT_TEST}`,
      },
    },
    {
      name: 'flows',
      testDir: './flows',
      use: {
        baseURL: 'http://localhost:5173',
        headless: true,
        screenshot: 'only-on-failure',
        browserName: 'chromium',
        // Le Chrome installé sur la machine : pas de navigateur à télécharger.
        channel: 'chrome',
      },
    },
  ],
})
