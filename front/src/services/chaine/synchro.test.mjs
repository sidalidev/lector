// Tests des clients de la chaîne contre le serveur simulé (sans compte) :
// création et reprise, saisie des 12 mots, adoption, synchro à trois voies
// chiffrée, 412, blocs illisibles, markdown seulement dans les deux sens,
// quota et documents trop gros, renouvellement, tout effacer, preuve, flux,
// vault web et pierres tombales ; pertes de données évitées : casse des noms
// sur macOS et Windows, renouvellement incomplet, reprise d'une création,
// fichier enregistré pendant un cycle, suppression concurrente (If-Match),
// bloc absent du serveur.
//
// Lancer : npm run test:chaine

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { ClientChaine, ErreurChaine, MAX_DOC_BYTES_DEFAUT, estChaineInconnue, estLectureLimitee, estQuota } from "./client.js";
import { chiffrerCheminAvec, chiffrerContenuAvec, chiffrerTombeAvec, docIdAvec, preparer, toWords } from "./crypto.js";
import { creerServeurSimule } from "./serveur-simule.mjs";
import { ErreurSaisie, clientDe, lireSaisie, nouvelleChaine } from "./service.js";
import { VERSION_BASE, envoyerTout, estMarkdown, nomDeConflit, renouvelerChaine, synchroniserChaine } from "./synchro.js";
import { VaultWebChaine, construireArbre } from "./web-vault.js";

const URL_SERVEUR = "http://serveur.test";
const sha = (o) => createHash("sha256").update(o).digest("hex");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

/**
 * Vault en mémoire, avec le contrat du vrai (front/desktop/vault/vault.js) :
 * `attendu` vérifié avant d'écrire ou de retirer (ECHANGED sinon). Avec
 * { insensible: true }, il se comporte comme un disque macOS ou Windows : deux
 * noms qui ne diffèrent que par la casse désignent le même fichier, dont le nom
 * d'origine est gardé.
 */
class VaultMemoire {
  constructor(fichiers = {}, { insensible = false } = {}) {
    this.f = new Map();
    this.insensible = insensible;
    for (const [c, t] of Object.entries(fichiers)) this.writeClear(c, Buffer.from(t), "2026-10-01T00:00:00.000Z");
  }
  nom(c) {
    if (!this.insensible) return c;
    const cle = c.normalize("NFC").toLowerCase();
    return [...this.f.keys()].find((n) => n.normalize("NFC").toLowerCase() === cle) ?? c;
  }
  verifier(c, attendu) {
    const e = this.f.get(this.nom(c));
    if (attendu !== undefined && (e ? sha(e.octets) : null) !== attendu) throw Object.assign(new Error(`ECHANGED ${c}`), { code: "ECHANGED" });
  }
  scanManifest() {
    const out = {};
    for (const [c, { octets, mtime }] of this.f) out[c] = { sha256: sha(octets), size: octets.length, mtime };
    return out;
  }
  readClear(c) {
    const e = this.f.get(this.nom(c));
    if (!e) throw Object.assign(new Error(`ENOENT ${c}`), { code: "ENOENT" });
    return e.octets;
  }
  writeClear(c, octets, mtime, attendu) {
    this.verifier(c, attendu);
    this.f.set(this.nom(c), { octets: Buffer.from(octets), mtime: mtime || new Date().toISOString() });
  }
  remove(c, attendu) {
    if (!this.f.has(this.nom(c))) return;
    this.verifier(c, attendu);
    this.f.delete(this.nom(c));
  }
  absent(c) {
    return !this.f.has(this.nom(c));
  }
  texte(c) {
    return this.f.get(this.nom(c))?.octets.toString("utf8");
  }
  octets(c) {
    return this.f.get(this.nom(c))?.octets;
  }
  chemins() {
    return [...this.f.keys()].sort();
  }
}

/** Un appareil : son vault, sa base chaine.json, ses clés, son client. */
function appareil(serveur, nom, vault) {
  const a = {
    nom,
    vault,
    base: null,
    cles: null,
    client: null,
    async rejoindre(S) {
      a.cles = await preparer(S);
      a.client = clientDe(a.cles, { serverUrl: URL_SERVEUR, deviceId: nom, fetch: serveur.fetch });
    },
    async sync() {
      const r = await synchroniserChaine({ vault: a.vault, client: a.client, cles: a.cles, base: a.base });
      a.base = r.base;
      return r.ops;
    },
  };
  return a;
}

const FICHIERS_A = {
  "Pro/Notes.md": "# Notes\nContenu secret de Pro\n",
  "Été/Idée.md": "Une idée d'été\n",
  "Local seul.md": "Créé hors ligne\n",
};

/** Casier créé par l'appareil A, qui y envoie tout son vault. */
async function casierNeuf(fichiers = FICHIERS_A, options = {}) {
  const serveur = creerServeurSimule(options);
  const A = appareil(serveur, "Mac", new VaultMemoire(fichiers));
  const { S } = await nouvelleChaine();
  await A.rejoindre(S);
  await A.client.creer();
  const progression = [];
  const r = await envoyerTout({ vault: A.vault, client: A.client, cles: A.cles, onProgress: (f, t) => progression.push([f, t]) });
  A.base = r.base;
  return { serveur, A, S, r, progression };
}

const requetes = (serveur, methode, depuis = 0) => serveur.etat.journal.slice(depuis).filter((r) => r.methode === methode);

async function attendre(condition, delai = 3000) {
  const fin = Date.now() + delai;
  while (!condition()) {
    if (Date.now() > fin) throw new Error("Délai dépassé");
    await new Promise((r) => setTimeout(r, 10));
  }
}

test("création : tout est chiffré, aucune fuite de contenu ni de chemin, rien n'est renvoyé deux fois", async () => {
  const { serveur, A, r, progression } = await casierNeuf();
  assert.equal(r.envoyes, 3);
  assert.deepEqual(progression.at(-1), [3, 3]);
  const v = serveur.verification(A.cles.id);
  assert.equal(v.ok, true, JSON.stringify(v));
  assert.equal(v.blocs, 3);
  assert.equal(A.base.version, VERSION_BASE);
  const stockage = serveur.toutLeStockage();
  for (const fuite of ["Contenu secret", "idée d'été", "Pro/Notes", "Notes.md", "Local seul"]) {
    assert.equal(stockage.includes(Buffer.from(fuite)), false, `fuite : ${fuite}`);
  }
  // Rien ne part au cycle suivant, ni à un nouvel envoi complet.
  const avant = serveur.etat.journal.length;
  assert.equal((await A.sync()).put.length, 0);
  const encore = await envoyerTout({ vault: A.vault, client: A.client, cles: A.cles, base: A.base });
  assert.equal(encore.envoyes, 3);
  assert.equal(requetes(serveur, "PUT", avant).length, 0);
});

test("premier envoi coupé puis reprise : seuls les documents manquants partent", async () => {
  const serveur = creerServeurSimule();
  const fichiers = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`doc${i}.md`, `contenu ${i}`]));
  const A = appareil(serveur, "Mac", new VaultMemoire(fichiers));
  await A.rejoindre((await nouvelleChaine()).S);
  await A.client.creer();
  let depots = 0;
  const fragile = new ClientChaine({
    serverUrl: URL_SERVEUR,
    chainId: A.cles.id,
    preuve: A.cles.preuve,
    fetch: async (url, init = {}) => {
      if (init.method === "PUT" && ++depots > 3) throw new TypeError("fetch failed");
      return serveur.fetch(url, init);
    },
  });
  let base = null;
  const sauverBase = (b) => {
    base = b;
  };
  await assert.rejects(envoyerTout({ vault: A.vault, client: fragile, cles: A.cles, sauverBase, frequenceSauvegarde: 1 }), /fetch failed/);
  assert.equal(Object.keys(base.docs).length, 3);
  const avant = serveur.etat.journal.length;
  const r = await envoyerTout({ vault: A.vault, client: A.client, cles: A.cles, base });
  assert.equal(r.envoyes, 6);
  assert.equal(requetes(serveur, "PUT", avant).length, 3, "seuls les 3 documents non envoyés partent à la reprise");
  assert.equal(serveur.verification(A.cles.id).ok, true);
});

test("saisie : mots invalides refusés localement, mots d'une autre chaîne refusés par le serveur sans rien créer", async () => {
  const { serveur, S, A } = await casierNeuf();
  const avant = serveur.etat.journal.length;
  const mots = await toWords(S);
  assert.equal((await lireSaisie(mots.join(" ").toUpperCase())).id, A.cles.id);
  assert.equal((await lireSaisie(`lector-chaine:${Buffer.from(S).toString("base64url")}`)).id, A.cles.id);
  const faux = [...mots];
  faux[11] = faux[11] === "abandon" ? "ability" : "abandon";
  await assert.rejects(lireSaisie(faux.join(" ")), (e) => e instanceof ErreurSaisie && e.code === "CHECKSUM");
  await assert.rejects(lireSaisie(`${mots.slice(0, 11).join(" ")} zzzz`), (e) => e.code === "UNKNOWN_WORD" && e.detail === "zzzz");
  await assert.rejects(lireSaisie(mots.slice(0, 11).join(" ")), (e) => e.code === "WORD_COUNT");
  await assert.rejects(lireSaisie("lector-chaine:AAEC"), (e) => e.code === "INVALID_CODE");
  await assert.rejects(lireSaisie("   "), (e) => e.code === "EMPTY");
  assert.equal(serveur.etat.journal.length, avant, "aucune requête pendant la lecture des mots");

  const autre = await nouvelleChaine();
  const { S: S2 } = await lireSaisie(autre.mots.join(" "));
  const client = clientDe(await preparer(S2), { serverUrl: URL_SERVEUR, fetch: serveur.fetch });
  await assert.rejects(client.etat(), (e) => estChaineInconnue(e));
  assert.equal(serveur.etat.chaines.size, 1, "rejoindre ne crée jamais de casier");
});

test("adoption après une chaîne précédente : les quatre cas, et rien n'est supprimé", async () => {
  const { serveur, A, S } = await casierNeuf();
  A.vault.writeClear("Pro/Notes.md", Buffer.from("# Notes\nversion A\n"));
  A.vault.writeClear("Conflit.md", Buffer.from("A dit oui\n"));
  A.vault.writeClear("Pareil.md", Buffer.from("identique\n"));
  A.vault.writeClear("Offline.md", Buffer.from("ancienne\n"));
  await A.sync();

  // B arrive avec la base d'une chaîne précédente : elle dit qui a bougé depuis.
  const B = appareil(
    serveur,
    "PC",
    new VaultMemoire({
      "Pro/Notes.md": "# Notes\nContenu secret de Pro\n", // inchangé depuis l'ancienne base : on prend le serveur
      "Offline.md": "modifié hors ligne\n", // serveur = ancienne base : on pousse le local
      "Conflit.md": "B dit non\n", // les deux ont bougé : copie de conflit
      "Pareil.md": "identique\n", // même clair : rien
      "B seul.md": "seulement sur B\n", // envoyé
    }),
  );
  const ancienne = (texte) => ({ docId: "0".repeat(64), sha256Clair: sha(texte), sha256Bloc: "", size: 0, mtime: "" });
  B.base = {
    version: VERSION_BASE,
    chainId: "f".repeat(32),
    docs: {
      "Pro/Notes.md": ancienne("# Notes\nContenu secret de Pro\n"),
      "Offline.md": ancienne("ancienne\n"),
      "Conflit.md": ancienne("base commune\n"),
    },
  };
  await B.rejoindre(S);
  const ops = await B.sync();
  assert.equal(B.vault.texte("Pro/Notes.md"), "# Notes\nversion A\n");
  assert.ok(ops.put.includes("Offline.md"));
  assert.ok(ops.put.includes("B seul.md"));
  assert.deepEqual(ops.conflict, ["Conflit.md"]);
  assert.equal(B.vault.texte("Conflit.md"), "B dit non\n", "le local est gardé");
  assert.ok(B.vault.chemins().some((c) => c.startsWith("Conflit (conflict ")), "la version du serveur est gardée à côté");
  assert.equal(ops.del.length + ops.removeLocal.length, 0, "rien n'est supprimé pendant l'adoption");
  assert.equal(B.base.chainId, A.cles.id);

  await A.sync();
  assert.equal(A.vault.texte("Offline.md"), "modifié hors ligne\n");
  assert.equal(A.vault.texte("B seul.md"), "seulement sur B\n");
  assert.equal(A.vault.texte("Conflit.md"), "B dit non\n");
  assert.deepEqual(A.vault.chemins(), B.vault.chemins());
});

test("base de version 1 : ignorée et reconstruite, sans conflit ni suppression", async () => {
  const { serveur, A, S } = await casierNeuf();
  const B = appareil(serveur, "PC", new VaultMemoire(FICHIERS_A));
  B.base = { version: 1, chainId: A.cles.id, generation: 1, docs: { "Pro/Notes.md": { docId: "1".repeat(64), sha256Clair: "x", sha256Bloc: "y" } } };
  await B.rejoindre(S);
  const ops = await B.sync();
  assert.equal(ops.put.length + ops.del.length + ops.removeLocal.length + ops.conflict.length, 0);
  assert.equal(B.base.version, VERSION_BASE);
  assert.equal(Object.keys(B.base.docs).length, 3);
});

test("trois voies : modification, suppression, résurrection, mêmes modifications des deux côtés", async () => {
  const { serveur, A, S } = await casierNeuf();
  const B = appareil(serveur, "PC", new VaultMemoire());
  await B.rejoindre(S);
  await B.sync();
  assert.deepEqual(B.vault.chemins(), A.vault.chemins());

  A.vault.writeClear("Pro/Notes.md", Buffer.from("modifié par A"));
  let ops = await A.sync();
  assert.deepEqual(ops.put, ["Pro/Notes.md"]);
  ops = await B.sync();
  assert.deepEqual(ops.get, ["Pro/Notes.md"]);
  assert.equal(B.vault.texte("Pro/Notes.md"), "modifié par A");

  B.vault.remove("Local seul.md");
  ops = await B.sync();
  assert.deepEqual(ops.del, ["Local seul.md"]);
  ops = await A.sync();
  assert.deepEqual(ops.removeLocal, ["Local seul.md"]);

  // B supprime, A modifie avant d'avoir vu la suppression : A ressuscite le document.
  B.vault.remove("Été/Idée.md");
  await B.sync();
  A.vault.writeClear("Été/Idée.md", Buffer.from("A tient à cette idée"));
  ops = await A.sync();
  assert.deepEqual(ops.put, ["Été/Idée.md"]);
  await B.sync();
  assert.equal(B.vault.texte("Été/Idée.md"), "A tient à cette idée");

  // Même modification des deux côtés : pas de conflit.
  A.vault.writeClear("Pro/Notes.md", Buffer.from("pareil"));
  B.vault.writeClear("Pro/Notes.md", Buffer.from("pareil"));
  await A.sync();
  ops = await B.sync();
  assert.deepEqual(ops.conflict, []);
  assert.equal(B.vault.chemins().filter((c) => c.includes("conflict")).length, 0);
  assert.equal(serveur.verification(A.cles.id).ok, true);
});

test("chemins macOS en NFD : même document qu'en NFC, pas de doublon", async () => {
  const { serveur, S } = await casierNeuf();
  const B = appareil(serveur, "Mac2", new VaultMemoire({ ["Été/Idée.md".normalize("NFD")]: "Une idée d'été\n" }));
  await B.rejoindre(S);
  const ops = await B.sync();
  assert.equal(ops.put.length + ops.conflict.length, 0);
  assert.equal(B.vault.chemins().filter((c) => c.normalize("NFC") === "Été/Idée.md").length, 1);
});

test("412 : écriture concurrente entre le manifeste et l'envoi, on relance au lieu d'écraser", async () => {
  const { serveur, A, S } = await casierNeuf();
  const B = appareil(serveur, "PC", new VaultMemoire());
  await B.rejoindre(S);
  await B.sync();
  A.vault.writeClear("Pro/Notes.md", Buffer.from("version A"));
  B.vault.writeClear("Pro/Notes.md", Buffer.from("version B"));
  // B écrit juste après que A a lu le manifeste.
  const clientA = A.client;
  const espion = Object.create(clientA);
  espion.manifeste = async () => {
    const m = await clientA.manifeste();
    await B.sync();
    return m;
  };
  A.client = espion;
  let ops = await A.sync();
  assert.deepEqual(ops.relancer, ["Pro/Notes.md"]);
  A.client = clientA;
  ops = await A.sync();
  assert.deepEqual(ops.conflict, ["Pro/Notes.md"]);
  assert.equal(A.vault.texte("Pro/Notes.md"), "version A");
  const copie = A.vault.chemins().find((c) => c.startsWith("Pro/Notes (conflict "));
  assert.equal(A.vault.texte(copie), "version B", "la version de B n'est pas perdue");
});

test("bloc illisible : aucune suppression ni écriture locale, signalé", async () => {
  const { serveur, A, S } = await casierNeuf();
  const B = appareil(serveur, "PC", new VaultMemoire());
  await B.rejoindre(S);
  await B.sync();
  // Le serveur (ou un intrus) altère un bloc, et dépose un bloc au chemin indéchiffrable.
  A.vault.writeClear("Pro/Notes.md", Buffer.from("nouvelle version"));
  await A.sync();
  const bloc = serveur.etat.blocs.get(`${A.cles.id}:${B.base.docs["Pro/Notes.md"].docId}`);
  bloc.octets = Buffer.from(bloc.octets);
  bloc.octets[bloc.octets.length - 1] ^= 1;
  bloc.sha256 = sha(bloc.octets);
  await A.client.deposer("ab".repeat(32), { bloc: Buffer.from([1, ...new Array(40).fill(7)]), pathEnc: "AQ" + "A".repeat(40), mtime: new Date().toISOString() });
  const avant = B.vault.texte("Pro/Notes.md");
  const ops = await B.sync();
  assert.equal(B.vault.texte("Pro/Notes.md"), avant, "le fichier local n'est pas touché");
  assert.ok(ops.indechiffrables.includes("Pro/Notes.md"));
  assert.ok(ops.indechiffrables.includes("ab".repeat(32)));
  assert.equal(ops.removeLocal.length, 0);
  assert.ok(B.base.docs["Pro/Notes.md"], "la base est gardée pour réessayer");
});

test("markdown seulement, dans les deux sens ; aucun autre fichier local n'est jamais touché", async () => {
  assert.equal(estMarkdown("a.md"), true);
  assert.equal(estMarkdown("Dossier/b.markdown"), true);
  assert.equal(estMarkdown("C.MD"), true);
  for (const non of ["a.mdx", "a.md.png", "photo.png", ".md", ".cache/x.md", "Pro/.brouillon.md", "x/.git/a.md", "", null]) {
    assert.equal(estMarkdown(non), false, String(non));
  }

  const { serveur, A, S, r } = await casierNeuf({
    "a.md": "A",
    "b.markdown": "B",
    "Notes/C.MD": "C",
    "Images/photo.png": PNG,
    "Annexes/plan.pdf": "%PDF-1.7 plan",
    "note.txt": "texte",
    ".cache/x.md": "caché",
    "Pro/.brouillon.md": "caché aussi",
  });
  assert.equal(r.envoyes, 3);
  assert.equal(serveur.verification(A.cles.id).blocs, 3);
  const stockage = serveur.toutLeStockage();
  for (const fuite of [PNG.subarray(0, 4), Buffer.from("%PDF"), Buffer.from("caché"), Buffer.from("texte")]) {
    assert.equal(stockage.includes(fuite), false);
  }

  const B = appareil(serveur, "PC", new VaultMemoire({ "local.txt": "à moi", "Images/autre.png": PNG }));
  await B.rejoindre(S);
  await B.sync();
  assert.deepEqual(B.vault.chemins(), ["Images/autre.png", "Notes/C.MD", "a.md", "b.markdown", "local.txt"]);

  // Un client bogué dépose une image : elle n'est jamais écrite sur un disque.
  const docIdPng = await docIdAvec(A.cles, "Images/photo.png");
  await A.client.deposer(docIdPng, {
    bloc: await chiffrerContenuAvec(A.cles, docIdPng, PNG),
    pathEnc: await chiffrerCheminAvec(A.cles, docIdPng, "Images/photo.png"),
    mtime: new Date().toISOString(),
  });
  let ops = await B.sync();
  assert.deepEqual(ops.horsFormat, ["Images/photo.png"]);
  assert.equal(B.vault.chemins().includes("Images/photo.png"), false);
  ops = await A.sync();
  assert.deepEqual(ops.horsFormat, ["Images/photo.png"]);
  assert.deepEqual(A.vault.octets("Images/photo.png"), PNG, "l'original local n'est pas touché");

  // Une suppression qui se propage ne touche que le markdown.
  A.vault.remove("a.md");
  await A.sync();
  ops = await B.sync();
  assert.deepEqual(ops.removeLocal, ["a.md"]);
  assert.equal(B.vault.texte("local.txt"), "à moi");
  assert.deepEqual(B.vault.octets("Images/autre.png"), PNG);
});

test("document trop gros : jamais envoyé, signalé, sans requête refusée ni erreur ; juste à la limite, il part", async () => {
  // maxDocBytes limite le clair : limite.md (100 octets, bloc de 129) part, gros.md (101) reste.
  const { serveur, A, r } = await casierNeuf({ "petit.md": "x".repeat(50), "limite.md": "z".repeat(100), "gros.md": "y".repeat(101) }, { maxDocBytes: 100 });
  assert.equal(r.envoyes, 2);
  assert.deepEqual(r.tropGros, ["gros.md"]);
  assert.equal(requetes(serveur, "PUT").length, 2, "le serveur ne reçoit pas le document trop gros");
  const avant = serveur.etat.journal.length;
  const ops = await A.sync();
  assert.deepEqual(ops.tropGros, ["gros.md"]);
  assert.equal(requetes(serveur, "PUT", avant).length, 0);
  assert.equal(A.vault.texte("gros.md"), "y".repeat(101));
});

test("limite par défaut : 512 Ko de clair ; une note de 400 Ko part, une de 513 Ko reste sur l'appareil", async () => {
  assert.equal(MAX_DOC_BYTES_DEFAUT, 512 * 1024);
  const { serveur, A, r } = await casierNeuf({ "longue.md": "n".repeat(400 * 1024), "pile.md": "p".repeat(512 * 1024), "trop.md": "t".repeat(513 * 1024) });
  assert.equal(r.envoyes, 2);
  assert.deepEqual(r.tropGros, ["trop.md"]);
  assert.equal(r.serveur.maxDocBytes, MAX_DOC_BYTES_DEFAUT);
  assert.equal(requetes(serveur, "PUT").length, 2);
  assert.equal(A.vault.texte("trop.md").length, 513 * 1024);
});

test("quota : envoi partiel, rien de bruyant, une suppression libère la place, 413 du serveur non fatal", async () => {
  const bloc = 100 + 29;
  const fichiers = { "a.md": "a".repeat(100), "b.md": "b".repeat(100), "c.md": "c".repeat(100) };
  const { serveur, A, r } = await casierNeuf(fichiers, { quotaBytes: 2 * bloc });
  assert.equal(r.envoyes, 2);
  assert.deepEqual(r.quota, ["c.md"]);
  assert.equal(serveur.verification(A.cles.id).ok, true);

  // Le cycle suivant prévient sans renvoyer la requête qui serait refusée.
  let avant = serveur.etat.journal.length;
  let ops = await A.sync();
  assert.deepEqual(ops.quota, ["c.md"]);
  assert.equal(requetes(serveur, "PUT", avant).length, 0);

  // Supprimer un document libère la place dans le même cycle.
  A.vault.remove("a.md");
  ops = await A.sync();
  assert.deepEqual(ops.del, ["a.md"]);
  assert.deepEqual(ops.put, ["c.md"]);
  assert.deepEqual(ops.quota, []);

  // Le serveur reste juge : un manifeste trompeur mène à un seul 413, sans erreur.
  A.vault.writeClear("d.md", Buffer.from("d".repeat(100)));
  A.vault.writeClear("e.md", Buffer.from("e".repeat(100)));
  const clientA = A.client;
  const espion = Object.create(clientA);
  espion.manifeste = async () => ({ ...(await clientA.manifeste()), bytesUsed: 0 });
  A.client = espion;
  avant = serveur.etat.journal.length;
  ops = await A.sync();
  assert.equal(ops.quota.length, 2);
  assert.equal(requetes(serveur, "PUT", avant).length, 1, "un seul refus, puis plus d'envoi pendant ce cycle");
  assert.equal(A.vault.texte("d.md"), "d".repeat(100), "rien n'est supprimé localement");
  A.client = clientA;

  // Trop de documents : même traitement.
  const autre = await casierNeuf(fichiers, { maxDocs: 2 });
  assert.equal(autre.r.envoyes, 2);
  assert.equal(autre.r.quota.length, 1);
});

test("413 du serveur : ErreurChaine avec code et détails", async () => {
  const { A } = await casierNeuf({ "a.md": "a" }, { quotaBytes: 40 });
  const docId = await docIdAvec(A.cles, "b.md");
  const err = await A.client
    .deposer(docId, { bloc: await chiffrerContenuAvec(A.cles, docId, Buffer.from("b".repeat(50))), pathEnc: await chiffrerCheminAvec(A.cles, docId, "b.md"), mtime: new Date() })
    .catch((e) => e);
  assert.ok(err instanceof ErreurChaine);
  assert.ok(estQuota(err));
  assert.equal(err.code, "QUOTA_EXCEEDED");
  assert.equal(err.details.quotaBytes, 40);
});

test("nouvelle chaîne : l'ancien casier est effacé, les autres appareils rejoignent sans rien perdre", async () => {
  const { serveur, A, S } = await casierNeuf();
  const B = appareil(serveur, "PC", new VaultMemoire());
  await B.rejoindre(S);
  await B.sync();
  B.vault.writeClear("B pendant la rotation.md", Buffer.from("écrit hors ligne"));
  const ancienId = A.cles.id;

  const neuve = await nouvelleChaine();
  const S2 = new Uint8Array(neuve.S);
  const cles2 = await preparer(neuve.S);
  const nouveau = { cles: cles2, client: clientDe(cles2, { serverUrl: URL_SERVEUR, deviceId: "Mac", fetch: serveur.fetch }) };
  const r = await renouvelerChaine({ vault: A.vault, ancien: { client: A.client, cles: A.cles }, nouveau, base: A.base });
  assert.equal(r.envoyes, 3);
  assert.equal(serveur.etat.chaines.has(ancienId), false, "l'ancien casier est effacé");
  assert.equal([...serveur.etat.blocs.keys()].some((k) => k.startsWith(ancienId)), false);
  assert.equal(serveur.verification(cles2.id).ok, true);
  Object.assign(A, { cles: cles2, client: nouveau.client, base: r.base });
  assert.equal((await A.sync()).put.length, 0);

  // B est encore sur l'ancienne chaîne : 404, rien n'est touché.
  await assert.rejects(B.sync(), (e) => estChaineInconnue(e));
  assert.equal(B.vault.texte("B pendant la rotation.md"), "écrit hors ligne");
  // B rejoint la nouvelle : sa base de l'ancienne chaîne guide l'adoption.
  await B.rejoindre(S2);
  const ops = await B.sync();
  assert.deepEqual(ops.put, ["B pendant la rotation.md"]);
  assert.equal(ops.conflict.length, 0);
  await A.sync();
  assert.equal(A.vault.texte("B pendant la rotation.md"), "écrit hors ligne");
});

test("nouvelle chaîne : ce qu'un autre appareil écrit dans l'ancien casier pendant l'envoi n'est pas perdu", async () => {
  const { serveur, A, S } = await casierNeuf();
  const B = appareil(serveur, "PC", new VaultMemoire());
  await B.rejoindre(S);
  await B.sync();
  const neuve = await nouvelleChaine();
  const cles2 = await preparer(neuve.S);
  const client2 = clientDe(cles2, { serverUrl: URL_SERVEUR, fetch: serveur.fetch });
  const espion = Object.create(client2);
  espion.creer = async () => {
    const etat = await client2.creer();
    B.vault.writeClear("Pro/Notes.md", Buffer.from("écrit par B pendant le renouvellement"));
    await B.sync();
    return etat;
  };
  const r = await renouvelerChaine({ vault: A.vault, ancien: { client: A.client, cles: A.cles }, nouveau: { client: espion, cles: cles2 }, base: A.base });
  assert.equal(A.vault.texte("Pro/Notes.md"), "écrit par B pendant le renouvellement");
  const C = appareil(serveur, "Tablette", new VaultMemoire());
  await C.rejoindre(neuve.S);
  await C.sync();
  assert.equal(C.vault.texte("Pro/Notes.md"), "écrit par B pendant le renouvellement");
  assert.equal(r.envoyes, 3);
});

test("nouvelle chaîne refusée faute de place : le nouveau casier est retiré, l'ancien reste", async () => {
  const fichiers = { "a.md": "a".repeat(100), "b.md": "b".repeat(100), "c.md": "c".repeat(100) };
  const { serveur, A } = await casierNeuf(fichiers, { quotaBytes: 2 * 129 });
  const cles2 = await preparer((await nouvelleChaine()).S);
  const nouveau = { cles: cles2, client: clientDe(cles2, { serverUrl: URL_SERVEUR, fetch: serveur.fetch }) };
  await assert.rejects(
    renouvelerChaine({ vault: A.vault, ancien: { client: A.client, cles: A.cles }, nouveau, base: A.base }),
    (e) => e.status === 413 && e.code === "QUOTA_EXCEEDED",
  );
  assert.equal(serveur.etat.chaines.has(A.cles.id), true);
  assert.equal(serveur.etat.chaines.has(cles2.id), false);
  assert.deepEqual(A.vault.chemins(), ["a.md", "b.md", "c.md"]);
});

test("création : idempotente avec la même preuve, refusée avec une autre, limitée", async () => {
  const serveur = creerServeurSimule({ creationsMax: 2 });
  const cles = await preparer((await nouvelleChaine()).S);
  const client = clientDe(cles, { serverUrl: URL_SERVEUR, fetch: serveur.fetch });
  const etat = await client.creer();
  assert.deepEqual(
    { chainId: etat.chainId, bytesUsed: etat.bytesUsed, docCount: etat.docCount },
    { chainId: cles.id, bytesUsed: 0, docCount: 0 },
  );
  assert.ok(etat.quotaBytes > 0 && etat.maxDocBytes > 0 && etat.maxDocs > 0);
  assert.equal((await client.creer()).chainId, cles.id, "un premier appareil qui réessaie retrouve son casier");
  assert.notEqual(serveur.etat.chaines.get(cles.id).proofHash, cles.preuve, "le serveur ne garde que l'empreinte de la preuve");
  const voleur = new ClientChaine({ serverUrl: URL_SERVEUR, chainId: cles.id, preuve: "B".repeat(43), fetch: serveur.fetch });
  await assert.rejects(voleur.creer(), (e) => e.status === 403 && e.code === "CHAIN_PROOF_INVALID");
  await clientDe(await preparer((await nouvelleChaine()).S), { serverUrl: URL_SERVEUR, fetch: serveur.fetch }).creer();
  const troisieme = clientDe(await preparer((await nouvelleChaine()).S), { serverUrl: URL_SERVEUR, fetch: serveur.fetch });
  await assert.rejects(troisieme.creer(), (e) => e.status === 429 && e.code === "CHAIN_CREATE_LIMITED");
});

test("preuve fausse : 403, puis 429 ; la bonne preuve passe ; casier inconnu : 404 ; en-têtes mal formés : 400", async () => {
  const { serveur, A } = await casierNeuf(FICHIERS_A, { preuvesFaussesMax: 5 });
  const fausse = new ClientChaine({ serverUrl: URL_SERVEUR, chainId: A.cles.id, preuve: "A".repeat(43), fetch: serveur.fetch });
  await assert.rejects(fausse.manifeste(), (e) => e.status === 403 && e.code === "CHAIN_PROOF_INVALID");
  for (let i = 0; i < 4; i++) await fausse.manifeste().catch(() => {});
  await assert.rejects(fausse.etat(), (e) => e.status === 429 && e.code === "CHAIN_PROOF_LIMITED");
  assert.ok(Array.isArray((await A.client.manifeste()).docs), "la bonne preuve n'est jamais bloquée");
  const inconnue = new ClientChaine({ serverUrl: URL_SERVEUR, chainId: "0".repeat(32), preuve: A.cles.preuve, fetch: serveur.fetch });
  await assert.rejects(inconnue.manifeste(), (e) => estChaineInconnue(e));
  const malFormee = new ClientChaine({ serverUrl: URL_SERVEUR, chainId: "XYZ", preuve: A.cles.preuve, fetch: serveur.fetch });
  await assert.rejects(malFormee.etat(), (e) => e.status === 400 && e.code === "CHAIN_ID_INVALID");
});

test("limite anti-partage : 429 CHAIN_READ_LIMITED, rien d'effacé, rien de fatal, la synchro reprend ensuite", async () => {
  const { serveur, A, S } = await casierNeuf();
  const B = appareil(serveur, "Téléphone", new VaultMemoire());
  await B.rejoindre(S);
  serveur.etat.lecturesLimitees = true;
  await assert.rejects(B.sync(), (e) => estLectureLimitee(e) && !estChaineInconnue(e) && !estQuota(e));
  await assert.rejects(B.client.etat(), (e) => e.status === 429 && e.code === "CHAIN_READ_LIMITED");
  assert.deepEqual(B.vault.chemins(), [], "rien n'est écrit ni supprimé sur l'appareil refusé");
  assert.equal(B.base?.docs ? Object.keys(B.base.docs).length : 0, 0);
  // Le flux n'abandonne pas sur un 429 : il réessaie, comme hors ligne.
  const ctrl = new AbortController();
  const erreurs = [];
  const fin = B.client.flux(() => {}, { signal: ctrl.signal, onErreur: (e) => erreurs.push(e) });
  await attendre(() => requetes(serveur, "GET").filter((r) => r.chemin === "/v1/chain/stream").length >= 1);
  ctrl.abort();
  await fin;
  assert.deepEqual(erreurs, [], "un 429 n'arrête pas le flux");
  // La limite levée (fenêtre passée), la synchro reprend normalement.
  serveur.etat.lecturesLimitees = false;
  await B.sync();
  assert.deepEqual(B.vault.chemins(), Object.keys(FICHIERS_A).sort());
  assert.ok(A.base, "l'appareil déjà en place n'est pas touché");
});

test("tout effacer : le casier disparaît, un autre appareil reçoit 404, le même S peut recréer un casier vide", async () => {
  const { serveur, A, S } = await casierNeuf();
  const B = appareil(serveur, "PC", new VaultMemoire());
  await B.rejoindre(S);
  await B.sync();
  await A.client.effacerTout();
  assert.equal([...serveur.etat.blocs.keys()].some((k) => k.startsWith(A.cles.id)), false);
  await assert.rejects(A.client.manifeste(), (e) => estChaineInconnue(e));
  await assert.rejects(B.sync(), (e) => estChaineInconnue(e));
  assert.deepEqual(B.vault.chemins(), Object.keys(FICHIERS_A).sort(), "les fichiers locaux restent");
  const etat = await A.client.creer();
  assert.equal(etat.docCount, 0);
});

test("flux : changements des autres appareils seulement, reconnexion, arrêt par signal, 404 définitif", async () => {
  const { serveur, A, S } = await casierNeuf();
  const B = appareil(serveur, "PC", new VaultMemoire());
  await B.rejoindre(S);
  await B.sync();
  const recus = [];
  const ctrl = new AbortController();
  const fin = A.client.flux((e) => recus.push(e), { signal: ctrl.signal });
  await attendre(() => serveur.etat.flux.size === 1);
  const enTetes = requetes(serveur, "GET").find((r) => r.chemin === "/v1/chain/stream").entetes;
  assert.equal(enTetes["x-lector-chain-proof"], A.cles.preuve, "la preuve voyage en en-tête, jamais dans l'URL");

  A.vault.writeClear("de A.md", Buffer.from("écho"));
  await A.sync();
  B.vault.writeClear("de B.md", Buffer.from("nouveau"));
  await B.sync();
  await attendre(() => recus.length === 1);
  assert.equal(recus[0].kind, "put");
  assert.equal(recus[0].actorDevice, "PC");

  // Coupure côté serveur : le client se reconnecte seul.
  serveur.couperFlux();
  await attendre(() => serveur.etat.flux.size === 1, 5000);
  B.vault.remove("de B.md");
  await B.sync();
  await attendre(() => recus.length === 2);
  assert.equal(recus[1].kind, "delete");

  ctrl.abort();
  await fin;
  assert.equal(serveur.etat.flux.size, 0);

  const erreurs = [];
  const inconnue = new ClientChaine({ serverUrl: URL_SERVEUR, chainId: "0".repeat(32), preuve: A.cles.preuve, fetch: serveur.fetch });
  await inconnue.flux(() => {}, { onErreur: (e) => erreurs.push(e) });
  assert.ok(estChaineInconnue(erreurs[0]));
});

test("vault web : arbre déchiffré, lecture en cache, écriture avec If-Match et 412, markdown seulement", async () => {
  const { serveur, A, S } = await casierNeuf(FICHIERS_A, { maxDocBytes: 1000 });
  const cles = await preparer(S);
  const client = clientDe(cles, { serverUrl: URL_SERVEUR, fetch: serveur.fetch });
  const web = new VaultWebChaine({ client, cles });
  const liste = await web.lister();
  assert.deepEqual(liste.map((d) => d.chemin), ["Local seul.md", "Pro/Notes.md", "Été/Idée.md"]);
  assert.equal(liste.find((d) => d.chemin === "Pro/Notes.md").size, Buffer.byteLength("# Notes\nContenu secret de Pro\n"));
  assert.equal(web.serveur.maxDocBytes, 1000);
  assert.equal(construireArbre(liste)[0].isDirectory, true);

  assert.equal(await web.lireTexte("Pro/Notes.md"), "# Notes\nContenu secret de Pro\n");
  const lectures = () => requetes(serveur, "GET").filter((r) => r.chemin.startsWith("/v1/chain/docs/")).length;
  const avant = lectures();
  assert.equal(await web.lireTexte("Pro/Notes.md"), "# Notes\nContenu secret de Pro\n");
  assert.equal(lectures(), avant, "deuxième lecture servie par le cache de la session");

  await web.ecrire("Pro/Notes.md", "édité dans le navigateur");
  await A.sync();
  assert.equal(A.vault.texte("Pro/Notes.md"), "édité dans le navigateur");
  // A modifie ensuite : l'écriture du navigateur, partie d'une version périmée, est refusée.
  A.vault.writeClear("Pro/Notes.md", Buffer.from("A repasse derrière"));
  await A.sync();
  await assert.rejects(web.ecrire("Pro/Notes.md", "écrase ?"), (e) => e.status === 412);
  await web.lister();
  assert.equal(await web.lireTexte("Pro/Notes.md"), "A repasse derrière", "le cache suit le manifeste");

  await web.ecrire("Nouveau.md", "créé sur le web");
  await A.sync();
  assert.equal(A.vault.texte("Nouveau.md"), "créé sur le web");
  await assert.rejects(web.ecrire("photo.png", "x"), (e) => e.status === 400 && e.code === "NOT_MARKDOWN");
  await assert.rejects(web.ecrire("Gros.md", "x".repeat(2000)), (e) => e.status === 413 && e.code === "DOC_TOO_LARGE");
  await web.supprimer("Nouveau.md");
  await A.sync();
  assert.equal(A.vault.chemins().includes("Nouveau.md"), false);
});

test("nom de copie de conflit", () => {
  const d = new Date("2026-10-19T08:30:00Z");
  assert.equal(nomDeConflit("Pro/Notes.md", d), "Pro/Notes (conflict 2026-10-19-08-30).md");
  assert.equal(nomDeConflit("a.b/c", d), "a.b/c (conflict 2026-10-19-08-30)");
});

test("pierres tombales : le serveur ne peut pas faire effacer un fichier local", async () => {
  const { serveur, A, S } = await casierNeuf();
  const B = appareil(serveur, "PC", new VaultMemoire());
  await B.rejoindre(S);
  await B.sync();
  const docNotes = await docIdAvec(A.cles, "Pro/Notes.md");
  const docIdee = await docIdAvec(A.cles, "Été/Idée.md");
  const cle = (docId) => `${A.cles.id}:${docId}`;
  const bloc = (docId) => serveur.etat.blocs.get(cle(docId));
  const tombe = (docId, tombEnc = null) => {
    serveur.etat.blocs.set(cle(docId), { ...bloc(docId), octets: Buffer.alloc(0), sha256: "", size: 0, deletedAt: new Date().toISOString(), tombEnc });
  };

  // 1. Le serveur pose deletedAt sans marque : B ne supprime rien et renvoie le document.
  tombe(docNotes);
  let ops = await B.sync();
  assert.deepEqual(ops.removeLocal, []);
  assert.deepEqual(ops.tombesRefusees, ["Pro/Notes.md"]);
  assert.deepEqual(ops.put, ["Pro/Notes.md"]);
  assert.equal(B.vault.texte("Pro/Notes.md"), "# Notes\nContenu secret de Pro\n");
  assert.equal(bloc(docNotes).deletedAt, null, "renvoyé au serveur, chiffré");

  // 2. Marque fabriquée avec une autre clé : refusée.
  const intrus = await preparer(new Uint8Array(16).fill(7));
  tombe(docIdee, await chiffrerTombeAvec(intrus, docIdee, B.base.docs["Été/Idée.md"].sha256Bloc));
  ops = await B.sync();
  assert.deepEqual(ops.removeLocal, []);
  assert.equal(B.vault.texte("Été/Idée.md"), "Une idée d'été\n");

  // 3. Vraie suppression par A : B retire le fichier.
  await A.sync();
  A.vault.remove("Été/Idée.md");
  ops = await A.sync();
  assert.deepEqual(ops.del, ["Été/Idée.md"]);
  const marqueA = bloc(docIdee).tombEnc;
  assert.ok(marqueA);
  ops = await B.sync();
  assert.deepEqual(ops.removeLocal, ["Été/Idée.md"]);
  assert.equal(B.vault.chemins().includes("Été/Idée.md"), false);

  // 4. Rejeu : le document revient (nouvelle version), le serveur ressort l'ancienne marque.
  A.vault.writeClear("Été/Idée.md", Buffer.from("Elle revient"));
  await A.sync();
  await B.sync();
  assert.equal(B.vault.texte("Été/Idée.md"), "Elle revient");
  tombe(docIdee, marqueA);
  ops = await B.sync();
  assert.deepEqual(ops.removeLocal, [], "une ancienne marque ne supprime pas une version plus récente");
  assert.equal(B.vault.texte("Été/Idée.md"), "Elle revient");
});

// ---------------------------------------------------------------------------
// Pertes de données évitées : casse des noms, renouvellement, reprise d'une
// création, écritures concurrentes, blocs absents du serveur.
// ---------------------------------------------------------------------------

/** Dépose un document comme le ferait un autre client (ancien client, navigateur, Linux). */
async function deposerDirect(a, chemin, texte) {
  const docId = await docIdAvec(a.cles, chemin);
  await a.client.deposer(docId, {
    bloc: await chiffrerContenuAvec(a.cles, docId, Buffer.from(texte)),
    pathEnc: await chiffrerCheminAvec(a.cles, docId, chemin),
    mtime: new Date().toISOString(),
  });
  return docId;
}

/** Deux Mac (disques insensibles à la casse) dans une même chaîne, avec `fichiers` synchronisés. */
async function deuxMac(fichiers) {
  const serveur = creerServeurSimule();
  const { S } = await nouvelleChaine();
  const A = appareil(serveur, "Mac A", new VaultMemoire(fichiers, { insensible: true }));
  const B = appareil(serveur, "Mac B", new VaultMemoire({}, { insensible: true }));
  await A.rejoindre(S);
  await B.rejoindre(S);
  await A.client.creer();
  await A.sync();
  await B.sync();
  return { serveur, A, B, S };
}

const vivants = (serveur, chainId) => [...serveur.etat.blocs].filter(([k, b]) => k.startsWith(chainId) && !b.deletedAt).length;

test("renommage qui ne change que la casse, sur des disques insensibles à la casse : même document, rien n'est supprimé", async () => {
  const { serveur, A, B } = await deuxMac({ "notes.md": "# Mes notes\n", "Pro/plan.md": "plan\n" });
  // A renomme notes.md en Notes.md et le dossier Pro en pro.
  A.vault.remove("notes.md");
  A.vault.writeClear("Notes.md", Buffer.from("# Mes notes\n"));
  A.vault.remove("Pro/plan.md");
  A.vault.writeClear("pro/plan.md", Buffer.from("plan\n"));
  let ops = await A.sync();
  assert.deepEqual([ops.put, ops.del], [[], []], "ni nouveau document ni pierre tombale");
  ops = await B.sync();
  assert.deepEqual([ops.get, ops.removeLocal], [[], []]);
  for (let i = 0; i < 2; i++) {
    await A.sync();
    await B.sync();
  }
  assert.equal(A.vault.texte("Notes.md"), "# Mes notes\n");
  assert.equal(B.vault.texte("notes.md"), "# Mes notes\n");
  assert.equal(B.vault.texte("Pro/plan.md"), "plan\n");
  assert.equal(vivants(serveur, A.cles.id), 2);

  // Le fichier renommé reste lié à son document : une modification part et arrive.
  A.vault.writeClear("Notes.md", Buffer.from("# Mes notes\nsuite\n"));
  assert.deepEqual((await A.sync()).put, ["notes.md"]);
  assert.deepEqual((await B.sync()).get, ["notes.md"]);
  assert.equal(B.vault.texte("notes.md"), "# Mes notes\nsuite\n");
  // Et sa suppression se propage.
  A.vault.remove("Notes.md");
  assert.deepEqual((await A.sync()).del, ["notes.md"]);
  assert.deepEqual((await B.sync()).removeLocal, ["notes.md"]);
});

test("renommage de casse reçu sous forme de suppression et de nouveau document : retrait puis écriture, rien n'est perdu", async () => {
  const { A, B } = await deuxMac({ "notes.md": "# Mes notes\n" });
  // Un client qui distingue la casse remplace notes.md par Notes.md.
  const ancien = B.base.docs["notes.md"];
  await deposerDirect(A, "Notes.md", "# Mes notes\n");
  await A.client.supprimer(ancien.docId, await chiffrerTombeAvec(A.cles, ancien.docId, ancien.sha256Bloc));
  const ops = await B.sync();
  assert.deepEqual([ops.removeLocal, ops.get], [["notes.md"], ["Notes.md"]]);
  assert.deepEqual(B.vault.chemins(), ["Notes.md"]);
  assert.equal(B.vault.texte("Notes.md"), "# Mes notes\n");
  const suite = await B.sync();
  assert.deepEqual([suite.put, suite.del, suite.get, suite.removeLocal], [[], [], [], []]);
});

test("adoption sur un disque insensible à la casse : un fichier local n'est jamais écrasé par un document au nom voisin", async () => {
  const serveur = creerServeurSimule();
  const { S } = await nouvelleChaine();
  const Linux = appareil(serveur, "Linux", new VaultMemoire({ "readme.md": "contenu Linux\n" }));
  await Linux.rejoindre(S);
  await Linux.client.creer();
  await Linux.sync();
  const Mac = appareil(serveur, "Mac", new VaultMemoire({ "README.md": "texte du Mac, jamais synchronisé\n" }, { insensible: true }));
  await Mac.rejoindre(S);
  let ops = await Mac.sync();
  assert.deepEqual(ops.put, ["README.md"]);
  assert.deepEqual(ops.conflict, ["readme.md"]);
  assert.equal(Mac.vault.texte("README.md"), "texte du Mac, jamais synchronisé\n");
  const copie = Mac.vault.chemins().find((c) => c.startsWith("readme (conflict "));
  assert.equal(Mac.vault.texte(copie), "contenu Linux\n");

  // Stable : ni nouvelle copie, ni suppression du document au nom voisin.
  ops = await Mac.sync();
  assert.deepEqual([ops.put, ops.get, ops.del, ops.conflict, ops.relancer], [[], [], [], [], []]);
  ops = await Linux.sync();
  assert.equal(Linux.vault.texte("readme.md"), "contenu Linux\n");
  assert.equal(Linux.vault.texte("README.md"), "texte du Mac, jamais synchronisé\n");
  assert.equal(Linux.vault.texte(copie), "contenu Linux\n");
  assert.equal((await Mac.sync()).del.length, 0);
  assert.equal(vivants(serveur, Linux.cles.id), 3);
});

/** Vault de PC Windows : un nom avec « ? » ne peut pas s'écrire (EINVAL). */
class VaultWindows extends VaultMemoire {
  writeClear(c, octets, mtime, attendu) {
    if (/[<>:"|?*]/.test(c)) throw Object.assign(new Error(`EINVAL: invalid argument, open '${c}'`), { code: "EINVAL" });
    super.writeClear(c, octets, mtime, attendu);
  }
}

test("nouvelle chaîne : l'ancien casier reste tant qu'un de ses documents n'est ni recopié ni sur le disque", async () => {
  const serveur = creerServeurSimule();
  const { S } = await nouvelleChaine();
  const Mac = appareil(serveur, "Mac", new VaultMemoire({ "Pourquoi ?.md": "réflexion unique\n", "Notes.md": "notes\n" }));
  await Mac.rejoindre(S);
  await Mac.client.creer();
  await Mac.sync();
  const PC = appareil(serveur, "PC", new VaultWindows());
  await PC.rejoindre(S);
  await PC.sync();
  assert.deepEqual(PC.vault.chemins(), ["Notes.md"]);

  // Le Mac est volé : nouvelle chaîne depuis le PC.
  const cles2 = await preparer((await nouvelleChaine()).S);
  const nouveau = { cles: cles2, client: clientDe(cles2, { serverUrl: URL_SERVEUR, deviceId: "PC", fetch: serveur.fetch }) };
  const err = await renouvelerChaine({ vault: PC.vault, ancien: { client: PC.client, cles: PC.cles }, nouveau, base: PC.base }).catch((e) => e);
  assert.equal(err?.code, "ROTATION_INCOMPLETE", String(err));
  assert.deepEqual(err.details.missing, ["Pourquoi ?.md"]);
  assert.equal(serveur.etat.chaines.has(PC.cles.id), true, "l'ancien casier n'est pas effacé");
  const web = new VaultWebChaine({ client: PC.client, cles: PC.cles });
  await web.lister();
  assert.equal(await web.lireTexte("Pourquoi ?.md"), "réflexion unique\n");

  // Un bloc illisible de l'ancien casier ne se récupère pas : il ne bloque pas le renouvellement.
  await Mac.client.supprimer(await docIdAvec(Mac.cles, "Pourquoi ?.md"), await chiffrerTombeAvec(Mac.cles, await docIdAvec(Mac.cles, "Pourquoi ?.md"), Mac.base.docs["Pourquoi ?.md"].sha256Bloc));
  const casse = await deposerDirect(Mac, "Abîmé.md", "abîmé\n");
  const bloc = serveur.etat.blocs.get(`${Mac.cles.id}:${casse}`);
  bloc.octets = Buffer.from(bloc.octets);
  bloc.octets[bloc.octets.length - 1] ^= 1;
  bloc.sha256 = sha(bloc.octets);
  const r = await renouvelerChaine({ vault: PC.vault, ancien: { client: PC.client, cles: PC.cles }, nouveau, base: PC.base });
  assert.equal(r.envoyes, 1);
  assert.equal(serveur.etat.chaines.has(PC.cles.id), false);
});

test("reprise d'une création : les documents d'un appareil entré entre-temps ne sont ni supprimés ni écrasés", async () => {
  const serveur = creerServeurSimule();
  const { S } = await nouvelleChaine();
  const o1 = appareil(serveur, "o1", new VaultMemoire({ "Commun.md": "version o1\n", "A.md": "a\n" }));
  const o2 = appareil(serveur, "o2", new VaultMemoire({ "Commun.md": "version o2\n", "Seulement-sur-o2.md": "travail unique de o2\n" }));
  await o1.rejoindre(S);
  await o2.rejoindre(S);
  await o1.client.creer(); // l'envoi est coupé juste après ; o2 rejoint avec les mots affichés
  await o2.sync();

  const avant = serveur.etat.journal.length;
  const r = await envoyerTout({ vault: o1.vault, client: o1.client, cles: o1.cles, base: null });
  assert.equal(requetes(serveur, "DELETE", avant).length, 0, "rien de o2 n'est supprimé");
  assert.deepEqual(Object.keys(r.base.docs), ["A.md"]);
  o1.base = r.base;
  await o1.sync();
  await o2.sync();
  assert.equal(o2.vault.texte("Seulement-sur-o2.md"), "travail unique de o2\n");
  assert.equal(o1.vault.texte("Seulement-sur-o2.md"), "travail unique de o2\n");
  const textes = (v) => v.chemins().filter((c) => c.startsWith("Commun")).map((c) => v.texte(c)).sort();
  assert.deepEqual(textes(o1.vault), ["version o1\n", "version o2\n"], "les deux versions de Commun.md restent");
  assert.deepEqual(textes(o2.vault), textes(o1.vault));

  // o2 dépose pendant l'envoi de o3, après sa lecture du manifeste : 412, l'envoi continue sans écraser.
  const o3 = appareil(serveur, "o3", new VaultMemoire({ "Nouveau.md": "version o3\n", "B.md": "b\n" }));
  await o3.rejoindre(S);
  const client3 = o3.client;
  const espion = Object.create(client3);
  espion.manifeste = async () => {
    const m = await client3.manifeste();
    o2.vault.writeClear("Nouveau.md", Buffer.from("version o2\n"));
    await o2.sync();
    return m;
  };
  const r3 = await envoyerTout({ vault: o3.vault, client: espion, cles: o3.cles, base: null });
  assert.equal(r3.base.docs["Nouveau.md"], undefined);
  assert.ok(r3.base.docs["B.md"]);
  const web = new VaultWebChaine({ client: o2.client, cles: o2.cles });
  await web.lister();
  assert.equal(await web.lireTexte("Nouveau.md"), "version o2\n");
});

test("une sauvegarde faite pendant le cycle n'est ni écrasée ni retirée : le cycle suivant fait une copie de conflit", async () => {
  const { serveur, A, S } = await casierNeuf({ "Doc.md": "v1\n", "Autre.md": "autre\n" });
  const B = appareil(serveur, "PC", new VaultMemoire());
  await B.rejoindre(S);
  await B.sync();
  A.vault.writeClear("Doc.md", Buffer.from("v2 de A\n"));
  A.vault.remove("Autre.md");
  await A.sync();

  // L'utilisateur de B enregistre les deux fichiers juste après le scan.
  const clientB = B.client;
  const espion = Object.create(clientB);
  espion.manifeste = async () => {
    B.vault.writeClear("Doc.md", Buffer.from("saisie de B\n"));
    B.vault.writeClear("Autre.md", Buffer.from("autre, complété sur B\n"));
    return clientB.manifeste();
  };
  B.client = espion;
  let ops = await B.sync();
  B.client = clientB;
  assert.deepEqual([ops.get, ops.removeLocal], [[], []]);
  assert.deepEqual(ops.relancer.sort(), ["Autre.md", "Doc.md"]);
  assert.equal(B.vault.texte("Doc.md"), "saisie de B\n");
  assert.equal(B.vault.texte("Autre.md"), "autre, complété sur B\n");

  ops = await B.sync();
  assert.deepEqual(ops.conflict, ["Doc.md"]);
  assert.deepEqual(ops.put, ["Autre.md"]);
  const copie = B.vault.chemins().find((c) => c.startsWith("Doc (conflict "));
  assert.equal(B.vault.texte(copie), "v2 de A\n");
  await A.sync();
  assert.equal(A.vault.texte("Doc.md"), "saisie de B\n");
  assert.equal(A.vault.texte("Autre.md"), "autre, complété sur B\n");
});

test("suppression avec If-Match : une version écrite ailleurs entre le manifeste et la suppression n'est pas perdue", async () => {
  const { serveur, A, S } = await casierNeuf({ "Doc.md": "v1\n" });
  const C = appareil(serveur, "C", new VaultMemoire());
  await C.rejoindre(S);
  await C.sync();
  const tel = new VaultWebChaine({ client: clientDe(A.cles, { serverUrl: URL_SERVEUR, deviceId: "tel", fetch: serveur.fetch }), cles: A.cles });
  await tel.lister();
  await tel.lire("Doc.md");

  // A supprime Doc.md ; le téléphone enregistre une v2 juste après la lecture du manifeste par A.
  A.vault.remove("Doc.md");
  const clientA = A.client;
  const espion = Object.create(clientA);
  espion.manifeste = async () => {
    const m = await clientA.manifeste();
    await tel.ecrire("Doc.md", "v2 du téléphone\n");
    return m;
  };
  A.client = espion;
  let ops = await A.sync();
  A.client = clientA;
  assert.deepEqual([ops.del, ops.relancer], [[], ["Doc.md"]]);
  assert.deepEqual((await C.sync()).removeLocal, []);
  assert.equal(C.vault.texte("Doc.md"), "v2 du téléphone\n");
  ops = await A.sync();
  assert.deepEqual(ops.get, ["Doc.md"], "la version du téléphone gagne sur la suppression");

  // Le navigateur aussi : une suppression partie d'une version périmée est refusée.
  A.vault.writeClear("Doc.md", Buffer.from("v3 de A\n"));
  await A.sync();
  await assert.rejects(tel.supprimer("Doc.md"), (e) => e.status === 412 && e.code === "CONFLICT");
  assert.equal((await C.sync()).get[0], "Doc.md");
  assert.equal(C.vault.texte("Doc.md"), "v3 de A\n");
});

test("bloc annoncé vivant mais absent du serveur : signalé, sans relance", async () => {
  const { serveur, A, S } = await casierNeuf({ "Perdu.md": "x\n", "Bon.md": "y\n" });
  const perdu = await docIdAvec(A.cles, "Perdu.md");
  const B = appareil(serveur, "PC", new VaultMemoire());
  await B.rejoindre(S);
  B.client = clientDe(B.cles, {
    serverUrl: URL_SERVEUR,
    fetch: async (url, init = {}) =>
      (init.method || "GET") === "GET" && url.endsWith(`/docs/${perdu}`)
        ? new Response(JSON.stringify({ error: "Block missing on the server", code: "DOC_UNKNOWN" }), { status: 404 })
        : serveur.fetch(url, init),
  });
  const ops = await B.sync();
  assert.deepEqual(ops.manquants, ["Perdu.md"]);
  assert.deepEqual(ops.relancer, []);
  assert.deepEqual(ops.get, ["Bon.md"]);
});
