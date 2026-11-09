// Intégration : vrais clients SalonCollab contre le vrai relais (back/services/collab/relais.js)
// sur un serveur HTTP local, stockage en mémoire. Deux personnes écrivent en
// même temps, coupent, reviennent ; on vérifie la convergence et que le relais
// n'a jamais vu un octet de texte en clair.
// Lancer : npm run test:chaine

import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { nouvelleCle, nouveauSecretProprietaire, preparerSalon, cleVersTexte } from "./crypto.js";
import { SalonCollab, STATUTS, arreterSalon, urlRelais } from "./salon.js";

const require = createRequire(import.meta.url);
const { creerRelais } = require("../../../../back/services/collab/relais.js");
const { creerStockageMemoire } = require("../../../../back/services/collab/stockageMemoire.js");

const ouverts = [];
after(async () => {
  for (const f of ouverts) await f();
});

async function demarrerRelais(config = {}) {
  const stockage = creerStockageMemoire();
  const trames = [];
  const relais = creerRelais({ stockage, config: { limitesActives: false, ...config }, espion: (t) => trames.push(t) });
  const serveur = http.createServer((_req, res) => res.end());
  relais.attacher(serveur);
  await new Promise((r) => serveur.listen(0, "127.0.0.1", r));
  const url = urlRelais(`http://127.0.0.1:${serveur.address().port}`);
  ouverts.push(() => {
    relais.fermer();
    serveur.close();
  });
  return { stockage, trames, url, relais };
}

async function attendre(condition, message = "condition", delaiMs = 5000) {
  const fin = Date.now() + delaiMs;
  while (!(await condition())) {
    if (Date.now() > fin) throw new Error(`Délai dépassé : ${message}`);
    await new Promise((r) => setTimeout(r, 15));
  }
}

/** Une personne : un Y.Doc, sa présence, son client. */
async function personne({ K, url, nom, O = null, etat = {} }) {
  const doc = new Y.Doc();
  if (etat.local) Y.applyUpdate(doc, etat.local);
  const presence = new Awareness(doc);
  presence.setLocalStateField("user", { name: nom, color: "#d9a43b" });
  const statuts = [];
  const sauves = [];
  const client = new SalonCollab({
    salon: await preparerSalon(K),
    doc,
    presence,
    url,
    secretProprietaire: O,
    etat,
    onStatut: (s) => statuts.push(s),
    onSauver: (e) => sauves.push(e),
  });
  ouverts.push(() => {
    client.fermer();
    presence.destroy();
  });
  const texte = doc.getText("md");
  return {
    doc, presence, client, texte, statuts, sauves,
    lire: () => texte.toString(),
    noms: () => [...presence.getStates().values()].map((s) => s.user?.name).filter(Boolean).sort(),
  };
}

function sansClair(trames, stockage, interdits) {
  const { journaux } = stockage._tout();
  const stocke = [...journaux.values()].flat().map((e) => e.d.toString("latin1")).join("\n");
  for (const mot of interdits) {
    for (const t of trames) assert.ok(!t.includes(mot), `trame en clair : ${mot}`);
    assert.ok(!stocke.includes(mot), `stockage en clair : ${mot}`);
  }
}

test("Deux personnes écrivent en même temps : même texte des deux côtés, prénoms visibles", async () => {
  const { url, trames, stockage } = await demarrerRelais();
  const K = nouvelleCle();
  const O = nouveauSecretProprietaire();

  const sid = await personne({ K, url, nom: "Sidali Prénom", O });
  sid.texte.insert(0, "SCÈNE 1\n");
  sid.client.connecter();
  await attendre(() => sid.client.statut === STATUTS.EN_LIGNE, "propriétaire en ligne");

  const lea = await personne({ K, url, nom: "Léa Martin" });
  lea.client.connecter();
  await attendre(() => lea.lire() === "SCÈNE 1\n", "rattrapage de l'invitée");

  // Frappe entrelacée, des deux côtés, sans attendre l'autre.
  for (let i = 0; i < 30; i++) {
    sid.texte.insert(sid.texte.length, `sidtape${i} `);
    lea.texte.insert(0, `leatape${i} `);
    if (i % 7 === 0) await new Promise((r) => setTimeout(r, 5));
  }
  await attendre(() => sid.lire() === lea.lire() && sid.lire().includes("sidtape29") && sid.lire().includes("leatape29"), "convergence");
  assert.match(sid.lire(), /SCÈNE 1/);
  await attendre(() => sid.noms().join() === "Léa Martin,Sidali Prénom" && lea.noms().join() === "Léa Martin,Sidali Prénom", "présence");

  // Ni le texte, ni les prénoms, ni la clé : ni dans les trames, ni dans ce que le relais garde.
  sansClair(trames, stockage, ["SCÈNE", "sidtape29", "leatape29", "Léa Martin", "Sidali Prénom", "Martin", cleVersTexte(K)]);
  assert.ok(trames.length > 30, "le relais a bien vu passer les échanges");
});

test("Coupure : chacun écrit hors ligne, la reconnexion fusionne sans rien perdre", async () => {
  const { url } = await demarrerRelais();
  const K = nouvelleCle();
  const sid = await personne({ K, url, nom: "Sid", O: nouveauSecretProprietaire() });
  sid.texte.insert(0, "Acte I.\n");
  sid.client.connecter();
  await attendre(() => sid.client.statut === STATUTS.EN_LIGNE, "en ligne");
  const lea = await personne({ K, url, nom: "Léa" });
  lea.client.connecter();
  await attendre(() => lea.lire() === "Acte I.\n", "rattrapage");

  lea.client.couper();
  assert.equal(lea.client.statut, STATUTS.HORS_LIGNE);
  lea.texte.insert(lea.texte.length, "Hors ligne chez Léa.\n");
  sid.texte.insert(0, "Titre\n");
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(!sid.lire().includes("Léa"), "rien n'a pu passer pendant la coupure");

  // Reconnexion automatique (recul de 1 s).
  await attendre(() => lea.client.statut === STATUTS.EN_LIGNE, "reconnexion", 5000);
  await attendre(() => sid.lire() === lea.lire(), "convergence après coupure");
  assert.equal(sid.lire(), "Titre\nActe I.\nHors ligne chez Léa.\n");
});

test("Onglet fermé hors ligne puis rouvert : l'état sauvé repart et fusionne", async () => {
  const { url } = await demarrerRelais();
  const K = nouvelleCle();
  const sid = await personne({ K, url, nom: "Sid", O: nouveauSecretProprietaire() });
  sid.texte.insert(0, "Début.\n");
  sid.client.connecter();
  const lea = await personne({ K, url, nom: "Léa" });
  lea.client.connecter();
  await attendre(() => lea.lire() === "Début.\n", "rattrapage");

  lea.client.couper();
  lea.texte.insert(lea.texte.length, "Écrit dans le train.\n");
  await lea.client.fermer(); // sauve
  const etat = lea.sauves.at(-1);
  assert.ok(etat.local.length && etat.serveur.length && etat.seq > 0);

  sid.texte.insert(sid.texte.length, "Pendant ce temps.\n");

  const lea2 = await personne({ K, url, nom: "Léa", etat });
  assert.match(lea2.lire(), /train/);
  lea2.client.connecter();
  await attendre(() => lea2.lire() === sid.lire() && sid.lire().includes("train") && sid.lire().includes("Pendant"), "fusion");
});

test("Arrêter le partage : tout le monde est coupé, le salon répond comme inexistant, la copie reste", async () => {
  const { url } = await demarrerRelais();
  const K = nouvelleCle();
  const O = nouveauSecretProprietaire();
  const sid = await personne({ K, url, nom: "Sid", O });
  sid.texte.insert(0, "Brouillon partagé.");
  sid.client.connecter();
  const lea = await personne({ K, url, nom: "Léa" });
  lea.client.connecter();
  await attendre(() => lea.lire() === "Brouillon partagé.", "rattrapage");

  // Une invitée n'a pas O : refusé, rien ne change.
  const salon = await preparerSalon(K);
  assert.equal(await arreterSalon({ salon, secretProprietaire: nouveauSecretProprietaire(), url, delaiMs: 500 }), false);
  assert.equal(lea.client.statut, STATUTS.EN_LIGNE);

  assert.equal(await arreterSalon({ salon, secretProprietaire: O, url }), true);
  await attendre(() => lea.client.statut === STATUTS.ARRETE && sid.client.statut === STATUTS.ARRETE, "arrêt reçu");
  assert.equal(lea.lire(), "Brouillon partagé.", "l'invitée garde sa copie");

  // Ni l'invitée, ni le propriétaire avec la même clé ne peuvent rouvrir ce salon.
  const retour = await personne({ K, url, nom: "Léa" });
  retour.client.connecter();
  await attendre(() => retour.client.statut === STATUTS.ARRETE, "inexistant pour l'invitée");
  const recree = await personne({ K, url, nom: "Sid", O });
  recree.client.connecter();
  await attendre(() => recree.client.statut === STATUTS.ARRETE, "pas de recréation");
  assert.equal(await arreterSalon({ salon, secretProprietaire: O, url }), true, "déjà arrêté : réponse identique");
});

test("Salon jamais créé ou mauvaise preuve : inconnu ou refusé, sans rien révéler d'autre", async () => {
  const { url } = await demarrerRelais();
  const inconnu = await personne({ K: nouvelleCle(), url, nom: "X" });
  inconnu.client.connecter();
  await attendre(() => inconnu.client.statut === STATUTS.ARRETE, "inconnu");

  const K = nouvelleCle();
  const sid = await personne({ K, url, nom: "Sid", O: nouveauSecretProprietaire() });
  sid.client.connecter();
  await attendre(() => sid.client.statut === STATUTS.EN_LIGNE, "en ligne");
  const vrai = await preparerSalon(K);
  const faux = await preparerSalon(nouvelleCle());
  const doc = new Y.Doc();
  const intrus = new SalonCollab({ salon: { ...faux, id: vrai.id }, doc, url });
  ouverts.push(() => intrus.fermer());
  intrus.connecter();
  await attendre(() => intrus.statut === STATUTS.REFUSE, "preuve refusée");
});

test("Compactage : le journal reste court, un nouvel arrivant reçoit tout le texte", async () => {
  const { url, stockage } = await demarrerRelais({ compacterApres: 5 });
  const K = nouvelleCle();
  const sid = await personne({ K, url, nom: "Sid", O: nouveauSecretProprietaire() });
  sid.client.connecter();
  await attendre(() => sid.client.statut === STATUTS.EN_LIGNE, "en ligne");
  for (let i = 0; i < 40; i++) {
    sid.texte.insert(sid.texte.length, `ligne ${i}\n`);
    await new Promise((r) => setTimeout(r, 2));
  }
  await attendre(() => sid.client.enAttente.length === 0, "tout acquitté");
  const salon = await preparerSalon(K);
  await attendre(async () => (await stockage.entrees(salon.id, 0)).length <= 7, "journal compacté");
  const tard = await personne({ K, url, nom: "Tom" });
  tard.client.connecter();
  await attendre(() => tard.lire() === sid.lire() && tard.lire().includes("ligne 39"), "rattrapage après compactage");
});

test("Quota du salon : la modification reste sur l'appareil et l'interface le sait", async () => {
  const { url } = await demarrerRelais({ quotaOctets: 2000 });
  const K = nouvelleCle();
  const sid = await personne({ K, url, nom: "Sid", O: nouveauSecretProprietaire() });
  sid.client.connecter();
  await attendre(() => sid.client.statut === STATUTS.EN_LIGNE, "en ligne");
  sid.texte.insert(0, "x".repeat(5000));
  await attendre(() => sid.client.statut === STATUTS.PLEIN, "plein");
  assert.equal(sid.lire().length, 5000);
});
