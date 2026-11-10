import { t } from '../services/i18n'

// Documentation technique de la synchronisation (docs/CHAINE.md), servie par
// le site de Lector (front/landing/sync/, produite par tools/page-sync.mjs).
export const DOC_TECHNIQUE = 'https://lector.sidali.dev/sync/'

/**
 * Explication en trois étages des écrans de sécurité : une phrase simple,
 * un « pourquoi » en deux phrases à déplier, un lien vers les détails techniques
 * (aucun lien si `lien` vaut null). `cle` désigne la paire de textes
 * `${cle}.simple` et `${cle}.why`.
 */
export default function Explication({ cle, lien = DOC_TECHNIQUE }) {
  return (
    <div className="panel-explication">
      <p className="panel-simple">{t(`${cle}.simple`)}</p>
      <details>
        <summary>{t('sync.why')}</summary>
        <p>{t(`${cle}.why`)}</p>
      </details>
      {lien && <a href={lien} target="_blank" rel="noopener noreferrer">{t('sync.technical')}</a>}
    </div>
  )
}
