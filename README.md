# Lector

Lector is a Markdown reader for reading, reviewing and learning: summaries, flashcards, mind maps, music sheets and diagrams, right inside your own `.md` files.

## Principles

- **No account.** No email, no password, no subscription. Nothing to sign up for.
- **End-to-end encrypted sync.** Every document and its path are encrypted on your device (AES-256-GCM) before they leave it. The relay stores encrypted blocks and encrypted paths, plus the metadata it needs to sync them (an identifier for your chain and for each document, sizes, hashes of the encrypted blocks, timestamps, encrypted deletion markers): never the content, the titles or the paths in readable form. The full list is in [PRIVACY.md](PRIVACY.md).
- **No tracking.** No analytics, no ads and no tracking SDK, in the app or on the site.
- **Open source.** The apps and the relay are in this repository.

## Install

- **macOS**: download the [DMG](https://lector.dockerbop.fr/download/Lector.dmg) (universal, signed with an Apple Developer ID, team AFZ3KWB56Q, and notarized by Apple). Once it is copied to Applications, `spctl -a -vv /Applications/Lector.app` should answer `accepted` and `source=Notarized Developer ID`. The app updates itself.
- **Android**: install the APK from [GitHub Releases](https://github.com/sidalidev/lector/releases), or add Lector to [Obtainium](https://apps.obtainium.imranr.dev/redirect?r=obtainium://add/https://github.com/sidalidev/lector). The app also updates itself: it checks a signed manifest on GitHub Releases and asks Android to install the new version. Android 7.0 or later; saving the 12 words to your password manager needs Android 14 or later.
- **iOS**: the App Store release of 2.0 is pending. Until then, build it from source with Xcode (see [CONTRIBUTING.md](CONTRIBUTING.md)). iOS 15 or later.
- **Web**: open [lector.dockerbop.fr/app](https://lector.dockerbop.fr/app/). Nothing to install.

Windows and Linux builds can be made with electron-builder (`npm run dist:win` for Windows, `npm run dist -- --linux` for Linux, since electron-builder otherwise builds for the current platform only) but are not published yet.

## Screenshots

<!-- TODO: add generated light and dark screenshots (desktop and Pixel) before the public release. No mockups. -->

## How sync works

1. Your first device draws a random 128-bit secret and shows it as 12 words (BIP39). Keep them in your password manager or on the printable recovery kit.
2. Every key is derived from that secret on the device: the public id of your storage on the relay, the proof sent with each request, the encryption keys. The secret itself never leaves your devices.
3. Other devices join with the same 12 words (or a QR code, in browsers that can scan one). Only `.md` and `.markdown` files travel; images and other files stay where they are.
4. Each chain gets 20 MB in total, 512 KB per document and 5,000 documents. A chain with no activity for 6 months is deleted from the relay.

The full protocol, with test vectors: [docs/CHAINE.md](docs/CHAINE.md) (in French for now, also served at [lector.dockerbop.fr/sync](https://lector.dockerbop.fr/sync/)). In English: [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) and [PRIVACY.md](PRIVACY.md).

## Security and audit

Audit status: No third-party audit yet; internal review on 2026-10-26 ([docs/security/2026-10-26.md](docs/security/2026-10-26.md), in French).

Exodus Privacy report: pending.

Documents are **not encrypted at rest on your device yet**. On a computer, your vault is a regular folder of Markdown files, protected by your system like any other file. Encryption is about what goes to the relay.

- [SECURITY.md](SECURITY.md): how to report a vulnerability, fingerprints, incident procedure
- [PRIVACY.md](PRIVACY.md): what leaves your device, and why
- [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md): what is protected, and what is not
- [NON_GOALS.md](NON_GOALS.md): what Lector will never do

## If Lector stops

Lector is built so that you can keep your documents without it.

- **Your vault is a folder of plain Markdown files.** On a computer, the folder you sync is readable by any text editor, Obsidian or `cat`. Generated summaries, flashcards and mind maps are written inside the `.md` files themselves.
- **The relay can be self-hosted.** Its code is in `back/` and the production setup (Docker Compose behind a Traefik reverse proxy, nginx for the site and the web app) is in `deploy/`. The web app talks to the relay of the origin it is served from, so a self-hosted web app uses your relay. The desktop and mobile apps point to `lector.dockerbop.fr` for now; a relay address setting is planned.
- **Export.** On a computer, the vault folder is your export, and you can also export a document as PDF or EPUB. On the web and on mobile there is no local vault and no "export everything" yet: the relay may hold the only copy of your documents there, so keep a computer in your chain if you need an offline copy.

## Development

Requires Node.js 22 or later.

```bash
npm ci                 # at the root
npm ci --prefix back   # relay

npm run dev            # front dev server (http://localhost:5173)
npm run start          # Vite + Electron in dev mode
npm run build          # front build into front/dist/
npm run dist           # build + Electron packages (DMG, ZIP)
```

Relay on your machine: copy `back/.env.example` to `back/.env`, then `cd back && npx prisma db push && npm start`.

### Tests

```bash
npm run test:chaine    # chain unit tests (crypto, client, sync, desktop)
npm run test:api       # /v1/chain API against a throwaway test relay (Playwright)
npm run test:flows     # UI flows in the browser (Playwright, uses the installed Chrome)
npm run test           # every Playwright project
```

Playwright starts the test relay and Vite itself (`e2e/playwright.config.js`).

### Mobile

```bash
npm run cap:ios        # build + cap sync ios, then open front/mobile/ios/App/App.xcodeproj
npm run cap:android    # build + cap sync android
```

Mobile: Capacitor 8 (iOS, Android). On iOS, the web bundle updates through a signed OTA (`tools/sign-ota.mjs`). On Android, the whole app updates itself: a signed APK on GitHub Releases with an Ed25519-signed manifest (`tools/release-android.mjs`), checked in the app (signature, SHA-256, certificate, newer version) and installed through the system screen.

Android release signing: the keystore never lives in the repository. Copy `front/mobile/android/keystore.properties.example` to `keystore.properties` (ignored by git) and fill it in. Without it, the release build is not signed.

## Stack

- **Front**: React + Vite, one codebase for the web (PWA), desktop and mobile
- **Desktop**: Electron. macOS is published (DMG, automatic updates)
- **Mobile**: Capacitor 8 (iOS, Android)
- **Relay**: Node + Express + Prisma + SQLite, a blind `/v1/chain` API (encrypted blocks only)
- **Optional AI and voice**: questions use Anthropic (Claude) and reading aloud uses ElevenLabs, with your own API key, kept on the device and called directly from it, never through the relay. On desktop, a locally installed `claude` command-line tool is used first.

Where things live: [ARCHITECTURE.md](ARCHITECTURE.md).

## Contributing and support

- [CONTRIBUTING.md](CONTRIBUTING.md)
- [SUPPORT.md](SUPPORT.md)
- [CHANGELOG.md](CHANGELOG.md)
- [docs/REMOVED.md](docs/REMOVED.md): what 2.0 removed, and why

## License

The apps are under the MIT license ([LICENSE](LICENSE)). The relay in `back/` is under the AGPL-3.0 ([back/LICENSE](back/LICENSE)).

Made by Sid, [sidali.dev](https://sidali.dev). Contact: contact@sidali.dev.
