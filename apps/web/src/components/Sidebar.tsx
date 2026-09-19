import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { ResourceDefinition } from '@mjolnir/k8s';
import { CATEGORY_TINT } from '../lib/tint.ts';
import { KIND_ICON } from '../lib/kindIcons.ts';
import { clusterTools, type ToolDefinition } from '../lib/tools.ts';
import { sectionIcon } from '../lib/sectionIcons.ts';
import { useModuleNav } from '../lib/moduleNav.ts';
import { Folder } from 'lucide-react';
import { useFlags } from '../lib/flags.tsx';
import type { CustomResource } from '../lib/api.ts';
import { copyEntry, Menu, type MenuEntry } from './ui/ContextMenu.tsx';
import { Boxes, ChevronDown, LayoutDashboard, Settings, Shapes } from 'lucide-react';
import { Tip } from './ui/Tooltip.tsx';

/**
 * Resource navigation.
 *
 * Overview is an entry in this list, not a separate mode. It is the cluster's
 * own page; putting it in a top-level tab implies it is a different kind of
 * thing, and it is not, it is simply the first thing you look at.
 *
 * Every kind carries its own icon. That is not decoration: this is a list of
 * thirty near-identical words, and shape is what the eye finds before it reads.
 */


const CATEGORY_ORDER = ['cluster', 'workloads', 'config', 'network', 'storage', 'access'] as const;

const CATEGORY_LABEL: Record<string, string> = {
  cluster: 'Cluster',
  workloads: 'Workloads',
  config: 'Configuration',
  network: 'Network',
  storage: 'Storage',
  access: 'Access control',
};

/** What the sidebar can select: a resource kind, or one of the app's own pages. */
export type NavSelection =
  | { kind: 'resource'; value: string }
  | { kind: 'page'; value: 'overview' | 'settings' | 'app-settings' }
  /** A cluster tool from the TOOLS registry: Helm, port forwards, … */
  | { kind: 'tool'; value: string }
  /** Something that is not about one cluster: cloud access, containers, buckets. */
  | { kind: 'workspace'; value: string };

interface SidebarProps {
  readonly kinds: ResourceDefinition[];
  /** Kinds this cluster defines itself, grouped under their API group. */
  readonly custom?: readonly CustomResource[];
  readonly selection: NavSelection;
  readonly counts: Record<string, number>;
  readonly onSelect: (selection: NavSelection) => void;
  readonly width: number;
  /** When set, this is a module other than Kubernetes: its sections are the nav. */
  readonly module?: ToolDefinition | undefined;
  /** Icons only. */
  readonly compact?: boolean;
}

/**
 * Sections that belong to a flagged feature.
 *
 * Kept here rather than in the tool definitions because it is a small list
 * and putting a flag id into every section entry would make the common case,
 * a section with no flag, carry a field it never uses.
 */
const SECTION_FLAGS: Readonly<Record<string, string>> = {
  'storage:transfers': 'storage.transfers',
  'storage:presigned links': 'storage.presigned',
};

export function Sidebar({ kinds, custom = [], selection, counts, onSelect, width, module, compact = false }: SidebarProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const grouped = new Map<string, ResourceDefinition[]>();
  for (const entry of kinds) {
    const list = grouped.get(entry.category) ?? [];
    list.push(entry);
    grouped.set(entry.category, list);
  }

  const toggle = (category: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });

  const { values: flagValues } = useFlags();
  const moduleNav = useModuleNav();

  const isActive = (candidate: NavSelection) =>
    candidate.kind === selection.kind && candidate.value === selection.value;

  const allSections = [...CATEGORY_ORDER, 'tools'];
  const sectionMenu = (category: string): MenuEntry[] => [
    { id: 'collapse-others', label: 'Collapse other sections', onSelect: () => setCollapsed(new Set(allSections.filter((c) => c !== category))) },
    { id: 'expand-all', label: 'Expand all sections', onSelect: () => setCollapsed(new Set()) },
  ];
  const tools = clusterTools(flagValues);

  if (module) {
    const [, activeSection] = selection.kind === 'workspace' ? selection.value.split(':') : [];
    const Icon = module.icon;
    return (
      <nav data-testid="sidebar" className="flex shrink-0 flex-col overflow-y-auto border-r border-line bg-raised py-2" style={{ width }}>
        {/*
          Collapsed, the title is four icons wide and wraps to three lines of
          broken words. There is no room for a name in a 56px rail, so it does
          not try: the icon is the title, and its tooltip says the rest.
        */}
        {compact ? (
          <Tip label={module.label} side="right">
            <div className="mx-auto flex h-[30px] w-[30px] items-center justify-center" data-testid="module-title">
              <Icon size={16} strokeWidth={1.8} aria-hidden style={{ color: module.tint }} />
            </div>
          </Tip>
        ) : (
          <div className="flex items-center gap-2 px-3 py-2" data-testid="module-title">
            <Icon size={15} strokeWidth={1.8} aria-hidden style={{ color: module.tint }} />
            <span className="min-w-0 truncate text-[13px] font-semibold text-primary">{module.label}</span>
            {module.built ? null : <span className="shrink-0 rounded-xs border border-line px-1 text-[9.5px] font-semibold uppercase tracking-wide text-tertiary">planned</span>}
          </div>
        )}
        <div className="mx-3 my-1 h-px bg-[var(--border-subtle)]" />
        <ul>
          {(module.sections ?? [])
            .filter((section) => {
              // A section whose feature is off should not be in the
              // navigation. Leaving it there and explaining on arrival is how
              // a flag becomes decoration.
              const flag = SECTION_FLAGS[`${module.id}:${section.toLowerCase()}`];
              return !flag || (flagValues[flag] ?? true);
            })
            .map((section) => {
            const id = `${module.id}:${section.toLowerCase().replace(/\s+/g, '-')}`;
            return (
              <li key={section}>
                <Entry
                  compact={compact}
                  // Its own icon, not the module's. Four identical archive
                  // boxes stacked up read as a rendering fault, and in the
                  // collapsed rail they are the only thing to go on.
                  icon={sectionIcon(section, Icon)}
                  label={section}
                  testId={`nav-${id}`}
                  active={activeSection === id.split(':')[1]}
                  tint={module.tint}
                  menu={[{ id: 'open', label: `Open ${section}`, onSelect: () => onSelect({ kind: 'workspace', value: id }) }]}
                  onSelect={() => onSelect({ kind: 'workspace', value: id })}
                />
              </li>
            );
          })}
        </ul>

        {/*
          What the module itself has to show: the buckets in the open store,
          the databases in the open connection. It belongs in the navigation
          and the module is the only thing that knows it, so the module
          publishes and this subscribes.
        */}
        {moduleNav.map((group) => (
          <section key={group.title} className="mt-2" data-testid={`nav-group-${group.title.toLowerCase().replace(/\s+/g, '-')}`}>
            <div className="mx-3 my-1 h-px bg-[var(--border-subtle)]" />
            {compact ? null : (
              <div className="flex items-center gap-2 px-3 pb-0.5 pt-1.5">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-tertiary">{group.title}</span>
                <div className="flex-1" />
                {group.action ? (
                  <button
                    type="button"
                    onClick={group.action.onSelect}
                    className="rounded-xs px-1 text-[11px] text-tertiary hover:bg-hover hover:text-primary"
                  >
                    {group.action.label}
                  </button>
                ) : null}
              </div>
            )}
            {group.items.length === 0 && group.empty && !compact ? (
              <p className="px-3 py-1 text-[11.5px] leading-[1.5] text-tertiary">{group.empty}</p>
            ) : null}
            <ul>
              {group.items.map((item) => (
                <li key={item.id}>
                  <Entry
                    compact={compact}
                    icon={Folder}
                    label={item.label}
                    {...(item.hint === undefined ? {} : { count: undefined })}
                    testId={`nav-item-${item.id}`}
                    active={item.active ?? false}
                    tint={module.tint}
                    menu={[{ id: 'open', label: `Open ${item.label}`, onSelect: item.onSelect }]}
                    onSelect={item.onSelect}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </nav>
    );
  }

  return (
    <nav
      data-testid="sidebar"
      className="flex shrink-0 flex-col overflow-y-auto border-r border-line bg-raised py-2"
      style={{ width }}
    >
      <Entry
        compact={compact}
        icon={LayoutDashboard}
        label="Overview"
        testId="nav-overview"
        active={isActive({ kind: 'page', value: 'overview' })}
        onSelect={() => onSelect({ kind: 'page', value: 'overview' })}
      />

      <div className="mx-3 my-1.5 h-px bg-[var(--border-subtle)]" />

      {CATEGORY_ORDER.map((category) => {
        const entries = grouped.get(category);
        if (!entries?.length) return null;
        const isCollapsed = collapsed.has(category);

        return (
          <section key={category} className="mb-0.5">
            <Menu entries={sectionMenu(category)}>
            <button
              type="button"
              onClick={() => toggle(category)}
              aria-expanded={!isCollapsed}
              className="flex w-full items-center gap-1.5 px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-tertiary transition-colors duration-100 hover:text-secondary"
            >
              <motion.span
                animate={{ rotate: isCollapsed ? -90 : 0 }}
                transition={{ type: 'spring', stiffness: 500, damping: 34 }}
                className="flex shrink-0"
              >
                <ChevronDown size={11} strokeWidth={2.4} />
              </motion.span>
              <span aria-hidden className="h-[6px] w-[6px] rounded-full" style={{ background: CATEGORY_TINT[category] }} />
              {compact ? null : CATEGORY_LABEL[category]}
            </button>
            </Menu>

            <AnimatePresence initial={false}>
            {isCollapsed ? null : (
              <motion.ul
                key="list"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 520, damping: 40 }}
                className="overflow-hidden"
              >
                {entries.map((entry) => (
                  <li key={entry.kind}>
                    <Entry
                      compact={compact}
                      icon={KIND_ICON[entry.kind] ?? Boxes}
                      label={entry.label}
                      testId={`nav-${entry.plural}`}
                      active={isActive({ kind: 'resource', value: entry.kind })}
                      count={counts[entry.kind]}
                      tint={CATEGORY_TINT[category]}
                      menu={[
                        { id: 'open', label: `Open ${entry.label.toLowerCase()}`, onSelect: () => onSelect({ kind: 'resource', value: entry.kind }) },
                        ...copyEntry('copy-kubectl', 'Copy kubectl command', `kubectl get ${entry.plural}${entry.namespaced ? ' -A' : ''}`),
                      ]}
                      onSelect={() => onSelect({ kind: 'resource', value: entry.kind })}
                    />
                  </li>
                ))}
              </motion.ul>
            )}
            </AnimatePresence>
          </section>
        );
      })}

      {custom.length > 0 ? <CustomSection custom={custom} compact={compact} collapsed={collapsed} onToggle={toggle} isActive={isActive} onSelect={onSelect} counts={counts} /> : null}

      <section className="mb-0.5" data-testid="nav-tools">
        <Menu entries={sectionMenu('tools')}>
        <button
          type="button"
          onClick={() => toggle('tools')}
          aria-expanded={!collapsed.has('tools')}
          className="flex w-full items-center gap-1.5 px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-tertiary transition-colors duration-100 hover:text-secondary"
        >
          <motion.span
            animate={{ rotate: collapsed.has('tools') ? -90 : 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 34 }}
            className="flex shrink-0"
          >
            <ChevronDown size={11} strokeWidth={2.4} />
          </motion.span>
          <span aria-hidden className="h-[6px] w-[6px] rounded-full bg-accent" />
          {compact ? null : 'Tools'}
        </button>
        </Menu>
        {collapsed.has('tools') ? null : (
          <ul>
            {tools.map((tool) => (
              <li key={tool.id}>
                <Entry
                  compact={compact}
                  icon={tool.icon}
                  label={tool.label}
                  testId={`nav-tool-${tool.id}`}
                  active={isActive({ kind: 'tool', value: tool.id })}
                  tint={tool.tint}
                  menu={[{ id: 'open', label: `Open ${tool.label}`, onSelect: () => onSelect({ kind: 'tool', value: tool.id }) }]}
                  onSelect={() => onSelect({ kind: 'tool', value: tool.id })}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex-1" />
      <div className="mx-3 my-1.5 h-px bg-[var(--border-subtle)]" />
      <Entry
        compact={compact}
        icon={Settings}
        label="Kubernetes settings"
        testId="nav-settings"
        active={isActive({ kind: 'page', value: 'settings' })}
        onSelect={() => onSelect({ kind: 'page', value: 'settings' })}
      />
    </nav>
  );
}

/**
 * Custom resources, grouped by API group.
 *
 * A cluster with Argo, Cert-Manager and Prometheus has sixty custom kinds, and
 * a flat list of sixty is worse than none. Grouping by API group is the
 * grouping the cluster already has: `argoproj.io` is one product, and the
 * group name is the thing people recognise and the thing they can search for.
 */
function CustomSection({
  custom,
  compact,
  collapsed,
  onToggle,
  isActive,
  onSelect,
  counts,
}: {
  custom: readonly CustomResource[];
  compact: boolean;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  isActive: (candidate: NavSelection) => boolean;
  onSelect: (selection: NavSelection) => void;
  counts: Record<string, number>;
}) {
  const groups = new Map<string, CustomResource[]>();
  for (const entry of custom) {
    const list = groups.get(entry.group) ?? [];
    list.push(entry);
    groups.set(entry.group, list);
  }
  return (
    <>
      {[...groups.entries()].map(([group, entries]) => {
        const id = `crd:${group}`;
        const shut = collapsed.has(id);
        return (
          <section key={group} className="mb-0.5" data-testid={`nav-group-${group}`}>
            <Menu
              label={group}
              entries={[
                { id: 'collapse', label: shut ? 'Expand this group' : 'Collapse this group', onSelect: () => onToggle(id) },
                ...copyEntry('copy-group', 'Copy the API group', group),
              ]}
            >
              <button
                type="button"
                onClick={() => onToggle(id)}
                aria-expanded={!shut}
                title={group}
                className="flex w-full items-center gap-1.5 px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-tertiary transition-colors duration-100 hover:text-secondary"
              >
                <motion.span animate={{ rotate: shut ? -90 : 0 }} transition={{ type: 'spring', stiffness: 500, damping: 34 }} className="flex shrink-0">
                  <ChevronDown size={11} strokeWidth={2.4} />
                </motion.span>
                <span aria-hidden className="h-[6px] w-[6px] shrink-0 rounded-full" style={{ background: CATEGORY_TINT['custom'] ?? 'var(--series-5)' }} />
                {compact ? null : <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{group}</span>}
              </button>
            </Menu>
            {shut ? null : (
              <ul>
                {entries.map((entry) => (
                  <li key={entry.kind}>
                    <Entry
                      compact={compact}
                      icon={KIND_ICON[entry.kind] ?? Shapes}
                      label={entry.label}
                      testId={`nav-${entry.plural}`}
                      active={isActive({ kind: 'resource', value: entry.kind })}
                      count={counts[entry.kind]}
                      tint={CATEGORY_TINT['custom'] ?? 'var(--series-5)'}
                      menu={[
                        { id: 'open', label: `Open ${entry.label.toLowerCase()}`, onSelect: () => onSelect({ kind: 'resource', value: entry.kind }) },
                        ...copyEntry('copy-kubectl', 'Copy kubectl command', `kubectl get ${entry.plural}.${entry.group}${entry.namespaced ? ' -A' : ''}`),
                        ...copyEntry('copy-crd', 'Copy the CRD name', entry.definition),
                      ]}
                      onSelect={() => onSelect({ kind: 'resource', value: entry.kind })}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </>
  );
}

function Entry({
  icon: Icon,
  label,
  testId,
  active,
  count,
  tint,
  menu = [],
  onSelect,
  compact = false,
}: {
  icon: typeof Boxes;
  label: string;
  testId: string;
  active: boolean;
  count?: number | undefined;
  tint?: string | undefined;
  menu?: readonly MenuEntry[];
  onSelect: () => void;
  compact?: boolean;
}) {
  return (
    <Menu label={label} entries={menu} testId="nav-menu">
    {/*
      Collapsed, the row is an icon and a number with no words at all, so the
      tooltip is not a nicety: it is the only label there is. Expanded, the
      label is already on screen and a tooltip repeating it is noise.
    */}
    <Tip label={label} side="right" disabled={!compact} {...(count === undefined ? {} : { hint: `${count} in this cluster` })}>
    <button
      type="button"
      data-testid={testId}
      data-active={active}
      onClick={onSelect}
      className={`group relative mx-2 flex w-[calc(100%-16px)] items-center gap-2.5 rounded-md py-[6px] pl-2 pr-2.5 text-left text-[13px] transition-colors duration-100 ${
        active ? 'font-medium text-primary' : 'text-secondary hover:text-primary'
      }`}
    >
      {active ? (
        <motion.span
          // One element for the whole nav, so the selection slides between
          // entries rather than blinking out in one place and in again in
          // another. This is the difference between a menu that moves and one
          // that repaints.
          layoutId="sidebar-active"
          aria-hidden
          className="row-selected absolute inset-0 rounded-md border-l-2 border-accent"
          transition={{ type: 'spring', stiffness: 480, damping: 38 }}
        />
      ) : (
        <span
          aria-hidden
          className="absolute inset-0 rounded-md bg-transparent transition-colors duration-100 group-hover:bg-hover"
        />
      )}
      <span
        className={`icon-chip relative !h-[22px] !w-[22px] !rounded-[6px] transition-transform duration-150 group-hover:scale-105 ${active ? '' : 'opacity-90'}`}
        style={{ ['--chip-tint' as string]: active ? 'var(--accent-base)' : (tint ?? 'var(--text-tertiary)') }}
        aria-hidden
      >
        <Icon size={12} strokeWidth={2} />
      </span>
      {compact ? null : <span className="relative min-w-0 flex-1 break-words [overflow-wrap:anywhere]">{label}</span>}
      {!compact && count !== undefined && count > 0 ? (
        <span className="relative shrink-0 font-mono text-[10.5px] tabular-nums text-tertiary">
          {count}
        </span>
      ) : null}
    </button>
    </Tip>
    </Menu>
  );
}
