// Cryptographie du partage de documents (docs/collab-design.md § 2 et 4).
//
// Une clé K de 32 octets par document partagé, tirée au hasard, sans aucun lien
// avec les 12 mots de la chaîne. Tout le reste en dérive par HKDF-SHA256 et
// l'enveloppe est celle de la chaîne (chaine/crypto.js) : pas de crypto à part.
//
// Module ES sans DOM : navigateur, vue web Capacitor, Node 22 (tests).

import {
  aleatoire,
  hkdfOctets,
  octetsVersHex,
  hexVersOctets,
  octetsVersBase64url,
  base64urlVersOctets,
  sceller,
  ouvrir,
  sha256Hex,
} from "../chaine/crypto.js";

/** Taille de la clé de document et du secret de propriétaire, en octets. */
export const TAILLE_CLE = 32;

/** Le clair est complété jusqu'au multiple suivant de BLOC_REMPLISSAGE (cache la taille exacte). */
export const BLOC_REMPLISSAGE = 64;

const RE_SALON = /^[0-9a-f]{32}$/;
const RE_CLE_TEXTE = /^[A-Za-z0-9_-]{43}$/;

const utf8 = (texte) => new TextEncoder().encode(texte);

/** Nouvelle clé de document K (32 octets aléatoires). */
export function nouvelleCle() {
  return aleatoire(TAILLE_CLE);
}

/** Nouveau secret de propriétaire O (32 octets aléatoires, indépendant de K). */
export function nouveauSecretProprietaire() {
  return aleatoire(TAILLE_CLE);
}

function cle(K) {
  const octets = K instanceof Uint8Array ? K : null;
  if (!octets || octets.length !== TAILLE_CLE) throw new Error("Clé de document invalide : 32 octets attendus");
  return octets;
}

export function estIdSalonValide(id) {
  return typeof id === "string" && RE_SALON.test(id);
}

/** Identifiant public du salon : hex(HKDF(K, "lector-salon-id", 16)). */
export async function deriverIdSalon(K) {
  return octetsVersHex(await hkdfOctets(cle(K), "lector-salon-id", 16));
}

/**
 * Tout ce qu'il faut pour rejoindre un salon : id, preuve P (base64url, envoyée
 * au relais qui n'en garde que SHA-256) et clé AES-GCM non exportable.
 */
export async function preparerSalon(K) {
  const k = cle(K);
  const enc = await hkdfOctets(k, "lector-salon-enc", 32);
  const preuve = await hkdfOctets(k, "lector-salon-proof", 32);
  const cleEnc = await globalThis.crypto.subtle.importKey("raw", enc, "AES-GCM", false, ["encrypt", "decrypt"]);
  enc.fill(0);
  const salon = { id: await deriverIdSalon(k), preuve: octetsVersBase64url(preuve), cleEnc };
  preuve.fill(0);
  return salon;
}

/** Empreinte du secret de propriétaire, la seule forme que voit le relais. */
export async function empreinteProprietaire(O) {
  return sha256Hex(cle(O));
}

// ---------------------------------------------------------------------------
// Messages chiffrés : AAD « lector-salon:<id>:<nature> », clair complété.
// ---------------------------------------------------------------------------

export const NATURES = Object.freeze({ DOC: "doc", PRESENCE: "presence" });

function aad(idSalon, nature) {
  if (!estIdSalonValide(idSalon)) throw new Error("Identifiant de salon invalide");
  if (nature !== NATURES.DOC && nature !== NATURES.PRESENCE) throw new Error("Nature de message inconnue");
  return utf8(`lector-salon:${idSalon}:${nature}`);
}

/** longueur (4 octets, gros-boutiste) ‖ données ‖ zéros jusqu'au multiple de 64. */
export function completer(donnees) {
  const total = Math.ceil((4 + donnees.length) / BLOC_REMPLISSAGE) * BLOC_REMPLISSAGE;
  const sortie = new Uint8Array(total);
  new DataView(sortie.buffer).setUint32(0, donnees.length);
  sortie.set(donnees, 4);
  return sortie;
}

export function retirerRemplissage(clair) {
  if (clair.length < 4) throw new Error("Message invalide : trop court");
  const n = new DataView(clair.buffer, clair.byteOffset, clair.byteLength).getUint32(0);
  if (n > clair.length - 4) throw new Error("Message invalide : longueur incohérente");
  return clair.slice(4, 4 + n);
}

/** Chiffre un message (mise à jour Yjs ou présence) : enveloppe en base64url. */
export async function chiffrerMessage(salon, nature, donnees) {
  return octetsVersBase64url(await sceller(salon.cleEnc, completer(donnees), aad(salon.id, nature)));
}

/** Déchiffre un message. Lève une erreur si la clé, le salon ou la nature ne correspondent pas. */
export async function dechiffrerMessage(salon, nature, texte) {
  let env;
  try {
    env = base64urlVersOctets(texte);
  } catch {
    throw new Error("Message invalide : base64url attendu");
  }
  return retirerRemplissage(await ouvrir(salon.cleEnc, env, aad(salon.id, nature)));
}

// ---------------------------------------------------------------------------
// Lien d'invitation : https://<hôte>/d/<idSalon>#<K en hexadécimal>
// La clé est dans le fragment : un navigateur ne l'envoie jamais au serveur.
// Hexadécimal (0-9, a-f) : aucune messagerie ne coupe le lien sur un « - » ou
// un « _ » final, ce qui arrivait avec base64url. Les anciens liens restent lus.
// ---------------------------------------------------------------------------

export async function lienInvitation(origine, K) {
  const base = String(origine || "").replace(/\/$/, "");
  const hex = Array.from(cle(K), (o) => o.toString(16).padStart(2, "0")).join("");
  return `${base}/d/${await deriverIdSalon(K)}#${hex}`;
}

/** Lit la clé d'un fragment (« #… » ou « … »). Lève une erreur s'il est mal formé. */
export function cleDuFragment(fragment) {
  const texte = String(fragment ?? "").replace(/^#/, "");
  // Clé hexadécimale ; ce qu'une messagerie aurait collé après (ponctuation) est ignoré.
  const hex = /^([0-9a-f]{64})(?![0-9a-z])/i.exec(texte);
  if (hex) return Uint8Array.from(hex[1].match(/../g), (h) => parseInt(h, 16));
  if (!RE_CLE_TEXTE.test(texte)) throw new Error("Lien incomplet : clé absente ou mal formée");
  const K = base64urlVersOctets(texte);
  if (K.length !== TAILLE_CLE) throw new Error("Lien incomplet : clé de mauvaise taille");
  return K;
}

/** Identifiant de salon d'un chemin « /d/<id> » (avec ou sans base devant), ou null. */
export function idSalonDuChemin(chemin) {
  const m = /\/d\/([0-9a-f]{32})\/?$/.exec(String(chemin ?? ""));
  return m ? m[1] : null;
}

/**
 * Lit un lien complet et vérifie que l'id du chemin dérive bien de la clé :
 * un lien abîmé ou recollé avec une autre clé est refusé.
 */
export async function lireLien(url) {
  const texte = String(url ?? "");
  const diese = texte.indexOf("#");
  const id = idSalonDuChemin(diese < 0 ? texte : texte.slice(0, diese));
  if (!id) throw new Error("Lien invalide : identifiant de document absent");
  const K = cleDuFragment(diese < 0 ? "" : texte.slice(diese));
  if ((await deriverIdSalon(K)) !== id) throw new Error("Lien abîmé : la clé ne correspond pas au document");
  return { id, K };
}

export const cleVersTexte = (K) => octetsVersBase64url(cle(K));
export const texteVersCle = (texte) => cleDuFragment(texte);
export { octetsVersBase64url, base64urlVersOctets, hexVersOctets };
