import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { StoreProvider } from './store';
import { UiProvider } from './components/ui';
import { App } from './App';
import '@fontsource-variable/inter';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>
      <UiProvider>
        <App />
      </UiProvider>
    </StoreProvider>
  </StrictMode>,
);

// Offline support + installability. Skipped inside the Electron desktop app (file:// has no service workers).
if ('serviceWorker' in navigator && location.protocol.startsWith('http') && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js'));
}
