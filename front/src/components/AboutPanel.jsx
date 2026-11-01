import { ExternalLink } from 'lucide-react'
import FullscreenOverlay from './FullscreenOverlay'
import AppMark from './AppMark'
import { DOC_TECHNIQUE } from './Explication'
import { t } from '../services/i18n'
import { FLUX_SORTANTS } from '../services/fluxSortants'
import './Panel.css'
import './AboutPanel.css'

// À propos : version, principes (seulement ce qui est vrai aujourd'hui), ce qui
// quitte l'appareil (services/fluxSortants.js, même source que PRIVACY.md),
// état de la sécurité, liens publics et crédits des polices.
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'

const PRINCIPES = ['about.p1', 'about.p2', 'about.p3', 'about.p4']
const LIENS = [
  { cle: 'about.privacy', href: 'https://lector.dockerbop.fr/privacy' },
  { cle: 'about.howSync', href: DOC_TECHNIQUE },
  { cle: 'about.site', href: 'https://sidali.dev' },
]

export default function AboutPanel({ onClose }) {
  return (
    <FullscreenOverlay onClose={onClose} className="panel-overlay">
      <div className="panel apropos">
        <div className="apropos-tete">
          <AppMark size={72} />
          <h2>Lector</h2>
          <p className="apropos-version">{t('about.version', { version: APP_VERSION })}</p>
        </div>

        <section className="apropos-carte">
          <h3>{t('about.principles')}</h3>
          <ul>
            {PRINCIPES.map((cle) => <li key={cle}>{t(cle)}</li>)}
          </ul>
          <p className="panel-note">{t('about.notYet')}</p>
        </section>

        <section className="apropos-carte">
          <h3>{t('about.flows')}</h3>
          <p className="panel-note">{t('about.flowsIntro')}</p>
          <ul className="apropos-flux">
            {FLUX_SORTANTS.map(({ id, destinations, protection }) => (
              <li key={id}>
                <div className="apropos-flux-tete">
                  <strong>{t(`flow.${id}.what`)}</strong>
                  <span className={`apropos-flux-protection apropos-flux-protection--${protection}`}>{t(`flow.prot.${protection}`)}</span>
                </div>
                <p>{t(`flow.${id}.detail`)}</p>
                <p className="apropos-flux-vers">{destinations.join(', ')}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="apropos-carte">
          <h3>{t('about.security')}</h3>
          <p className="panel-note">{t('about.review')}</p>
        </section>

        <nav className="apropos-liens" aria-label={t('about.links')}>
          {LIENS.map(({ cle, href }) => (
            <a key={cle} href={href} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={14} /> {t(cle)}
            </a>
          ))}
        </nav>

        <p className="apropos-credits">{t('about.fonts')}</p>
        <p className="apropos-pied">sidali.dev</p>
      </div>
    </FullscreenOverlay>
  )
}
