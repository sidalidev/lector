import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Volume2,
  X,
  SkipBack,
  SkipForward,
  Play,
  Pause,
  Square,
  Loader,
  KeyRound,
} from 'lucide-react'
import { t } from '../services/i18n'
import ttsService from '../services/tts'
import { keyStatus, onKeysChanged } from '../services/apiKeys'
import { messageCle, besoinDeCle } from '../utils/messagesErreur'
import storage from '../services/storage'
import './TextToSpeech.css'

// Extraction texte brut depuis markdown
function extractText(markdown) {
  return markdown
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '')
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/^>\s+/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/^---+$/gm, '')
    .replace(/\|/g, ' ')
    .replace(/^[-:]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function splitIntoChunks(text) {
  return text.split(/(?<=[.!?])\s+|\n\n/).filter(c => c.trim().length > 0)
}

function TextToSpeech({ content, onClose, onShowApiKeys }) {
  // Clé ElevenLabs de l'utilisateur : null tant qu'on ne sait pas, puis vrai ou faux.
  const [aUneCle, setAUneCle] = useState(null)

  useEffect(() => {
    const verifier = () => keyStatus('elevenlabs').then(s => setAUneCle(s.present)).catch(() => setAUneCle(false))
    verifier()
    return onKeysChanged(verifier)
  }, [])

  const [isPlaying, setIsPlaying] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [rate, setRate] = useState(1)
  const [progress, setProgress] = useState(0)
  const [currentText, setCurrentText] = useState('')

  // ElevenLabs, avec la clé de l'utilisateur
  const [voices, setVoices] = useState([])
  const [selectedVoice, setSelectedVoice] = useState(null)
  const [loadingVoices, setLoadingVoices] = useState(false)
  const [synthesizing, setSynthesizing] = useState(false)
  const [synthError, setSynthError] = useState(null) // { texte, code }
  const audioRef = useRef(null)
  const prefetchRef = useRef(null)

  // Chunks
  const textChunksRef = useRef([])
  const currentChunkRef = useRef(0)

  useEffect(() => {
    const plainText = extractText(content)
    textChunksRef.current = splitIntoChunks(plainText)
    currentChunkRef.current = 0
    setProgress(0)
  }, [content])

  // Charger les voix dès qu'une clé est là
  useEffect(() => {
    if (!aUneCle) return
    let cancelled = false
    setLoadingVoices(true)
    setSynthError(null)
    ttsService.fetchVoices()
      .then(v => {
        if (cancelled) return
        setVoices(v)
        // Restaurer la dernière voix choisie, sinon la première
        const savedVoiceId = storage.get('tts-voice', null)
        const savedVoice = savedVoiceId && v.find(voice => voice.voice_id === savedVoiceId)
        if (savedVoice) setSelectedVoice(savedVoice)
        else if (v.length > 0) setSelectedVoice(v[0])
      })
      .catch(err => {
        if (!cancelled) setSynthError({ texte: messageCle(err?.code), code: err?.code })
      })
      .finally(() => { if (!cancelled) setLoadingVoices(false) })
    return () => { cancelled = true }
  }, [aUneCle])

  // Prefetch du chunk suivant
  const prefetchNext = useCallback((nextIndex) => {
    if (nextIndex >= textChunksRef.current.length) return
    if (!selectedVoice) return
    const chunk = textChunksRef.current[nextIndex]
    ttsService.synthesize(chunk, selectedVoice.voice_id)
      .then(blob => { prefetchRef.current = { index: nextIndex, blob } })
      .catch(() => {})
  }, [selectedVoice])

  // Lecture d'un chunk via ElevenLabs
  const speakChunk = useCallback(async (index) => {
    if (index >= textChunksRef.current.length) {
      setIsPlaying(false)
      setIsPaused(false)
      setProgress(100)
      setCurrentText('')
      return
    }

    const chunk = textChunksRef.current[index]
    setCurrentText(chunk)
    setSynthesizing(true)
    setSynthError(null)

    try {
      let blob
      if (prefetchRef.current?.index === index) {
        blob = prefetchRef.current.blob
        prefetchRef.current = null
      } else {
        blob = await ttsService.synthesize(chunk, selectedVoice.voice_id)
      }

      setSynthesizing(false)
      const url = URL.createObjectURL(blob)

      if (audioRef.current) {
        audioRef.current.pause()
        URL.revokeObjectURL(audioRef.current.src)
      }
      const audio = new Audio(url)
      audio.playbackRate = rate
      audioRef.current = audio

      prefetchNext(index + 1)

      audio.onended = () => {
        URL.revokeObjectURL(url)
        currentChunkRef.current = index + 1
        setProgress(((index + 1) / textChunksRef.current.length) * 100)
        speakChunk(index + 1)
      }

      audio.onerror = () => {
        URL.revokeObjectURL(url)
        setSynthError({ texte: t('tts.errorSynth') })
        setIsPlaying(false)
      }

      await audio.play()
    } catch (err) {
      setSynthesizing(false)
      setSynthError({ texte: messageCle(err?.code), code: err?.code })
      setIsPlaying(false)
    }
  }, [selectedVoice, rate, prefetchNext])

  // --- CONTRÔLES ---

  const play = () => {
    if (isPaused && audioRef.current) {
      audioRef.current.play()
      setIsPaused(false)
    } else {
      setIsPlaying(true)
      setIsPaused(false)
      speakChunk(currentChunkRef.current)
    }
  }

  const pause = () => {
    if (audioRef.current) audioRef.current.pause()
    setIsPaused(true)
  }

  const stop = () => {
    if (audioRef.current) {
      audioRef.current.pause()
      URL.revokeObjectURL(audioRef.current.src)
      audioRef.current = null
    }
    setIsPlaying(false)
    setIsPaused(false)
    currentChunkRef.current = 0
    setProgress(0)
    setCurrentText('')
    setSynthesizing(false)
  }

  const skipBack = () => {
    if (audioRef.current) {
      audioRef.current.pause()
      URL.revokeObjectURL(audioRef.current.src)
      audioRef.current = null
    }
    currentChunkRef.current = Math.max(0, currentChunkRef.current - 1)
    setProgress((currentChunkRef.current / textChunksRef.current.length) * 100)
    if (isPlaying) speakChunk(currentChunkRef.current)
  }

  const skipForward = () => {
    if (audioRef.current) {
      audioRef.current.pause()
      URL.revokeObjectURL(audioRef.current.src)
      audioRef.current = null
    }
    currentChunkRef.current = Math.min(textChunksRef.current.length - 1, currentChunkRef.current + 1)
    setProgress((currentChunkRef.current / textChunksRef.current.length) * 100)
    if (isPlaying) speakChunk(currentChunkRef.current)
  }

  const handleRateChange = (newRate) => {
    setRate(newRate)
    if (audioRef.current) audioRef.current.playbackRate = newRate
  }

  const handleClose = () => {
    stop()
    onClose()
  }

  // Cleanup
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        URL.revokeObjectURL(audioRef.current.src)
      }
    }
  }, [])

  // Raccourcis clavier
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.closest('input, select')) return
      if (e.key === ' ') {
        e.preventDefault()
        if (isPlaying && !isPaused) pause()
        else if (canPlay) play()
      }
      if (e.key === 'Escape') handleClose()
      if (e.key === 'ArrowLeft') skipBack()
      if (e.key === 'ArrowRight') skipForward()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isPlaying, isPaused])

  const canPlay = aUneCle && selectedVoice && !loadingVoices

  // Sans clé ElevenLabs : proposer l'écran des clés API
  if (aUneCle === false) {
    return (
      <div className="tts-container">
        <div className="tts-panel">
          <div className="tts-header">
            <Volume2 size={18} className="tts-icon" />
            <span className="tts-title">{t('tts.title')}</span>
            <button className="tts-close" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
          <div className="tts-gate">
            <KeyRound size={32} />
            <p>{t('tts.needKey')}</p>
            {onShowApiKeys && (
              <button className="tts-gate-btn" onClick={onShowApiKeys}>
                {t('keys.open')}
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="tts-container">
      <div className="tts-panel">
        <div className="tts-header">
          <Volume2 size={18} className="tts-icon" />
          <span className="tts-title">{t('tts.title')}</span>
          <button className="tts-close" onClick={handleClose}>
            <X size={16} />
          </button>
        </div>

        {/* Barre de progression */}
        <div className="tts-progress-container">
          <div className="tts-progress-bar">
            <div
              className="tts-progress-fill"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="tts-progress-text">{Math.round(progress)}%</span>
        </div>

        {/* Aperçu texte en cours */}
        {currentText && (
          <div className="tts-current-text">
            {synthesizing && <Loader size={12} className="tts-spinner" />}
            "{currentText.slice(0, 100)}{currentText.length > 100 ? '...' : ''}"
          </div>
        )}

        {/* Erreur */}
        {synthError && (
          <div className="tts-error">
            {synthError.texte}
            {besoinDeCle(synthError.code) && onShowApiKeys && (
              <button className="tts-error-btn" onClick={onShowApiKeys}>{t('keys.open')}</button>
            )}
          </div>
        )}

        {/* Contrôles */}
        <div className="tts-controls">
          <button className="tts-btn" onClick={skipBack} title={t('tts.previous')}>
            <SkipBack size={18} />
          </button>

          {isPlaying && !isPaused ? (
            <button className="tts-btn tts-btn-main" onClick={pause} title={t('tts.pause')}>
              <Pause size={22} />
            </button>
          ) : (
            <button
              className="tts-btn tts-btn-main"
              onClick={play}
              title={t('tts.play')}
              disabled={!canPlay}
            >
              {synthesizing ? <Loader size={22} className="tts-spinner" /> : <Play size={22} />}
            </button>
          )}

          <button className="tts-btn" onClick={stop} title={t('tts.stop')}>
            <Square size={18} />
          </button>

          <button className="tts-btn" onClick={skipForward} title={t('tts.next')}>
            <SkipForward size={18} />
          </button>
        </div>

        {/* Vitesse */}
        <div className="tts-setting">
          <label>{t('tts.speed')}</label>
          <div className="tts-speed-btns">
            {[0.5, 0.75, 1, 1.25, 1.5, 2].map(r => (
              <button
                key={r}
                className={`tts-speed-btn ${rate === r ? 'active' : ''}`}
                onClick={() => handleRateChange(r)}
              >
                {r}x
              </button>
            ))}
          </div>
        </div>

        {/* Sélection voix */}
        <div className="tts-setting">
          <label>{t('tts.voice')}</label>
          {loadingVoices ? (
            <div className="tts-loading-voices">
              <Loader size={14} className="tts-spinner" /> {t('tts.loadingVoices')}
            </div>
          ) : (
            <select
              value={selectedVoice?.voice_id || ''}
              onChange={e => {
                const v = voices.find(v => v.voice_id === e.target.value)
                setSelectedVoice(v)
                if (v) storage.set('tts-voice', v.voice_id)
              }}
              className="tts-voice-select"
            >
              {voices.map(voice => (
                <option key={voice.voice_id} value={voice.voice_id}>
                  {voice.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Raccourcis */}
        <div className="tts-shortcuts">
          <span>{t('tts.spacePlayPause')}</span>
          <span>{t('tts.arrowNav')}</span>
          <span>{t('tts.escClose')}</span>
        </div>
      </div>
    </div>
  )
}

export default TextToSpeech
