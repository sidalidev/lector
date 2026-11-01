// Le serveur simulé suit le contrat du vrai (docs/CHAINE.md § 5.2) sur deux
// points que les clients ne voient pas d'eux-mêmes : bornes de X-Lector-Mtime
// et plafond des pierres tombales.
// Lancer : npm run test:chaine

import { test } from "node:test";
import assert from "node:assert/strict";
import { creerServeurSimule } from "./serveur-simule.mjs";

const ID = "0123456789abcdef0123456789abcdef";
const ENTETES = { "x-lector-chain-id": ID, "x-lector-chain-proof": "A".repeat(43) };
const BLOC = Uint8Array.from({ length: 40 }, (_, i) => (i === 0 ? 1 : i));
const PATH_ENC = "AQ" + "A".repeat(30);
const TOMB_ENC = "AQ" + "B".repeat(30);
const docId = (n) => n.toString(16).padStart(64, "0");

async function casier(options) {
  const serveur = creerServeurSimule(options);
  assert.equal((await serveur.fetch("/v1/chain", { method: "POST", headers: ENTETES })).status, 201);
  const deposer = (id, mtime) => serveur.fetch(`/v1/chain/docs/${id}`, {
    method: "PUT",
    body: BLOC,
    headers: { ...ENTETES, "x-lector-path-enc": PATH_ENC, ...(mtime === undefined ? {} : { "x-lector-mtime": mtime }) },
  });
  const supprimer = (id) => serveur.fetch(`/v1/chain/docs/${id}`, { method: "DELETE", headers: { ...ENTETES, "x-lector-tomb-enc": TOMB_ENC } });
  const manifeste = async () => (await serveur.fetch("/v1/chain/manifest", { headers: ENTETES })).json();
  return { deposer, supprimer, manifeste };
}

test("X-Lector-Mtime : années 0 à 9999, sinon 400 MTIME_INVALID ; absent, la date du serveur", async () => {
  const { deposer } = await casier();
  for (const mtime of ["+010000-01-01T00:00:00.000Z", "-000001-12-31T00:00:00.000Z", "pas une date"]) {
    const r = await deposer(docId(1), mtime);
    assert.equal(r.status, 400, mtime);
    assert.equal((await r.json()).code, "MTIME_INVALID");
  }
  for (const mtime of ["0000-01-01T00:00:00.000Z", "9999-12-31T23:59:59.999Z", undefined]) {
    assert.equal((await deposer(docId(2), mtime)).status, 200, String(mtime));
  }
});

test("Au plus maxDocs pierres tombales par casier : les plus anciennes partent d'abord", async () => {
  const { deposer, supprimer, manifeste } = await casier({ maxDocs: 2 });
  for (const n of [1, 2]) assert.equal((await deposer(docId(n))).status, 200);
  for (const n of [1, 2]) assert.equal((await supprimer(docId(n))).status, 204);
  assert.equal((await deposer(docId(3))).status, 200);
  assert.equal((await supprimer(docId(3))).status, 204);
  const tombes = (await manifeste()).docs.filter((d) => d.deletedAt).map((d) => d.docId).sort();
  assert.deepEqual(tombes, [docId(2), docId(3)]);
});
