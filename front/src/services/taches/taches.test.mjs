// Tâches et rappels : parseur, bascule d'une case, vue Today.
// Lancer : npm run test:chaine

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyserLigne, analyserNote, basculerTache, vueAujourdhui, rappelsAProgrammer,
  ligneTache, ajouterAInbox, instantLocal, jourLocal, ajouterJours, nomDeNote,
} from "./taches.js";

// Node relit TZ à chaque changement : chaque test fixe le fuseau qu'il suppose.
function dansFuseau(tz, fn) {
  const avant = process.env.TZ;
  process.env.TZ = tz;
  try { return fn(); } finally {
    if (avant === undefined) delete process.env.TZ; else process.env.TZ = avant;
  }
}

test("formats : ⏰ avec heure, ⏰ sans heure, 📅, ✅, puces et listes numérotées", () => {
  dansFuseau("Europe/Paris", () => {
    const a = analyserLigne("- [ ] Call the bank ⏰ 2026-11-03 14:30");
    assert.equal(a.fait, false);
    assert.equal(a.texte, "Call the bank");
    assert.equal(a.heure, "14:30");
    assert.equal(a.jour, "2026-11-03");
    assert.equal(a.rappel, Date.UTC(2026, 10, 3, 13, 30));

    const b = analyserLigne("* [ ] Pay rent 📅 2026-11-05");
    assert.equal(b.texte, "Pay rent");
    assert.equal(b.echeance, "2026-11-05");
    assert.equal(b.heure, null);
    assert.equal(b.rappel, Date.UTC(2026, 10, 5, 8, 0), "échéance : rappel à 9 h locales");

    const c = analyserLigne("+ [ ] Water plants ⏰ 2026-11-04");
    assert.equal(c.rappel, Date.UTC(2026, 10, 4, 8, 0), "⏰ sans heure : 9 h");

    const d = analyserLigne("1. [x] Send the form ✅ 2026-11-02");
    assert.equal(d.fait, true);
    assert.equal(d.faitLe, "2026-11-02");
    assert.equal(d.texte, "Send the form");

    assert.equal(analyserLigne("  - [X] Nested done").fait, true);
    assert.equal(analyserLigne("> - [ ] In a callout ⏰ 2026-11-03 08:00").heure, "08:00");
    assert.equal(analyserLigne("- [ ] Early ⏰ 2026-11-03 7:05").heure, "07:05");
    assert.equal(analyserLigne("- [ ] Windows line ⏰ 2026-11-03 10:00\r").heure, "10:00");

    // ⏰ l'emporte sur 📅 pour l'heure du rappel, 📅 reste l'échéance.
    const e = analyserLigne("- [ ] Both 📅 2026-11-10 ⏰ 2026-11-08 18:00");
    assert.equal(e.jour, "2026-11-08");
    assert.equal(e.echeance, "2026-11-10");
    assert.equal(e.rappel, Date.UTC(2026, 10, 8, 17, 0));
    assert.equal(e.texte, "Both");

    // Les autres champs de Tasks restent dans le texte, l'identifiant de bloc non.
    assert.equal(analyserLigne("- [ ] Weekly 🔁 every week ⏰ 2026-11-03 09:00 ^abc-1").texte, "Weekly 🔁 every week");
  });
});

test("fuseaux : la même ligne sonne à 9 h murales partout, heure d'été comprise", () => {
  const ligne = "- [ ] Standup ⏰ 2026-11-03 09:00";
  assert.equal(dansFuseau("Europe/Paris", () => analyserLigne(ligne).rappel), Date.UTC(2026, 10, 3, 8, 0));
  assert.equal(dansFuseau("America/New_York", () => analyserLigne(ligne).rappel), Date.UTC(2026, 10, 3, 14, 0));
  assert.equal(dansFuseau("Asia/Tokyo", () => analyserLigne(ligne).rappel), Date.UTC(2026, 10, 3, 0, 0));
  assert.equal(dansFuseau("UTC", () => analyserLigne(ligne).rappel), Date.UTC(2026, 10, 3, 9, 0));
  // Été : Paris est à UTC+2.
  assert.equal(dansFuseau("Europe/Paris", () => analyserLigne("- [ ] Summer ⏰ 2026-07-01 09:00").rappel), Date.UTC(2026, 6, 1, 7, 0));
  // Heure sautée (29 mars 2026, 2:00 → 3:00 à Paris) : le rappel tombe juste après le saut.
  dansFuseau("Europe/Paris", () => {
    const t = analyserLigne("- [ ] Gap ⏰ 2026-03-29 02:30").rappel;
    assert.ok(t !== null);
    assert.ok(t >= Date.UTC(2026, 2, 29, 1, 0) && t <= Date.UTC(2026, 2, 29, 1, 30));
  });
  // Le jour local se calcule dans le fuseau de l'appareil.
  assert.equal(dansFuseau("America/Los_Angeles", () => jourLocal(Date.UTC(2026, 10, 3, 5, 0))), "2026-11-02");
  assert.equal(dansFuseau("Europe/Paris", () => jourLocal(Date.UTC(2026, 10, 3, 5, 0))), "2026-11-03");
  assert.equal(dansFuseau("Europe/Paris", () => ajouterJours("2026-03-28", 1)), "2026-03-29");
  assert.equal(dansFuseau("Europe/Paris", () => ajouterJours("2026-12-29", 7)), "2027-01-05");
});

test("lignes ambiguës : pas une tâche, ou pas de rappel", () => {
  dansFuseau("Europe/Paris", () => {
    for (const l of [
      "- [ ]",                        // case vide sans texte
      "- [ ]    ",
      "-[ ] glued",                   // pas d'espace après le tiret
      "- [] no space",
      "- [y] other status",           // statut inconnu : ni ouverte ni faite
      "- [-] cancelled",
      "[ ] no bullet",
      "Text - [ ] in the middle",
      "    ```- [ ] not a list",
    ]) assert.equal(analyserLigne(l), null, l);

    // Dates impossibles : la tâche existe, sans rappel.
    for (const l of [
      "- [ ] Bad day ⏰ 2026-02-30 10:00",
      "- [ ] Bad hour ⏰ 2026-11-03 24:00",
      "- [ ] Bad minute ⏰ 2026-11-03 10:61",
      "- [ ] Bad month 📅 2026-13-01",
      "- [ ] Short year ⏰ 26-11-03 10:00",
      "- [ ] No date ⏰ tomorrow",
    ]) {
      const t = analyserLigne(l);
      assert.ok(t, l);
      assert.equal(t.rappel, null, l);
      assert.equal(t.jour, null, l);
    }
    // ⏰ invalide mais 📅 valide : l'échéance sert de rappel.
    const t = analyserLigne("- [ ] Fallback ⏰ 2026-11-03 25:00 📅 2026-11-04");
    assert.equal(t.jour, "2026-11-04");
    assert.equal(t.rappel, Date.UTC(2026, 10, 4, 8, 0));
  });
});

test("une note : blocs de code, en-tête YAML et bloc lector-generated ignorés, lignes du fichier", () => {
  const note = [
    "---",
    "tags: [x]",
    "- [ ] in front matter",
    "---",
    "# Title",
    "",
    "- [ ] First ⏰ 2026-11-03 09:00",
    "```",
    "- [ ] in code",
    "```",
    "~~~~md",
    "- [ ] in tilde code",
    "~~~",
    "- [ ] still in code (shorter fence)",
    "~~~~",
    "  - [x] Second ✅ 2026-11-01",
    "<!-- lector-generated -->",
    "- [ ] generated",
    "<!-- /lector-generated -->",
  ].join("\n");
  const taches = analyserNote(note, "Notes/Week.md");
  assert.deepEqual(taches.map((t) => [t.ligne, t.texte]), [[7, "First"], [16, "Second"]]);
  assert.equal(taches[0].chemin, "Notes/Week.md");
  assert.deepEqual(analyserNote(""), []);
  assert.deepEqual(analyserNote(null), []);
});

test("bascule : écriture exacte du fichier, aller et retour", () => {
  const avant = "# Week\n\n- [ ] Call the bank ⏰ 2026-11-03 14:30\n- [ ] Other\n";
  const coche = basculerTache(avant, 3, "2026-11-02");
  assert.equal(coche.fait, true);
  assert.equal(coche.contenu, "# Week\n\n- [x] Call the bank ⏰ 2026-11-03 14:30 ✅ 2026-11-02\n- [ ] Other\n");
  const decoche = basculerTache(coche.contenu, 3, "2026-11-04");
  assert.equal(decoche.fait, false);
  assert.equal(decoche.contenu, avant, "décocher rend le fichier d'origine");

  // [X] majuscule sans date de fin : décochée proprement.
  assert.equal(basculerTache("- [X] Done", 1, "2026-11-02").contenu, "- [ ] Done");
  // Identifiant de bloc : la date se place avant, comme le plugin Tasks.
  assert.equal(basculerTache("- [ ] Ref ^id-1", 1, "2026-11-02").contenu, "- [x] Ref ✅ 2026-11-02 ^id-1");
  // Une date de fin déjà là n'est pas dupliquée.
  assert.equal(basculerTache("- [ ] Again ✅ 2026-10-01", 1, "2026-11-02").contenu, "- [x] Again ✅ 2026-11-02");
  // Fins de ligne Windows, indentation, liste numérotée et citation conservées.
  assert.equal(basculerTache("a\r\n  3) [ ] Item\r\nb\r\n", 2, "2026-11-02").contenu, "a\r\n  3) [x] Item ✅ 2026-11-02\r\nb\r\n");
  assert.equal(basculerTache("> - [ ] Quoted", 1, "2026-11-02").contenu, "> - [x] Quoted ✅ 2026-11-02");
  // Pas de saut de ligne final : il n'en apparaît pas.
  assert.equal(basculerTache("- [ ] Last", 1, "2026-11-02").contenu, "- [x] Last ✅ 2026-11-02");
});

test("bascule : refuse ce qui n'est pas une tâche, suit une ligne déplacée", () => {
  assert.equal(basculerTache("# Title\n- [ ] A", 1, "2026-11-02"), null);
  assert.equal(basculerTache("- [ ] A", 5, "2026-11-02"), null);
  assert.equal(basculerTache("```\n- [ ] code\n```", 2, "2026-11-02"), null);
  assert.equal(basculerTache("- [-] cancelled", 1, "2026-11-02"), null);

  // Une ligne ajoutée au-dessus entre-temps : la tâche est retrouvée par son texte.
  const r = basculerTache("New line\n# W\n- [ ] Call", 2, "2026-11-02", "- [ ] Call");
  assert.equal(r.ligne, 3);
  assert.equal(r.contenu, "New line\n# W\n- [x] Call ✅ 2026-11-02");
  // Introuvable ou en double : rien n'est écrit.
  assert.equal(basculerTache("- [ ] Changed", 1, "2026-11-02", "- [ ] Call"), null);
  assert.equal(basculerTache("- [ ] Call\n- [ ] Call", 3, "2026-11-02", "- [ ] Call"), null);
});

test("vue Today : en retard, du jour, 7 jours, cochées du jour, triées", () => {
  dansFuseau("Europe/Paris", () => {
    const maintenant = Date.UTC(2026, 10, 2, 10, 0); // lundi 2 novembre, 11 h à Paris
    const notes = {
      "Inbox.md": [
        "- [ ] Late ⏰ 2026-10-30 18:00",
        "- [ ] Today later ⏰ 2026-11-02 16:00",
        "- [ ] Today due 📅 2026-11-02",
        "- [ ] In a week 📅 2026-11-09",
        "- [ ] Too far 📅 2026-11-10",
        "- [ ] No date",
        "- [x] Old done ⏰ 2026-10-01 10:00 ✅ 2026-10-01",
        "- [x] Done today ⏰ 2026-11-02 08:00 ✅ 2026-11-02",
      ].join("\n"),
      "Work/Plan.md": "- [ ] Earlier today ⏰ 2026-11-02 08:30\n- [ ] Tomorrow ⏰ 2026-11-03 10:00",
    };
    const taches = Object.entries(notes).flatMap(([c, t]) => analyserNote(t, c));
    const v = vueAujourdhui(taches, maintenant);
    assert.deepEqual(v.enRetard.map((t) => t.texte), ["Late"]);
    assert.deepEqual(v.aujourdhui.map((t) => t.texte), ["Earlier today", "Today due", "Today later", "Done today"]);
    assert.deepEqual(v.aVenir.map((t) => t.texte), ["Tomorrow", "In a week"]);
    assert.equal(v.aujourdhui[0].chemin, "Work/Plan.md");

    const vide = vueAujourdhui([], maintenant);
    assert.deepEqual(vide, { enRetard: [], aujourdhui: [], aVenir: [] });
  });
});

test("rappels : seulement ouverts et à venir, plus proches d'abord, ids stables et distincts", () => {
  dansFuseau("Europe/Paris", () => {
    const maintenant = Date.UTC(2026, 10, 2, 10, 0);
    const taches = analyserNote([
      "- [ ] Past ⏰ 2026-11-02 08:00",
      "- [ ] Soon ⏰ 2026-11-02 12:00",
      "- [x] Done ⏰ 2026-11-02 13:00 ✅ 2026-11-02",
      "- [ ] Due 📅 2026-11-04",
      "- [ ] Plain",
    ].join("\n"), "Notes/Day.md");
    const r = rappelsAProgrammer(taches, maintenant);
    assert.deepEqual(r.map((x) => x.titre), ["Soon", "Due"]);
    assert.equal(r[0].note, "Day");
    assert.equal(r[0].ligne, 2);
    assert.equal(r[0].quand, Date.UTC(2026, 10, 2, 11, 0));
    assert.ok(r.every((x) => Number.isInteger(x.id) && x.id > 0 && x.id < 2 ** 31));
    assert.deepEqual(rappelsAProgrammer(taches, maintenant).map((x) => x.id), r.map((x) => x.id), "stables");
    // Deux lignes identiques dans la même note : deux ids.
    const doubles = rappelsAProgrammer(analyserNote("- [ ] Same ⏰ 2026-11-05 10:00\n- [ ] Same ⏰ 2026-11-05 10:00", "a.md"), maintenant);
    assert.equal(new Set(doubles.map((x) => x.id)).size, 2);
    // Plafond.
    const beaucoup = analyserNote(Array.from({ length: 80 }, (_, i) => `- [ ] T${i} ⏰ 2026-12-${String((i % 28) + 1).padStart(2, "0")} 10:00`).join("\n"), "b.md");
    assert.equal(rappelsAProgrammer(beaucoup, maintenant).length, 50);
  });
});

test("ajout rapide : ligne écrite et Inbox.md", () => {
  assert.equal(ligneTache("  Call  the\nbank "), "- [ ] Call the bank");
  assert.equal(ligneTache("Call", { date: "2026-11-03", heure: "14:30" }), "- [ ] Call ⏰ 2026-11-03 14:30");
  assert.equal(ligneTache("Call", { date: "2026-11-03" }), "- [ ] Call 📅 2026-11-03");
  assert.equal(ligneTache("Call", { heure: "14:30" }), "- [ ] Call", "heure sans date ignorée");
  assert.equal(ligneTache("   "), null);

  assert.equal(ajouterAInbox(null, "- [ ] A"), "# Inbox\n\n- [ ] A\n");
  assert.equal(ajouterAInbox("# Inbox\n\n- [ ] A\n", "- [ ] B"), "# Inbox\n\n- [ ] A\n- [ ] B\n");
  assert.equal(ajouterAInbox("# Inbox\n\n- [ ] A", "- [ ] B"), "# Inbox\n\n- [ ] A\n- [ ] B\n");
  assert.equal(ajouterAInbox("# Inbox\r\n\r\n- [ ] A\r\n", "- [ ] B"), "# Inbox\r\n\r\n- [ ] A\r\n- [ ] B\r\n");
  assert.equal(
    ajouterAInbox("# Inbox\n- [ ] A\n\n<!-- lector-generated -->\nx\n<!-- /lector-generated -->\n", "- [ ] B"),
    "# Inbox\n- [ ] A\n- [ ] B\n\n<!-- lector-generated -->\nx\n<!-- /lector-generated -->\n",
  );
  // La tâche ajoutée se relit.
  assert.equal(analyserNote(ajouterAInbox(null, ligneTache("X", { date: "2026-11-03", heure: "09:00" })))[0].heure, "09:00");
});

test("utilitaires", () => {
  assert.equal(nomDeNote("cloud://Work/Plan.md"), "Plan");
  assert.equal(nomDeNote("content://x/tree/primary%3ANotes%2FInbox.md"), "Inbox");
  assert.equal(nomDeNote("C:\\Notes\\Day.markdown"), "Day");
  assert.equal(instantLocal(2026, 2, 29, 9, 0), null);
});
