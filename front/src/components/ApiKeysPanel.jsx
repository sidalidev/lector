import { useState, useEffect, useCallback } from 'react'
import { KeyRound, Loader2, ShieldAlert, Trash2, ExternalLink } from 'lucide-react'
import FullscreenOverlay from './FullscreenOverlay'
import Explication from './Explication'
import { t } from '../services/i18n'
import { keyStatus, setKey, clearKey, testKey } from '../services/apiKeys'
import { checkClaudeStatus } from '../services/claude'
import { messageCle } from '../utils/messagesErreur'
import './Panel.css'
import './ApiKeysPanel.css'

// Réglages « Clés API » : les clés personnelles Anthropic et ElevenLabs. Elles
// restent sur l'appareil ; l'écran n'en montre jamais que les 4 derniers caractères.

const SERVICES = [
  { id: 'anthropic', console: 'https://console.anthropic.com/settings/keys' },
  { id: 'elevenlabs', console: 'https://elevenlabs.io/app/settings/api-keys' },
]

function CarteCle({ service, console: adresseConsole }) {
  const [etat, setEtat] = useState(null) // { present, hint, secure }
  const [valeur, setValeur] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null) // { genre, texte }

  const charger = useCallback(async () => setEtat(await keyStatus(service)), [service])
  useEffect(() => { charger() }, [charger])

  const agir = async (fn) => {
    setBusy(true); setMsg(null)
    try { await fn() } finally { setBusy(false) }
  }

  const enregistrer = () => agir(async () => {
    try {
      await setKey(service, valeur)
      setValeur('')
      setMsg({ genre: 'success', texte: t('keys.saved') })
    } catch {
      setMsg({ genre: 'error', texte: t('keys.saveFailed') })
    }
    await charger()
  })

  const effacer = () => agir(async () => {
    await clearKey(service)
    await charger()
    setMsg({ genre: 'idle', texte: t('keys.cleared') })
  })

  const tester = () => agir(async () => {
    const r = await testKey(service)
    setMsg(r?.ok ? { genre: 'success', texte: t('keys.testOk') } : { genre: 'error', texte: messageCle(r?.code) })
  })

  return (
    <section className="cles-carte">
      <h3>{t(`keys.${service}`)}</h3>
      <p className="panel-note">{t(`keys.${service}Use`)}</p>
      <p className="cles-etat">{etat?.present ? t('keys.present', { hint: etat.hint }) : t('keys.absent')}</p>
      <form className="cles-form" onSubmit={(e) => { e.preventDefault(); if (valeur.trim()) enregistrer() }}>
        {/* Masqué sans être un champ « mot de passe » : les gestionnaires ne proposent pas de l'enregistrer. */}
        <input
          type="text"
          className="panel-input cles-champ"
          name={`api-key-${service}`}
          placeholder={t('keys.placeholder')}
          aria-label={t(`keys.${service}`)}
          value={valeur}
          onChange={(e) => setValeur(e.target.value)}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          data-1p-ignore
          data-lpignore="true"
          data-bwignore
        />
        <div className="cles-actions">
          <button type="submit" className="panel-btn primary" disabled={busy || !valeur.trim()}>
            {busy ? <Loader2 className="spin" size={14} /> : null} {t('keys.save')}
          </button>
          {etat?.present && (
            <button type="button" className="panel-btn ghost" onClick={tester} disabled={busy}>{t('keys.test')}</button>
          )}
          {etat?.present && (
            <button type="button" className="panel-btn danger" onClick={effacer} disabled={busy}>
              <Trash2 size={14} /> {t('keys.clear')}
            </button>
          )}
        </div>
      </form>
      <a className="cles-console" href={adresseConsole} target="_blank" rel="noopener noreferrer">
        <ExternalLink size={12} /> {t('keys.getKey')}
      </a>
      {msg && <div className={`panel-feedback ${msg.genre}`} role="status">{msg.texte}</div>}
    </section>
  )
}

export default function ApiKeysPanel({ onClose }) {
  const isElectron = !!window.electron
  const [outilLocal, setOutilLocal] = useState(false)
  // Ordinateur : les clés sont-elles chiffrées par le trousseau du système ?
  // (Linux sans trousseau : fichier lisible par l'utilisateur seul, en clair.)
  const [chiffrees, setChiffrees] = useState(null)

  // Sur ordinateur, l'outil Claude en ligne de commande passe avant la clé.
  useEffect(() => {
    if (!isElectron) return
    keyStatus(SERVICES[0].id).then((s) => setChiffrees(s.secure)).catch(() => setChiffrees(false))
    checkClaudeStatus().then((s) => setOutilLocal(s.mode === 'local')).catch(() => {})
  }, [isElectron])

  const avertissement = !isElectron ? t('keys.warning')
    : chiffrees === null ? null
    : chiffrees ? t('keys.warningDesktop') : t('keys.insecure')

  return (
    <FullscreenOverlay onClose={onClose} className="panel-overlay">
      <div className="panel">
        <div className="panel-header">
          <KeyRound size={24} />
          <h2>{t('keys.title')}</h2>
        </div>
        <Explication cle="keys.ex" lien={null} />
        {avertissement && (
          <div className="panel-feedback warn">
            <ShieldAlert size={14} /> {avertissement}
          </div>
        )}
        {outilLocal && <p className="panel-note">{t('keys.cli')}</p>}
        {SERVICES.map((s) => <CarteCle key={s.id} service={s.id} console={s.console} />)}
      </div>
    </FullscreenOverlay>
  )
}
