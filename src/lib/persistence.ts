import type { AppState } from '../types';

interface DesktopApi {
  load: () => Promise<AppState | null>;
  save: (s: AppState) => Promise<boolean>;
  saveSync: (s: AppState) => boolean;
  info: () => Promise<{ path: string; backups: string }>;
  openDataFolder: () => Promise<string>;
  mcpConfig: () => Promise<{ command: string; args: string[]; env: Record<string, string> }>;
}

declare global {
  interface Window {
    nexoraDesktop?: DesktopApi;
  }
}

export const desktop: DesktopApi | undefined = typeof window !== 'undefined' ? window.nexoraDesktop : undefined;

/** Where data lives: an SQLite file in the desktop app, browser storage otherwise. */
export interface Persistence {
  kind: 'sqlite' | 'browser';
  load: () => Promise<AppState | null>;
  save: (s: AppState) => Promise<void>;
  saveNow: (s: AppState) => void;
}

const KEY = 'nexora-pos-state-v1';

export function getPersistence(): Persistence {
  if (desktop) {
    return {
      kind: 'sqlite',
      load: () => desktop.load(),
      save: async (s) => {
        await desktop.save(s);
      },
      saveNow: (s) => {
        desktop.saveSync(s);
      },
    };
  }
  const write = (s: AppState) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* storage full or blocked; keep running in memory */
    }
  };
  return {
    kind: 'browser',
    load: async () => {
      try {
        const raw = localStorage.getItem(KEY);
        return raw ? (JSON.parse(raw) as AppState) : null;
      } catch {
        return null;
      }
    },
    save: async (s) => write(s),
    saveNow: write,
  };
}
