// Export d'un dossier en fenêtre d'impression : markdown converti en HTML
// simple, sans dépendance. Le texte des documents est échappé d'abord : une
// balise écrite dans un document reste du texte, jamais du HTML. Liens et
// images ne gardent que http, https, mailto (liens), data:image (images) et
// les chemins relatifs.

export function echapperHtml(texte) {
  return String(texte)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Adresse gardée si elle est relative ou si son schéma est permis ; sinon '#'.
 * Le schéma est lu sans les blancs ni les caractères de contrôle, que les
 * navigateurs ignorent (« java\tscript: » vaut « javascript: »).
 */
function adresseSure(url, schemas) {
  const u = url.replace(/[\u0000-\u0020]/g, '')
  return /^[^/?#]*:/.test(u) && !schemas.test(u) ? '#' : url.trim()
}

const LIENS = /^(https?|mailto):/i
const IMAGES = /^(https?:|data:image\/)/i

/** Corps HTML de la page d'impression pour le markdown d'un dossier. */
export function markdownVersHtmlImpression(markdown) {
  return echapperHtml(markdown)
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^---$/gm, '<hr>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => `<img src="${adresseSure(src, IMAGES)}" alt="${alt}" />`)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, texte, href) => `<a href="${adresseSure(href, LIENS)}">${texte}</a>`)
    .replace(/\n\n/g, '</p><p>')
    .replace(/^/, '<p>').replace(/$/, '</p>')
}
