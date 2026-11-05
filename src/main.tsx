import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { isPreviewBuild } from './lib/config';
import { ToastHost } from './ui';
// Fonts ship with the app (no third-party requests, and they work offline).
import '@fontsource/rubik/latin-400.css';
import '@fontsource/rubik/latin-500.css';
import '@fontsource/rubik/latin-600.css';
import '@fontsource/rubik/latin-700.css';
import '@fontsource/permanent-marker/latin-400.css';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastHost>
      <App />
    </ToastHost>
  </StrictMode>,
);

// Offline support and "Add to Home Screen" install. Skipped in development
// and in the single-file preview build.
if (import.meta.env.PROD && !isPreviewBuild && 'serviceWorker' in navigator && window.self === window.top) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* the app works fine without it */
    });
  });
}
