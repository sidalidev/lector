// En premier : efface les données locales des anciennes versions et tout ancien lien d'appairage.
import './services/nettoyage';
import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import './styles/shared.css';

// Block all pinch-to-zoom globally (iOS Safari / WKWebView)
document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
document.addEventListener('gesturechange', (e) => e.preventDefault(), { passive: false });
document.addEventListener('gestureend', (e) => e.preventDefault(), { passive: false });
document.addEventListener('touchmove', (e) => {
  if (e.touches.length > 1) e.preventDefault();
}, { passive: false });

// /d/<id> : document partagé, seul (docs/collab-design.md § 8). Yjs et le code
// de co-écriture ne sont chargés que sur cette route ; l'application complète
// n'y est pas chargée non plus.
const PAGE_PARTAGEE = /\/d\/[0-9a-f]{32}\/?$/.test(location.pathname);

const racine = PAGE_PARTAGEE
  ? import('./components/collab/SharedDoc.jsx')
  : import('./App');

racine.then(({ default: Racine }) => {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <Racine />
    </React.StrictMode>
  );
});
