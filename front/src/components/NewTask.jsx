import { useEffect, useState } from 'react'
import { etatPermission, demanderPermission } from '../services/rappels'
import { t } from '../services/i18n'
import './TodayView.css'

/**
 * Ajout rapide : une ligne « - [ ] ... » dans Inbox.md, avec date et heure
 * facultatives (⏰ avec une heure, 📅 sans). La permission des notifications
 * n'est demandée qu'au premier rappel, après une phrase qui dit pourquoi.
 */
export default function NewTask({ onClose, onAdd }) {
  const [texte, setTexte] = useState('')
  const [date, setDate] = useState('')
  const [heure, setHeure] = useState('')
  const [permission, setPermission] = useState(null)
  const [envoi, setEnvoi] = useState(false)

  useEffect(() => { etatPermission().then(setPermission) }, [])

  const valider = async () => {
    if (!texte.trim() || envoi) return
    setEnvoi(true)
    if (date && permission === 'prompt') {
      try { await demanderPermission() } catch { /* refus : la tâche s'écrit quand même */ }
    }
    const ok = await onAdd(texte, { date: date || undefined, heure: date && heure ? heure : undefined })
    setEnvoi(false)
    if (ok) onClose()
  }

  return (
    <div className="new-file-overlay" onClick={onClose}>
      <div
        className="new-file-dialog new-task-dialog"
        role="dialog"
        aria-label={t('tasks.newTask')}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}
      >
        <h3>{t('tasks.newTask')}</h3>
        <input
          type="text"
          className="new-file-input"
          value={texte}
          onChange={(e) => setTexte(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') valider() }}
          placeholder={t('tasks.placeholder')}
          autoFocus
          enterKeyHint="done"
        />
        <div className="new-task-when">
          <label>
            {t('tasks.date')}
            <input type="date" className="new-file-input" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label>
            {t('tasks.time')}
            <input type="time" className="new-file-input" value={heure} disabled={!date} onChange={(e) => setHeure(e.target.value)} />
          </label>
        </div>
        {date && permission === 'prompt' && <p className="new-task-why">{t('tasks.whyNotif')}</p>}
        <p className="new-task-why">{t('tasks.inboxHint')}</p>
        <div className="new-file-actions">
          <button className="new-file-cancel" onClick={onClose}>{t('cmd.cancel')}</button>
          <button className="new-file-confirm" onClick={valider} disabled={!texte.trim() || envoi}>{t('tasks.add')}</button>
        </div>
      </div>
    </div>
  )
}
