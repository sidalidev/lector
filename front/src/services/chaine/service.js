// Opérations de haut niveau sur le secret de chaîne S (docs/CHAINE.md § 3, 8 et 10).
//
// Commun à toutes les plateformes. Le stockage de S, lui, dépend de la
// plateforme : Electron le garde dans cloud-secrets.dat (safeStorage, processus
// principal), le web ne garde que des clés non exportables (IndexedDB, voir
// services/chaineWeb.js).
//
// Sans compte, aucun identifiant de chaîne n'est attendu avant la saisie : les
// 12 mots se vérifient localement par leur somme de contrôle, puis le premier
// appel au serveur dit si cette chaîne existe (404 CHAIN_UNKNOWN sinon).

import { ClientChaine } from "./client.js";
import { deriveId, hexVersOctets, lireSaisie as lireSecret, nouveauSecret, octetsVersHex, preparer, toCode, toWords } from "./crypto.js";

/**
 * Tire un nouveau S. Renvoie S (Uint8Array), son identifiant public, les 12 mots
 * et le code d'appairage (contenu du QR). Aucun lien ouvrable : une adresse
 * ouverte dans un navigateur finirait dans son historique et sa synchronisation.
 */
export async function nouvelleChaine() {
  const S = nouveauSecret();
  return { S, id: await deriveId(S), mots: await toWords(S), code: toCode(S) };
}

/** Ce qu'on affiche pour ajouter un appareil : 12 mots et code d'appairage (le QR encode le code). */
export async function exporterChaine(S) {
  return { mots: await toWords(S), code: toCode(S) };
}

/** Erreur de saisie, avec un code que l'interface traduit. */
export class ErreurSaisie extends Error {
  constructor(code, detail) {
    super(code);
    this.name = "ErreurSaisie";
    this.code = code;
    this.detail = detail || null;
  }
}

/**
 * Traduit une erreur de crypto.js en code d'interface : EMPTY, UNKNOWN_WORD
 * (detail = le mot), CHECKSUM, WORD_COUNT, INVALID_CODE, ou UNKNOWN.
 */
export function codeErreurSaisie(err) {
  if (err instanceof ErreurSaisie) return err.code;
  const m = String(err?.message || "");
  if (/^Saisie vide/.test(m)) return "EMPTY";
  if (/^Mot inconnu/.test(m)) return "UNKNOWN_WORD";
  if (/Somme de contrôle/.test(m)) return "CHECKSUM";
  if (/exactement 12 mots/.test(m)) return "WORD_COUNT";
  if (/^(Lien|Code) invalide/.test(m) || /base64url/.test(m)) return "INVALID_CODE";
  return "UNKNOWN";
}

/**
 * Lit ce que l'utilisateur a collé, tapé ou scanné : 12 mots ou code
 * « lector-chaine: » (un ancien lien est encore accepté). Aucun appel réseau.
 * Renvoie { S, id } ; lève ErreurSaisie.
 */
export async function lireSaisie(texte) {
  let S;
  try {
    ({ S } = await lireSecret(texte));
  } catch (err) {
    const code = codeErreurSaisie(err);
    const detail = code === "UNKNOWN_WORD" ? String(err.message).replace(/^Mot inconnu : /, "") : null;
    throw new ErreurSaisie(code, detail);
  }
  return { S, id: await deriveId(S) };
}

/** Client du casier d'une chaîne préparée (résultat de preparer(S)). */
export function clientDe(cles, { serverUrl = "", deviceId = null, fetch } = {}) {
  return new ClientChaine({ serverUrl, chainId: cles.id, preuve: cles.preuve, deviceId, ...(fetch ? { fetch } : {}) });
}

/** S en hex pour le stockage Electron (dans le blob safeStorage), et retour. */
export function secretVersHex(S) {
  return octetsVersHex(S);
}
export function hexVersSecret(hex) {
  const S = hexVersOctets(hex);
  if (S.length !== 16) throw new Error("Secret stocké invalide");
  return S;
}

/** Prépare les clés à partir du S stocké en hex (Electron). */
export async function clesDepuisHex(hex) {
  const S = hexVersSecret(hex);
  try {
    return await preparer(S);
  } finally {
    S.fill(0);
  }
}

export { preparer, toWords };
