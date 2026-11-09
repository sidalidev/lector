# Lector threat model

This document says what Lector protects, what it does not, and against whom. Every statement describes the code in this repository as it is today. When something is planned but not built, it says so.

Related documents: the privacy policy (`PRIVACY.md`), the record of server data (`docs/legal/REGISTRE.md`) and the vulnerability policy (`SECURITY.md`). The full sync specification (`docs/CHAINE.md`) and the notes on document rendering and disk access (`docs/SECURITE.md`) are in French for now; this document summarises what they say.

## 1. Summary

- Lector is a Markdown reader. It works without an account and without a network. Sync between devices is optional.
- Sync uses a **sync chain**: a 128-bit secret drawn on one of your devices, written as 12 words (BIP39). All keys are derived from it on the device. The relay stores only blocks it cannot decrypt.
- **Protected**: the content, titles, file names and folder paths of the Markdown files you sync, against the relay, its host and anyone who gets a copy of its disk or backups.
- **Not protected**: the documents on your device (they are plain files, not encrypted at rest by Lector), the metadata the relay sees (chain identifier, sizes, times, IP address of each request), a device that is already compromised, and text you send yourself to an AI or voice provider.
- On the web, the app is downloaded from the server at every visit: you trust that server each time. The desktop and mobile apps are the trusted clients.

## 2. What Lector has to protect

| Asset | Where it lives |
|---|---|
| Your Markdown documents | Plain files in your vault folder (desktop). In the relay as encrypted blocks when sync is on. In the browser or mobile app, decrypted in memory while you read them. |
| The chain secret `S` (12 words) | Desktop: `userData/cloud-secrets.dat`, encrypted with the system keychain through Electron `safeStorage` when available. Web and mobile: never stored; only non-exportable `CryptoKey` objects and the proof are kept in IndexedDB. Your password manager or printed recovery kit, if you saved it there. |
| API keys (Anthropic, ElevenLabs) | Desktop: `userData/api-keys.dat` through `safeStorage`. Web and mobile: IndexedDB, encrypted with a non-exportable key stored in the same database. |
| Highlights, flashcards, reading positions, settings | Desktop: inside the `.md` file (`<!-- lector-generated -->` block) and in the page storage. Web and mobile: browser storage of the app. |

## 3. What is protected

### 3.1 Document content on the relay

Each synced file is encrypted on the device with AES-256-GCM before upload (`front/src/services/chaine/crypto.js`). Keys come from `S` through HKDF-SHA256; they never leave the device. The relay stores:

- the content as an envelope `version ‖ IV ‖ ciphertext ‖ tag`, bound to its document identifier by the additional authenticated data;
- the path, encrypted the same way, with a different AAD, so the relay cannot swap a path and a content;
- a document identifier `docId = HMAC-SHA256(K_mac, path)`, which reveals nothing about the path without the key.

The relay, its host (Hetzner), an intruder on the machine and anyone holding a server backup get ciphertext only. They cannot read, forge or modify a block without the clients detecting it, move a block from one document to another, or make a client delete a local file (deletion markers are themselves encrypted and checked before any local deletion, `front/src/services/chaine/synchro.js`).

### 3.2 Only Markdown travels

Clients send only `.md` and `.markdown` files of at most 512 KB of plaintext each. Images, PDFs and other files never leave the device through sync. Hidden files and folders are skipped.

### 3.3 Access to a chain

Every request carries the chain identifier and a proof `P`, both derived from `S` by HKDF. The relay stores only `SHA-256(P)`. Without the right proof, every route refuses and reveals neither the size of the chain nor anything it holds. It does reveal whether a known identifier exists (404 for an unknown chain, 403 for a wrong proof); identifiers are 128-bit values derived from `S`, so they cannot be guessed. Wrong proofs are rate limited per (IP, chain) pair, never per chain alone, so a stranger who knows an identifier cannot lock out its owner.

### 3.4 What the 12 words are never exposed to

`S` is never sent to the relay, never logged, never placed in a URL, and the app never copies it to the clipboard. The QR pairing code is not a web address, so a phone camera does not open it in a browser.

## 4. What is not protected

### 4.1 Documents on your device

**Lector does not encrypt your vault at rest.** On desktop, your documents are ordinary `.md` files in a folder you chose; your operating system protects them like any other file (account password, disk encryption such as FileVault or BitLocker if you turned it on). On web and mobile, documents are fetched from the relay and decrypted in memory; app data (highlights, settings, keys) lives in the browser storage of the app. The About screen says so. Local encryption is planned, not built.

Consequence: anyone who can read your disk or your unlocked session can read your documents. "Erase everything" deletes the chain and the local keys, and on desktop can move the vault folder to the system Trash, but it does not securely wipe files.

### 4.2 Metadata the relay sees

The relay cannot read your documents, but it sees, for each chain:

- the chain identifier (a value derived from `S`, stable for the life of the chain) and the hash of the proof;
- for each document: its `docId`, the size of the block (file size plus 29 bytes), the size of the encrypted path (not padded), the modification time sent by the client, upload and deletion times;
- the number of documents, the space used, the rhythm of writes, the creation date of the chain and its last activity (to the hour);
- the IP address of each request. The API keeps it in memory for rate limiting and stream limits and never writes it to disk. The reverse proxy (Traefik) writes it to its access log with the request path, which for document requests contains a `docId`. Because the database maps each `docId` to its chain, **whoever operates the relay can link an IP address to a chain for as long as the proxy log is kept** (today 7 days, and copies may sit in server backups until they expire; see `docs/legal/REGISTRE.md`, line 1 and Known gaps);
- a random per-installation identifier (`X-Lector-Device`) used only to tag live update events; it is not stored.

Sizes are not padded and identifiers do not rotate. Rotating identifiers and padded sizes are not built.

### 4.3 The web client trusts the server at every load

The web app at `lector.dockerbop.fr/app/` is HTML and JavaScript served by the same operator that runs the relay. A modified bundle could read the documents you open, use the chain keys stored in the page, or read your API keys. Nothing in the browser can detect that. There is no subresource integrity and no published bundle hash yet.

Use the desktop or mobile apps when this matters to you. Their code is fixed at install time and changes only through signed updates (§ 4.6). The web app is a convenience.

### 4.4 A compromised device

Malware on a device of the chain, someone with your unlocked session, or a hostile browser extension sees what you see: plaintext documents, and on web the chain keys and API keys usable in place. A device that was compromised while in the chain should be treated as having leaked `S`. "New chain" (desktop) re-encrypts everything under a new secret and deletes the old chain from the relay; it cannot recall what the device already copied.

### 4.5 Text you send to a provider

Summaries, mind maps, flashcards, chat and text to speech send the text concerned directly from your device to Anthropic or ElevenLabs, with your own API key, over HTTPS. This is not end-to-end encrypted: the provider reads it, under its own privacy policy. On desktop, if the Claude command line tool is installed, Lector can use it instead, and it follows that tool's own settings. Lector's relay is never on that path.

### 4.6 Updates

| Platform | How an update is checked |
|---|---|
| Android | Signed manifest from GitHub Releases. The Ed25519 signature, the APK SHA-256, the package name, the version and the signing certificate must all match before the system install screen appears (`AppUpdatePlugin.java`). |
| iOS | The web bundle is downloaded from `lector.dockerbop.fr/api/` and refused unless its Ed25519 signature is valid (`OTAUpdatePlugin.swift`). |
| macOS | `electron-updater` from `lector.dockerbop.fr/releases/`; the app is signed with a Developer ID (published builds are meant to be notarized; `SECURITY.md` says how to check a copy), and the macOS update framework refuses an update that is not signed by the same developer. |
| Windows, Linux | `electron-updater` checks the file against a SHA-512 listed by the same server: this detects corruption, not a compromised server. |
| Web | No update mechanism: every load is a fresh download (§ 4.3). |

The signing keys are held by the developer. Reproducible builds and signed build provenance are not in place yet.

### 4.7 Content loaded by a document

A document can point to remote images, embedded videos (YouTube, Vimeo, Rumble) or score sounds (`paulrosen.github.io`, `surikov.github.io`). When the document is shown, or the score is played, these are fetched from the third party, which sees your IP address. The HTML of documents is sanitized and scripts never run in the app's origin.

### 4.8 Server backups

The server is backed up automatically. Backups contain the encrypted blocks and the metadata of § 4.2, never `S` or the keys. Encrypted blocks of a deleted document, an erased chain or an old chain after "New chain" stay in backups until they expire: up to 30 days on the server and up to 6 months for monthly archives. The backup setup is server configuration, outside this repository. They remain readable by whoever still holds the old 12 words.

### 4.9 A leaked proof

Someone who obtains `P` but not `S` (for example by reading request headers on a compromised network path) can write, delete or erase blocks of the chain. They cannot read them, and clients detect forged blocks and forged deletion markers. Your devices keep their local files.

### 4.10 Rollback by the relay

The relay can hide a document, refuse a write, or serve an older version of a block. There is no authenticated manifest against rollback yet.

### 4.11 Writing together

A shared document has its own 256-bit key, unrelated to the chain, carried in the fragment of the invitation link (`/d/<room>#<key>`), which browsers never send. The relay sees a room identifier derived from that key, the hash of a proof, encrypted messages (sizes padded to 64 bytes, timing visible), how many people are connected, and their IP addresses in memory. It cannot read, forge or move messages between rooms; it can drop them or replay old ones (harmless: Yjs updates are idempotent).

Not protected: everyone who has the link is a full co-author (read, write, erase); there is no read-only link and no way to remove one person except stopping the share for everyone; a leaked link is a leaked document; the key is stored unencrypted in the browsers that opened it; the shared page is web code served by Lector's server (§ 4.3). Details: [collab-design.md](collab-design.md).

## 5. Adversaries

| Adversary | Can | Cannot |
|---|---|---|
| Relay operator, hosting provider, intruder on the server, holder of a backup | See the metadata of § 4.2; link an IP address to a chain while proxy logs exist; delete, hide, refuse or roll back blocks; serve a modified web app (§ 4.3) | Read content, paths or titles; forge or alter a block undetected; obtain `S`; make a client delete a local file |
| Network observer (Wi-Fi, ISP) | See that you talk to `lector.dockerbop.fr`, when and how much (TLS hides the rest) | Read headers, the proof or the blocks, unless TLS itself is broken |
| Someone who knows a chain identifier only | Learn whether that chain exists (404 or 403); nothing else, and wrong proofs never lock out the owner | Read, write or learn the size of the chain |
| Someone who has the proof only | Write, delete or erase the chain | Read anything |
| Someone who has the 12 words, the QR or the recovery kit | Everything: read, write, erase, start a new chain | |
| Thief of a locked device | What the operating system lets through (Lector adds no local encryption) | Unlock the system keychain without your session (desktop secret, API keys) |
| Malicious document | Load remote images and embedded players (§ 4.7) | Run a script in the app's origin; read outside the folders you opened (desktop) |
| Compromised update channel | Web: anything (§ 4.3). Windows and Linux desktop: ship a modified build | Android, iOS, macOS: install an update without the developer's signing key |
| Future quantum computer | See § 6 | |
| Legal request to the operator | Obtain what the relay holds: metadata of § 4.2, encrypted blocks, proxy logs while they exist | Obtain content, `S` or keys: the operator does not have them |

## 6. Post-quantum position

**The end-to-end encryption of documents is purely symmetric.** There is no asymmetric key exchange anywhere in the sync protocol: `crypto.js` uses only HKDF-SHA256, HMAC-SHA256 and AES-256-GCM, and every device derives the same keys from the same `S`. The 12 words are entered by the user on each device; they never cross the network.

Consequences:

- **No "harvest now, decrypt later" risk on document content.** Recording the encrypted blocks today and breaking an elliptic curve or RSA key later does not help, because the blocks are not protected by one. Shor's algorithm does not apply to AES, HMAC or HKDF.
- Grover's algorithm in theory halves the effective bit strength of a brute-force search. The content key is 256 bits, but all keys come from the 128-bit `S`, so a quantum search for `S` would in theory need on the order of 2^64 sequential quantum evaluations. This is generally regarded as out of reach, and 128-bit symmetric security is NIST's lowest post-quantum security category (category 1).
- **TLS is not post-quantum here.** HTTPS between your device and the relay uses whatever key exchange the client and the proxy negotiate, which today may be classical. Someone who records that traffic and later breaks it would see request metadata and the proof `P` of that time (§ 4.9), still not the content, which stays AES-GCM inside.
- **Requests to AI and voice providers** rely only on TLS. Recorded today, they could be read later by an adversary who breaks the key exchange that was used.
- **Update signatures use Ed25519**, which a large quantum computer could forge. That would allow a forged update only at the time such a computer exists, not retroactively. A move to a post-quantum or hybrid signature will be considered when it is supported by the platforms Lector targets.

## 7. Abuse

Lector has no accounts, so the relay cannot know who stores what, and it cannot read what is stored. The design limits what an abuser gets:

- **Small quota**: 20 MB per chain, 512 KB of plaintext per document, 5,000 documents. Creation is limited to 5 chains per IP address per hour (a /64 for IPv6), and the server holds 10,000 chains at most.
- **Text only**: clients send only Markdown. The relay rejects blocks that do not look encrypted (wrong version byte, valid UTF-8 or low entropy), as a guard against buggy clients.
- **No public link**: no route serves a block without the chain's proof. There is no share URL, no directory and no search. Content in a chain is visible only to people who hold its 12 words.
- **No sharing ring**: a chain is meant for the devices of one person, which read from a handful of networks a day (a computer, a phone whose address changes on mobile data, the Wi-Fi of a workplace). For each chain the relay counts, in memory only, the distinct networks that read from it over a sliding 24-hour window. A network is the address prefix (/24 for IPv4, /48 for IPv6), kept only as a salted HMAC-SHA256 hash; the random salt is replaced every 24 hours, after which a hash no longer links to any network. Only requests with the right proof are counted, so nobody can use up a chain's budget without its 12 words. Beyond 8 distinct networks in 24 hours, reads from a new network get `429 CHAIN_READ_LIMITED`; networks already seen keep working. Nothing of this is written to disk or to the logs, and a restart forgets it (`back/services/reseauxLecteurs.js`, threshold `CHAIN_READ_NETWORKS_MAX`). Handing the 12 words to strangers therefore stops working after a few of them, while the 20 MB quota and 512 KB per document stay sized for one person's notes.
- **Removal on report**: reports go to `contact@sidali.dev` (also published in `/.well-known/security.txt`). The operator cannot inspect content, so a report must identify the chain (its identifier, which anyone holding the 12 words can derive: HKDF-SHA256 of `S` with the info `lector-id`, written as 32 hex characters, see `front/src/services/chaine/crypto.js`). Never send the 12 words themselves. The operator deletes the chain with `back/scripts/supprimer-chaine.js`, which shows the chain's dates and sizes, asks to retype its short identifier, then deletes the chain row, its document rows and its folder of blocks. Encrypted copies remain in backups until they expire (§ 4.8).
- **Inactive chains** with no request for 180 days (about 6 months, `CHAIN_INACTIVE_DAYS`) are deleted automatically, with all their blocks.

## 8. Cyber Resilience Act

Regulation (EU) 2024/2847 applies to products with digital elements made available on the EU market in the course of a commercial activity. Lector is free software, distributed free of charge, with no paid features, no in-app purchases, no ads and no use of personal data for profit. The relay is operated free of charge as part of that non-commercial project.

**Conclusion: Lector is outside the scope of the CRA as long as it stays non-commercial.** This conclusion must be reviewed if Lector ever charges for the app, for sync or for support, or is monetised in any other way. Vulnerability reports are handled as described in `SECURITY.md` regardless.

## 9. Not built yet

Stated here so that nobody assumes otherwise:

- encryption of the local vault at rest, and automatic locking;
- the chain secret in a hardware keystore on Android and iOS (today: non-exportable WebCrypto keys in IndexedDB);
- "New chain" on web and mobile (desktop only today);
- padded sizes and rotating identifiers;
- an authenticated manifest against rollback;
- reproducible builds, signed build provenance, published bundle hashes;
- an independent security audit. The last review was internal, on 2026-10-26 (`docs/security/2026-10-26.md`, in French).

## 10. Reporting a vulnerability

Write to `contact@sidali.dev`. See `SECURITY.md`.
