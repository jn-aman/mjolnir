import type { NavSelection } from '../components/Sidebar.tsx';

/**
 * Where you are, in the URL.
 *
 * A reload, or the app restarting after an update, puts you back on the
 * same cluster, page, namespace, filter and open object. The hash is the
 * store because it costs nothing, survives Electron's reload, and can be
 * copied to a colleague as "look at this".
 */
export interface RouteState {
  readonly context?: string;
  readonly selection?: NavSelection;
  readonly namespace?: string;
  readonly status?: string;
  readonly selected?: string;
  readonly tab?: string;
}

const NAV_KINDS = new Set(['resource', 'page', 'tool', 'workspace']);

export function readRoute(): RouteState {
  try {
    const params = new URLSearchParams(window.location.hash.replace(/^#\/?/, ''));
    const nav = params.get('nav');
    let selection: NavSelection | undefined;
    if (nav) {
      const [kind, value] = nav.split(':', 2);
      if (kind && value && NAV_KINDS.has(kind)) selection = { kind, value } as NavSelection;
    }
    const pick = (key: string) => {
      const value = params.get(key);
      return value ? { [key]: value } : {};
    };
    return {
      ...pick('context'),
      ...(selection ? { selection } : {}),
      ...pick('namespace'),
      ...pick('status'),
      ...pick('selected'),
      ...pick('tab'),
    };
  } catch {
    return {};
  }
}

export function writeRoute(state: RouteState): void {
  const params = new URLSearchParams();
  if (state.context) params.set('context', state.context);
  if (state.selection) params.set('nav', `${state.selection.kind}:${state.selection.value}`);
  if (state.namespace) params.set('namespace', state.namespace);
  if (state.status) params.set('status', state.status);
  if (state.selected) params.set('selected', state.selected);
  if (state.tab) params.set('tab', state.tab);
  const next = `#/${params.toString()}`;
  if (window.location.hash !== next) window.history.replaceState(null, '', next);
}
