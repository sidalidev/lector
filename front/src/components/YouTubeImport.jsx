import { useState } from 'react'
import { Youtube, Loader2, XCircle } from 'lucide-react'
import FullscreenOverlay from './FullscreenOverlay'
import { youtubeToMarkdown } from '../services/youtube'
import { t } from '../services/i18n'
import './YouTubeImport.css'

export default function YouTubeImport({ onClose, onImport }) {
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState('idle') // idle | loading | error
  const [errorMsg, setErrorMsg] = useState('')

  const handleImport = async () => {
    const trimmed = url.trim()
    if (!trimmed) return

    setStatus('loading')
    setErrorMsg('')

    try {
      const result = await youtubeToMarkdown(trimmed)
      onImport(result)
      onClose()
    } catch (err) {
      setStatus('error')
      setErrorMsg(err.message || t('youtube.unknownError'))
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleImport()
  }

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) setUrl(text)
    } catch { /* ignore */ }
  }

  return (
    <FullscreenOverlay onClose={status === 'loading' ? undefined : onClose} className="youtube-import-overlay">
      <div className="youtube-import-panel">
        <div className="youtube-import-header">
          <Youtube size={24} color="#ff0000" />
          <h2>{t('youtube.title')}</h2>
        </div>

        <p className="youtube-import-desc">
          {t('youtube.desc')}
        </p>

        <div className="youtube-import-input-group">
          <input
            type="text"
            className="youtube-import-input"
            placeholder="https://youtube.com/watch?v=..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={status === 'loading'}
            autoFocus
          />
          <button
            className="youtube-import-paste-btn"
            onClick={handlePaste}
            disabled={status === 'loading'}
            title={t('youtube.paste')}
          >
            📋
          </button>
        </div>

        <button
          className="youtube-import-btn"
          onClick={handleImport}
          disabled={status === 'loading' || !url.trim()}
        >
          {status === 'loading'
            ? <><Loader2 size={16} className="spin" /> {t('youtube.extracting')}</>
            : t('youtube.extract')
          }
        </button>

        {status === 'error' && (
          <div className="youtube-import-error">
            <XCircle size={16} />
            {errorMsg}
          </div>
        )}
      </div>
    </FullscreenOverlay>
  )
}
