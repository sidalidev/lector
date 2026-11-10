// Documents partagés gardés dans le navigateur (IndexedDB « lector-collab »).
//
// Un enregistrement par salon :
//   { id, cle, role: 'proprietaire' | 'invite', secretProprietaire?, titre,
//     chemin?, etat: { local, serveur, seq }, arrete, majLe }
// `cle` et `secretProprietaire` sont en base64url : le propriétaire doit pouvoir
// réafficher le lien, donc la clé reste lisible (docs/collab-design.md § 3.5).
// Les arrêts pas encore reçus par le relais (hors ligne) sont dans « arrets ».
//
// Sans IndexedDB (navigation privée stricte, tests) : une Map en mémoire.

const BASE = "lector-collab";
const SALONS = "salons";
const ARRETS = "arrets";

let promesseBase = null;
const memoire = { [SALONS]: new Map(), [ARRETS]: new Map() };

function base() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (!promesseBase) {
    promesseBase = new Promise((resolve) => {
      try {
        const req = indexedDB.open(BASE, 1);
        req.onupgradeneeded = () => {
          req.result.createObjectStore(SALONS);
          req.result.createObjectStore(ARRETS);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return promesseBase;
}

async function operation(magasin, mode, fn) {
  const db = await base();
  if (!db) return fn(null, memoire[magasin]);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(magasin, mode);
    const req = fn(tx.objectStore(magasin), null);
    tx.oncomplete = () => resolve(req && "result" in req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

const lire = (magasin, cle) => operation(magasin, "readonly", (s, m) => (s ? s.get(cle) : m.get(cle)));
const ecrire = (magasin, cle, valeur) =>
  operation(magasin, "readwrite", (s, m) => (s ? s.put(valeur, cle) : void m.set(cle, valeur)));
const effacer = (magasin, cle) => operation(magasin, "readwrite", (s, m) => (s ? s.delete(cle) : void m.delete(cle)));
const tout = (magasin) => operation(magasin, "readonly", (s, m) => (s ? s.getAll() : [...m.values()]));

export const lireSalon = (id) => lire(SALONS, id);
export const ecrireSalon = (salon) => ecrire(SALONS, salon.id, { ...salon, majLe: Date.now() });
export const effacerSalon = (id) => effacer(SALONS, id);
export const tousLesSalons = () => tout(SALONS);

/** Partage en cours (propriétaire) d'un fichier du vault, ou null. */
export async function partageDuFichier(chemin) {
  if (!chemin) return null;
  const salons = await tousLesSalons();
  return salons.find((s) => s.role === "proprietaire" && s.chemin === chemin && !s.arrete) || null;
}

/** Met à jour l'état Yjs sauvé d'un salon sans toucher au reste. */
export async function sauverEtat(id, etat) {
  const salon = await lireSalon(id);
  if (!salon) return;
  await ecrireSalon({ ...salon, etat });
}

export const arretsEnAttente = () => tout(ARRETS);
export const noterArret = (arret) => ecrire(ARRETS, arret.id, arret);
export const oublierArret = (id) => effacer(ARRETS, id);

// --- Profil : prénom et couleur, gardés dans ce navigateur seulement ---

const CLE_PROFIL = "lector-collab-profil";

/** Couleurs de la charte (miel, sapin, lac, lavande, or) et deux de plus pour les grands groupes. */
export const COULEURS = ["#d9a43b", "#2f6b4f", "#3b7ea1", "#8b7bb8", "#b8912a", "#c8553d", "#4a8f8c"];

// Noms donnés d'office (personne n'a à taper son prénom) ; chacun peut le changer.
const NOMS = ["Fox", "Owl", "Heron", "Lynx", "Otter", "Wren", "Ibex", "Marten", "Robin", "Hare", "Badger", "Swift"];

/** Le profil de ce navigateur, créé au besoin avec un nom et une couleur au hasard. */
export function profil() {
  const p = lireProfil();
  if (p) return p;
  const n = new Uint32Array(1);
  crypto.getRandomValues(n);
  return ecrireProfil(NOMS[n[0] % NOMS.length]);
}

export function lireProfil() {
  try {
    const p = JSON.parse(localStorage.getItem(CLE_PROFIL) || "null");
    if (p && typeof p.nom === "string" && COULEURS.includes(p.couleur)) return p;
  } catch {
    // stockage indisponible
  }
  return null;
}

export function ecrireProfil(nom) {
  const ancien = lireProfil();
  const couleur = ancien?.couleur || COULEURS[Math.floor(Math.random() * COULEURS.length)];
  const profil = { nom: String(nom).trim().slice(0, 40), couleur };
  try {
    localStorage.setItem(CLE_PROFIL, JSON.stringify(profil));
  } catch {
    // stockage indisponible : le prénom vaut pour cette visite
  }
  return profil;
}
