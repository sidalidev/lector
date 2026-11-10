import { useEffect, useState } from 'react'
import AppMark from './AppMark'
import { t } from '../services/i18n'
import * as vaultSetup from '../services/vaultSetup'
import './Onboarding.css'

/**
 * Premier lancement : un seul écran.
 * - « Start » crée Lector Vault (ou rouvre celui qui existe) et ouvre la note
 *   d'accueil ; la synchro se règle plus tard, depuis l'app.
 * - « I already use Lector » crée un dossier vide et ouvre la saisie des 12 mots.
 */

function cheminLisible(chemin) {
  if (!chemin) return null
  const home = window.electron?.getHomePath?.()
  return home && chemin.startsWith(home) ? `~${chemin.slice(home.length)}` : chemin
}

export function OnboardingWhere({ onReady, onAlreadyUser, firstRun = true }) {
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

  const agir = async (fn, suite = onReady) => {
    if (busy) return
    setBusy(true)
    setErreur(null)
    try {
      const r = await fn()
      if (r) await suite(r)
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
  const chemin = platform === 'electron' ? cheminLisible(sugg.path) : null

  // Un seul écran, deux chemins : nouveau (dossier créé sans question, note
  // d'accueil ouverte) ou déjà utilisateur (droit aux 12 mots). Le choix d'un
  // autre dossier reste possible, en lien discret, là où il a un sens.
  return (
    <div className="onboarding">
      <div className="onboarding-inner">
        <div className="onboarding-mark"><AppMark size={56} /></div>
        <h1 className="onboarding-title">{t('onboarding.title')}</h1>
        <p className="onboarding-body">{t('onboarding.body')}</p>

        <div className="onboarding-actions">
          {!sansDossier && (
            <button
              type="button"
              className="onboarding-primary"
              onClick={() => agir(() => vaultSetup.creer(sugg))}
              disabled={busy}
            >
              {exists ? t('onboarding.where.open', { name: sugg.name }) : t('onboarding.start')}
            </button>
          )}
          {firstRun && !exists && !sansDossier && onAlreadyUser && (
            <button
              type="button"
              className="onboarding-secondary"
              onClick={() => agir(() => vaultSetup.creer(sugg), onAlreadyUser)}
              disabled={busy}
            >
              {t('onboarding.alreadyUser')}
            </button>
          )}
        </div>

        {platform === 'android' && !exists && !sansDossier && (
          <p className="onboarding-hint">{t('onboarding.android.guide')}</p>
        )}

        {erreur && (
          <p className="onboarding-error" role="alert">
            {t(`onboarding.error.${['ICLOUD_UNAVAILABLE', 'BROWSER_UNSUPPORTED'].includes(erreur) ? erreur : 'generic'}`)}
          </p>
        )}

        <p className="onboarding-reassure">
          {t(`onboarding.reassure.${platform === 'electron' ? 'desktop' : platform}`)}
          {chemin && <><br /><span className="onboarding-path" title={sugg.path}>{chemin}</span></>}
        </p>

        {canChoose && (
          <button
            type="button"
            className="onboarding-link"
            onClick={() => agir(() => vaultSetup.choisir())}
            disabled={busy}
          >
            {exists ? t('onboarding.where.other') : t('onboarding.where.existing')}
          </button>
        )}
      </div>
    </div>
  )
}
