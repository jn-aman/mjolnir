import {
  ArrowDownToLine,
  ArrowLeftRight,
  Ban,
  CirclePlay,
  FileText,
  Pause,
  Play,
  Tag,
  Undo2,
  Filter,
  RotateCw,
  Scale,
  ScrollText,
  Server,
  Terminal,
  Trash2,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { KubeItem } from './columns.tsx';
import { askEntry, copyEntry, Menu, SEPARATOR, type MenuEntry } from './ui/ContextMenu.tsx';
import { podStatus, podProblem } from './columns.tsx';
import { scanImage } from './ScanDialog.tsx';
import { ShieldAlert } from 'lucide-react';

/**
 * The right-click menu on a resource row.
 *
 * Actions are named, not wired: the row says "restart", the screen decides
 * what restart means for this kind. That keeps the menu a description of the
 * row and lets the same list component serve every kind.
 *
 * Destructive entries are separated, coloured, and still open a confirm. The
 * menu is not the confirmation.
 */

export type RowActionId =
  | 'open'
  | 'logs'
  | 'dock-logs'
  | 'forward'
  | 'shell'
  | 'yaml'
  | 'restart'
  | 'scale'
  | 'filter-namespace'
  | 'filter-node'
  | 'cordon'
  | 'uncordon'
  | 'drain'
  | 'taint'
  | 'pause'
  | 'resume'
  | 'undo'
  | 'delete';

interface RowMenuProps {
  readonly item: KubeItem;
  readonly kind: string;
  readonly act: (action: RowActionId) => void;
  readonly children: ReactNode;
}

const SCALABLE = new Set(['Deployment', 'StatefulSet', 'ReplicaSet']);
const RESTARTABLE = new Set(['Deployment', 'StatefulSet', 'DaemonSet']);

const icon = (Icon: typeof FileText) => <Icon size={13} strokeWidth={1.9} />;

/**
 * The entries for one row. Shared by the right-click menu and the row's own
 * actions button, so both offer exactly the same verbs.
 */
export function rowMenuEntries(item: KubeItem, kind: string, act: (action: RowActionId) => void): MenuEntry[] {
  const name = item.metadata?.name ?? '';
  const namespace = item.metadata?.namespace;
  const node = typeof item.spec?.['nodeName'] === 'string' ? (item.spec['nodeName'] as string) : undefined;
  const isPod = kind === 'Pod';
  const scope = namespace ? `-n ${namespace} ` : '';
  const cordoned = item.spec?.['unschedulable'] === true;
  const paused = item.spec?.['paused'] === true;

  const where = namespace ? `${kind} ${name} in namespace ${namespace}` : `${kind} ${name}`;
  const status = isPod ? podStatus(item as never) : undefined;
  const problem = isPod ? podProblem(item as never) : undefined;
  const askPrompt =
    isPod && problem
      ? `Why is ${where} in ${status}? Reported problem: ${problem}. Read its logs (previous=true if it crashed), events and describe it, then tell me the cause and the fix.`
      : isPod
        ? `Tell me about ${where}: what it runs, whether it is healthy, and anything odd in its recent logs or events.`
        : `Look at ${where}: describe it, check its health and events, and tell me anything that needs attention.`;

  const entries: MenuEntry[] = [
    { id: 'open', label: 'Open details', icon: icon(FileText), shortcut: '↵', onSelect: () => act('open') },
    askEntry(isPod && problem ? 'Ask why it is failing' : 'Ask the assistant about this', askPrompt),
    ...(isPod
      ? [
          { id: 'logs', label: 'Logs', icon: icon(ScrollText), onSelect: () => act('logs') },
          { id: 'dock-logs', label: 'Open logs in dock', icon: icon(ArrowDownToLine), onSelect: () => act('dock-logs') },
          { id: 'shell', label: 'Shell', icon: icon(Terminal), onSelect: () => act('shell') },
          { id: 'forward', label: 'Port forward…', icon: icon(ArrowLeftRight), onSelect: () => act('forward') },
          ...((item.spec as { containers?: Array<{ image?: string }> } | undefined)?.containers?.[0]?.image
            ? [{ id: 'scan', label: 'Scan image with Trivy', icon: icon(ShieldAlert), onSelect: () => scanImage((item.spec as { containers: Array<{ image?: string }> }).containers[0]?.image ?? '') }]
            : []),
        ]
      : []),
    { id: 'yaml', label: 'Edit YAML', icon: icon(FileText), onSelect: () => act('yaml') },
    SEPARATOR,
    ...(RESTARTABLE.has(kind)
      ? [{ id: 'restart', label: 'Restart rollout', icon: icon(RotateCw), onSelect: () => act('restart') }]
      : []),
    ...(SCALABLE.has(kind) ? [{ id: 'scale', label: 'Scale…', icon: icon(Scale), onSelect: () => act('scale') }] : []),
    ...(kind === 'Deployment'
      ? [
          paused
            ? { id: 'resume', label: 'Resume rollout', icon: icon(Play), onSelect: () => act('resume') }
            : { id: 'pause', label: 'Pause rollout', icon: icon(Pause), onSelect: () => act('pause') },
          { id: 'undo', label: 'Undo rollout (previous revision)', icon: icon(Undo2), onSelect: () => act('undo') },
        ]
      : []),
    ...(kind === 'Node'
      ? [
          cordoned
            ? { id: 'uncordon', label: 'Uncordon, allow scheduling', icon: icon(CirclePlay), onSelect: () => act('uncordon') }
            : { id: 'cordon', label: 'Cordon, stop scheduling', icon: icon(Ban), onSelect: () => act('cordon') },
          { id: 'drain', label: 'Drain…', icon: icon(ArrowDownToLine), onSelect: () => act('drain') },
          { id: 'taint', label: 'Taints…', icon: icon(Tag), onSelect: () => act('taint') },
        ]
      : []),
    SEPARATOR,
    ...(namespace
      ? [{ id: 'filter-namespace', label: `Only namespace ${namespace}`, icon: icon(Filter), onSelect: () => act('filter-namespace') }]
      : []),
    ...(node ? [{ id: 'filter-node', label: `Only node ${node}`, icon: icon(Server), onSelect: () => act('filter-node') }] : []),
    SEPARATOR,
    ...copyEntry('copy-name', 'Copy name', name),
    ...copyEntry('copy-namespace', 'Copy namespace', namespace),
    ...copyEntry(
      'copy-kubectl',
      'Copy kubectl command',
      `kubectl ${scope}${isPod ? 'logs' : `get ${kind.toLowerCase()}`} ${name}`,
    ),
    SEPARATOR,
    { id: 'delete', label: 'Delete…', icon: icon(Trash2), danger: true, onSelect: () => act('delete') },
  ];

  return entries;
}

export function RowMenu({ item, kind, act, children }: RowMenuProps) {
  return (
    <Menu label={item.metadata?.name ?? ''} entries={rowMenuEntries(item, kind, act)} testId="row-menu">
      {children}
    </Menu>
  );
}
