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

test("conflit en ligne : la version d'ici devient une copie, la note reprend celle du casier", async () => {
  const { ici, ailleurs } = await deuxAppareils();
  await ici.ecrire("Courses.md", "pain\n");
  await ailleurs.lister();
  await ailleurs.lireTexte("Courses.md");
  await ailleurs.ecrire("Courses.md", "pain\nlait\n");

  const r = await ici.ecrire("Courses.md", "pain\noeufs\n", { surConflit: "copie" });
  assert.match(r.conflit.copie, /^Courses \(conflict \d{4}-\d\d-\d\d-\d\d-\d\d\)\.md$/);
  assert.equal(r.conflit.texte, "pain\nlait\n");
  await ailleurs.lister();
  assert.equal(await ailleurs.lireTexte("Courses.md"), "pain\nlait\n");
  assert.equal(await ailleurs.lireTexte(r.conflit.copie), "pain\noeufs\n");

  // La note suit maintenant la version du casier : l'écriture suivante passe.
  await ici.ecrire("Courses.md", "pain\nlait\nbeurre\n", { surConflit: "copie" });
  await ailleurs.lister();
  assert.equal(await ailleurs.lireTexte("Courses.md"), "pain\nlait\nbeurre\n");

  // Deuxième conflit dans la même minute : une autre copie, la première reste.
  await ailleurs.lireTexte("Courses.md");
  await ailleurs.ecrire("Courses.md", "v3\n");
  const r2 = await ici.ecrire("Courses.md", "v3 bis\n", { surConflit: "copie" });
  assert.notEqual(r2.conflit.copie, r.conflit.copie);
  await ailleurs.lister();
  assert.equal(await ailleurs.lireTexte(r.conflit.copie), "pain\noeufs\n");
  assert.equal(await ailleurs.lireTexte(r2.conflit.copie), "v3 bis\n");
});

test("conflit en ligne : même texte des deux côtés, pas de copie ; supprimée ailleurs, la note est recréée", async () => {
  const { ici, ailleurs } = await deuxAppareils();
  await ici.ecrire("A.md", "x\n");
  await ailleurs.lister();
  await ailleurs.lireTexte("A.md");
  await ailleurs.ecrire("A.md", "pareil\n");
  assert.deepEqual(await ici.ecrire("A.md", "pareil\n", { surConflit: "copie" }), { conflit: null });

  await ailleurs.lister();
  await ailleurs.supprimer("A.md");
  await ici.ecrire("A.md", "toujours là\n", { surConflit: "copie" });
  const liste = (await ailleurs.lister()).map((d) => d.chemin);
  assert.deepEqual(liste, ["A.md"]);
  assert.equal(await ailleurs.lireTexte("A.md"), "toujours là\n");

  // Sans l'option, le 412 reste une erreur (rappels, autres appelants).
  await ailleurs.ecrire("A.md", "autre\n");
  await assert.rejects(ici.ecrire("A.md", "écrase ?"), (e) => e.status === 412);
});

test("note trop grosse : gardée sur l'appareil (relue, listée, jamais envoyée), partie dès qu'elle repasse sous la limite", async () => {
  const { ici, ailleurs, attente } = await deuxAppareils();
  await ici.lister();
  ici.serveur.maxDocBytes = 100;
  const gros = "x".repeat(150);
  await assert.rejects(ici.ecrire("Gros.md", gros), (e) => e.status === 413 && e.code === "DOC_TOO_LARGE");
  assert.equal((await attente.toutes())[0].refus, "DOC_TOO_LARGE");
  assert.equal(await ici.lireTexte("Gros.md"), gros);
  ici.clairs.clear();
  assert.equal(await ici.lireTexte("Gros.md"), gros, "relue depuis l'appareil, pas seulement le cache");
  assert.deepEqual((await ici.lister()).map((d) => d.chemin), ["Gros.md"]);
  assert.equal(await ici.envoyerEnAttente({ refus: true }), 0, "jamais renvoyée telle quelle");

  await ici.ecrire("Gros.md", "court\n");
  assert.equal((await attente.toutes()).length, 0);
  await ailleurs.lister();
  assert.equal(await ailleurs.lireTexte("Gros.md"), "court\n");
});

test("casier plein : la note reste sur l'appareil, repart au démarrage suivant une fois la place libérée", async () => {
  const { ici, ailleurs, attente } = await deuxAppareils();
  await ici.ecrire("A.md", "a\n");
  let plein = true;
  const deposer = ici.client.deposer.bind(ici.client);
  ici.client.deposer = (...a) => (plein ? Promise.reject(new (class extends Error { status = 413; code = "QUOTA_EXCEEDED"; })()) : deposer(...a));
  await assert.rejects(ici.ecrire("A.md", "a\nb\n"), (e) => e.code === "QUOTA_EXCEEDED");
  assert.equal(await ici.lireTexte("A.md"), "a\nb\n");
  assert.equal(await ici.envoyerEnAttente(), 0, "pas de renvoi toutes les 30 s");
  plein = false;
  assert.equal(await ici.envoyerEnAttente({ refus: true }), 1);
  assert.equal((await attente.toutes()).length, 0);
  await ailleurs.lister();
  assert.equal(await ailleurs.lireTexte("A.md"), "a\nb\n");
});
