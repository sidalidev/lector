// Chargement, depuis le processus principal (CommonJS), des modules ES de la
// chaîne partagés avec le front (front/src/services/chaine/). Un seul jeu de
// code, vérifié par les mêmes tests (npm run test:chaine). Ces fichiers sont
// inclus dans l'app empaquetée par build.files du package.json racine.

const path = require('path')
const { pathToFileURL } = require('url')

const SERVICES = path.join(__dirname, '../src/services')

function charger(relatif) {
  const complet = path.join(SERVICES, relatif)
  return import(pathToFileURL(complet).href).catch((err) => {
    // Repli : Node 22 sait faire require() d'un module ES sans await de haut niveau.
    try { return require(complet) } catch { throw err }
  })
}

function memoriser(fabrique) {
  let promesse = null
  return () => {
    if (!promesse) {
      promesse = fabrique()
      promesse.catch(() => { promesse = null })
    }
    return promesse
  }
}

/** { crypto, client, synchro, service } */
const chargerChaine = memoriser(async () => {
  const [crypto, client, synchro, service] = await Promise.all([
    charger('chaine/crypto.js'),
    charger('chaine/client.js'),
    charger('chaine/synchro.js'),
    charger('chaine/service.js'),
  ])
  return { crypto, client, synchro, service }
})

module.exports = { chargerChaine }
