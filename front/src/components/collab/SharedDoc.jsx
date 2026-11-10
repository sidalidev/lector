// Page d'un document partagé : /d/<idSalon>#<clé> (docs/collab-design.md § 8).
//
// Chargée seule par main.jsx (import dynamique) : ni l'application complète ni
// le vault. La personne invitée n'a besoin que d'un navigateur. Sa copie vit
// dans ce navigateur (IndexedDB) et se télécharge en .md.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { keymap, EditorView } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import * as Y from 'yjs'
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next'
import { Download, History, Lock, Share2, X } from 'lucide-react'
import MarkdownEditor from '../MarkdownEditor'
import LienPartage from './LienPartage'
import Historique from '../Historique'
import { noter } from '../../services/historique.js'
import { suivre, suivreAuteurs } from '../../services/collab/suivi.js'
import { appliquerTexte } from '../../services/collab/salon.js'
import { t } from '../../services/i18n'
import { cleDuFragment, deriverIdSalon, idSalonDuChemin, cleVersTexte } from '../../services/collab/crypto.js'
import {
  STATUTS, arreterPartage, lienDu, ouvrirSession, reessayerArrets, stockage, telechargerMarkdown, titreDu,
} from '../../services/collab/partage.js'
import './collab.css'

/**
 * Lit la clé du fragment, la range avec le document et retire le fragment de
 * la barre d'adresse. Renvoie l'enregistrement, ou null si le lien est abîmé.
 */
async function chargerEnregistrement(id) {
  const fragment = location.hash
  if (fragment.length > 1) {
    history.replaceState(history.state, '', location.pathname + location.search)
    let K
    try {
      K = cleDuFragment(fragment)
    } catch {
      return null
    }
    if ((await deriverIdSalon(K)) !== id) return null
    const existant = await stockage.lireSalon(id)
    if (existant?.cle) return existant
    const enregistrement = existant
      ? { ...existant, cle: cleVersTexte(K), arrete: false }
      : { id, cle: cleVersTexte(K), role: 'invite', titre: '', etat: {}, arrete: false, creeLe: Date.now() }
    await stockage.ecrireSalon(enregistrement)
    return enregistrement
  }
  const existant = await stockage.lireSalon(id)
  return existant && (existant.cle || existant.arrete) ? existant : null
}

// Une seule lecture du lien par chargement de page : le fragment est retiré dès
// la première (React StrictMode lance les effets deux fois en développement).
let chargement = null
const chargerUneFois = (id) => (chargement ??= chargerEnregistrement(id))

function personnesDe(presence, moi) {
  const liste = []
  for (const [client, etat] of presence.getStates()) {
    if (!etat?.user?.name) continue
    liste.push({ client, nom: etat.user.name, couleur: etat.user.color, moi: client === moi })
  }
  return liste.sort((a, b) => (a.moi === b.moi ? a.nom.localeCompare(b.nom) : a.moi ? -1 : 1))
}

function DemandeNom({ onValider }) {
  const [nom, setNom] = useState('')
  return (
    <div className="collab-centre">
      <form className="collab-carte" onSubmit={(e) => { e.preventDefault(); if (nom.trim()) onValider(nom) }}>
        <h1>{t('collab.name.title')}</h1>
        <p className="collab-note">{t('collab.name.hint')}</p>
        <input
          className="collab-champ"
          autoFocus
          maxLength={40}
          value={nom}
          placeholder={t('collab.name.placeholder')}
          onChange={(e) => setNom(e.target.value)}
          data-testid="collab-nom"
        />
        <button type="submit" className="collab-btn collab-btn-plein" disabled={!nom.trim()}>{t('collab.name.continue')}</button>
      </form>
    </div>
  )
}

function Confidentialite({ onFermer }) {
  return (
    <div className="collab-popover" role="dialog" aria-label={t('collab.privacy.title')}>
      <button type="button" className="collab-icone collab-fermer" onClick={onFermer} aria-label="Close"><X size={16} /></button>
      <h2>{t('collab.privacy.title')}</h2>
      <p>{t('collab.privacy.body')}</p>
      <p className="collab-note">{t('collab.privacy.more')}</p>
    </div>
  )
}

const LIBELLES = {
  [STATUTS.CONNEXION]: 'collab.status.connecting',
  [STATUTS.EN_LIGNE]: 'collab.status.online',
  [STATUTS.HORS_LIGNE]: 'collab.status.offline',
  [STATUTS.ARRETE]: 'collab.status.stopped',
  [STATUTS.REFUSE]: 'collab.status.refused',
  [STATUTS.PLEIN]: 'collab.status.full',
}

function Editeur({ session, lectureSeule, onView }) {
  // Calculées une fois par session : MarkdownEditor ne lit ses extensions qu'au montage.
  const extensions = useMemo(() => {
    const annuler = new Y.UndoManager(session.texte)
    return [
      keymap.of(yUndoManagerKeymap),
      yCollab(session.texte, session.presence, { undoManager: annuler }),
      ...(lectureSeule ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []),
    ]
  }, [session, lectureSeule])
  return (
    <MarkdownEditor
      key={lectureSeule ? 'lecture' : 'ecriture'}
      content={() => session.texte.toString()}
      extensions={extensions}
      autoFocus={!lectureSeule}
      onView={onView}
    />
  )
}

export default function SharedDoc() {
  const id = useMemo(() => idSalonDuChemin(location.pathname), [])
  const [phase, setPhase] = useState('chargement') // chargement | abime | nom | pret | arrete-local
  const [enregistrement, setEnregistrement] = useState(null)
  const [profil, setProfil] = useState(() => stockage.profil())
  const [session, setSession] = useState(null)
  const [statut, setStatut] = useState(STATUTS.CONNEXION)
  const [personnes, setPersonnes] = useState([])
  const [titre, setTitre] = useState('')
  const [lien, setLien] = useState(null)
  const [panneau, setPanneau] = useState(null) // null | 'partage' | 'vie-privee'
  const [message, setMessage] = useState(null)
  const [arreteParMoi, setArreteParMoi] = useState(false)
  const texteLocalRef = useRef('')
  const vueRef = useRef(null)
  const [suivi, setSuivi] = useState(null)
  const arretSuiviRef = useRef(null)
  const [historique, setHistorique] = useState(false)

  // 1. Lien → enregistrement local
  useEffect(() => {
    let annule = false
    reessayerArrets().catch(() => {})
    ;(async () => {
      const e = id ? await chargerUneFois(id) : null
      if (annule) return
      if (!e) return setPhase('abime')
      setEnregistrement(e)
      if (!e.cle) {
        // Partage arrêté par ce navigateur (propriétaire) : la copie seule, en lecture.
        const doc = new Y.Doc()
        if (e.etat?.local?.length) Y.applyUpdate(doc, e.etat.local)
        texteLocalRef.current = doc.getText('md').toString()
        setTitre(e.titre || titreDu(texteLocalRef.current))
        return setPhase('arrete-local')
      }
      setPhase('pret')
    })()
    return () => { annule = true }
  }, [id])

  // 2. Session : connexion, présence, titre
  useEffect(() => {
    if (phase !== 'pret' || !enregistrement) return
    // Le profil du moment ; un renommage passe par la présence, sans reconnecter.
    const profil = stockage.profil()
    let s = null
    let annule = false
    ;(async () => {
      s = await ouvrirSession(enregistrement, { profil, onStatut: (st) => setStatut(st) })
      if (annule) return s.fermer()
      const majPersonnes = () => setPersonnes(personnesDe(s.presence, s.doc.clientID))
      s.presence.on('change', majPersonnes)
      majPersonnes()
      // Historique des versions, sur cet appareil : une version toutes les 5 minutes d'écriture.
      const auteurs = suivreAuteurs(s.doc, s.presence, profil.nom)
      const avant = s.texte.toString()
      let minuteurVersion = null
      const majTexte = () => {
        texteLocalRef.current = s.texte.toString()
        setTitre(titreDu(texteLocalRef.current, enregistrement.titre || t('collab.loading')))
        clearTimeout(minuteurVersion)
        minuteurVersion = setTimeout(() => noter(enregistrement.id, s.texte.toString(), { auteurs: auteurs.prendre(), avant }), 1500)
      }
      s.texte.observe(majTexte)
      majTexte()
      const fermer = s.fermer
      s.fermer = () => { clearTimeout(minuteurVersion); auteurs.arreter(); return fermer() }
      setSession(s)
    })()
    const auRevoir = () => s?.client.sauverMaintenant()
    window.addEventListener('pagehide', auRevoir)
    return () => {
      annule = true
      window.removeEventListener('pagehide', auRevoir)
      s?.fermer()
    }
  }, [phase, enregistrement])

  useEffect(() => {
    document.title = titre ? `${titre} · Lector` : 'Lector'
  }, [titre])

  useEffect(() => {
    if (enregistrement?.role === 'proprietaire' && enregistrement.cle) lienDu(enregistrement).then(setLien)
  }, [enregistrement])

  // Suivre quelqu'un : son curseur reste à l'écran jusqu'à ce que je fasse défiler ou tape.
  const basculerSuivi = (client) => {
    arretSuiviRef.current?.()
    arretSuiviRef.current = null
    if (suivi === client || !session) { setSuivi(null); return }
    setSuivi(client)
    arretSuiviRef.current = suivre({
      presence: session.presence,
      doc: session.doc,
      client,
      aller: (p) => {
        const v = vueRef.current
        if (v) v.dispatch({ effects: EditorView.scrollIntoView(Math.min(p, v.state.doc.length), { y: 'center' }) })
      },
      surFin: () => setSuivi(null),
    })
  }
  useEffect(() => () => arretSuiviRef.current?.(), [session])

  const telecharger = useCallback(() => telechargerMarkdown(texteLocalRef.current, titre), [titre])

  const arreter = useCallback(async () => {
    if (!enregistrement || !window.confirm(t('collab.stop.confirm'))) return
    const ok = await arreterPartage(enregistrement)
    setMessage(t(ok ? 'collab.stop.done' : 'collab.stop.pending'))
    setPanneau(null)
    setLien(null)
    // Hors ligne, le relais ne nous coupera pas : on se coupe nous-mêmes.
    if (!ok) await session?.fermer()
    setArreteParMoi(true)
  }, [enregistrement, session])

  if (phase === 'chargement') return <div className="collab-centre collab-note">{t('collab.loading')}</div>
  if (phase === 'abime') {
    return (
      <div className="collab-centre">
        <div className="collab-carte"><p>{t('collab.brokenLink')}</p></div>
      </div>
    )
  }
  if (phase === 'nom') {
    return <DemandeNom onValider={(nom) => { setProfil(stockage.ecrireProfil(nom)); setPhase('pret') }} />
  }

  const proprietaire = enregistrement?.role === 'proprietaire'
  const arrete = arreteParMoi || phase === 'arrete-local' || statut === STATUTS.ARRETE || statut === STATUTS.REFUSE
  const bandeau = message || (statut !== STATUTS.EN_LIGNE && statut !== STATUTS.CONNEXION ? t(LIBELLES[statut]) : null)
    || (phase === 'arrete-local' ? t('collab.stop.done') : null)

  return (
    <div className="collab-page">
      <header className="collab-entete">
        <div className="collab-titre">
          <h1 title={titre}>{titre}</h1>
          {proprietaire && !arrete && <span className="collab-badge">{t('collab.owner')}</span>}
        </div>
        <div className="collab-outils">
          {!arrete && phase === 'pret' && (
            <span className={`collab-statut collab-statut-${statut}`} data-testid="collab-statut" data-statut={statut}>
              <span className="collab-point" aria-hidden="true" />
              {statut === STATUTS.EN_LIGNE ? t('collab.status.online') : statut === STATUTS.CONNEXION ? t('collab.status.connecting') : null}
            </span>
          )}
          {!arrete && (
            <ul className="collab-personnes" aria-label={t('collab.people', { n: personnes.length })} data-testid="collab-personnes">
              {personnes.map((p) => (
                <li key={p.client} title={p.moi ? `${p.nom} (${t('collab.you')})` : t(suivi === p.client ? 'collab.following' : 'collab.follow', { name: p.nom })} style={{ '--couleur': p.couleur }}>
                  <button
                    type="button"
                    className={`collab-personne ${suivi === p.client ? 'suivi' : ''}`}
                    aria-pressed={p.moi ? undefined : suivi === p.client}
                    onClick={() => (p.moi ? setPanneau(panneau === 'nom' ? null : 'nom') : basculerSuivi(p.client))}
                    data-testid={p.moi ? 'collab-moi' : undefined}
                  >
                    <span className="collab-avatar" aria-hidden="true">{p.nom.slice(0, 1).toUpperCase()}</span>
                    <span className="collab-nom">{suivi === p.client ? t('collab.following', { name: p.nom }) : p.nom}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {session && (
            <button type="button" className="collab-icone" onClick={() => setHistorique(true)} aria-label={t('history.title')} title={t('history.title')} data-testid="historique-ouvrir">
              <History size={16} />
            </button>
          )}
          <button type="button" className="collab-icone" onClick={() => setPanneau(panneau === 'vie-privee' ? null : 'vie-privee')} aria-label={t('collab.privacy.title')} title={t('collab.privacy.title')}>
            <Lock size={16} />
          </button>
          <button type="button" className="collab-btn" onClick={telecharger} data-testid="collab-telecharger">
            <Download size={16} />
            {t('collab.download')}
          </button>
          {proprietaire && lien && !arrete && (
            <button type="button" className="collab-btn collab-btn-plein" onClick={() => setPanneau(panneau === 'partage' ? null : 'partage')}>
              <Share2 size={16} />
              {t('collab.share')}
            </button>
          )}
        </div>
        {panneau === 'vie-privee' && <Confidentialite onFermer={() => setPanneau(null)} />}
        {panneau === 'nom' && (
          <form
            className="collab-popover"
            aria-label={t('collab.name.title')}
            onSubmit={(e) => {
              e.preventDefault()
              const nom = new FormData(e.currentTarget).get('nom')?.toString().trim()
              if (nom) {
                const p = stockage.ecrireProfil(nom)
                setProfil(p)
                session?.presence.setLocalStateField('user', { name: p.nom, color: p.couleur, colorLight: `${p.couleur}33` })
                // Le curseur se redessine avec le nouveau nom chez les autres (il revient à la prochaine frappe).
                session?.presence.setLocalStateField('cursor', null)
              }
              setPanneau(null)
            }}
          >
            <h2>{t('collab.name.title')}</h2>
            <input className="collab-champ" name="nom" autoFocus maxLength={40} defaultValue={profil?.nom || ''} data-testid="collab-nom" />
            <button type="submit" className="collab-btn collab-btn-plein">{t('collab.name.save')}</button>
          </form>
        )}
        {panneau === 'partage' && lien && (
          <div className="collab-popover" role="dialog" aria-label={t('collab.share.title')}>
            <button type="button" className="collab-icone collab-fermer" onClick={() => setPanneau(null)} aria-label="Close"><X size={16} /></button>
            <h2>{t('collab.share.title')}</h2>
            <p className="collab-note">{t('collab.share.intro')}</p>
            <LienPartage lien={lien} ouvrir={false} />
            <button type="button" className="collab-btn collab-btn-danger" onClick={arreter}>{t('collab.stop')}</button>
          </div>
        )}
      </header>
      {bandeau && <div className={`collab-bandeau ${arrete ? 'collab-bandeau-fin' : ''}`} role="status" data-testid="collab-bandeau">{bandeau}</div>}
      <main className="collab-editeur" data-testid="collab-editeur">
        {session ? (
          <Editeur session={session} lectureSeule={arrete} onView={(v) => { vueRef.current = v }} />
        ) : phase === 'arrete-local' ? (
          <pre className="collab-copie">{texteLocalRef.current}</pre>
        ) : (
          <div className="collab-centre collab-note">{t('collab.loading')}</div>
        )}
      </main>
      {historique && session && (
        <Historique
          doc={enregistrement.id}
          texteActuel={texteLocalRef.current}
          onRestaurer={(texte) => appliquerTexte(session.texte, texte, null)}
          onFermer={() => setHistorique(false)}
        />
      )}
    </div>
  )
}
