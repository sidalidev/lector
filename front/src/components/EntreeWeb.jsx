// Entrée de l'app web : la clé de 12 mots tient lieu de compte.
// - Déjà connecté sur ce navigateur : cet écran ne s'affiche pas (App.jsx).
// - Sinon : « Create my key » (12 mots, enregistrés dans le gestionnaire de
//   mots de passe ou copiés) ou « Sign in » (le gestionnaire remplit le champ).
// Pas de prénom, pas d'email, pas de mot de passe à inventer.
// - App Mac (window.lectorDesktop, front/desktop/preload.js) : si le Mac a déjà
//   une chaîne, l'interface s'y connecte toute seule ; sinon, la clé créée ou
//   saisie ici est transmise au Mac, qui synchronise son dossier avec elle.

import { useEffect, useRef, useState } from 'react'
import { KeyRound, Copy, Check, Eye, EyeOff, Loader2, ChevronLeft } from 'lucide-react'
import AppMark from './AppMark'
import { t } from '../services/i18n'
import { ID_CHAINE, estDisponible, enregistrerDansGestionnaire, recupererDepuisGestionnaire } from '../services/credentials'
import { messageChaine } from '../utils/messagesErreur'
import { prechargerEditeur } from '../services/prechargement'
import './Panel.css'
import './Onboarding.css'
import './ChaineSync.css'
import './EntreeWeb.css'

// Même clé que l'écran Synchronisation : la chaîne dont les 12 mots sont gardés.
const CLE_SAUVEGARDE_WEB = 'lector-sync-saved'
const noterSauvegarde = (id) => { try { localStorage.setItem(CLE_SAUVEGARDE_WEB, id) } catch { /* stockage indisponible */ } }

// Pont avec l'app Mac, absent dans un navigateur.
const bureau = typeof window !== 'undefined' ? window.lectorDesktop : null

/** Le Mac garde la même chaîne que l'interface (sans attendre sa réponse). */
const transmettreAuMac = (mots) => { bureau?.garderChaine(mots).catch(() => {}) }

export default function EntreeWeb({ onPret }) {
  const [vue, setVue] = useState(bureau ? 'mac' : 'choix') // mac | choix | cle | connexion
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [cle, setCle] = useState(null) // { mots, chainId }
  const [garde, setGarde] = useState(null) // 'gestionnaire' | 'copie' | 'ecrit'
  const [saisie, setSaisie] = useState('')
  const [visible, setVisible] = useState(false)
  const formCle = useRef(null)
  const effacerCopie = useRef(null)

  useEffect(() => () => clearTimeout(effacerCopie.current), [])

  // App Mac déjà reliée à une chaîne : connexion avec ses mots, sans rien taper.
  useEffect(() => {
    if (!bureau) return undefined
    let vivant = true
    ;(async () => {
      try {
        const r = await bureau.motsDeLaChaine()
        if (r?.ok && r.mots) {
          const m = await import('../services/chaineWeb')
          const c = await m.rejoindreWeb(r.mots)
          if (c?.ok) {
            noterSauvegarde(c.chainId)
            await bureau.chaineConnectee(c.chainId)
            await onPret({ nouvelle: false })
            return
          }
        }
      } catch { /* l'écran habituel prend le relais */ }
      if (vivant) setVue('choix')
    })()
    return () => { vivant = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const agir = async (fn) => {
    setBusy(true); setErr('')
    try { await fn() } catch (e) { setErr(messageChaine(e)) } finally { setBusy(false) }
  }

  const creer = () => agir(async () => {
    // La note s'ouvrira bientôt : l'éditeur se télécharge pendant que l'utilisateur garde ses mots.
    prechargerEditeur()
    const m = await import('../services/chaineWeb')
    const r = await m.creerWeb()
    if (!r?.ok) { setErr(messageChaine(r)); return }
    setCle({ mots: r.mots, chainId: r.chainId })
    setVue('cle')
  })

  const enregistrer = async () => {
    // Extensions (Proton Pass, Bitwarden) : un vrai formulaire soumis ; navigateur : l'API.
    formCle.current?.requestSubmit()
    await enregistrerDansGestionnaire(cle.mots)
    setGarde('gestionnaire')
  }

  const copier = async () => {
    const texte = cle.mots.join(' ')
    try {
      await navigator.clipboard.writeText(texte)
      setGarde('copie')
      // Le presse-papiers est vidé au bout d'une minute (si rien d'autre n'y a été mis).
      clearTimeout(effacerCopie.current)
      effacerCopie.current = setTimeout(async () => {
        try { if ((await navigator.clipboard.readText()) === texte) await navigator.clipboard.writeText('') } catch { /* page en arrière-plan */ }
      }, 60_000)
    } catch {
      setErr(t('entry.copyFailed'))
    }
  }

  const continuer = () => agir(async () => {
    noterSauvegarde(cle.chainId)
    transmettreAuMac(cle.mots.join(' '))
    setCle(null)
    await onPret({ nouvelle: true })
  })

  const connecter = (texte) => agir(async () => {
    const m = await import('../services/chaineWeb')
    const r = await m.rejoindreWeb(texte)
    if (!r?.ok) {
      setErr(r?.code === 'CHAIN_UNKNOWN' ? t('entry.noChain') : messageChaine(r))
      return
    }
    noterSauvegarde(r.chainId)
    transmettreAuMac(texte)
    setSaisie('')
    await onPret({ nouvelle: false })
  })

  const depuisGestionnaire = () => agir(async () => {
    const texte = await recupererDepuisGestionnaire()
    if (!texte || typeof texte !== 'string' || texte === 'annule') { setErr(t('entry.managerEmpty')); return }
    setSaisie(texte)
    await connecter(texte)
  })

  return (
    <div className="onboarding">
      <div className="onboarding-inner entree">
        <div className="onboarding-mark"><AppMark size={56} /></div>

        {vue === 'mac' && (
          <>
            <h1 className="onboarding-title">{t('entry.title')}</h1>
            <p className="onboarding-body" aria-busy="true"><Loader2 className="spin" size={15} /> {t('entry.desktopConnecting')}</p>
          </>
        )}

        {vue === 'choix' && (
          <>
            <h1 className="onboarding-title">{t('entry.title')}</h1>
            <p className="onboarding-body">{t('entry.body')}</p>
            <div className="onboarding-actions">
              <button type="button" className="onboarding-primary" onClick={() => { setErr(''); setVue('connexion'); prechargerEditeur() }} disabled={busy} data-testid="entree-connexion">
                {t('entry.signIn')}
              </button>
              <button type="button" className="onboarding-secondary" onClick={creer} disabled={busy} data-testid="entree-creer">
                {busy ? <Loader2 className="spin" size={15} /> : null} {t('entry.create')}
              </button>
            </div>
            <p className="onboarding-reassure">{t('entry.reassure')}</p>
          </>
        )}

        {vue === 'cle' && cle && (
          <>
            <h1 className="onboarding-title">{t('entry.keyTitle')}</h1>
            <p className="onboarding-body">{t('entry.keyBody')}</p>
            <ol className="chaine-mots" data-testid="entree-mots">
              {cle.mots.map((m, i) => (
                <li key={i}><span className="chaine-mot-n">{i + 1}</span><span className="chaine-mot">{m}</span></li>
              ))}
            </ol>
            {/* Formulaire réel : c'est lui que Proton Pass ou Bitwarden proposent d'enregistrer (pas dans l'app Mac). */}
            {!bureau && <form ref={formCle} className="entree-form entree-enregistrement" onSubmit={(e) => e.preventDefault()}>
              <label>
                <span>{t('entry.savedAs')}</span>
                <input className="panel-input" name="username" autoComplete="username" value={ID_CHAINE} readOnly />
              </label>
              <label>
                <span>{t('entry.key')}</span>
                <input className="panel-input" type="password" name="password" autoComplete="new-password" value={cle.mots.join(' ')} readOnly tabIndex={-1} />
              </label>
            </form>}
            <div className="onboarding-actions">
              {!bureau && (
                <button type="button" className="onboarding-secondary" onClick={enregistrer} data-testid="entree-gestionnaire">
                  {garde === 'gestionnaire' ? <Check size={15} /> : <KeyRound size={15} />} {t('entry.saveManager')}
                </button>
              )}
              <button type="button" className="onboarding-secondary" onClick={copier} data-testid="entree-copier">
                {garde === 'copie' ? <Check size={15} /> : <Copy size={15} />} {garde === 'copie' ? t('entry.copied') : t('entry.copy')}
              </button>
              <button type="button" className="onboarding-primary" onClick={continuer} disabled={busy || !garde} data-testid="entree-continuer">
                {t('entry.continue')}
              </button>
            </div>
            {!garde && (
              <button type="button" className="onboarding-link" onClick={() => setGarde('ecrit')}>{t('entry.wroteDown')}</button>
            )}
            {garde === 'gestionnaire' && !estDisponible() && <p className="onboarding-reassure">{t('entry.managerHint', { name: ID_CHAINE })}</p>}
            <p className="onboarding-reassure">{t('entry.keyWarning')}</p>
          </>
        )}

        {vue === 'connexion' && (
          <>
            <h1 className="onboarding-title">{t('entry.signInTitle')}</h1>
            <p className="onboarding-body">{t('entry.signInBody')}</p>
            <form className="entree-form" onSubmit={(e) => { e.preventDefault(); if (saisie.trim()) connecter(saisie) }}>
              <input className="entree-cache" name="username" autoComplete="username" value={ID_CHAINE} readOnly tabIndex={-1} aria-hidden="true" />
              <div className="chaine-champ-mots">
                <input
                  className="panel-input"
                  type={visible ? 'text' : 'password'}
                  name="password"
                  autoComplete="current-password"
                  placeholder={t('sync.join.placeholder')}
                  aria-label={t('sync.join.placeholder')}
                  value={saisie}
                  onChange={(e) => setSaisie(e.target.value)}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  autoFocus
                  data-testid="entree-mots-saisie"
                />
                <button type="button" className="chaine-oeil" onClick={() => setVisible((v) => !v)} aria-label={visible ? t('sync.join.hide') : t('sync.join.show')}>
                  {visible ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              <div className="onboarding-actions">
                <button type="submit" className="onboarding-primary" disabled={busy || !saisie.trim()} data-testid="entree-valider">
                  {busy ? <Loader2 className="spin" size={15} /> : null} {t('entry.signIn')}
                </button>
                {estDisponible() && (
                  <button type="button" className="onboarding-secondary" onClick={depuisGestionnaire} disabled={busy}>
                    <KeyRound size={15} /> {t('sync.join.fromManager')}
                  </button>
                )}
              </div>
            </form>
            <button type="button" className="onboarding-link" onClick={() => { setErr(''); setVue('choix') }}>
              <ChevronLeft size={13} /> {t('entry.back')}
            </button>
          </>
        )}

        {err && <p className="onboarding-error" role="alert">{err}</p>}
      </div>
    </div>
  )
}
