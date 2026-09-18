import { Copy } from 'lucide-react';
import { Button } from './ui/Button.tsx';
import { copyEntry, copyText, Menu } from './ui/ContextMenu.tsx';
import type { ToolDefinition } from '../lib/tools.ts';

/**
 * The page a planned tool opens to.
 *
 * It says what the tool will do and gives the command that does it today, so
 * the slot is useful before the feature is. It does not pretend: no empty
 * table, no disabled buttons dressed as a preview.
 */
export function ToolPanel({ tool, section }: { readonly tool: ToolDefinition; readonly section?: string | undefined }) {
  const Icon = tool.icon;
  return (
    <div className="mjolnir-fade-in flex min-h-0 flex-1 flex-col overflow-y-auto" data-testid={`tool-${tool.id}`}>
      <div className="mx-auto w-full max-w-[760px] px-8 py-10">
        <div className="flex items-center gap-4">
          <span
            className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-xl border border-line"
            style={{ color: tool.tint, background: 'color-mix(in oklab, ' + tool.tint + ' 12%, transparent)' }}
          >
            <Icon size={22} strokeWidth={1.8} aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-primary">{tool.label}</h1>
              {section ? <span className="text-[13px] text-tertiary">› {section}</span> : null}
              <span className="rounded-xs border border-line bg-raised px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wide text-tertiary">
                Planned
              </span>
            </div>
            <p className="mt-0.5 text-[13px] text-secondary">{tool.summary}</p>
          </div>
        </div>

        <h2 className="mb-2 mt-8 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-tertiary">What it will do</h2>
        <ul className="space-y-1.5">
          {tool.detail.map((line) => (
            <li key={line} className="flex gap-2.5 text-[13px] text-secondary">
              <span aria-hidden className="mt-[7px] h-[5px] w-[5px] shrink-0 rounded-full" style={{ background: tool.tint }} />
              <span>{line}</span>
            </li>
          ))}
        </ul>

        <h2 className="mb-2 mt-8 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-tertiary">Until then</h2>
        <div className="space-y-2">
          {tool.today.map((entry) => (
            <Menu key={entry.command} label={entry.label} entries={copyEntry('copy', 'Copy command', entry.command)}>
              <div className="flex items-center gap-3 rounded-lg border border-line bg-raised px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-[11.5px] text-tertiary">{entry.label}</div>
                  <code className="block truncate font-mono text-[12.5px] text-primary">{entry.command}</code>
                </div>
                <Button
                  variant="ghost"
                  onClick={() => copyText(entry.command, 'Command copied')}
                  icon={<Copy size={13} strokeWidth={1.9} />}
                >
                  Copy
                </Button>
              </div>
            </Menu>
          ))}
        </div>
      </div>
    </div>
  );
}
