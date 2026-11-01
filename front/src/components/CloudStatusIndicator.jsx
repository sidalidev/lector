import { useEffect, useState, useRef } from 'react'
import { CloudCheck, CloudOff, CloudCog, CloudUpload, CloudDownload, CloudAlert } from 'lucide-react'
import { t } from '../services/i18n'
import './CloudStatusIndicator.css'

// Pastille de la barre de titre : état de la synchro par la chaîne (ordinateur).

const FLASH_MS = 2500

const FLASHS = {
  'sync-pulled': 'pulled',
  'sync-pushed': 'pushed',
  'sync-deleted-server': 'deleted',
  'sync-removed-local': 'deleted',
  'sync-conflict-saved': 'conflict',
  'sync-conflict-pushed': 'conflict',
}

const SYMBOLES = { pulled: '↓', pushed: '↑', deleted: '✕', conflict: '⚠' }

function basename(p) {
  if (!p) return ''
  const parts = p.split(/[\\/]/)
  return parts[parts.length - 1] || p
}

export default function CloudStatusIndicator({ onClick }) {
  const cloud = window.electron?.cloud
  const [status, setStatus] = useState(null) // cloud.status()
  const [flash, setFlash] = useState(null) // { kind, path }
  const flashTimer = useRef(null)

  useEffect(() => {
    if (!cloud) return
    let unmounted = false
    const charger = () => cloud.status().then((s) => { if (!unmounted) setStatus(s) }).catch(() => {})
    charger()

    const off = cloud.onEvent((evt) => {
      if (unmounted) return
      // La chaîne a pu être créée, rejointe ou quittée depuis l'écran Synchronisation.
      if (evt?.type === 'status' || evt?.type === 'chain-block' || evt?.type === 'quota') charger()
      else if (evt?.type === 'sync-complete') {
        setStatus((prev) => prev ? { ...prev, sync: { ...(prev.sync || {}), lastSyncAt: evt.lastSyncAt, syncing: false } } : prev)
      } else if (evt?.type === 'error') {
        setStatus((prev) => prev ? { ...prev, sync: { ...(prev.sync || {}), lastError: evt.message, lastErrorCode: evt.code } } : prev)
      } else if (evt?.type === 'vault-event') {
        const kind = FLASHS[evt.kind]
        if (kind) {
          setFlash({ kind, path: evt.path })
          if (flashTimer.current) clearTimeout(flashTimer.current)
          flashTimer.current = setTimeout(() => setFlash(null), FLASH_MS)
        }
      }
    })
    return () => { unmounted = true; if (off) off(); if (flashTimer.current) clearTimeout(flashTimer.current) }
  }, [cloud])

  if (!cloud || !status?.hasChain) return null

  const sync = status.sync || {}
  const syncing = sync.syncing || sync.state === 'starting'
  const chainUnknown = sync.state === 'chain-unknown'
  const hasErr = !!sync.lastError || sync.state === 'chain-proof'
  const alerte = hasErr || chainUnknown || !!sync.quotaFull
  const Icon = alerte ? CloudAlert
            : syncing ? CloudCog
            : flash?.kind === 'pulled' ? CloudDownload
            : flash?.kind === 'pushed' ? CloudUpload
            : sync.state === 'running' ? CloudCheck
            : CloudOff

  const label = flash
    ? `${SYMBOLES[flash.kind]} ${basename(flash.path)}`
    : chainUnknown ? t('cloud.status.joinChain')
    : sync.quotaFull ? t('cloud.status.quotaFull')
    : hasErr ? t('cloud.status.error')
    : syncing ? t('cloud.status.syncing')
    : sync.lastSyncAt ? t('cloud.status.synced', { time: shortTime(sync.lastSyncAt) })
    : t('cloud.status.idle')

  return (
    <button
      className={`cloud-status ${alerte ? 'err' : syncing ? 'busy' : 'ok'}${flash ? ' flash' : ''}`}
      onClick={onClick}
      title={t('cloud.status.title')}
    >
      <Icon size={14} className={syncing ? 'spin' : ''} />
      <span className="cloud-status-label">{label}</span>
    </button>
  )
}

function shortTime(iso) {
  try {
    const d = new Date(iso)
    const sec = Math.round((Date.now() - d.getTime()) / 1000)
    if (sec < 10) return t('cloud.status.justNow')
    if (sec < 60) return t('cloud.status.secondsAgo', { n: sec })
    if (sec < 3600) return t('cloud.status.minutesAgo', { n: Math.round(sec / 60) })
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch { return iso }
}
