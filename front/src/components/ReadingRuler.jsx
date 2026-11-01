import { useRef, useEffect, useCallback } from 'react';
import './ReadingRuler.css';

function ReadingRuler() {
  const yRef = useRef(0);
  const rafRef = useRef(null);
  const containerRef = useRef(null);
  const rulerRef = useRef(null);
  const topRef = useRef(null);
  const bottomRef = useRef(null);
  const isTouchRef = useRef(false);

  const updatePosition = useCallback(() => {
    rafRef.current = null;
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const relY = yRef.current - rect.top;

    const visible = relY >= 0 && relY <= rect.height;
    container.style.opacity = visible ? '1' : '0';
    if (!visible) return;

    if (rulerRef.current) {
      rulerRef.current.style.transform = `translate3d(0,${relY}px,0)`;
    }
    if (topRef.current) {
      topRef.current.style.height = `${Math.max(0, relY - 30)}px`;
    }
    if (bottomRef.current) {
      bottomRef.current.style.transform = `translate3d(0,${relY + 30}px,0)`;
    }
  }, []);

  const scheduleUpdate = useCallback((clientY) => {
    yRef.current = clientY;
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(updatePosition);
    }
  }, [updatePosition]);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (isTouchRef.current) return; // ignore fake mouse events on touch
      scheduleUpdate(e.clientY);
    };

    // On touch devices, position ruler at center of viewport
    // and update on scroll instead of touchmove (avoids scroll interference)
    const handleTouchStart = () => {
      isTouchRef.current = true;
      const viewportCenter = window.innerHeight * 0.4;
      scheduleUpdate(viewportCenter);
    };

    const handleScroll = () => {
      if (!isTouchRef.current) return;
      const viewportCenter = window.innerHeight * 0.4;
      scheduleUpdate(viewportCenter);
    };

    const docView = document.querySelector('.document-view');

    window.document.addEventListener('mousemove', handleMouseMove, { passive: true });
    window.document.addEventListener('touchstart', handleTouchStart, { passive: true, once: true });
    if (docView) {
      docView.addEventListener('scroll', handleScroll, { passive: true });
    }

    return () => {
      window.document.removeEventListener('mousemove', handleMouseMove);
      window.document.removeEventListener('touchstart', handleTouchStart);
      if (docView) docView.removeEventListener('scroll', handleScroll);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [scheduleUpdate]);

  return (
    <div ref={containerRef} className="reading-ruler-container">
      <div ref={rulerRef} className="reading-ruler" />
      <div ref={topRef} className="reading-ruler-overlay-top" />
      <div ref={bottomRef} className="reading-ruler-overlay-bottom" />
    </div>
  );
}

export default ReadingRuler;
