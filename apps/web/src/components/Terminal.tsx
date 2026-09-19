import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { RotateCw } from 'lucide-react';
import { execSocketUrl } from '../lib/api.ts';
import { Button } from './ui/Button.tsx';
import { copyText, Menu, SEPARATOR, type MenuEntry } from './ui/ContextMenu.tsx';

/**
 * A shell in a container, in the dock.
 *
 * xterm on the client, the API server's exec WebSocket on the other end, our
 * server bridging the two. Keystrokes go up as JSON, bytes come down as
 * binary frames. The terminal takes the Storm colours from the tokens so it
 * follows the theme with the rest of the app.
 */
interface TerminalProps {
  readonly source?: 'kubernetes' | 'docker' | undefined;
  readonly context: string;
  readonly namespace: string;
  readonly pod: string;
  readonly container?: string | undefined;
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function Terminal({ source, context, namespace, pod, container }: TerminalProps) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<XTerm | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const [state, setState] = useState<'connecting' | 'open' | 'exited' | 'error'>('connecting');
  const [note, setNote] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (!host.current) return;
    const xterm = new XTerm({
      cursorBlink: true,
      fontFamily: cssVar('--font-mono') || 'ui-monospace, monospace',
      fontSize: 12.5,
      lineHeight: 1.25,
      scrollback: 5000,
      theme: {
        background: cssVar('--surface-sunken') || '#0b0e14',
        foreground: cssVar('--log-body') || '#d7dce6',
        cursor: cssVar('--accent-base') || '#3987e5',
        selectionBackground: cssVar('--accent-subtle') || '#1e3a5f',
        red: cssVar('--status-error') || '#ff7e84',
        green: cssVar('--status-ok') || '#3ddc97',
        yellow: cssVar('--status-warn') || '#f5c451',
        blue: cssVar('--series-1') || '#3987e5',
        magenta: cssVar('--log-pod-b') || '#b48ef2',
        cyan: cssVar('--series-3') || '#199e70',
        white: cssVar('--text-primary') || '#eef1f7',
      },
    });
    const fit = new FitAddon();
    xterm.loadAddon(fit);
    xterm.loadAddon(new WebLinksAddon());
    xterm.open(host.current);
    fit.fit();
    term.current = xterm;

    const ws = new WebSocket(execSocketUrl());
    ws.binaryType = 'arraybuffer';
    socket.current = ws;
    setState('connecting');
    setNote(null);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'start', ...(source ? { source } : {}), context, namespace, pod, container, cols: xterm.cols, rows: xterm.rows }));
      setState('open');
      xterm.focus();
    };
    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        xterm.write(new Uint8Array(event.data));
        return;
      }
      try {
        const message = JSON.parse(String(event.data)) as { type: string; code?: number | null; message?: string; shell?: string };
        if (message.type === 'shell') {
          setNote(message.shell ?? null);
          return;
        }
        if (message.type === 'exit') {
          setState('exited');
          setNote(message.code === null || message.code === undefined ? 'Session ended' : `Exited with code ${message.code}${message.message ? `: ${message.message}` : ''}`);
          xterm.write('\r\n\x1b[2m[session ended]\x1b[0m\r\n');
        } else if (message.type === 'error') {
          setState('error');
          setNote(message.message ?? 'exec failed');
          xterm.write(`\r\n\x1b[31m${message.message ?? 'exec failed'}\x1b[0m\r\n`);
        }
      } catch {
        xterm.write(String(event.data));
      }
    };
    ws.onclose = () => setState((current) => (current === 'open' || current === 'connecting' ? 'exited' : current));
    ws.onerror = () => {
      setState('error');
      setNote('Could not reach the server');
    };
    const input = xterm.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data }));
    });
    const observer = new ResizeObserver(() => {
      fit.fit();
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols: xterm.cols, rows: xterm.rows }));
    });
    observer.observe(host.current);

    return () => {
      observer.disconnect();
      input.dispose();
      ws.close();
      xterm.dispose();
      term.current = null;
      socket.current = null;
    };
  }, [source, context, namespace, pod, container, generation]);

  const entries: MenuEntry[] = [
    {
      id: 'copy',
      label: 'Copy selection',
      onSelect: () => {
        const text = term.current?.getSelection();
        if (text) copyText(text, 'Copied');
      },
    },
    { id: 'paste', label: 'Paste', onSelect: () => void navigator.clipboard?.readText().then((text) => socket.current?.send(JSON.stringify({ type: 'input', data: text }))) },
    { id: 'clear', label: 'Clear', onSelect: () => term.current?.clear() },
    SEPARATOR,
    { id: 'reconnect', label: 'Reconnect', onSelect: () => setGeneration((g) => g + 1) },
  ];

  return (
    <Menu label={`${pod}${container ? ` · ${container}` : ''}`} entries={entries} testId="terminal-menu">
      <div className="relative flex min-h-0 flex-1 flex-col bg-sunken" data-testid="terminal" data-state={state}>
        <div ref={host} className="min-h-0 flex-1 px-2 pt-1" />
        {state === 'open' && note ? (
          <div className="pointer-events-none absolute right-3 top-2 rounded-full border border-line bg-raised px-2 py-[2px] font-mono text-[10.5px] text-tertiary" data-testid="terminal-shell">{note}</div>
        ) : null}
        {state === 'exited' || state === 'error' ? (
          <div className="flex shrink-0 items-center gap-2 border-t border-line bg-raised px-3 py-1.5 text-[11.5px] text-tertiary">
            <span className={state === 'error' ? 'text-error' : ''}>{note}</span>
            <div className="flex-1" />
            <Button variant="ghost" onClick={() => setGeneration((g) => g + 1)} icon={<RotateCw size={12} strokeWidth={1.9} />}>
              Reconnect
            </Button>
          </div>
        ) : null}
      </div>
    </Menu>
  );
}
