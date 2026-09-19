# kubectl parity

Every kubectl verb, where it lives in Mjolnir, and whether it is there yet.
The bar is "everything kubectl can do, you can do here without typing it".
Where a verb maps to more than one place, the row lists the primary one.

Legend: **done**, works today against a live cluster and the demo. **next** -
the slot exists (menu entry, page or dock tab) and the operation is scheduled.
**later**, planned, not yet slotted.

## Objects

| kubectl | Mjolnir | Status |
|---|---|---|
| `get <kind>` | the list for the kind; every column sortable, filterable, resizable | done |
| `get <kind> -A` / `-n` | namespace selector, "Only namespace…" in the row menu | done |
| `get events` | Events in Cluster; per-object Events tab in the drawer | done |
| `describe` | drawer › Overview: conditions, containers, volumes, tolerations, owner, events | done (Pod); other kinds show generic fields, per-kind detail views next |
| `get -o yaml` | drawer › YAML (read-only until Edit) | done |
| `edit` | drawer › YAML › Edit › Apply (PUT) | done |
| `apply -f` / `replace -f` | same as edit for an existing object; Create for a new one | done |
| `create -f` | **Create** in the list toolbar: skeleton for the kind, edited in place, POSTed | done |
| `create <kind> <name>` (imperative) | Create with a skeleton; typed builders (configmap from literals, secret, namespace) | next |
| `delete` | the row's own delete button, row menu › Delete…, drawer › Delete, and the bulk bar for many at once (all confirmed) | done |
| `delete --force --grace-period=0` | option on the delete confirm | next |
| `patch` | every inline edit is a merge patch: labels, annotations, image, env, resources, replicas | done |
| `label` / `annotate` | click a chip, or **add**, remove with × | done |
| `diff` | show the diff before Apply in the YAML editor | next |
| `explain` | field help in the YAML editor from the OpenAPI schema | later |
| `api-resources` | the sidebar is the list; `/api/resources/kinds` | done |
| `api-versions` | Settings › Cluster | next |
| `kustomize` | Create from a kustomization directory | later |
| `wait` | not a UI verb, the list is live | n/a |

## Workloads

| kubectl | Mjolnir | Status |
|---|---|---|
| `scale` | row menu › Scale…; replicas editable in the drawer | done |
| `rollout restart` | row menu › Restart rollout (writes `kubectl.kubernetes.io/restartedAt`) | done |
| `rollout undo` | row menu › Undo rollout, previous ReplicaSet's template | done |
| `rollout undo --to-revision` | pick a revision from Rollout history | next |
| `rollout history` | Deployment detail › Revisions tab | next |
| `rollout status` | Deployment "What's wrong" column and progress in the drawer | done (column); live progress bar next |
| `rollout pause` / `resume` | row menu › Pause/Resume rollout | done |
| `set image` | click the image in the drawer, routed to the owning Deployment | done |
| `set env` | click an env value in the drawer, routed to the owning Deployment | done (edit); add/remove next |
| `set resources` | click a request or limit in the drawer | done |
| `set serviceaccount` / `selector` / `subject` | drawer fields | next |
| `autoscale` | HPA create with a builder | next |
| `expose` | Service create from a workload row | next |
| `run` | Create › Pod skeleton; one-line "run image" builder | next |

## Nodes

| kubectl | Mjolnir | Status |
|---|---|---|
| `cordon` / `uncordon` | row menu; "cordoned" badge in the Status column | done |
| `drain` | row menu › Drain… (cordon, then Eviction API per pod; DaemonSet pods skipped) | done |
| `drain --ignore-daemonsets --delete-emptydir-data` | drain options on the confirm | next |
| `taint` | row menu › Taints… (list editor) | done |
| `top node` | Overview capacity and CPU/memory by node | done |
| `debug node/` | node shell in the dock | next |

## Pods

| kubectl | Mjolnir | Status |
|---|---|---|
| `logs` | drawer › Logs; **Open logs in dock**; full screen | done |
| `logs -f` / `--previous` / `-c` / `--tail` | follow, Previous, container picker, tail | done |
| `logs --since` / `--timestamps` / `-l` | time range; timestamps column exists; label-selected multi-pod logs | next |
| `exec -it` | row menu › Shell, drawer › Shell, per-container Shell: a dock terminal over the exec WebSocket, resizes; the shell is probed (bash, zsh, ash, sh, dash, fish, busybox) and a distroless image says so instead of hanging | done |
| `attach` | dock terminal | next |
| `cp` | drawer › Files tab | later |
| `port-forward` | row menu › Port forward…; Forward beside each port in the drawer; Tools › Port forwards lists and stops them | done (pods); services next |
| `top pod` | CPU/memory columns in the pod list; charts in the drawer | done (drawer); columns next |
| `debug` (ephemeral container) | drawer › Debug… | later |

## Cluster and auth

| kubectl | Mjolnir | Status |
|---|---|---|
| `config get-contexts` / `use-context` | the rail | done |
| `config set-context --namespace` | namespace selector, remembered per cluster | next |
| `cluster-info` / `version` | title bar; Settings › Cluster | done (partial) |
| `auth can-i` | SelfSubjectAccessReview per action, menu entries grey out with the reason | next |
| `auth whoami` | Settings › Cluster | next |
| `certificate approve/deny` | CSR list actions | later |
| `cp`, `proxy`, `plugin`, `completion` | not UI verbs | n/a |

## Rules the operations follow

- **Immutable fields route to the owner.** `image`, `env`, `resources` on a
  pod are edited on the Deployment (via its ReplicaSet), the way `kubectl set`
  does, so the change survives the next rollout. A bare pod accepts only
  `image`; the tooltip on the field says so.
- **Arrays are sent whole.** A merge patch replaces arrays, so every array edit
  reads the current object first.
- **Eviction, not delete, for drain.** Disruption budgets apply.
- **Destructive verbs confirm; everything else just happens** and says what
  it did in a toast, with the failure message from the API server verbatim.

## Helm

| helm | Mjolnir | Status |
|---|---|---|
| `helm list` | Tools › Helm: every release with chart, app version, revision, status, updated | done (from release Secrets, no binary) |
| `helm history` | release › History, click a revision to view it | done |
| `helm get values` / `get manifest` / `get notes` | release › Values, Manifest, Overview | done |
| `helm rollback` / `upgrade` / `uninstall` / `install` | copy the exact command from the row menu; in-app with the Helm engine | next |
| `helm repo` / search | Tools › Helm › Repositories | next |
