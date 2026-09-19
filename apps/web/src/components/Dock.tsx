import { motion } from 'motion/react';
import { ScrollText, Sparkles, Terminal as TerminalIcon, X } from 'lucide-react';
import { Assistant } from './Assistant.tsx';
import { Terminal } from './Terminal.tsx';
import { LogViewer } from './LogViewer.tsx';
import { ResizeHandle } from '../lib/useResizable.tsx';
import { Button } from './ui/Button.tsx';
import { copyEntry, Menu, SEPARATOR, type MenuEntry } from './ui/ContextMenu.tsx';
import { KindMark } from './ui/KindMark.tsx';
import { DockResource } from './DockResource.tsx';

/**
 * The dock: a strip along the bottom that holds things you want to keep open
 * while you go somewhere else.
 *
 * A log tail in the dock stays streaming while you inspect the deployment
 * that owns the pod. Terminals and port forwards land here for the same
 * reason. It is one component so every kind of tab is closed, resized and
 * reordered the same way, and it is gone entirely when it has nothing to show.
 */

export interface DockTab {
  readonly id: string;
  readonly kind: 'logs' | 'terminal' | 'assistant' | 'resource';
  readonly title: string;
  readonly subtitle?: string;
  readonly context: string;
  readonly namespace?: string;
  readonly pod?: string;
  readonly containers?: readonly string[];
  /** For terminal tabs: the container to exec into. */
  readonly container?: string | undefined;
  readonly source?: 'kubernetes' | 'docker' | undefined;
  /** For resource tabs: the object pinned here. */
  readonly resourceKind?: string | undefined;
  readonly name?: string | undefined;
}

interface DockProps {
  readonly tabs: readonly DockTab[];
  readonly activeId: string | null;
  readonly height: number;
  readonly dragging: boolean;
  readonly onResizeStart: (event: React.PointerEvent) => void;
  readonly onActivate: (id: string) => void;
  readonly onClose: (id: string) => void;
  readonly onCloseAll: () => void;
  /** Opens the tab's subject in the details panel, full size. */
  readonly onExpand: (tab: DockTab) => void;
  /** Lets a pinned object's reference chips open other objects. */
  readonly onNavigate?: ((target: { kind: string; name?: string; namespace?: string }) => void) | undefined;
  readonly assistant?: { readonly incoming: { readonly id: number; readonly text: string } | null; readonly onOpenSettings: () => void } | undefined;
}

export function Dock({ tabs, activeId, height, dragging, onResizeStart, onActivate, onClose, onCloseAll, onExpand, onNavigate, assistant }: DockProps) {
  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0];
  if (!active) return null;

  return (
    <motion.section
      data-testid="dock"
      initial={{ height: 0, opacity: 0 }}
      animate={{ height, opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 420, damping: 38 }}
      className="relative flex shrink-0 flex-col overflow-hidden border-t border-line bg-ground"
    >
      <ResizeHandle side="top" label="Resize dock" dragging={dragging} onPointerDown={onResizeStart} />

      <div className="flex h-[34px] shrink-0 items-stretch border-b border-line bg-raised pl-1 pr-1" role="tablist">
        {tabs.map((tab) => {
          const isActive = tab.id === active.id;
          const entries: MenuEntry[] = [
            { id: 'close', label: 'Close', onSelect: () => onClose(tab.id) },
            {
              id: 'close-others',
              label: 'Close others',
              disabled: tabs.length < 2,
              onSelect: () => tabs.filter((other) => other.id !== tab.id).forEach((other) => onClose(other.id)),
            },
            { id: 'close-all', label: 'Close all', onSelect: onCloseAll },
            SEPARATOR,
            { id: 'expand', label: 'Open in details panel', onSelect: () => onExpand(tab) },
            SEPARATOR,
            ...copyEntry('copy-pod', 'Copy pod name', tab.pod),
          ];
          return (
            <Menu key={tab.id} label={tab.title} entries={entries} testId="dock-tab-menu">
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                data-testid="dock-tab"
                onClick={() => onActivate(tab.id)}
                className={`group relative flex items-center gap-2 px-3 text-[12px] transition-colors duration-100 ${
                  isActive ? 'text-primary' : 'text-tertiary hover:text-secondary'
                }`}
              >
                {isActive ? (
                  <motion.span
                    layoutId="dock-active"
                    aria-hidden
                    className="absolute inset-x-1 bottom-0 h-[2px] rounded-full bg-accent"
                    transition={{ type: 'spring', stiffness: 480, damping: 38 }}
                  />
                ) : null}
                {tab.kind === 'logs' ? (
                  <ScrollText size={12} strokeWidth={1.9} aria-hidden className={isActive ? 'text-accent' : ''} />
                ) : tab.kind === 'assistant' ? (
                  <Sparkles size={12} strokeWidth={1.9} aria-hidden className={isActive ? 'text-accent' : ''} />
                ) : tab.kind === 'resource' ? (
                  <KindMark kind={tab.resourceKind ?? ''} />
                ) : (
                  <TerminalIcon size={12} strokeWidth={1.9} aria-hidden className={isActive ? 'text-accent' : ''} />
                )}
                <span className="font-mono">{tab.title}</span>
                {tab.subtitle ? <span className="text-[11px] text-tertiary">{tab.subtitle}</span> : null}
                <span
                  role="button"
                  aria-label={`Close ${tab.title}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onClose(tab.id);
                  }}
                  className="ml-1 rounded-xs p-[2px] text-transparent hover:bg-hover hover:text-primary group-hover:text-tertiary"
                >
                  <X size={11} strokeWidth={2.2} />
                </span>
              </button>
            </Menu>
          );
        })}
        <div className="flex-1" />
        <div className="flex items-center">
          <Button iconOnly variant="ghost" aria-label="Close dock" onClick={onCloseAll} icon={<X size={13} strokeWidth={2} />} />
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
        {tabs.map((tab) => (
          <div key={tab.id} className="absolute inset-0 flex flex-col" style={{ display: tab.id === active.id ? 'flex' : 'none' }}>
            {tab.kind === 'logs' && tab.pod ? (
              <LogViewer
                source={tab.source}
                context={tab.context}
                namespace={tab.namespace ?? ''}
                pod={tab.pod}
                containers={[...(tab.containers ?? [])]}
                expanded={false}
                onToggleExpand={() => onExpand(tab)}
              />
            ) : tab.kind === 'assistant' ? (
              <Assistant context={tab.context || null} incoming={assistant?.incoming ?? null} onOpenSettings={assistant?.onOpenSettings ?? (() => undefined)} />
            ) : tab.kind === 'terminal' && tab.pod ? (
              <Terminal source={tab.source} context={tab.context} namespace={tab.namespace ?? ''} pod={tab.pod} container={tab.container} />
            ) : tab.kind === 'resource' && tab.resourceKind && tab.name ? (
              <DockResource
                context={tab.context}
                kind={tab.resourceKind}
                name={tab.name}
                namespace={tab.namespace}
                {...(onNavigate ? { onNavigate } : {})}
              />
            ) : null}
          </div>
        ))}
      </div>
    </motion.section>
  );
}
