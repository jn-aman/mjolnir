# UI architecture

How the shell is laid out, and where every planned feature lands in it. The
point of writing this down is that a feature arrives by filling a slot, not by
finding room.

## Regions

```
┌────┬──────────┬──────────────────────────────────────────────┐
│    │          │ title bar: cluster · status · search ⌘K       │
│ R  │ Sidebar  ├──────────────────────────────────────────────┤
│ a  │          │                                              │
│ i  │ Overview │  Content                       ┌───────────┐ │
│ l  │ Cluster  │  (list / overview / tool page) │  Drawer   │ │
│    │ Workloads│                                │  overlays │ │
│ c  │ Config   │                                │  the list │ │
│ l  │ Network  │                                └───────────┘ │
│ u  │ Storage  ├──────────────────────────────────────────────┤
│ s  │ Access   │ Dock: log tails · terminals · port forwards  │
│ t  │ Tools    │                                              │
│ e  │          │                                              │
│ r  │ Settings │                                              │
│ s  ├──────────┤                                              │
│ ws │          │                                              │
└────┴──────────┴──────────────────────────────────────────────┘
```

| Region | Holds | Extension point |
|---|---|---|
| **Rail** | one tile per module: Kubernetes, Cloud access, Containers, Object storage, Databases, Kafka, Certificates, Image provenance; the Mjolnir settings gear below. Modules are peers; none is the app | `KUBERNETES_MODULE` plus `TOOLS` entries with `area: 'workspace'` |
| **Cluster strip** | inside the Kubernetes module only: one tile per cluster, plus add | kubeconfig contexts |
| **Sidebar** | per module. Kubernetes: kinds by category, Tools, Kubernetes settings. Any other module: its `sections` | resource registry (`@mjolnir/k8s`), `ToolDefinition.sections` |
| **Content** | a list, the overview, a tool page or a settings page | `NavSelection` union in `Sidebar.tsx`; `view` switch in `App.tsx` |
| **Drawer** | one object: overview / logs / events / yaml (+ per-kind tabs) | `tabs` array in `ResourceDrawer.tsx`; `detail/<Kind>Detail.tsx` |
| **Dock** | things kept open while you browse: log tails and the assistant now; terminals and port-forward tabs next | `DockTab['kind']` and the switch in `Dock.tsx` |
| **Palette** | every page, kind, tool, cluster, namespace and listed object | groups in `CommandPalette.tsx` |
| **Context menus** | every named thing | `Menu` in `ui/ContextMenu.tsx`; entries are data |

Every edge between regions is draggable and remembered (`useResizable`).

## Where each planned feature goes

| Feature | Region | Slot today |
|---|---|---|
| Helm releases, values, diff, rollback | Sidebar › Tools › Helm | `tools.ts#helm` → `ToolPanel` |
| Argo CD applications and sync | Sidebar › Tools › Argo CD | `tools.ts#argocd` |
| Port forwards | Sidebar › Tools list; each forward is a Dock tab | `tools.ts#portforward`; `DockTab kind: 'forward'` (to add) |
| Terminal: container shell, node shell, local | Dock tab; row menu "Shell" | `DockTab kind: 'terminal'` (placeholder rendered) |
| Trivy vulnerabilities | Sidebar › Tools; per-pod tab in Drawer | `tools.ts#trivy` |
| What broke? timeline | Sidebar › Tools; the Overview's events feed grows into it | `tools.ts#whatbroke` |
| Datadog-grade log explorer | Sidebar › Tools (cluster-wide) + the existing per-pod `LogViewer` | new `tools.ts` entry |
| Cloud access (Leapp-class) | Rail › workspace | `tools.ts#cloud` |
| Containers (Docker) | Rail › workspace | `tools.ts#docker` |
| Object storage browser | Rail › workspace; per-pod tab for MinIO/RustFS pods | `tools.ts#storage` |
| Machines: paired agent, host metrics, Docker on hosts (Beszel-class) | Rail › module | `tools.ts#machines` |
| Alerts: rules, email/webhook/push channels, quiet hours, history | Rail › module | `tools.ts#alerts` |
| Database browser | Sidebar › Tools; detection card in the pod overview (like object storage) | `tools.ts#database` |
| Kafka consumer lag | Sidebar › Tools | `tools.ts#kafka` |
| Diff & drift | Sidebar › Tools; per-object Diff tab in the drawer | `tools.ts#drift` |
| Time travel | Sidebar › Tools; a scrubber in the title bar when active | `tools.ts#timetravel` |
| Cost per workload | Sidebar › Tools; a Cost column on workload lists | `tools.ts#cost` |
| Certificate expiry | Sidebar › Tools; the menu bar extra | `tools.ts#certs` |
| Network path check | Sidebar › Tools; "Can it reach…" in the pod row menu | `tools.ts#netpath` |
| Image provenance | Sidebar › Tools; per-container in the drawer | `tools.ts#provenance` |
| Traffic dependency graph | Sidebar › Tools | `tools.ts#traffic` |
| MCP server and docked agents | Settings page + a Dock tab kind |, |
| Licence, updates | Settings | `SettingsPanel.tsx` |
| Menu bar extra (macOS) | Electron shell, outside this tree |, |

## Rules the regions follow

- **The drawer overlays the list; it never squeezes it.**
- **The dock is absent when empty.** It is not a permanent strip.
- **A tool that is not built yet has a page that says so** and gives the
  command that does the job today. It never shows an empty table.
- **Nothing exists only behind right-click.** Every menu entry has a visible
  twin somewhere.
- **The palette reaches everything the sidebar and rail do**, plus the objects
  in the current list.

## Settings, in two scopes

Mjolnir is the product; Kubernetes is one module. The gear on the rail opens
Mjolnir settings (general, AI assistant, MCP server, licence, shortcuts, and
the planned cloud access, privacy and advanced sections). The bottom of the
cluster sidebar opens Kubernetes settings (kubeconfig, clusters with hide and
remove, namespaces, and planned integrations). Neither assumes the other, and
a future module (containers, cloud access) gets its own settings the same way.

## One operations registry

`apps/server/src/tools/` declares every operation once: name, sentence,
schema, read or write. The MCP server (stdio and HTTP), the in-app assistant
and the REST API all call the same list, so a tool exists in one place and
appears to every agent at once. Write tools are refused unless the agent was
allowed writes in settings.
