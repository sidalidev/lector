// Stockage disque des blocs chiffrés : CHAIN_FILES_ROOT/<chainId>/<docId[0:2]>/<docId>.
//
// Aucun nom fourni par le client n'entre tel quel dans un chemin disque :
// seulement un id de chaîne et un docId validés en hex.

const fs = require('fs/promises')
const path = require('path')
const crypto = require('crypto')
const { RE_CHAIN_ID, RE_DOC_ID } = require('./chaine')

const ROOT = path.resolve(process.env.CHAIN_FILES_ROOT || path.join(__dirname, '..', 'dev-chain'))

function racineChaine(chainId) {
  if (!RE_CHAIN_ID.test(String(chainId))) throw new Error('Invalid chain id')
  return path.join(ROOT, chainId)
}

function cheminBloc(chainId, docId) {
  if (!RE_DOC_ID.test(docId)) throw new Error('Invalid docId')
  return path.join(racineChaine(chainId), docId.slice(0, 2), docId)
}

/**
 * Écrit un bloc dans un fichier temporaire, à côté de sa place finale, et
 * renvoie son chemin. Le bloc en place ne change pas tant que installerBloc
 * n'a pas été appelé : un dépôt qui échoue en base n'écrase rien.
 */
async function preparerBloc(chainId, docId, octets) {
  const final = cheminBloc(chainId, docId)
  await fs.mkdir(path.dirname(final), { recursive: true })
  const temp = `${final}.${crypto.randomBytes(6).toString('hex')}.tmp`
  try {
    await fs.writeFile(temp, octets)
  } catch (err) {
    await abandonnerBloc(temp)
    throw err
  }
  return temp
}

/** Met en place un bloc préparé (renommage atomique dans le même dossier). */
async function installerBloc(temp, chainId, docId) {
  await fs.rename(temp, cheminBloc(chainId, docId))
}

/** Supprime un bloc préparé qui ne sera pas installé. */
async function abandonnerBloc(temp) {
  await fs.rm(temp, { force: true }).catch(() => {})
}

async function lireBloc(chainId, docId) {
  return fs.readFile(cheminBloc(chainId, docId))
}

async function supprimerBloc(chainId, docId) {
  await fs.rm(cheminBloc(chainId, docId), { force: true })
}

/**
 * Supprime le dossier d'un casier. Un dépôt encore en vol peut y créer un
 * fichier pendant le parcours (ENOTEMPTY) : quelques nouvelles tentatives.
 */
async function supprimerTout(chainId) {
  await fs.rm(racineChaine(chainId), { recursive: true, force: true, maxRetries: 10, retryDelay: 20 })
}

async function lireDossier(dossier) {
  try {
    return await fs.readdir(dossier, { withFileTypes: true })
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
}

/**
 * Tous les fichiers du casier : [{ nom, chemin, octets }]. Les fichiers
 * temporaires d'une écriture interrompue y figurent aussi (nom en .tmp).
 */
async function listerFichiers(chainId) {
  const fichiers = []
  const racine = racineChaine(chainId)
  for (const sous of await lireDossier(racine)) {
    const dossier = path.join(racine, sous.name)
    if (!sous.isDirectory()) {
      fichiers.push({ nom: sous.name, chemin: dossier, octets: (await fs.lstat(dossier)).size })
      continue
    }
    for (const e of await lireDossier(dossier)) {
      const chemin = path.join(dossier, e.name)
      fichiers.push({ nom: e.name, chemin, octets: (await fs.lstat(chemin)).size })
    }
  }
  return fichiers
}

/** Ids des casiers présents sur le disque. */
async function listerCasiers() {
  return (await lireDossier(ROOT)).filter((e) => e.isDirectory() && RE_CHAIN_ID.test(e.name)).map((e) => e.name)
}

module.exports = {
  preparerBloc,
  installerBloc,
  abandonnerBloc,
  lireBloc,
  supprimerBloc,
  supprimerTout,
  listerFichiers,
  listerCasiers,
}
