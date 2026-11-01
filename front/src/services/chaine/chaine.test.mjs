// Vérifie front/src/services/chaine/crypto.js (WebCrypto) contre docs/CHAINE-VECTEURS.json
// (généré avec node:crypto par generer-vecteurs.mjs), puis les cas d'erreur.
//
// Lancer : node --test front/src/services/chaine/   (ou npm run test:chaine)

import assert from "node:assert/strict";
import { createHash, createHmac, hkdfSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as C from "./crypto.js";

const ici = dirname(fileURLToPath(import.meta.url));
const V = JSON.parse(readFileSync(resolve(ici, "../../../../docs/CHAINE-VECTEURS.json"), "utf8"));
const S = C.hexVersOctets(V.S);
const octets = (texte) => new TextEncoder().encode(texte);

test("les vecteurs sont cohérents avec un recalcul node:crypto indépendant", () => {
  const h = (info, n) => Buffer.from(hkdfSync("sha256", Buffer.from(V.S, "hex"), Buffer.alloc(0), info, n)).toString("hex");
  assert.equal(h("lector-id", 16), V.id);
  assert.equal(h("lector-enc", 32), V.K_enc);
  assert.equal(h("lector-mac", 32), V.K_mac);
  assert.equal(h("lector-proof", 32), V.P);
  assert.equal(createHash("sha256").update(Buffer.from(V.P, "hex")).digest("hex"), V.P_sha256_stocke_serveur);
  const docId = createHmac("sha256", Buffer.from(V.K_mac, "hex")).update(V.doc.chemin).digest("hex");
  assert.equal(docId, V.doc.docId);
});

test("dérivation : id, clés, preuve", async () => {
  assert.equal(await C.deriveId(S), V.id);
  assert.equal(await C.deriveId(V.S), V.id, "S accepté aussi en hex");
  assert.ok(C.estIdValide(V.id));
  const { enc, mac } = await C.deriveKeys(S);
  assert.equal(C.octetsVersHex(enc), V.K_enc);
  assert.equal(C.octetsVersHex(mac), V.K_mac);
  assert.equal(C.octetsVersHex(await C.derivePreuve(S)), V.P);
  const cles = await C.preparer(S);
  assert.equal(cles.id, V.id);
  assert.equal(cles.preuve, V.P_base64url);
  assert.equal(C.octetsVersHex(S), V.S, "preparer ne modifie pas le S de l'appelant");
});

test("les clés préparées ne sont pas exportables", async () => {
  const cles = await C.preparer(S);
  assert.equal(cles.cleEnc.extractable, false);
  assert.equal(cles.cleMac.extractable, false);
  await assert.rejects(globalThis.crypto.subtle.exportKey("raw", cles.cleEnc));
  await assert.rejects(globalThis.crypto.subtle.exportKey("raw", cles.cleMac));
});

test("docId du chemin Pro/Notes.md", async () => {
  const cles = await C.preparer(S);
  assert.equal(await C.docIdAvec(cles, V.doc.chemin), V.doc.docId);
  assert.ok(C.estDocIdValide(V.doc.docId));
});

test("pathEnc et contentEnc avec IV fixés", async () => {
  const cles = await C.preparer(S);
  const { docId, pathEnc, contentEnc } = await C.chiffrerDocAvec(cles, V.doc.chemin, octets(V.doc.contenu.clair_utf8), {
    ivChemin: V.doc.chemin_chiffre.iv,
    ivContenu: V.doc.contenu.iv,
  });
  assert.equal(docId, V.doc.docId);
  assert.equal(pathEnc, V.doc.chemin_chiffre.pathEnc);
  assert.equal(C.octetsVersHex(contentEnc), V.doc.contenu.contentEnc_hex);
  assert.equal(C.octetsVersBase64(contentEnc), V.doc.contenu.contentEnc_base64);
  assert.equal(contentEnc.length, V.doc.contenu.taille_bloc);
  assert.equal(contentEnc.length, octets(V.doc.contenu.clair_utf8).length + C.SURCOUT_ENVELOPPE);
  assert.equal(await C.sha256Hex(contentEnc), V.doc.contenu.contentEnc_sha256);
  assert.equal(await C.sha256Hex(octets(V.doc.contenu.clair_utf8)), V.doc.contenu.clair_sha256);
});

test("déchiffrement des vecteurs", async () => {
  const cles = await C.preparer(S);
  assert.equal(await C.dechiffrerCheminAvec(cles, V.doc.docId, V.doc.chemin_chiffre.pathEnc), V.doc.chemin);
  const clair = await C.dechiffrerContenuAvec(cles, V.doc.docId, C.hexVersOctets(V.doc.contenu.contentEnc_hex));
  assert.equal(new TextDecoder().decode(clair), V.doc.contenu.clair_utf8);
});

test("aller-retour avec IV aléatoires, deux chiffrements différents", async () => {
  const cles = await C.preparer(S);
  const contenu = octets("# Été\n\nUn texte accentué, avec des émojis 📚.\n");
  const a = await C.chiffrerDocAvec(cles, "Perso/Lecture.md", contenu);
  const b = await C.chiffrerDocAvec(cles, "Perso/Lecture.md", contenu);
  assert.equal(a.docId, b.docId, "docId stable pour un même chemin");
  assert.notEqual(a.pathEnc, b.pathEnc);
  assert.notDeepEqual(a.contentEnc, b.contentEnc);
  assert.deepEqual(await C.dechiffrerContenuAvec(cles, a.docId, b.contentEnc), contenu);
  assert.equal(await C.dechiffrerCheminAvec(cles, a.docId, b.pathEnc), "Perso/Lecture.md");
  const vide = await C.chiffrerDocAvec(cles, "vide.md", new Uint8Array(0));
  assert.equal(vide.contentEnc.length, C.SURCOUT_ENVELOPPE);
  assert.equal((await C.dechiffrerContenuAvec(cles, vide.docId, vide.contentEnc)).length, 0);
});

test("normalisation NFC : la forme NFD de macOS donne le même docId", async () => {
  const cles = await C.preparer(S);
  const nfc = Buffer.from(V.normalisation.chemin_nfc_hex, "hex").toString("utf8");
  const nfd = Buffer.from(V.normalisation.chemin_nfd_hex, "hex").toString("utf8");
  assert.notEqual(nfc, nfd);
  assert.equal(await C.docIdAvec(cles, nfc), V.normalisation.docId);
  assert.equal(await C.docIdAvec(cles, nfd), V.normalisation.docId);
  assert.equal(C.normaliserChemin(nfd), nfc);
});

test("chemins invalides refusés", async () => {
  const cles = await C.preparer(S);
  for (const chemin of V.chemins_invalides) {
    assert.throws(() => C.normaliserChemin(chemin), /Chemin invalide/, JSON.stringify(chemin));
    await assert.rejects(C.docIdAvec(cles, chemin), /Chemin invalide/);
  }
  assert.throws(() => C.normaliserChemin("a/".repeat(600) + "b"), /trop long/);
  assert.throws(() => C.normaliserChemin(42), /Chemin invalide/);
});

test("altérations détectées : contenu, IV, version, AAD, mauvaise clé", async () => {
  const cles = await C.preparer(S);
  const env = C.hexVersOctets(V.doc.contenu.contentEnc_hex);
  const docId = V.doc.docId;

  const flip = (i) => {
    const copie = new Uint8Array(env);
    copie[i] ^= 0x01;
    return copie;
  };
  await assert.rejects(C.dechiffrerContenuAvec(cles, docId, flip(env.length - 1)), /authentification refusée/, "étiquette");
  await assert.rejects(C.dechiffrerContenuAvec(cles, docId, flip(20)), /authentification refusée/, "chiffré");
  await assert.rejects(C.dechiffrerContenuAvec(cles, docId, flip(3)), /authentification refusée/, "IV");
  await assert.rejects(C.dechiffrerContenuAvec(cles, docId, flip(0)), /version/, "version");
  await assert.rejects(C.dechiffrerContenuAvec(cles, docId, env.subarray(0, 20)), /trop court/);

  // Le serveur échange le bloc d'un document avec celui d'un autre : AAD différente.
  const autreId = await C.docIdAvec(cles, "Pro/Autre.md");
  await assert.rejects(C.dechiffrerContenuAvec(cles, autreId, env), /authentification refusée/);
  // Le serveur met le contenu à la place du chemin : AAD "chemin:" différente.
  await assert.rejects(C.dechiffrerCheminAvec(cles, docId, C.octetsVersBase64url(env)), /authentification refusée/);
  // Le serveur met le chemin à la place du contenu.
  await assert.rejects(
    C.dechiffrerContenuAvec(cles, docId, C.base64urlVersOctets(V.doc.chemin_chiffre.pathEnc)),
    /authentification refusée/,
  );
  // Une autre chaîne ne lit rien.
  const autre = await C.preparer(V.rotation.S);
  await assert.rejects(C.dechiffrerContenuAvec(autre, docId, env), /authentification refusée/);
  await assert.rejects(C.dechiffrerCheminAvec(autre, docId, V.doc.chemin_chiffre.pathEnc), /authentification refusée/);
  // docId mal formé.
  await assert.rejects(C.dechiffrerContenuAvec(cles, "ABC", env), /Identifiant de document invalide/);
  // IV de mauvaise taille.
  await assert.rejects(C.chiffrerContenuAvec(cles, docId, octets("x"), "00112233445566778899aabbccddeeff"), /IV invalide/);
});

test("pathEnc valide mais attaché au mauvais docId : refusé", async () => {
  const cles = await C.preparer(S);
  // Un client bogué chiffre "Pro/Autre.md" sous le docId de Pro/Notes.md : l'AAD passe,
  // mais le HMAC recalculé ne correspond pas.
  const pathEnc = await C.chiffrerCheminAvec(cles, V.doc.docId, "Pro/Autre.md");
  await assert.rejects(C.dechiffrerCheminAvec(cles, V.doc.docId, pathEnc), /incohérent/);
});

test("rotation : nouvel S, nouvel id, nouveaux docId", async () => {
  assert.equal(await C.deriveId(V.rotation.S), V.rotation.id);
  const cles2 = await C.preparer(V.rotation.S);
  assert.equal(await C.docIdAvec(cles2, V.doc.chemin), V.rotation.docId_Pro_Notes);
  assert.notEqual(V.rotation.id, V.id);
  assert.notEqual(V.rotation.docId_Pro_Notes, V.doc.docId);
});

test("12 mots BIP39", async () => {
  assert.deepEqual(await C.toWords(S), V.mots);
  assert.deepEqual(await C.fromWords(V.mots), S);
  assert.deepEqual(await C.fromWords(`  ${V.mots.join("  ").toUpperCase()}\n`), S, "casse et espaces ignorés");
  assert.deepEqual(await C.fromWords(V.mots.join(", ")), S, "virgules acceptées");
  await assert.rejects(C.fromWords(V.mots_somme_invalide), /Somme de contrôle/);
  await assert.rejects(C.fromWords(V.mots.slice(0, 11)), /exactement 12 mots/);
  await assert.rejects(C.fromWords([...V.mots.slice(0, 11), "lector"]), /Mot inconnu/);
  for (let i = 0; i < 20; i++) {
    const s = C.nouveauSecret();
    assert.deepEqual(await C.fromWords(await C.toWords(s)), s);
  }
});

test("ancien lien d'appairage : encore lu, plus jamais produit", async () => {
  assert.equal(C.toLink, undefined, "aucun lien ouvrable n'est produit");
  assert.deepEqual(C.fromLink(V.lien), S);
  assert.deepEqual(C.secretDuFragment(`#chaine=${V.S_base64url}`), S);
  assert.throws(() => C.fromLink("https://lector.dockerbop.fr/app/"), /fragment absent/);
  assert.throws(() => C.fromLink("https://lector.dockerbop.fr/app/#s=AAECAwQFBgcICQoLDA0ODw"), /paramètre chaine/);
  assert.throws(() => C.fromLink("https://lector.dockerbop.fr/app/#chaine=AAEC"), /mauvaise taille/);
});

test("lireSaisie : 12 mots, code ou ancien lien", async () => {
  const parMots = await C.lireSaisie(V.mots.join(" "));
  assert.deepEqual(parMots.S, S);
  assert.equal(parMots.origine, null);
  assert.deepEqual((await C.lireSaisie(`  ${V.lien}  `)).S, S);
  await assert.rejects(C.lireSaisie("   "), /Saisie vide/);
});

test("secret invalide refusé", async () => {
  await assert.rejects(C.deriveId(new Uint8Array(15)), /Secret invalide/);
  await assert.rejects(C.preparer("00"), /Hexadécimal invalide|Secret invalide/);
  assert.throws(() => C.toCode(new Uint8Array(32)), /Secret invalide/);
});

test("code d'appairage (QR) : pas une adresse web, lu par lireSaisie", async () => {
  const code = C.toCode(S);
  assert.equal(code, `lector-chaine:${V.S_base64url}`);
  assert.equal(code, V.code);
  assert.doesNotMatch(code, /^https?:|#/, "le QR ne doit pas s'ouvrir dans un navigateur");
  assert.deepEqual(C.fromCode(code), S);
  assert.deepEqual((await C.lireSaisie(`  ${code.toUpperCase().replace(/^LECTOR-CHAINE:/, "Lector-Chaine:")}`)).S.length, 16);
  assert.deepEqual((await C.lireSaisie(code)).S, S);
  assert.throws(() => C.fromCode("lector-chaine:AAEC"), /mauvaise taille/);
  assert.throws(() => C.fromCode("lector-chaine:AA+C"), /base64url/);
  assert.throws(() => C.fromCode(V.lien), /préfixe/);
});

test("marque de suppression : authentique, liée au docId et au bloc supprimé", async () => {
  const cles = await C.preparer(S);
  const autres = await C.preparer(C.nouveauSecret());
  const docId = await C.docIdAvec(cles, "Pro/Notes.md");
  const autreDoc = await C.docIdAvec(cles, "Pro/Autre.md");
  const sha = "a".repeat(64);
  const marque = await C.chiffrerTombeAvec(cles, docId, sha);
  assert.match(marque, /^[A-Za-z0-9_-]+$/);
  assert.equal(await C.verifierTombeAvec(cles, docId, marque, sha), true);
  // Autre bloc (rejeu sur une version plus récente), autre document, autre chaîne, absente, altérée.
  assert.equal(await C.verifierTombeAvec(cles, docId, marque, "b".repeat(64)), false);
  assert.equal(await C.verifierTombeAvec(cles, autreDoc, marque, sha), false);
  assert.equal(await C.verifierTombeAvec(autres, docId, marque, sha), false);
  assert.equal(await C.verifierTombeAvec(cles, docId, null, sha), false);
  assert.equal(await C.verifierTombeAvec(cles, docId, "", sha), false);
  const env = C.base64urlVersOctets(marque);
  env[env.length - 1] ^= 1;
  assert.equal(await C.verifierTombeAvec(cles, docId, C.octetsVersBase64url(env), sha), false);
  // Un pathEnc (même clé, autre AAD) ne passe pas pour une marque de suppression.
  const pathEnc = await C.chiffrerCheminAvec(cles, docId, "Pro/Notes.md");
  assert.equal(await C.verifierTombeAvec(cles, docId, pathEnc, sha), false);
  await assert.rejects(C.chiffrerTombeAvec(cles, docId, "pas-une-empreinte"), /Empreinte/);
});
