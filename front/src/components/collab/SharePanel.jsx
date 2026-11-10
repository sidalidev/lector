// Panneau Partager de l'application (propriétaire) : créer le lien d'un
// document, l'afficher (lien + QR), arrêter le partage.
// Chargé à la demande : le code de co-écriture n'entre pas dans le paquet principal.

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import LienPartage from './LienPartage'
import { t } from '../../services/i18n'
import { arreterPartage, creerPartage, lienDu, reessayerArrets, stockage, titreDu } from '../../services/collab/partage.js'
import './collab.css'

export default function SharePanel({ filePath, content, onClose }) {
  const [partage, setPartage] = useState(undefined) // undefined : lecture ; null : pas partagé
  const [lien, setLien] = useState(null)
  const [occupe, setOccupe] = useState(false)
  const [message, setMessage] = useState(null)
  // Prénom montré aux autres à côté de mon curseur (gardé dans ce navigateur).
  const [nom, setNom] = useState(() => stockage.lireProfil()?.nom || '')
  // La note ouverte se relie (ou se délie) du salon tout de suite.
  const prevenir = () => window.dispatchEvent(new CustomEvent('lector-partage', { detail: { chemin: filePath } }))

  useEffect(() => {
    reessayerArrets().catch(() => {})
    stockage.partageDuFichier(filePath).then(async (p) => {
      setPartage(p)
      if (p) setLien(await lienDu(p))
    })
  }, [filePath])

  useEffect(() => {
    const echap = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', echap)
    return () => window.removeEventListener('keydown', echap)
  }, [onClose])

  const creer = async () => {
    setOccupe(true)
    setMessage(null)
    if (nom.trim() && nom.trim() !== stockage.lireProfil()?.nom) stockage.ecrireProfil(nom)
    try {
      const r = await creerPartage({ texte: content, titre: titreDu(content, filePath?.split('/').pop()), chemin: filePath })
      setPartage(r.enregistrement)
      setLien(r.lien)
      if (!r.enLigne) setMessage(t('collab.share.offline'))
      prevenir()
    } finally {
      setOccupe(false)
    }
  }

  const arreter = async () => {
    if (!partage || !window.confirm(t('collab.stop.confirm'))) return
    setOccupe(true)
    try {
      const ok = await arreterPartage(partage)
      setPartage(null)
      setLien(null)
      setMessage(t(ok ? 'collab.stop.done' : 'collab.stop.pending'))
      prevenir()
    } finally {
      setOccupe(false)
    }
  }

  return (
    <div className="collab-voile" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="collab-carte" role="dialog" aria-modal="true" aria-label={t('collab.share.title')} data-testid="collab-panneau">
        <button type="button" className="collab-icone collab-fermer" onClick={onClose} aria-label="Close"><X size={16} /></button>
        <h1>{t('collab.share.title')}</h1>
        <p className="collab-note">{t('collab.share.intro')}</p>
        {partage === undefined ? null : lien ? (
          <>
            <LienPartage lien={lien} />
            <button type="button" className="collab-btn collab-btn-danger" onClick={arreter} disabled={occupe}>{t('collab.stop')}</button>
          </>
        ) : (
          <>
          <input
            className="collab-champ"
            maxLength={40}
            value={nom}
            placeholder={t('collab.name.placeholder')}
            aria-label={t('collab.name.hint')}
            onChange={(e) => setNom(e.target.value)}
            data-testid="collab-nom-proprietaire"
          />
          <button type="button" className="collab-btn collab-btn-plein" onClick={creer} disabled={occupe || !nom.trim()} data-testid="collab-creer">
            {occupe ? t('collab.share.creating') : t('collab.share.create')}
          </button>
          </>
        )}
        {message && <p className="collab-note" role="status">{message}</p>}
        <details className="collab-note">
          <summary>{t('collab.privacy.title')}</summary>
          <p>{t('collab.privacy.body')}</p>
          <p>{t('collab.privacy.more')}</p>
        </details>
      </div>
    </div>
  )
}
