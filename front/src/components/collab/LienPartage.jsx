import { useMemo, useState } from 'react'
import { Copy, Check, ExternalLink } from 'lucide-react'
import { t } from '../../services/i18n'
import { encoderQR, cheminSVG } from '../../services/chaine/qr.js'

/**
 * Lien d'invitation d'un document partagé : texte, QR, Copier, Ouvrir.
 * Contrairement au code de la chaîne, ce QR est une adresse web : il est fait
 * pour l'appareil photo d'un téléphone, qui ouvre la page dans le navigateur.
 */
export default function LienPartage({ lien, ouvrir = true }) {
  const [copie, setCopie] = useState(false)
  const qr = useMemo(() => { try { return encoderQR(lien) } catch { return null } }, [lien])

  const copier = async () => {
    try {
      await navigator.clipboard.writeText(lien)
      setCopie(true)
      setTimeout(() => setCopie(false), 1800)
    } catch {
      // presse-papiers refusé : le lien reste sélectionnable
    }
  }

  return (
    <div className="collab-lien">
      {qr && (
        <svg className="collab-qr" viewBox={`0 0 ${qr.taille + 8} ${qr.taille + 8}`} role="img" aria-label={t('collab.share.qrAlt')} shapeRendering="crispEdges">
          <rect width={qr.taille + 8} height={qr.taille + 8} fill="#fff" />
          <path d={cheminSVG(qr)} fill="#000" />
        </svg>
      )}
      <input className="collab-lien-texte" readOnly value={lien} onFocus={(e) => e.target.select()} aria-label={t('collab.share.title')} data-testid="collab-lien" />
      <div className="collab-lien-actions">
        <button type="button" className="collab-btn collab-btn-plein" onClick={copier}>
          {copie ? <Check size={16} /> : <Copy size={16} />}
          {copie ? t('collab.share.copied') : t('collab.share.copy')}
        </button>
        {ouvrir && (
          <a className="collab-btn" href={lien} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={16} />
            {t('collab.share.open')}
          </a>
        )}
      </div>
      <p className="collab-note">{t('collab.share.keep')}</p>
    </div>
  )
}
