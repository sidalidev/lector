import { useState, useEffect, useCallback } from 'react';
import {
  X,
  AlertTriangle,
  RefreshCw,
  Check,
  XCircle,
  RotateCcw,
  Sparkles,
  GraduationCap,
  Zap,
  Lightbulb
} from 'lucide-react';
import { checkClaudeStatus, generateFlashcards as claudeGenerateFlashcards } from '../services/claude';
import {
  initializeCardSR,
} from '../services/spacedRepetition';
import { checkCache, setCache } from '../services/aiCache';
import syncService from '../services/syncService';
import storage from '../services/storage';
import { messageCle } from '../utils/messagesErreur';
import { persistToFile } from '../services/docPersist';
import useQuizEngine from '../hooks/useQuizEngine';
import QualityButtons from './QualityButtons';
import './Flashcards.css';
import { t } from '../services/i18n'

function Flashcards({ content, filePath, onClose, dueCards }) {
  // Mode cross-docs : cartes pré-chargées depuis tous les documents
  const isCrossDoc = !!dueCards?.length;

  // Charger les flashcards du cache synchronement pour éviter le flash blanc
  const cachedData = !isCrossDoc ? storage.getRaw(`flashcards-${filePath}`, null) : null;
  const hasCached = cachedData?.flashcards?.length > 0;

  const [status, setStatus] = useState(isCrossDoc || hasCached ? 'ready' : 'loading');
  const [flashcards, setFlashcards] = useState(isCrossDoc ? dueCards : (hasCached ? cachedData.flashcards : []));
  const [errorMessage, setErrorMessage] = useState('');
  const [cramMode, setCramMode] = useState(false);
  const [mnemonicLoading, setMnemonicLoading] = useState(false);

  // Utiliser le hook quiz engine pour score, navigation, keyboard, SR
  const {
    currentIndex,
    showAnswer,
    score,
    done,
    currentCard,
    handleAnswer,
    restart,
    reveal,
  } = useQuizEngine({
    items: flashcards,
    cards: flashcards,
    setCards: setFlashcards,
    onSave: (updatedCards, cardIndex) => {
      if (isCrossDoc) {
        // Mode cross-docs : sauvegarder dans le fichier d'origine de la carte
        const card = updatedCards[cardIndex];
        if (card?._filePath) {
          const saved = storage.getRaw(`flashcards-${card._filePath}`, null);
          if (saved?.flashcards && card._cardIndex != null) {
            saved.flashcards[card._cardIndex] = { ...saved.flashcards[card._cardIndex], ...card };
            storage.setRaw(`flashcards-${card._filePath}`, saved);
            persistToFile(card._filePath);
          }
        }
      } else {
        const saved = storage.getRaw(`flashcards-${filePath}`, null);
        if (saved) {
          saved.flashcards = updatedCards;
          storage.setRaw(`flashcards-${filePath}`, saved);
          syncService.markDirty(filePath);
          persistToFile(filePath);
        }
      }
    },
    onClose,
    trackType: 'card',
    skipSR: cramMode,
  });

  // Générer un mnémonique IA pour la carte courante
  const generateMnemonic = useCallback(async () => {
    if (!currentCard || mnemonicLoading) return;
    if (currentCard.mnemonic) return;
    setMnemonicLoading(true);
    try {
      const prompt = `Crée un aide-mémoire court et mémorable (mnémonique, acronyme, association visuelle, ou histoire absurde) pour retenir cette info.

Question: ${currentCard.question}
Réponse: ${currentCard.answer}

Réponds UNIQUEMENT avec le mnémonique (1-2 phrases max, pas d'explication).`;
      const result = await window.electron?.claudePrompt?.(prompt);
      if (result?.success && result.result) {
        const updatedFlashcards = [...flashcards];
        updatedFlashcards[currentIndex] = { ...currentCard, mnemonic: result.result.trim() };
        setFlashcards(updatedFlashcards);
        const saved = storage.getRaw(`flashcards-${filePath}`, null);
        if (saved) {
          saved.flashcards = updatedFlashcards;
          storage.setRaw(`flashcards-${filePath}`, saved);
          persistToFile(filePath);
        }
      }
    } catch (err) {
      console.warn('[Flashcards] Mnemonic generation failed:', err);
    } finally {
      setMnemonicLoading(false);
    }
  }, [currentCard, currentIndex, flashcards, filePath, mnemonicLoading]);

  // Mettre à jour le status quand le quiz est terminé
  useEffect(() => {
    if (done && status === 'ready') setStatus('reviewing');
  }, [done, status]);

  // Load saved flashcards or generate new ones (with smart cache)
  useEffect(() => {
    const loadOrGenerate = async () => {
      // Check smart cache - ne regénère que si contenu changé significativement
      const cacheResult = checkCache(filePath + '-flashcards', content);

      // Try to load from localStorage first (for SR progress)
      const saved = storage.getRaw(`flashcards-${filePath}`, null);
      if (saved && cacheResult.valid) {
        if (saved.flashcards?.length > 0) {
          setFlashcards(saved.flashcards);
          setStatus('ready');
          return;
        }
      }

      // Check Claude availability
      setStatus('loading');
      const claudeStatus = await checkClaudeStatus();

      if (!claudeStatus.available) {
        setErrorMessage(t('flash.claudeUnavailable'));
        setStatus('error');
        return;
      }

      // Generate flashcards
      setStatus('generating');
      const result = await claudeGenerateFlashcards(content, 10);

      if (result.success && result.flashcards.length > 0) {
        // Initialiser les champs SR pour chaque carte
        const cardsWithSR = result.flashcards.map(initializeCardSR);
        setFlashcards(cardsWithSR);
        // Save to localStorage
        storage.setRaw(`flashcards-${filePath}`, {
          flashcards: cardsWithSR,
          score: { correct: 0, incorrect: 0 },
          generatedAt: new Date().toISOString()
        });
        // Save to smart cache
        setCache(filePath + '-flashcards', content, { generated: true });
        syncService.markDirty(filePath);
        setStatus('ready');
      } else {
        setErrorMessage(result.code ? messageCle(result.code) : (result.error || t('flash.generationError')));
        setStatus('error');
      }
    };

    loadOrGenerate();
  }, [content, filePath]);

  // Save score to localStorage
  useEffect(() => {
    if (flashcards.length > 0 && filePath) {
      const saved = storage.getRaw(`flashcards-${filePath}`, null);
      if (saved) {
        saved.score = score;
        storage.setRaw(`flashcards-${filePath}`, saved);
      }
    }
  }, [score, filePath, flashcards.length]);

  const regenerateFlashcards = async () => {
    storage.removeRaw(`flashcards-${filePath}`);
    setFlashcards([]);
    restart();

    setStatus('loading');
    const claudeStatus = await checkClaudeStatus();
    if (!claudeStatus.available) {
      setErrorMessage(t('flash.claudeShort'));
      setStatus('error');
      return;
    }

    setStatus('generating');
    const result = await claudeGenerateFlashcards(content, 10);

    if (result.success && result.flashcards.length > 0) {
      const cardsWithSR = result.flashcards.map(initializeCardSR);
      setFlashcards(cardsWithSR);
      storage.setRaw(`flashcards-${filePath}`, {
        flashcards: cardsWithSR,
        score: { correct: 0, incorrect: 0 },
        generatedAt: new Date().toISOString()
      });
      syncService.markDirty(filePath);
      setStatus('ready');
    } else {
      setErrorMessage(result.code ? messageCle(result.code) : (result.error || t('flash.generationError')));
      setStatus('error');
    }
  };

  const getDifficultyColor = (difficulty) => {
    switch (difficulty) {
      case 'easy': return 'var(--success)';
      case 'medium': return 'var(--accent-icon)';
      case 'hard': return 'var(--danger)';
      default: return 'var(--text-muted)';
    }
  };

  const getDifficultyLabel = (difficulty) => {
    switch (difficulty) {
      case 'easy': return t('flash.easy');
      case 'medium': return t('flash.medium');
      case 'hard': return t('flash.hard');
      default: return difficulty;
    }
  };

  const resetAndRestart = () => {
    restart();
    setStatus('ready');
  };

  return (
    <div className="flashcards-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Flashcards">
      <div className="flashcards-modal" onClick={e => e.stopPropagation()}>
        <div className="flashcards-header">
          <h2><GraduationCap size={22} /> Flashcards</h2>
          <div className="flashcards-header-actions">
            <button
              className={`flashcards-cram-toggle ${cramMode ? 'active' : ''}`}
              onClick={() => setCramMode(prev => !prev)}
              title={cramMode ? t('flash.cramOn') : t('flash.cram')}
            >
              <Zap size={16} /> {t('flash.cramMode')}
            </button>
            <button className="flashcards-close" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Loading state */}
        {status === 'loading' && (
          <div className="flashcards-loading">
            <div className="flashcards-spinner" />
            <p>{t('flash.checkingClaude')}</p>
          </div>
        )}

        {/* Generating state */}
        {status === 'generating' && (
          <div className="flashcards-loading">
            <div className="flashcards-spinner" />
            <p>{t('flash.claudeGenerating')}</p>
            <p className="flashcards-hint">{t('flash.generatingHint')}</p>
          </div>
        )}

        {/* Error state */}
        {status === 'error' && (
          <div className="flashcards-error">
            <AlertTriangle size={48} className="flashcards-error-icon" />
            <p>{errorMessage}</p>
            <button className="flashcards-retry" onClick={regenerateFlashcards}>
              <RefreshCw size={16} /> {t('flash.retry')}
            </button>
          </div>
        )}

        {/* Ready state - Quiz mode */}
        {status === 'ready' && currentCard && (
          <>
            {/* Progress */}
            <div className="flashcards-progress">
              <div className="flashcards-progress-bar">
                <div
                  className="flashcards-progress-fill"
                  style={{ width: `${((currentIndex + 1) / flashcards.length) * 100}%` }}
                />
              </div>
              <span className="flashcards-progress-text">
                {currentIndex + 1} / {flashcards.length}
              </span>
            </div>

            {/* Score */}
            <div className="flashcards-score">
              <span className="score-correct"><Check size={14} /> {score.correct}</span>
              <span className="score-incorrect"><XCircle size={14} /> {score.incorrect}</span>
            </div>

            {/* Card: reveal style (pas de flip 3D) */}
            <div className="flashcard" onClick={!showAnswer ? reveal : undefined}>
              <span
                className="flashcard-difficulty"
                style={{ backgroundColor: getDifficultyColor(currentCard.difficulty) }}
              >
                {getDifficultyLabel(currentCard.difficulty)}
              </span>
              <p className="flashcard-question">{currentCard.question}</p>
              {!showAnswer && (
                <button className="flashcard-reveal-btn" onClick={reveal}>
                  {t('flash.clickOrSpace')} <kbd>Space</kbd>
                </button>
              )}
              {showAnswer && (
                <div className="flashcard-answer-reveal">
                  <p className="flashcard-answer">{currentCard.answer}</p>
                  {/* Mnémonique: aide-mémoire */}
                  {currentCard.mnemonic ? (
                    <div className="flashcard-mnemonic">
                      <Lightbulb size={14} />
                      <span>{currentCard.mnemonic}</span>
                    </div>
                  ) : (
                    <button
                      className="flashcard-mnemonic-btn"
                      onClick={(e) => { e.stopPropagation(); generateMnemonic(); }}
                      disabled={mnemonicLoading}
                    >
                      <Lightbulb size={14} />
                      {mnemonicLoading ? t('flash.mnemonicLoading') : t('flash.mnemonicGenerate')}
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Answer buttons: composant partagé */}
            {showAnswer && (
              <QualityButtons
                card={currentCard}
                onAnswer={handleAnswer}
                hideIntervals={cramMode}
              />
            )}

            {/* Regenerate button */}
            <button className="flashcards-regenerate" onClick={regenerateFlashcards}>
              <RefreshCw size={14} /> {t('flash.regenerate')}
            </button>
          </>
        )}

        {/* Review complete state */}
        {status === 'reviewing' && (
          <div className="flashcards-complete">
            <Sparkles size={56} className="flashcards-complete-icon" />
            <h3>{t('flash.quizComplete')}</h3>
            <div className="flashcards-final-score">
              <div className="final-score-item correct">
                <span className="final-score-number">{score.correct}</span>
                <span className="final-score-label">{t('flash.correct')}</span>
              </div>
              <div className="final-score-item incorrect">
                <span className="final-score-number">{score.incorrect}</span>
                <span className="final-score-label">{t('flash.toReview')}</span>
              </div>
            </div>
            <div className="flashcards-complete-percent">
              {t('flash.successRate', { percent: Math.round((score.correct / flashcards.length) * 100) })}
            </div>
            <div className="flashcards-complete-actions">
              <button className="flashcards-restart" onClick={resetAndRestart}>
                <RotateCcw size={16} /> {t('flash.restart')}
              </button>
              <button className="flashcards-regenerate-alt" onClick={regenerateFlashcards}>
                <RefreshCw size={16} /> {t('flash.newCards')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default Flashcards;
