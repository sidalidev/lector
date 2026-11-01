/**
 * Chemin d'un fichier dans un dossier. « cloud:// » est déjà la racine du vault
 * du navigateur : y ajouter une barre donnerait un segment vide, refusé.
 */
export function cheminDans(dossier, nom) {
  return dossier === 'cloud://' ? `cloud://${nom}` : `${dossier}/${nom}`
}
