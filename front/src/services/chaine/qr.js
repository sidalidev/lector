// Encodeur QR minimal, sans dépendance (docs/CHAINE.md § 3.6 et 8).
//
// Juste ce qu'il faut pour le code d'appairage « lector-chaine:<base64url(S)> »
// (36 caractères, version 3) : mode octet, correction M, versions 1 à 10
// (jusqu'à 213 octets). Écrit d'après la norme ISO/IEC 18004 ;
// la structure suit l'implémentation de référence de Project Nayuki (MIT).
// Vérifié par décodage réel (OpenCV) et par qr.test.mjs (syndromes Reed-Solomon
// nuls, informations de format et de version valides).

// Correction M, versions 1 à 10 : [codes de correction par bloc, [blocs, octets de données]...]
const TABLE_M = [
  null,
  [10, [1, 16]],
  [16, [1, 28]],
  [26, [1, 44]],
  [18, [2, 32]],
  [24, [2, 43]],
  [16, [4, 27]],
  [18, [4, 31]],
  [22, [2, 38], [2, 39]],
  [22, [3, 36], [2, 37]],
  [26, [4, 43], [1, 44]],
];

const ALIGNEMENTS = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

const VERSION_MAX = 10;
const FORMAT_M = 0; // bits de niveau de correction : L=1, M=0, Q=3, H=2

// --- Corps de Galois GF(256), polynôme 0x11D ---

function multiplier(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

/** Polynôme générateur de degré n (coefficients, sans le terme dominant). */
export function diviseurRS(degre) {
  const r = new Array(degre).fill(0);
  r[degre - 1] = 1;
  let racine = 1;
  for (let i = 0; i < degre; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = multiplier(r[j], racine);
      if (j + 1 < r.length) r[j] ^= r[j + 1];
    }
    racine = multiplier(racine, 0x02);
  }
  return r;
}

/** Reste de la division de `donnees` par le générateur : les octets de correction. */
export function resteRS(donnees, diviseur) {
  const r = new Array(diviseur.length).fill(0);
  for (const b of donnees) {
    const facteur = b ^ r.shift();
    r.push(0);
    diviseur.forEach((coef, i) => {
      r[i] ^= multiplier(coef, facteur);
    });
  }
  return r;
}

// --- Données ---

function capaciteOctets(version) {
  const [, ...groupes] = TABLE_M[version];
  const donnees = groupes.reduce((s, [n, k]) => s + n * k, 0);
  const bitsCompte = version <= 9 ? 8 : 16;
  return { donnees, max: Math.floor((donnees * 8 - 4 - bitsCompte) / 8), bitsCompte };
}

function choisirVersion(longueur) {
  for (let v = 1; v <= VERSION_MAX; v++) if (capaciteOctets(v).max >= longueur) return v;
  throw new Error("Texte trop long pour le QR (213 octets au plus)");
}

function codewords(octets, version) {
  const { donnees, bitsCompte } = capaciteOctets(version);
  const bits = [];
  const ajouter = (valeur, n) => {
    for (let i = n - 1; i >= 0; i--) bits.push((valeur >>> i) & 1);
  };
  ajouter(0b0100, 4);
  ajouter(octets.length, bitsCompte);
  for (const o of octets) ajouter(o, 8);
  ajouter(0, Math.min(4, donnees * 8 - bits.length));
  ajouter(0, (8 - (bits.length % 8)) % 8);
  for (let rembourrage = 0xec; bits.length < donnees * 8; rembourrage ^= 0xec ^ 0x11) ajouter(rembourrage, 8);
  const mots = [];
  for (let i = 0; i < bits.length; i += 8) mots.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  // Découpage en blocs, correction de chaque bloc, entrelacement.
  const [nCorrection, ...groupes] = TABLE_M[version];
  const diviseur = diviseurRS(nCorrection);
  const blocs = [];
  let k = 0;
  for (const [n, taille] of groupes) {
    for (let i = 0; i < n; i++) {
      const d = mots.slice(k, k + taille);
      k += taille;
      blocs.push({ d, c: resteRS(d, diviseur) });
    }
  }
  const sortie = [];
  const plusLong = Math.max(...blocs.map((b) => b.d.length));
  for (let i = 0; i < plusLong; i++) for (const b of blocs) if (i < b.d.length) sortie.push(b.d[i]);
  for (let i = 0; i < nCorrection; i++) for (const b of blocs) sortie.push(b.c[i]);
  return { sortie, blocs };
}

// --- Matrice ---

function bit(x, i) {
  return ((x >>> i) & 1) !== 0;
}

class Matrice {
  constructor(version) {
    this.version = version;
    this.taille = version * 4 + 17;
    this.modules = Array.from({ length: this.taille }, () => new Array(this.taille).fill(false));
    this.fonction = Array.from({ length: this.taille }, () => new Array(this.taille).fill(false));
  }

  fixer(x, y, noir) {
    this.modules[y][x] = noir;
    this.fonction[y][x] = true;
  }

  motifsFixes() {
    const t = this.taille;
    for (let i = 0; i < t; i++) {
      this.fixer(6, i, i % 2 === 0);
      this.fixer(i, 6, i % 2 === 0);
    }
    this.reperage(3, 3);
    this.reperage(t - 4, 3);
    this.reperage(3, t - 4);
    const pos = ALIGNEMENTS[this.version];
    const n = pos.length;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
        this.alignement(pos[i], pos[j]);
      }
    }
    this.format(0); // réserve les modules, la vraie valeur est écrite après le masque
    this.infoVersion();
  }

  reperage(x, y) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < this.taille && yy >= 0 && yy < this.taille) this.fixer(xx, yy, d !== 2 && d !== 4);
      }
    }
  }

  alignement(x, y) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) this.fixer(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }

  format(masque) {
    const donnees = (FORMAT_M << 3) | masque;
    let reste = donnees;
    for (let i = 0; i < 10; i++) reste = (reste << 1) ^ ((reste >>> 9) * 0x537);
    const bits = ((donnees << 10) | reste) ^ 0x5412;
    const t = this.taille;
    for (let i = 0; i <= 5; i++) this.fixer(8, i, bit(bits, i));
    this.fixer(8, 7, bit(bits, 6));
    this.fixer(8, 8, bit(bits, 7));
    this.fixer(7, 8, bit(bits, 8));
    for (let i = 9; i < 15; i++) this.fixer(14 - i, 8, bit(bits, i));
    for (let i = 0; i < 8; i++) this.fixer(t - 1 - i, 8, bit(bits, i));
    for (let i = 8; i < 15; i++) this.fixer(8, t - 15 + i, bit(bits, i));
    this.fixer(8, t - 8, true); // module toujours noir
    return bits;
  }

  infoVersion() {
    if (this.version < 7) return;
    let reste = this.version;
    for (let i = 0; i < 12; i++) reste = (reste << 1) ^ ((reste >>> 11) * 0x1f25);
    const bits = (this.version << 12) | reste;
    for (let i = 0; i < 18; i++) {
      const a = this.taille - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.fixer(a, b, bit(bits, i));
      this.fixer(b, a, bit(bits, i));
    }
  }

  placer(mots) {
    const t = this.taille;
    let i = 0;
    for (let droite = t - 1; droite >= 1; droite -= 2) {
      if (droite === 6) droite = 5;
      for (let vert = 0; vert < t; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = droite - j;
          const montant = ((droite + 1) & 2) === 0;
          const y = montant ? t - 1 - vert : vert;
          if (!this.fonction[y][x]) {
            // Au-delà des données : bits de reste, à 0.
            this.modules[y][x] = i < mots.length * 8 ? bit(mots[i >>> 3], 7 - (i & 7)) : false;
            i++;
          }
        }
      }
    }
  }

  masquer(masque) {
    const regles = [
      (x, y) => (x + y) % 2 === 0,
      (x, y) => y % 2 === 0,
      (x) => x % 3 === 0,
      (x, y) => (x + y) % 3 === 0,
      (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
      (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
      (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
      (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
    ];
    const r = regles[masque];
    for (let y = 0; y < this.taille; y++) {
      for (let x = 0; x < this.taille; x++) if (!this.fonction[y][x] && r(x, y)) this.modules[y][x] = !this.modules[y][x];
    }
  }

  penalite() {
    const t = this.taille;
    const m = this.modules;
    let p = 0;
    const lignes = [];
    for (let y = 0; y < t; y++) lignes.push(m[y]);
    for (let x = 0; x < t; x++) lignes.push(m.map((l) => l[x]));
    const motifA = [true, false, true, true, true, false, true, false, false, false, false];
    const motifB = [false, false, false, false, true, false, true, true, true, false, true];
    for (const l of lignes) {
      let serie = 1;
      for (let i = 1; i <= t; i++) {
        if (i < t && l[i] === l[i - 1]) serie++;
        else {
          if (serie >= 5) p += serie - 2;
          serie = 1;
        }
      }
      for (let i = 0; i + 11 <= t; i++) {
        if (motifA.every((v, k) => l[i + k] === v) || motifB.every((v, k) => l[i + k] === v)) p += 40;
      }
    }
    for (let y = 0; y < t - 1; y++) {
      for (let x = 0; x < t - 1; x++) {
        const c = m[y][x];
        if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3;
      }
    }
    const noirs = m.reduce((s, l) => s + l.filter(Boolean).length, 0);
    const total = t * t;
    p += (Math.ceil(Math.abs(noirs * 20 - total * 10) / total) - 1) * 10;
    return p;
  }
}

/**
 * Encode un texte (UTF-8) en QR, correction M.
 * @returns {{ version: number, taille: number, masque: number, modules: boolean[][] }}
 */
export function encoderQR(texte, { masque = null } = {}) {
  const octets = new TextEncoder().encode(String(texte));
  const version = choisirVersion(octets.length);
  const { sortie } = codewords(octets, version);
  let meilleur = null;
  const candidats = masque === null ? [0, 1, 2, 3, 4, 5, 6, 7] : [masque];
  for (const k of candidats) {
    const q = new Matrice(version);
    q.motifsFixes();
    q.placer(sortie);
    q.masquer(k);
    q.format(k);
    const p = q.penalite();
    if (!meilleur || p < meilleur.p) meilleur = { p, q, k };
  }
  return { version, taille: meilleur.q.taille, masque: meilleur.k, modules: meilleur.q.modules };
}

/** Chemin SVG (attribut d) des modules noirs, avec une marge de `marge` modules. */
export function cheminSVG(qr, marge = 4) {
  const morceaux = [];
  qr.modules.forEach((ligne, y) => {
    ligne.forEach((noir, x) => {
      if (noir) morceaux.push(`M${x + marge} ${y + marge}h1v1h-1z`);
    });
  });
  return morceaux.join("");
}

// Exposé pour les tests.
export const _interne = { codewords, capaciteOctets, Matrice };
