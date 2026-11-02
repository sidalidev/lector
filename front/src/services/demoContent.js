// Contenu de démo embarqué: mode demo:// (repli du premier lancement, ?demo).
// Aucun compte, aucun fichier, aucun réseau : le reviewer (et l'utilisateur curieux)
// voit le produit en 5 secondes. Rien n'est persisté, le picker revient au
// prochain lancement tant qu'une vraie source n'a pas été choisie.

const EN_WELCOME = `# Welcome to Lector

Lector is your **reading companion**: a beautiful Markdown reader that helps you study, annotate, and master any text.

> This is a sample document. Nothing to set up: browse the sidebar to see what Lector can do, then pick your real source whenever you're ready.

## Tasks and reminders

Write \`- [ ]\` in any note and tap the box to check it off. Add \`⏰ 2026-11-03 14:30\` for a reminder, or \`📅 2026-11-05\` for a due date. **Today**, at the top of the sidebar, gathers them from every note: open *This week* to try it.

## Reading tools

- **Focus mode**: dim everything but the paragraph you're reading
- **Reading ruler**: guide your eyes on long documents
- **Auto-scroll**: read at your own pace, hands-free
- **Table of contents**: always one tap away

## Study tools

- **Highlights**: select any text to save it
- **Flashcards**: spaced repetition on your own notes
- **Full-text search**: across all your documents
- **Mind maps**: see the structure of any document

## It reads more than Markdown

| Format | What you get |
|---|---|
| \`.md\` | Beautiful typography, diagrams, math |
| \`.musicxml\` | Rendered sheet music |
| \`.gp / .gp5\` | Guitar Pro tabs, playable |
| \`.mid\` | MIDI playback |

---

*Open the sidebar to explore the other sample pages, or tap **Change source** when you're ready to load your own documents.*
`

const EN_DIAGRAMS = `# Diagrams & math, built in

Lector renders Mermaid diagrams and LaTeX math natively: write plain Markdown, get living documents.

## A flowchart

\`\`\`mermaid
flowchart LR
    A[Write Markdown] --> B{Lector}
    B --> C[Beautiful reading]
    B --> D[Flashcards]
    B --> E[Mind maps]
\`\`\`

## A little math

When $a \\ne 0$, the equation $ax^2 + bx + c = 0$ has two solutions:

$$x = {-b \\pm \\sqrt{b^2-4ac} \\over 2a}$$

## Code, highlighted

\`\`\`javascript
const read = (doc) => {
  return lector.open(doc)   // syntax highlighting on demand
}
\`\`\`
`

const FR_WELCOME = `# Bienvenue dans Lector

Lector est ton **compagnon de lecture** : un lecteur Markdown élégant pour étudier, annoter et maîtriser n'importe quel texte.

> Ceci est un document d'exemple. Rien à configurer : parcours la barre latérale pour voir ce que Lector sait faire, puis choisis ta vraie source quand tu es prêt.

## Outils de lecture

- **Mode focus** : tout s'estompe sauf le paragraphe que tu lis
- **Règle de lecture** : guide tes yeux sur les longs documents
- **Défilement auto** : lis à ton rythme, mains libres
- **Table des matières** : toujours à un geste

## Outils d'étude

- **Surlignages** : sélectionne n'importe quel texte pour le garder
- **Flashcards** : répétition espacée sur tes propres notes
- **Recherche globale** : dans tous tes documents
- **Cartes mentales** : la structure de chaque document, en un coup d'œil

## Il lit plus que le Markdown

| Format | Ce que tu obtiens |
|---|---|
| \`.md\` | Belle typographie, diagrammes, maths |
| \`.musicxml\` | Partitions rendues |
| \`.gp / .gp5\` | Tablatures Guitar Pro, jouables |
| \`.mid\` | Lecture MIDI |

---

*Ouvre la barre latérale pour explorer les autres pages d'exemple, ou touche **Changer de source** quand tu veux charger tes propres documents.*
`

const FR_DIAGRAMS = `# Diagrammes et maths, intégrés

Lector rend les diagrammes Mermaid et les maths LaTeX nativement : écris du Markdown simple, obtiens des documents vivants.

## Un flowchart

\`\`\`mermaid
flowchart LR
    A[Écrire du Markdown] --> B{Lector}
    B --> C[Belle lecture]
    B --> D[Flashcards]
    B --> E[Cartes mentales]
\`\`\`

## Un peu de maths

Quand $a \\ne 0$, l'équation $ax^2 + bx + c = 0$ a deux solutions :

$$x = {-b \\pm \\sqrt{b^2-4ac} \\over 2a}$$

## Du code, coloré

\`\`\`javascript
const lire = (doc) => {
  return lector.open(doc)   // coloration syntaxique à la demande
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
    { name: 'Diagrams & math.md', content: EN_DIAGRAMS },
  ],
  fr: [
    { name: 'Bienvenue dans Lector.md', content: FR_WELCOME },
    { name: 'Diagrammes et maths.md', content: FR_DIAGRAMS },
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
