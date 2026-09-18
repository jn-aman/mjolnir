import { useCallback, useEffect, useState } from 'react';

/**
 * Per-kind table preferences.
 *
 * Column widths, order and visibility are stored per resource kind, because the
 * columns that matter for Pods are not the ones that matter for Secrets and a
 * single shared layout would be wrong for both.
 *
 * Kept in localStorage, which can throw in a private window or with site data
 * blocked. Every read and write is guarded: losing a saved layout is a small
 * annoyance, and a crash on startup is not.
 */

export interface TablePrefs {
  readonly order: string[];
  readonly hidden: string[];
  readonly widths: Record<string, number>;
}

const EMPTY: TablePrefs = { order: [], hidden: [], widths: {} };

const key = (kind: string) => `mjolnir.table.${kind}`;

function read(kind: string): TablePrefs {
  try {
    const raw = localStorage.getItem(key(kind));
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<TablePrefs>;
    return {
      order: Array.isArray(parsed.order) ? parsed.order : [],
      hidden: Array.isArray(parsed.hidden) ? parsed.hidden : [],
      widths: typeof parsed.widths === 'object' && parsed.widths ? parsed.widths : {},
    };
  } catch {
    return EMPTY;
  }
}

function write(kind: string, prefs: TablePrefs): void {
  try {
    localStorage.setItem(key(kind), JSON.stringify(prefs));
  } catch {
    // A layout that cannot be saved still works for this session.
  }
}

export function useTablePrefs(kind: string) {
  const [prefs, setPrefs] = useState<TablePrefs>(() => read(kind));

  useEffect(() => {
    setPrefs(read(kind));
  }, [kind]);

  const update = useCallback(
    (patch: Partial<TablePrefs>) => {
      setPrefs((current) => {
        const next = { ...current, ...patch };
        write(kind, next);
        return next;
      });
    },
    [kind],
  );

  const reset = useCallback(() => {
    setPrefs(EMPTY);
    try {
      localStorage.removeItem(key(kind));
    } catch {
      /* nothing to clear */
    }
  }, [kind]);

  return { prefs, update, reset };
}
