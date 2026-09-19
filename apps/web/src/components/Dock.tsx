import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ChevronDown, ChevronUp, Maximize2, Minimize2, Pin, Plus, ScrollText, Sparkles, Terminal as TerminalIcon, X } from 'lucide-react';
import { Assistant } from './Assistant.tsx';
import { Terminal } from './Terminal.tsx';
import { LogViewer } from './LogViewer.tsx';
import { ResizeHandle } from '../lib/useResizable.tsx';
import { Button } from './ui/Button.tsx';
import { copyEntry, Menu, SEPARATOR, type MenuEntry } from './ui/ContextMenu.tsx';
import { KindMark } from './ui/KindMark.tsx';
import { Tip } from './ui/Tooltip.tsx';
import { DockResource } from './DockResource.tsx';

/**
 * The dock: a strip along the bottom that holds what you want to keep open
 * while you go and look at something else.
 *
 * A log tail keeps streaming while you read the deployment that owns the pod.
 * Terminals and pinned objects land here for the same reason. One component,
 * so every kind of tab is opened, closed, resized and reordered identically.
 *
 * Three things make it work rather than merely exist, and the first version
 * had none of them.
 *
 * **It is always there.** A dock that appears only once something has put a
 * tab in it is a dock nobody discovers, and it leaves no way to simply open a
 * terminal. The bar stays; the panel is what comes and goes.
 *
 * **Clicking the active tab collapses it.** That is how you glance at a log,
 * put it away, and still have it streaming when you come back. Closing the tab
 * to get your screen back would throw away the stream you were watching.
 *
 * **Hidden tabs keep their size.** They are hidden with `visibility`, not
 * `display: none`, because an element with `display: none` has no dimensions:
 * a terminal in that state measures itself as zero columns and comes back
 * wrapped at the wrong width, and a log list virtualises against a height of
 * nothing. Keeping them laid out costs a little and is the difference between
 * switching tabs and rebuilding them.
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
  /**
   * Kept, rather than reused.
   *
   * An unpinned tab is the slot for its kind: opening logs for a second pod
   * takes it over. Pinning says this one stays and the next opens beside it.
   */
  readonly pinned?: boolean | undefined;
}

interface DockProps {
  readonly tabs: readonly DockTab[];
  readonly activeId: string | null;
  readonly height: number;
  readonly dragging: boolean;
  readonly collapsed: boolean;
  readonly onToggleCollapsed: () => void;
  readonly onResizeStart: (event: React.PointerEvent) => void;
  readonly onActivate: (id: string) => void;
  readonly onClose: (id: string) => void;
  readonly onCloseAll: () => void;
  readonly onReorder: (from: string, to: string) => void;
  /** Keeps a tab, so the next one of its kind opens beside it instead of over it. */
  readonly onTogglePin: (id: string) => void;
  /** Opens the tab's subject in the details panel, full size. */
  readonly onExpand: (tab: DockTab) => void;
  /** Lets a pinned object's reference chips open other objects. */
  readonly onNavigate?: ((target: { kind: string; name?: string; namespace?: string }) => void) | undefined;
  /** What the plus button offers. Empty means no plus button. */
  readonly newTabs?: readonly { id: string; label: string; detail?: string; onSelect: () => void }[] | undefined;
  readonly assistant?: { readonly incoming: { readonly id: number; readonly text: string } | null; readonly onOpenSettings: () => void } | undefined;
}

/** Bar only. Chosen so two lines of a log are never *almost* visible. */
const BAR_HEIGHT = 34;

export function Dock({
  tabs,
  activeId,
  height,
  dragging,
  collapsed,
  onToggleCollapsed,
  onResizeStart,
  onActivate,
  onClose,
  onCloseAll,
  onReorder,
  onTogglePin,
  onExpand,
  onNavigate,
  newTabs,
  assistant,
}: DockProps) {
  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0];
  const [maximised, setMaximised] = useState(false);
  const [dragTab, setDragTab] = useState<string | null>(null);
  const strip = useRef<HTMLDivElement>(null);

  const open = Boolean(active) && !collapsed;
  const panelHeight = maximised ? Math.max(height, 620) : height;

  // A newly opened tab should be visible, not merely present.
  useEffect(() => {
    if (!activeId) return;
    strip.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeId, tabs.length]);

  return (
    <motion.section
      data-testid="dock"
      data-open={open}
      initial={false}
      animate={{ height: open ? panelHeight + BAR_HEIGHT : BAR_HEIGHT }}
      transition={dragging ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 40 }}
      className="relative flex shrink-0 flex-col overflow-hidden border-t border-line bg-ground"
    >
      {open ? <ResizeHandle side="top" label="Resize dock" dragging={dragging} onPointerDown={onResizeStart} /> : null}

      <div className="flex h-[34px] shrink-0 items-stretch border-b border-line bg-raised" role="tablist">
        <div ref={strip} className="flex min-w-0 flex-1 items-stretch overflow-x-auto pl-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {tabs.map((tab) => {
            const isActive = tab.id === active?.id;
            const entries: MenuEntry[] = [
              {
                id: 'pin',
                label: tab.pinned ? 'Let this tab be reused' : 'Keep this tab',
                icon: <Pin size={13} strokeWidth={1.9} />,
                onSelect: () => onTogglePin(tab.id),
              },
              SEPARATOR,
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
                  data-active={isActive}
                  draggable
                  onDragStart={() => setDragTab(tab.id)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => {
                    if (dragTab && dragTab !== tab.id) onReorder(dragTab, tab.id);
                    setDragTab(null);
                  }}
                  onDragEnd={() => setDragTab(null)}
                  // Clicking the tab you are already on puts the panel away
                  // and keeps the stream running, which is the whole point of
                  // a dock rather than a drawer.
                  onClick={() => (isActive ? onToggleCollapsed() : activateAndOpen(tab.id))}
                  // Double-click pins, which is the gesture that makes a
                  // preview tab permanent in every editor people already use.
                  onDoubleClick={(event) => {
                    event.preventDefault();
                    onTogglePin(tab.id);
                  }}
                  className={`group relative flex shrink-0 items-center gap-2 px-3 text-[12px] transition-colors duration-100 ${
                    isActive ? 'text-primary' : 'text-tertiary hover:text-secondary'
                  } ${dragTab === tab.id ? 'opacity-40' : ''}`}
                >
                  {isActive ? (
                    <motion.span
                      layoutId="dock-active"
                      aria-hidden
                      className="absolute inset-x-1 bottom-0 h-[2px] rounded-full bg-accent"
                      transition={{ type: 'spring', stiffness: 480, damping: 38 }}
                    />
                  ) : null}
                  <TabIcon tab={tab} active={isActive} />
                  <span className={`max-w-[210px] truncate font-mono ${tab.pinned ? '' : 'italic'}`}>{tab.title}</span>
                  {tab.subtitle ? <span className="max-w-[120px] truncate text-[11px] text-tertiary">{tab.subtitle}</span> : null}
                  {/*
                    Italic means "this slot will be reused"; the pin means it
                    will not. Shown rather than explained, because the rule is
                    learned by watching a tab get replaced once.
                  */}
                  {tab.pinned ? (
                    <Pin size={10} strokeWidth={2.4} aria-hidden className={isActive ? 'text-accent' : 'text-tertiary'} />
                  ) : null}
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

          {/*
            Empty, this is buttons rather than a sentence explaining what
            buttons would do. "Logs, shells and pinned objects stay here while
            you work elsewhere" is a paragraph asking to be read by someone
            who is trying to get something done; two things they can press
            teach the same lesson by being pressed.
          */}
          {tabs.length === 0 && newTabs
            ? newTabs.map((entry) => (
                <Tip key={entry.id} label={entry.detail ?? entry.label}>
                  <button
                    type="button"
                    data-testid={`dock-open-${entry.id}`}
                    onClick={entry.onSelect}
                    className="flex shrink-0 items-center gap-1.5 px-2.5 text-[12px] text-tertiary transition-colors duration-100 hover:text-primary"
                  >
                    <Plus size={12} strokeWidth={2.2} aria-hidden />
                    {entry.label}
                  </button>
                </Tip>
              ))
            : null}

          {tabs.length > 0 && newTabs && newTabs.length > 0 ? (
            <Menu
              label="Open in the dock"
              testId="dock-new-menu"
              entries={newTabs.map((entry) => ({ id: entry.id, label: entry.label, onSelect: entry.onSelect }))}
            >
              <Tip label="Open something else in the dock">
                <button
                  type="button"
                  data-testid="dock-new"
                  aria-label="Open something in the dock"
                  onClick={() => newTabs[0]?.onSelect()}
                  className="flex w-[30px] shrink-0 items-center justify-center text-tertiary hover:text-primary"
                >
                  <Plus size={14} strokeWidth={2} />
                </button>
              </Tip>
            </Menu>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-0.5 pr-1">
          {open ? (
            <Tip label={maximised ? 'Restore the dock' : 'Make the dock taller'}>
              <button
                type="button"
                data-testid="dock-maximise"
                aria-label={maximised ? 'Restore the dock' : 'Make the dock taller'}
                onClick={() => setMaximised((current) => !current)}
                className="flex h-[26px] w-[26px] items-center justify-center rounded-md text-tertiary hover:bg-hover hover:text-primary"
              >
                {maximised ? <Minimize2 size={12} strokeWidth={2} /> : <Maximize2 size={12} strokeWidth={2} />}
              </button>
            </Tip>
          ) : null}
          {active ? (
            <Tip label={open ? 'Put the dock away' : 'Bring the dock back'} shortcut="⌘`" hint={open ? 'Everything here keeps running' : undefined}>
              <button
                type="button"
                data-testid="dock-collapse"
                aria-label={open ? 'Put the dock away' : 'Bring the dock back'}
                aria-expanded={open}
                onClick={onToggleCollapsed}
                className="flex h-[26px] w-[26px] items-center justify-center rounded-md text-tertiary hover:bg-hover hover:text-primary"
              >
                {open ? <ChevronDown size={13} strokeWidth={2} /> : <ChevronUp size={13} strokeWidth={2} />}
              </button>
            </Tip>
          ) : null}
          {tabs.length > 0 ? (
            <Button iconOnly variant="ghost" aria-label="Close every tab" hint="Closes them all; nothing is kept" onClick={onCloseAll} icon={<X size={13} strokeWidth={2} />} />
          ) : null}
        </div>
      </div>

      {/*
        Every tab stays mounted and laid out. `visibility` rather than
        `display`, so a terminal that is not on screen still knows how wide it
        is and does not come back re-wrapped.
      */}
      <div className="relative flex min-h-0 flex-1 flex-col" aria-hidden={!open}>
        {tabs.map((tab) => {
          const shown = tab.id === active?.id && open;
          return (
            <div
              key={tab.id}
              className="absolute inset-0 flex flex-col"
              style={{ visibility: shown ? 'visible' : 'hidden', pointerEvents: shown ? 'auto' : 'none', zIndex: shown ? 1 : 0 }}
            >
              {tab.kind === 'logs' && tab.pod ? (
                <LogViewer
                  source={tab.source}
                  context={tab.context}
                  namespace={tab.namespace ?? ''}
                  pod={tab.pod}
                  containers={[...(tab.containers ?? [])]}
                  expanded={false}
                  compact
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
          );
        })}
      </div>
    </motion.section>
  );

  function activateAndOpen(id: string): void {
    onActivate(id);
    if (collapsed) onToggleCollapsed();
  }
}

function TabIcon({ tab, active }: { tab: DockTab; active: boolean }) {
  const tint = active ? 'text-accent' : '';
  if (tab.kind === 'logs') return <ScrollText size={12} strokeWidth={1.9} aria-hidden className={tint} />;
  if (tab.kind === 'assistant') return <Sparkles size={12} strokeWidth={1.9} aria-hidden className={tint} />;
  if (tab.kind === 'resource') return <KindMark kind={tab.resourceKind ?? ''} />;
  return <TerminalIcon size={12} strokeWidth={1.9} aria-hidden className={tint} />;
}
