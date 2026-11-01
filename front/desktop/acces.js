// Accès du renderer au disque : seulement dans les dossiers que l'utilisateur a
// ouverts lui-même (boîte de dialogue, double-clic, menu, glisser-déposer) et
// dans le vault de la synchro, et seulement pour le type de fichier attendu.
// Le renderer ne peut jamais ajouter un dossier : un script qui s'y
// exécuterait resterait enfermé dans ces dossiers. Les chemins sont comparés
// après résolution des liens symboliques.

const fs = require('fs');
const path = require('path');

const MAX_DOSSIERS = 200;

/** Chemin réel ; pour un fichier pas encore créé, celui de son dossier suivi de son nom. null sinon. */
function cheminReel(chemin) {
  if (typeof chemin !== 'string' || !chemin || chemin.includes('\0')) return null;
  const absolu = path.resolve(chemin);
  try { return fs.realpathSync.native(absolu); } catch {}
  try { return path.join(fs.realpathSync.native(path.dirname(absolu)), path.basename(absolu)); } catch { return null; }
}

/** Vrai si chemin (réel) est le dossier (réel) lui-même ou s'y trouve. */
function estDans(chemin, dossier) {
  const relatif = path.relative(dossier, chemin);
  return relatif === '' || (relatif.split(path.sep)[0] !== '..' && !path.isAbsolute(relatif));
}

/**
 * Chemin réel de `chemin` s'il est dans l'un des `dossiers` et, quand
 * `extensions` est donné, s'il porte l'une d'elles ; sinon null.
 */
function verifierDans(chemin, dossiers, extensions) {
  const reel = cheminReel(chemin);
  if (!reel) return null;
  if (extensions && !extensions.includes(path.extname(reel).toLowerCase())) return null;
  return dossiers.map(cheminReel).filter(Boolean).some((d) => estDans(reel, d)) ? reel : null;
}

class Acces {
  /**
   * @param {string} fichier  liste persistée (userData/acces.json), pour retrouver ses dossiers au redémarrage
   * @param {() => string[]} dossiersFixes  dossiers toujours permis (vault de la synchro...)
   */
  constructor({ fichier, dossiersFixes = () => [] }) {
    this.fichier = fichier;
    this.dossiersFixes = dossiersFixes;
    this.dossiers = [];
    try {
      const lu = JSON.parse(fs.readFileSync(fichier, 'utf-8'));
      if (Array.isArray(lu.racines)) this.dossiers = lu.racines.filter((d) => typeof d === 'string');
    } catch {}
  }

  /** L'utilisateur a ouvert ce dossier lui-même : le renderer peut y lire et y écrire. */
  autoriser(dossier) {
    const reel = cheminReel(dossier);
    if (!reel) return;
    this.dossiers = [reel, ...this.dossiers.filter((d) => d !== reel)].slice(0, MAX_DOSSIERS);
    try { fs.writeFileSync(this.fichier, JSON.stringify({ racines: this.dossiers })); } catch {}
  }

  /** Chemin réel si permis (voir verifierDans), sinon null. */
  verifier(chemin, extensions) {
    return verifierDans(chemin, [...this.dossiers, ...this.dossiersFixes().filter(Boolean)], extensions);
  }
}

module.exports = { Acces, verifierDans };
