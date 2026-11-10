# Non-goals

Lector is a light editor and viewer for your own Markdown files, synced between your own devices, that you can also write live with the people you invite. Some things it will never do, even if they are asked for often. Saying no to them is what keeps it simple, fast, private and free.

## Lector will never

- **Ask you to create an account.** No email, no password, no sign-in with another company. Your 12 words are the only key.
- **Show ads or sell anything inside the app.** No ads, no in-app purchase, no subscription, no license key.
- **Track you.** No analytics, no telemetry, no crash reporter that sends data by itself, no tracking SDK. If a report is ever needed, you will read it and send it yourself.
- **Store images or large files on the relay.** Only `.md` and `.markdown` files sync, up to 512 KB each and 20 MB per chain. The relay is small on purpose: it is not a cloud drive, a photo backup or a file host.
- **Publish your documents.** No public pages, no "anyone can view", nothing the server can show to someone without the key. Sync is between devices that have your 12 words. Writing together is by invitation: the link carries a key for that one document, the server only relays what it cannot read, and you can stop sharing at any time ([docs/collab-design.md](docs/collab-design.md)).
- **Send your text to an AI or voice service.** Lector has no assistant, no generated summaries and no reading aloud. Your notes go nowhere but your own devices and the people you invite.
- **Lock your documents in.** Your vault stays plain Markdown files that open in any editor, with or without Lector.

## Out of scope

Lector stays a light Markdown editor: everything it loads at startup has to be worth its weight while you type. Version 2.2 removed what did not fit, and these will not come back:

- **Study tools**: flashcards, spaced repetition, quizzes, scores, streaks. They belong in a dedicated app; Lector edits and shows the notes they would be made from.
- **AI features**: chat, summaries, keywords, glossaries, generated mind maps. Use any tool you like on your `.md` files; Lector does not need to embed one.
- **Music**: sheet music, ABC notation, chords and tabs, MIDI, Guitar Pro, MusicXML. Large libraries and sounds fetched from other sites, for a use far from note taking.
- **Media import**: YouTube transcripts and other importers. A link to a video still shows the video; fetching content into notes is another tool's job.
- **Reading aids and extra views**: reading ruler, auto-scroll, highlights panel, tags, mind map and note graph, text to speech, EPUB export, window opacity, subtitle files. Lector keeps one way to read a note: the rendered Markdown, with a table of contents.
- **Diagram rendering** (Mermaid and other engines): a heavy library for a use most notes never have. A diagram block stays readable as plain code.
- **Extra modes and lists around the editor**: a demo mode, focus mode, a raw source mode ("Show Markdown syntax"), favorites and recent files, a text size setting. The editor shows formatted Markdown at one size; the file tree, quick open and search find any note.
- **Math rendering** (KaTeX): its library, fonts and styles weigh more than most notes need. `$...$` and `$$...$$` stay readable as plain text.

## Not now, maybe later

These are not refused, just not planned soon: a plugin system, syncing non-Markdown attachments between devices, read-only invitations.

Before opening a feature request, check that it does not fall in the first list.
