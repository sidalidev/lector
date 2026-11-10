// Diagrammes mermaid d'une note. Ce module (et mermaid avec lui) n'est chargé
// que si la note affichée contient un bloc ```mermaid (DocumentView).
import { useState, useEffect, useRef, useCallback } from 'react';
import mermaid from 'mermaid';
import { AlertTriangle, Maximize2, LocateFixed } from 'lucide-react';
import { t } from '../services/i18n';
import FullscreenOverlay from './FullscreenOverlay';


// Mermaid aux couleurs de la charte, clair ou sombre selon le système, à plat.
// 'strict' : liens assainis (jamais de javascript:), SVG passé à DOMPurify,
// aucun rappel « click » branché sur le document.
const PALETTES_MERMAID = {
  light: { bg: '#FBF7EF', node: '#F4E3C3', border: '#B9771C', text: '#1F2A22', line: '#5F6E64', alt: '#F3EDE1', note: '#FFFDF8' },
  dark: { bg: '#12201A', node: '#2A3524', border: '#E9A23B', text: '#F3EEE3', line: '#9FB3A8', alt: '#1C2E26', note: '#1C2E26' },
};
let schemaMermaid = null;
function configurerMermaid() {
  const sombre = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  const schema = sombre ? 'dark' : 'light';
  if (schema === schemaMermaid) return;
  schemaMermaid = schema;
  const c = PALETTES_MERMAID[schema];
  mermaid.initialize({
    startOnLoad: false,
    theme: 'base',
    darkMode: sombre,
    securityLevel: 'strict',
    fontFamily: "'Figtree', system-ui, sans-serif",
    fontSize: 13,
    themeVariables: {
      background: c.bg,
      primaryColor: c.node,
      primaryBorderColor: c.border,
      primaryTextColor: c.text,
      secondaryColor: c.alt,
      secondaryBorderColor: c.line,
      secondaryTextColor: c.text,
      tertiaryColor: c.note,
      tertiaryBorderColor: c.line,
      tertiaryTextColor: c.text,
      lineColor: c.line,
      textColor: c.text,
      mainBkg: c.node,
      nodeBorder: c.border,
      clusterBkg: c.alt,
      clusterBorder: c.line,
      edgeLabelBackground: c.bg,
      noteBkgColor: c.note,
      noteBorderColor: c.line,
      noteTextColor: c.text,
      actorBkg: c.node,
      actorBorder: c.border,
      actorTextColor: c.text,
      signalColor: c.text,
      signalTextColor: c.text,
      labelBoxBkgColor: c.node,
      labelBoxBorderColor: c.border,
      labelTextColor: c.text,
    },
    flowchart: {
      nodeSpacing: 30,
      rankSpacing: 40,
      padding: 10,
      useMaxWidth: true,
      htmlLabels: true,
      curve: 'basis',
    },
    sequence: {
      useMaxWidth: true,
      boxMargin: 6,
      noteMargin: 8,
    },
  });
}
configurerMermaid();

// Reset mermaid state for hot reload
if (import.meta.hot) {
  import.meta.hot.accept();
}


// Un lien de diagramme (click ... href) s'ouvre à part, dans le navigateur
// système sur ordinateur, jamais à la place de Lector. Vrai si le clic visait un lien.
function ouvrirLienDiagramme(e) {
  const lien = e.target.closest?.('a');
  if (!lien) return false;
  e.preventDefault();
  const href = lien.getAttribute('href') || lien.getAttribute('xlink:href') || '';
  if (/^https?:\/\//i.test(href)) window.open(href, '_blank', 'noopener,noreferrer');
  return true;
}

// Plein écran : déplacer au doigt ou à la souris, zoomer à la molette ou en
// pinçant. Quelques lignes de pointeurs, sans bibliothèque de zoom.
function MermaidFullscreen({ svg, onClose }) {
  const containerRef = useRef(null);
  const wrapperRef = useRef(null);
  const vue = useRef({ x: 0, y: 0, k: 1 });

  const appliquer = useCallback((anime = false) => {
    const w = wrapperRef.current;
    if (!w) return;
    const { x, y, k } = vue.current;
    w.style.transition = anime ? 'transform 0.3s ease' : 'none';
    w.style.transform = `translate(${x}px, ${y}px) scale(${k})`;
  }, []);

  const recenter = useCallback(() => {
    const container = containerRef.current;
    const svgEl = wrapperRef.current?.querySelector('svg');
    if (!container || !svgEl) return;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    // Taille du dessin sans le zoom courant.
    const rect = svgEl.getBoundingClientRect();
    const sw = rect.width / vue.current.k;
    const sh = rect.height / vue.current.k;
    if (!sw || !sh) return;
    const pad = 60;
    const k = Math.min(cw / (sw + pad), ch / (sh + pad), 2.5);
    vue.current = { x: (cw - sw * k) / 2, y: (ch - sh * k) / 2, k };
    appliquer(true);
  }, [appliquer]);

  useEffect(() => {
    const container = containerRef.current;
    const svgEl = wrapperRef.current?.querySelector('svg');
    if (!container || !svgEl) return undefined;
    svgEl.style.maxWidth = 'none';
    svgEl.removeAttribute('width');
    svgEl.style.width = 'auto';
    svgEl.style.height = 'auto';

    const zoomer = (facteur, cx, cy) => {
      const { x, y, k } = vue.current;
      const nk = Math.min(10, Math.max(0.1, k * facteur));
      const f = nk / k;
      vue.current = { x: cx - (cx - x) * f, y: cy - (cy - y) * f, k: nk };
      appliquer();
    };
    const roulette = (e) => {
      e.preventDefault();
      const r = container.getBoundingClientRect();
      zoomer(Math.exp(-e.deltaY * 0.002), e.clientX - r.left, e.clientY - r.top);
    };

    const pointeurs = new Map();
    let ecart = 0;
    const distance = () => {
      const [a, b] = [...pointeurs.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    const bas = (e) => {
      container.setPointerCapture?.(e.pointerId);
      pointeurs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointeurs.size === 2) ecart = distance();
    };
    const bouge = (e) => {
      const avant = pointeurs.get(e.pointerId);
      if (!avant) return;
      const apres = { x: e.clientX, y: e.clientY };
      pointeurs.set(e.pointerId, apres);
      if (pointeurs.size === 1) {
        vue.current.x += apres.x - avant.x;
        vue.current.y += apres.y - avant.y;
        appliquer();
      } else if (pointeurs.size === 2 && ecart) {
        const d = distance();
        const [a, b] = [...pointeurs.values()];
        const r = container.getBoundingClientRect();
        zoomer(d / ecart, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
        ecart = d;
      }
    };
    const haut = (e) => { pointeurs.delete(e.pointerId); ecart = 0; };

    container.addEventListener('wheel', roulette, { passive: false });
    container.addEventListener('pointerdown', bas);
    container.addEventListener('pointermove', bouge);
    container.addEventListener('pointerup', haut);
    container.addEventListener('pointercancel', haut);
    const minuteur = setTimeout(recenter, 100);
    return () => {
      clearTimeout(minuteur);
      container.removeEventListener('wheel', roulette);
      container.removeEventListener('pointerdown', bas);
      container.removeEventListener('pointermove', bouge);
      container.removeEventListener('pointerup', haut);
      container.removeEventListener('pointercancel', haut);
    };
  }, [svg, recenter, appliquer]);

  return (
    <FullscreenOverlay onClose={onClose}>
      <button className="fullscreen-overlay-recenter" onClick={recenter} title={t('diagram.recenter')}>
        <LocateFixed size={18} />
      </button>
      <div className="mermaid-overlay-viewport" ref={containerRef} style={{ touchAction: 'none' }}>
        <div className="mermaid-fs-wrapper" ref={wrapperRef} style={{ transformOrigin: '0 0' }} onClick={ouvrirLienDiagramme} dangerouslySetInnerHTML={{ __html: svg }} />
      </div>
    </FullscreenOverlay>
  );
}

// Mermaid Block Component
// Suit le thème clair ou sombre du système pour redessiner les diagrammes.
function useSchemaSombre() {
  const requete = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-color-scheme: dark)') : null;
  const [sombre, setSombre] = useState(() => !!requete?.matches);
  useEffect(() => {
    if (!requete) return undefined;
    const suivre = (e) => setSombre(e.matches);
    requete.addEventListener?.('change', suivre);
    return () => requete.removeEventListener?.('change', suivre);
  }, [requete]);
  return sombre;
}

export default function MermaidBlock({ code }) {
  const sombre = useSchemaSombre();
  const containerRef = useRef(null);
  const [svg, setSvg] = useState('');
  const [error, setError] = useState(null);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const renderDiagram = async () => {
      const uniqueId = `mermaid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      try {
        configurerMermaid();
        const result = await mermaid.render(uniqueId, code);
        setSvg(result.svg);
        setError(null);
      } catch (err) {
        console.error('Mermaid render error:', err);
        setError(err.message || t('diagram.renderError'));
      }
    };

    if (code) {
      renderDiagram();
    }
  }, [code, sombre]);

  if (error) {
    return (
      <div className="mermaid-block mermaid-error">
        <div className="mermaid-error-header">
          <AlertTriangle size={16} />
          <span>{t('diagram.mermaidError')}</span>
        </div>
        <pre className="mermaid-error-code">{code}</pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="mermaid-block mermaid-loading">
        <div className="mermaid-loading-text">{t('diagram.loadingDiagram')}</div>
      </div>
    );
  }

  return (
    <>
      <div className="mermaid-block" ref={containerRef} onClick={(e) => { if (!ouvrirLienDiagramme(e)) setFullscreen(true); }} style={{ cursor: 'pointer' }}>
        <div className="mermaid-svg" dangerouslySetInnerHTML={{ __html: svg }} />
        <button className="mermaid-expand-btn" onClick={(e) => { e.stopPropagation(); setFullscreen(true); }} title={t('diagram.expandDiagram')}>
          <Maximize2 size={14} />
        </button>
      </div>
      {fullscreen && <MermaidFullscreen svg={svg} onClose={() => setFullscreen(false)} />}
    </>
  );
}
