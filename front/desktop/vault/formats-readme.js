// Écrit LECTOR-FORMATS.md à la racine du vault : ce que Lector affiche.
// Réécrit quand LECTOR_FORMATS_VERSION change.

const fs = require('fs')
const path = require('path')

const LECTOR_FORMATS_VERSION = '2.0.0'
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

## Markdown (everything standard works)

- Headings (\`#\` to \`######\`), used to build the table of contents
- Bold \`**text**\`, italic \`*text*\`, strikethrough \`~~text~~\`
- Lists, ordered and unordered, nested
- Blockquotes \`>\`, styled with the warm accent color
- Inline code \`\` \`like this\` \`\` and fenced code blocks with language hints
- Tables (GFM)
- Task lists \`- [ ]\` and \`- [x]\` with rendered checkboxes
- Footnotes
- Internal links \`[text](./other-doc.md)\`: clickable, opens in Lector

## Mermaid diagrams

\`\`\`mermaid
flowchart LR
  Note[Markdown] --> Render[Lector]
  Render --> Reader[Beautiful reading]
\`\`\`

Supported Mermaid types: \`flowchart\`, \`sequenceDiagram\`, \`classDiagram\`,
\`gantt\`, \`pie\`, \`stateDiagram-v2\`, \`erDiagram\`, \`gitGraph\`,
\`mindmap\`, \`timeline\`, \`quadrantChart\`, \`xychart-beta\`. Click a
diagram to open it fullscreen with zoom and pan.

## Code with syntax highlighting

\`\`\`python
def hello():
    print("Lector renders 100+ languages")
\`\`\`

Click the copy icon (top-right of any code block) to copy.

## Music & audio

- **ABC notation** in \`\`\`abc fenced blocks: rendered as playable sheet music
- **Guitar Pro** files (\`.gp\`, \`.gp3\` to \`.gp5\`, \`.gpx\`): open directly, render tabs
- **MIDI** files (\`.mid\`, \`.midi\`): playable

## HTML embeds (sandboxed)

- Local \`.html\` files referenced from your markdown render in a sandboxed iframe
- YouTube / Vimeo / Rumble URLs auto-embed as players
- Local \`.mp4\` videos render with native controls

## Images

- Standard \`![alt](path/to/image.png)\`: relative paths from the doc work
- Hero image: place an image right under the H1 and it spans the column width
- Click any image to open it fullscreen with pan and zoom

## What's NOT rendered (yet)

- LaTeX / KaTeX math (no \`$x^2$\` or \`$$\\sum$$\` rendering)
- HTML \`<script>\` or \`<style>\` outside sandboxed iframes
- Custom fonts in markdown
- Interactive widgets (sliders, forms) outside iframe embeds

## File-system conventions

- **Folders** = sections in the sidebar (no special meaning, just hierarchy)
- **\`.lector-sync/\`** at vault root: sync metadata, leave it alone
- **Only markdown travels** between your devices (\`.md\` and \`.markdown\`). Images,
  PDFs and other files stay on the device where they are
- **\`<filename> (conflict YYYY-MM-DD-HH-MM).md\`**: produced when the same file was edited on two devices at once; keep the version you want

## Tips

- Keep markdown files under 1 MB for snappy rendering
- Prefer 1 H1 per file (used as title)
- Put hero images at 1600×640 or similar landscape ratios
- Use \`\`\`mermaid for diagrams instead of screenshots: they stay sharp at any zoom

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
