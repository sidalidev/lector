// Réglage « Show Markdown syntax » : mode source brut au lieu du mode mis en forme.
// Module sans CodeMirror : la palette de commandes l'importe sans alourdir le
// paquet principal (l'éditeur est chargé à la demande).

const CLE = 'lector-show-markdown-syntax'
export const EVENEMENT_SYNTAXE = 'lector-markdown-syntax'

/** true si l'utilisateur a choisi le mode source brut. */
export function syntaxeVisible() {
  try { return localStorage.getItem(CLE) === '1' } catch { return false }
}

/** Mémorise le choix et bascule à chaud tous les éditeurs ouverts. */
export function afficherSyntaxe(visible) {
  try { visible ? localStorage.setItem(CLE, '1') : localStorage.removeItem(CLE) } catch { /* stockage indisponible */ }
  window.dispatchEvent(new CustomEvent(EVENEMENT_SYNTAXE, { detail: !!visible }))
}

export const basculerSyntaxe = () => afficherSyntaxe(!syntaxeVisible())
