// Cryptographie de la chaîne Lector (voir docs/CHAINE.md).
//
// Origine : adapté du projet Sonne (web/crypto.js, Apache-2.0, même
// auteur). Ce qui change par rapport à Sonne : les infos HKDF propres à Lector
// ("lector-id", "lector-enc", "lector-mac", "lector-proof"), l'identifiant
// opaque des documents (HMAC du chemin), le format d'enveloppe des blocs
// chiffrés et le code d'appairage (lector-chaine:). Les 12 mots BIP39 et les
// conversions sont repris tels quels.
//
// Module ES sans dépendance au DOM : il tourne dans le navigateur, dans la vue
// web Capacitor, dans le processus principal d'Electron (import dynamique) et
// dans Node 22 (globalThis.crypto.subtle). Il est vérifié contre
// docs/CHAINE-VECTEURS.json par chaine.test.mjs.
//
// Les secrets et les clés sont des Uint8Array. Les fonctions qui utilisent
// WebCrypto sont asynchrones.

import { MOTS } from "./bip39-english.js";

/** Taille du secret S en octets (128 bits, soit 12 mots). */
export const TAILLE_SECRET = 16;

/** Version du format d'enveloppe (premier octet de chaque bloc chiffré). */
export const VERSION_ENVELOPPE = 1;

/** Taille de l'IV AES-GCM en octets (96 bits, la taille recommandée). */
export const TAILLE_IV = 12;

/** Taille de l'étiquette d'authentification AES-GCM en octets. */
export const TAILLE_TAG = 16;

/** Surcoût d'une enveloppe : version + IV + étiquette. */
export const SURCOUT_ENVELOPPE = 1 + TAILLE_IV + TAILLE_TAG;

/** Longueur maximale d'un chemin normalisé, en octets UTF-8. */
export const TAILLE_MAX_CHEMIN = 1024;

/** Nom du paramètre du fragment qui portait S dans l'ancien lien d'appairage. */
const PARAM_LIEN = "chaine";

const RE_ID = /^[0-9a-f]{32}$/;
const RE_DOC_ID = /^[0-9a-f]{64}$/;

const subtle = () => {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error("WebCrypto indisponible : ouvre la page en HTTPS ou sur localhost");
  return s;
};
const utf8 = (texte) => new TextEncoder().encode(texte);

// ---------------------------------------------------------------------------
// Conversions
// ---------------------------------------------------------------------------

export function octetsVersHex(octets) {
  return Array.from(new Uint8Array(octets), (o) => o.toString(16).padStart(2, "0")).join("");
}

export function hexVersOctets(hex) {
  if (typeof hex !== "string" || hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) {
    throw new Error("Hexadécimal invalide");
  }
  const octets = new Uint8Array(hex.length / 2);
  for (let i = 0; i < octets.length; i++) octets[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return octets;
}

export function octetsVersBase64(octets) {
  let binaire = "";
  for (const o of new Uint8Array(octets)) binaire += String.fromCharCode(o);
  return btoa(binaire);
}

export function base64VersOctets(texte) {
  const binaire = atob(texte);
  const octets = new Uint8Array(binaire.length);
  for (let i = 0; i < binaire.length; i++) octets[i] = binaire.charCodeAt(i);
  return octets;
}

export function octetsVersBase64url(octets) {
  return octetsVersBase64(octets).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64urlVersOctets(texte) {
  if (typeof texte !== "string" || !/^[A-Za-z0-9_-]*={0,2}$/.test(texte)) throw new Error("base64url invalide");
  const b64 = texte.replace(/=+$/, "").replace(/-/g, "+").replace(/_/g, "/");
  return base64VersOctets(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
}

/** Aléa cryptographique. */
export function aleatoire(taille) {
  return globalThis.crypto.getRandomValues(new Uint8Array(taille));
}

/** Empreinte SHA-256 en hex (sert au manifeste local : clair et bloc chiffré). */
export async function sha256Hex(octets) {
  return octetsVersHex(await subtle().digest("SHA-256", octets));
}

/** Nouveau secret de chaîne, 16 octets aléatoires. */
export function nouveauSecret() {
  return aleatoire(TAILLE_SECRET);
}

/** Normalise S : Uint8Array de 16 octets ou chaîne hex de 32 caractères. Renvoie une copie. */
function secret(S) {
  const octets = typeof S === "string" ? hexVersOctets(S) : S instanceof Uint8Array ? new Uint8Array(S) : null;
  if (!octets || octets.length !== TAILLE_SECRET) throw new Error("Secret invalide : 16 octets attendus");
  return octets;
}

function ivEnOctets(iv) {
  const octets = typeof iv === "string" ? hexVersOctets(iv) : iv instanceof Uint8Array ? iv : null;
  if (!octets || octets.length !== TAILLE_IV) throw new Error(`IV invalide : ${TAILLE_IV} octets attendus`);
  return octets;
}

// ---------------------------------------------------------------------------
// Identifiant, preuve et clés
// ---------------------------------------------------------------------------

/** HKDF-SHA256(S, sel vide, info), sortie de `longueur` octets (32 par défaut). */
async function hkdf(S, info, longueur = 32) {
  const base = await subtle().importKey("raw", secret(S), "HKDF", false, ["deriveBits"]);
  const bits = await subtle().deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: utf8(info) },
    base,
    longueur * 8,
  );
  return new Uint8Array(bits);
}

/** Identifiant de chaîne : hex(HKDF-SHA256(S, sel vide, "lector-id", 16 octets)). Public. */
export async function deriveId(S) {
  return octetsVersHex(await hkdf(S, "lector-id", 16));
}

export function estIdValide(id) {
  return typeof id === "string" && RE_ID.test(id);
}

export function estDocIdValide(docId) {
  return typeof docId === "string" && RE_DOC_ID.test(docId);
}

/** Preuve d'appartenance P = HKDF-SHA256(S, sel vide, "lector-proof", 32 octets). Le serveur n'en garde que SHA-256(P). */
export async function derivePreuve(S) {
  return hkdf(S, "lector-proof", 32);
}

/** K_enc et K_mac en octets bruts : HKDF-SHA256(S, sel vide, info, 32 octets). */
export async function deriveKeys(S) {
  return { enc: await hkdf(S, "lector-enc"), mac: await hkdf(S, "lector-mac") };
}

/**
 * Prépare tout ce qu'il faut pour un appareil : id, preuve (base64url, à envoyer
 * au serveur) et clés WebCrypto non exportables. À appeler une fois, puis passer
 * le résultat aux fonctions ...Avec.
 */
export async function preparer(S) {
  const s = secret(S);
  const { enc, mac } = await deriveKeys(s);
  const preuve = await derivePreuve(s);
  const cleEnc = await subtle().importKey("raw", enc, "AES-GCM", false, ["encrypt", "decrypt"]);
  const cleMac = await subtle().importKey("raw", mac, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  enc.fill(0);
  mac.fill(0);
  const cles = { id: await deriveId(s), preuve: octetsVersBase64url(preuve), cleEnc, cleMac };
  preuve.fill(0);
  s.fill(0);
  return cles;
}

// ---------------------------------------------------------------------------
// Chemins et identifiants opaques
// ---------------------------------------------------------------------------

/**
 * Chemin canonique d'un document : relatif à la racine du vault, séparateur "/",
 * Unicode NFC, sans segment vide, "." ou "..", sans caractère NUL, 1024 octets UTF-8
 * au plus. La casse est conservée. Lève une erreur si le chemin est invalide.
 * Convertir les séparateurs du système (\ sous Windows) est le rôle de l'appelant.
 */
export function normaliserChemin(chemin) {
  if (typeof chemin !== "string" || chemin.length === 0) throw new Error("Chemin invalide : vide");
  const nfc = chemin.normalize("NFC");
  if (nfc.includes("\0")) throw new Error("Chemin invalide : caractère NUL");
  const segments = nfc.split("/");
  for (const seg of segments) {
    if (seg === "" || seg === "." || seg === "..") throw new Error(`Chemin invalide : ${chemin}`);
  }
  if (utf8(nfc).length > TAILLE_MAX_CHEMIN) throw new Error("Chemin invalide : trop long");
  return nfc;
}

/** docId = hex(HMAC-SHA256(K_mac, UTF-8 du chemin normalisé)), 64 caractères. */
export async function docIdAvec(cles, chemin) {
  const sig = await subtle().sign("HMAC", cles.cleMac, utf8(normaliserChemin(chemin)));
  return octetsVersHex(sig);
}

/** Données associées (AAD) : le contenu est lié à docId, le chemin à "chemin:" + docId. */
const aadContenu = (docId) => utf8(docId);
const aadChemin = (docId) => utf8(`chemin:${docId}`);
const aadTombe = (docId) => utf8(`tombe:${docId}`);

// ---------------------------------------------------------------------------
// Enveloppe : version (1 octet) ‖ IV (12 octets) ‖ chiffré ‖ étiquette (16 octets)
// ---------------------------------------------------------------------------

async function sceller(cleEnc, clair, aad, iv) {
  const vecteur = ivEnOctets(iv);
  const chiffre = new Uint8Array(
    await subtle().encrypt({ name: "AES-GCM", iv: vecteur, additionalData: aad, tagLength: 128 }, cleEnc, clair),
  );
  const env = new Uint8Array(1 + TAILLE_IV + chiffre.length);
  env[0] = VERSION_ENVELOPPE;
  env.set(vecteur, 1);
  env.set(chiffre, 1 + TAILLE_IV);
  return env;
}

async function ouvrir(cleEnc, enveloppe, aad) {
  const env = enveloppe instanceof Uint8Array ? enveloppe : new Uint8Array(enveloppe);
  if (env.length < SURCOUT_ENVELOPPE) throw new Error("Bloc invalide : trop court");
  if (env[0] !== VERSION_ENVELOPPE) throw new Error(`Bloc invalide : version ${env[0]} inconnue`);
  try {
    const clair = await subtle().decrypt(
      { name: "AES-GCM", iv: env.subarray(1, 1 + TAILLE_IV), additionalData: aad, tagLength: 128 },
      cleEnc,
      env.subarray(1 + TAILLE_IV),
    );
    return new Uint8Array(clair);
  } catch {
    throw new Error("Bloc illisible : authentification refusée");
  }
}

function verifierDocId(docId) {
  if (!estDocIdValide(docId)) throw new Error("Identifiant de document invalide");
}

/** Chiffre le contenu d'un document : enveloppe binaire (corps du PUT). */
export async function chiffrerContenuAvec(cles, docId, octets, iv = aleatoire(TAILLE_IV)) {
  verifierDocId(docId);
  return sceller(cles.cleEnc, octets, aadContenu(docId), iv);
}

/** Déchiffre le contenu d'un document. Lève une erreur si la clé ou le docId ne correspondent pas. */
export async function dechiffrerContenuAvec(cles, docId, enveloppe) {
  verifierDocId(docId);
  return ouvrir(cles.cleEnc, enveloppe, aadContenu(docId));
}

/** Chiffre le chemin d'un document : enveloppe en base64url (champ pathEnc). */
export async function chiffrerCheminAvec(cles, docId, chemin, iv = aleatoire(TAILLE_IV)) {
  verifierDocId(docId);
  return octetsVersBase64url(await sceller(cles.cleEnc, utf8(normaliserChemin(chemin)), aadChemin(docId), iv));
}

/**
 * Déchiffre un pathEnc et vérifie que HMAC(K_mac, chemin) redonne bien docId :
 * un bloc déplacé ou fabriqué est refusé.
 */
export async function dechiffrerCheminAvec(cles, docId, pathEnc) {
  verifierDocId(docId);
  let env;
  try {
    env = base64urlVersOctets(pathEnc);
  } catch {
    throw new Error("Chemin chiffré invalide : base64url attendu");
  }
  const chemin = new TextDecoder("utf-8", { fatal: true }).decode(await ouvrir(cles.cleEnc, env, aadChemin(docId)));
  if ((await docIdAvec(cles, chemin)) !== docId) throw new Error("Chemin chiffré incohérent avec son identifiant");
  return chemin;
}

// ---------------------------------------------------------------------------
// Marque de suppression (pierre tombale authentifiée, docs/CHAINE.md § 3.5)
//
// Un appareil qui supprime un document joint à son DELETE une marque chiffrée :
// AES-GCM(K_enc, "supprime:" + docId + ":" + empreinte du bloc supprimé), AAD
// "tombe:" + docId. Le serveur la garde avec la pierre tombale sans pouvoir la
// lire ni la fabriquer. Un autre appareil ne retire un fichier de son disque que
// si la marque est authentique, porte ce docId ET l'empreinte du bloc qu'il
// connaissait : un serveur ne peut ni inventer une suppression, ni rejouer une
// ancienne marque sur une version plus récente du document.
// ---------------------------------------------------------------------------

const RE_SHA = /^[0-9a-f]{64}$/;

/** Marque de suppression du bloc d'empreinte `shaBloc`, en base64url (en-tête X-Lector-Tomb-Enc). */
export async function chiffrerTombeAvec(cles, docId, shaBloc, iv = aleatoire(TAILLE_IV)) {
  verifierDocId(docId);
  if (shaBloc !== "" && !RE_SHA.test(String(shaBloc))) throw new Error("Empreinte de bloc invalide");
  return octetsVersBase64url(await sceller(cles.cleEnc, utf8(`supprime:${docId}:${shaBloc}`), aadTombe(docId), iv));
}

/**
 * Vrai si `tombEnc` est une marque authentique de suppression de CE document et
 * de CE bloc (`shaAttendu`, l'empreinte que l'appareil connaissait). Ne lève jamais.
 */
export async function verifierTombeAvec(cles, docId, tombEnc, shaAttendu) {
  try {
    if (!estDocIdValide(docId) || typeof tombEnc !== "string" || !tombEnc || !RE_SHA.test(String(shaAttendu))) return false;
    const clair = new TextDecoder("utf-8", { fatal: true }).decode(
      await ouvrir(cles.cleEnc, base64urlVersOctets(tombEnc), aadTombe(docId)),
    );
    return clair === `supprime:${docId}:${shaAttendu}`;
  } catch {
    return false;
  }
}

/** Chiffre un document complet : { docId, pathEnc, contentEnc }. */
export async function chiffrerDocAvec(cles, chemin, octets, { ivChemin, ivContenu } = {}) {
  const docId = await docIdAvec(cles, chemin);
  const pathEnc = await chiffrerCheminAvec(cles, docId, chemin, ivChemin ?? aleatoire(TAILLE_IV));
  const contentEnc = await chiffrerContenuAvec(cles, docId, octets, ivContenu ?? aleatoire(TAILLE_IV));
  return { docId, pathEnc, contentEnc };
}

// ---------------------------------------------------------------------------
// 12 mots BIP39 (repris de Sonne)
// ---------------------------------------------------------------------------

async function controle4bits(s) {
  return new Uint8Array(await subtle().digest("SHA-256", s))[0] >> 4;
}

/** S vers 12 mots BIP39 anglais. */
export async function toWords(S) {
  const s = secret(S);
  let bits = 0n;
  for (const o of s) bits = (bits << 8n) | BigInt(o);
  bits = (bits << 4n) | BigInt(await controle4bits(s));
  const mots = [];
  for (let i = 11; i >= 0; i--) mots.push(MOTS[Number((bits >> BigInt(i * 11)) & 0x7ffn)]);
  return mots;
}

/** 12 mots (tableau ou texte) vers S. Insensible à la casse et aux espaces. */
export async function fromWords(words) {
  const liste = (Array.isArray(words) ? words.join(" ") : String(words ?? ""))
    .trim()
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean);
  if (liste.length !== 12) throw new Error("Il faut exactement 12 mots");
  let bits = 0n;
  for (const mot of liste) {
    const index = MOTS.indexOf(mot);
    if (index < 0) throw new Error(`Mot inconnu : ${mot}`);
    bits = (bits << 11n) | BigInt(index);
  }
  const controle = Number(bits & 0xfn);
  let entropie = bits >> 4n;
  const s = new Uint8Array(TAILLE_SECRET);
  for (let i = TAILLE_SECRET - 1; i >= 0; i--) {
    s[i] = Number(entropie & 0xffn);
    entropie >>= 8n;
  }
  if (controle !== (await controle4bits(s))) throw new Error("Somme de contrôle incorrecte : vérifie les mots");
  return s;
}

// ---------------------------------------------------------------------------
// Ancien lien d'appairage : https://.../app/#chaine=<base64url(S)>
// Plus produit nulle part ; seulement relu, si quelqu'un colle un vieux lien.
// ---------------------------------------------------------------------------

/** Lit S dans un fragment seul (« #chaine=… » ou « chaine=… »). */
export function secretDuFragment(fragment) {
  const params = new URLSearchParams(String(fragment ?? "").replace(/^#/, ""));
  const valeur = params.get(PARAM_LIEN);
  if (!valeur || !/^[A-Za-z0-9_-]+={0,2}$/.test(valeur)) {
    throw new Error(`Lien invalide : paramètre ${PARAM_LIEN} absent ou mal formé`);
  }
  const s = base64urlVersOctets(valeur);
  if (s.length !== TAILLE_SECRET) throw new Error("Lien invalide : secret de mauvaise taille");
  return s;
}

/** Ancien lien complet vers S. */
export function fromLink(url) {
  const texte = String(url ?? "");
  const diese = texte.indexOf("#");
  if (diese < 0) throw new Error("Lien invalide : fragment absent");
  return secretDuFragment(texte.slice(diese));
}

// ---------------------------------------------------------------------------
// Code d'appairage (contenu du QR) : « lector-chaine:<base64url(S)> ».
// Ce n'est PAS une adresse web : l'appareil photo d'un téléphone ne l'ouvre pas
// dans le navigateur, donc S n'entre ni dans l'historique du navigateur ni dans
// sa synchronisation (Chrome, iCloud). Il se lit par le scanner intégré de Lector.
// ---------------------------------------------------------------------------

export const PREFIXE_CODE = "lector-chaine:";

export function toCode(S) {
  return `${PREFIXE_CODE}${octetsVersBase64url(secret(S))}`;
}

export function fromCode(texte) {
  const t = String(texte ?? "").trim();
  if (!t.toLowerCase().startsWith(PREFIXE_CODE)) throw new Error("Code invalide : préfixe lector-chaine: absent");
  const valeur = t.slice(PREFIXE_CODE.length);
  if (!/^[A-Za-z0-9_-]+$/.test(valeur)) throw new Error("Code invalide : base64url attendu");
  const s = base64urlVersOctets(valeur);
  if (s.length !== TAILLE_SECRET) throw new Error("Code invalide : secret de mauvaise taille");
  return s;
}

/**
 * Lit S dans ce que l'utilisateur a collé ou scanné : le code d'appairage, les
 * 12 mots, ou un ancien lien. Renvoie { S, origine } où origine est l'origine
 * de l'ancien lien (ou null).
 */
export async function lireSaisie(texte) {
  const t = String(texte ?? "").trim();
  if (!t) throw new Error("Saisie vide : colle le code ou tes 12 mots");
  if (t.toLowerCase().startsWith(PREFIXE_CODE)) return { S: fromCode(t), origine: null };
  if (t.includes("#")) {
    const S = fromLink(t);
    let origine = null;
    try {
      origine = new URL(t).origin;
    } catch {
      origine = null;
    }
    return { S, origine };
  }
  return { S: await fromWords(t), origine: null };
}
