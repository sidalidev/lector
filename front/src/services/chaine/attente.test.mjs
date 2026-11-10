// Écritures hors ligne du vault web : gardées chiffrées, envoyées au retour,
// jamais d'écrasement silencieux d'une version écrite ailleurs pendant la coupure.
import assert from "node:assert/strict";
import { test } from "node:test";
import { creerServeurSimule } from "./serveur-simule.mjs";
import { clientDe, nouvelleChaine } from "./service.js";
import { preparer } from "./crypto.js";
import { VaultWebChaine } from "./web-vault.js";
import { fileEnMemoire, estErreurReseau } from "./attente.js";

const URL_SERVEUR = "http://serveur.test";

async function deuxAppareils() {
  const serveur = creerServeurSimule();
  const { S } = await nouvelleChaine();
  const cles = await preparer(S);
  let horsLigne = false;
  const fetchCoupable = (...a) => (horsLigne ? Promise.reject(new TypeError("Failed to fetch")) : serveur.fetch(...a));
  const client = clientDe(cles, { serverUrl: URL_SERVEUR, fetch: fetchCoupable });
  await client.creer();
  const attente = fileEnMemoire();
  const ici = new VaultWebChaine({ client, cles, attente });
  const ailleurs = new VaultWebChaine({ client: clientDe(cles, { serverUrl: URL_SERVEUR, fetch: serveur.fetch }), cles });
  return { ici, ailleurs, attente, couper: (v) => { horsLigne = v; } };
}

test("hors ligne : la note est gardée chiffrée, relue, listée, puis envoyée au retour", async () => {
  const { ici, ailleurs, attente, couper } = await deuxAppareils();
  await ici.ecrire("Script.md", "acte 1\n");
  await ici.lister();

  couper(true);
  assert.deepEqual(await ici.ecrire("Script.md", "acte 1\nacte 2\n"), { enAttente: true });
  assert.deepEqual(await ici.ecrire("Nouveau.md", "idée\n"), { enAttente: true });
  const gardees = await attente.toutes();
  assert.equal(gardees.length, 2);
  for (const e of gardees) assert.ok(!Buffer.from(e.bloc).toString("latin1").includes("acte 2"), "rien en clair dans la file");
  assert.equal(await ici.lireTexte("Script.md"), "acte 1\nacte 2\n");
  assert.deepEqual((await ici.lister()).map((d) => d.chemin), ["Nouveau.md", "Script.md"]);
  await assert.rejects(ici.envoyerEnAttente(), (err) => estErreurReseau(err));

  couper(false);
  assert.equal(await ici.envoyerEnAttente(), 2);
  assert.equal((await attente.toutes()).length, 0);
  await ailleurs.lister();
  assert.equal(await ailleurs.lireTexte("Script.md"), "acte 1\nacte 2\n");
  assert.equal(await ailleurs.lireTexte("Nouveau.md"), "idée\n");
});

test("modifiée ailleurs pendant la coupure : rien n'est écrasé, la version d'ici devient une copie", async () => {
  const { ici, ailleurs, couper } = await deuxAppareils();
  await ici.ecrire("Script.md", "base\n");
  await ailleurs.lister();
  await ailleurs.lireTexte("Script.md");

  couper(true);
  await ici.ecrire("Script.md", "version du train\n");
  await ailleurs.ecrire("Script.md", "version de la maison\n");

  couper(false);
  await ici.envoyerEnAttente();
  await ailleurs.lister();
  assert.equal(await ailleurs.lireTexte("Script.md"), "version de la maison\n");
  assert.equal(await ailleurs.lireTexte("Script (offline copy).md"), "version du train\n");
});
