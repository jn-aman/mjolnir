import { useCallback, useState } from 'react';

/**
 * State that outlives the component.
 *
 * Modules unmount when you leave them, which is right: a bucket listing should
 * not keep polling while you read pods. What is not right is coming back to a
 * blank connection picker and losing the folder you were eight levels into.
 * So the value lives in a module-scoped map keyed by name, and the component
 * picks it back up on mount.
 *
 * Deliberately in memory only. This is "where I was", not a preference: it
 * should survive a tab change and not survive a restart, and it must never
 * hold anything worth writing to disk.
 */
const memory = new Map<string, unknown>();

export function useSticky<T>(key: string, initial: T | (() => T)): [T, (next: T | ((current: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    if (memory.has(key)) return memory.get(key) as T;
    return typeof initial === 'function' ? (initial as () => T)() : initial;
  });

  const set = useCallback(
    (next: T | ((current: T) => T)) => {
      setValue((current) => {
        const resolved = typeof next === 'function' ? (next as (c: T) => T)(current) : next;
        memory.set(key, resolved);
        return resolved;
      });
    },
    [key],
  );

  return [value, set];
}

/** Drops a remembered value, for when the thing it pointed at is gone. */
export function forgetSticky(key: string): void {
  memory.delete(key);
}
