import { useEffect, useRef } from 'react';
import './ProgressBar.css';

function ProgressBar() {
  const fillRef = useRef(null);

  useEffect(() => {
    const docView = document.querySelector('.document-view');
    if (!docView || !fillRef.current) return;

    const updateProgress = () => {
      const { scrollTop, scrollHeight, clientHeight } = docView;
      const progress = (scrollTop / (scrollHeight - clientHeight)) * 100;
      const clampedProgress = Math.min(100, Math.max(0, progress));

      // Direct DOM manipulation - no React re-render
      if (fillRef.current) {
        fillRef.current.style.transform = `scaleX(${clampedProgress / 100})`;
      }
    };

    docView.addEventListener('scroll', updateProgress, { passive: true });
    updateProgress(); // Initial

    return () => {
      docView.removeEventListener('scroll', updateProgress);
    };
  }, []);

  return (
    <div className="progress-bar-container">
      <div ref={fillRef} className="progress-bar-fill" />
    </div>
  );
}

export default ProgressBar;
