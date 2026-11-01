# Privacy

Lector is a free Markdown reader made by Sid (https://sidali.dev). This page says, in plain words, what leaves your device and what happens to it. The detailed record, with legal bases, is in [`docs/legal/REGISTRE.md`](docs/legal/REGISTRE.md). The website version is at https://lector.dockerbop.fr/privacy.

## The short version

- No account. No email, no password, no profile.
- No analytics, no crash reports, no ads, no cookies, no third-party SDK.
- Your documents stay on your device unless you turn on sync.
- Sync is end-to-end encrypted: our server stores blocks it cannot read.
- Your documents are **not** encrypted on your device by Lector. Your system protects them like any other file.

## Sync (optional)

When you create a sync chain, your device draws a secret and shows it as 12 words. Every key comes from those words, on your device. We never receive the 12 words or the keys, and we cannot recover them for you.

Only Markdown files travel. Each file and its path are encrypted on your device (AES-256-GCM) before upload.

**What our server sees:**

- a chain identifier, derived from your 12 words, and a hash (SHA-256) of the proof your devices send with each request;
- for each document: an opaque document identifier (an HMAC of its path, unreadable without your keys), the encrypted path, the encrypted block and its SHA-256 hash, the size of the block and of the encrypted path, the modification time sent by your device, when it was last updated on the server, when it was deleted, and an encrypted deletion marker;
- how many documents you have and how much space they use;
- a random identifier drawn by each installation (`X-Lector-Device` header), sent with sync requests so that a device can ignore its own changes in the live update stream. The relay holds it in memory only and never stores it;
- when the chain was created and last used (to the hour);
- the IP address of each request. The relay uses it in memory to limit abuse and never writes it to its database or its own logs. To stop a chain from being used to share files between strangers, it also counts how many different networks read each chain over the last 24 hours, using only a hash of the network prefix with a random key replaced every day; this count stays in memory and is never written down. The reverse proxy in front of it writes every request (IP address, time, address requested, status) to an access log, kept 7 days today. Document requests name the opaque document identifier, which the database links to its chain, so while that log exists, whoever runs the server could connect an IP address to a chain. Copies of this log may also be in the server backups below until they expire. Reducing this (errors only, 3 days, no log in backups) is planned, not done.

**What our server never sees:** the content of your documents, their titles, file names or folders, your 12 words, your keys.

**How long:** a deleted document leaves an encrypted deletion marker for 30 days, so your other devices remove it too. A chain with no activity for 180 days (about 6 months) is deleted with everything in it. "Erase everything" in the app deletes your chain from the server immediately.

**Backups:** the server is backed up automatically. Backups hold the encrypted blocks and the metadata above, never your 12 words or keys. They are kept up to 30 days on the server, and monthly archives up to 6 months off site. An erased chain can stay in these backups, still encrypted, until they expire. The backup setup is server configuration, outside this repository.

**Where:** a server rented from Hetzner in Germany. Off-site backup copies are kept on the developer's computer (France) and in Apple iCloud Drive.

## Features that talk to someone else

Only when you use them, directly from your device, never through our server:

| Feature | Goes to | What they get |
|---|---|---|
| AI features (summaries, flashcards, chat...), with your own API key | Anthropic (`api.anthropic.com`) | The text concerned. Not end-to-end encrypted: Anthropic reads it, under [its privacy policy](https://www.anthropic.com/legal/privacy). |
| Text to speech, with your own API key | ElevenLabs (`api.elevenlabs.io`) | The text read aloud, under [its privacy policy](https://elevenlabs.io/privacy-policy). |
| A video embedded in a document | YouTube, Vimeo or Rumble | Your IP address and the video. |
| An image in a document that points to another website | That website | Your IP address and the image. |
| Playing a music score | `paulrosen.github.io`, `surikov.github.io` (GitHub Pages) | Your IP address and the sound files. |
| Importing a YouTube transcript (desktop) | YouTube | Your IP address and the video. |
| "Search the web" (desktop menu) | Google, in your browser | The selected text. |

Your API keys stay on your device. On desktop they are encrypted with the system's secure storage when available (otherwise kept in a file only your user account can read, and the app says so). On web and mobile they are encrypted with a non-exportable key in the browser storage; any script running on the page could use them, so add them only on a device you trust.

## Updates

- Desktop and iOS apps ask `lector.dockerbop.fr` for updates. The Android app asks GitHub (`github.com`). These requests carry no identifier.
- The web app is downloaded from our server at each visit.

## The website

No analytics, no cookies, nothing loaded from other websites. The reverse proxy access log described above (IP address, page, time) also covers the website and is kept 7 days today, for security. The web server keeps no access log of its own, but its error log can record the IP address of a failed request; it is kept in the server's container log until that log is rotated.

## On your device

Lector stores your preferences, reading progress, highlights, sync state and API keys on your device. On desktop, the sync secret and API keys are encrypted with the system's secure storage when available. On web and mobile, the 12 words are never kept: only non-exportable encryption keys.

## Deleting your data

Open **Sync**, choose **Erase everything**. The chain and every encrypted block are deleted from the server at once, for all your devices; encrypted copies remain in backups until they expire. On web and mobile the server may hold the only copy of your documents. Because there is no account, we cannot find your data from your name or email: erasing is done from a device of the chain.

## Children

Lector is not directed at children under 13. We do not knowingly collect information about children.

## Contact

contact@sidali.dev. You can also complain to the CNIL (France).

## Changes

This page changes when the code changes. See the history of this file.
