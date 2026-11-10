import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { t } from '../services/i18n'
import ChaineQR from './ChaineQR'
import { DOC_TECHNIQUE } from './Explication'
import './KitSecours.css'

const SITE = 'https://lector.sidali.dev'

/**
 * Kit de secours imprimable : les 12 mots numérotés, le code en QR, et une
 * page « Pour un proche ». Monté le temps de l'impression (window.print, sans
 * dépendance), puis retiré : `onFini` est appelé après le dialogue.
 */
export default function KitSecours({ mots, code, onFini }) {
  const fini = useRef(onFini)
  fini.current = onFini

  // Une seule impression par montage.
  useEffect(() => {
    document.body.classList.add('impression-kit')
    const fin = () => fini.current()
    window.addEventListener('afterprint', fin)
    const minuterie = setTimeout(() => window.print(), 50)
    return () => {
      clearTimeout(minuterie)
      window.removeEventListener('afterprint', fin)
      document.body.classList.remove('impression-kit')
    }
  }, [])

  const date = new Date().toLocaleDateString()

  return createPortal(
    <div className="kit-secours">
      <section className="kit-page">
        <h1>{t('sync.kit.title')}</h1>
        <p className="kit-date">{t('sync.kit.date', { date })}</p>
        <p>{t('sync.kit.intro')}</p>
        <ol className="kit-mots">
          {mots.map((m, i) => (
            <li key={i}><span className="kit-n">{i + 1}</span> {m}</li>
          ))}
        </ol>
        {code && (
          <div className="kit-qr">
            <ChaineQR texte={code} className="kit-qr-image" />
            <p>{t('sync.kit.qr')}</p>
          </div>
        )}
        <p className="kit-avertissement">{t('sync.kit.warning')}</p>
      </section>
      <section className="kit-page">
        <h1>{t('sync.kit.relativeTitle')}</h1>
        <p>{t('sync.kit.relativeIntro')}</p>
        <h2>{t('sync.kit.whereTitle')}</h2>
        <p>{t('sync.kit.where')}</p>
        <h2>{t('sync.kit.appTitle')}</h2>
        <p>{t('sync.kit.app', { site: SITE })}</p>
        <h2>{t('sync.kit.howTitle')}</h2>
        <p>{t('sync.kit.how')}</p>
        <h2>{t('sync.kit.readTitle')}</h2>
        <p>{t('sync.kit.read')}</p>
        <h2>{t('sync.kit.repoTitle')}</h2>
        <p>{t('sync.kit.repo', { doc: DOC_TECHNIQUE })}</p>
      </section>
    </div>,
    document.body,
  )
}
