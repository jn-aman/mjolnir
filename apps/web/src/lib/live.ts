import { useEffect, useRef, useState } from 'react';
import type { WatchState } from '@mjolnir/k8s';
import { logSocketUrl } from './api.ts';

/**
 * The live wire.
 *
 * One WebSocket to /ws/watch carries every list and count the screen shows.
 * A subscription is an id and a query; the server pushes a snapshot whenever
 * the watch cache changes, so a pod that dies shows up dead within a frame
 * or two, with no polling and no refresh button that matters.
 */

type Listener = (message: Record<string, unknown>) => void;

class LiveConnection {
  #socket: WebSocket | null = null;
  #listeners = new Map<string, Listener>();
  #pending = new Map<string, unknown>();
  #reconnect: ReturnType<typeof setTimeout> | null = null;
  #seq = 0;
  #open = false;
  #stateListeners = new Set<(open: boolean) => void>();

  get open(): boolean {
    return this.#open;
  }

  onState(listener: (open: boolean) => void): () => void {
    this.#stateListeners.add(listener);
    return () => void this.#stateListeners.delete(listener);
  }

  #ensure(): void {
    if (this.#socket && (this.#socket.readyState === WebSocket.OPEN || this.#socket.readyState === WebSocket.CONNECTING)) return;
    const socket = new WebSocket(logSocketUrl().replace(/\/ws\/logs$/, '/ws/watch'));
    this.#socket = socket;
    socket.onopen = () => {
      this.#open = true;
      this.#stateListeners.forEach((fn) => fn(true));
      for (const message of this.#pending.values()) socket.send(JSON.stringify(message));
    };
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as Record<string, unknown>;
        const id = String(message['id'] ?? '');
        this.#listeners.get(id)?.(message);
      } catch {
        // Not JSON; nothing we sent asks for that.
      }
    };
    socket.onclose = () => {
      this.#open = false;
      this.#stateListeners.forEach((fn) => fn(false));
      this.#socket = null;
      if (this.#listeners.size && !this.#reconnect) {
        this.#reconnect = setTimeout(() => {
          this.#reconnect = null;
          this.#ensure();
        }, 800);
      }
    };
    socket.onerror = () => socket.close();
  }

  subscribe(query: Record<string, unknown>, listener: Listener): () => void {
    const id = `s${(this.#seq += 1)}`;
    const message = { type: 'subscribe', id, ...query };
    this.#listeners.set(id, listener);
    this.#pending.set(id, message);
    this.#ensure();
    if (this.#socket?.readyState === WebSocket.OPEN) this.#socket.send(JSON.stringify(message));
    return () => {
      this.#listeners.delete(id);
      this.#pending.delete(id);
      if (this.#socket?.readyState === WebSocket.OPEN) this.#socket.send(JSON.stringify({ type: 'unsubscribe', id }));
    };
  }
}

export const live = new LiveConnection();

export interface LiveList<T> {
  readonly items: T[];
  readonly state: WatchState;
  readonly error: string | null;
  readonly updatedAt: string | null;
}

/** A kind's list, kept current by the server. */
export function useLiveList<T>(context: string | null, kind: string | null, namespace: string | undefined): LiveList<T> {
  const [value, setValue] = useState<LiveList<T>>({ items: [], state: 'idle', error: null, updatedAt: null });
  useEffect(() => {
    if (!context || !kind) {
      setValue({ items: [], state: 'idle', error: null, updatedAt: null });
      return;
    }
    setValue({ items: [], state: 'connecting', error: null, updatedAt: null });
    const stop = live.subscribe({ context, kind, ...(namespace ? { namespace } : {}) }, (message) => {
      if (message['type'] === 'snapshot') {
        setValue({ items: (message['items'] as T[]) ?? [], state: (message['state'] as WatchState) ?? 'synced', error: (message['error'] as string | null) ?? null, updatedAt: (message['updatedAt'] as string | null) ?? null });
      } else if (message['type'] === 'error') {
        setValue((current) => ({ ...current, state: 'error', error: String(message['message'] ?? 'watch failed') }));
      }
    });
    return stop;
  }, [context, kind, namespace]);
  return value;
}

/** Every kind's count for a cluster, live. */
export function useLiveCounts(context: string | null): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    setCounts({});
    if (!context) return;
    return live.subscribe({ context, counts: true }, (message) => {
      if (message['type'] === 'counts') setCounts({ ...(message['counts'] as Record<string, number>) });
    });
  }, [context]);
  return counts;
}

/** Whether the live wire is up, for the header's pulse. */
export function useLiveState(): boolean {
  const [open, setOpen] = useState(live.open);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const stop = live.onState((next) => {
      if (mounted.current) setOpen(next);
    });
    return () => {
      mounted.current = false;
      stop();
    };
  }, []);
  return open;
}
