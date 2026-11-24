import { useEffect, useState } from 'react';
import { Icon } from './Icon';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Shows "Install app" when running in a browser that supports installing the PWA (Chrome / Edge). */
export function InstallButton() {
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);
  useEffect(() => {
    const h = (e: Event) => {
      e.preventDefault();
      setEvt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', h);
    window.addEventListener('appinstalled', () => setEvt(null));
    return () => window.removeEventListener('beforeinstallprompt', h);
  }, []);
  if (!evt) return null;
  return (
    <button
      className="nav-btn"
      onClick={async () => {
        await evt.prompt();
        await evt.userChoice;
        setEvt(null);
      }}
    >
      <span className="nav-icon"><Icon name="download" /></span>
      <span>Install</span>
    </button>
  );
}
