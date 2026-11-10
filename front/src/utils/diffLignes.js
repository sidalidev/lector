// Différence ligne à ligne entre deux textes (plus longue sous-suite commune).
// Renvoie [{ type: 'egal' | 'ajout' | 'retrait', texte }], dans l'ordre du nouveau texte.

const LIMITE = 4_000_000 // cellules de la table : au-delà, on montre tout comme réécrit

export function diffLignes(ancien, nouveau) {
  const a = ancien.split('\n')
  const b = nouveau.split('\n')
  let debut = 0
  while (debut < a.length && debut < b.length && a[debut] === b[debut]) debut++
  let fin = 0
  while (fin < a.length - debut && fin < b.length - debut && a[a.length - 1 - fin] === b[b.length - 1 - fin]) fin++
  const ma = a.slice(debut, a.length - fin)
  const mb = b.slice(debut, b.length - fin)
  const res = a.slice(0, debut).map((texte) => ({ type: 'egal', texte }))

  if (ma.length * mb.length > LIMITE) {
    for (const texte of ma) res.push({ type: 'retrait', texte })
    for (const texte of mb) res.push({ type: 'ajout', texte })
  } else {
    const n = ma.length
    const m = mb.length
    const t = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        t[i][j] = ma[i] === mb[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1])
      }
    }
    let i = 0
    let j = 0
    while (i < n && j < m) {
      if (ma[i] === mb[j]) { res.push({ type: 'egal', texte: ma[i] }); i++; j++ }
      else if (t[i + 1][j] >= t[i][j + 1]) res.push({ type: 'retrait', texte: ma[i++] })
      else res.push({ type: 'ajout', texte: mb[j++] })
    }
    while (i < n) res.push({ type: 'retrait', texte: ma[i++] })
    while (j < m) res.push({ type: 'ajout', texte: mb[j++] })
  }
  for (const texte of a.slice(a.length - fin)) res.push({ type: 'egal', texte })
  return res
}
