# Feature: Explain Mode (Animated Diagrams)

## Objectif

Transformer un diagramme Mermaid en animation explicative avec narration TTS.

---

## Use Case Test : Export/Import Hoppen

```mermaid
flowchart TB
    subgraph EXPORT["📤 EXPORT"]
        E1[Designer Parcours] --> E2[Clic Exporter]
        E2 --> E3[Modal Password]
        E3 --> E4[GET /exportImport/export]
        E4 --> E5[ZIP chiffré]
        E5 --> E6[📁 fichier.exls]
    end

    subgraph IMPORT["📥 IMPORT"]
        I1[Page Historique] --> I2[Clic Import]
        I2 --> I3["① Upload .exls"]
        I3 --> I4["② Password"]
        I4 --> I5["③ Équipes"]
        I5 --> I6["④ Codes"]
        I6 --> I7[POST /import]
        I7 --> I8{Conflit?}
        I8 -->|Non| I9[✅ BD]
        I8 -->|Oui| I10[Renommer]
        I10 --> I9
    end

    E6 -.-> I3
```

---

## Spec Technique

### 1. Parser Mermaid → AST

```typescript
interface DiagramNode {
  id: string
  label: string
  type: 'node' | 'decision' | 'subgraph'
}

interface DiagramEdge {
  from: string
  to: string
  label?: string
  style: 'solid' | 'dashed'
}

interface Diagram {
  nodes: DiagramNode[]
  edges: DiagramEdge[]
  subgraphs: { id: string, label: string, nodes: string[] }[]
}
```

### 2. Animation Sequencer

```typescript
interface AnimationStep {
  type: 'appear' | 'highlight' | 'connect' | 'fade'
  target: string | string[]
  duration: number
  narration?: string  // texte pour TTS
}

// Génération auto des steps depuis le diagram
function generateSteps(diagram: Diagram): AnimationStep[]
```

### 3. Renderer (Canvas/SVG)

- Utiliser `@mermaid-js/mermaid` pour le parsing
- Renderer custom pour l'animation (pas le rendu statique de mermaid)
- Smooth transitions avec `framer-motion` ou CSS animations

### 4. TTS Integration

- Réutiliser `TextToSpeech.jsx` existant
- Sync narration avec les steps d'animation
- Option: générer avec ElevenLabs API pour voix plus naturelle

### 5. Export Vidéo

- `MediaRecorder` API pour capturer le canvas
- Export WebM/MP4
- Option GIF pour partage rapide

---

## UI/UX

```
┌─────────────────────────────────────────────────┐
│  [▶ Play] [⏸ Pause] [⏮ Reset]  Speed: [1x ▼]  │
├─────────────────────────────────────────────────┤
│                                                 │
│            ┌─────────────┐                      │
│            │  Animated   │                      │
│            │  Diagram    │                      │
│            │  Canvas     │                      │
│            └─────────────┘                      │
│                                                 │
├─────────────────────────────────────────────────┤
│  Step 3/12: "Le fichier .exls est uploadé"     │
│  ████████████░░░░░░░░░░░░░░░░░░░░  25%         │
└─────────────────────────────────────────────────┘
```

---

## Roadmap (MVP)

- [ ] Parser Mermaid → structure interne
- [ ] Renderer SVG basique (nodes + edges)
- [ ] Animation appear/connect step-by-step
- [ ] UI controls (play/pause/step/speed)

~~- [ ] Intégration TTS~~ (pas nécessaire)
~~- [ ] Export vidéo~~ (pas nécessaire)
~~- [ ] Génération auto narration~~ (pas nécessaire)

**But : Comprendre visuellement un flux, pas produire une vidéo.**

---

## Dépendances à ajouter

```json
{
  "mermaid": "^10.x",
  "framer-motion": "^11.x"
}
```
