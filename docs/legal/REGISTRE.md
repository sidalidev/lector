# Record of processing (server side)

This is the record of every piece of data that reaches a server operated for Lector: what it is, why, on what legal basis, for how long, who hosts it and where. It is the source for `PRIVACY.md`, the website privacy page (`front/landing/privacy.html`) and the "What leaves your device" list in the app (`front/src/services/fluxSortants.js`). If one of them changes, this file changes first.

Each line was checked against the code of this repository (`back/`, `deploy/`, `front/`). Server configuration that lives outside the repository is marked as such.

## Controller

- **Who**: Sid, individual developer, France. Website: https://sidali.dev
- **Contact** (privacy, abuse, security): contact@sidali.dev
- **Supervisory authority**: CNIL (France), https://www.cnil.fr

## What is never collected

No account, no email address or name, no password, no analytics, no crash reports, no advertising or hardware identifiers (the only identifier tied to an installation is the random one of line 6, never stored), no cookies, no contact list, no location. The app has no third-party SDK that sends data. The relay never receives the 12 words, the encryption keys or the plaintext of a document.

## Servers

| Server | Role | Host | Country |
|---|---|---|---|
| `lector.dockerbop.fr` (also answers on `lector.sidali.dev`) | Sync relay (`back/`), website, web app, desktop and iOS update files | Hetzner Online GmbH, VPS (hosting contract, outside this repository) | Germany |

Both the relay (`lector-api`) and the web server (`lector-landing`) sit behind the Traefik reverse proxy of the same machine (`deploy/docker-compose.yml`).

## Processing

| # | Data | Where it is kept | Purpose | Legal basis (GDPR) | Retention | Processor, country |
|---|---|---|---|---|---|---|
| 1 | IP address, date, method, path, status code, response size and duration of every request (successes included). Request headers are not configured to be kept (Traefik drops them by default; to be confirmed on the server), so normally neither the chain proof, the chain identifier nor the user agent. For document requests the path contains a `docId`. | Traefik access log (server configuration, outside this repository) | Security of the server, investigating attacks and errors | Legitimate interest, art. 6(1)(f): protecting the service | Today: 7 days, then deleted by log rotation; copies may also be in server backups (line 10). Target: errors only, 3 days, excluded from backups (Known gaps 1 and 4). | Hetzner, Germany |
| 2 | IP address (IPv6 reduced to its /64) | Memory of the relay process only, never written to disk (`back/services/limiteurs.js`, `back/services/fluxChaine.js`) | Rate limits: 5 chain creations per hour per address, 10 wrong proofs per 15 minutes per (address, chain); at most 10 live streams per address | Legitimate interest, art. 6(1)(f): preventing abuse without accounts | Counted over 1 hour (creations) or 15 minutes (wrong proofs); a stale entry can remain in memory until the process restarts or 10,000 newer entries push it out. Stream counters exist while the stream is open. | Hetzner, Germany |
| 2b | Hash of the network prefix of a request (IPv4 /24, IPv6 /48), salted with a random key held in memory and replaced every 24 hours, with the time of its last read, per chain identifier | Memory of the relay process only, never written to disk or to logs (`back/services/reseauxLecteurs.js`) | Anti-sharing limit: at most 8 distinct networks reading a chain over a sliding 24 hours; reads from a new network beyond that get 429 | Legitimate interest, art. 6(1)(f): preventing a chain from being used to share files between strangers, without accounts | 24 hours sliding: an entry stops counting 24 hours after its last read and is dropped from memory at the next read of that chain or when older chains are evicted; once the salt is replaced (every 24 hours, the previous one kept one more day) a hash can no longer be linked to any network; everything is lost on restart. At most 8 hashes per chain. | Hetzner, Germany |
| 3 | Chain identifier (32 hex characters derived from the 12 words), SHA-256 of the chain proof, space used, number of documents, creation date, last activity (updated at most once an hour) | Relay database, table `Chain` (`back/prisma/schema.prisma`) | Providing sync, which the user turns on | Performance of the service requested by the user, art. 6(1)(b) | Until the user erases the chain or starts a new chain; automatically deleted after 180 days without any request (`back/services/casiers.js`, `CHAIN_INACTIVE_DAYS`); deleted on a substantiated abuse report (`back/scripts/supprimer-chaine.js`) | Hetzner, Germany |
| 4 | Per document: `docId` (HMAC of the path, unreadable without the key), encrypted path, SHA-256 of the encrypted block, block size, modification time sent by the device, last update time, deletion time and encrypted deletion marker | Relay database, table `ChainDoc` | Providing sync, including propagating deletions to the user's other devices | Art. 6(1)(b) | While the document exists. After a deletion, the row stays as a tombstone for 30 days (at most 5,000 tombstones per chain, oldest removed first), then the daily purge deletes it. Deleted with the chain. | Hetzner, Germany |
| 5 | Encrypted content of each Markdown document (AES-256-GCM, keys known only to the user's devices) | Relay disk, `/data/chain/<chain id>/` | Providing sync | Art. 6(1)(b) | Replaced on each change, deleted from disk when the document is deleted or the chain is erased | Hetzner, Germany |
| 6 | Random per-installation identifier (`X-Lector-Device` header) | Not stored. Held in memory while an event is relayed to the other devices of the same chain. | Letting a device ignore its own changes in the live stream | Art. 6(1)(b) | Not kept | Hetzner, Germany |
| 7 | First 8 characters of a chain identifier, time and event (chain created, chain erased, wrong proof, read refused because too many networks read the chain today, missing block, error summary), purge counts. Never an IP address, a proof, an encrypted path or a request body. | Output of the relay container (Docker log) | Running the service, diagnosing failures | Legitimate interest, art. 6(1)(f) | Until the container log is rotated: by size, 3 files of 10 MB, once this branch is deployed (Known gaps 3) | Hetzner, Germany |
| 8 | Requests for update files: desktop (`/releases/latest-*.yml` at launch and every 4 hours, and a live connection to `/v1/releases/stream` to hear about a new release), iOS (`/api/latest-ios.json` at launch and when the app comes back). No identifier is sent. | Same records as line 1 | Delivering security and feature updates | Legitimate interest, art. 6(1)(f) | As line 1 | Hetzner, Germany |
| 9 | Pages of the website and of the web app (`/app/`) | Same records as line 1 | Serving the website and the web app | Legitimate interest, art. 6(1)(f) | As line 1 | Hetzner, Germany |
| 10 | Backups of the relay data (lines 3, 4 and 5). Lector blocks are already end-to-end encrypted when they reach the server, so backups hold them encrypted; the metadata is stored as is. | Server backups, then two off-site copies | Recovering from a server failure | Legitimate interest, art. 6(1)(f): continuity of the service | Server configuration, outside this repository (backup scripts kept by the operator). On the server: the 30 most recent archives, taken twice a day, so about 15 days (stated as "up to 30 days" in the privacy policy). Off site: a few days on the developer's computer, then the 8 most recent copies (about 4 days) and one monthly archive kept 6 months in iCloud Drive. | Hetzner, Germany; the developer's computer, France; Apple (iCloud Drive), storage location chosen by Apple, possibly outside the EU |
| 11 | Messages sent to contact@sidali.dev (address, content, anything the sender includes, such as a chain identifier in an abuse report) | Mailbox | Answering questions, handling abuse and security reports | Legitimate interest, art. 6(1)(f) | Until the request is handled, then deleted within 12 months | Proton AG, Switzerland (EU adequacy decision) |
| 12 | Web server error log: time, error message and, for a failed request, the client address and the request line. No access log (`deploy/nginx.conf` sets `access_log off;`). | Output of the web server container `lector-landing` (Docker log; the `nginx:alpine` image sends its error log there) | Running the website, diagnosing failures | Legitimate interest, art. 6(1)(f) | Until the container log is rotated: by size, 3 files of 10 MB, once this branch is deployed (Known gaps 2 and 3) | Hetzner, Germany |
| 13 | Shared documents (writing together): room identifier (32 hex characters derived from the document key, not reversible), SHA-256 of the room proof, SHA-256 of the owner's stop secret, sequence numbers, bytes used, encrypted messages (AES-256-GCM, key known only to the people with the link), creation date, last activity (at most once an hour); for a stopped or purged room, its identifier and the date | Relay database, tables `CollabRoom`, `CollabEntry`, `CollabRoomGone` (`back/services/collab/`) | Letting people the user invited write the document together and catch up after being offline | Art. 6(1)(b) | Room deleted when the owner stops sharing, or after 90 days without activity (`COLLAB_INACTIVE_DAYS`); the identifier of a stopped room is kept one year so the link cannot be reused. In backups (line 10) until they expire. | Hetzner, Germany |
| 14 | IP address (IPv6 reduced to its /64) of a co-writing connection | Memory of the relay process only (`back/services/collab/relais.js`) | Limits: 32 open connections and 20 rooms created per hour per address, 10 wrong proofs per 15 minutes per (address, room) | Legitimate interest, art. 6(1)(f) | While the connection is open, or the window of the counter | Hetzner, Germany |

## Third parties the app contacts directly

These are not processors of Lector: the app connects to them from the user's device, only when the user uses the feature, and their own privacy policy applies. No Lector server is on the path.

| Feature | Destination | What they receive | Country |
|---|---|---|---|
| Android updates | `github.com` and GitHub download hosts (GitHub, Microsoft) | IP address, user agent `Lector-Android` | United States |
| Embedded videos in a document | YouTube, Vimeo, Rumble | IP address, the video requested | Per provider |
| Remote images in a document | The website named in the image address | IP address, the image requested | Per website |
| "Search the web" (desktop context menu) | Google, opened in the user's browser | The selected text | United States |
| Files opened from iCloud Drive (Apple devices) | Apple | Managed by Apple, not by Lector | Per Apple |

## Your rights

The relay holds no name, email or account, so the operator cannot find your data from who you are (GDPR art. 11). You exercise your rights from a device of the chain:

- **Erasure**: Sync screen, "Erase everything" deletes the chain, its rows and its blocks immediately. Encrypted copies remain in backups until they expire (line 10).
- **Access and portability**: every device of the chain already has the documents; the desktop vault folder holds them as plain `.md` files.
- **Objection, questions, complaints**: contact@sidali.dev. You can also complain to the CNIL.

## Known gaps

The privacy policy, `PRIVACY.md` and the threat model state the current situation (7 days, copies possibly in backups). Closing these gaps would allow them to state 3 days; until then they must not say so (`docs/BASCULE-PROD.md`):

1. **Traefik** (outside this repository): today it logs every request and rotates after 7 days. Target: request headers explicitly dropped, only errors logged (or the IP field dropped), rotated after 3 days. Procedure in the operator's infrastructure notes (`TRAEFIK_LOGS_ERREURS_SEULEMENT.md`).
2. **Web server log**: fixed in this repository, not deployed yet. `deploy/nginx.conf` now sets `access_log off;` (the stock format recorded `X-Forwarded-For`, so the visitor's IP). Until this branch is deployed, production still writes that log. The nginx error log can still record the IP address of a failed request (line 12).
3. **Container logs**: fixed in this repository, not deployed yet. `deploy/docker-compose.yml` now bounds the logs of `lector-api` and `lector-landing` by size (`json-file`, 3 files of 10 MB), not by time.
4. **Logs in backups**: the server backup archives the whole Traefik folder, which likely includes its log folder, so IP addresses can survive in backups for up to 6 months. The log folder must be excluded from backups.
