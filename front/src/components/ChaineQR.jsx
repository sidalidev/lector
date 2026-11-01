import { useMemo } from 'react'
import { t } from '../services/i18n'
import { encoderQR, cheminSVG } from '../services/chaine/qr.js'

/**
 * Code de la chaîne (lector-chaine:...) en QR. Il ne contient aucune adresse
 * web : il se lit avec le scanner de Lector, jamais avec l'appareil photo, pour
 * que le secret n'entre pas dans l'historique d'un navigateur.
 */
export default function ChaineQR({ texte, className = 'chaine-qr' }) {
  const qr = useMemo(() => { try { return encoderQR(texte) } catch { return null } }, [texte])
  if (!qr) return null
  const cote = qr.taille + 8
  return (
    <svg className={className} viewBox={`0 0 ${cote} ${cote}`} role="img" aria-label={t('sync.qrAlt')} shapeRendering="crispEdges">
      <rect width={cote} height={cote} fill="#fff" />
      <path d={cheminSVG(qr)} fill="#000" />
    </svg>
  )
}
