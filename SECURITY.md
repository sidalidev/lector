# Security policy

Audit status: No third-party audit yet; internal review on 2026-10-26 ([docs/security/2026-10-26.md](docs/security/2026-10-26.md), in French).

## Reporting a vulnerability

Please report privately, never in a public issue or discussion:

- **GitHub private vulnerability reporting**: the "Report a vulnerability" button in the [Security tab](https://github.com/sidalidev/lector/security) of this repository (preferred).
- **Email**: contact@sidali.dev, with "Lector security issue" in the subject.

The same address is published in `/.well-known/security.txt` on lector.dockerbop.fr and lector.sidali.dev (RFC 9116).

Include what an attacker can do, the steps to reproduce, and the platform and version (desktop, web, Android or iOS) or commit.

What happens next:

- you get an answer within 7 days;
- once the issue is confirmed, you get an estimate for the fix, and news at least every 14 days until it ships;
- you are credited in the advisory if you wish.

Lector is maintained by one person, Sid ([sidali.dev](https://sidali.dev)). There is no bug bounty.

## Reporting abuse

If a sync chain is used to pass content around (for example its 12 words posted publicly), write to contact@sidali.dev with "Lector abuse report" in the subject. The same address is in `/.well-known/security.txt` on both domains (served by `back/routes/securityTxt.js`).

The relay cannot read what a chain holds, so the report must identify the chain by its identifier: 32 hex characters derived from the 12 words (HKDF-SHA256 of the chain secret with the info `lector-id`, see `front/src/services/chaine/crypto.js`). Never send the 12 words themselves.

The operator then deletes the chain with `back/scripts/supprimer-chaine.js`, which shows the chain's dates and sizes, asks to retype its short identifier, and deletes the chain, its document rows and its encrypted blocks. Encrypted copies remain in server backups until they expire. Independently of reports, a chain read from more than 8 different networks in 24 hours refuses reads from new networks, and a chain with no request for 180 days is deleted (see [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md), section 7).

## Scope

In scope:

- the sync relay (`back/`) or a network attacker reading, forging, moving or replaying documents, paths or deletion markers without the client detecting it (beyond the limits listed below);
- anyone joining a sync chain without its 12 words or pairing code;
- the 12 words, the chain secret or a user's API key leaving the device, or reaching the relay, a log, a URL or the clipboard;
- the relay logging a full chain id, a chain proof, a request body or an IP address in its own output;
- a Markdown document running a script inside Lector, or reaching files outside the folders the user opened (desktop);
- the update channels installing code that is not signed by the release keys below;
- anything that survives "Erase everything" on the relay (outside its encrypted backups, kept for the period the privacy policy states) or in the app's storage.

Out of scope, because it is the design and is documented:

- what the relay can see: chain id, document count and sizes, dates, write rhythm, and IP addresses in passing (see [PRIVACY.md](PRIVACY.md) and [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md), section 4.2);
- the relay hiding a document, refusing a write or serving an older version of a block: there is no authenticated manifest against rollback yet;
- **the local vault is not encrypted at rest**: documents are plain Markdown files on the device, readable by anyone or any program with access to that disk or that browser profile;
- on the web and in the mobile web views, a script running in the page could use the chain keys in place (they are not exportable) and read API keys; Lector's Content Security Policy and document sanitizing exist to prevent that script from running ([docs/THREAT_MODEL.md](docs/THREAT_MODEL.md), section 4.7), and a way around them is in scope;
- the web app at lector.dockerbop.fr/app/ is served by Lector's server on each visit, so it trusts that server for its code; the desktop and mobile apps do not;
- someone who already holds the 12 words, or a compromised device;
- denial of service by the relay operator, and volumetric attacks on the server.

## Release signing

### Android

Android APKs published on [GitHub Releases](https://github.com/sidalidev/lector/releases) (and installed through Obtainium) are signed with this certificate, the same for every version:

```
SHA-256: 3A:E2:08:E2:8C:15:17:3D:5D:FF:1A:43:3C:73:FA:A2:61:57:56:1F:8D:A5:41:1D:6A:53:EB:39:C4:EB:AE:BD
```

Check a downloaded APK with `apksigner verify --print-certs lector-<version>.apk`: the `certificate SHA-256 digest` line must match the value above (without the colons, in lowercase).

Builds distributed through Google Play are signed with a different certificate, so a Google Play install and a GitHub install cannot update each other: Android refuses an update signed by another key. Pick one source and stay with it. The keys, their roles and how they are rotated are listed in [docs/security/CLES.md](docs/security/CLES.md).

### Update manifests (Android and iOS)

The Android in-app updater and the iOS web bundle updater accept a manifest only if it carries a valid Ed25519 signature from the release key. Its public key, embedded in `front/mobile/android/app/src/main/java/com/lector/app/AppUpdatePlugin.java` and `front/mobile/ios/App/App/OTAUpdatePlugin.swift`:

```
Public key (raw 32 bytes, base64): YsRwje0BMU6Cx2hKZmtYMqbaxDglgAB6bJ61URROnGU=
SHA-256 of the raw key:            97c723302827ad3191e490dcb70e4f5328d1d53795ef47e4b24bb5b2581670bc
```

Recompute the fingerprint with:

```sh
echo 'YsRwje0BMU6Cx2hKZmtYMqbaxDglgAB6bJ61URROnGU=' | base64 -d | shasum -a 256
```

- Android: the manifest is fetched from GitHub Releases; the APK is then refused unless its SHA-256, package name, version code and signing certificate match the manifest and the installed app. Installing always goes through the system confirmation screen.
- iOS: the manifest is fetched from lector.dockerbop.fr; the web bundle is installed only if its SHA-256 matches the signed manifest.

The private key never enters the repository (`tools/sign-ota.mjs` reads it from the release machine).

### Desktop

The macOS app is signed with an Apple Developer ID (team `AFZ3KWB56Q`). Published builds are meant to be notarized by Apple; check your installed copy with `spctl -a -vv /Applications/Lector.app`, which should answer `accepted` and `source=Notarized Developer ID`, and with `codesign -dv /Applications/Lector.app`, which should show `TeamIdentifier=AFZ3KWB56Q`. A build made from this repository without Apple credentials is signed but not notarized (`front/desktop/build/notarize.js` warns, and refuses during `npm run release`). The Windows and Linux builds are not code signed yet. Desktop updates come from lector.dockerbop.fr/releases through electron-updater.

## Incident response

When a vulnerability is confirmed, or a key, the relay or a release is compromised:

1. **Within 72 hours** of confirmation: a GitHub Security Advisory on this repository saying what is affected, what users should do and what is known so far, and a notice on lector.dockerbop.fr. The apps cannot display a message sent from the server: users get the fix through the automatic update of the next release.
2. Fix, release, and rotate any exposed key. A rotated update key means a new app release that embeds the new public key, and an update of this file.
3. **Within 14 days** of the fix: a post-mortem in [docs/security/incidents/](docs/security/incidents/) (timeline, cause, impact, what changes so it does not happen again).
4. **Once a year**: a dry run of this procedure on a fictional incident, recorded in the same folder.

## Reviews

Security reviews are kept in [docs/security/](docs/security/).
