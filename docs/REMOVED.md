# Removed

Every feature that leaves Lector is listed here, with the reason. Removing things is how Lector stays simple.

## 2.2.0

Lector became a light Markdown editor and viewer. Every feature not about editing or viewing Markdown went away, so that the app starts fast and stays fast while you type: the web app's startup JavaScript went from about 1.3 MB to about 80 KB (gzip).

| Removed | Why |
|---|---|
| **Sheet music and music** (ABC notation, chord, tab, strum and fingering blocks, MIDI and Guitar Pro playback, MusicXML) | Heavy libraries (abcjs, verovio, webaudiofont) and instrument sounds fetched from `paulrosen.github.io` and `surikov.github.io`, for a use far from note taking. |
| **Flashcards, spaced repetition, quizzes, scores and streaks** | Study tools, not editing or viewing. Their data, kept per document in the app storage, is deleted at startup. |
| **AI assistant** (chat, summaries, keywords, glossary, difficulty, generated mind maps, the API keys screen, the local command-line assistant on desktop) and **reading aloud** (ElevenLabs) | They sent your text to a provider and needed API keys kept on the device. Saved keys are deleted at startup (`userData/api-keys.dat` on desktop, the `lector-keys` database on web and mobile). |
| **YouTube transcript import** (yt-dlp, desktop) | An importer, not an editor feature. A link to a YouTube, Vimeo or Rumble video still shows the video. |
| **Reading ruler, auto-scroll, highlights panel, tags, mind map and note graph** | Extra views around a note. The rendered Markdown, the table of contents and focus mode stay. |
| **Math rendering** (KaTeX, with remark-math and rehype-katex, their fonts and styles) | A library, fonts and styles to load for a use most notes never have. `$...$` and `$$...$$` now stay plain text. |
| **EPUB export, window opacity slider** (desktop), **`.srt` subtitle display**, the duplicate reading progress bar | Little used, and each one more code to load and maintain. |
| **Mermaid diagrams** | The heaviest library left (mermaid and d3), for a use most notes never have. A ```` ```mermaid ```` block now shows as plain code. |
| **PDF export** of a note or a folder (print) | A print window built from a second Markdown renderer. The Markdown files are the export. |
| **Vim-style navigation keys** (j, k, h, l, g, G) | They scrolled the old reading view, which no longer exists: notes open straight in the editor. |
| **Hosted training mode** (`?hosted=`, `/formation/`) | Read-only documents served for a training session, not part of the editor. |

## 2.0.0

Lector 2.0 became free and account-free. Everything that existed only to identify, bill or serve a user on the server went away.

| Removed | Why |
|---|---|
| **Accounts** (email, password, sign-in, password reset, server-side sessions) | An account links your documents to a person and has to be protected, reset and deleted. The sync chain (12 words) replaces it: whoever has the secret has the chain, and the relay knows nobody. |
| **Stripe payments and webhooks** | Lector is free. No payment means no customer data on the server and no payment provider in the chain of trust. |
| **In-app purchase** (StoreKit on iOS) | Same reason. The iOS app no longer contains any purchase code. |
| **License keys** | Nothing to unlock any more: every feature is available to everyone. |
| **Server-side sync with accounts** | Replaced by the chain: documents are encrypted on the device and the relay only stores blocks it cannot read. |
| **Server-side assistant and voice** | They sent your text to our server. Questions and reading aloud now use your own Anthropic or ElevenLabs API key, called directly from your device. |
| **Send to Kindle by email** | It sent your documents and your Kindle address through our server and an email provider. On a computer, export as EPUB and send it yourself. |
| **Command-line sync agent** | A second sync client to maintain and secure. The desktop app syncs the vault folder itself. |

## Moved out of the repository

| Removed | Why |
|---|---|
| **Personal tools** (a Jira export script and a work-tracking script, `tools/jira-to-vault.js` and `tools/mission.js`) | They were the author's own utilities, unrelated to Lector, and contained personal data. |
| **Personal documents** served by the site | Unrelated to Lector. |
| **Android release keystore** | Signing keys never belong in a repository. It lives offline, outside the repository. |
