import { useState, useEffect, useRef, useCallback } from 'react';
import mermaid from 'mermaid';
import * as d3 from 'd3';
import { AlertTriangle, Music, Guitar, Maximize2, LocateFixed, Wind, Volume2, VolumeX, Minus, Plus, Play, Pause, Square } from 'lucide-react';
import { t } from '../services/i18n';
import {
  initGuitarAudio, isGuitarAudioReady, buildGuitarEvents, assignChordsToEvents,
  playGuitarSequence, stopGuitarPlayback, getGuitarProgress,
  getGuitarDuration, isGuitarPlaying, playChordStrum, playSingleGuitarEvent,
} from '../services/guitarAudio';
import FullscreenOverlay from './FullscreenOverlay';
import abcjs from 'abcjs';
import 'abcjs/abcjs-audio.css';


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

// Mermaid Fullscreen Overlay with D3 zoom/pan
function MermaidFullscreen({ svg, onClose }) {
  const containerRef = useRef(null);
  const zoomRef = useRef(null);

  const recenter = useCallback(() => {
    const container = containerRef.current;
    const wrapper = container?.querySelector('.mermaid-fs-wrapper');
    if (!container || !wrapper) return;

    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const svgEl = wrapper.querySelector('svg');
    if (!svgEl) return;

    const rect = svgEl.getBoundingClientRect();
    const sw = rect.width;
    const sh = rect.height;
    if (!sw || !sh) return;

    const pad = 60;
    const scale = Math.min(cw / (sw + pad), ch / (sh + pad), 2.5);
    const tx = (cw - sw * scale) / 2;
    const ty = (ch - sh * scale) / 2;

    if (zoomRef.current) {
      d3.select(container).transition().duration(300).call(
        zoomRef.current.transform,
        d3.zoomIdentity.translate(tx, ty).scale(scale)
      );
    }
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !svg) return;

    const wrapper = container.querySelector('.mermaid-fs-wrapper');

    const zoom = d3.zoom()
      .scaleExtent([0.1, 10])
      .on('zoom', (event) => {
        wrapper.style.transform = `translate(${event.transform.x}px, ${event.transform.y}px) scale(${event.transform.k})`;
      });

    zoomRef.current = zoom;
    d3.select(container).call(zoom);

    const svgEl = wrapper.querySelector('svg');
    if (svgEl) {
      svgEl.style.maxWidth = 'none';
      svgEl.removeAttribute('width');
      svgEl.style.width = 'auto';
      svgEl.style.height = 'auto';
    }

    setTimeout(() => recenter(), 100);
  }, [svg, recenter]);

  return (
    <FullscreenOverlay onClose={onClose}>
      <button className="fullscreen-overlay-recenter" onClick={recenter} title={t('diagram.recenter')}>
        <LocateFixed size={18} />
      </button>
      <div className="mermaid-overlay-viewport" ref={containerRef}>
        <div className="mermaid-fs-wrapper" style={{ transformOrigin: '0 0' }} onClick={ouvrirLienDiagramme} dangerouslySetInnerHTML={{ __html: svg }} />
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

export function MermaidBlock({ code }) {
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

// ===== Fingering Data & Charts for Wind Instruments =====

const TIN_WHISTLE_FINGERINGS = {
  'D4': [1,1,1,1,1,1], 'E4': [1,1,1,1,1,0], 'F4': [1,1,1,1,0,0], // F# in D whistle
  'G4': [1,1,1,0,0,0], 'A4': [1,1,0,0,0,0], 'B4': [1,0,0,0,0,0],
  'C5': [0,0,0,0,0,0], // C# in D whistle
  'D5': [0,1,1,1,1,1], 'E5': [0,1,1,1,1,0], 'F5': [0,1,1,1,0,0],
  'G5': [0,1,1,0,0,0], 'A5': [0,1,0,0,0,0], 'B5': [0,0,0,0,0,0],
  // Enharmonics / common aliases
  '^F4': [1,1,1,1,0,0], '^C5': [0,0,0,0,0,0], '^F5': [0,1,1,1,0,0],
};

const FLUTE_FINGERINGS = {
  // [thumb, LH1, LH2, LH3, RH1, RH2, RH3, RH4]
  'C4': [1,1,1,1,1,1,1,1], 'D4': [1,1,1,1,1,1,1,0],
  'E4': [1,1,1,1,1,1,0,0], 'F4': [1,1,1,1,1,0,0,0],
  'G4': [1,1,1,0,0,0,0,0], 'A4': [1,1,0,0,0,0,0,0],
  'B4': [1,0,0,0,0,0,0,0], 'C5': [0,1,0,0,0,0,0,0],
  'D5': [1,1,1,1,1,1,1,0], 'E5': [1,1,1,1,1,1,0,0],
  'F5': [1,1,1,1,1,0,0,0], 'G5': [1,1,1,0,0,0,0,0],
  'A5': [1,1,0,0,0,0,0,0], 'B5': [1,0,0,0,0,0,0,0],
  'C6': [0,1,0,0,0,0,0,0],
  // Sharps/flats
  '^C4': [1,1,1,1,1,1,1,1], '^D4': [1,1,1,1,1,1,0,0],
  '_B4': [1,0,1,1,0,0,0,0], '^F4': [1,1,1,1,0,1,0,0],
  '_E4': [1,1,1,1,1,1,0,1], '^G4': [1,1,0,1,0,0,0,0],
  '^F5': [1,1,1,1,0,1,0,0], '^G5': [1,1,0,1,0,0,0,0],
};

const GUITAR_CHORDS = {
  'C': { frets: [-1,3,2,0,1,0], baseFret: 1 },
  'C7': { frets: [-1,3,2,3,1,0], baseFret: 1 },
  'Cm': { frets: [-1,3,5,5,4,3], baseFret: 1 },
  'D': { frets: [-1,-1,0,2,3,2], baseFret: 1 },
  'D7': { frets: [-1,-1,0,2,1,2], baseFret: 1 },
  'E': { frets: [0,2,2,1,0,0], baseFret: 1 },
  'E7': { frets: [0,2,0,1,0,0], baseFret: 1 },
  'F': { frets: [1,3,3,2,1,1], baseFret: 1 },
  'F7': { frets: [1,3,1,2,1,1], baseFret: 1 },
  'Fm': { frets: [1,3,3,1,1,1], baseFret: 1 },
  'G': { frets: [3,2,0,0,0,3], baseFret: 1 },
  'G7': { frets: [3,2,0,0,0,1], baseFret: 1 },
  'A': { frets: [-1,0,2,2,2,0], baseFret: 1 },
  'B': { frets: [-1,2,4,4,4,2], baseFret: 1 },
  'B7': { frets: [-1,2,1,2,0,2], baseFret: 1 },
  'Am': { frets: [-1,0,2,2,1,0], baseFret: 1 },
  'Am7': { frets: [-1,0,2,0,1,0], baseFret: 1 },
  'Em': { frets: [0,2,2,0,0,0], baseFret: 1 },
  'Dm': { frets: [-1,-1,0,2,3,1], baseFret: 1 },
  'Dm7': { frets: [-1,-1,0,2,1,1], baseFret: 1 },
  'Bm': { frets: [-1,2,4,4,3,2], baseFret: 1 },
  'Gm': { frets: [3,5,5,3,3,3], baseFret: 1 },
  'Cm7': { frets: [-1,3,5,3,4,3], baseFret: 1 },
  'Em7': { frets: [0,2,2,0,3,0], baseFret: 1 },
  'A7': { frets: [-1,0,2,0,2,0], baseFret: 1 },
  'Dsus4': { frets: [-1,-1,0,2,3,3], baseFret: 1 },
  'Dsus2': { frets: [-1,-1,0,2,3,0], baseFret: 1 },
  'Asus2': { frets: [-1,0,2,2,0,0], baseFret: 1 },
  'Asus4': { frets: [-1,0,2,2,3,0], baseFret: 1 },
  'A7sus4': { frets: [-1,0,2,0,3,0], baseFret: 1 },
};

// Normalize ABC note names to standard pitch notation (e.g. "^f" → "F#5", "B," → "B3")
function abcNoteToStandard(abcNote) {
  if (!abcNote) return null;
  let note = abcNote.replace(/[^A-Ga-g,'^_=]/g, '');
  if (!note) return null;

  let accidental = '';
  if (note.startsWith('^')) { accidental = '#'; note = note.slice(1); }
  else if (note.startsWith('_')) { accidental = 'b'; note = note.slice(1); }
  else if (note.startsWith('=')) { note = note.slice(1); }

  if (!note) return null;
  const isLower = note[0] === note[0].toLowerCase() && note[0] !== note[0].toUpperCase();
  const baseNote = note[0].toUpperCase();
  const commas = (note.match(/,/g) || []).length;
  const apostrophes = (note.match(/'/g) || []).length;

  let octave = isLower ? 5 : 4;
  octave -= commas;
  octave += apostrophes;

  return baseNote + accidental + octave;
}

// Convert standard note to fingering lookup key
function noteToFingeringKey(standardNote, instrument) {
  if (!standardNote) return null;
  // Convert sharps to ^ prefix, flats to _ prefix for lookup
  const match = standardNote.match(/^([A-G])(#|b)?(\d)$/);
  if (!match) return null;
  const [, letter, acc, oct] = match;
  let prefix = '';
  if (acc === '#') prefix = '^';
  else if (acc === 'b') prefix = '_';
  return `${prefix}${letter}${oct}`;
}

// Tin Whistle SVG Fingering Chart
function TinWhistleChart({ note, fingeringKey }) {
  const fingering = TIN_WHISTLE_FINGERINGS[fingeringKey];
  const holeRadius = 8;
  const spacing = 28;
  const cx = 30;
  const startY = 24;
  const tubeWidth = 14;

  return (
    <svg width="60" height="210" viewBox="0 0 60 210" className="abc-fingering-svg">
      {/* Tube body */}
      <rect x={cx - tubeWidth/2} y={8} width={tubeWidth} height={190}
        rx="7" fill="var(--bg-secondary)" stroke="var(--border)" strokeWidth="1.5" />
      {/* Mouthpiece */}
      <rect x={cx - tubeWidth/2 - 2} y={4} width={tubeWidth + 4} height={14}
        rx="4" fill="var(--bg-secondary)" stroke="var(--border)" strokeWidth="1.5" />
      {/* Holes */}
      {[0,1,2,3,4,5].map(i => (
        <circle key={i} cx={cx} cy={startY + (i + 1) * spacing}
          r={holeRadius}
          fill={fingering && fingering[i] ? 'var(--text-primary)' : 'var(--bg-primary)'}
          stroke="var(--text-secondary)" strokeWidth="1.5"
        />
      ))}
      {/* Note label */}
      <text x={cx} y={205} textAnchor="middle" fontSize="11"
        fontFamily="var(--font-sans)" fill="var(--accent-text)" fontWeight="600">
        {note || '-'}
      </text>
    </svg>
  );
}

// Flute SVG Fingering Chart (horizontal)
function FluteChart({ note, fingeringKey }) {
  const fingering = FLUTE_FINGERINGS[fingeringKey];
  const keyRadius = 7;
  const startX = 40;
  const spacing = 30;
  const cy = 40;
  const tubeH = 12;

  const labels = ['P', '1', '2', '3', '1', '2', '3', '4'];
  const lhCount = 4; // thumb + 3 LH keys

  return (
    <svg width="310" height="85" viewBox="0 0 310 85" className="abc-fingering-svg">
      {/* Tube body */}
      <rect x={10} y={cy - tubeH/2} width={280} height={tubeH}
        rx="6" fill="var(--bg-secondary)" stroke="var(--border)" strokeWidth="1.5" />
      {/* Embouchure */}
      <ellipse cx={22} cy={cy} rx={6} ry={4}
        fill="var(--bg-primary)" stroke="var(--border)" strokeWidth="1" />
      {/* Keys */}
      {labels.map((label, i) => {
        const x = startX + i * spacing + (i >= lhCount ? 16 : 0);
        const isThumb = i === 0;
        const keyCy = isThumb ? cy + 16 : cy;
        return (
          <g key={i}>
            <circle cx={x} cy={keyCy} r={keyRadius}
              fill={fingering && fingering[i] ? 'var(--text-primary)' : 'var(--bg-primary)'}
              stroke="var(--text-secondary)" strokeWidth="1.5"
            />
            <text x={x} y={keyCy + keyRadius + 12} textAnchor="middle"
              fontSize="9" fill="var(--text-muted)" fontFamily="var(--font-sans)">
              {label}
            </text>
          </g>
        );
      })}
      {/* Hand separator */}
      <line x1={startX + lhCount * spacing + 4} y1={cy - 20}
        x2={startX + lhCount * spacing + 4} y2={cy + 32}
        stroke="var(--border)" strokeWidth="1" strokeDasharray="3,3" />
      {/* Hand labels */}
      <text x={startX + (lhCount - 1) * spacing / 2} y={14}
        textAnchor="middle" fontSize="9" fill="var(--text-muted)" fontFamily="var(--font-sans)">
        {t('diagram.leftHand')}
      </text>
      <text x={startX + lhCount * spacing + 16 + (3 * spacing) / 2} y={14}
        textAnchor="middle" fontSize="9" fill="var(--text-muted)" fontFamily="var(--font-sans)">
        {t('diagram.rightHand')}
      </text>
      {/* Note label */}
      <text x={295} y={cy + 4} textAnchor="end" fontSize="11"
        fontFamily="var(--font-sans)" fill="var(--accent-text)" fontWeight="600">
        {note || '-'}
      </text>
    </svg>
  );
}

// Guitar Chord Diagram: with optional play button and active highlight
function GuitarChordChart({ chordName, active, playable, program }) {
  const chord = GUITAR_CHORDS[chordName];
  if (!chord) return null;

  const { frets, baseFret } = chord;
  const stringSpacing = 14;
  const fretSpacing = 18;
  const startX = 20;
  const startY = 24;
  const numFrets = 5;
  const dotRadius = 5;

  const handlePlay = (e) => {
    e.stopPropagation();
    playChordStrum(chordName, { program: program || 24, volume: 0.7 });
  };

  return (
    <div
      className={`abc-chord-card ${active ? 'abc-chord-active' : ''} ${playable ? 'abc-chord-playable' : ''}`}
      onClick={playable ? handlePlay : undefined}
      title={playable ? t('diagram.playChord', { chord: chordName }) : chordName}
    >
      <svg width="110" height="130" viewBox="0 0 110 130" className="abc-fingering-svg">
        {/* Chord name */}
        <text x={startX + 2.5 * stringSpacing} y={14} textAnchor="middle"
          fontSize="12" fontWeight="600" fill={active ? 'var(--accent-text)' : 'var(--text-primary)'} fontFamily="var(--font-sans)">
          {chordName}
        </text>
        {/* Nut or fret indicator */}
        {baseFret === 1 ? (
          <line x1={startX} y1={startY} x2={startX + 5 * stringSpacing} y2={startY}
            stroke="var(--text-primary)" strokeWidth="3" />
        ) : (
          <text x={startX - 10} y={startY + fretSpacing / 2 + 4} textAnchor="middle"
            fontSize="9" fill="var(--text-muted)" fontFamily="var(--font-sans)">
            {baseFret}
          </text>
        )}
        {/* Frets (horizontal) */}
        {Array.from({ length: numFrets + 1 }).map((_, i) => (
          <line key={`f${i}`} x1={startX} y1={startY + i * fretSpacing}
            x2={startX + 5 * stringSpacing} y2={startY + i * fretSpacing}
            stroke="var(--border)" strokeWidth="1" />
        ))}
        {/* Strings (vertical) */}
        {Array.from({ length: 6 }).map((_, i) => (
          <line key={`s${i}`} x1={startX + i * stringSpacing} y1={startY}
            x2={startX + i * stringSpacing} y2={startY + numFrets * fretSpacing}
            stroke="var(--text-secondary)" strokeWidth="1" />
        ))}
        {/* Dots & markers */}
        {frets.map((fret, i) => {
          const x = startX + i * stringSpacing;
          if (fret === -1) {
            return <text key={i} x={x} y={startY - 6} textAnchor="middle"
              fontSize="10" fill="var(--text-muted)" fontFamily="var(--font-sans)">✕</text>;
          }
          if (fret === 0) {
            return <circle key={i} cx={x} cy={startY - 8} r={4}
              fill="none" stroke="var(--text-secondary)" strokeWidth="1.5" />;
          }
          const adjustedFret = fret - baseFret + 1;
          return <circle key={i} cx={x} cy={startY + (adjustedFret - 0.5) * fretSpacing}
            r={dotRadius} fill="var(--text-primary)" />;
        })}
        {/* Play icon overlay */}
        {playable && (
          <g opacity="0.5" className="abc-chord-play-icon">
            <polygon points="85,115 85,125 95,120" fill="var(--accent)" />
          </g>
        )}
      </svg>
    </div>
  );
}

// ===== Guitar Fretboard Mini-Diagram (for single notes / double stops) =====

// Standard guitar open string MIDI pitches: E2=40, A2=45, D3=50, G3=55, B3=59, E4=64
const GUITAR_OPEN_STRINGS = [40, 45, 50, 55, 59, 64];
const GUITAR_STRING_NAMES = ['E', 'A', 'D', 'G', 'B', 'e'];

/**
 * Convert a MIDI pitch to the best guitar string/fret position.
 * Prefers lower fret numbers and standard position.
 */
function midiToGuitarPosition(pitch) {
  let bestString = -1;
  let bestFret = 99;
  for (let s = 0; s < 6; s++) {
    const fret = pitch - GUITAR_OPEN_STRINGS[s];
    if (fret >= 0 && fret <= 22 && fret < bestFret) {
      bestFret = fret;
      bestString = s;
    }
  }
  if (bestString === -1) return null;
  return { string: bestString, fret: bestFret };
}

/**
 * Convert multiple MIDI pitches to guitar positions, trying to keep them
 * on different strings (like a real guitar voicing).
 */
function midiPitchesToGuitarPositions(pitches) {
  if (!pitches || pitches.length === 0) return [];

  // For each pitch, find all possible string/fret combos
  const options = pitches.map(pitch => {
    const positions = [];
    for (let s = 0; s < 6; s++) {
      const fret = pitch - GUITAR_OPEN_STRINGS[s];
      if (fret >= 0 && fret <= 22) {
        positions.push({ string: s, fret, pitch });
      }
    }
    return positions;
  });

  // Greedy assignment: prefer lower frets, avoid duplicate strings
  const usedStrings = new Set();
  const result = [];
  for (const opts of options) {
    // Sort by fret (prefer lower), then by string priority
    opts.sort((a, b) => a.fret - b.fret);
    const pick = opts.find(o => !usedStrings.has(o.string)) || opts[0];
    if (pick) {
      usedStrings.add(pick.string);
      result.push(pick);
    }
  }
  return result;
}

// Mini fretboard showing active note positions
function GuitarFretboard({ positions, label }) {
  // Show frets 0-5 by default, or shift window if notes are higher
  const maxFret = Math.max(5, ...positions.map(p => p.fret + 1));
  const minFret = Math.max(0, Math.min(...positions.map(p => p.fret)) - 1);
  const startFret = minFret;
  const numFrets = Math.min(6, maxFret - startFret + 1);

  const stringSpacing = 16;
  const fretSpacing = 28;
  const startX = 30;
  const startY = 20;
  const dotRadius = 6;
  const width = startX + numFrets * fretSpacing + 20;
  const height = startY + 5 * stringSpacing + 30;

  return (
    <div className="abc-guitar-fretboard">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="abc-fingering-svg">
        {/* Fret numbers on top */}
        {Array.from({ length: numFrets + 1 }).map((_, i) => {
          const fretNum = startFret + i;
          return (
            <text key={`fn${i}`} x={startX + i * fretSpacing} y={12}
              textAnchor="middle" fontSize="9" fill="var(--text-muted)" fontFamily="var(--font-sans)">
              {fretNum === 0 ? '' : fretNum}
            </text>
          );
        })}

        {/* Nut (thick line at fret 0) */}
        {startFret === 0 && (
          <line x1={startX} y1={startY} x2={startX} y2={startY + 5 * stringSpacing}
            stroke="var(--text-primary)" strokeWidth="3" />
        )}

        {/* Fret lines (vertical) */}
        {Array.from({ length: numFrets + 1 }).map((_, i) => (
          <line key={`fl${i}`}
            x1={startX + i * fretSpacing} y1={startY}
            x2={startX + i * fretSpacing} y2={startY + 5 * stringSpacing}
            stroke="var(--border)" strokeWidth={i === 0 && startFret === 0 ? 0 : 1} />
        ))}

        {/* Strings (horizontal) */}
        {Array.from({ length: 6 }).map((_, i) => (
          <g key={`s${i}`}>
            <line
              x1={startX} y1={startY + i * stringSpacing}
              x2={startX + numFrets * fretSpacing} y2={startY + i * stringSpacing}
              stroke="var(--text-secondary)" strokeWidth={1 + i * 0.15} />
            {/* String name label */}
            <text x={10} y={startY + i * stringSpacing + 4}
              textAnchor="middle" fontSize="10" fill="var(--text-muted)" fontFamily="var(--font-sans)">
              {GUITAR_STRING_NAMES[i]}
            </text>
          </g>
        ))}

        {/* Active note dots */}
        {positions.map((pos, idx) => {
          if (pos.fret === 0) {
            // Open string: show circle at nut
            return (
              <circle key={idx} cx={startX - 4} cy={startY + pos.string * stringSpacing}
                r={dotRadius - 1} fill="none" stroke="var(--accent)" strokeWidth="2" />
            );
          }
          const x = startX + (pos.fret - startFret - 0.5) * fretSpacing;
          const y = startY + pos.string * stringSpacing;
          return (
            <g key={idx}>
              <circle cx={x} cy={y} r={dotRadius}
                fill="var(--accent)" stroke="var(--bg-primary)" strokeWidth="1" />
              <text x={x} y={y + 3.5} textAnchor="middle"
                fontSize="8" fill="white" fontWeight="700" fontFamily="var(--font-sans)">
                {pos.fret}
              </text>
            </g>
          );
        })}

        {/* Label below */}
        {label && (
          <text x={width / 2} y={height - 4} textAnchor="middle"
            fontSize="11" fill="var(--accent-text)" fontWeight="600" fontFamily="var(--font-sans)">
            {label}
          </text>
        )}
      </svg>
    </div>
  );
}

// Scrollable guitar fingering strip: all events pre-rendered horizontally
function GuitarFingeringStrip({ events, activeEventIndex, program, onClickEvent }) {
  const stripRef = useRef(null);
  const activeRef = useRef(null);
  const noteNames = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

  // Auto-scroll to active item
  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }, [activeEventIndex]);

  // No events yet → hint
  if (!events || events.length === 0) {
    return (
      <div className="abc-fingering abc-guitar-fingering-zone">
        <div className="abc-fingering-hint">
          {t('diagram.playbackHint')}
        </div>
      </div>
    );
  }

  // Group consecutive chord events with same chordName into single items
  // Picking events (no chord or different pitches) stay individual
  const items = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const isChord = ev.isChord && ev.chordName && GUITAR_CHORDS[ev.chordName];

    if (isChord) {
      // Check if previous item is the same chord → merge
      const prev = items[items.length - 1];
      if (prev && prev.type === 'chord' && prev.chordName === ev.chordName) {
        prev.eventIndices.push(i);
        continue;
      }
      items.push({ type: 'chord', chordName: ev.chordName, eventIndices: [i] });
    } else {
      // Picking / individual notes
      const positions = midiPitchesToGuitarPositions(ev.pitches || []);
      const label = positions.map(p => {
        const name = noteNames[p.pitch % 12];
        const oct = Math.floor(p.pitch / 12) - 1;
        return `${name}${oct}`;
      }).join(' ');
      items.push({ type: 'fretboard', positions, label, eventIndices: [i] });
    }
  }

  return (
    <div className="abc-fingering-strip" ref={stripRef}>
      {items.map((item, idx) => {
        const isActive = activeEventIndex !== null
          && item.eventIndices.includes(activeEventIndex);
        const firstEventIndex = item.eventIndices[0];
        return (
          <div
            key={idx}
            className={`abc-fingering-strip-item${isActive ? ' active' : ''}`}
            ref={isActive ? activeRef : null}
            onClick={() => onClickEvent?.(firstEventIndex)}
            title={t('diagram.clickToPlay')}
          >
            {item.type === 'chord' ? (
              <GuitarChordChart chordName={item.chordName} program={program} />
            ) : item.positions.length > 0 ? (
              <GuitarFretboard positions={item.positions} label={item.label} />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// Main FingeringChart dispatcher
export function FingeringChart({ instrument, note, chordName }) {
  if (instrument === 'guitar' && chordName) {
    return <GuitarChordChart chordName={chordName} />;
  }
  if (!note) return null;

  const standardNote = typeof note === 'string' && note.match(/^[A-G]/) ? note : abcNoteToStandard(note);
  const fingeringKey = noteToFingeringKey(standardNote, instrument);

  if (instrument === 'tin-whistle') {
    return <TinWhistleChart note={standardNote} fingeringKey={fingeringKey} />;
  }
  if (instrument === 'flute') {
    return <FluteChart note={standardNote} fingeringKey={fingeringKey} />;
  }
  return null;
}

// Determine instrument type from MIDI program number
export function getInstrumentType(program) {
  if (program === 78) return 'tin-whistle';
  if (program === 73) return 'flute';
  if (program === 24 || program === 25) return 'guitar';
  return null;
}

// ===== Verovio WASM singleton (loaded once, shared across all AbcBlocks) =====
let verovioToolkit = null;
let verovioReady = false;
let verovioReadyResolve = null;
const verovioReadyPromise = new Promise(resolve => { verovioReadyResolve = resolve; });

export function getVerovioToolkit() { return verovioToolkit; }
export function isVerovioReady() { return verovioReady; }

// Lazy-load verovio on first use
let verovioLoadStarted = false;
export function ensureVerovioLoaded() {
  if (verovioLoadStarted) return verovioReadyPromise;
  verovioLoadStarted = true;
  import('verovio').then(m => {
    const verovio = m.default || m;
    if (typeof verovio === 'function') {
      verovio().then(tk => {
        verovioToolkit = tk;
        verovioReady = true;
        verovioReadyResolve();
      });
    } else if (verovio.module && verovio.module.calledRun) {
      verovioToolkit = new verovio.toolkit();
      verovioReady = true;
      verovioReadyResolve();
    } else if (verovio.module) {
      verovio.module.onRuntimeInitialized = () => {
        verovioToolkit = new verovio.toolkit();
        verovioReady = true;
        verovioReadyResolve();
      };
    } else if (verovio.toolkit) {
      verovioToolkit = new verovio.toolkit();
      verovioReady = true;
      verovioReadyResolve();
    } else {
      console.error('[Verovio] Unknown module structure');
    }
  }).catch(err => {
    console.error('[Verovio] Load error:', err);
  });
  return verovioReadyPromise;
}

// ===== Single playback: only one AbcBlock plays at a time =====
// State stored on window so stopAllAbcPlayback can work without importing this module
function registerActivePlayer(id, stopFn) {
  if (window.__abcActiveId && window.__abcActiveId !== id && window.__abcActiveStop) {
    try { window.__abcActiveStop(); } catch {}
  }
  window.__abcActiveId = id;
  window.__abcActiveStop = stopFn;
}

function unregisterActivePlayer(id) {
  if (window.__abcActiveId === id) {
    window.__abcActiveId = null;
    window.__abcActiveStop = null;
  }
}

// Stop all playback (called on navigation / file change)
export function stopAllAbcPlayback() {
  if (window.__abcActiveStop) {
    try { window.__abcActiveStop(); } catch {}
  }
  window.__abcActiveId = null;
  window.__abcActiveStop = null;
}

// ===== Master GainNode for volume control (shared, lazy-init) =====
let masterGainNode = null;
function getMasterGain() {
  if (masterGainNode) return masterGainNode;
  const ctx = window.abcjsAudioContext;
  if (!ctx) return null;
  masterGainNode = ctx.createGain();
  masterGainNode.connect(ctx.destination);
  return masterGainNode;
}

// Patch a CreateSynth (midiBuffer) so _kickOffSound routes through our GainNode
function patchMidiBufferForVolume(midiBuffer) {
  if (!midiBuffer || midiBuffer.__volumePatched) return;
  const original = midiBuffer._kickOffSound.bind(midiBuffer);
  midiBuffer._kickOffSound = function(seconds) {
    original(seconds);
    const gain = getMasterGain();
    if (gain && midiBuffer.directSource) {
      midiBuffer.directSource.forEach(src => {
        try { src.disconnect(); src.connect(gain); } catch {}
      });
    }
  };
  midiBuffer.__volumePatched = true;
}

// Format seconds to mm:ss
function formatTime(seconds) {
  if (!seconds || !isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ABC Music Notation Block: Verovio rendering + abcjs playback + fingering charts
let abcBlockCounter = 0;
export function AbcBlock({ code }) {
  const containerRef = useRef(null);
  const [isVisible, setIsVisible] = useState(false);

  // Lazy render: only initialize when scrolled into view
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setIsVisible(true); observer.disconnect(); } },
      { rootMargin: '200px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const verovioRef = useRef(null);   // Verovio SVG container
  const abcjsHiddenRef = useRef(null); // Hidden abcjs render for synth
  const audioRef = useRef(null);
  const synthControlRef = useRef(null);
  const visualObjRef = useRef(null);
  const blockIdRef = useRef(`abc-${++abcBlockCounter}`);

  const [viewMode, setViewMode] = useState('both'); // 'notation' | 'tab' | 'both'
  const [instrument, setInstrument] = useState(24);
  const [synthReady, setSynthReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentNote, setCurrentNote] = useState(null);
  const [currentChord, setCurrentChord] = useState(null);
  const [currentPitches, setCurrentPitches] = useState(null); // MIDI pitches for guitar fingering zone
  const [activeEventIndex, setActiveEventIndex] = useState(null); // Index into guitarEventsRef for strip
  const [verovioLoaded, setVerovioLoaded] = useState(verovioReady);
  const [renderError, setRenderError] = useState(null);
  const timemapRef = useRef(null); // Verovio timemap for highlight sync
  const guitarEventsRef = useRef(null); // WebAudioFont events for guitar
  const guitarMsPerMeasureRef = useRef(1000); // millisecondsPerMeasure from abcjs
  const [guitarSamplesLoaded, setGuitarSamplesLoaded] = useState(false);
  const [guitarEventsReady, setGuitarEventsReady] = useState(false);
  const [guitarProgress, setGuitarProgress] = useState(0);
  const guitarProgressTimer = useRef(null);
  const guitarStartIndexRef = useRef(0); // start index for next Play (set by strip click)
  const [volume, setVolume] = useState(80); // 0-100
  const [warp, setWarp] = useState(100); // playback speed %

  // Detect MIDI program from ABC code and auto-select instrument
  const hasMidiProgram = /%%MIDI\s+program\s+\d+/.test(code);
  useEffect(() => {
    const match = code.match(/%%MIDI\s+program\s+(\d+)/);
    if (match) {
      const prog = Number(match[1]);
      setInstrument(prog);
      if (prog !== 24 && prog !== 25 && prog !== 27) {
        setViewMode('notation');
      }
    }
  }, [code]);

  const instrumentType = getInstrumentType(instrument);
  const isWindInstrument = instrumentType === 'tin-whistle' || instrumentType === 'flute';
  const isGuitar = instrumentType === 'guitar';

  // Init WebAudioFont for guitar (lazy, only when needed)
  useEffect(() => {
    if (!isVisible || !isGuitar) return;
    if (isGuitarAudioReady()) { setGuitarSamplesLoaded(true); return; }
    const ctx = window.abcjsAudioContext || new (window.AudioContext || window.webkitAudioContext)();
    if (!window.abcjsAudioContext) window.abcjsAudioContext = ctx;
    initGuitarAudio(ctx).then(() => {
      console.log('[GuitarAudio] Samples loaded');
      setGuitarSamplesLoaded(true);
    }).catch(err => console.error('[GuitarAudio] Sample load failed:', err));
  }, [isVisible, isGuitar]);

  // Wait for Verovio WASM to be ready (only when visible)
  useEffect(() => {
    if (!isVisible) return;
    if (verovioReady) { setVerovioLoaded(true); return; }
    ensureVerovioLoaded().then(() => setVerovioLoaded(true));
  }, [isVisible]);

  // Render with Verovio (beautiful engraving)
  useEffect(() => {
    if (!isVisible || !verovioLoaded || !verovioRef.current || !code) return;
    try {
      // Measure container width for responsive rendering
      const containerWidth = verovioRef.current.parentElement?.offsetWidth || 800;
      // Verovio uses internal units ~10x CSS pixels at scale 40
      const verovioWidth = Math.round(containerWidth * 10 / 4);

      verovioToolkit.setOptions({
        inputFrom: 'abc',
        scale: 40,
        adjustPageHeight: true,
        pageMarginTop: 10,
        pageMarginBottom: 0,
        pageMarginLeft: 15,
        pageMarginRight: 15,
        pageWidth: verovioWidth,
        breaks: 'auto',
        font: 'Leipzig',
        svgViewBox: true,
        svgHtml5: true,
        header: 'none',
        footer: 'none',
        spacingStaff: 8,
        spacingSystem: 4,
      });

      const loaded = verovioToolkit.loadData(code);
      if (!loaded) {
        setRenderError(t('diagram.abcParseError'));
        return;
      }

      const pageCount = verovioToolkit.getPageCount();
      let allSvg = '';
      for (let i = 1; i <= pageCount; i++) {
        allSvg += verovioToolkit.renderToSVG(i);
      }
      verovioRef.current.innerHTML = allSvg;

      // Make SVGs responsive: don't try to crop, let the scroll container handle overflow
      const svgs = verovioRef.current.querySelectorAll('svg');
      svgs.forEach((svg) => {
        svg.removeAttribute('width');
        svg.removeAttribute('height');
        svg.style.width = '100%';
        svg.style.height = 'auto';
        svg.style.display = 'block';
      });

      // Generate MIDI + timemap for playback highlight sync
      try {
        verovioToolkit.renderToMIDI();
        const tm = verovioToolkit.renderToTimemap();
        timemapRef.current = Array.isArray(tm) ? tm : (typeof tm === 'string' ? JSON.parse(tm) : []);
      } catch {
        timemapRef.current = [];
      }

      setRenderError(null);
    } catch (err) {
      console.error('Verovio render error:', err);
      setRenderError(err.message);
    }
  }, [code, verovioLoaded, isVisible]);

  // Hidden abcjs render for audio synth (abcjs needs its own visualObj)
  useEffect(() => {
    if (!isVisible || !abcjsHiddenRef.current || !code) return;
    abcjsHiddenRef.current.innerHTML = '';

    const renderOptions = {
      responsive: 'resize',
      add_classes: true,
      staffwidth: 700,
    };

    // Add tablature for guitar in hidden render (not displayed but needed for synth)
    if (isGuitar && viewMode !== 'notation') {
      renderOptions.tablature = [{
        instrument: 'guitar',
        tuning: ['E,', 'A,', 'D', 'G', 'B', 'e'],
      }];
    }

    try {
      const visualObj = abcjs.renderAbc(abcjsHiddenRef.current, code, renderOptions);
      visualObjRef.current = visualObj[0];

      // For guitar: extract MIDI sequence via CreateSynth + sequenceCallback
      if (isGuitar && visualObjRef.current) {
        console.log('[GuitarAudio] Starting sequence extraction, instrument:', instrument);
        const tempSynth = new abcjs.synth.CreateSynth();
        tempSynth.init({
          visualObj: visualObjRef.current,
          options: {
            program: instrument,
            sequenceCallback: (noteMapTracks) => {
              console.log('[GuitarAudio] sequenceCallback fired, tracks:', noteMapTracks.length);
              const msPerMeasure = visualObjRef.current.millisecondsPerMeasure();
              guitarMsPerMeasureRef.current = msPerMeasure;
              const events = buildGuitarEvents(noteMapTracks, msPerMeasure);
              assignChordsToEvents(events, code, msPerMeasure);
              guitarEventsRef.current = events;
              console.log('[GuitarAudio] Sequence extracted:', events.length, 'events, msPerMeasure:', msPerMeasure);
              setGuitarEventsReady(true);
            },
          },
        }).then(() => {
          // prime() triggers the sequenceCallback
          return tempSynth.prime();
        }).then(result => {
          console.log('[GuitarAudio] Sequence ready:', result);
        }).catch(err => console.error('[GuitarAudio] CreateSynth error:', err));
      }

      if (!isGuitar && synthControlRef.current && visualObjRef.current) {
        synthControlRef.current.setTune(visualObjRef.current, false, {
          program: instrument,
        }).catch(() => {});
      } else if (!isGuitar) {
        synthControlRef.current = null;
        setSynthReady(false);
      }
    } catch (err) {
      console.error('abcjs hidden render error:', err);
    }
  }, [code, viewMode, isGuitar, isVisible, instrument]);

  // Update instrument on existing synth
  useEffect(() => {
    if (synthControlRef.current && visualObjRef.current && synthReady) {
      synthControlRef.current.setTune(visualObjRef.current, false, {
        program: instrument,
      }).catch(() => {});
    }
  }, [instrument, synthReady]);

  // Highlight Verovio notes by sequential index (nth note-on in the timemap)
  const highlightByIndex = useCallback((noteIndex) => {
    if (!verovioRef.current || !timemapRef.current) return;
    // Clear previous highlights
    verovioRef.current.querySelectorAll('.verovio-playing').forEach(el => {
      el.classList.remove('verovio-playing');
    });
    // Find the nth "on" entry in timemap
    const onEntries = timemapRef.current.filter(e => e.on && e.on.length > 0);
    if (noteIndex < 0 || noteIndex >= onEntries.length) return;
    const entry = onEntries[noteIndex];
    if (!entry || !entry.on) return;
    for (const noteId of entry.on) {
      const el = verovioRef.current.querySelector(`[data-id="${noteId}"]`);
      if (el) el.classList.add('verovio-playing');
    }
  }, []);

  // Initialize SynthController (abcjs audio engine): only for non-guitar instruments
  useEffect(() => {
    if (!isVisible || !audioRef.current || !visualObjRef.current) return;
    if (isGuitar) return; // Guitar uses WebAudioFont instead
    if (synthControlRef.current) return;

    // Track note index for Verovio highlighting
    let noteCounter = -1;

    const cursorControl = {
      onStart: () => {
        noteCounter = -1;
        // Stop any other playing block
        registerActivePlayer(blockIdRef.current, () => {
          try { synthControlRef.current?.pause?.(); } catch {}
          setPlaying(false);
          setCurrentNote(null);
          setCurrentChord(null);
        });
        setPlaying(true);
      },
      onEvent: (event) => {
        // Highlight on Verovio SVG by sequential note index
        noteCounter++;
        highlightByIndex(noteCounter);
        // Extract note for fingering display
        if (event.midiPitches && event.midiPitches.length > 0) {
          const midi = event.midiPitches[0].pitch;
          const noteNames = ['C','C','D','D','E','F','F','G','G','A','A','B'];
          const sharps =    [ 0,  1,  0,  1,  0,  0,  1,  0,  1,  0,  1,  0];
          const idx = midi % 12;
          const oct = Math.floor(midi / 12) - 1;
          const name = noteNames[idx] + (sharps[idx] ? '#' : '') + oct;
          setCurrentNote(name);
        }
        if (event.chord) {
          setCurrentChord(event.chord);
        }
      },
      onFinished: () => {
        setPlaying(false);
        setCurrentNote(null);
        setCurrentChord(null);
        unregisterActivePlayer(blockIdRef.current);
        verovioRef.current?.querySelectorAll('.verovio-playing').forEach(el => {
          el.classList.remove('verovio-playing');
        });
      },
    };

    try {
      const synthControl = new abcjs.synth.SynthController();
      synthControl.load(audioRef.current, cursorControl, {
        displayPlay: true,
        displayProgress: true,
        displayWarp: true,
      });
      synthControlRef.current = synthControl;

      synthControl.setTune(visualObjRef.current, false, {
        program: instrument,
      }).then(() => {
        setSynthReady(true);
        // Patch volume routing on the internal midiBuffer
        if (synthControl.midiBuffer) {
          patchMidiBufferForVolume(synthControl.midiBuffer);
        }
      }).catch(err => {
        console.error('ABC setTune error:', err);
      });
    } catch (err) {
      console.error('ABC audio init error:', err);
    }
  }, [code, viewMode, isGuitar, highlightByIndex, isVisible]);

  // Sync volume with GainNode
  useEffect(() => {
    const gain = getMasterGain();
    if (gain) {
      gain.gain.value = volume / 100;
    }
  }, [volume]);

  // Sync warp (playback speed) with SynthController
  useEffect(() => {
    if (synthControlRef.current && synthReady) {
      synthControlRef.current.setWarp(warp);
    }
  }, [warp, synthReady]);

  // Re-patch midiBuffer when instrument changes (setTune creates a new one)
  useEffect(() => {
    if (synthControlRef.current && synthControlRef.current.midiBuffer) {
      patchMidiBufferForVolume(synthControlRef.current.midiBuffer);
    }
  }, [instrument, synthReady]);

  // Guitar play handler
  const handleGuitarPlay = useCallback(async () => {
    if (!guitarEventsRef.current) return;

    const ctx = window.abcjsAudioContext || new (window.AudioContext || window.webkitAudioContext)();
    if (!window.abcjsAudioContext) window.abcjsAudioContext = ctx;
    if (ctx.state === 'suspended') await ctx.resume();

    // Load samples on first play if not already loaded
    if (!isGuitarAudioReady()) {
      console.log('[GuitarAudio] Loading samples on first play...');
      await initGuitarAudio(ctx);
      setGuitarSamplesLoaded(true);
    }
    if (!isGuitarAudioReady()) {
      console.error('[GuitarAudio] Samples failed to load');
      return;
    }

    // Register as active player (stops other blocks)
    registerActivePlayer(blockIdRef.current, () => {
      stopGuitarPlayback();
      setPlaying(false);
      setCurrentNote(null);
      setCurrentChord(null);
      setCurrentPitches(null);
      setActiveEventIndex(null);
      setGuitarProgress(0);
      if (guitarProgressTimer.current) {
        clearInterval(guitarProgressTimer.current);
        guitarProgressTimer.current = null;
      }
      verovioRef.current?.querySelectorAll('.verovio-playing').forEach(el => {
        el.classList.remove('verovio-playing');
      });
    });

    const gain = getMasterGain();

    const startIdx = guitarStartIndexRef.current || 0;
    guitarStartIndexRef.current = 0; // reset after use

    playGuitarSequence(guitarEventsRef.current, {
      audioContext: ctx,
      destination: gain || ctx.destination,
      program: instrument,
      startFromIndex: startIdx,
      speed: warp / 100,
      volume: volume / 100,
      onEvent: (eventIndex, event) => {
        highlightByIndex(eventIndex);
        setActiveEventIndex(eventIndex);
        // Store pitches for guitar fingering zone
        if (event.pitches && event.pitches.length > 0) {
          setCurrentPitches([...event.pitches]);
          const midi = event.pitches[0];
          const noteNames = ['C','C','D','D','E','F','F','G','G','A','A','B'];
          const sharps =    [ 0,  1,  0,  1,  0,  0,  1,  0,  1,  0,  1,  0];
          const idx = midi % 12;
          const oct = Math.floor(midi / 12) - 1;
          const name = noteNames[idx] + (sharps[idx] ? '#' : '') + oct;
          setCurrentNote(name);
        }
        // Update chord name: clear if event has no chord (to switch to fretboard view)
        setCurrentChord(event.chordName || null);
      },
      onFinished: () => {
        setPlaying(false);
        setCurrentNote(null);
        setCurrentChord(null);
        setCurrentPitches(null);
        setActiveEventIndex(null);
        setGuitarProgress(0);
        unregisterActivePlayer(blockIdRef.current);
        if (guitarProgressTimer.current) {
          clearInterval(guitarProgressTimer.current);
          guitarProgressTimer.current = null;
        }
        verovioRef.current?.querySelectorAll('.verovio-playing').forEach(el => {
          el.classList.remove('verovio-playing');
        });
      },
    });

    setPlaying(true);

    // Progress polling
    guitarProgressTimer.current = setInterval(() => {
      setGuitarProgress(getGuitarProgress());
    }, 50);
  }, [instrument, volume, warp, highlightByIndex]);

  const handleGuitarStop = useCallback(() => {
    stopGuitarPlayback();
    setPlaying(false);
    setCurrentNote(null);
    setCurrentChord(null);
    setCurrentPitches(null);
    setActiveEventIndex(null);
    setGuitarProgress(0);
    unregisterActivePlayer(blockIdRef.current);
    if (guitarProgressTimer.current) {
      clearInterval(guitarProgressTimer.current);
      guitarProgressTimer.current = null;
    }
    verovioRef.current?.querySelectorAll('.verovio-playing').forEach(el => {
      el.classList.remove('verovio-playing');
    });
  }, []);

  // Click on a strip item: play the sound, highlight, set as start point for next Play
  const handleStripClick = useCallback((eventIndex) => {
    if (!guitarEventsRef.current) return;
    const ev = guitarEventsRef.current[eventIndex];
    if (!ev) return;

    // If currently playing, stop first
    if (playing) {
      stopGuitarPlayback();
      setPlaying(false);
      setGuitarProgress(0);
      if (guitarProgressTimer.current) {
        clearInterval(guitarProgressTimer.current);
        guitarProgressTimer.current = null;
      }
    }

    // Play just this one event
    const gain = getMasterGain();
    playSingleGuitarEvent(ev, {
      destination: gain || undefined,
      program: instrument,
      volume: volume / 100,
    });

    // Update UI
    setActiveEventIndex(eventIndex);
    highlightByIndex(eventIndex);

    // Store as start point for next Play
    guitarStartIndexRef.current = eventIndex;
  }, [playing, instrument, volume, highlightByIndex]);

  // Cleanup synth on unmount
  useEffect(() => {
    const id = blockIdRef.current;
    return () => {
      unregisterActivePlayer(id);
      if (synthControlRef.current) {
        try { synthControlRef.current.destroy?.(); } catch {}
        synthControlRef.current = null;
      }
      stopGuitarPlayback();
      if (guitarProgressTimer.current) {
        clearInterval(guitarProgressTimer.current);
        guitarProgressTimer.current = null;
      }
    };
  }, []);

  // Lazy render: show lightweight placeholder until scrolled into view
  if (!isVisible) {
    return (
      <div ref={containerRef} className="abc-block abc-block-placeholder" style={{ minHeight: 120 }}>
        <div className="abc-loading">{t('diagram.sheetPending')}</div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={`abc-block ${viewMode === 'tab' ? 'tab-only' : ''}`}>
      {/* Toolbar: hidden when instrument is already defined via %%MIDI program */}
      {!hasMidiProgram && (
        <div className="abc-controls">
          {isGuitar ? (
            <div className="abc-view-toggle">
              <button
                className={viewMode === 'notation' ? 'active' : ''}
                onClick={() => setViewMode('notation')}
                title={t('diagram.sheetOnly')}
              >
                <Music size={14} /> {t('diagram.partition')}
              </button>
              <button
                className={viewMode === 'tab' ? 'active' : ''}
                onClick={() => setViewMode('tab')}
                title={t('diagram.tabOnly')}
              >
                <Guitar size={14} /> Tab
              </button>
              <button
                className={viewMode === 'both' ? 'active' : ''}
                onClick={() => setViewMode('both')}
                title={t('diagram.sheetAndTab')}
              >
                {t('diagram.all')}
              </button>
            </div>
          ) : (
            <div className="abc-view-toggle">
              <button className="active">
                {isWindInstrument ? <Wind size={14} /> : <Music size={14} />} Partition
              </button>
            </div>
          )}

          <select
            value={instrument}
            onChange={(e) => {
              const val = Number(e.target.value);
              setInstrument(val);
              setCurrentNote(null);
              setCurrentChord(null);
              const type = getInstrumentType(val);
              if (type === 'guitar') setViewMode('both');
              else setViewMode('notation');
            }}
            className="abc-instrument-select"
          >
            <optgroup label={t('diagram.guitar')}>
              <option value={24}>Nylon</option>
              <option value={25}>Steel</option>
            </optgroup>
            <optgroup label={t('diagram.flutes')}>
              <option value={73}>{t('diagram.concertFlute')}</option>
              <option value={78}>Tin Whistle</option>
            </optgroup>
            <optgroup label={t('diagram.other')}>
              <option value={0}>Piano</option>
            </optgroup>
          </select>
        </div>
      )}

      {/* Scrollable notation area */}
      <div className="abc-scroll-area">
        {/* Verovio notation (beautiful engraving) */}
        <div ref={verovioRef} className="abc-notation verovio-notation">
          {!verovioLoaded && (
            <div className="abc-loading">{t('diagram.loadingSheet')}</div>
          )}
          {renderError && (
            <div className="abc-render-error">{renderError}</div>
          )}
        </div>

        {/* Hidden abcjs render for audio engine: not displayed */}
        <div ref={abcjsHiddenRef} style={{ position: 'absolute', left: '-9999px', height: 0, overflow: 'hidden' }} />

        {/* Guitar tablature (abcjs, visible only in tab/both modes for guitar) */}
        {isGuitar && viewMode !== 'notation' && (
          <div className="abc-tab-section">
            <AbcTabOnly code={code} viewMode={viewMode} />
          </div>
        )}
      </div>

      {/* Sticky bottom bar: fingering + player controls */}
      <div className="abc-sticky-bar">
        {/* Fingering chart for wind instruments */}
        {isWindInstrument && (
          <div className="abc-fingering">
            <FingeringChart
              instrument={instrumentType}
              note={currentNote}
              chordName={null}
            />
            {!currentNote && (
              <div className="abc-fingering-hint">
                {t('diagram.playbackHint')}
              </div>
            )}
          </div>
        )}

        {/* Guitar fingering strip: scrollable band of all events */}
        {isGuitar && (
          <GuitarFingeringStrip
            events={guitarEventsRef.current}
            activeEventIndex={activeEventIndex}
            program={instrument}
            onClickEvent={handleStripClick}
          />
        )}

        {/* Audio controls */}
        <div className="abc-player">
          {isGuitar ? (
            /* Guitar custom player (WebAudioFont) */
            <div className="abc-guitar-player">
              <div className="abc-guitar-player-row">
                <button
                  className="abc-guitar-play-btn"
                  onClick={playing ? handleGuitarStop : handleGuitarPlay}
                  disabled={!guitarEventsReady}
                  title={playing ? t('diagram.stop') : t('diagram.play')}
                >
                  {playing ? <Square size={16} /> : <Play size={16} />}
                </button>
                <div className="abc-guitar-progress-bg">
                  <div
                    className="abc-guitar-progress-fill"
                    style={{ width: `${guitarProgress * 100}%` }}
                  />
                </div>
                <span className="abc-guitar-time">
                  {formatTime(guitarProgress * getGuitarDuration())}
                </span>
              </div>
            </div>
          ) : (
            /* abcjs SynthController (play/pause + progress) */
            <div ref={audioRef} className="abc-audio" />
          )}

          {/* Hidden audioRef for abcjs SynthController init (needed even for guitar to avoid null ref) */}
          {isGuitar && <div ref={audioRef} style={{ display: 'none' }} />}

          {/* Custom controls: speed + volume */}
          <div className="abc-custom-controls">
            {/* Speed control */}
            <div className="abc-speed-control">
              <button
                className="abc-ctrl-btn"
                onClick={() => setWarp(w => Math.max(25, w - 25))}
                title={t('diagram.slowDown')}
                disabled={warp <= 25}
              >
                <Minus size={12} />
              </button>
              <span className="abc-speed-label">{warp}%</span>
              <button
                className="abc-ctrl-btn"
                onClick={() => setWarp(w => Math.min(200, w + 25))}
                title={t('diagram.speedUp')}
                disabled={warp >= 200}
              >
                <Plus size={12} />
              </button>
            </div>

            {/* Volume control */}
            <div className="abc-volume-control">
              <button
                className="abc-ctrl-btn"
                onClick={() => setVolume(v => v > 0 ? 0 : 80)}
                title={volume > 0 ? t('diagram.muteSound') : t('diagram.unmuteSound')}
              >
                {volume > 0 ? <Volume2 size={13} /> : <VolumeX size={13} />}
              </button>
              <input
                type="range"
                min="0"
                max="100"
                value={volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                className="abc-volume-slider"
                title={`Volume: ${volume}%`}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Guitar tablature sub-component (uses abcjs for tab rendering)
function AbcTabOnly({ code, viewMode }) {
  const tabRef = useRef(null);

  useEffect(() => {
    if (!tabRef.current || !code) return;
    tabRef.current.innerHTML = '';

    try {
      abcjs.renderAbc(tabRef.current, code, {
        responsive: 'resize',
        add_classes: true,
        staffwidth: 700,
        tablature: [{
          instrument: 'guitar',
          tuning: ['E,', 'A,', 'D', 'G', 'B', 'e'],
        }],
      });
    } catch (err) {
      console.error('Tab render error:', err);
    }
  }, [code, viewMode]);

  return <div ref={tabRef} className={`abc-tab-render ${viewMode === 'tab' ? 'tab-only-mode' : ''}`} />;
}

// Bloc ```chords: affiche juste les diagrammes d'accords guitare
export function ChordsBlock({ code }) {
  const names = code.split(/[\s,]+/).map(s => s.trim()).filter(Boolean)
  const known = names.filter(n => GUITAR_CHORDS[n])
  if (!known.length) return <div className="diagram-block diagram-error"><pre>{t('diagram.noChords')}</pre></div>
  return (
    <div className="chords-block">
      {known.map(name => (
        <GuitarChordChart key={name} chordName={name} playable program={24} />
      ))}
    </div>
  )
}

// Bloc ```tab: tablature guitare rendue sur un manche SVG scrollable
export function TabBlock({ code }) {
  const STRING_NAMES = ['e', 'B', 'G', 'D', 'A', 'E']
  const lines = code.trim().split('\n').filter(Boolean)

  // Parser la tab : trouver les colonnes de notes
  const stringLines = {}
  for (const line of lines) {
    const match = line.match(/^([eEBGDAg])\|(.+)\|?$/)
    if (match) {
      stringLines[match[1].toLowerCase() === 'e' && Object.keys(stringLines).length === 0 ? 'e' : match[1]] = match[2]
    }
  }

  // Extraire les colonnes de notes (chaque position dans la string)
  const orderedKeys = []
  for (const line of lines) {
    const match = line.match(/^([eEBGDAg])\|/)
    if (match) {
      const key = match[1]
      if (!orderedKeys.includes(key)) orderedKeys.push(key)
    }
  }

  if (orderedKeys.length === 0) {
    // Fallback texte brut si parsing échoue
    return (
      <div className="tab-block">
        <pre className="tab-pre">{code}</pre>
      </div>
    )
  }

  // Trouver les colonnes de notes (positions où il y a un chiffre)
  const rawLines = orderedKeys.map(k => stringLines[k] || '')
  const maxLen = Math.max(...rawLines.map(l => l.length))
  const columns = []

  let col = 0
  while (col < maxLen) {
    const notes = []
    let hasNote = false
    // Vérifier si c'est un nombre multi-digit (10+)
    for (let s = 0; s < orderedKeys.length; s++) {
      const ch = rawLines[s]?.[col]
      if (ch && ch >= '0' && ch <= '9') {
        // Vérifier si c'est un nombre à 2 chiffres
        const next = rawLines[s]?.[col + 1]
        const fret = (next && next >= '0' && next <= '9') ? parseInt(ch + next) : parseInt(ch)
        notes.push({ string: s, fret })
        hasNote = true
      }
    }
    if (hasNote) {
      columns.push(notes)
    }
    col++
  }

  // Rendu SVG: manche horizontal scrollable
  const stringSpacing = 14
  const colSpacing = 32
  const startX = 30
  const startY = 20
  const dotRadius = 8
  const numStrings = orderedKeys.length
  const svgWidth = startX + columns.length * colSpacing + 20
  const svgHeight = startY + (numStrings - 1) * stringSpacing + 30

  return (
    <div className="tab-block tab-fretboard">
      <svg width={svgWidth} height={svgHeight} viewBox={`0 0 ${svgWidth} ${svgHeight}`}>
        {/* Noms des cordes */}
        {orderedKeys.map((name, i) => (
          <text key={`n${i}`} x={12} y={startY + i * stringSpacing + 4}
            textAnchor="middle" fontSize="11" fill="var(--text-muted)" fontFamily="var(--font-mono)">
            {name}
          </text>
        ))}
        {/* Cordes horizontales */}
        {orderedKeys.map((_, i) => (
          <line key={`s${i}`} x1={startX} y1={startY + i * stringSpacing}
            x2={svgWidth - 10} y2={startY + i * stringSpacing}
            stroke="var(--border)" strokeWidth={i >= numStrings - 2 ? 1.5 : 1} />
        ))}
        {/* Notes */}
        {columns.map((notes, ci) => (
          <g key={`c${ci}`}>
            {notes.map(({ string, fret }, ni) => (
              <g key={`${ci}-${ni}`}>
                <circle cx={startX + ci * colSpacing + colSpacing / 2}
                  cy={startY + string * stringSpacing}
                  r={dotRadius} fill="var(--color-ai)" opacity="0.9" />
                <text x={startX + ci * colSpacing + colSpacing / 2}
                  y={startY + string * stringSpacing + 4}
                  textAnchor="middle" fontSize="10" fontWeight="600"
                  fill="white" fontFamily="var(--font-mono)">
                  {fret}
                </text>
              </g>
            ))}
          </g>
        ))}
      </svg>
    </div>
  )
}

// Bloc ```strum: pattern de strumming (↓↑ avec accents)
export function StrumBlock({ code }) {
  const patterns = code.trim().split('\n').filter(Boolean)
  return (
    <div className="strum-block">
      {patterns.map((pattern, pi) => {
        const beats = pattern.trim().split(/\s+/)
        return (
          <div key={pi} className="strum-pattern">
            {beats.map((beat, bi) => {
              const isDown = beat === 'D' || beat === 'd' || beat === '↓'
              const isUp = beat === 'U' || beat === 'u' || beat === '↑'
              const isAccent = beat === 'D!' || beat === 'U!' || beat === '↓!' || beat === '↑!'
              const isMute = beat === 'x' || beat === 'X'
              const isPause = beat === '-' || beat === '.'
              const direction = (isDown || beat === 'D!') ? 'down' : (isUp || beat === 'U!') ? 'up' : null
              return (
                <div key={bi} className={`strum-beat ${isAccent ? 'accent' : ''} ${isMute ? 'mute' : ''} ${isPause ? 'pause' : ''}`}>
                  {direction && (
                    <svg width="24" height="40" viewBox="0 0 24 40" className="strum-arrow">
                      {direction === 'down' ? (
                        <>
                          <line x1="12" y1="4" x2="12" y2="32" stroke="currentColor" strokeWidth={isAccent ? 3 : 2} />
                          <polygon points="6,28 12,36 18,28" fill="currentColor" />
                        </>
                      ) : (
                        <>
                          <line x1="12" y1="8" x2="12" y2="36" stroke="currentColor" strokeWidth={isAccent ? 3 : 2} />
                          <polygon points="6,12 12,4 18,12" fill="currentColor" />
                        </>
                      )}
                    </svg>
                  )}
                  {isMute && <span className="strum-mute">✕</span>}
                  {isPause && <span className="strum-pause">·</span>}
                  <span className="strum-label">{beat.replace('!', '')}</span>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

