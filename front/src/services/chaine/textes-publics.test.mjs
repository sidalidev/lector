// Ce que Lector affirme en public (site, politique de confidentialité, textes de
// l'app, README, plan de bascule) doit rester vrai : dépôt pas encore publié,
// détails techniques servis par le site, QR lisible seulement par certains
// navigateurs, sauvegardes du serveur, installeurs réellement publiés, aucune
// ressource d'un autre site sur les pages du site.
// Lancer : npm run test:chaine

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import en from "../../locales/en.js";
import fr from "../../locales/fr.js";
import { pageSync, PAGE, SOURCE } from "../../../../tools/page-sync.mjs";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const lire = (chemin) => readFileSync(join(RACINE, chemin), "utf8");
const privacy = lire("front/landing/privacy.html");

test("D16 : pas de « code public » tant que le dépôt est privé ; détails techniques servis par le site", () => {
  for (const [nom, texte] of [["en.js", JSON.stringify(en)], ["fr.js", JSON.stringify(fr)]]) {
    assert.doesNotMatch(texte, /open.source|code is public|code est public/i, nom);
  }
  for (const f of ["Explication.jsx", "KitSecours.jsx"]) {
    assert.doesNotMatch(lire(`front/src/components/${f}`), /github\.com/, f);
  }
  const lien = /DOC_TECHNIQUE = '([^']+)'/.exec(lire("front/src/components/Explication.jsx"))[1];
  assert.equal(lien, "https://lector.sidali.dev/sync/");
  assert.ok(existsSync(join(RACINE, "front/landing/sync/index.html")), "la page existe dans le site");
  assert.equal(readFileSync(PAGE, "utf8"), pageSync(readFileSync(SOURCE, "utf8")), "page à jour : node tools/page-sync.mjs");
});

test("D19 : le QR n'est annoncé que là où il se scanne ; sinon les 12 mots", () => {
  for (const [langue, t, mots, navigateurs] of [["en", en, /12 words/, /some browsers/i], ["fr", fr, /12 mots/, /certains navigateurs/i]]) {
    for (const cle of ["sync.show.intro", "sync.kit.qr"]) {
      assert.match(t[cle], mots, `${langue} ${cle}`);
      assert.match(t[cle], navigateurs, `${langue} ${cle}`);
    }
  }
});

test("D27 : la politique dit combien de temps les sauvegardes gardent les blocs chiffrés", () => {
  assert.match(privacy, /backups?[^<]*up to 30 days[^<]*up to 6 months/i);
  const effacement = /<h2>9\. Deleting your data<\/h2>\s*<p>([\s\S]*?)<\/p>/.exec(privacy)[1];
  assert.match(effacement, /backups/i);
  assert.match(effacement, /only copy/i);
  assert.doesNotMatch(JSON.stringify([en, fr]), /about 6|environ 6/);
});

test("D18 et D26 : les pages du site ne chargent rien d'un autre site", () => {
  for (const [nom, page] of [["privacy", privacy], ["sync", readFileSync(PAGE, "utf8")]]) {
    assert.doesNotMatch(page, /<(link|script|img|iframe)\b[^>]*\b(href|src)="(https?:)?\/\//i, nom);
    assert.doesNotMatch(page, /fonts\.googleapis|fonts\.gstatic|analytics\.dockerbop|umami|data-website-id/i, nom);
  }
  assert.doesNotMatch(privacy, /nothing is shared with third parties/i);
  assert.doesNotMatch(privacy, /paulrosen\.github\.io/);
  assert.doesNotMatch(privacy, /surikov\.github\.io/);
});

test("D30 : l'archive de la bascule naît en 600 dans le conteneur, sans chmod de l'hôte sur un fichier de root", () => {
  const plan = lire("docs/BASCULE-PROD.md");
  const etape2 = plan.slice(plan.indexOf("## 2."), plan.indexOf("## 3."));
  assert.doesNotMatch(etape2, /^\s*chmod /m);
  assert.match(etape2, /umask 077 && tar czf/);
  assert.match(etape2, /chown "\$PROPRIETAIRE"/);
});

test("D31 : le README décrit la mise à jour d'Android par APK signé, pas par OTA du bundle", () => {
  const lignes = lire("README.md").split("\n").filter((l) => /OTA/.test(l) && /Android/.test(l));
  assert.ok(lignes.length > 0);
  for (const l of lignes) {
    assert.match(l, /On Android, the whole app updates itself/);
    assert.match(l, /Ed25519-signed manifest/);
    assert.doesNotMatch(l, /On Android, the web bundle updates (through|over|by) (a )?(signed )?OTA/i);
  }
});

test("limite anti-partage : message humain, sans code ni statut, dans les deux langues", () => {
  for (const [langue, t] of [["en", en], ["fr", fr]]) {
    for (const cle of ["cloud.chain.err.CHAIN_READ_LIMITED", "cloud.chain.err.HTTP_429"]) {
      const texte = t[cle];
      assert.ok(texte, `${langue} ${cle}`);
      assert.doesNotMatch(texte, /429|[A-Z]{2,}_[A-Z]{2,}|HTTP|\u2014/, `${langue} ${cle}`);
    }
  }
  assert.match(en["cloud.chain.err.CHAIN_READ_LIMITED"], /too many different networks/);
  assert.match(en["cloud.chain.err.CHAIN_READ_LIMITED"], /keep syncing/);
});

test("purge des casiers inactifs : 180 jours partout, plus aucun 365 jours ni 12 mois", () => {
  const textes = [
    ["privacy.html", privacy],
    ["PRIVACY.md", lire("PRIVACY.md")],
    ["README.md", lire("README.md")],
    ["THREAT_MODEL.md", lire("docs/THREAT_MODEL.md")],
    ["REGISTRE.md", lire("docs/legal/REGISTRE.md")],
    ["CHAINE.md", lire("docs/CHAINE.md")],
  ];
  for (const [nom, texte] of textes) {
    assert.doesNotMatch(texte, /365 days|365 jours|activity for 12 months|12 mois sans|depuis 12 mois|après 12 mois/i, nom);
  }
  assert.match(privacy, /no request for 180 days/);
  assert.match(lire("PRIVACY.md"), /no activity for 180 days/);
  assert.match(lire("back/services/chaine.js"), /entierEnv\('CHAIN_INACTIVE_DAYS', 180\)/);
});
