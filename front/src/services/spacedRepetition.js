/**
 * Spaced Repetition Service - Algorithme SM-2
 * Optimise les intervalles de révision pour une mémorisation durable
 */
import storage from './storage';

/**
 * Calcule la prochaine date de révision avec l'algorithme SM-2
 * @param {Object} card - La carte avec ses données SR
 * @param {number} quality - Qualité de la réponse (0-5)
 *   0: Blackout complet
 *   1: Incorrect, mais reconnu après avoir vu la réponse
 *   2: Incorrect, mais facile à retenir
 *   3: Correct avec difficulté
 *   4: Correct après hésitation
 *   5: Parfait
 * @returns {Object} - Nouvelles valeurs SR { easeFactor, interval, repetitions, nextReviewAt }
 */
export function calculateNextReview(card, quality) {
  let { easeFactor = 2.5, interval = 1, repetitions = 0 } = card;

  // SM-2: Si qualité < 3, on recommence
  if (quality < 3) {
    repetitions = 0;
    interval = 1;
  } else {
    // Bonne réponse
    if (repetitions === 0) {
      interval = 1;
    } else if (repetitions === 1) {
      interval = 3;
    } else {
      interval = Math.round(interval * easeFactor);
    }
    repetitions += 1;
  }

  // Mise à jour du facteur de facilité (minimum 1.3)
  easeFactor = Math.max(
    1.3,
    easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
  );

  // Calculer la prochaine date
  const nextReviewAt = new Date();
  nextReviewAt.setDate(nextReviewAt.getDate() + interval);
  nextReviewAt.setHours(0, 0, 0, 0);

  return {
    easeFactor: Math.round(easeFactor * 100) / 100,
    interval,
    repetitions,
    lastReviewedAt: new Date().toISOString(),
    nextReviewAt: nextReviewAt.toISOString()
  };
}

/**
 * Convertit une réponse utilisateur en qualité SM-2
 * Accepte 4 niveaux : 'again' (1), 'hard' (3), 'good' (4), 'easy' (5)
 * Backward compat : true/false → 4/1
 * @param {string|boolean} response
 * @returns {number} - Qualité SM-2
 */
export function responseToQuality(response) {
  if (typeof response === 'boolean') return response ? 4 : 1;
  const map = { again: 1, hard: 3, good: 4, easy: 5 };
  return map[response] ?? 4;
}

/**
 * Calcule l'intervalle prévu pour chaque niveau de réponse (affiché sur les boutons)
 * @param {Object} card - La carte avec ses données SR
 * @returns {{ again: number, hard: number, good: number, easy: number }}
 */
export function previewIntervals(card) {
  const result = {};
  for (const level of ['again', 'hard', 'good', 'easy']) {
    const q = responseToQuality(level);
    const { interval } = calculateNextReview(card, q);
    result[level] = interval;
  }
  return result;
}

/**
 * Vérifie si une carte est due pour révision
 * @param {Object} card - La carte à vérifier
 * @returns {boolean}
 */
export function isCardDue(card) {
  if (!card.nextReviewAt) return true;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return new Date(card.nextReviewAt) <= now;
}

/**
 * Récupère les cartes dues pour un fichier
 * @param {string} filePath - Chemin du fichier
 * @returns {Array} - Cartes dues pour révision
 */
export function getDueCards(filePath) {
  const data = storage.getRaw(`flashcards-${filePath}`, null);
  if (!data) return [];

  const { flashcards = [] } = data;
  return flashcards.filter(isCardDue);
}

/**
 * Compte les cartes dues pour un fichier
 * @param {string} filePath - Chemin du fichier
 * @returns {number}
 */
export function getDueCount(filePath) {
  return getDueCards(filePath).length;
}

/**
 * Récupère tous les documents avec des cartes à réviser
 * @returns {Array} - [{filePath, fileName, dueCount, totalCards}]
 */
export function getAllDueDocuments() {
  const documents = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith('flashcards-')) {
      const filePath = key.replace('flashcards-', '');
      const data = storage.getRaw(key, null);
      if (!data) continue;

      const flashcards = data.flashcards || [];
      const dueCards = flashcards.filter(isCardDue);

      if (dueCards.length > 0) {
        // Extraire le nom du fichier du chemin
        const fileName = filePath.split('/').pop().replace('.md', '');
        documents.push({
          filePath,
          fileName,
          dueCount: dueCards.length,
          totalCards: flashcards.length
        });
      }
    }
  }

  // Trier par nombre de cartes dues (décroissant)
  return documents.sort((a, b) => b.dueCount - a.dueCount);
}

/**
 * Récupère toutes les cartes dues de tous les documents pour une session cross-docs
 * @returns {Array} - [{ ...card, _filePath, _cardIndex }]
 */
export function getAllDueCards() {
  const allCards = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith('flashcards-')) {
      const filePath = key.replace('flashcards-', '');
      const data = storage.getRaw(key, null);
      if (!data?.flashcards) continue;
      data.flashcards.forEach((card, idx) => {
        if (isCardDue(card)) {
          allCards.push({ ...card, _filePath: filePath, _cardIndex: idx });
        }
      });
    }
  }
  // Mélanger pour varier les documents
  for (let i = allCards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allCards[i], allCards[j]] = [allCards[j], allCards[i]];
  }
  return allCards;
}

/**
 * Compte le total de cartes dues tous documents confondus
 * @returns {number}
 */
export function getTotalDueCount() {
  return getAllDueDocuments().reduce((sum, doc) => sum + doc.dueCount, 0);
}

/**
 * Initialise les champs SR pour une nouvelle carte
 * @param {Object} card - Carte sans données SR
 * @returns {Object} - Carte avec données SR initialisées
 */
export function initializeCardSR(card) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  return {
    ...card,
    repetitions: 0,
    easeFactor: 2.5,
    interval: 1,
    lastReviewedAt: null,
    nextReviewAt: tomorrow.toISOString()
  };
}

/**
 * Formate l'intervalle en texte lisible
 * @param {number} interval - Intervalle en jours
 * @returns {string}
 */
/**
 * Calcule le score de maîtrise (0-100) pour un fichier
 * @param {string} filePath - Chemin du fichier
 * @returns {number|null} - Score 0-100, ou null si pas de flashcards
 */
export function getMasteryScore(filePath) {
  const data = storage.getRaw(`flashcards-${filePath}`, null);
  if (!data) return null;

  const { flashcards = [] } = data;
  if (flashcards.length === 0) return null;

  let totalWeightedScore = 0;
  let totalWeight = 0;

  for (const card of flashcards) {
    const reps = card.repetitions || 0;
    const ease = card.easeFactor || 2.5;
    const cardScore = Math.min(reps / 3, 1);
    // Poids inversé par easeFactor : cartes faciles pèsent moins
    const weight = 1 / ease;
    totalWeightedScore += cardScore * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) return 0;
  return Math.round((totalWeightedScore / totalWeight) * 100);
}

export function formatInterval(interval) {
  if (interval === 1) return 'demain';
  if (interval < 7) return `dans ${interval} jours`;
  if (interval < 14) return 'dans 1 semaine';
  if (interval < 30) return `dans ${Math.round(interval / 7)} semaines`;
  if (interval < 60) return 'dans 1 mois';
  return `dans ${Math.round(interval / 30)} mois`;
}

/**
 * Format court pour les boutons (ex: "1d", "3d", "1w", "2mo")
 * @param {number} interval - Intervalle en jours
 * @returns {string}
 */
export function formatIntervalShort(interval) {
  if (interval < 1) return '<1d';
  if (interval === 1) return '1d';
  if (interval < 7) return `${interval}d`;
  if (interval < 30) return `${Math.round(interval / 7)}w`;
  if (interval < 365) return `${Math.round(interval / 30)}mo`;
  return `${Math.round(interval / 365)}y`;
}
