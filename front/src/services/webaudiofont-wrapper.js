// Wrapper to properly export WebAudioFont classes
// The webaudiofont npm package uses `var` declarations without module.exports,
// so in ESM bundlers the classes are scoped and inaccessible.
// The file is served with the app and loaded as a classic script, so that
// `var WebAudioFontPlayer = ...` lands on window (no inline script: the CSP forbids it).

import playerUrl from 'webaudiofont/npm/dist/WebAudioFontPlayer.js?url';

let chargement = null;

function ensureLoaded() {
  chargement ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = playerUrl;
    script.onload = resolve;
    script.onerror = () => reject(new Error('WebAudioFontPlayer failed to load'));
    document.head.appendChild(script);
  });
  return chargement;
}

export async function createWebAudioFontPlayer() {
  await ensureLoaded();
  return new window.WebAudioFontPlayer();
}
