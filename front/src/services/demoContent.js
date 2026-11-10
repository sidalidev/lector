// Contenu de démo embarqué: mode demo:// (repli du premier lancement, ?demo).
// Aucun compte, aucun fichier, aucun réseau : le reviewer (et l'utilisateur curieux)
// voit le produit en 5 secondes. Rien n'est persisté, le picker revient au
// prochain lancement tant qu'une vraie source n'a pas été choisie.

const EN_WELCOME = `# Welcome to Lector

Lector is a **Markdown editor**: plain \`.md\` files, beautifully rendered, edited in real time, synced end to end encrypted.

> This is a sample document. Nothing to set up: browse the sidebar to see what Lector does, then pick your real notes whenever you're ready.

## Write

- Tap the pencil (or press **⌘E**) to edit, tap again to read
- Headings, lists, tables, links, images, code: plain Markdown, nothing proprietary
- **Share** a note to write it together in real time

## Read

- **Table of contents**, always one tap away
- **Focus mode** hides everything but the text
- **Search** in the note (⌘F) or across all notes (⌘⇧F)
- **Quick open** (⌘P) and the **command palette** (⌘⇧P)

## Tasks and reminders

Write \`- [ ]\` in any note and tap the box to check it off. Add \`⏰ 2026-11-03 14:30\` for a reminder, or \`📅 2026-11-05\` for a due date. **Today**, at the top of the sidebar, gathers them from every note: open *This week* to try it.

---

*Open the sidebar to explore the other sample pages, or tap **Change source** when you're ready to load your own notes.*
`

const EN_DIAGRAMS = `# Diagrams and code

Lector renders Mermaid diagrams and highlights code: write plain Markdown, get living documents.

## A flowchart

\`\`\`mermaid
flowchart LR
    A[Write Markdown] --> B{Lector}
    B --> C[Beautiful reading]
    B --> D[Real-time editing]
    B --> E[Encrypted sync]
\`\`\`

## Code, highlighted

\`\`\`javascript
const read = (doc) => {
  return lector.open(doc)   // syntax highlighting on demand
}
\`\`\`
`

// Tâches de la démo : datées par rapport au jour de l'ouverture, pour que Today montre quelque chose.
function jourDemo(decalage) {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() + decalage)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const EN_TASKS = `# This week

Tasks are plain Markdown: tap a box to check it off, and Lector writes it in the note. **Today**, at the top of the sidebar, gathers them from every note.

## Home

- [ ] Renew the car insurance 📅 ${jourDemo(-1)}
- [ ] Call the bank about the transfer ⏰ ${jourDemo(0)} 14:30
- [ ] Water the tomatoes ⏰ ${jourDemo(0)} 19:00
- [x] Book the dentist ⏰ ${jourDemo(0)} 09:00 ✅ ${jourDemo(0)}

## Work

- [ ] Send the quarterly report ⏰ ${jourDemo(1)} 10:00
- [ ] Prepare the workshop slides 📅 ${jourDemo(3)}
- [ ] Read the onboarding notes

## Later

- [ ] Plan the trip to the mountains 📅 ${jourDemo(12)}
`

const DOCS = {
  en: [
    { name: 'Welcome to Lector.md', content: EN_WELCOME },
    { name: 'This week.md', content: EN_TASKS },
    { name: 'Diagrams and code.md', content: EN_DIAGRAMS },
  ],
}

export function getDemoFiles(locale) {
  return DOCS[locale] || DOCS.en
}

export function getDemoFile(locale, name) {
  const files = getDemoFiles(locale)
  return files.find(f => f.name === name) || files[0]
}

/** Démo : une note modifiée (case cochée) le reste en mémoire jusqu'à la fermeture. */
export function setDemoFile(locale, name, content) {
  const files = getDemoFiles(locale)
  const file = files.find(f => f.name === name)
  if (file) file.content = content
  else files.push({ name, content })
}
