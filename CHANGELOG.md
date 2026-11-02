# Changelog

## 2.1.0 (2026-11-02)

### New
- Tasks in any note: tap a `- [ ]` box to check it off. Lector writes `- [x]` and the date, `✅ 2026-11-02`, into the file, like the Obsidian Tasks plugin, and syncs it like any other edit.
- Reminders written in your notes: `⏰ 2026-11-03 14:30` for a time, `📅 2026-11-05` for a due date (reminder at 9:00). Each device schedules its own local notifications; no server knows about them.
- Today, at the top of the sidebar: overdue tasks, those due today and the next 7 days from all your notes, with the note they come from. Check them off from there.
- New task (⌘N on a computer, or the command palette) adds a line to Inbox.md, with an optional date and time.

### Improved
- Touching a reminder opens its note at the right line.
- On Android, checking a task gives a light haptic tick that follows the system setting, with no vibration permission.
- Notifications are asked for only when you create your first reminder, with a sentence that says why. Reminders are inexact by default to save battery; "Remind on time" in Today turns on exact alarms if you allow them.
- A code block without a language no longer stops a document from displaying.

### Known issues
- A reminder written on another device is scheduled on the phone only after Lector next opens or comes back to the foreground there: there is no background service, by choice, to save battery.
- On a computer, reminders appear while Lector is running; on the web, while the tab is open.
- Reminders on Android have not been tested on a real device yet.

## 2.0.1 (2026-11-01)

### New
- A new first launch in two screens at most: choose where your notes live, then set up sync or skip it.
- "Create my Lector folder" makes a Lector Vault folder you own: Documents/Lector Vault on a computer, a folder you pick on Android, the Lector folder of iCloud Drive on iOS, a folder kept in the browser on the web. An existing Lector Vault is offered instead of creating a new one, and "Use an existing folder" opens an Obsidian vault or any other folder.
- On Android, Lector only sees the folder you chose, through the system folder picker. It asks for no storage permission, and grants for other folders are released.
- The sync screen says what fits: free, end-to-end encrypted, Markdown notes up to 20 MB in total. Notes already in your folder are copied to the chain, never overwriting a document already there.

### Improved
- An empty folder gets the welcome document; a folder that already has notes is never touched.
- The first launch picks up where it stopped if the app is closed halfway.
- Existing users, with a folder or a chain already set up, go straight to their notes.

### Known issues
- The Android first launch has not been tested on a real device yet.
- On iOS, notes live in the Lector folder of iCloud Drive: picking another existing folder is not available yet.

## 2.0.0 (2026-11-01)

### New
- Lector is free, with no account: no email, no password, no subscription, no license key. Purchases and accounts are gone (see [docs/REMOVED.md](docs/REMOVED.md)).
- Sync between your devices through a chain of 12 words, end-to-end encrypted: documents and their paths are encrypted on the device, and the relay only stores what it cannot read.
- Join a chain with the 12 words, from your password manager, or by scanning a QR code in browsers that can.
- Save the 12 words to your password manager, print a recovery kit, and check three of the words to make sure you wrote them down.
- On Android, the 12 words can be saved to and filled from your password manager through the system (Android 14 and later).
- "New chain" on a computer cuts off a lost or stolen device: the old words stop working.
- "Erase everything" deletes your chain from the relay. On a computer, you can also move your local folder to the Trash; on the web and on mobile, the app forgets its keys and local data.
- Android updates itself: signed APKs on GitHub Releases, checked against a signed manifest before installation. Obtainium works too.
- About screen with the version, our principles, the security review, the privacy policy and font credits.
- A `security.txt` file to report security issues.

### Improved
- New look, "Miel du Champsaur": honey and fir colors in light and dark mode, flat, rounded everywhere, contrast checked to WCAG AA.
- Headings in Bricolage Grotesque and interface in Figtree; documents keep Literata for long reading.
- New open book icon on macOS, Windows, iOS, Android (adaptive, with a themed monochrome layer), the web app and the site; launch screens follow the theme, with no light flash in dark mode on Android.
- Diagrams, mind maps and code blocks use the same palette and follow light or dark mode.
- The interface and the macOS menus are in English only.
- Questions and reading aloud use your own Anthropic or ElevenLabs API key, kept on your device and called directly from it.
- Only Markdown files sync, up to 512 KB per document and 20 MB per chain; a larger document stays on the device and the Sync screen says so.
- Safer documents: HTML in documents is sanitized, diagrams render in strict mode, and a content security policy covers web, mobile and desktop. Fonts are bundled instead of loaded from Google.
- On a computer, the app only reads and writes the folders you opened yourself; showing the words, renewing and erasing the chain require Touch ID or a confirmation.
- iOS web updates are signed and checked (signature and SHA-256) before they are applied.
- Android backups to Google and device transfer are turned off, so your keys never leave the device that way.
- Up to date foundations: Electron 45, Capacitor 8.5.3, Node 24 on the relay, a single KaTeX version for math.

### Known issues
- Your local vault is not encrypted at rest yet: documents are plain Markdown files on your device, protected by your system like any other file.
- Saving and filling the 12 words with Proton Pass on Android still has to be verified on a real device.
- There is no local vault on the web and on mobile yet: documents are read from the relay, which may hold the only copy of them there.
