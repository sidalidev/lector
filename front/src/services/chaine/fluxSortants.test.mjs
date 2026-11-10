// La liste « What leaves your device » de l'écran À propos et PRIVACY.md
// disent la même chose : chaque destination de la liste est nommée dans
// PRIVACY.md et dans le registre, chaque flux a ses textes en anglais et en français.
// Lancer : npm run test:chaine

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FLUX_SORTANTS, PROTECTIONS } from "../fluxSortants.js";
import en from "../../locales/en.js";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const lire = (chemin) => readFileSync(join(RACINE, chemin), "utf8");

test("chaque destination est nommée dans PRIVACY.md et dans le registre", () => {
  const privacy = lire("PRIVACY.md");
  const registre = lire("docs/legal/REGISTRE.md");
  for (const { id, destinations } of FLUX_SORTANTS) {
    for (const d of destinations) {
      assert.ok(privacy.includes(d), `${id} : ${d} absent de PRIVACY.md`);
      assert.ok(registre.includes(d), `${id} : ${d} absent de docs/legal/REGISTRE.md`);
    }
  }
});

test("chaque flux a ses textes et une protection connue", () => {
  const ids = new Set();
  for (const { id, protection, destinations } of FLUX_SORTANTS) {
    assert.ok(!ids.has(id), `${id} en double`);
    ids.add(id);
    assert.ok(PROTECTIONS.includes(protection), `${id} : protection ${protection}`);
    assert.ok(destinations.length > 0, `${id} : aucune destination`);
    for (const cle of [`flow.${id}.what`, `flow.${id}.detail`, `flow.prot.${protection}`]) {
      assert.ok(en[cle], `${cle} manquant`);
    }
  }
  for (const cle of ["about.flows", "about.flowsIntro"]) assert.ok(en[cle], `${cle} manquant`);
});

// La durée annoncée est celle du serveur aujourd'hui (journal Traefik, 7 jours).
// Passer à 3 jours seulement quand le serveur est réglé (docs/legal/REGISTRE.md,
// Known gaps), dans les quatre fichiers à la fois.
test("la durée de conservation des IP est la même partout et n'annonce pas 3 jours comme acquis", () => {
  const fichiers = ["PRIVACY.md", "front/landing/privacy.html", "docs/THREAT_MODEL.md", "docs/legal/REGISTRE.md"];
  for (const f of fichiers) {
    const texte = lire(f);
    assert.match(texte, /7 days/i, f);
    assert.doesNotMatch(texte, /kept 3 days|3 days at most|\(3 days,/i, f);
  }
});
