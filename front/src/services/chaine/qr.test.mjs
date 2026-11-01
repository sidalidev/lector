// Tests de l'encodeur QR (qr.js). La justesse a aussi été vérifiée par décodage
// réel avec OpenCV (cv2.QRCodeDetector) sur les versions 1, 2, 4, 6, 8 et 10 ;
// l'empreinte ci-dessous fige le QR d'un texte de référence (l'ancien lien des
// vecteurs) tel qu'il a été décodé. Le QR affiché aujourd'hui porte le code
// d'appairage « lector-chaine:<base64url(S)> ».

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { _interne, cheminSVG, encoderQR } from "./qr.js";

const LIEN = "https://lector.dockerbop.fr/app/#chaine=AAECAwQFBgcICQoLDA0ODw";
const CODE = "lector-chaine:AAECAwQFBgcICQoLDA0ODw";

// Évaluation d'un polynôme (coefficients du degré le plus haut au plus bas) en x, dans GF(256).
function mul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}
const evaluer = (coefs, x) => coefs.reduce((acc, c) => mul(acc, x) ^ c, 0);

test("Reed-Solomon : chaque bloc (données + correction) a des syndromes nuls", () => {
  for (const texte of [CODE, LIEN, "a", "x".repeat(150), "z".repeat(213)]) {
    const octets = new TextEncoder().encode(texte);
    for (let v = 1; v <= 10; v++) {
      if (_interne.capaciteOctets(v).max < octets.length) continue;
      const { blocs } = _interne.codewords(octets, v);
      for (const b of blocs) {
        const mot = [...b.d, ...b.c];
        let alpha = 1;
        for (let i = 0; i < b.c.length; i++) {
          assert.equal(evaluer(mot, alpha), 0, `syndrome ${i} non nul (version ${v})`);
          alpha = mul(alpha, 2);
        }
      }
    }
  }
});

test("le lien d'appairage tient en version 4 ou 5, correction M, et l'information de format est valide", () => {
  const q = encoderQR(LIEN);
  assert.ok(q.version <= 5);
  assert.equal(q.taille, q.version * 4 + 17);
  // Relit les 15 bits de format (première copie) et vérifie le code BCH et le niveau M.
  const m = q.modules;
  const lus = [];
  for (let i = 0; i <= 5; i++) lus.push(m[i][8]);
  lus.push(m[7][8], m[8][8], m[8][7]);
  for (let i = 9; i < 15; i++) lus.push(m[8][14 - i]);
  const bits = lus.reduce((a, b, i) => a | ((b ? 1 : 0) << i), 0) ^ 0x5412;
  const donnees = bits >>> 10;
  let reste = donnees;
  for (let i = 0; i < 10; i++) reste = (reste << 1) ^ ((reste >>> 9) * 0x537);
  assert.equal(bits, (donnees << 10) | reste);
  assert.equal(donnees >>> 3, 0, "niveau M");
  assert.equal(donnees & 7, q.masque);
});

test("le code d'appairage tient en version 3, correction M", () => {
  const q = encoderQR(CODE);
  assert.equal(CODE.length, 36);
  assert.equal(q.version, 3);
  assert.equal(q.taille, 29);
  assert.match(cheminSVG(q), /^M\d+ \d+h1v1h-1z/);
});

test("motifs de repérage aux trois coins et module noir fixe", () => {
  const q = encoderQR(LIEN);
  const t = q.taille;
  for (const [x, y] of [[0, 0], [t - 7, 0], [0, t - 7]]) {
    assert.equal(q.modules[y][x], true);
    assert.equal(q.modules[y + 1][x + 1], false);
    assert.equal(q.modules[y + 3][x + 3], true);
  }
  assert.equal(q.modules[t - 8][8], true);
});

test("version 7 et plus : information de version présente et symétrique", () => {
  const q = encoderQR("v".repeat(130));
  assert.ok(q.version >= 7);
  const t = q.taille;
  for (let i = 0; i < 18; i++) {
    const a = t - 11 + (i % 3);
    const b = Math.floor(i / 3);
    assert.equal(q.modules[b][a], q.modules[a][b]);
  }
});

test("empreinte figée du QR du lien (décodé par OpenCV lors de l'écriture)", () => {
  const q = encoderQR(LIEN);
  const empreinte = createHash("sha256").update(q.modules.map((l) => l.map((b) => (b ? 1 : 0)).join("")).join("\n")).digest("hex");
  assert.equal(empreinte, EMPREINTE);
  assert.match(cheminSVG(q), /^M\d+ \d+h1v1h-1z/);
});

test("texte trop long refusé", () => {
  assert.throws(() => encoderQR("x".repeat(214)), /trop long/);
});

const EMPREINTE = "903bcbe9f40833e1e48f463cb516715e5d884d49c4f2b2e5dba609d50a4f3b6c";
