// Cryptographie et lien du partage de documents (docs/collab-design.md § 2 à 4).
// Lancer : npm run test:chaine

import { test } from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import {
  BLOC_REMPLISSAGE,
  NATURES,
  chiffrerMessage,
  cleDuFragment,
  completer,
  dechiffrerMessage,
  deriverIdSalon,
  empreinteProprietaire,
  idSalonDuChemin,
  lienInvitation,
  lireLien,
  nouveauSecretProprietaire,
  nouvelleCle,
  preparerSalon,
  retirerRemplissage,
} from "./crypto.js";
import { appliquerTexte } from "./salon.js";
import { hkdfOctets, octetsVersHex, base64urlVersOctets } from "../chaine/crypto.js";

const K_FIXE = Uint8Array.from({ length: 32 }, (_, i) => i);

test("Dérivations : HKDF-SHA256 avec des infos propres au partage, distinctes de la chaîne", async () => {
  const id = await deriverIdSalon(K_FIXE);
  assert.match(id, /^[0-9a-f]{32}$/);
  assert.equal(id, octetsVersHex(await hkdfOctets(K_FIXE, "lector-salon-id", 16)));
  // Même clé, info de la chaîne : autre valeur. Un id de salon n'est jamais un id de chaîne.
  assert.notEqual(id, octetsVersHex(await hkdfOctets(K_FIXE, "lector-id", 16)));
  const salon = await preparerSalon(K_FIXE);
  assert.equal(salon.id, id);
  assert.equal(base64urlVersOctets(salon.preuve).length, 32);
  // La preuve ne contient ni la clé ni l'id.
  assert.notEqual(salon.preuve, octetsVersHex(K_FIXE));
  assert.equal(salon.cleEnc.extractable, false);
});

test("Deux clés tirées au hasard : ids, preuves différents ; la clé fait 256 bits", async () => {
  const a = nouvelleCle();
  const b = nouvelleCle();
  assert.equal(a.length, 32);
  assert.notDeepEqual(a, b);
  assert.notEqual(await deriverIdSalon(a), await deriverIdSalon(b));
  assert.notEqual((await preparerSalon(a)).preuve, (await preparerSalon(b)).preuve);
});

test("Lien : la clé est dans le fragment seulement, l'id dans le chemin dérive de la clé", async () => {
  const K = nouvelleCle();
  const lien = await lienInvitation("https://lector.dockerbop.fr/", K);
  const url = new URL(lien);
  assert.equal(url.origin, "https://lector.dockerbop.fr");
  assert.equal(url.pathname, `/d/${await deriverIdSalon(K)}`);
  assert.equal(url.search, "");
  // Ce que le navigateur envoie au serveur (origine + chemin) ne contient pas la clé.
  const cleTexte = url.hash.slice(1);
  assert.ok(!(url.origin + url.pathname).includes(cleTexte));
  const lu = await lireLien(lien);
  assert.deepEqual(lu.K, K);
  assert.deepEqual(cleDuFragment(url.hash), K);
  assert.equal(idSalonDuChemin("/app/d/" + lu.id), lu.id);
});

test("Lien abîmé ou recollé avec une autre clé : refusé", async () => {
  const K = nouvelleCle();
  const lien = await lienInvitation("https://x.test", K);
  const autre = await lienInvitation("https://x.test", nouvelleCle());
  const recolle = lien.split("#")[0] + "#" + autre.split("#")[1];
  await assert.rejects(lireLien(recolle), /ne correspond pas/);
  await assert.rejects(lireLien(lien.split("#")[0]), /clé absente/);
  await assert.rejects(lireLien(lien.slice(0, -3)), /clé absente/);
  await assert.rejects(lireLien("https://x.test/d/123#abc"), /identifiant/);
});

test("Lien : clé en hexadécimal, qu'aucune messagerie ne coupe ; ponctuation collée après ignorée ; anciens liens lus", async () => {
  const K = nouvelleCle();
  const lien = await lienInvitation("https://x.test", K);
  assert.match(lien, /#[0-9a-f]{64}$/);
  const hash = new URL(lien).hash;
  assert.deepEqual(cleDuFragment(hash + "."), K);
  assert.deepEqual(cleDuFragment(hash.toUpperCase()), K);
  // Lien envoyé avant ce changement (base64url).
  assert.deepEqual(cleDuFragment("#" + Buffer.from(K).toString("base64url")), K);
});

test("Message : aller-retour, remplissage au multiple de 64 octets", async () => {
  const salon = await preparerSalon(nouvelleCle());
  for (const taille of [0, 1, 59, 60, 61, 1000]) {
    const donnees = Uint8Array.from({ length: taille }, (_, i) => i & 0xff);
    const env = await chiffrerMessage(salon, NATURES.DOC, donnees);
    const octets = base64urlVersOctets(env);
    assert.equal((octets.length - 29) % BLOC_REMPLISSAGE, 0, `taille ${taille}`);
    assert.deepEqual(await dechiffrerMessage(salon, NATURES.DOC, env), donnees);
  }
  assert.deepEqual(retirerRemplissage(completer(Uint8Array.of(7, 8))), Uint8Array.of(7, 8));
});

test("Message lié au salon et à sa nature : un autre salon, une autre nature ou un octet changé échouent", async () => {
  const a = await preparerSalon(nouvelleCle());
  const b = await preparerSalon(nouvelleCle());
  const env = await chiffrerMessage(a, NATURES.DOC, new TextEncoder().encode("Chapitre 1"));
  await assert.rejects(dechiffrerMessage(b, NATURES.DOC, env));
  await assert.rejects(dechiffrerMessage(a, NATURES.PRESENCE, env));
  // Même clé, autre id : l'AAD protège aussi contre un déplacement entre salons.
  await assert.rejects(dechiffrerMessage({ ...a, id: b.id }, NATURES.DOC, env));
  const octets = base64urlVersOctets(env);
  octets[octets.length - 1] ^= 1;
  const abime = Buffer.from(octets).toString("base64url");
  await assert.rejects(dechiffrerMessage(a, NATURES.DOC, abime));
});

test("Le texte n'apparaît pas dans l'enveloppe", async () => {
  const salon = await preparerSalon(nouvelleCle());
  const texte = "INT. CUISINE - NUIT. Marie ouvre la porte.";
  const doc = new Y.Doc();
  doc.getText("md").insert(0, texte);
  const env = await chiffrerMessage(salon, NATURES.DOC, Y.encodeStateAsUpdate(doc));
  const brut = Buffer.from(base64urlVersOctets(env)).toString("latin1");
  assert.ok(!brut.includes("CUISINE"));
  assert.ok(!env.includes("CUISINE"));
});

test("Secret de propriétaire : 32 octets, seule son empreinte SHA-256 sort", async () => {
  const O = nouveauSecretProprietaire();
  assert.equal(O.length, 32);
  assert.match(await empreinteProprietaire(O), /^[0-9a-f]{64}$/);
});

test("appliquerTexte : une modification minimale, qui fusionne avec une modification distante", () => {
  const a = new Y.Doc();
  const b = new Y.Doc();
  a.getText("md").insert(0, "Il était une fois.\nFin.");
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  // a : le fichier a été modifié hors de l'éditeur ; b : un co-auteur ajoute une ligne.
  assert.equal(appliquerTexte(a.getText("md"), "Il était une fois un roi.\nFin."), true);
  assert.equal(appliquerTexte(a.getText("md"), "Il était une fois un roi.\nFin."), false);
  b.getText("md").insert(b.getText("md").length, "\nÉpilogue.");
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  assert.equal(a.getText("md").toString(), "Il était une fois un roi.\nFin.\nÉpilogue.");
  assert.equal(b.getText("md").toString(), a.getText("md").toString());
  appliquerTexte(a.getText("md"), "");
  assert.equal(a.getText("md").toString(), "");
});
