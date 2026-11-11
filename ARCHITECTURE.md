# Architecture

One codebase for every platform (React components running on Preact through `preact/compat`), a few thin native wrappers, and a blind relay.

## Map

```
front/                     everything the user sees
├── src/                   the app (the only UI code: web, desktop, mobile)
│   ├── components/        screens and panels (ChaineSync.jsx is the Sync screen)
│   ├── services/chaine/   sync chain: crypto.js, client.js, synchro.js, web-vault.js
│   ├── services/collab/   writing together: crypto.js (document key), salon.js (Yjs client), partage.js
│   ├── components/collab/ shared document page (/d/), Share panel
│   ├── services/          file access, tasks and reminders (taches/), outgoing flows list, updates
│   └── locales/           interface text (en.js)
├── desktop/               Electron: main.js, preload.js, sync-manager.js, vault/
├── mobile/                Capacitor wrappers: android/ (update, password manager plugins), ios/
└── landing/               static site: privacy policy, sync/ (protocol page)
back/                      relay: Express + Prisma + SQLite, routes/chain.js, services/ (collab/: WebSocket relay)
e2e/                       Playwright: api/, flows/, chaine/ (end-to-end chain scenarios)
docs/                      protocol (CHAINE.md), test vectors, security reviews
deploy/                    Docker Compose and nginx as on the server, deploy.sh (web app, site, API on request)
tools/                     release signing (sign-ota.mjs, release-android.mjs), sync page generator
lector-vscode/             VS Code extension: Lector-style Markdown preview
```

## Invariants

These hold everywhere. A change that breaks one is a bug.

1. **The relay never sees plaintext.** Content, paths and deletion marks are encrypted with AES-256-GCM on the device before upload. Shared documents too: text, names and cursors are encrypted with a per-document key that lives only in the invitation link and on the devices. The relay stores opaque ids, encrypted blocks, sizes and dates. The chain secret and the 12 words never leave the devices; the relay only knows the public chain id and the SHA-256 of the proof.
2. **The vault is the source of truth.** On a computer, the vault is a folder of plain Markdown files on disk; the relay is a mailbox between devices, never the reference. Sync never follows a symbolic link, never writes outside the vault, and keeps a conflict copy instead of overwriting.
3. **Markdown only.** Only `.md` and `.markdown` files travel. Other files are never read, sent or deleted by sync. Hidden files and folders are skipped.
4. **Nothing is deleted silently.** A remote deletion removes a local file only if it is unchanged and its authenticated deletion mark (encrypted with the chain key) verifies. Adopting a chain never deletes anything.
5. **No account, no tracking.** No user table, no license, no analytics. Logs never contain a proof, a path, a body, an IP address or a full chain id.

Known gap: on the web and on mobile there is no local vault yet. Documents are read from the relay and decrypted on the fly, so the relay holds the only copy there.

## Where to start

- How sync works: [docs/CHAINE.md](docs/CHAINE.md), then `front/src/services/chaine/crypto.js` (derivations and envelope) and `synchro.js` (three-way sync).
- The relay: `back/routes/chain.js`, then `back/services/chaine.js` (quota) and `back/services/casiers.js` (purge).
- Writing together: [docs/collab-design.md](docs/collab-design.md), then `front/src/services/collab/salon.js` and `back/services/collab/relais.js`.
- Desktop: `front/desktop/sync-manager.js` and `front/desktop/vault/vault.js`.
- The UI: `front/src/App.jsx`, then the component you care about.
- Tests: `npm run test:chaine` is fast and needs no browser; start there.
