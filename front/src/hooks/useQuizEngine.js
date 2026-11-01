import { useState, useEffect, useCallback } from 'react'
import { calculateNextReview, responseToQuality } from '../services/spacedRepetition'
import { trackReview } from '../services/activityTracker'

// Hook partagé pour la logique quiz/flashcards (score, SR, navigation, keyboard)
export default function useQuizEngine({
  items,             // tableau de cartes/questions
  cards,             // données SR des cartes
  setCards,          // setter pour mettre à jour les cartes SR
  onSave,            // callback(updatedCards, index) pour sauvegarder
  onClose,           // fermer le modal
  trackType,         // 'card' | 'quiz'
  skipSR = false,    // mode cram : pas de sauvegarde SR
}) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [showAnswer, setShowAnswer] = useState(false)
  const [score, setScore] = useState({ correct: 0, incorrect: 0 })
  const [done, setDone] = useState(false)

  const currentCard = cards?.[currentIndex]
  const total = items?.length || 0

  const handleAnswer = useCallback((level) => {
    const isCorrect = level === 'good' || level === 'easy' || level === true
    setScore(prev => ({
      ...prev,
      [isCorrect ? 'correct' : 'incorrect']: prev[isCorrect ? 'correct' : 'incorrect'] + 1,
    }))
    trackReview(trackType)

    if (!skipSR && currentCard) {
      const quality = responseToQuality(level)
      const srUpdate = calculateNextReview(currentCard, quality)
      const updatedCards = [...cards]
      updatedCards[currentIndex] = { ...currentCard, ...srUpdate }
      setCards(updatedCards)
      onSave?.(updatedCards, currentIndex)
    }

    setTimeout(() => {
      if (currentIndex < total - 1) {
        setCurrentIndex(prev => prev + 1)
        setShowAnswer(false)
      } else {
        setDone(true)
      }
    }, 300)
  }, [currentCard, cards, currentIndex, total, skipSR, trackType, setCards, onSave])

  const restart = useCallback(() => {
    setCurrentIndex(0)
    setShowAnswer(false)
    setScore({ correct: 0, incorrect: 0 })
    setDone(false)
  }, [])

  const reveal = useCallback(() => {
    if (!showAnswer) setShowAnswer(true)
  }, [showAnswer])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') { onClose(); return }
      if (!done && currentCard) {
        if ((e.key === ' ' || e.key === 'Enter') && !showAnswer) {
          e.preventDefault()
          setShowAnswer(true)
        }
        if (showAnswer) {
          if (e.key === '1' || e.key === 'ArrowLeft') handleAnswer('again')
          if (e.key === '2') handleAnswer('hard')
          if (e.key === '3' || e.key === 'ArrowRight') handleAnswer('good')
          if (e.key === '4') handleAnswer('easy')
        }
      }
      if (done && e.key === 'r') restart()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [done, currentCard, showAnswer, handleAnswer, restart, onClose])

  return {
    currentIndex,
    showAnswer,
    score,
    done,
    currentCard,
    total,
    handleAnswer,
    restart,
    reveal,
  }
}
