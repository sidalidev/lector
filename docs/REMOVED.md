# Removed

Every feature that leaves Lector is listed here, with the reason. Removing things is how Lector stays simple.

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
