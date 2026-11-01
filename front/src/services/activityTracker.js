/**
 * Activity Tracker : suivi des streaks et de l'activité quotidienne
 * Stocke les données dans localStorage sous la clé 'lector-activity'
 */
import storage from './storage'

const STORAGE_KEY = 'lector-activity'

function getToday() {
  return new Date().toISOString().split('T')[0] // YYYY-MM-DD
}

function loadActivity() {
  return storage.getRaw(STORAGE_KEY, {})
}

function saveActivity(data) {
  storage.setRaw(STORAGE_KEY, data)
}

/**
 * Enregistre une révision (card ou quiz)
 * @param {'card' | 'quiz'} type
 */
export function trackReview(type) {
  const data = loadActivity()
  const today = getToday()
  if (!data[today]) {
    data[today] = { cardsReviewed: 0, quizAnswered: 0 }
  }
  if (type === 'card') {
    data[today].cardsReviewed += 1
  } else if (type === 'quiz') {
    data[today].quizAnswered += 1
  }
  saveActivity(data)
}

/**
 * Calcule le streak actuel (jours consécutifs avec activité)
 * @returns {number}
 */
export function getStreak() {
  const data = loadActivity()
  let streak = 0
  const now = new Date()
  now.setHours(0, 0, 0, 0)

  // Vérifier aujourd'hui d'abord
  const todayKey = getToday()
  const todayActive = data[todayKey] && (data[todayKey].cardsReviewed > 0 || data[todayKey].quizAnswered > 0)

  // Si pas d'activité aujourd'hui, commencer par hier
  const startDate = new Date(now)
  if (todayActive) {
    streak = 1
  } else {
    startDate.setDate(startDate.getDate() - 1)
    const key = startDate.toISOString().split('T')[0]
    if (data[key] && (data[key].cardsReviewed > 0 || data[key].quizAnswered > 0)) {
      streak = 1
    } else {
      return 0
    }
  }

  // Remonter dans le temps
  const checkDate = new Date(todayActive ? now : startDate)
  checkDate.setDate(checkDate.getDate() - 1)

  while (true) {
    const key = checkDate.toISOString().split('T')[0]
    if (data[key] && (data[key].cardsReviewed > 0 || data[key].quizAnswered > 0)) {
      streak++
      checkDate.setDate(checkDate.getDate() - 1)
    } else {
      break
    }
  }

  return streak
}
