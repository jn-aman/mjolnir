import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, type FlagState } from './api.ts';

/**
 * Flag values, read once and shared.
 *
 * The values are resolved on the server, where the override, the Unleash
 * answer and the build default all live, so the UI never has to know the
 * precedence rules; it asks whether a thing is on.
 *
 * Until the first answer arrives every flag reads false. That is the right way
 * round: a module that flickers into the rail and out again is worse than one
 * that appears a beat late, and a feature nobody has enabled should never show
 * even for a frame.
 */
interface FlagsValue {
  readonly values: Readonly<Record<string, boolean>>;
  readonly states: readonly FlagState[];
  readonly ready: boolean;
  readonly refresh: () => Promise<void>;
}

const FlagsContext = createContext<FlagsValue>({ values: {}, states: [], ready: false, refresh: async () => {} });

export function FlagsProvider({ children }: { children: ReactNode }) {
  const [states, setStates] = useState<readonly FlagState[]>([]);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await api.flags.list();
      setStates(response.flags);
    } catch {
      // Keep whatever we had. A flag list that fails to load must not take the
      // app with it, and every flag already has a compiled-in default.
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    // Settings changes and the flag poller both land here; a window that has
    // been open for a day should not still be showing yesterday's rail.
    const timer = setInterval(() => void refresh(), 60_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const value = useMemo<FlagsValue>(
    () => ({ values: Object.fromEntries(states.map((state) => [state.id, state.value])), states, ready, refresh }),
    [states, ready, refresh],
  );

  return <FlagsContext.Provider value={value}>{children}</FlagsContext.Provider>;
}

export function useFlags(): FlagsValue {
  return useContext(FlagsContext);
}

export function useFlag(id: string): boolean {
  return useContext(FlagsContext).values[id] ?? false;
}
