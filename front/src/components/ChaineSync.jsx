import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  Cloud, ShieldCheck, ShieldAlert, Loader2, Eye, EyeOff, RefreshCw, QrCode, AlertTriangle,
  CheckCircle2, ScanLine, ChevronLeft, KeyRound, FolderOpen, Fingerprint, Printer, LogOut,
  Trash2, Link2, Pause, Play,
} from 'lucide-react'
import FullscreenOverlay from './FullscreenOverlay'
import Explication from './Explication'
import ChaineQR from './ChaineQR'
import KitSecours from './KitSecours'
import { t, getLocale } from '../services/i18n'
import { ID_CHAINE, ANNULE, estNatif, enregistrerDansGestionnaire, recupererDepuisGestionnaire } from '../services/credentials'
import { messageChaine as messageErreur } from '../utils/messagesErreur'
import './Panel.css'
import './ChaineSync.css'

// Écran Synchronisation : la chaîne est la seule identité (aucun compte).
// Sans chaîne : créer (12 mots, gestionnaire de mots de passe, kit de secours,
// petite vérification) ou rejoindre (code scanné ou 12 mots). Avec une chaîne :
// place utilisée, ajouter un appareil, nouvelle chaîne, tout effacer, quitter.
//
// `cloud` est window.electron.cloud sur ordinateur (le secret reste dans le
// processus principal), ou l'adaptateur web ci-dessous (clés non exportables
// dans le navigateur, qui ne peut donc plus montrer les 12 mots après la création).
// Les mots ne passent jamais par le presse-papiers.

const MASQUER_APRES_MS = 60_000
const NB_QUESTIONS = 3
// Navigateur : chaîne dont l'utilisateur a confirmé avoir gardé les 12 mots.
const CLE_SAUVEGARDE_WEB = 'lector-sync-saved'

function lireSauvegardeWeb() {
  try { return localStorage.getItem(CLE_SAUVEGARDE_WEB) } catch { return null }
}

function ecrireSauvegardeWeb(chainId) {
  try {
    if (chainId) localStorage.setItem(CLE_SAUVEGARDE_WEB, chainId)
    else localStorage.removeItem(CLE_SAUVEGARDE_WEB)
  } catch { /* stockage indisponible */ }
}

// Même forme que window.electron.cloud, pour le navigateur.
function adaptateurWeb() {
  const garde = async (fn) => {
    try {
      return await fn(await import('../services/chaineWeb'))
    } catch (err) {
      return { ok: false, code: err?.code || 'UNKNOWN', detail: err?.detail || null }
    }
  }
  return {
    status: () => garde(async (m) => ({ hasChain: await m.aUneChaine(), vaultPath: 'cloud://', sync: null })),
    chainState: () => garde(async (m) => {
      const r = await m.etatChaineWeb()
      return { ...r, saved: !!r.chainId && lireSauvegardeWeb() === r.chainId }
    }),
    chainCreate: () => garde((m) => m.creerWeb()),
    chainJoin: (saisie) => garde(async (m) => {
      const r = await m.rejoindreWeb(saisie)
      if (r.ok) ecrireSauvegardeWeb(r.chainId)
      return r
    }),
    chainSaved: () => garde(async (m) => {
      ecrireSauvegardeWeb((await m.clesWeb())?.id)
      return { ok: true }
    }),
    chainErase: () => garde(async (m) => {
      const r = await m.effacerToutWeb()
      if (r.ok) ecrireSauvegardeWeb(null)
      return r
    }),
    chainLeave: () => garde(async (m) => {
      ecrireSauvegardeWeb(null)
      return m.quitterWeb()
    }),
  }
}

/** Taille lisible dans la langue de l'interface (1 Mo = 1 048 576 octets). */
function formatOctets(n) {
  const unites = ['byte', 'kilobyte', 'megabyte', 'gigabyte']
  let v = Math.max(0, n || 0)
  let i = 0
  while (v >= 1024 && i < unites.length - 1) { v /= 1024; i++ }
  try {
    return new Intl.NumberFormat(getLocale(), { style: 'unit', unit: unites[i], unitDisplay: 'short', maximumFractionDigits: i ? 1 : 0 }).format(v)
  } catch {
    return String(Math.round(v))
  }
}

function fmtDate(iso) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleString() } catch { return iso }
}

const nombre = (x) => (Array.isArray(x) ? x.length : (x || 0))

/** Trois positions distinctes parmi les 12, dans l'ordre. */
function tirerQuestions() {
  const positions = [...Array(12).keys()]
  const tirage = new Uint32Array(positions.length)
  crypto.getRandomValues(tirage)
  for (let i = positions.length - 1; i > 0; i--) {
    const j = tirage[i] % (i + 1)
    ;[positions[i], positions[j]] = [positions[j], positions[i]]
  }
  return positions.slice(0, NB_QUESTIONS).sort((a, b) => a - b)
}

// Où en est-on, d'après l'état de cet appareil et la raison de l'ouverture.
function vueDepuis(e, raison) {
  if (e?.pending) return 'pending'
  if (e?.code === 'CHAIN_UNKNOWN' || (raison === 'CHAIN_UNKNOWN' && !e?.hasChain)) return 'unknown'
  // Accueil « J'utilise déjà Lector » : droit aux 12 mots, sans créer de chaîne.
  if (raison === 'JOIN' && !e?.hasChain) return 'join'
  return e?.hasChain ? 'etat' : 'offer'
}

function GrilleMots({ mots }) {
  return (
    <ol className="chaine-mots">
      {mots.map((m, i) => (
        <li key={i}><span className="chaine-mot-n">{i + 1}</span><span className="chaine-mot">{m}</span></li>
      ))}
    </ol>
  )
}

// Scanner : seulement si le navigateur a BarcodeDetector et une caméra.
const scannerDisponible = () =>
  typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia

function Scanner({ onLu, onErreur }) {
  const video = useRef(null)
  const rappels = useRef({ onLu, onErreur })
  rappels.current = { onLu, onErreur }

  useEffect(() => {
    let flux = null
    let minuterie = null
    let fini = false
    ;(async () => {
      try {
        flux = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        if (fini) return
        video.current.srcObject = flux
        await video.current.play()
        const detecteur = new window.BarcodeDetector({ formats: ['qr_code'] })
        minuterie = setInterval(async () => {
          try {
            const codes = await detecteur.detect(video.current)
            const lu = codes.find((c) => /^lector-chaine:/i.test(c.rawValue))
            if (lu) { clearInterval(minuterie); rappels.current.onLu(lu.rawValue) }
          } catch { /* image pas encore prête */ }
        }, 300)
      } catch {
        rappels.current.onErreur(t('sync.join.scanUnavailable'))
      }
    })()
    return () => {
      fini = true
      if (minuterie) clearInterval(minuterie)
      if (flux) flux.getTracks().forEach((p) => p.stop())
    }
  }, [])
  return <video ref={video} className="chaine-video" muted playsInline />
}

// Vrai formulaire pour les gestionnaires de mots de passe : ceux du navigateur
// passent par l'API Credential Management, les extensions par la soumission.
function FormulaireGestionnaire({ mots }) {
  const formulaire = useRef(null)
  const [fait, setFait] = useState(false)
  const enregistrer = async () => {
    // Android : le plugin natif ouvre la fenêtre du gestionnaire, la soumission
    // ferait une seconde proposition par le remplissage automatique.
    if (!estNatif()) formulaire.current?.requestSubmit()
    await enregistrerDansGestionnaire(mots)
    setFait(true)
  }
  return (
    <form ref={formulaire} className="chaine-gestionnaire" onSubmit={(e) => e.preventDefault()}>
      <label className="chaine-champ">
        <span>{t('sync.words.pmName')}</span>
        <input className="panel-input" name="username" id={ID_CHAINE} autoComplete="username" value={ID_CHAINE} readOnly />
      </label>
      <label className="chaine-champ">
        <span>{t('sync.words.pmSecret')}</span>
        <input className="panel-input" type="password" name="password" autoComplete="new-password" value={mots.join(' ')} readOnly />
      </label>
      <button type="button" className="panel-btn ghost" onClick={enregistrer}>
        <KeyRound size={14} /> {t('sync.words.pmSave')}
      </button>
      {fait && <p className="panel-note">{t('sync.words.pmHint', { name: ID_CHAINE })}</p>}
    </form>
  )
}

function Quota({ serveur }) {
  const { bytesUsed = 0, quotaBytes = 0, docCount = 0, maxDocs = 0 } = serveur
  const part = quotaBytes ? Math.min(1, bytesUsed / quotaBytes) : 0
  return (
    <div className="chaine-quota">
      <div className="chaine-quota-ligne">
        <span>{t('sync.state.quota', { used: formatOctets(bytesUsed), total: formatOctets(quotaBytes) })}</span>
        <span>{t('sync.state.docs', { n: docCount, max: maxDocs })}</span>
      </div>
      <div
        className={`chaine-barre${part >= 0.9 ? ' pleine' : ''}`}
        role="progressbar"
        aria-label={t('sync.state.quotaLabel')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(part * 100)}
      >
        <div style={{ width: `${part * 100}%` }} />
      </div>
    </div>
  )
}

// État de la synchro sur ordinateur (le navigateur lit et écrit directement le casier).
function EtatSynchro({ sync, maxDocBytes, busy, onBasculer }) {
  const actif = sync?.state === 'running' || sync?.state === 'starting'
  const bloque = sync?.state === 'chain-unknown' || sync?.state === 'chain-proof'
  const erreur = sync?.lastErrorCode && sync.lastErrorCode !== 'QUOTA_EXCEEDED' ? messageErreur({ code: sync.lastErrorCode }) : null
  return (
    <div className="chaine-synchro">
      <div className={`panel-feedback ${bloque ? 'error' : actif ? 'success' : 'idle'}`}>
        {bloque ? <ShieldAlert size={14} /> : actif ? <CheckCircle2 size={14} /> : <Pause size={14} />}
        <span>
          {bloque ? erreur || t('sync.sync.blocked')
            : actif ? (sync.lastSyncAt ? t('sync.sync.active', { date: fmtDate(sync.lastSyncAt) }) : t('sync.sync.starting'))
            : t('sync.sync.paused')}
        </span>
      </div>
      {!bloque && (
        <button className="panel-btn ghost" onClick={onBasculer} disabled={busy}>
          {actif ? <Pause size={14} /> : <Play size={14} />} {actif ? t('sync.sync.pause') : t('sync.sync.resume')}
        </button>
      )}
      {actif && erreur && <div className="panel-feedback error"><AlertTriangle size={14} /> {erreur}</div>}
      {sync?.quotaFull && <div className="panel-feedback warn"><AlertTriangle size={14} /> {t('sync.sync.quotaFull', { n: sync.quotaPending || 0 })}</div>}
      {sync?.tooLarge > 0 && <p className="panel-note">{t('sync.sync.tooLarge', { n: sync.tooLarge, max: formatOctets(maxDocBytes) })}</p>}
      {sync?.skipped > 0 && <p className="panel-note">{t('sync.sync.skipped', { n: sync.skipped })}</p>}
      {sync?.notMarkdown > 0 && <p className="panel-note">{t('sync.sync.notMarkdown', { n: sync.notMarkdown })}</p>}
      {sync?.undecryptable > 0 && <p className="panel-note">{t('sync.sync.undecryptable', { n: sync.undecryptable })}</p>}
      {sync?.notWritten > 0 && <div className="panel-feedback warn"><AlertTriangle size={14} /> {t('sync.sync.notWritten', { n: sync.notWritten })}</div>}
    </div>
  )
}

export default function ChaineSync({ onClose, onVaultActivated, onChainEnded, raison = null }) {
  const isWeb = !window.electron?.cloud
  const cloud = useMemo(() => window.electron?.cloud || adaptateurWeb(), [])
  // Le gestionnaire de mots de passe du navigateur n'existe pas dans Electron.
  const avecGestionnaire = !window.electron

  const [statut, setStatut] = useState(null) // cloud.status()
  const [etat, setEtat] = useState(null) // cloud.chainState()
  const [vue, setVue] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const [but, setBut] = useState(null) // 'create' | 'rotate' | 'verify' | 'add'
  const [mots, setMots] = useState(null)
  const [code, setCode] = useState(null)
  const [motsVisibles, setMotsVisibles] = useState(false)
  const [estimation, setEstimation] = useState(null)
  const [sauvegarde, setSauvegarde] = useState(false)
  const [quiz, setQuiz] = useState(null) // { positions, reponses }
  const [impression, setImpression] = useState(false)
  const [progres, setProgres] = useState(null)
  const [resultat, setResultat] = useState(null)
  const [verif, setVerif] = useState(null)
  const [touchId, setTouchId] = useState(false)
  const [onglet, setOnglet] = useState('mots')
  const [saisie, setSaisie] = useState('')
  const [saisieVisible, setSaisieVisible] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [dossierCorbeille, setDossierCorbeille] = useState(false) // ordinateur : dossier local à la corbeille après l'effacement
  const [bloquants, setBloquants] = useState(null) // documents qui empêchent de quitter l'ancienne chaîne
  const [cleVerrou, setCleVerrou] = useState('sync.ex.add') // explication de l'écran de déverrouillage
  const suiteVerrou = useRef(null) // action refusée verrou fermé, relancée une fois déverrouillé
  const masquage = useRef(null)
  const vueCourante = useRef(vue)
  vueCourante.current = vue
  // Navigateur : une chaîne vient d'être créée ici, fermer doit ouvrir ses documents.
  const creeIci = useRef(false)

  const charger = useCallback(async () => {
    const [s, e] = await Promise.all([cloud.status(), cloud.chainState()])
    setStatut(s)
    setEtat(e)
    return e
  }, [cloud])

  const rafraichir = useCallback(async () => {
    setVue(vueDepuis(await charger(), null))
  }, [charger])

  useEffect(() => {
    charger().then((e) => setVue(vueDepuis(e, raison)))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Événements du processus principal (ordinateur seulement).
  useEffect(() => {
    if (!cloud.onEvent) return
    return cloud.onEvent((evt) => {
      if (evt?.type === 'status') setStatut((s) => (s ? { ...s, sync: evt.status } : s))
      else if (evt?.type === 'chain-progress') setProgres(evt)
      else if (evt?.type === 'quota') charger()
      else if (evt?.type === 'chain-block' && vueCourante.current === 'etat') rafraichir()
    })
  }, [cloud, charger, rafraichir])

  const oublierSecrets = useCallback(() => {
    setMots(null); setCode(null); setMotsVisibles(false); setQuiz(null); setImpression(false)
    if (masquage.current) { clearTimeout(masquage.current); masquage.current = null }
  }, [])
  useEffect(() => () => { if (masquage.current) clearTimeout(masquage.current) }, [])

  const finImpression = useCallback(() => setImpression(false), [])

  const aller = (v) => { setErr(''); setVue(v) }

  const agir = async (fn, ...args) => {
    setBusy(true); setErr('')
    try { await fn(...args) } catch (e) { setErr(messageErreur(e)) } finally { setBusy(false) }
  }

  const retour = async () => {
    oublierSecrets(); setConfirmation(''); setResultat(null); setProgres(null); setVerif(null); setBloquants(null); setErr('')
    await rafraichir()
  }

  // --- Verrou (ordinateur) ---
  // Afficher les 12 mots, renouveler la chaîne et tout effacer exigent le verrou
  // ouvert (Touch ID, ou confirmation sans Touch ID). Une action refusée
  // (LOCKED) passe par l'écran de déverrouillage, puis repart.

  const demanderVerrou = async (cle, suite) => {
    const s = await cloud.authStatus()
    setTouchId(!!s?.canTouchId)
    suiteVerrou.current = suite
    setCleVerrou(cle)
    aller('unlock')
  }

  const deverrouiller = async () => {
    const r = touchId ? await cloud.authTouchId() : await cloud.authConfirm()
    if (!r?.ok) { setErr(messageErreur(r)); return }
    await suiteVerrou.current?.()
  }

  const fermer = () => {
    cloud.lock?.()
    if (creeIci.current) onVaultActivated?.('cloud://')
    else onClose()
  }

  const boutonRetour = (
    <button type="button" className="panel-link" onClick={() => agir(retour)} disabled={busy}>
      <ChevronLeft size={14} /> {t('sync.back')}
    </button>
  )

  // --- Dossier du vault (ordinateur) ---

  /** Chemin du vault, demandé s'il manque ; null si l'utilisateur renonce. */
  const assurerVault = async () => {
    if (isWeb) return 'cloud://'
    if (statut?.vaultPath) return statut.vaultPath
    const r = await cloud.selectVault()
    if (!r?.ok) { if (!r?.canceled) setErr(messageErreur(r)); return null }
    setStatut((s) => ({ ...s, vaultPath: r.vaultPath }))
    return r.vaultPath
  }

  const changerVault = async () => {
    const r = await cloud.selectVault()
    if (r?.ok) await charger()
    else if (!r?.canceled) setErr(messageErreur(r))
  }

  const basculerSynchro = async () => {
    const actif = statut?.sync?.state === 'running' || statut?.sync?.state === 'starting'
    const r = actif ? await cloud.stopSync() : await cloud.startSync()
    if (!r?.ok) setErr(messageErreur(r))
    setStatut(await cloud.status())
  }

  // --- Créer, renouveler : 12 mots, vérification, puis l'opération ---

  const afficherMots = (r, pourquoi) => {
    setMots(r.mots); setCode(r.code || null); setBut(pourquoi); setSauvegarde(false); setMotsVisibles(true)
    aller('words')
  }

  const creer = async () => {
    if (isWeb) {
      const r = await cloud.chainCreate()
      if (!r?.ok) { setErr(messageErreur(r)); return }
      creeIci.current = true
      afficherMots(r, 'create')
      return
    }
    if (!(await assurerVault())) return
    const r = await cloud.chainPrepare()
    if (r?.code === 'RESUME_REQUIRED') { await rafraichir(); return }
    if (!r?.ok) { setErr(messageErreur(r)); return }
    setEstimation(r.envoi || null)
    afficherMots(r, 'create')
  }

  const preparerRenouvellement = async () => {
    const r = await cloud.chainPrepare()
    if (r?.code === 'LOCKED') return demanderVerrou('sync.ex.rotate', preparerRenouvellement)
    if (r?.code === 'RESUME_REQUIRED') { await rafraichir(); return }
    if (!r?.ok) { setErr(messageErreur(r)); return }
    afficherMots(r, 'rotate')
  }

  const lancerQuiz = () => {
    setQuiz({ positions: tirerQuestions(), reponses: Array(NB_QUESTIONS).fill('') })
    aller('quiz')
  }

  // Création ou renouvellement sur ordinateur (aussi la reprise d'une opération coupée).
  const operer = async (quoi, sauve) => {
    oublierSecrets()
    setProgres(null); setResultat(null); setBloquants(null)
    aller('progress')
    const r = quoi === 'rotate' ? await cloud.chainRotate() : await cloud.chainCreate()
    if (r?.code === 'LOCKED') return demanderVerrou('sync.ex.rotate', () => operer(quoi, sauve))
    // Renouvellement gardé en attente : l'écran de reprise liste ce qui bloque.
    if (r?.code === 'ROTATION_INCOMPLETE') { setBloquants(r.detail || []); await rafraichir(); return }
    if (!r?.ok) { setErr(messageErreur(r)); await charger(); return }
    if (sauve) await cloud.chainSaved()
    setResultat({ ...r, rotation: quoi === 'rotate' })
    await charger()
  }

  const terminer = async (sauve) => {
    if (but === 'verify') {
      await cloud.chainSaved()
      oublierSecrets()
      await rafraichir()
      return
    }
    if (isWeb) {
      if (sauve) await cloud.chainSaved()
      oublierSecrets()
      setResultat({ web: true })
      aller('progress')
      return
    }
    await operer(but, sauve)
  }

  const verifierQuiz = async () => {
    const faux = quiz.positions.find((p, k) => quiz.reponses[k].trim().toLowerCase() !== mots[p])
    if (faux !== undefined) { setErr(t('sync.quiz.wrong', { n: faux + 1 })); return }
    await terminer(true)
  }

  // --- Rejoindre ---

  const rejoindre = async (texte) => {
    const dossier = await assurerVault()
    if (!dossier) return
    const r = await cloud.chainJoin(texte)
    if (!r?.ok) {
      // 404 : les mots sont valides mais aucune chaîne ne leur correspond. On ne propose jamais d'en créer une ici.
      setErr(r?.code === 'CHAIN_UNKNOWN' ? t('sync.join.noChain') : messageErreur(r))
      return
    }
    setSaisie('')
    await charger()
    onVaultActivated?.(dossier)
  }

  const depuisGestionnaire = async () => {
    const texte = await recupererDepuisGestionnaire()
    if (texte === ANNULE) return
    if (!texte) { setErr(t('sync.join.managerEmpty')); return }
    setSaisie(texte)
    await rejoindre(texte)
  }

  // --- Ajouter un appareil, vérifier ses mots plus tard (verrou) ---

  const exporter = async (pourquoi) => {
    const r = await cloud.chainExport()
    if (r?.code === 'LOCKED') return demanderVerrou(pourquoi === 'verify' ? 'sync.ex.check' : 'sync.ex.add', () => exporter(pourquoi))
    if (!r?.ok) { setErr(messageErreur(r)); return }
    if (pourquoi === 'verify') {
      // Les mots ne s'affichent pas : la vérification les demande, « Revoir les mots » les montre.
      setMots(r.mots); setCode(r.code); setBut('verify'); setSauvegarde(false); setMotsVisibles(true)
      lancerQuiz()
      return
    }
    setMots(r.mots); setCode(r.code); setMotsVisibles(false); setBut('add')
    aller('show')
    if (masquage.current) clearTimeout(masquage.current)
    masquage.current = setTimeout(() => { oublierSecrets(); setVue('etat') }, MASQUER_APRES_MS)
  }

  const marquerSauvegardee = async () => {
    await cloud.chainSaved()
    await charger()
  }

  // --- Vérifier, effacer, quitter, reprendre ---

  const verifierCasier = async () => {
    const r = await cloud.chainVerify()
    if (!r?.ok) { setErr(messageErreur(r)); return }
    setVerif(r.verification)
    aller('verify')
  }

  const motEffacer = t('sync.erase.word')

  const effacer = async () => {
    const r = await cloud.chainErase('DELETE', isWeb ? undefined : { localFolder: dossierCorbeille })
    if (r?.code === 'LOCKED') return demanderVerrou('sync.ex.erase', effacer)
    if (!r?.ok) { setErr(messageErreur(r)); return }
    setConfirmation('')
    // Navigateur et mobile : le stockage local vient d'être vidé (effacementLocal.js).
    // Ordinateur, dossier mis à la corbeille : on vide aussi le stockage de la page
    // (historique, favoris, réglages, session). Puis on repart d'une app neuve.
    if (isWeb || r.trashed) {
      if (!isWeb) {
        try { await (await import('../services/effacementLocal')).effacerDonneesLocales() } catch { /* rien à vider */ }
      }
      window.location.reload()
      return
    }
    creeIci.current = false
    await rafraichir()
    onChainEnded?.()
    if (r.trashError) setErr(t('sync.erase.trashFailed'))
  }

  const quitter = async () => {
    const r = await cloud.chainLeave()
    if (!r?.ok) { setErr(messageErreur(r)); return }
    creeIci.current = false
    await rafraichir()
    onChainEnded?.()
  }

  // Chaîne disparue du serveur : cet appareil l'oublie, puis en crée une avec ses documents.
  const recreer = async () => {
    const r = await cloud.chainLeave()
    if (!r?.ok) { setErr(messageErreur(r)); return }
    await charger()
    await creer()
  }

  const abandonner = async () => {
    const r = await cloud.chainAbandon()
    if (!r?.ok) { setErr(messageErreur(r)); return }
    setBloquants(null)
    await rafraichir()
  }

  const ouvrirDocuments = () => onVaultActivated?.(isWeb ? 'cloud://' : statut?.vaultPath)

  const serveur = etat?.serveur || null

  return (
    <FullscreenOverlay onClose={fermer} className="panel-overlay">
      <div className="panel chaine">
        <div className="panel-header">
          <Cloud size={24} />
          <h2>{t('sync.title')}</h2>
        </div>

        {!vue && <div className="chaine-chargement"><Loader2 className="spin" size={22} /></div>}

        {/* Aucune chaîne sur cet appareil */}
        {vue === 'offer' && (
          <div className="chaine-bloc">
            <Explication cle="sync.ex.offer" />
            {!isWeb && (
              <div className="chaine-dossier">
                <span className="chaine-dossier-label">{t('sync.folder.label')}</span>
                <span className="chaine-dossier-chemin">{statut?.vaultPath || t('sync.folder.none')}</span>
                <button className="panel-link" onClick={() => agir(changerVault)} disabled={busy}>
                  <FolderOpen size={13} /> {statut?.vaultPath ? t('sync.folder.change') : t('sync.folder.choose')}
                </button>
              </div>
            )}
            <div className="chaine-actions">
              <button className="panel-btn primary" onClick={() => agir(creer)} disabled={busy}>
                {busy ? <Loader2 className="spin" size={14} /> : <ShieldCheck size={14} />} {t('sync.offer.create')}
              </button>
              <button className="panel-btn ghost" onClick={() => aller('join')} disabled={busy}>
                <Link2 size={14} /> {t('sync.offer.join')}
              </button>
            </div>
            <p className="panel-note">{t('sync.offer.joinHint')}</p>
            <p className="panel-note">{t('sync.mdOnly')}</p>
          </div>
        )}

        {/* Les 12 mots : création, nouvelle chaîne, ou relecture avant la vérification */}
        {vue === 'words' && mots && (
          <div className="chaine-bloc">
            <Explication cle="sync.ex.words" />
            {but === 'create' && estimation && (
              <p className="panel-note">{t('sync.words.estimate', { n: estimation.fichiers, size: formatOctets(estimation.octets) })}</p>
            )}
            <p className="panel-intro">{t('sync.words.intro')}</p>
            <GrilleMots mots={mots} />
            {isWeb && but === 'create' && <p className="panel-note chaine-attention">{t('sync.words.onceWeb')}</p>}
            {avecGestionnaire && <FormulaireGestionnaire mots={mots} />}
            <button className="panel-btn ghost" onClick={() => setImpression(true)}>
              <Printer size={14} /> {t('sync.words.print')}
            </button>
            <label className="chaine-case">
              <input type="checkbox" checked={sauvegarde} onChange={(e) => setSauvegarde(e.target.checked)} />
              {t('sync.words.saved')}
            </label>
            <button className="panel-btn primary" disabled={!sauvegarde || busy} onClick={lancerQuiz}>
              {t('sync.words.continue')}
            </button>
            {/* Sur le web la chaîne existe déjà : pas de retour, les mots ne reviendront pas. */}
            {!(isWeb && but === 'create') && boutonRetour}
          </div>
        )}

        {/* Petite vérification : 3 mots au hasard */}
        {vue === 'quiz' && quiz && (
          <form className="chaine-bloc" onSubmit={(e) => { e.preventDefault(); agir(verifierQuiz) }}>
            <p className="panel-simple">{t('sync.quiz.title')}</p>
            <p className="panel-intro">{t('sync.quiz.intro')}</p>
            {quiz.positions.map((p, k) => (
              <label key={p} className="chaine-champ">
                <span>{t('sync.quiz.word', { n: p + 1 })}</span>
                <input
                  className="panel-input"
                  value={quiz.reponses[k]}
                  onChange={(e) => {
                    const v = e.target.value
                    setQuiz((q) => ({ ...q, reponses: q.reponses.map((r, i) => (i === k ? v : r)) }))
                  }}
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  autoFocus={k === 0}
                />
              </label>
            ))}
            <button type="submit" className="panel-btn primary" disabled={busy || quiz.reponses.some((r) => !r.trim())}>
              {busy ? <Loader2 className="spin" size={14} /> : <CheckCircle2 size={14} />} {t('sync.quiz.check')}
            </button>
            <button type="button" className="panel-link" onClick={() => aller('words')} disabled={busy}>
              <Eye size={13} /> {t('sync.quiz.backToWords')}
            </button>
            {but === 'verify'
              ? boutonRetour
              : <button type="button" className="panel-link" onClick={() => agir(terminer, false)} disabled={busy}>{t('sync.quiz.later')}</button>}
          </form>
        )}

        {/* Opération en cours, puis son résultat */}
        {vue === 'progress' && (
          <div className="chaine-bloc">
            {!resultat && !err && (
              <div className="panel-feedback idle">
                <Loader2 className="spin" size={14} />
                {progres?.phase === 'upload' && progres.total
                  ? t('sync.progress.upload', { done: progres.fait, total: progres.total })
                  : progres?.phase === 'estimate' ? t('sync.progress.estimate', { n: progres.fichiers ?? 0 })
                  : t('sync.progress.start')}
              </div>
            )}
            {resultat?.web && (
              <>
                <div className="panel-feedback success"><CheckCircle2 size={16} /> {t('sync.done.web')}</div>
                <button className="panel-btn primary" onClick={ouvrirDocuments}>{t('sync.done.open')}</button>
              </>
            )}
            {resultat && !resultat.web && (
              <>
                <div className="panel-feedback success">
                  <CheckCircle2 size={16} />
                  {resultat.rotation ? t('sync.done.rotate') : t('sync.done.create', { n: resultat.envoyes ?? 0 })}
                </div>
                {nombre(resultat.tropGros) > 0 && (
                  <p className="panel-note">{t('sync.done.tooLarge', { n: nombre(resultat.tropGros), max: formatOctets(serveur?.maxDocBytes) })}</p>
                )}
                {nombre(resultat.quota) > 0 && (
                  <div className="panel-feedback warn"><AlertTriangle size={14} /> {t('sync.done.quota', { n: nombre(resultat.quota) })}</div>
                )}
                {resultat.rotation && <p className="panel-note">{t('sync.rotate.backups')}</p>}
                {resultat.rotation
                  ? <button className="panel-btn primary" onClick={() => agir(retour)}>{t('sync.ok')}</button>
                  : <button className="panel-btn primary" onClick={ouvrirDocuments}>{t('sync.done.open')}</button>}
              </>
            )}
            {err && boutonRetour}
          </div>
        )}

        {/* Rejoindre : code scanné ou 12 mots. Jamais de création ici. */}
        {vue === 'join' && (
          <div className="chaine-bloc">
            <Explication cle="sync.ex.join" />
            <div className="chaine-onglets" role="tablist">
              {scannerDisponible() && (
                <button role="tab" aria-selected={onglet === 'scan'} className={onglet === 'scan' ? 'actif' : ''} onClick={() => { setErr(''); setOnglet('scan') }}>
                  <ScanLine size={13} /> {t('sync.join.tabScan')}
                </button>
              )}
              <button role="tab" aria-selected={onglet === 'mots'} className={onglet === 'mots' ? 'actif' : ''} onClick={() => { setErr(''); setOnglet('mots') }}>
                <KeyRound size={13} /> {t('sync.join.tabWords')}
              </button>
            </div>
            {onglet === 'scan' && <Scanner onLu={(texte) => agir(rejoindre, texte)} onErreur={setErr} />}
            {onglet !== 'scan' && (
              <form className="chaine-saisie" onSubmit={(e) => { e.preventDefault(); if (saisie.trim()) agir(rejoindre, saisie) }}>
                <input className="chaine-cache" name="username" id={ID_CHAINE} autoComplete="username" value={ID_CHAINE} readOnly tabIndex={-1} aria-hidden="true" />
                <div className="chaine-champ-mots">
                  <input
                    className="panel-input"
                    type={saisieVisible ? 'text' : 'password'}
                    name="password"
                    autoComplete="current-password"
                    placeholder={t('sync.join.placeholder')}
                    aria-label={t('sync.join.placeholder')}
                    value={saisie}
                    onChange={(e) => setSaisie(e.target.value)}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className="chaine-oeil"
                    onClick={() => setSaisieVisible((v) => !v)}
                    title={saisieVisible ? t('sync.join.hide') : t('sync.join.show')}
                    aria-label={saisieVisible ? t('sync.join.hide') : t('sync.join.show')}
                  >
                    {saisieVisible ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                {avecGestionnaire && (
                  <button type="button" className="panel-btn ghost" onClick={() => agir(depuisGestionnaire)} disabled={busy}>
                    <KeyRound size={14} /> {t('sync.join.fromManager')}
                  </button>
                )}
                <button type="submit" className="panel-btn primary" disabled={busy || !saisie.trim()}>
                  {busy ? <Loader2 className="spin" size={14} /> : <Link2 size={14} />} {t('sync.join.submit')}
                </button>
              </form>
            )}
            <p className="panel-note">{t('sync.join.where')}</p>
            {boutonRetour}
          </div>
        )}

        {/* Avec une chaîne */}
        {vue === 'etat' && (
          <div className="chaine-bloc">
            <Explication cle="sync.ex.state" />
            {etat?.ok === false && <div className="panel-feedback error"><AlertTriangle size={14} /> {messageErreur(etat)}</div>}
            {serveur && <Quota serveur={serveur} />}
            {etat?.saved === false && (
              <div className="panel-feedback warn chaine-rappel">
                <AlertTriangle size={14} />
                <div>
                  <p>{isWeb ? t('sync.reminder.web') : t('sync.reminder.text')}</p>
                  {isWeb
                    ? <button className="panel-link" onClick={() => agir(marquerSauvegardee)} disabled={busy}>{t('sync.reminder.haveThem')}</button>
                    : <button className="panel-link" onClick={() => agir(exporter, 'verify')} disabled={busy}>{t('sync.reminder.check')}</button>}
                </div>
              </div>
            )}
            {!isWeb && (
              <>
                <div className="chaine-dossier">
                  <span className="chaine-dossier-label">{t('sync.folder.label')}</span>
                  <span className="chaine-dossier-chemin">{statut?.vaultPath || t('sync.folder.none')}</span>
                  <button className="panel-link" onClick={() => agir(changerVault)} disabled={busy}>
                    <FolderOpen size={13} /> {statut?.vaultPath ? t('sync.folder.change') : t('sync.folder.choose')}
                  </button>
                </div>
                <EtatSynchro sync={statut?.sync} maxDocBytes={serveur?.maxDocBytes} busy={busy} onBasculer={() => agir(basculerSynchro)} />
                {etat?.stockageSur === false && <div className="panel-feedback warn"><ShieldAlert size={14} /> {t('sync.insecureStorage')}</div>}
                <div className="chaine-actions">
                  <button className="panel-btn ghost" onClick={() => agir(exporter, 'add')} disabled={busy}><QrCode size={14} /> {t('sync.actions.add')}</button>
                  <button className="panel-btn ghost" onClick={() => aller('rotate')} disabled={busy}><RefreshCw size={14} /> {t('sync.actions.rotate')}</button>
                  <button className="panel-btn ghost" onClick={() => agir(verifierCasier)} disabled={busy}><ShieldCheck size={14} /> {t('sync.actions.verify')}</button>
                </div>
              </>
            )}
            {isWeb && <p className="panel-note">{t('sync.addWeb')}</p>}
            <p className="panel-note">{t('sync.mdOnly')}</p>
            <div className="chaine-sortie">
              <button className="panel-link" onClick={() => aller('leave')} disabled={busy}><LogOut size={13} /> {t('sync.actions.leave')}</button>
              <button className="panel-link danger" onClick={() => { setDossierCorbeille(false); aller('erase') }} disabled={busy}><Trash2 size={13} /> {t('sync.actions.erase')}</button>
            </div>
          </div>
        )}

        {/* Verrou avant d'afficher les mots, de renouveler ou de tout effacer (ordinateur) */}
        {vue === 'unlock' && (
          <div className="chaine-bloc">
            <Explication cle={cleVerrou} />
            <p className="panel-note">{t('sync.unlock.hint')}</p>
            <button className="panel-btn primary" onClick={() => agir(deverrouiller)} disabled={busy}>
              {busy ? <Loader2 className="spin" size={14} /> : touchId ? <Fingerprint size={14} /> : <Eye size={14} />}
              {' '}{touchId ? t('sync.unlock.touchId') : t('sync.unlock.confirm')}
            </button>
            {boutonRetour}
          </div>
        )}

        {/* Ajouter un appareil : code et 12 mots, masqués après 60 s */}
        {vue === 'show' && code && (
          <div className="chaine-bloc">
            <Explication cle="sync.ex.add" />
            <p className="panel-intro">{t('sync.show.intro')}</p>
            <ChaineQR texte={code} />
            <p className="panel-note chaine-attention">{t('sync.show.qrWarning')}</p>
            {motsVisibles && <GrilleMots mots={mots} />}
            <button className="panel-btn ghost" onClick={() => setMotsVisibles((v) => !v)}>
              {motsVisibles ? <EyeOff size={14} /> : <Eye size={14} />} {motsVisibles ? t('sync.show.hideWords') : t('sync.show.showWords')}
            </button>
            <button className="panel-btn ghost" onClick={() => setImpression(true)}>
              <Printer size={14} /> {t('sync.words.print')}
            </button>
            <p className="panel-note">{t('sync.show.autoHide')}</p>
            {boutonRetour}
          </div>
        )}

        {/* Nouvelle chaîne */}
        {vue === 'rotate' && (
          <div className="chaine-bloc">
            <Explication cle="sync.ex.rotate" />
            <div className="chaine-garanties">
              <div>
                <strong>{t('sync.rotate.guarantees')}</strong>
                <ul className="chaine-liste">
                  <li>{t('sync.rotate.g1')}</li>
                  <li>{t('sync.rotate.g2')}</li>
                </ul>
              </div>
              <div>
                <strong>{t('sync.rotate.notGuaranteed')}</strong>
                <ul className="chaine-liste">
                  <li>{t('sync.rotate.ng1')}</li>
                  <li>{t('sync.rotate.ng2')}</li>
                  <li>{t('sync.rotate.ng3')}</li>
                </ul>
              </div>
            </div>
            <button className="panel-btn primary" onClick={() => agir(preparerRenouvellement)} disabled={busy}>
              {busy ? <Loader2 className="spin" size={14} /> : <RefreshCw size={14} />} {t('sync.rotate.continue')}
            </button>
            {boutonRetour}
          </div>
        )}

        {/* Vérification du casier */}
        {vue === 'verify' && verif && (
          <div className="chaine-bloc">
            <div className={`panel-feedback ${verif.ok ? 'success' : 'error'}`}>
              {verif.ok ? <ShieldCheck size={16} /> : <ShieldAlert size={16} />}
              {verif.ok ? t('sync.verify.ok') : t('sync.verify.ko')}
            </div>
            <ul className="chaine-liste">
              <li>{t('sync.verify.blocks', { n: verif.blocs ?? 0, size: formatOctets(verif.octets) })}</li>
              {verif.illisibles > 0 && <li>{t('sync.verify.unreadable', { n: verif.illisibles })}</li>}
              {verif.horsFormat > 0 && <li>{t('sync.verify.notMarkdown', { n: verif.horsFormat })}</li>}
            </ul>
            {boutonRetour}
          </div>
        )}

        {/* Opération coupée (ordinateur) */}
        {vue === 'pending' && (
          <div className="chaine-bloc">
            <div className="panel-feedback warn">
              <AlertTriangle size={14} /> {etat?.pending === 'rotate' ? t('sync.pending.rotate') : t('sync.pending.create')}
            </div>
            {bloquants && (
              <div className="panel-feedback error">
                <AlertTriangle size={14} />
                <div>
                  <p>{messageErreur({ code: 'ROTATION_INCOMPLETE' })}</p>
                  {bloquants.length > 0 && (
                    <ul className="chaine-liste chaine-chemins">{bloquants.map((c) => <li key={c}>{c}</li>)}</ul>
                  )}
                </div>
              </div>
            )}
            <p className="panel-note">{t('sync.pending.hint')}</p>
            <div className="chaine-actions">
              <button className="panel-btn primary" onClick={() => agir(operer, etat?.pending, false)} disabled={busy}>{t('sync.pending.resume')}</button>
              <button className="panel-btn ghost" onClick={() => agir(abandonner)} disabled={busy}>{t('sync.pending.abandon')}</button>
            </div>
          </div>
        )}

        {/* La chaîne n'existe plus sur le serveur */}
        {vue === 'unknown' && (
          <div className="chaine-bloc">
            <Explication cle="sync.ex.unknown" />
            <button className="panel-btn primary" onClick={() => { setOnglet('mots'); aller('join') }} disabled={busy}>
              <Link2 size={14} /> {t('sync.unknown.join')}
            </button>
            {!isWeb && (
              <button className="panel-btn ghost" onClick={() => agir(recreer)} disabled={busy}>
                <ShieldCheck size={14} /> {t('sync.unknown.create')}
              </button>
            )}
            {!isWeb && etat?.hasChain && (
              <button className="panel-link" onClick={() => aller('leave')} disabled={busy}><LogOut size={13} /> {t('sync.actions.leave')}</button>
            )}
          </div>
        )}

        {/* Tout effacer : confirmation forte */}
        {vue === 'erase' && (
          <form className="chaine-bloc" onSubmit={(e) => { e.preventDefault(); if (confirmation.trim() === motEffacer) agir(effacer) }}>
            <Explication cle={isWeb ? 'sync.ex.eraseWeb' : 'sync.ex.erase'} />
            {!isWeb && statut?.vaultPath && (
              <label className="chaine-case">
                <input type="checkbox" checked={dossierCorbeille} onChange={(e) => setDossierCorbeille(e.target.checked)} />
                <span>{t('sync.erase.alsoFolder')} <span className="chaine-dossier-chemin">{statut.vaultPath}</span></span>
              </label>
            )}
            <label className="chaine-champ">
              <span>{t('sync.erase.prompt', { word: motEffacer })}</span>
              <input
                className="panel-input"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                placeholder={motEffacer}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
              />
            </label>
            <button type="submit" className="panel-btn danger" disabled={busy || confirmation.trim() !== motEffacer}>
              {busy ? <Loader2 className="spin" size={14} /> : <Trash2 size={14} />} {t('sync.erase.submit')}
            </button>
            {boutonRetour}
          </form>
        )}

        {/* Quitter la chaîne sur cet appareil */}
        {vue === 'leave' && (
          <div className="chaine-bloc">
            <Explication cle="sync.ex.leave" />
            <button className="panel-btn danger" onClick={() => agir(quitter)} disabled={busy}>
              {busy ? <Loader2 className="spin" size={14} /> : <LogOut size={14} />} {t('sync.leave.submit')}
            </button>
            {boutonRetour}
          </div>
        )}

        {err && <div className="panel-feedback error" role="alert"><AlertTriangle size={14} /> {err}</div>}
      </div>
      {impression && mots && <KitSecours mots={mots} code={code} onFini={finImpression} />}
    </FullscreenOverlay>
  )
}
