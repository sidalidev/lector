/**
 * Chemin d'un fichier dans un dossier. « cloud:// » et « browser:// » sont déjà
 * la racine d'un vault : y ajouter une barre donnerait un segment vide, refusé.
 */
export function cheminDans(dossier, nom) {
  return dossier === 'cloud://' || dossier === 'browser://' ? `${dossier}${nom}` : `${dossier}/${nom}`
}
