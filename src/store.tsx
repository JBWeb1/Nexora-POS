import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AppState, Staff } from './types';
import { migrate, seedState } from './lib/seed';
import { getPersistence } from './lib/persistence';

const persistence = getPersistence();

interface Ctx {
  state: AppState;
  /** Apply a mutation to a copy of state. Throws propagate to the caller, leaving state unchanged. */
  update: <T>(fn: (draft: AppState) => T) => T;
  user: Staff | undefined;
  setUserId: (id: string | null) => void;
  reset: () => void;
  replace: (s: AppState) => void;
  storage: 'sqlite' | 'browser';
  saveError: string | null;
}

const StoreContext = createContext<Ctx | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    persistence
      .load()
      .then((s) => setState(s ? migrate(s) : seedState()))
      .catch((e: Error) => setLoadError(e.message));
  }, []);

  if (loadError) return <div className="center-card"><h2>Could not open the database</h2><p className="error">{loadError}</p></div>;
  if (!state) return <div className="center-card"><p className="muted">Opening database…</p></div>;
  return <LoadedStore initial={state}>{children}</LoadedStore>;
}

function LoadedStore({ initial, children }: { initial: AppState; children: ReactNode }) {
  const [state, setState] = useState<AppState>(initial);
  const [userId, setUserId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const ref = useRef(state);
  ref.current = state;
  const dirty = useRef(false);

  // Debounced save: quick bursts of changes become a single database write.
  useEffect(() => {
    if (state === initial && !dirty.current) return;
    dirty.current = true;
    const t = setTimeout(() => {
      persistence
        .save(state)
        .then(() => {
          dirty.current = false;
          setSaveError(null);
        })
        .catch((e: Error) => setSaveError(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [state, initial]);

  // Never lose the last sale when the window closes.
  useEffect(() => {
    const h = () => {
      if (dirty.current) persistence.saveNow(ref.current);
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, []);

  const update = useCallback(<T,>(fn: (draft: AppState) => T): T => {
    const draft = structuredClone(ref.current);
    const result = fn(draft);
    ref.current = draft;
    setState(draft);
    return result;
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      state,
      update,
      user: state.staff.find((s) => s.id === userId),
      setUserId,
      reset: () => {
        const s = seedState();
        ref.current = s;
        setState(s);
        setUserId(null);
      },
      replace: (s) => {
        ref.current = s;
        setState(s);
      },
      storage: persistence.kind,
      saveError,
    }),
    [state, update, userId, saveError],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Ctx {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore outside provider');
  return ctx;
}
