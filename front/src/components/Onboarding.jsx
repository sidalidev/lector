import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import AppMark from './AppMark'
import { t } from '../services/i18n'
import * as vaultSetup from '../services/vaultSetup'
import './Onboarding.css'

/**
 * Premier lancement, deux écrans au plus :
 * 1. « Where should your notes live? » : créer Lector Vault (ou rouvrir celui
 *    qui existe), ou prendre un dossier existant ;
 * 2. « Sync your devices? », qu'on peut passer.
 * L'étape est gardée par App (localStorage) : l'app tuée reprend au même écran.
 */

function cheminLisible(chemin) {
  if (!chemin) return null
  const home = window.electron?.getHomePath?.()
  return home && chemin.startsWith(home) ? `~${chemin.slice(home.length)}` : chemin
}

function Points({ etape }) {
  return (
    <div className="onboarding-dots" aria-hidden="true">
      <span className={etape === 1 ? 'is-active' : ''} />
      <span className={etape === 2 ? 'is-active' : ''} />
    </div>
  )
}

export function OnboardingWhere({ onReady, onDemo, firstRun = true }) {
  const [sugg, setSugg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [erreur, setErreur] = useState(null)

  useEffect(() => {
    let vivant = true
    vaultSetup.suggestion()
      .then((s) => { if (vivant) setSugg(s) })
      .catch(() => { if (vivant) setSugg({ platform: 'web', name: 'Lector Vault', exists: false, canChoose: false, canCreate: false }) })
    return () => { vivant = false }
  }, [])

  const agir = async (fn) => {
    if (busy) return
    setBusy(true)
    setErreur(null)
    try {
      const r = await fn()
      if (r) await onReady(r)
    } catch (err) {
      setErreur(err?.code || 'UNKNOWN')
    } finally {
      setBusy(false)
    }
  }

  // Espace réservé tant que la plateforme n'est pas connue : rien ne saute.
  if (!sugg) {
    return <div className="onboarding" aria-busy="true"><div className="onboarding-inner" /></div>
  }

  const { platform, exists, canChoose } = sugg
  const sansDossier = !sugg.canCreate || erreur === 'ICLOUD_UNAVAILABLE' || erreur === 'BROWSER_UNSUPPORTED'
  const corps = t(`onboarding.where.body.${platform === 'electron' ? 'desktop' : platform}`)
  const chemin = platform === 'electron' ? cheminLisible(sugg.path) : null

  return (
    <div className="onboarding">
      <div className="onboarding-inner">
        <div className="onboarding-mark"><AppMark size={56} /></div>
        <h1 className="onboarding-title">{t('onboarding.where.title')}</h1>
        <p className="onboarding-body">{corps}</p>
        {chemin && <p className="onboarding-path" title={sugg.path}>{chemin}</p>}

        <div className="onboarding-actions">
          {!sansDossier && (
            <button
              type="button"
              className="onboarding-primary"
              onClick={() => agir(() => vaultSetup.creer(sugg))}
              disabled={busy}
            >
              {exists ? t('onboarding.where.open', { name: sugg.name }) : t('onboarding.where.create')}
            </button>
          )}
          {sansDossier && onDemo && (
            <button type="button" className="onboarding-primary" onClick={onDemo} disabled={busy}>
              {t('onboarding.where.demo')}
            </button>
          )}

          {platform === 'android' && !exists && !sansDossier && (
            <p className="onboarding-hint">{t('onboarding.android.guide')}</p>
          )}

          {canChoose && (
            <button
              type="button"
              className="onboarding-secondary"
              onClick={() => agir(() => vaultSetup.choisir())}
              disabled={busy}
            >
              {exists ? t('onboarding.where.other') : t('onboarding.where.existing')}
            </button>
          )}
        </div>

        {erreur && (
          <p className="onboarding-error" role="alert">
            {t(`onboarding.error.${['ICLOUD_UNAVAILABLE', 'BROWSER_UNSUPPORTED'].includes(erreur) ? erreur : 'generic'}`)}
          </p>
        )}

        {platform === 'android' && <p className="onboarding-reassure">{t('onboarding.android.reassure')}</p>}
        {platform === 'web' && !sansDossier && <p className="onboarding-reassure">{t('onboarding.web.reassure')}</p>}

        {firstRun && <Points etape={1} />}
      </div>
    </div>
  )
}

export function OnboardingSync({ onSetUp, onSkip }) {
  return (
    <div className="onboarding">
      <div className="onboarding-inner">
        <div className="onboarding-icon"><RefreshCw size={28} strokeWidth={2} /></div>
        <h1 className="onboarding-title">{t('onboarding.sync.title')}</h1>
        <p className="onboarding-body">{t('onboarding.sync.free')}</p>
        <p className="onboarding-body">{t('onboarding.sync.text')}</p>
        <div className="onboarding-actions">
          <button type="button" className="onboarding-primary" onClick={onSetUp}>
            {t('onboarding.sync.setUp')}
          </button>
          <button type="button" className="onboarding-secondary" onClick={onSkip}>
            {t('onboarding.sync.skip')}
          </button>
        </div>
        <Points etape={2} />
      </div>
    </div>
  )
}
