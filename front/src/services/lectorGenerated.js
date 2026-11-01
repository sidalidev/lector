/**
 * Service pour gérer les sections générées par Lector dans les fichiers .md
 * Ces sections sont stockées directement dans le fichier pour être synchronisées via iCloud
 */

const GENERATED_START = '<!-- lector-generated -->';
const GENERATED_END = '<!-- /lector-generated -->';

/**
 * Parse le contenu d'un fichier .md pour extraire les sections générées
 * @param {string} content - Contenu complet du fichier
 * @returns {object} - { originalContent, generated: { summary, flashcards, mindmap, keywords, glossary } }
 */
export function parseGeneratedSections(content) {
  const startIdx = content.indexOf(GENERATED_START);
  const endIdx = content.indexOf(GENERATED_END);

  // Pas de section générée
  if (startIdx === -1 || endIdx === -1) {
    return {
      originalContent: content.trim(),
      generated: null
    };
  }

  const originalContent = content.substring(0, startIdx).trim();
  const generatedBlock = content.substring(startIdx + GENERATED_START.length, endIdx).trim();

  const generated = {
    summary: null,
    flashcards: null,
    mindmap: null,
    keywords: null,
    glossary: null,
    difficulty: null,
    quiz: null,
    chat: null,
    highlights: null,
    flashcardsSR: null,
    quizSR: null,
    tags: null,
  };

  // Parse le résumé
  const summaryMatch = generatedBlock.match(/## 📝 Résumé\n([\s\S]*?)(?=\n## |$)/);
  if (summaryMatch) {
    generated.summary = summaryMatch[1].trim();
  }

  // Parse les flashcards (JSON dans un bloc code)
  const flashcardsMatch = generatedBlock.match(/## 🎴 Flashcards\n```json\n([\s\S]*?)\n```/);
  if (flashcardsMatch) {
    try {
      generated.flashcards = JSON.parse(flashcardsMatch[1]);
    } catch (e) {
      console.warn('Failed to parse flashcards JSON:', e);
    }
  }

  // Parse la mind map (Mermaid)
  const mindmapMatch = generatedBlock.match(/## 🧠 Mind Map\n```mermaid\n([\s\S]*?)\n```/);
  if (mindmapMatch) {
    generated.mindmapMermaid = mindmapMatch[1].trim();
  }

  // Parse les concepts mind map (JSON alternatif)
  const conceptsMatch = generatedBlock.match(/## 🧠 Concepts\n```json\n([\s\S]*?)\n```/);
  if (conceptsMatch) {
    try {
      generated.concepts = JSON.parse(conceptsMatch[1]);
    } catch (e) {
      console.warn('Failed to parse concepts JSON:', e);
    }
  }

  // Parse les mots-clés
  const keywordsMatch = generatedBlock.match(/## 🔑 Mots-clés\n([\s\S]*?)(?=\n## |$)/);
  if (keywordsMatch) {
    const keywordLine = keywordsMatch[1].trim();
    generated.keywords = keywordLine.match(/`([^`]+)`/g)?.map(k => k.replace(/`/g, '')) || [];
  }

  // Parse le glossaire
  const glossaryMatch = generatedBlock.match(/## 📖 Glossaire\n([\s\S]*?)(?=\n## |$)/);
  if (glossaryMatch) {
    const glossaryText = glossaryMatch[1].trim();
    generated.glossary = [];
    const termMatches = glossaryText.matchAll(/- \*\*([^*]+)\*\*:\s*(.+)/g);
    for (const match of termMatches) {
      generated.glossary.push({ term: match[1], definition: match[2] });
    }
  }

  // Parse la difficulté
  const difficultyMatch = generatedBlock.match(/## 📊 Difficulté\n`([^`]+)`/);
  if (difficultyMatch) {
    generated.difficulty = difficultyMatch[1];
  }

  // Parse le quiz (JSON dans un bloc code)
  const quizMatch = generatedBlock.match(/## ❓ Quiz\n```json\n([\s\S]*?)\n```/);
  if (quizMatch) {
    try {
      generated.quiz = JSON.parse(quizMatch[1]);
    } catch (e) {
      console.warn('Failed to parse quiz JSON:', e);
    }
  }

  // Parse le chat récent (JSON dans un bloc code)
  const chatMatch = generatedBlock.match(/## 💬 Chat récent\n```json\n([\s\S]*?)\n```/);
  if (chatMatch) {
    try {
      generated.chat = JSON.parse(chatMatch[1]);
    } catch (e) {
      console.warn('Failed to parse chat JSON:', e);
    }
  }

  // Parse les highlights (JSON)
  const highlightsMatch = generatedBlock.match(/## 🖍 Highlights\n```json\n([\s\S]*?)\n```/);
  if (highlightsMatch) {
    try {
      generated.highlights = JSON.parse(highlightsMatch[1]);
    } catch (e) {
      console.warn('Failed to parse highlights JSON:', e);
    }
  }

  // Parse les données SR des flashcards (JSON)
  const flashcardsSRMatch = generatedBlock.match(/## 🎴 Flashcards SR\n```json\n([\s\S]*?)\n```/);
  if (flashcardsSRMatch) {
    try {
      generated.flashcardsSR = JSON.parse(flashcardsSRMatch[1]);
    } catch (e) {
      console.warn('Failed to parse flashcards SR JSON:', e);
    }
  }

  // Parse les données SR du quiz (JSON)
  const quizSRMatch = generatedBlock.match(/## ❓ Quiz SR\n```json\n([\s\S]*?)\n```/);
  if (quizSRMatch) {
    try {
      generated.quizSR = JSON.parse(quizSRMatch[1]);
    } catch (e) {
      console.warn('Failed to parse quiz SR JSON:', e);
    }
  }

  // Parse les tags (JSON)
  const tagsMatch = generatedBlock.match(/## 🏷 Tags\n```json\n([\s\S]*?)\n```/);
  if (tagsMatch) {
    try {
      generated.tags = JSON.parse(tagsMatch[1]);
    } catch (e) {
      console.warn('Failed to parse tags JSON:', e);
    }
  }

  return { originalContent, generated };
}

/**
 * Génère le bloc de texte pour les sections générées
 * @param {object} generated - { summary, flashcards, concepts, keywords, glossary, difficulty }
 * @returns {string} - Bloc markdown formaté
 */
export function formatGeneratedSections(generated) {
  if (!generated) return '';

  const parts = ['\n\n---\n' + GENERATED_START];

  if (generated.summary) {
    parts.push(`\n## 📝 Résumé\n${generated.summary}`);
  }

  if (generated.flashcards && generated.flashcards.length > 0) {
    parts.push(`\n## 🎴 Flashcards\n\`\`\`json\n${JSON.stringify(generated.flashcards, null, 2)}\n\`\`\``);
  }

  if (generated.concepts) {
    // Convertir les concepts en Mermaid mindmap
    const mermaidCode = conceptsToMermaid(generated.concepts);
    if (mermaidCode) {
      parts.push(`\n## 🧠 Mind Map\n\`\`\`mermaid\n${mermaidCode}\n\`\`\``);
    }
    // Aussi sauvegarder le JSON brut pour pouvoir le réutiliser
    parts.push(`\n## 🧠 Concepts\n\`\`\`json\n${JSON.stringify(generated.concepts, null, 2)}\n\`\`\``);
  }

  if (generated.keywords && generated.keywords.length > 0) {
    const keywordStr = generated.keywords.map(k => `\`${k}\``).join(' ');
    parts.push(`\n## 🔑 Mots-clés\n${keywordStr}`);
  }

  if (generated.glossary && generated.glossary.length > 0) {
    const glossaryStr = generated.glossary.map(g => `- **${g.term}**: ${g.definition}`).join('\n');
    parts.push(`\n## 📖 Glossaire\n${glossaryStr}`);
  }

  if (generated.difficulty) {
    parts.push(`\n## 📊 Difficulté\n\`${generated.difficulty}\``);
  }

  if (generated.quiz && generated.quiz.length > 0) {
    parts.push(`\n## ❓ Quiz\n\`\`\`json\n${JSON.stringify(generated.quiz, null, 2)}\n\`\`\``);
  }

  if (generated.chat && generated.chat.length > 0) {
    // Garder seulement les 10 derniers messages
    const recentChat = generated.chat.slice(-10);
    parts.push(`\n## 💬 Chat récent\n\`\`\`json\n${JSON.stringify(recentChat, null, 2)}\n\`\`\``);
  }

  if (generated.highlights && generated.highlights.length > 0) {
    parts.push(`\n## 🖍 Highlights\n\`\`\`json\n${JSON.stringify(generated.highlights, null, 2)}\n\`\`\``);
  }

  if (generated.flashcardsSR) {
    parts.push(`\n## 🎴 Flashcards SR\n\`\`\`json\n${JSON.stringify(generated.flashcardsSR, null, 2)}\n\`\`\``);
  }

  if (generated.quizSR) {
    parts.push(`\n## ❓ Quiz SR\n\`\`\`json\n${JSON.stringify(generated.quizSR, null, 2)}\n\`\`\``);
  }

  if (generated.tags && generated.tags.length > 0) {
    parts.push(`\n## 🏷 Tags\n\`\`\`json\n${JSON.stringify(generated.tags, null, 2)}\n\`\`\``);
  }

  parts.push('\n' + GENERATED_END);

  return parts.join('\n');
}

/**
 * Convertit les concepts JSON en diagramme Mermaid mindmap
 */
function conceptsToMermaid(concepts) {
  if (!concepts || !concepts.central) return null;

  const lines = ['mindmap'];
  lines.push(`  root((${escapeMermaid(concepts.central)}))`);

  if (concepts.branches) {
    for (const branch of concepts.branches) {
      lines.push(`    ${escapeMermaid(branch.name)}`);
      if (branch.children) {
        for (const child of branch.children) {
          lines.push(`      ${escapeMermaid(child)}`);
        }
      }
    }
  }

  return lines.join('\n');
}

/**
 * Échappe les caractères spéciaux pour Mermaid
 */
function escapeMermaid(text) {
  if (!text) return '';
  return text.replace(/[()[\]{}]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Met à jour les sections générées dans le contenu d'un fichier
 * @param {string} content - Contenu actuel du fichier
 * @param {object} newGenerated - Nouvelles données générées
 * @returns {string} - Nouveau contenu complet
 */
export function updateGeneratedSections(content, newGenerated) {
  const { originalContent } = parseGeneratedSections(content);
  const generatedBlock = formatGeneratedSections(newGenerated);
  return originalContent + generatedBlock;
}

