/**
 * main.tsx — Ponto de entrada do React.
 * Monta a aplicação na div#root do index.html.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// Fontes auto-hospedadas (subset latin, só os pesos usados)
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/inter/latin-800.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/jetbrains-mono/latin-700.css';
import './styles/global.css';

// PWA: registra o service worker apenas em produção, em origem segura (não no Electron, protocolo 'app:').
if (
  import.meta.env.PROD &&
  'serviceWorker' in navigator &&
  (location.protocol === 'https:' ||
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1')
) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[KIARA] Falha ao registrar o service worker:', err);
    });
  });
}

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
