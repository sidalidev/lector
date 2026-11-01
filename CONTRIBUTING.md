# Contributing to Lector

```bash
npm ci && npm run dev
```

That is all you need to run the app in your browser at http://localhost:5173 (Node.js 22 or later). The demo content works without a relay.

## Run everything

```bash
npm ci --prefix back   # relay dependencies (needed for the API tests and a local relay)
npm run start          # Vite + Electron in dev mode
```

Local relay: copy `back/.env.example` to `back/.env`, then `cd back && npx prisma db push && npm start` (port 3456).

## Tests

Run these before opening a pull request:

```bash
npm run test:chaine    # chain unit tests: crypto, client, sync, desktop (node --test, no browser)
npm run test:api       # /v1/chain API against a throwaway test relay (Playwright)
```

`npm run test:flows` runs the UI flows in the browser; it uses the Chrome installed on your machine. Playwright starts the test relay (port 3457, throwaway SQLite database in `back/.test-data/`) and Vite on its own.

## Mobile builds

- iOS: Xcode, then `npm run cap:ios` and open `front/mobile/ios/App/App.xcodeproj`.
- Android: JDK 21 and the Android SDK, then `npm run cap:android` and `cd front/mobile/android && JAVA_HOME=$(/usr/libexec/java_home -v 21) ./gradlew assembleDebug`. A release build needs your own `keystore.properties` (see `keystore.properties.example`); signing keys never go in the repository.

## Rules

- **One change per pull request**, with a test that fails before and passes after when it fixes a bug.
- **The relay must never see plaintext.** Anything that sends content, a path, a title or the chain secret to the server is refused. See [ARCHITECTURE.md](ARCHITECTURE.md) for the invariants.
- **No tracking, no analytics, no new third-party service.** No new dependency without a short reason in the pull request.
- **Never log secrets**: no chain secret, proof, words, API key, path or document content in logs.
- **Interface text in English**, in `front/src/locales/en.js`. Short, plain sentences.
- **Commit messages in English**, imperative mood, one line that says what changes for the user (for example "Lower the per-document sync limit to 512 KB").
- **Check [NON_GOALS.md](NON_GOALS.md)** before proposing a feature.
- Security issues go through [SECURITY.md](SECURITY.md), never a public issue.

By contributing, you agree that your contribution is released under the license of the part you change: MIT for the apps, AGPL-3.0 for the relay in `back/`.
