import { useEffect, useRef, useState } from 'react';
import './AutoScroll.css';
import { t } from '../services/i18n'

function AutoScroll({ enabled, onClose, speed, setSpeed }) {
  const [isPaused, setIsPaused] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const animationRef = useRef(null);
  const lastTimeRef = useRef(null);

  // Calcul du temps restant estimé
  useEffect(() => {
    const updateTimeRemaining = () => {
      const docView = document.querySelector('.document-view');
      if (!docView) return;

      const remaining = docView.scrollHeight - docView.clientHeight - docView.scrollTop;
      const seconds = remaining / speed;
      setTimeRemaining(Math.ceil(seconds));
    };

    updateTimeRemaining();
    const interval = setInterval(updateTimeRemaining, 1000);
    return () => clearInterval(interval);
  }, [speed]);

  // Logique de scroll avec requestAnimationFrame
  useEffect(() => {
    if (!enabled || isPaused) {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      return;
    }

    lastTimeRef.current = performance.now();

    const scroll = (currentTime) => {
      const delta = (currentTime - lastTimeRef.current) / 1000;
      lastTimeRef.current = currentTime;

      const docView = document.querySelector('.document-view');
      if (docView) {
        docView.scrollTop += speed * delta;

        // Mettre à jour le highlight
        updateHighlight(docView);

        // Stop si fin de document
        if (docView.scrollTop >= docView.scrollHeight - docView.clientHeight - 1) {
          onClose();
          return;
        }
      }

      animationRef.current = requestAnimationFrame(scroll);
    };

    animationRef.current = requestAnimationFrame(scroll);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [enabled, isPaused, speed, onClose]);

  // Ajouter/retirer la classe autoscroll-mode sur le document-content
  useEffect(() => {
    const docContent = document.querySelector('.document-content');
    if (enabled && docContent) {
      docContent.classList.add('autoscroll-mode');
    }
    return () => {
      if (docContent) {
        docContent.classList.remove('autoscroll-mode');
        // Nettoyer les highlights
        docContent.querySelectorAll('.reading-active').forEach(el => {
          el.classList.remove('reading-active');
        });
      }
    };
  }, [enabled]);

  // Highlight du paragraphe actif
  const updateHighlight = (docView) => {
    const paragraphs = docView.querySelectorAll('.document-content p, .document-content li, .document-content h1, .document-content h2, .document-content h3, .document-content h4, .document-content h5, .document-content h6');
    const docRect = docView.getBoundingClientRect();
    const viewportCenter = docRect.top + docView.clientHeight / 3; // Tiers supérieur

    let closestElement = null;
    let closestDistance = Infinity;

    paragraphs.forEach(p => {
      p.classList.remove('reading-active');
      const rect = p.getBoundingClientRect();
      const elementCenter = rect.top + rect.height / 2;
      const distance = Math.abs(elementCenter - viewportCenter);

      if (distance < closestDistance && rect.top > docRect.top - 50) {
        closestDistance = distance;
        closestElement = p;
      }
    });

    if (closestElement) {
      closestElement.classList.add('reading-active');
    }
  };

  // Raccourcis clavier
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!enabled) return;

      // Space pour pause/play
      if (e.code === 'Space' && e.target.tagName !== 'INPUT') {
        e.preventDefault();
        setIsPaused(prev => !prev);
      }

      // + et - pour vitesse
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        setSpeed(prev => Math.min(prev + 10, 150));
      }
      if (e.key === '-') {
        e.preventDefault();
        setSpeed(prev => Math.max(prev - 10, 20));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, setSpeed]);

  // Formater le temps restant
  const formatTime = (seconds) => {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  // Convertir speed en multiplicateur lisible
  const getSpeedLabel = () => {
    const base = 50;
    const mult = speed / base;
    return `${mult.toFixed(1)}x`;
  };

  if (!enabled) return null;

  return (
    <div className="autoscroll-control">
      <button
        className="autoscroll-btn play-pause"
        onClick={() => setIsPaused(!isPaused)}
        title={isPaused ? t('autoscroll.resume') : t('autoscroll.pause')}
      >
        {isPaused ? '▶' : '⏸'}
      </button>

      <div className="autoscroll-slider-container">
        <input
          type="range"
          className="autoscroll-slider"
          min="20"
          max="150"
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          title={t('autoscroll.speed')}
        />
      </div>

      <span className="autoscroll-speed">{getSpeedLabel()}</span>

      <span className="autoscroll-time">~{formatTime(timeRemaining)}</span>

      <button
        className="autoscroll-btn close"
        onClick={onClose}
        title={t('autoscroll.close')}
      >
        ✕
      </button>
    </div>
  );
}

export default AutoScroll;
