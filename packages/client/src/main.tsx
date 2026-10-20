/// <reference types="vite/client" />
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { newDraft } from './editor/draft.js';
import { bootEditor, sessionStore, workOf, type EditorBoot } from './editor/session.js';
import { registerServiceWorker, watchInstallOffer } from './pwa.js';
import './ui.css';
import './styles/coldopen.css';
import './styles/editor.css';
import './styles/voice.css';
import './styles/world.css';
import './styles/lobby.css';
import './styles/devices.css';
import './styles/book.css';
import './styles/pwa.css';
import './styles/https.css';
import './styles/history.css';
import './styles/seed.css';
import './styles/polish.css';

watchInstallOffer();
// The worker caches the build; `vite` serves none, and a worker would stand in its way.
if (import.meta.env.PROD) {
  registerServiceWorker();
}

const root = document.getElementById('root');
if (root === null) {
  throw new Error('index.html is missing the #root element');
}
// The address may open the editor, with a mission a shared link packed into it: unpacked first,
// so the editor's first frame shows it. Should that fail outright, the app starts plain.
void bootEditor(window.location, sessionStore())
  .catch((err: unknown): EditorBoot => {
    console.error('[escapelab] the address could not be read for the editor:', err);
    return { open: false, work: workOf(newDraft()), status: null };
  })
  .then((boot) => {
    createRoot(root).render(
      <StrictMode>
        <App boot={boot} />
      </StrictMode>,
    );
  });
