// Mode mis en forme : syntaxe cachée hors de la ligne active, case à cocher,
// Cmd+B / Cmd+I, et l'affichage ne modifie jamais le document.
// Lancer : npm run test:chaine

import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState, EditorSelection } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { construireDecorations, lignesActives, CaseWidget } from "./decorations.js";
import { basculerCase, entourer } from "./commandes.js";

const DOC = [
  "# Title",                      // 1
  "",                             // 2
  "Some **bold** and _it_ text.", // 3
  "> A quote",                    // 4
  "- item",                       // 5
  "- [ ] Buy bread",              // 6
  "- [x] Done ✅ 2026-11-01",     // 7
  "",                             // 8
  "---",                          // 9
  "",                             // 10
  "[site](https://example.com)",  // 11
  "```",                          // 12
  "- [ ] not a task",             // 13
  "```",                          // 14
].join("\n");

function etat(doc = DOC, curseur = 0) {
  const s = EditorState.create({
    doc,
    selection: EditorSelection.cursor(curseur),
    extensions: [markdown({ base: markdownLanguage })],
  });
  ensureSyntaxTree(s, s.doc.length, 5000);
  // Une transaction vide range dans l'état l'arbre complété par ensureSyntaxTree.
  return s.update({}).state;
}

/** Décorations à plat : [{ from, to, classe, widget }]. */
function aPlat(s, focus = true) {
  const set = construireDecorations(s, [{ from: 0, to: s.doc.length }], { focus });
  const out = [];
  set.between(0, s.doc.length, (from, to, d) => {
    out.push({ from, to, classe: d.spec.class, widget: d.spec.widget, texte: s.doc.sliceString(from, to) });
  });
  return out;
}

const debutLigne = (s, n) => s.doc.line(n).from;
const cachesSur = (decos, s, n) => decos.filter((d) => d.classe === "cm-lp-cache" && s.doc.lineAt(d.from).number === n).map((d) => d.texte);
const marquesSur = (decos, s, n) => decos.filter((d) => d.classe === "cm-lp-marque" && s.doc.lineAt(d.from).number === n).map((d) => d.texte);

test("hors de la ligne active, la syntaxe est cachée ; sur la ligne active, atténuée", () => {
  const s = etat(DOC, debutLigne(etat(), 3) + 2); // curseur sur la ligne 3
  const d = aPlat(s);
  assert.deepEqual(cachesSur(d, s, 1), ["# "]);
  assert.deepEqual(marquesSur(d, s, 3), ["**", "**", "_", "_"]);
  assert.deepEqual(cachesSur(d, s, 3), []);
  assert.deepEqual(cachesSur(d, s, 4), ["> "]);
  assert.deepEqual(cachesSur(d, s, 11), ["[", "]", "(", "https://example.com", ")"]);
  assert.deepEqual(cachesSur(d, s, 9), ["---"]);
});

test("le curseur sur le titre fait réapparaître « # »", () => {
  const s = etat(DOC, 3);
  const d = aPlat(s);
  assert.deepEqual(cachesSur(d, s, 1), []);
  assert.deepEqual(marquesSur(d, s, 1), ["# "]);
  // Les autres lignes restent mises en forme.
  assert.deepEqual(cachesSur(d, s, 3), ["**", "**", "_", "_"]);
});

test("une sélection sur plusieurs lignes les rend toutes éditables", () => {
  const base = etat();
  const s = base.update({ selection: EditorSelection.range(2, debutLigne(base, 4) + 3) }).state;
  const d = aPlat(s);
  for (const n of [1, 3, 4]) assert.deepEqual(cachesSur(d, s, n), [], `ligne ${n}`);
  assert.deepEqual(cachesSur(d, s, 5).length + cachesSur(d, s, 11).length > 0, true);
});

test("sans focus, tout le document est mis en forme", () => {
  const s = etat(DOC, 3);
  assert.equal(lignesActives(s, false).size, 0);
  assert.deepEqual(cachesSur(aPlat(s, false), s, 1), ["# "]);
});

test("titres, puces, cases et blocs de code reçoivent leur classe", () => {
  const s = etat(DOC, debutLigne(etat(), 2));
  const d = aPlat(s);
  const classesLigne = (n) => d.filter((x) => x.from === debutLigne(s, n) && x.from === x.to).map((x) => x.classe).join(" ");
  assert.match(classesLigne(1), /cm-lp-h1/);
  assert.match(classesLigne(4), /cm-lp-citation/);
  assert.match(classesLigne(9), /cm-lp-hr/);
  assert.match(classesLigne(12), /cm-lp-bloc-code-debut/);
  assert.match(classesLigne(14), /cm-lp-bloc-code-fin/);
  assert.ok(d.some((x) => x.classe === "cm-lp-puce" && x.texte === "-" && s.doc.lineAt(x.from).number === 5));
  const cases = d.filter((x) => x.widget instanceof CaseWidget);
  assert.deepEqual(cases.map((x) => [s.doc.lineAt(x.from).number, x.widget.cochee]), [[6, false], [7, true]]);
  // Une « tâche » dans un bloc de code n'en est pas une.
  assert.ok(!cases.some((x) => s.doc.lineAt(x.from).number === 13));
  assert.ok(d.some((x) => x.classe === "cm-lp-fait" && x.texte.startsWith("Done")));
});

test("l'affichage ne modifie jamais le document", () => {
  let s = etat();
  const avant = s.doc.toString();
  for (let pos = 0; pos <= s.doc.length; pos += 7) {
    s = s.update({ selection: EditorSelection.cursor(pos) }).state;
    construireDecorations(s, [{ from: 0, to: s.doc.length }], { focus: true });
    construireDecorations(s, [{ from: 0, to: s.doc.length }], { focus: false });
  }
  assert.equal(s.doc.toString(), avant);
});

test("seules les plages visibles sont décorées", () => {
  const long = Array.from({ length: 5000 }, (_, i) => (i % 10 === 0 ? `## Part ${i}` : `Line **${i}** with _text_`)).join("\n");
  const s = etat(long, 0);
  const l = s.doc.line(2500);
  const set = construireDecorations(s, [{ from: l.from, to: s.doc.line(2540).to }], { focus: true });
  let min = Infinity, max = -1, n = 0;
  set.between(0, s.doc.length, (from, to) => { min = Math.min(min, from); max = Math.max(max, to); n++; });
  assert.ok(n > 0);
  assert.ok(min >= l.from && max <= s.doc.line(2540).to);
});

test("cocher écrit « - [x] » et la date, décocher les retire, changement minimal", () => {
  const s = etat();
  const spec = basculerCase(s, debutLigne(s, 6) + 3, "2026-11-10");
  const s2 = s.update(spec).state;
  assert.equal(s2.doc.line(6).text, "- [x] Buy bread ✅ 2026-11-10");
  // Seuls « x » et la date passent : le reste de la ligne ne bouge pas.
  assert.deepEqual(spec.changes.map((c) => [c.to - c.from, c.insert]), [[1, "x"], [0, " ✅ 2026-11-10"]]);
  const s3 = s2.update(basculerCase(s2, debutLigne(s2, 6), "2026-11-10")).state;
  assert.equal(s3.doc.line(6).text, "- [ ] Buy bread");
  const s4 = s.update(basculerCase(s, debutLigne(s, 7), "2026-11-10")).state;
  assert.equal(s4.doc.line(7).text, "- [ ] Done");
  // Les autres lignes sont intactes.
  assert.equal(s3.doc.toString(), s.doc.toString());
  assert.equal(basculerCase(s, debutLigne(s, 5)), null);
});

test("Cmd+B / Cmd+I entourent la sélection, et l'enlèvent si elle y est déjà", () => {
  const s = EditorState.create({ doc: "hello world", selection: EditorSelection.range(0, 5) });
  const gras = entourer(s, "**").state;
  assert.equal(gras.doc.toString(), "**hello** world");
  assert.equal(gras.sliceDoc(gras.selection.main.from, gras.selection.main.to), "hello");
  assert.equal(entourer(gras, "**").state.doc.toString(), "hello world");
  const italique = entourer(EditorState.create({ doc: "a b", selection: EditorSelection.cursor(1) }), "_").state;
  assert.equal(italique.doc.toString(), "a__ b");
  assert.equal(italique.selection.main.head, 2);
  const dedans = EditorState.create({ doc: "_x_", selection: EditorSelection.range(0, 3) });
  assert.equal(entourer(dedans, "_").state.doc.toString(), "x");
});
