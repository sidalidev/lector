import { useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import { t } from '../services/i18n';
import './FullscreenOverlay.css';

export default function FullscreenOverlay({ onClose, children, className }) {
  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleBackdrop = useCallback((e) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  return (
    <div className="fullscreen-overlay" onClick={handleBackdrop}>
      <div className={`fullscreen-overlay-content ${className || ''}`} onClick={(e) => e.stopPropagation()}>
        <button className="fullscreen-overlay-close" onClick={onClose} title={t('fullscreen.close')}>
          <X size={18} />
        </button>
        {children}
      </div>
    </div>
  );
}
