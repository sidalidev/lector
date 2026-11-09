// Partage d'un document, côté navigateur : créer, ouvrir, arrêter (docs/collab-design.md § 7 et 8).
//
// Chargé seulement à la demande (route /d/ ou bouton Partager) : Yjs n'entre
// pas dans le paquet principal de l'application.

import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import {
  base64urlVersOctets,
  cleVersTexte,
  lienInvitation,
  nouveauSecretProprietaire,
  nouvelleCle,
  octetsVersBase64url,
  preparerSalon,
} from "./crypto.js";
import { SalonCollab, STATUTS, arreterSalon, urlRelais } from "./salon.js";
import * as stockage from "./stockage.js";

export { STATUTS };

/** Nom du Y.Text qui porte le Markdown dans chaque salon. */
export const CHAMP_TEXTE = "md";

// Même origine dans un navigateur ; l'app mobile ou de bureau parle au serveur public.
const NATIF = typeof window !== "undefined" && !!window.Capacitor?.isNativePlatform?.();
export const ORIGINE =
  !NATIF && typeof location !== "undefined" && /^https?:$/.test(location.protocol)
    ? `${location.protocol}//${location.host}`
    : "https://lector.dockerbop.fr";
export const URL_RELAIS = urlRelais(ORIGINE);

/** Lien d'invitation d'un salon enregistré. */
export function lienDu(salon) {
  return lienInvitation(ORIGINE, base64urlVersOctets(salon.cle));
}

/** Titre lisible : premier titre Markdown, sinon première ligne. */
export function titreDu(texte, defaut = "Shared document") {
  const lignes = String(texte || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const titre = lignes.find((l) => /^#{1,6}\s/.test(l)) || lignes[0] || "";
  return titre.replace(/^#{1,6}\s+/, "").slice(0, 80) || defaut;
}

/**
 * Attend que le relais ait acquitté l'état initial (le salon existe alors pour
 * les invités), puis ferme la connexion. Résout false si le relais est injoignable.
 */
function publierEtat(client, delaiMs, vide) {
  return new Promise((resolve) => {
    const minuterie = setTimeout(() => resolve(false), delaiMs);
    const verifier = () => {
      if (client.statut === STATUTS.EN_LIGNE && client.enAttente.length === 0 && (client.seq > 0 || vide)) {
        clearTimeout(minuterie);
        resolve(true);
        return;
      }
      if ([STATUTS.ARRETE, STATUTS.REFUSE, STATUTS.PLEIN].includes(client.statut)) {
        clearTimeout(minuterie);
        resolve(false);
        return;
      }
      setTimeout(verifier, 50);
    };
    verifier();
  });
}

/**
 * Crée un partage : nouvelle clé, nouveau salon, texte initial chiffré et déposé.
 * Renvoie l'enregistrement et le lien. Le salon est créé même si personne
 * n'ouvre la page tout de suite ; hors ligne, il le sera à la première ouverture.
 */
export async function creerPartage({ texte, titre, chemin = null, WebSocket = globalThis.WebSocket, delaiMs = 8000 }) {
  const K = nouvelleCle();
  const O = nouveauSecretProprietaire();
  const salon = await preparerSalon(K);
  const doc = new Y.Doc();
  doc.getText(CHAMP_TEXTE).insert(0, String(texte || ""));
  const enregistrement = {
    id: salon.id,
    cle: cleVersTexte(K),
    role: "proprietaire",
    secretProprietaire: octetsVersBase64url(O),
    titre: titre || titreDu(texte),
    chemin,
    etat: { local: Y.encodeStateAsUpdate(doc), serveur: new Uint8Array(0), seq: 0 },
    arrete: false,
    creeLe: Date.now(),
  };
  await stockage.ecrireSalon(enregistrement);

  const client = new SalonCollab({
    salon,
    doc,
    url: URL_RELAIS,
    WebSocket,
    secretProprietaire: O,
    onSauver: (etat) => stockage.sauverEtat(salon.id, etat),
  });
  client.connecter();
  const enLigne = await publierEtat(client, delaiMs, !texte);
  await client.fermer();
  return { enregistrement: await stockage.lireSalon(salon.id), lien: await lienInvitation(ORIGINE, K), enLigne };
}

/**
 * Ouvre un salon enregistré : Y.Doc chargé depuis la copie locale, présence
 * (prénom, couleur), client connecté. L'appelant ferme avec session.fermer().
 */
export async function ouvrirSession(enregistrement, { profil, onStatut, WebSocket = globalThis.WebSocket } = {}) {
  const K = base64urlVersOctets(enregistrement.cle);
  const salon = await preparerSalon(K);
  const doc = new Y.Doc();
  if (enregistrement.etat?.local?.length) Y.applyUpdate(doc, enregistrement.etat.local);
  const presence = new Awareness(doc);
  if (profil) presence.setLocalStateField("user", { name: profil.nom, color: profil.couleur, colorLight: `${profil.couleur}33` });
  const O = enregistrement.role === "proprietaire" && enregistrement.secretProprietaire
    ? base64urlVersOctets(enregistrement.secretProprietaire)
    : null;
  const client = new SalonCollab({
    salon,
    doc,
    presence,
    url: URL_RELAIS,
    WebSocket,
    secretProprietaire: O,
    etat: enregistrement.etat || {},
    onStatut,
    onSauver: (etat) => stockage.sauverEtat(enregistrement.id, etat),
  });
  client.connecter();
  return {
    doc,
    texte: doc.getText(CHAMP_TEXTE),
    presence,
    client,
    async fermer() {
      await client.fermer();
      presence.destroy();
    },
  };
}

/**
 * Arrête un partage (propriétaire). La clé et le secret sont oubliés tout de
 * suite ; la copie du texte reste. Hors ligne, l'arrêt est noté et renvoyé
 * plus tard (reessayerArrets). Renvoie true si le relais l'a déjà appliqué.
 */
export async function arreterPartage(enregistrement, { WebSocket = globalThis.WebSocket } = {}) {
  if (enregistrement.role !== "proprietaire" || !enregistrement.secretProprietaire) {
    throw new Error("Seul le propriétaire peut arrêter le partage");
  }
  const arret = { id: enregistrement.id, cle: enregistrement.cle, secretProprietaire: enregistrement.secretProprietaire };
  await stockage.noterArret(arret);
  await stockage.ecrireSalon({ ...enregistrement, cle: null, secretProprietaire: null, arrete: true });
  return envoyerArret(arret, WebSocket);
}

async function envoyerArret(arret, WebSocket) {
  const ok = await arreterSalon({
    salon: await preparerSalon(base64urlVersOctets(arret.cle)),
    secretProprietaire: base64urlVersOctets(arret.secretProprietaire),
    url: URL_RELAIS,
    WebSocket,
  });
  if (ok) await stockage.oublierArret(arret.id);
  return ok;
}

/** Renvoie les arrêts notés hors ligne. Sans effet s'il n'y en a pas. */
export async function reessayerArrets({ WebSocket = globalThis.WebSocket } = {}) {
  for (const arret of await stockage.arretsEnAttente()) {
    try {
      await envoyerArret(arret, WebSocket);
    } catch {
      // réessayé à la prochaine ouverture
    }
  }
}

/** Fichier .md à télécharger : la copie locale, telle quelle. */
export function telechargerMarkdown(texte, titre) {
  const nom = `${String(titre || "document").replace(/[\\/:*?"<>|]+/g, "-").trim() || "document"}.md`;
  const url = URL.createObjectURL(new Blob([texte], { type: "text/markdown;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nom;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export { stockage };
