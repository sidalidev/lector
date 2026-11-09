# Real-time co-writing: design

Status: web flow built (invitation page `/d/<room>`, owner share and stop from the web app). Binding a shared document to a `.md` file of the desktop or Android vault is designed below (§ 9) but not built yet.

Lector lets two or more people write the same Markdown document at the same time, like a shared online document, without giving up what Lector is: no account, a blind relay, end-to-end encryption, text only, local first.

## 1. Goals and non-goals

Goals:

- Write together in real time: remote cursors and selections with a first name and a colour, undo that only undoes your own changes.
- Invitation by link or QR code. The person invited needs a browser, nothing else: no account, no install.
- The relay forwards and stores only encrypted data. It never sees the text, the title, the names or the cursors.
- Work offline: changes made while disconnected merge when the connection comes back.
- The owner can stop sharing at any time.

Non-goals:

- Public pages. A shared document is never readable without the key that is in the link. There is no "publish" and no view of a document served by the relay.
- Access control between people holding the link. Everyone with the link can read and write (§ 3.3).
- Sharing anything but text. No images, no attachments.
- Sharing the vault. Sharing a document never reveals the 12 words, the chain or any other document.

## 2. Keys

Each shared document gets its own **document key** `K`: 32 random bytes drawn on the owner's device (`crypto.getRandomValues`). It has nothing to do with the 12 words of the sync chain, and the sync chain never carries it. Everything else comes from `K` with HKDF-SHA256 (empty salt), the same construction as the chain (`front/src/services/chaine/crypto.js`):

| Value | Derivation | Who knows it |
|---|---|---|
| Room id | `hex(HKDF(K, "lector-salon-id", 16))` | relay, everyone with the link |
| Room proof `P` | `HKDF(K, "lector-salon-proof", 32)` | everyone with the link; the relay stores `SHA-256(P)` only |
| Encryption key `K_enc` | `HKDF(K, "lector-salon-enc", 32)`, AES-256-GCM, non-exportable | everyone with the link |
| Owner secret `O` | 32 random bytes, independent of `K` | the owner's device only; the relay stores `SHA-256(O)` |

HKDF is one-way: knowing the room id or `SHA-256(P)` gives nothing about `K`, so the relay cannot link a room to a key, and it cannot derive `K_enc`.

## 3. Threat model

### 3.1 The relay (and its host, its backups, a stolen disk)

Sees: the room id, `SHA-256(P)`, `SHA-256(O)`, the number and sizes of encrypted messages (padded to 64 bytes, § 4), when they arrive, how many people are connected, and the IP addresses of the connections (in memory, for limits; never written by the API).

Cannot: read the text, the names or the cursors; forge or change a message (AES-GCM authentication, AAD bound to the room and the message kind); move a message to another room; stop a share in the owner's name (needs `O`).

Can: drop messages, refuse service, replay old messages. Replays are harmless: applying the same Yjs update twice does nothing. Dropping messages is not detected (no authenticated log). Same limit as the sync chain: the relay is trusted for availability, not for confidentiality or integrity.

### 3.2 A network attacker

Sees TLS only. The key is in the fragment of the link (`#...`), which browsers never send to a server, so it is in no request, no proxy log and no `Referer`.

### 3.3 People holding the link

Everyone who has the link is a co-author: they can read, write, delete text and see who is connected. There is no read-only mode. A co-author could rewrite or erase the document; every co-author keeps a local copy, and the owner keeps theirs. A co-author cannot stop the share (no `O`) and cannot reach the owner's vault.

A link that leaks is a document that leaks. That is why the link is shown only to the owner, never sent anywhere by Lector, and why "Stop sharing" exists.

### 3.4 The web page itself

The invitation page is the web app served by Lector's server (`/d/...`), so it trusts that server for its code, exactly like the web app (THREAT_MODEL § 4.3). A modified page could read the document. Desktop and mobile clients do not have this limit once they open shared documents (§ 9).

### 3.5 Where the key lives

- In the link, in the address bar, until the page loads. The page then removes the fragment from the address bar (`history.replaceState`). The link may still be in the browser history and its sync (the first load).
- In the browser that opened it: IndexedDB `lector-collab`, so that a reload or an offline visit works. The raw key is kept (not a non-exportable `CryptoKey`) because the owner must be able to show the link again. Like the rest of local data, it is not encrypted at rest.

## 4. Envelope

Every encrypted payload uses the chain envelope: `version (1 byte, = 1) ‖ IV (12 bytes) ‖ ciphertext ‖ tag (16 bytes)`, AES-256-GCM, random IV per message.

AAD, UTF-8: `lector-salon:<roomId>:doc` for document updates and snapshots, `lector-salon:<roomId>:presence` for presence. A message moved from another room, or a presence message replayed as a document update, fails to decrypt and is ignored.

Plaintext framing, to hide exact sizes: `length (4 bytes, big endian) ‖ payload ‖ zero bytes` up to the next multiple of 64 bytes. Every message also reveals that someone did something at that moment; typing rhythm is visible to the relay.

## 5. Protocol

One WebSocket per open document: `wss://<host>/v1/collab`. The URL is the same for every room: the room id travels inside the first message, so it never reaches the proxy access log. All frames are JSON text, 1 MiB at most. Binary data is base64url.

### 5.1 Client to relay

| Frame | Meaning |
|---|---|
| `{"t":"hello","v":1,"room":"<32 hex>","proof":"<43 b64url>","since":<int>,"owner":"<64 hex>"?}` | First frame, within 10 s. `since`: last sequence number the client has. `owner`: `SHA-256(O)`, sent by the owner only, creates the room if it does not exist. |
| `{"t":"up","d":"<envelope>"}` | A Yjs update. Stored, then forwarded to the others. |
| `{"t":"aw","d":"<envelope>"}` | A presence update (y-protocols awareness: name, colour, cursor). Forwarded, never stored. |
| `{"t":"compact","upto":<int>,"d":"<envelope>"}` | Full document state at sequence `upto`, replacing every stored message up to it. |
| `{"t":"stop","owner":"<b64url O>"}` | Owner only: delete the room. |

### 5.2 Relay to client

| Frame | Meaning |
|---|---|
| `{"t":"welcome","seq":<int>,"entries":[{"s":<int>,"d":"..."}],"peers":<int>}` | Catch-up. If `since` is at or after the last compaction, only newer messages; otherwise the snapshot then everything after it. |
| `{"t":"up","s":<int>,"d":"..."}` | Someone else's update, with its sequence number. |
| `{"t":"ack","s":<int>}` | Your update is stored under `s`. Acks come in the order updates were sent. |
| `{"t":"aw","d":"..."}` | Someone's presence. |
| `{"t":"compact?"}` | The stored log is long: please send a snapshot. |
| `{"t":"error","code":"..."}` | `QUOTA_EXCEEDED` (update refused, the connection stays), `RATE_LIMITED`, `BAD_FRAME`. |

Closing codes: `4400` bad frame, `4403` wrong proof, `4404` room unknown, `4408` no hello in time, `4413` frame too large, `4429` limits (too many people in the room, too many connections or rooms from this network), `4503` relay full. **A stopped room answers `4404`, exactly like a room that never existed.**

### 5.3 Client state and reconnection

The client keeps two Yjs documents: the **local** document (what the person sees) and a **mirror** of what the relay is known to hold (every message received, plus every own update once acked). Both are saved in IndexedDB with the last sequence number.

- Online, each local change is sent as `up` and queued until its `ack`, then applied to the mirror.
- After a disconnection, the client reconnects (1 s to 30 s backoff, immediately when the browser comes back online), receives the catch-up, and sends one update: the difference between the local document and the mirror (`Y.encodeStateAsUpdate(local, stateVector(mirror))`, which also carries deletions). Nothing typed offline is lost, even after closing the tab.
- Yjs merges concurrent changes; every client converges to the same text.

### 5.4 Compaction

When a room holds more than 200 messages, or the log is over twice the last snapshot plus 64 KB, the relay sends `compact?` to the connection that just wrote. That client, if it has no unacknowledged update and decrypted every message, sends `compact` with the mirror's full state. The relay replaces stored messages up to `upto` with it. The relay cannot check a snapshot; a co-author could send a bad one, but a co-author can already erase the text (§ 3.3).

## 6. Relay

`back/services/collab/` and the WebSocket upgrade on `/v1/collab` in `back/index.js`.

Stored (SQLite, `CollabRoom`, `CollabEntry`, `CollabRoomGone`): room id, `SHA-256(P)`, `SHA-256(O)`, sequence numbers, bytes used, encrypted messages, creation date and last activity (to the hour). For a stopped or purged room: its id and the date, so that it cannot be recreated (it answers `4404`).

Limits (environment variables, defaults):

| Limit | Default |
|---|---|
| Stored bytes per room `COLLAB_ROOM_QUOTA_BYTES` | 10 MB |
| Frame size `COLLAB_MAX_FRAME_BYTES` | 1 MiB |
| People connected per room `COLLAB_MAX_PEERS` | 16 |
| Rooms created per network per hour `COLLAB_CREATE_PER_HOUR` | 20 |
| Open connections per network `COLLAB_CONN_PER_IP` | 32 |
| Frames per connection | 300 per 10 s |
| Wrong proofs per (network, room) | 10 per 15 min (same limiter as the chain) |
| Rooms on the relay `COLLAB_MAX_ROOMS` | 10 000 |
| Inactive room deleted after `COLLAB_INACTIVE_DAYS` | 90 days |
| Stopped room id kept | 365 days |

Logs: counters and the first 8 characters of a room id at most. Never a frame, a proof, an owner secret, an IP address.

## 7. Stopping a share

The owner presses **Stop sharing**:

1. The owner's device sends `stop` with `O`. The relay checks `SHA-256(O)`, deletes the room and its messages, records the room id as stopped, and closes every connection with `4404`.
2. The owner's device forgets `K` and `O`. Sharing again draws a new key, a new room and a new link: the old link is dead for good.
3. Co-authors see "The owner stopped sharing". Their last copy stays in their browser and can be downloaded as `.md`. Lector cannot recall it.

If the owner is offline, the stop is remembered and sent at the next opportunity; the share is shown as stopped at once.

## 8. Web flow

- `/d/<room>#<key>` is served by the web app (nginx: `location /d/`). `front/src/main.jsx` recognises the path and loads only `SharedDoc` (dynamic import): Yjs, CodeMirror bindings and the collaboration code are not in the main bundle.
- First visit: the page checks that the room id is derived from the key (a damaged link is refused), stores the key, removes the fragment from the address bar, asks for a first name (kept in the browser), then connects.
- The person sees the document, the others' cursors, who is connected, the connection state, and a button to download the document as `.md`.
- Owner, from the web app: **Share** on an open document creates the room with the document text, then shows the link, a QR code and **Stop sharing**. Opening the link (button **Open**) brings the owner to the same page, with the owner's controls.

## 9. Desktop and Android (designed, not built)

The shared document is a normal `.md` file in the owner's vault. The client keeps the Yjs state next to its record (IndexedDB, keyed by room, plus an index from file path to room):

- Y.Text to file: every local or remote change writes the file (1 s debounce, the editor's existing save path).
- File to Y.Text: when the file changes outside the shared editor (another editor, sync from another device of the chain), the difference is applied to the Y.Text as one edit (`appliquerTexte`, common prefix and suffix), so it travels to co-authors like a normal edit.
- `MarkdownEditor` takes an optional binding (`yCollab` with a per-person `Y.UndoManager`); without it, nothing changes.

## 10. Known gaps

- No read-only links, no per-person revocation: stopping the share cuts everyone.
- The relay can drop messages or show an old state without detection.
- Typing rhythm and approximate sizes are visible to the relay.
- On the web, the page code comes from Lector's server at every visit.
- The key is stored unencrypted in the browser that opened the link.
