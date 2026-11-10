// Historique des versions d'une note : la liste à gauche, la version choisie à
// droite avec ce qu'elle a changé (vert ajouté, rouge retiré), et « Restore ».
// Utilisé par l'application (note du vault) et par la page d'un document partagé.

import { useEffect, useMemo, useState } from 'react'
import { X, RotateCcw } from 'lucide-react'
import { lister, fermerTranche } from '../services/historique'
import { diffLignes } from '../utils/diffLignes'
import { t } from '../services/i18n'
import './Historique.css'

const heure = new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit' })
const jour = new Intl.DateTimeFormat('en', { weekday: 'short', day: 'numeric', month: 'short' })

function quand(date, maintenant = Date.now()) {
  const d = new Date(date)
  const aujourdhui = new Date(maintenant).toDateString()
  const hier = new Date(maintenant - 864e5).toDateString()
  if (d.toDateString() === aujourdhui) return `${t('history.today')}, ${heure.format(d)}`
  if (d.toDateString() === hier) return `${t('history.yesterday')}, ${heure.format(d)}`
  return `${jour.format(d)}, ${heure.format(d)}`
}

export default function Historique({ doc, texteActuel, onRestaurer, onFermer }) {
  const [versions, setVersions] = useState(null)
  const [choix, setChoix] = useState(0)

  useEffect(() => {
    let vivant = true
    lister(doc).then((v) => { if (vivant) setVersions(v) })
    return () => { vivant = false }
  }, [doc])

  useEffect(() => {
    const echap = (e) => { if (e.key === 'Escape') onFermer() }
    window.addEventListener('keydown', echap)
    return () => window.removeEventListener('keydown', echap)
  }, [onFermer])

  const version = versions?.[choix]
  // Ce que la version a changé par rapport à la précédente.
  const lignes = useMemo(() => {
    if (!version) return []
    const precedente = versions[choix + 1]?.texte ?? ''
    return diffLignes(precedente, version.texte)
  }, [versions, choix, version])

  const restaurer = async () => {
    await fermerTranche(doc)
    onRestaurer(version.texte)
    onFermer()
  }

  return (
    <div className="historique-voile" onMouseDown={(e) => { if (e.target === e.currentTarget) onFermer() }}>
      <div className="historique" role="dialog" aria-modal="true" aria-label={t('history.title')} data-testid="historique">
        <header className="historique-entete">
          <h2>{t('history.title')}</h2>
          <button type="button" className="historique-fermer" onClick={onFermer} aria-label="Close"><X size={16} /></button>
        </header>
        {versions && versions.length === 0 ? (
          <p className="historique-vide">{t('history.empty')}</p>
        ) : (
          <div className="historique-corps">
            <ol className="historique-liste">
              {(versions || []).map((v, i) => (
                <li key={v.id}>
                  <button
                    type="button"
                    className={i === choix ? 'actif' : ''}
                    onClick={() => setChoix(i)}
                    data-testid="historique-version"
                  >
                    <span className="historique-date">{i === 0 && v.texte === texteActuel ? t('history.current') : quand(v.date)}</span>
                    {v.auteurs?.length > 0 && <span className="historique-auteurs">{v.auteurs.join(', ')}</span>}
                  </button>
                </li>
              ))}
            </ol>
            <div className="historique-apercu">
              {version && (
                <>
                  <div className="historique-texte" data-testid="historique-apercu">
                    {lignes.map((l, i) => (
                      <div key={i} className={`historique-ligne ${l.type}`}>{l.texte || ' '}</div>
                    ))}
                  </div>
                  <div className="historique-actions">
                    <p className="historique-note">{t('history.legend')}</p>
                    <button
                      type="button"
                      className="historique-restaurer"
                      onClick={restaurer}
                      disabled={version.texte === texteActuel}
                      data-testid="historique-restaurer"
                    >
                      <RotateCcw size={15} />
                      {t('history.restore')}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
