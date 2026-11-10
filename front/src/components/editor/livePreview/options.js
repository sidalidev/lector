// Ce que l'hôte de l'éditeur fournit au mode mis en forme.
//   resoudreImage(src) → URL affichable, Promise d'URL, ou null (image absente)
//   ouvrirLien(href)   → true si l'hôte a ouvert le lien lui-même (note locale…)
import { Facet } from '@codemirror/state'

export const optionsApercu = Facet.define({
  combine: (valeurs) => Object.assign({}, ...valeurs),
})
