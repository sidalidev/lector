import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Plus, BellOff, Timer } from 'lucide-react'
import {
  abonner, etatTaches, etatPermission, demanderPermission, etatExact, demanderExact,
  basculerDansNote, actualiser,
} from '../services/rappels'
import { vueAujourdhui, nomDeNote, ajouterJours, jourLocal } from '../services/taches/taches.js'
import { haptique } from '../services/haptique'
import { messageChaine } from '../utils/messagesErreur'
import fileSystem from '../services/fileSystem'
import { t } from '../services/i18n'
import './TodayView.css'

const jourCourt = new Intl.DateTimeFormat('en', { weekday: 'short', day: 'numeric', month: 'short' })
const jourLong = new Intl.DateTimeFormat('en', { weekday: 'long', day: 'numeric', month: 'long' })

function dateDuJour(jour) {
  const [a, m, j] = jour.split('-').map(Number)
  return new Date(a, m - 1, j, 12)
}

/** « 14:30 », « Due today », « Tue 3 Nov · 10:00 », « Due Thu 5 Nov ». */
function quand(tache, aujourdhui) {
  if (tache.jour === aujourdhui) return tache.heure && !tache.echeanceSeule ? tache.heure : t('tasks.dueToday')
  const jour = jourCourt.format(dateDuJour(tache.jour))
  return tache.heure && !tache.echeanceSeule ? `${jour} · ${tache.heure}` : t('tasks.due', { date: jour })
}

function Ligne({ tache, aujourdhui, fait, onCocher, onOuvrir }) {
  return (
    <li className={`today-task${fait ? ' done' : ''}`}>
      <input
        type="checkbox"
        className="today-check"
        checked={fait}
        onChange={() => onCocher(tache)}
        aria-label={fait ? t('tasks.markOpen') : t('tasks.markDone')}
      />
      <button className="today-task-body" onClick={() => onOuvrir(tache)} title={t('tasks.openNote')}>
        <span className="today-task-text">{tache.texte}</span>
        <span className="today-task-meta">
          <span className="today-task-when">{quand(tache, aujourdhui)}</span>
          <span className="today-task-note">{nomDeNote(tache.chemin)}</span>
        </span>
      </button>
    </li>
  )
}

function Section({ titre, taches, ton, ...props }) {
  if (!taches.length) return null
  return (
    <section className={`today-section${ton ? ` ${ton}` : ''}`}>
      <h2 className="today-section-title">{titre}<span className="today-section-count">{taches.length}</span></h2>
      <ul className="today-list">
        {taches.map((tache) => (
          <Ligne key={`${tache.chemin}:${tache.ligne}:${tache.brut}`} tache={tache} fait={props.enVol.get(`${tache.chemin}:${tache.ligne}`) ?? tache.fait} {...props} />
        ))}
      </ul>
    </section>
  )
}

/**
 * Vue Today : toutes notes confondues, les tâches en retard, du jour et des
 * 7 jours suivants. On coche ici ; toucher une tâche ouvre sa note à sa ligne.
 */
export default function TodayView({ rootDirPath, onOpenTask, onNewTask, onNoteChanged }) {
  const etat = useSyncExternalStore(abonner, etatTaches)
  const [maintenant, setMaintenant] = useState(() => Date.now())
  const [enVol, setEnVol] = useState(() => new Map())
  const [erreur, setErreur] = useState(null)
  const [permission, setPermission] = useState(null)
  const [exact, setExact] = useState(null)

  useEffect(() => { setMaintenant(Date.now()) }, [etat.maj])
  useEffect(() => {
    etatPermission().then(setPermission)
    etatExact().then(setExact)
  }, [etat.maj])

  const aujourdhui = jourLocal(maintenant)
  const taches = useMemo(() => etat.taches.map((x) => ({ ...x, echeanceSeule: !x.heure })), [etat.taches])
  const vue = useMemo(() => vueAujourdhui(taches, maintenant), [taches, maintenant])
  const total = vue.enRetard.length + vue.aujourdhui.length + vue.aVenir.length
  // Démo : rien n'est programmé, donc rien à autoriser.
  const rappelsAVenir = !rootDirPath?.startsWith('demo://') && etat.taches.some((x) => !x.fait && x.rappel !== null && x.rappel > maintenant)
  const web = !fileSystem.isElectron() && !fileSystem.isCapacitor()

  const cocher = async (tache) => {
    const cle = `${tache.chemin}:${tache.ligne}`
    const fait = !(enVol.get(cle) ?? tache.fait)
    setEnVol((m) => new Map(m).set(cle, fait))
    setErreur(null)
    haptique(fait ? 'confirm' : 'tick')
    try {
      const r = await basculerDansNote(tache)
      if (!r) setErreur(t('tasks.changed'))
      else onNoteChanged?.(tache.chemin, r.contenu)
    } catch (err) {
      setErreur(err?.code ? messageChaine(err) : t('tasks.writeFailed'))
    }
    await actualiser(rootDirPath)
    setEnVol((m) => { const n = new Map(m); n.delete(cle); return n })
  }

  const autoriser = async () => {
    setPermission(await demanderPermission())
    actualiser(rootDirPath)
  }

  const surLaMinute = async () => {
    setExact(await demanderExact())
    actualiser(rootDirPath)
  }

  const exemple = `${ajouterJours(aujourdhui, 1)} 09:00`
  const props = { aujourdhui, enVol, onCocher: cocher, onOuvrir: onOpenTask }

  return (
    <div className="today-view">
      <div className="today-inner">
        <header className="today-header">
          <div>
            <h1 className="today-title">{t('tasks.today')}</h1>
            <p className="today-date">{jourLong.format(dateDuJour(aujourdhui))}</p>
          </div>
          <button className="today-new" onClick={onNewTask}>
            <Plus size={16} />
            {t('tasks.newTask')}
          </button>
        </header>

        {rappelsAVenir && permission === 'prompt' && (
          <div className="today-note">
            <BellOff size={16} />
            <span>{t('tasks.notifOff')}</span>
            <button onClick={autoriser}>{t('tasks.allow')}</button>
          </div>
        )}
        {rappelsAVenir && permission === 'denied' && (
          <div className="today-note"><BellOff size={16} /><span>{t('tasks.notifDenied')}</span></div>
        )}
        {rappelsAVenir && permission === 'granted' && exact === 'off' && (
          <div className="today-note">
            <Timer size={16} />
            <span>{t('tasks.exactOff')}</span>
            <button onClick={surLaMinute}>{t('tasks.exactOn')}</button>
          </div>
        )}
        {erreur && <div className="today-error" role="alert">{erreur}</div>}

        {!etat.pret && etat.taches.length === 0 ? (
          <div className="today-placeholder" aria-busy="true">{t('tasks.loading')}</div>
        ) : total === 0 ? (
          <div className="today-empty">
            <p className="today-empty-title">{t('tasks.empty')}</p>
            <p className="today-empty-hint">{t('tasks.emptyHint')}</p>
            <code className="today-empty-example">- [ ] Call the bank ⏰ {exemple}</code>
          </div>
        ) : (
          <>
            <Section titre={t('tasks.overdue')} taches={vue.enRetard} ton="late" {...props} />
            <Section titre={t('tasks.todaySection')} taches={vue.aujourdhui} {...props} />
            <Section titre={t('tasks.next7')} taches={vue.aVenir} {...props} />
            <p className="today-end">
              {t('tasks.end')}
              {rappelsAVenir && (web ? ` ${t('tasks.webOnlyOpen')}` : fileSystem.isElectron() ? ` ${t('tasks.desktopRunning')}` : '')}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
