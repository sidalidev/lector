import { useState, useEffect, useRef, useCallback, useMemo, memo, lazy, Suspense } from 'react';
import fileSystem from '../services/fileSystem';
import storage from '../services/storage';
import { allerALigne, allerAPosition, ligneEnHaut, titresDe } from '../services/editeurCourant';
import { noter } from '../services/historique';
import { messageChaine } from '../utils/messagesErreur';
import { partageDuFichier } from '../services/collab/stockage.js';
import './DocumentView.css';
import { t } from '../services/i18n';

// La note se lit et s'écrit au même endroit : l'éditeur mis en forme (façon
// Bear). Chargé à la demande avec CodeMirror.
const MarkdownEditor = lazy(() => import('./MarkdownEditor'));

const ecrivable = (chemin) => !!chemin;

const DocumentView = memo(function DocumentView({
  content,
  dirPath,
  filePath,
  onOpenLocalFile,
  onDocInfo,
  onContentChange,
}) {
  const internalRef = useRef(null);

  // --- Texte : l'éditeur le possède, on l'enregistre 1 s après la dernière frappe ---
  // `valeur` ne change que pour imposer un texte venu d'ailleurs (autre appareil,
  // fichier modifié sur le disque) : la frappe ne fait pas re-rendre la vue.
  const [valeur, setValeur] = useState({ chemin: filePath, texte: content });
  const texteRef = useRef(content);       // ce que montre l'éditeur
  const enregistreRef = useRef(content);  // dernier texte écrit (ou lu) sur le disque
  const minuteurRef = useRef(null);
  const ouvertureRef = useRef({ chemin: filePath, texte: content }); // texte à l'ouverture : première version
  const [saveError, setSaveError] = useState(null);
  // Notes gardées sur l'appareil faute de réseau (envoyées au retour).
  const [enAttente, setEnAttente] = useState(0);
  useEffect(() => {
    const suivre = (e) => setEnAttente(e.detail?.n || 0);
    window.addEventListener('lector-attente', suivre);
    return () => window.removeEventListener('lector-attente', suivre);
  }, []);

  const onContentChangeRef = useRef(onContentChange);
  onContentChangeRef.current = onContentChange;

  const enregistrer = useCallback(async (chemin, texte, { propager = true } = {}) => {
    if (!ecrivable(chemin) || texte === enregistreRef.current) return;
    try {
      await fileSystem.writeFile(chemin, texte);
      setSaveError(null);
      if (propager) {
        enregistreRef.current = texte;
        onContentChangeRef.current?.(texte);
      }
      // Historique des versions (sur cet appareil) : qui a écrit, d'après le salon.
      noter(chemin, texte, { auteurs: liaisonRef.current?.prendreAuteurs() ?? [], avant: ouvertureRef.current?.chemin === chemin ? ouvertureRef.current.texte : null });
    } catch (err) {
      // Casier plein, document trop gros, modifié ailleurs… : affiché au-dessus de la note.
      setSaveError(messageChaine(err));
    }
  }, []);

  // Changement de note : le texte de la précédente part sur SON fichier, sans
  // être propagé à l'application (qui affiche déjà la nouvelle).
  useEffect(() => {
    texteRef.current = content;
    enregistreRef.current = content;
    ouvertureRef.current = { chemin: filePath, texte: content };
    setValeur({ chemin: filePath, texte: content });
    setSaveError(null);
    return () => {
      clearTimeout(minuteurRef.current);
      if (texteRef.current !== enregistreRef.current) {
        enregistrer(filePath, texteRef.current, { propager: false });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath]);

  // --- Note partagée : l'éditeur écrit dans le salon, avec les curseurs des autres ---
  const [liaison, setLiaison] = useState(null);      // { chemin, extensions, texte(), appliquerFichier, fermer }
  const [personnes, setPersonnes] = useState([]);
  const [verifPartage, setVerifPartage] = useState(0);
  const [suivi, setSuivi] = useState(null);           // client suivi (son curseur reste à l'écran)
  const arretSuiviRef = useRef(null);
  const basculerSuivi = (client) => {
    arretSuiviRef.current?.();
    arretSuiviRef.current = null;
    if (suivi === client || !liaisonRef.current) { setSuivi(null); return; }
    setSuivi(client);
    arretSuiviRef.current = liaisonRef.current.suivre(client, allerAPosition, () => setSuivi(null));
  };
  useEffect(() => () => arretSuiviRef.current?.(), [filePath]);
  const liaisonRef = useRef(null);
  liaisonRef.current = liaison?.chemin === filePath ? liaison : null;

  useEffect(() => {
    const surPartage = () => setVerifPartage((n) => n + 1);
    window.addEventListener('lector-partage', surPartage);
    return () => window.removeEventListener('lector-partage', surPartage);
  }, []);

  useEffect(() => {
    if (!ecrivable(filePath)) return undefined;
    let annule = false;
    let l = null;
    const quitter = () => {
      // Retour à la note seule : l'éditeur reprend le dernier texte connu.
      setValeur({ chemin: filePath, texte: texteRef.current });
      setLiaison(null);
      setPersonnes([]);
    };
    (async () => {
      const enregistrement = await partageDuFichier(filePath).catch(() => null);
      if (annule || !enregistrement?.cle) return;
      const { relier } = await import('../services/collab/liaison.js');
      const { STATUTS } = await import('../services/collab/partage.js');
      if (annule) return;
      l = await relier(enregistrement, {
        onPersonnes: (p) => { if (!annule) setPersonnes(p); },
        onStatut: (st) => {
          if (st === STATUTS.ARRETE || st === STATUTS.REFUSE) { annule = true; l?.fermer(); quitter(); }
        },
      });
      if (annule) { l.fermer(); return; }
      setLiaison({ chemin: filePath, ...l });
      // Le salon a pu avancer pendant l'absence : le fichier le rattrape.
      const texte = l.texte();
      if (texte !== texteRef.current) handleChangeRef.current(texte);
    })();
    return () => {
      annule = true;
      if (l) { l.fermer(); quitter(); }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, verifPartage]);

  // Même note, texte venu d'ailleurs : adopté seulement si rien n'attend d'être enregistré ici.
  // Note partagée : il devient une modification du salon, que les autres reçoivent.
  useEffect(() => {
    if (content === texteRef.current) return;
    if (texteRef.current !== enregistreRef.current) return;
    if (liaisonRef.current) {
      enregistreRef.current = content;
      liaisonRef.current.appliquerFichier(content);
      return;
    }
    texteRef.current = content;
    enregistreRef.current = content;
    setValeur({ chemin: filePath, texte: content });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  const handleChange = useCallback((texte) => {
    texteRef.current = texte;
    clearTimeout(minuteurRef.current);
    const chemin = filePath;
    minuteurRef.current = setTimeout(() => enregistrer(chemin, texteRef.current), 1000);
  }, [filePath, enregistrer]);
  const handleChangeRef = useRef(handleChange);
  handleChangeRef.current = handleChange;

  // Fermeture de l'onglet ou de l'app : ne rien perdre de la dernière seconde.
  useEffect(() => {
    const vider = () => {
      if (texteRef.current !== enregistreRef.current) enregistrer(filePath, texteRef.current);
    };
    window.addEventListener('pagehide', vider);
    const cache = () => { if (document.visibilityState === 'hidden') vider(); };
    document.addEventListener('visibilitychange', cache);
    return () => {
      window.removeEventListener('pagehide', vider);
      document.removeEventListener('visibilitychange', cache);
    };
  }, [filePath, enregistrer]);

  // --- Sommaire ---
  const titres = useMemo(() => titresDe(content), [content]);
  useEffect(() => { onDocInfo?.({ headers: titres }); }, [titres, onDocInfo]);

  // --- Images locales et liens vers d'autres notes ---
  const dirPathRef = useRef(dirPath);
  dirPathRef.current = dirPath;
  const onOpenLocalFileRef = useRef(onOpenLocalFile);
  onOpenLocalFileRef.current = onOpenLocalFile;
  const options = useMemo(() => {
    const cache = new Map();
    return {
      resoudreImage(src) {
        const dossier = dirPathRef.current;
        if (!dossier) return null;
        const cle = `${dossier}|${src}`;
        if (!cache.has(cle)) {
          cache.set(cle, fileSystem.readLocalMedia(decodeURI(src), dossier).catch(() => null));
        }
        return cache.get(cle);
      },
      ouvrirLien(href) {
        if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return false;
        const chemin = decodeURIComponent(href.split('#')[0]);
        if (!/\.md$/i.test(chemin)) return false;
        onOpenLocalFileRef.current?.(chemin);
        return true;
      },
    };
  }, []);

  // --- Position de lecture : retrouvée à la réouverture de la note ---
  useEffect(() => {
    const vue = internalRef.current;
    if (!vue || !filePath) return undefined;
    let dernier = null;
    let minuteur = null;
    const sauver = () => {
      const { scrollTop, scrollHeight, clientHeight } = vue;
      if (scrollHeight <= clientHeight) return;
      dernier = { ratio: scrollTop / (scrollHeight - clientHeight), line: ligneEnHaut(), timestamp: Date.now() };
      storage.set(`scroll-${filePath}`, dernier);
    };
    const surDefilement = () => { clearTimeout(minuteur); minuteur = setTimeout(sauver, 400); };
    vue.addEventListener('scroll', surDefilement, { passive: true });

    // Restaurer une fois l'éditeur dessiné.
    const restaurer = setTimeout(() => {
      const s = storage.get(`scroll-${filePath}`, null);
      if (!s) { vue.scrollTop = 0; return; }
      if (s.line && allerALigne(s.line, { signal: false, haut: true })) return;
      if (s.ratio != null) vue.scrollTop = s.ratio * (vue.scrollHeight - vue.clientHeight);
    }, 120);

    return () => {
      vue.removeEventListener('scroll', surDefilement);
      clearTimeout(minuteur);
      clearTimeout(restaurer);
      if (dernier) storage.set(`scroll-${filePath}`, dernier);
    };
  }, [filePath]);

  return (
    <div ref={internalRef} className="document-view document-view-edit">
      {saveError && <div className="doc-save-error" role="alert">{saveError}</div>}
      {enAttente > 0 && (
        <div className="doc-hors-ligne" role="status" data-testid="hors-ligne">
          {t(enAttente === 1 ? 'offline.one' : 'offline.other', { n: enAttente })}
        </div>
      )}
      {liaisonRef.current && personnes.length > 0 && (
        <ul className="doc-presence" aria-label={`${personnes.length} here`}>
          {personnes.map((p) => (
            <li key={p.client} style={{ '--couleur': p.couleur }}>
              <button
                type="button"
                className={suivi === p.client ? 'suivi' : ''}
                aria-pressed={suivi === p.client}
                title={suivi === p.client ? `Following ${p.nom}` : `Follow ${p.nom}`}
                onClick={() => basculerSuivi(p.client)}
              >
                <span aria-hidden="true" />{suivi === p.client ? `Following ${p.nom}` : p.nom}
              </button>
            </li>
          ))}
        </ul>
      )}
      <Suspense fallback={null}>
        <MarkdownEditor
          key={liaisonRef.current ? `${filePath}#partage` : filePath}
          extensions={liaisonRef.current?.extensions || null}
          content={liaisonRef.current ? liaisonRef.current.texte : (valeur.chemin === filePath ? valeur.texte : content)}
          onChange={handleChange}
          options={options}
          principal
        />
      </Suspense>
    </div>
  );
});

export default DocumentView;
