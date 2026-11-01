// Génère docs/CHAINE-VECTEURS.json avec node:crypto, une implémentation
// indépendante de crypto.js (WebCrypto). chaine.test.mjs vérifie ensuite que
// crypto.js retrouve exactement ces valeurs.
//
// Usage : node front/src/services/chaine/generer-vecteurs.mjs [chemin de sortie]

import { createCipheriv, createHash, createHmac, hkdfSync } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MOTS } from "./bip39-english.js";

const ici = dirname(fileURLToPath(import.meta.url));
const sortie = resolve(process.argv[2] ?? resolve(ici, "../../../../docs/CHAINE-VECTEURS.json"));

const hex = (b) => Buffer.from(b).toString("hex");
const b64url = (b) => Buffer.from(b).toString("base64url");
const hkdf = (S, info, n) => Buffer.from(hkdfSync("sha256", S, Buffer.alloc(0), Buffer.from(info, "utf8"), n));

function enveloppe(cle, iv, clair, aad) {
  const c = createCipheriv("aes-256-gcm", cle, iv, { authTagLength: 16 });
  c.setAAD(Buffer.from(aad, "utf8"));
  const chiffre = Buffer.concat([c.update(clair), c.final()]);
  const tag = c.getAuthTag();
  return { chiffre, tag, env: Buffer.concat([Buffer.from([1]), iv, chiffre, tag]) };
}

function mots(S) {
  let bits = 0n;
  for (const o of S) bits = (bits << 8n) | BigInt(o);
  bits = (bits << 4n) | BigInt(createHash("sha256").update(S).digest()[0] >> 4);
  const out = [];
  for (let i = 11; i >= 0; i--) out.push(MOTS[Number((bits >> BigInt(i * 11)) & 0x7ffn)]);
  return out;
}

const S = Buffer.from("000102030405060708090a0b0c0d0e0f", "hex");
const id = hex(hkdf(S, "lector-id", 16));
const K_enc = hkdf(S, "lector-enc", 32);
const K_mac = hkdf(S, "lector-mac", 32);
const P = hkdf(S, "lector-proof", 32);
const docIdDe = (chemin) => createHmac("sha256", K_mac).update(Buffer.from(chemin.normalize("NFC"), "utf8")).digest("hex");

const chemin = "Pro/Notes.md";
const contenu = Buffer.from("# Test\n", "utf8");
const ivChemin = Buffer.from("0a0b0c0d0e0f101112131415", "hex");
const ivContenu = Buffer.from("00112233445566778899aabb", "hex");
const docId = docIdDe(chemin);
const ch = enveloppe(K_enc, ivChemin, Buffer.from(chemin, "utf8"), `chemin:${docId}`);
const co = enveloppe(K_enc, ivContenu, contenu, docId);

const accentNfc = "Été/Réunion.md".normalize("NFC");
const accentNfd = accentNfc.normalize("NFD");

// Variante de S pour montrer qu'une nouvelle chaîne change tout (rotation).
const S2 = Buffer.from("f0e0d0c0b0a090807060504030201000", "hex");
const K_mac2 = hkdf(S2, "lector-mac", 32);

const vecteurs = {
  description:
    "Vecteurs de test de la chaîne Lector (voir docs/CHAINE.md). Valeurs binaires en hex minuscule sauf mention contraire. " +
    "HKDF-SHA256 avec sel vide. Enveloppe = 01 || iv (12 octets) || chiffré || étiquette (16 octets). " +
    "Générés par front/src/services/chaine/generer-vecteurs.mjs (node:crypto), vérifiés par chaine.test.mjs (WebCrypto).",
  S: hex(S),
  S_base64url: b64url(S),
  id,
  K_enc: hex(K_enc),
  K_mac: hex(K_mac),
  P: hex(P),
  P_base64url: b64url(P),
  P_sha256_stocke_serveur: createHash("sha256").update(P).digest("hex"),
  mots: mots(S),
  code: `lector-chaine:${b64url(S)}`,
  lien: `https://lector.dockerbop.fr/app/#chaine=${b64url(S)}`,
  note_lien: "Ancien lien d'appairage : plus produit, encore accepté à la saisie.",
  doc: {
    chemin,
    docId,
    note_iv:
      "AES-GCM utilise des IV de 12 octets partout (taille recommandée par NIST SP 800-38D, seule acceptée par certaines " +
      "bibliothèques natives). L'IV du contenu est formé des 12 premiers octets de 00112233445566778899aabbccddeeff.",
    chemin_chiffre: {
      iv: hex(ivChemin),
      aad: `chemin:${docId}`,
      chiffre: hex(ch.chiffre),
      etiquette: hex(ch.tag),
      enveloppe_hex: hex(ch.env),
      pathEnc: b64url(ch.env),
    },
    contenu: {
      clair_utf8: contenu.toString("utf8"),
      clair_sha256: createHash("sha256").update(contenu).digest("hex"),
      iv: hex(ivContenu),
      aad: docId,
      chiffre: hex(co.chiffre),
      etiquette: hex(co.tag),
      contentEnc_hex: hex(co.env),
      contentEnc_base64: co.env.toString("base64"),
      contentEnc_sha256: createHash("sha256").update(co.env).digest("hex"),
      taille_bloc: co.env.length,
    },
  },
  normalisation: {
    note: "Le chemin est normalisé en Unicode NFC avant le HMAC : la forme NFD (macOS) donne le même docId.",
    chemin_nfc_hex: hex(Buffer.from(accentNfc, "utf8")),
    chemin_nfd_hex: hex(Buffer.from(accentNfd, "utf8")),
    docId: docIdDe(accentNfc),
  },
  chemins_invalides: ["", "/Pro/Notes.md", "Pro//Notes.md", "Pro/./Notes.md", "../Notes.md", "Pro/Notes.md/", "a\u0000b"],
  mots_somme_invalide: [
    "abandon", "amount", "liar", "amount", "expire", "adjust", "cage", "candy", "arch", "gather", "drum", "zoo",
  ],
  rotation: {
    note: "Nouvelle chaîne : un autre S donne un autre id et un autre docId pour le même chemin.",
    S: hex(S2),
    id: hex(hkdf(S2, "lector-id", 16)),
    docId_Pro_Notes: createHmac("sha256", K_mac2).update(Buffer.from(chemin, "utf8")).digest("hex"),
  },
};

writeFileSync(sortie, `${JSON.stringify(vecteurs, null, 2)}\n`);
console.log(`Vecteurs écrits dans ${sortie}`);
