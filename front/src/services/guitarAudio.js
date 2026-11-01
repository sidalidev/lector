// guitarAudio.js: WebAudioFont-based guitar playback with strumming
// Uses queueStrumDown/queueStrumUp for chords, queueWaveTable for single notes

import { createWebAudioFontPlayer } from './webaudiofont-wrapper';

let player = null;
let nylonPreset = null;
let steelPreset = null;
let loaded = false;
let loading = false;

// Active playback state
let activeEnvelopes = [];
let playbackTimer = null;
let playbackState = {
  playing: false,
  startTime: 0,
  duration: 0,
  pausedAt: 0,
  events: [],      // scheduled events sorted by time
  eventIndex: 0,   // current event index
  speed: 1,        // 1 = 100%
  volume: 0.8,
  onEvent: null,   // callback(eventIndex, event): for highlight + fingering
  onFinished: null,
};

// Nylon guitar preset URL and variable
const NYLON_URL = 'https://surikov.github.io/webaudiofontdata/sound/0240_JCLive_sf2_file.js';
const NYLON_VAR = '_tone_0240_JCLive_sf2_file';
// Steel guitar preset URL and variable
const STEEL_URL = 'https://surikov.github.io/webaudiofontdata/sound/0250_Acoustic_Guitar_sf2_file.js';
const STEEL_VAR = '_tone_0250_Acoustic_Guitar_sf2_file';

/**
 * Initialize WebAudioFont player and load guitar samples.
 * Reuses the existing AudioContext from abcjs (window.abcjsAudioContext).
 */
export async function initGuitarAudio(audioContext) {
  if (loaded || loading) return;
  loading = true;

  try {
    player = await createWebAudioFontPlayer();

    // Load both presets in parallel
    await Promise.all([
      loadPreset(audioContext, NYLON_URL, NYLON_VAR),
      loadPreset(audioContext, STEEL_URL, STEEL_VAR),
    ]);

    nylonPreset = window[NYLON_VAR];
    steelPreset = window[STEEL_VAR];
    loaded = true;
  } catch (err) {
    console.error('[GuitarAudio] Init error:', err);
  } finally {
    loading = false;
  }
}

// Un son WebAudioFont est un fichier JS (« var _tone_xxx = { zones: [{ midi: 24, file: '...' }] } ») :
// il est lu comme une donnée, jamais exécuté.
function lirePreset(texte) {
  const zones = [];
  for (const [, corps] of texte.matchAll(/\{([^{}]*)\}/g)) {
    const zone = {};
    for (const [, cle, valeur] of corps.matchAll(/(\w+)\s*:\s*('[^']*'|true|false|-?[\d.]+(?:e-?\d+)?)/gi)) {
      zone[cle] = valeur.startsWith("'") ? valeur.slice(1, -1) : valeur === 'true' ? true : valeur === 'false' ? false : Number(valeur);
    }
    if (zone.file) zones.push(zone);
  }
  if (zones.length === 0) throw new Error('Unreadable sound preset');
  return { zones };
}

async function loadPreset(audioContext, url, varName) {
  if (!window[varName]) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load ${varName}`);
    window[varName] = lirePreset(await res.text());
  }
  player.loader.decodeAfterLoading(audioContext, varName);
  // Échantillons décodés en tâche de fond : attendre qu'ils soient tous prêts (10 s au plus).
  for (let i = 0; i < 100 && !player.loader.loaded(varName); i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!player.loader.loaded(varName)) throw new Error(`Failed to decode ${varName}`);
}

export function isGuitarAudioReady() {
  return loaded;
}

/**
 * Convert abcjs noteMapTracks to a flat sorted event list.
 * Each event: { time (seconds), pitches[], duration (seconds), isChord }
 *
 * noteMapTracks is array of tracks, each track is array of:
 *   { pitch, instrument, start (whole notes), end (whole notes), volume }
 *
 * millisecondsPerMeasure comes from visualObj.millisecondsPerMeasure()
 */
export function buildGuitarEvents(noteMapTracks, millisecondsPerMeasure) {
  if (!noteMapTracks || noteMapTracks.length === 0) return [];

  // abcjs start/end are in "whole notes" (1 = whole note, 0.25 = quarter note)
  // millisecondsPerMeasure is for one measure (typically 4 beats in 4/4)
  // In 4/4 time, a whole note = one measure, so:
  // seconds = start * (millisecondsPerMeasure / 1000)
  const msPerWholeNote = millisecondsPerMeasure;
  const secPerWholeNote = msPerWholeNote / 1000;

  // Flatten all tracks into note events
  const allNotes = [];
  for (const track of noteMapTracks) {
    for (const note of track) {
      allNotes.push({
        pitch: note.pitch,
        startSec: note.start * secPerWholeNote,
        endSec: note.end * secPerWholeNote,
        volume: (note.volume || 80) / 127,
      });
    }
  }

  // Group notes by start time (within 10ms tolerance = same beat)
  allNotes.sort((a, b) => a.startSec - b.startSec);

  const events = [];
  let i = 0;
  while (i < allNotes.length) {
    const group = [allNotes[i]];
    const t = allNotes[i].startSec;
    i++;
    while (i < allNotes.length && Math.abs(allNotes[i].startSec - t) < 0.01) {
      group.push(allNotes[i]);
      i++;
    }

    const pitches = group.map(n => n.pitch);
    const maxEnd = Math.max(...group.map(n => n.endSec));
    const avgVolume = group.reduce((s, n) => s + n.volume, 0) / group.length;

    events.push({
      time: t,
      pitches,
      duration: maxEnd - t,
      volume: avgVolume,
      isChord: pitches.length >= 3,
    });
  }

  return events;
}

/**
 * Extract chord annotations from ABC code and assign them to events by time.
 * ABC chords look like "Bm", "A", "Em" etc. placed before notes.
 * We parse their position in beats and match to the closest event.
 */
export function assignChordsToEvents(events, code, millisecondsPerMeasure) {
  if (!events.length || !code) return;

  const secPerWholeNote = millisecondsPerMeasure / 1000;

  // Parse ABC to find chord annotations with their beat positions
  // Remove header lines (X:, T:, M:, etc.) and comments (%%)
  const bodyLines = code.split('\n').filter(line => {
    const trimmed = line.trim();
    return trimmed && !trimmed.match(/^[A-Z]:./) && !trimmed.startsWith('%%');
  });
  const body = bodyLines.join(' ');

  // Walk through the ABC body, tracking beat position
  const chordTimings = [];
  let beatPos = 0; // in eighth notes (L:1/8)
  let i = 0;

  while (i < body.length) {
    const ch = body[i];

    // Chord annotation: "ChordName"
    if (ch === '"') {
      const end = body.indexOf('"', i + 1);
      if (end > i) {
        const chordName = body.substring(i + 1, end);
        // Only keep actual chord names (not other annotations)
        if (chordName.match(/^[A-G][#b]?[m]?[a-z0-9]*$/i)) {
          const timeSec = (beatPos / 8) * secPerWholeNote; // 8 eighth notes = 1 whole note
          chordTimings.push({ time: timeSec, name: chordName });
        }
        i = end + 1;
        continue;
      }
    }

    // Bar line
    if (ch === '|') {
      i++;
      continue;
    }

    // Rest
    if (ch === 'z' || ch === 'x') {
      i++;
      // Check for duration modifier
      let dur = 1;
      let numStr = '';
      while (i < body.length && body[i] >= '0' && body[i] <= '9') {
        numStr += body[i]; i++;
      }
      if (numStr) dur = parseInt(numStr);
      // Check for /2 etc
      if (i < body.length && body[i] === '/') {
        i++;
        let denStr = '';
        while (i < body.length && body[i] >= '0' && body[i] <= '9') {
          denStr += body[i]; i++;
        }
        dur = dur / (denStr ? parseInt(denStr) : 2);
      }
      beatPos += dur;
      continue;
    }

    // Chord group [notes]
    if (ch === '[') {
      const end = body.indexOf(']', i + 1);
      if (end > i) {
        i = end + 1;
        // Check for duration modifier after ]
        let dur = 1;
        let numStr = '';
        while (i < body.length && body[i] >= '0' && body[i] <= '9') {
          numStr += body[i]; i++;
        }
        if (numStr) dur = parseInt(numStr);
        if (i < body.length && body[i] === '/') {
          i++;
          let denStr = '';
          while (i < body.length && body[i] >= '0' && body[i] <= '9') {
            denStr += body[i]; i++;
          }
          dur = dur / (denStr ? parseInt(denStr) : 2);
        }
        beatPos += dur;
        continue;
      }
    }

    // Note: A-G or a-g, possibly preceded by ^ _ =, possibly followed by , ' and duration
    if ((ch >= 'A' && ch <= 'G') || (ch >= 'a' && ch <= 'g')) {
      i++;
      // Skip octave modifiers
      while (i < body.length && (body[i] === ',' || body[i] === "'")) i++;
      // Duration
      let dur = 1;
      let numStr = '';
      while (i < body.length && body[i] >= '0' && body[i] <= '9') {
        numStr += body[i]; i++;
      }
      if (numStr) dur = parseInt(numStr);
      if (i < body.length && body[i] === '/') {
        i++;
        let denStr = '';
        while (i < body.length && body[i] >= '0' && body[i] <= '9') {
          denStr += body[i]; i++;
        }
        dur = dur / (denStr ? parseInt(denStr) : 2);
      }
      beatPos += dur;
      continue;
    }

    // Accidentals before notes
    if (ch === '^' || ch === '_' || ch === '=') {
      i++;
      continue;
    }

    // Whitespace or other
    i++;
  }

  // Now assign chord names to events by matching closest time
  if (chordTimings.length === 0) return;

  let ci = 0;
  for (const ev of events) {
    // Advance chord index to the latest chord that starts at or before this event
    while (ci + 1 < chordTimings.length && chordTimings[ci + 1].time <= ev.time + 0.05) {
      ci++;
    }
    if (chordTimings[ci].time <= ev.time + 0.05) {
      ev.chordName = chordTimings[ci].name;
    }
  }
}

// Standard guitar open string MIDI pitches: E2=40, A2=45, D3=50, G3=55, B3=59, E4=64
const OPEN_STRINGS = [40, 45, 50, 55, 59, 64];

/**
 * Convert chord frets to MIDI pitches.
 * frets: [-1, 0, 2, 2, 2, 0] means muted, open, fret2, fret2, fret2, open
 */
function chordFretsToMidi(frets, baseFret = 1) {
  const pitches = [];
  for (let i = 0; i < 6; i++) {
    if (frets[i] === -1) continue; // muted string
    pitches.push(OPEN_STRINGS[i] + frets[i]);
  }
  return pitches;
}

// Known chord shapes (same as GUITAR_CHORDS in DiagramBlocks)
const CHORD_SHAPES = {
  'C': [-1,3,2,0,1,0], 'D': [-1,-1,0,2,3,2], 'E': [0,2,2,1,0,0],
  'F': [1,3,3,2,1,1], 'G': [3,2,0,0,0,3], 'A': [-1,0,2,2,2,0],
  'B': [-1,2,4,4,4,2], 'Am': [-1,0,2,2,1,0], 'Em': [0,2,2,0,0,0],
  'Dm': [-1,-1,0,2,3,1], 'Bm': [-1,2,4,4,3,2], 'Em7': [0,2,2,0,3,0],
  'A7': [-1,0,2,0,2,0], 'Dsus4': [-1,-1,0,2,3,3], 'A7sus4': [-1,0,2,0,3,0],
};

/**
 * Play a single chord strum using WebAudioFont.
 * @param {string} chordName - e.g. "Bm", "Em"
 * @param {Object} options - { program, volume }
 */
export function playChordStrum(chordName, options = {}) {
  if (!loaded || !player) return;

  const frets = CHORD_SHAPES[chordName];
  if (!frets) return;

  const ctx = window.abcjsAudioContext;
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume();

  const preset = (options.program === 25) ? steelPreset : nylonPreset;
  if (!preset) return;

  const pitches = chordFretsToMidi(frets);
  const vol = options.volume ?? 0.6;

  player.queueStrumDown(ctx, ctx.destination, preset, ctx.currentTime, pitches, 1.5, vol);
}

/**
 * Play a single guitar event (note or chord) immediately.
 * @param {Object} event - single event from buildGuitarEvents()
 * @param {Object} options - { program, volume }
 */
export function playSingleGuitarEvent(event, options = {}) {
  if (!loaded || !player || !event || !event.pitches?.length) return;

  const ctx = window.abcjsAudioContext;
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume();

  const dest = options.destination || ctx.destination;
  const preset = (options.program === 25) ? steelPreset : nylonPreset;
  if (!preset) return;

  const vol = options.volume ?? 0.6;
  const dur = Math.min(event.duration || 0.8, 2.0);

  if (event.isChord && event.pitches.length >= 3) {
    player.queueStrumDown(ctx, dest, preset, ctx.currentTime, event.pitches, dur, vol);
  } else {
    for (const pitch of event.pitches) {
      player.queueWaveTable(ctx, dest, preset, ctx.currentTime, pitch, dur, vol);
    }
  }
}

/**
 * Play a guitar sequence using WebAudioFont.
 *
 * @param {Object[]} events - from buildGuitarEvents()
 * @param {Object} options
 * @param {AudioContext} options.audioContext
 * @param {AudioNode} options.destination - GainNode or audioContext.destination
 * @param {number} options.program - 24 (nylon) or 25 (steel)
 * @param {number} options.speed - 1.0 = normal
 * @param {number} options.volume - 0-1
 * @param {number} options.startFromIndex - event index to start from (default 0)
 * @param {Function} options.onEvent - callback(eventIndex, event)
 * @param {Function} options.onFinished - callback()
 */
export function playGuitarSequence(events, options = {}) {
  if (!loaded || !player || !events.length) return;

  stopGuitarPlayback();

  const ctx = options.audioContext || window.abcjsAudioContext;
  if (!ctx) return;

  // Resume AudioContext if suspended
  if (ctx.state === 'suspended') ctx.resume();

  const dest = options.destination || ctx.destination;
  const preset = (options.program === 25) ? steelPreset : nylonPreset;
  if (!preset) return;

  const speed = options.speed || 1;
  const vol = options.volume ?? 0.8;
  const startFrom = options.startFromIndex || 0;
  const timeOffset = startFrom > 0 && startFrom < events.length
    ? events[startFrom].time : 0;

  playbackState.playing = true;
  playbackState.events = events;
  playbackState.eventIndex = startFrom;
  playbackState.speed = speed;
  playbackState.volume = vol;
  playbackState.onEvent = options.onEvent || null;
  playbackState.onFinished = options.onFinished || null;
  playbackState.startTime = ctx.currentTime - (timeOffset / speed);

  // Calculate total duration
  const lastEvent = events[events.length - 1];
  playbackState.duration = (lastEvent.time + lastEvent.duration) / speed;

  // Schedule events from startFromIndex onward
  activeEnvelopes = [];
  let strumDown = true; // alternate strum direction

  for (let i = startFrom; i < events.length; i++) {
    const ev = events[i];
    const when = ctx.currentTime + ((ev.time - timeOffset) / speed);
    const dur = ev.duration / speed;
    const evVol = ev.volume * vol;

    if (ev.isChord && ev.pitches.length >= 3) {
      // Use strumming for chords
      let envelopes;
      if (strumDown) {
        envelopes = player.queueStrumDown(ctx, dest, preset, when, ev.pitches, dur, evVol);
      } else {
        envelopes = player.queueStrumUp(ctx, dest, preset, when, ev.pitches, dur, evVol);
      }
      if (envelopes) activeEnvelopes.push(...(Array.isArray(envelopes) ? envelopes : [envelopes]));
      strumDown = !strumDown;
    } else {
      // Single notes or double stops
      for (const pitch of ev.pitches) {
        const envelope = player.queueWaveTable(ctx, dest, preset, when, pitch, dur, evVol);
        if (envelope) activeEnvelopes.push(envelope);
      }
    }
  }

  // Set up event callbacks via polling (lightweight timer)
  scheduleEventCallbacks(ctx, speed);
}

function scheduleEventCallbacks(ctx, speed) {
  if (playbackTimer) clearInterval(playbackTimer);

  playbackTimer = setInterval(() => {
    if (!playbackState.playing) {
      clearInterval(playbackTimer);
      playbackTimer = null;
      return;
    }

    const elapsed = ctx.currentTime - playbackState.startTime;
    const events = playbackState.events;

    // Fire onEvent for events that have been reached
    while (
      playbackState.eventIndex < events.length &&
      events[playbackState.eventIndex].time / speed <= elapsed
    ) {
      if (playbackState.onEvent) {
        playbackState.onEvent(playbackState.eventIndex, events[playbackState.eventIndex]);
      }
      playbackState.eventIndex++;
    }

    // Check if playback is finished
    if (elapsed >= playbackState.duration) {
      playbackState.playing = false;
      clearInterval(playbackTimer);
      playbackTimer = null;
      if (playbackState.onFinished) playbackState.onFinished();
    }
  }, 30); // 30ms polling, fast enough for visual sync
}

/**
 * Stop all guitar playback.
 */
export function stopGuitarPlayback() {
  playbackState.playing = false;

  if (playbackTimer) {
    clearInterval(playbackTimer);
    playbackTimer = null;
  }

  // Cancel all active sound envelopes
  for (const env of activeEnvelopes) {
    try { env.cancel?.(); } catch {}
  }
  activeEnvelopes = [];

  // Also use player's cancelQueue if available
  const ctx = window.abcjsAudioContext;
  if (player && ctx) {
    try { player.cancelQueue(ctx); } catch {}
  }
}

/**
 * Set volume (0-1). Affects currently playing and future notes.
 */
export function setGuitarVolume(v) {
  playbackState.volume = Math.max(0, Math.min(1, v));
}

/**
 * Get playback progress (0-1).
 */
export function getGuitarProgress() {
  if (!playbackState.playing || !playbackState.duration) return 0;
  const ctx = window.abcjsAudioContext;
  if (!ctx) return 0;
  const elapsed = ctx.currentTime - playbackState.startTime;
  return Math.min(1, elapsed / playbackState.duration);
}

/**
 * Get total duration in seconds.
 */
export function getGuitarDuration() {
  return playbackState.duration || 0;
}

/**
 * Check if currently playing.
 */
export function isGuitarPlaying() {
  return playbackState.playing;
}
