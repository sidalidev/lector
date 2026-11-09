# Non-goals

Lector is a reader for your own Markdown files, synced between your own devices, that you can also write live with the people you invite. Some things it will never do, even if they are asked for often. Saying no to them is what keeps it simple, private and free.

## Lector will never

- **Ask you to create an account.** No email, no password, no sign-in with another company. Your 12 words are the only key.
- **Show ads or sell anything inside the app.** No ads, no in-app purchase, no subscription, no license key.
- **Track you.** No analytics, no telemetry, no crash reporter that sends data by itself, no tracking SDK. If a report is ever needed, you will read it and send it yourself.
- **Store images or large files on the relay.** Only `.md` and `.markdown` files sync, up to 512 KB each and 20 MB per chain. The relay is small on purpose: it is not a cloud drive, a photo backup or a file host.
- **Publish your documents.** No public pages, no "anyone can view", nothing the server can show to someone without the key. Sync is between devices that have your 12 words. Writing together is by invitation: the link carries a key for that one document, the server only relays what it cannot read, and you can stop sharing at any time ([docs/collab-design.md](docs/collab-design.md)).
- **Impose AI.** Every AI and voice feature is optional, off until you add your own API key, and calls the provider you chose directly from your device. Lector works fully without it.
- **Lock your documents in.** Your vault stays plain Markdown files that open in any editor, with or without Lector.

## Not now, maybe later

These are not refused, just not planned soon: a plugin system, syncing non-Markdown attachments between devices, read-only invitations.

Before opening a feature request, check that it does not fall in the first list.
