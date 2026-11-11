// Écrit LECTOR-FORMATS.md à la racine du vault : ce que Lector affiche.
// Réécrit quand LECTOR_FORMATS_VERSION change.

const fs = require('fs')
const path = require('path')

const LECTOR_FORMATS_VERSION = '2.2.0'
const FILE_NAME = 'LECTOR-FORMATS.md'

const TEMPLATE = `---
lector-formats-version: ${LECTOR_FORMATS_VERSION}
managed-by: lector
do-not-edit-directly: "Lector rewrites this file when the format spec changes"
---

# What Lector renders in your vault

This file is written by Lector. It documents what gets rendered nicely when you
open a \`.md\` file in Lector. Don't edit it: it is overwritten when Lector
ships a new format spec.

---

## Formatted as you write

Lector opens each note in one formatted editor: the Markdown syntax shows only
on the line you are writing.

- Headings (\`#\` to \`######\`), at full size, used to build the table of contents
- Bold \`**text**\`, italic \`*text*\`, strikethrough \`~~text~~\`, inline code
- Lists, ordered and unordered, nested; Enter continues the list
- Blockquotes \`>\` and horizontal rules \`---\`
- Task lists \`- [ ]\` and \`- [x]\` with a checkbox
- Tables (GFM), shown as a table until you click into them
- Fenced code blocks, in a monospace font (no syntax colors)
- Links and bare URLs: a click opens them; \`[text](./other-doc.md)\` opens the note in Lector
- Images \`![alt](path/to/image.png)\`: relative paths from the note, and \`https:\` URLs

## Shown as plain text

- Math: \`$...$\` and \`$$...$$\` (no LaTeX / KaTeX rendering)
- Diagrams: \`\`\`mermaid blocks show as plain code
- Raw HTML: never rendered, scripts and styles included
- Footnotes, wikilinks \`[[file]]\`, YAML front matter
- Video links (YouTube, Vimeo, Rumble) stay links

## File-system conventions

- **Folders** = sections in the sidebar (no special meaning, just hierarchy)
- **\`.lector-sync/\`** at vault root: sync metadata, leave it alone
- **Only markdown travels** between your devices (\`.md\` and \`.markdown\`). Images,
  PDFs and other files stay on the device where they are
- **\`<filename> (conflict YYYY-MM-DD-HH-MM).md\`**: produced when the same file was edited on two devices at once; keep the version you want

## Tips

- Keep each note under the relay's size limit (512 KB by default): a larger one stays on this device and does not sync
- Prefer 1 H1 per file (used as title)

---

*Lector \`v${LECTOR_FORMATS_VERSION}\`: open this file in Lector to see how it renders.*
`

function maintainFormatsReadme(vaultRoot) {
  const fp = path.join(vaultRoot, FILE_NAME)
  if (fs.existsSync(fp)) {
    try {
      const head = fs.readFileSync(fp, 'utf8').slice(0, 500)
      const m = head.match(/lector-formats-version:\s*(\S+)/)
      if (m && m[1] === LECTOR_FORMATS_VERSION) return false // up to date
    } catch {}
  }
  fs.writeFileSync(fp, TEMPLATE)
  return true
}

module.exports = { maintainFormatsReadme, LECTOR_FORMATS_VERSION }
