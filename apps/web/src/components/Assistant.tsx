import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUp, ChevronDown, ChevronRight, Sparkles, Square, Wrench } from 'lucide-react';
import { Button } from './ui/Button.tsx';
import { copyEntry, Menu, type MenuEntry } from './ui/ContextMenu.tsx';

/**
 * The assistant, in the dock.
 *
 * A conversation with a model that has the same tools the MCP server exposes.
 * Every tool call is shown as it happens, with its input and result, because
 * an answer you cannot trace is an answer you cannot trust. Streams over SSE
 * from /api/ai/chat; the key never reaches this code.
 */

interface ToolStep {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
  ok?: boolean;
  result?: string;
}

interface Turn {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  text: string;
  steps: ToolStep[];
  error?: string;
  done: boolean;
}

interface AssistantProps {
  readonly context: string | null;
  /** A prompt handed in from a right-click; sent when it changes. */
  readonly incoming: { readonly id: number; readonly text: string } | null;
  readonly onOpenSettings: () => void;
}

const SUGGESTIONS = ['What is wrong in this cluster?', 'Which pods restarted in the last hour, and why?', 'Is anything over-committed on CPU or memory?'];

export function Assistant({ context, incoming, onOpenSettings }: AssistantProps) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const seen = useRef<number>(-1);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [turns]);

  const send = async (text: string) => {
    const prompt = text.trim();
    if (!prompt || busy) return;
    const history = [...turns.filter((t) => !t.error).map((t) => ({ role: t.role, content: t.text })), { role: 'user' as const, content: prompt }];
    const reply: Turn = { id: `a${Date.now()}`, role: 'assistant', text: '', steps: [], done: false };
    setTurns((current) => [...current, { id: `u${Date.now()}`, role: 'user', text: prompt, steps: [], done: true }, reply]);
    setDraft('');
    setBusy(true);
    const controller = new AbortController();
    abort.current = controller;
    const patch = (fn: (turn: Turn) => void) =>
      setTurns((current) => current.map((t) => (t.id === reply.id ? (() => { const copy = { ...t, steps: [...t.steps] }; fn(copy); return copy; })() : t)));
    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ context, messages: history }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => null)) as { message?: string; error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? body?.message ?? `${response.status} ${response.statusText}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let index: number;
        while ((index = buffer.indexOf('\n\n')) !== -1) {
          const chunk = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const line = chunk.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          const event = JSON.parse(line.slice(6)) as { type: string; text?: string; id?: string; name?: string; input?: unknown; ok?: boolean; message?: string };
          if (event.type === 'text') patch((t) => { t.text += event.text ?? ''; });
          else if (event.type === 'tool_call') patch((t) => { t.steps.push({ id: event.id ?? '', name: event.name ?? '', input: event.input }); });
          else if (event.type === 'tool_result') patch((t) => { const step = t.steps.find((s) => s.id === event.id); if (step) { step.ok = event.ok ?? true; step.result = event.text ?? ''; } });
          else if (event.type === 'error') patch((t) => { t.error = event.message ?? 'unknown error'; });
        }
      }
      patch((t) => { t.done = true; });
    } catch (error) {
      if (!controller.signal.aborted) patch((t) => { t.error = error instanceof Error ? error.message : String(error); t.done = true; });
      else patch((t) => { t.done = true; });
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  useEffect(() => {
    if (incoming && incoming.id !== seen.current) {
      seen.current = incoming.id;
      void send(incoming.text);
    }
    // send is recreated every render; the id guard makes this safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming]);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="assistant">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {turns.length === 0 ? (
          <div className="mx-auto max-w-[560px] py-6 text-center">
            <Sparkles size={20} strokeWidth={1.8} aria-hidden className="mx-auto mb-2 text-accent" />
            <p className="text-[13px] text-secondary">Ask about the cluster you are looking at. The assistant reads it with the same tools the MCP server exposes and shows every call.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => void send(s)} className="rounded-full border border-line bg-raised px-3 py-1 text-[12px] text-secondary transition-colors duration-100 hover:border-strong hover:text-primary">
                  {s}
                </button>
              ))}
            </div>
            <button type="button" onClick={onOpenSettings} className="mt-4 text-[11.5px] text-tertiary underline-offset-2 hover:text-secondary hover:underline">
              Provider, model and permissions are in Settings › AI assistant
            </button>
          </div>
        ) : null}
        <div className="mx-auto max-w-[860px] space-y-3">
          <AnimatePresence initial={false}>
            {turns.map((turn) => (
              <motion.div key={turn.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 480, damping: 36 }} data-testid={`turn-${turn.role}`}>
                {turn.role === 'user' ? (
                  <div className="ml-auto max-w-[80%] whitespace-pre-wrap rounded-xl rounded-br-sm bg-accent-subtle px-3 py-2 text-[13px] text-primary">{turn.text}</div>
                ) : (
                  <div className="space-y-2">
                    {turn.steps.map((step) => (
                      <Step key={step.id} step={step} />
                    ))}
                    {turn.text ? (
                      <Menu label="answer" entries={copyEntry('copy', 'Copy answer', turn.text)}>
                        <div className="whitespace-pre-wrap text-[13px] leading-[20px] text-primary">{turn.text}{!turn.done ? <span className="ml-0.5 inline-block h-[14px] w-[2px] animate-pulse bg-accent align-middle" /> : null}</div>
                      </Menu>
                    ) : !turn.done && turn.steps.length === 0 ? (
                      <div className="text-[12.5px] text-tertiary">Thinking…</div>
                    ) : null}
                    {turn.error ? <div className="rounded-md border border-[var(--status-error-border)] bg-error-bg px-3 py-2 text-[12.5px] text-error">{turn.error}</div> : null}
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
          <div ref={bottom} />
        </div>
      </div>
      <div className="shrink-0 border-t border-line bg-raised p-2.5">
        <div className="mx-auto flex max-w-[860px] items-end gap-2 rounded-xl border border-line bg-sunken px-3 py-2 focus-within:border-focus">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void send(draft);
              }
            }}
            rows={Math.min(6, Math.max(1, draft.split('\n').length))}
            placeholder={context ? `Ask about ${context}…` : 'Ask about a cluster…'}
            aria-label="Message the assistant"
            data-testid="assistant-input"
            className="max-h-[160px] min-h-[24px] flex-1 resize-none bg-transparent text-[13px] text-primary outline-none placeholder:text-tertiary"
          />
          {busy ? (
            <Button iconOnly aria-label="Stop" onClick={() => abort.current?.abort()} icon={<Square size={12} strokeWidth={2.2} />} />
          ) : (
            <Button iconOnly variant="primary" aria-label="Send" data-testid="assistant-send" disabled={!draft.trim()} onClick={() => void send(draft)} icon={<ArrowUp size={14} strokeWidth={2.4} />} />
          )}
        </div>
      </div>
    </div>
  );
}

function Step({ step }: { step: ToolStep }) {
  const [open, setOpen] = useState(false);
  const summary = Object.entries((step.input as Record<string, unknown>) ?? {})
    .filter(([key]) => key !== 'context')
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(' ');
  const entries: MenuEntry[] = [...copyEntry('copy-input', 'Copy input', JSON.stringify(step.input, null, 2)), ...copyEntry('copy-result', 'Copy result', step.result)];
  return (
    <Menu label={step.name} entries={entries}>
      <div className="rounded-lg border border-line bg-raised" data-testid="assistant-step">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px]">
          {open ? <ChevronDown size={12} strokeWidth={2} aria-hidden className="text-tertiary" /> : <ChevronRight size={12} strokeWidth={2} aria-hidden className="text-tertiary" />}
          <Wrench size={12} strokeWidth={1.9} aria-hidden className="text-accent" />
          <span className="font-mono text-primary">{step.name}</span>
          <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere] font-mono text-[11.5px] text-tertiary">{summary}</span>
          {step.ok === undefined ? (
            <span className="h-[6px] w-[6px] animate-pulse rounded-full bg-accent" aria-label="running" />
          ) : step.ok ? (
            <span className="text-[10.5px] uppercase tracking-wide text-ok">ok</span>
          ) : (
            <span className="text-[10.5px] uppercase tracking-wide text-error">failed</span>
          )}
        </button>
        {open && step.result !== undefined ? (
          <pre className="max-h-[260px] overflow-auto border-t border-line px-3 py-2 font-mono text-[11.5px] leading-[17px] text-secondary">{step.result}</pre>
        ) : null}
      </div>
    </Menu>
  );
}
