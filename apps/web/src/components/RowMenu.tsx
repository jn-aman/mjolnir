import * as ContextMenu from '@radix-ui/react-context-menu';
import {
  Copy,
  FileText,
  RotateCw,
  Scale,
  ScrollText,
  Terminal,
  Trash2,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { KubeItem } from './columns.tsx';

/**
 * The right-click menu on a resource row.
 *
 * Every action here is also reachable from the detail panel — a context menu is
 * a shortcut, never the only route, because an action that exists only behind
 * right-click is an action most people never find.
 *
 * Destructive entries are separated, coloured, and still open a confirm. The
 * menu is not the confirmation.
 */

export interface RowAction {
  readonly id: string;
  readonly label: string;
  readonly icon: ReactNode;
  readonly shortcut?: string;
  readonly danger?: boolean;
  readonly disabled?: boolean;
  readonly onSelect: () => void;
}

interface RowMenuProps {
  readonly item: KubeItem;
  readonly kind: string;
  readonly children: ReactNode;
  readonly onOpen: () => void;
  readonly onLogs: () => void;
  readonly onShell: () => void;
  readonly onYaml: () => void;
  readonly onRestart: () => void;
  readonly onScale: () => void;
  readonly onDelete: () => void;
}

const SCALABLE = new Set(['Deployment', 'StatefulSet', 'ReplicaSet']);
const RESTARTABLE = new Set(['Deployment', 'StatefulSet', 'DaemonSet']);

export function RowMenu({
  item,
  kind,
  children,
  onOpen,
  onLogs,
  onShell,
  onYaml,
  onRestart,
  onScale,
  onDelete,
}: RowMenuProps) {
  const name = item.metadata?.name ?? '';
  const namespace = item.metadata?.namespace;
  const isPod = kind === 'Pod';

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text);
  };

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          data-testid="row-menu"
          className="z-50 min-w-[216px] rounded-lg border border-line bg-overlay p-1 shadow-[var(--shadow-lg)]"
          style={{ animation: 'mjolnir-menu-in 140ms cubic-bezier(0.16, 1, 0.3, 1)' }}
        >
          <Label>{name}</Label>
          <Separator />

          <Item icon={<FileText size={13} strokeWidth={1.9} />} onSelect={onOpen}>
            Open details
          </Item>
          {isPod ? (
            <>
              <Item icon={<ScrollText size={13} strokeWidth={1.9} />} onSelect={onLogs}>
                Logs
              </Item>
              <Item icon={<Terminal size={13} strokeWidth={1.9} />} onSelect={onShell}>
                Shell
              </Item>
            </>
          ) : null}
          <Item icon={<FileText size={13} strokeWidth={1.9} />} onSelect={onYaml}>
            Edit YAML
          </Item>

          <Separator />

          {RESTARTABLE.has(kind) ? (
            <Item icon={<RotateCw size={13} strokeWidth={1.9} />} onSelect={onRestart}>
              Restart rollout
            </Item>
          ) : null}
          {SCALABLE.has(kind) ? (
            <Item icon={<Scale size={13} strokeWidth={1.9} />} onSelect={onScale}>
              Scale…
            </Item>
          ) : null}

          <Item icon={<Copy size={13} strokeWidth={1.9} />} onSelect={() => copy(name)}>
            Copy name
          </Item>
          {namespace ? (
            <Item
              icon={<Copy size={13} strokeWidth={1.9} />}
              onSelect={() =>
                copy(
                  `kubectl -n ${namespace} ${isPod ? 'logs' : 'get ' + kind.toLowerCase()} ${name}`,
                )
              }
            >
              Copy kubectl command
            </Item>
          ) : null}

          <Separator />
          <Item icon={<Trash2 size={13} strokeWidth={1.9} />} danger onSelect={onDelete}>
            Delete…
          </Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function Item({
  icon,
  children,
  onSelect,
  danger = false,
  disabled = false,
}: {
  icon: ReactNode;
  children: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <ContextMenu.Item
      disabled={disabled}
      onSelect={onSelect}
      className={`flex cursor-pointer select-none items-center gap-2.5 rounded-sm px-2 py-[6px] text-[12.5px] outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 ${
        danger
          ? 'text-error data-[highlighted]:bg-error-bg'
          : 'text-secondary data-[highlighted]:bg-hover data-[highlighted]:text-primary'
      }`}
    >
      <span className="shrink-0">{icon}</span>
      {children}
    </ContextMenu.Item>
  );
}

function Label({ children }: { children: ReactNode }) {
  return (
    <ContextMenu.Label className="truncate px-2 py-1 font-mono text-[11px] text-tertiary">
      {children}
    </ContextMenu.Label>
  );
}

function Separator() {
  return <ContextMenu.Separator className="my-1 h-px bg-[var(--border-subtle)]" />;
}
