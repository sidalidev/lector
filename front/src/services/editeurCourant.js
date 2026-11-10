// L'éditeur de la note ouverte, vu du reste de l'application.
//
// La note s'affiche et s'écrit au même endroit (l'éditeur CodeMirror mis en
// forme). Le sommaire, la recherche dans la note et l'ouverture d'une tâche
// passent par ici. Ce module n'importe pas CodeMirror : l'éditeur, chargé à la
// demande, s'y inscrit avec ses propres fonctions.

let courant = null

/** Appelé par l'éditeur à son montage (api) et à son démontage (null). */
export function inscrire(api) { courant = api }
export function desinscrire(api) { if (courant === api) courant = null }

/** Fait défiler jusqu'à la ligne `n` (1 = première) et la signale un instant. */
export function allerALigne(n, options) { return courant?.allerALigne(n, options) ?? false }

/** Ligne du fichier en haut de l'écran (pour le sommaire et la position de lecture). */
export function ligneEnHaut() { return courant?.ligneEnHaut() ?? null }

/** Place le curseur à la fin de la note et donne le focus. */
export function ecrireALaFin() { courant?.ecrireALaFin() }

/** Surligne les résultats d'une expression régulière. Renvoie leur nombre. */
export function chercher(regex, options) { return courant?.chercher(regex, options) ?? 0 }

/** Montre le résultat `i` (à partir de 0). */
export function montrerResultat(i) { courant?.montrerResultat(i) }

/** Retire les surlignages de recherche. */
export function effacerRecherche() { courant?.effacerRecherche() }

/** Titres de la note (pour le sommaire), sans ceux des blocs de code. */
export function titresDe(texte) {
  const titres = []
  let dansCode = false
  const lignes = (texte || '').split('\n')
  for (let i = 0; i < lignes.length; i++) {
    const l = lignes[i]
    if (/^\s{0,3}(```|~~~)/.test(l)) { dansCode = !dansCode; continue }
    if (dansCode) continue
    const m = /^#{1,6}(?=\s)/.exec(l)
    if (!m) continue
    const texteTitre = l.slice(m[0].length).replace(/\s#+\s*$/, '').trim()
      .replace(/\*\*|__|`/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    if (texteTitre) titres.push({ id: `l${i + 1}`, line: i + 1, text: texteTitre, level: m[0].length })
  }
  return titres
}

/**
 * Expression de recherche dans la note (au moins 2 caractères), comparée au
 * texte sans accents : « eleve » trouve « élève ».
 */
export function regexDeRecherche(q, { caseSensitive = false, wholeWord = false } = {}) {
  if (!q || q.length < 2) return null
  let motif = q.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (wholeWord) motif = `(?<![\\p{L}\\p{N}_])${motif}(?![\\p{L}\\p{N}_])`
  try { return new RegExp(motif, caseSensitive ? 'gu' : 'giu') } catch { return null }
}
