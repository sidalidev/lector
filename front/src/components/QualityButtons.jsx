import { previewIntervals, formatIntervalShort } from '../services/spacedRepetition'
import { t } from '../services/i18n'
import Tooltip from './Tooltip'
import './QualityButtons.css'

// Boutons de qualité SR partagés: Flashcards
function QualityButtons({ card, onAnswer, hideIntervals, className }) {
  const intervals = previewIntervals(card)
  const levels = [
    { key: 'again', label: t('flash.again'), kbd: '1', tooltipKey: 'flash.againTip' },
    { key: 'hard', label: t('flash.hardBtn'), kbd: '2', tooltipKey: 'flash.hardTip' },
    { key: 'good', label: t('flash.good'), kbd: '3', tooltipKey: 'flash.goodTip' },
    { key: 'easy', label: t('flash.easyBtn'), kbd: '4', tooltipKey: 'flash.easyTip' },
  ]

  return (
    <div className={`quality-buttons ${className || ''}`}>
      {levels.map(({ key, label, kbd, tooltipKey }) => (
        <Tooltip key={key} text={t(tooltipKey)} position="bottom">
          <button
            className={`quality-btn quality-btn-${key}`}
            onClick={() => onAnswer(key)}
          >
            <span className="quality-btn-label">{label}</span>
            {!hideIntervals && (
              <span className="quality-btn-interval">{formatIntervalShort(intervals[key])}</span>
            )}
            <kbd>{kbd}</kbd>
          </button>
        </Tooltip>
      ))}
    </div>
  )
}

export default QualityButtons
