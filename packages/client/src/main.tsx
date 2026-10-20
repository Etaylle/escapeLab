/// <reference types="vite/client" />
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { registerServiceWorker, watchInstallOffer } from './pwa.js';
import './ui.css';
import './styles/voice.css';
import './styles/world.css';
import './styles/lobby.css';
import './styles/devices.css';
import './styles/book.css';
import './styles/pwa.css';
import './styles/https.css';
import './styles/seed.css';

watchInstallOffer();
// The worker caches the build; `vite` serves none, and a worker would stand in its way.
if (import.meta.env.PROD) {
  registerServiceWorker();
}

const root = document.getElementById('root');
if (root === null) {
  throw new Error('index.html is missing the #root element');
}
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
