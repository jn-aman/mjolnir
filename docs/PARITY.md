# Feature inventory

Everything Freelens and Leapp do, everything Datadog's Log Explorer does, and
what Mjolnir does about each. The rule: **nothing is dropped**, and where we
differ it is because we are doing it better, not because it was hard.

Status key: **done** · **planned** · **new** (nobody in this category has it)

---

## Part 1 — Logs, measured against Datadog

Datadog is the high-water mark for log tooling. Most of it assumes an ingestion
pipeline and an index, which a desktop client reading the Kubernetes API does
not have. The useful exercise is separating what genuinely needs a backend from
what people assume does.

### What we take

| Datadog feature | Mjolnir | Notes |
|---|---|---|
| **Live Tail** | planned | Datadog *samples* live tail when volume is high, so you are not seeing every line. We stream the real thing from the API — no sampling, because we are tailing one workload, not a fleet. |
| **Search syntax** | planned | A real query language, not a substring box: `level:error service:api duration_ms:>1000`, with `AND`/`OR`/`NOT` and `-` negation. Free-text still works for people who just want to find a string. |
| **Facets** | new | Datadog makes you *define* facets. We discover them: every JSON key in the buffer becomes a filterable field automatically, with value counts. Nothing to configure. |
| **Measures** | planned | Numeric fields get range filters and sparklines — `duration_ms`, `status`, `bytes`. |
| **Side panel** | planned | Click a line: full record, formatted; the pod, node, namespace, owner and image it came from; and the container's CPU/memory around that instant. |
| **"View in context"** | planned | From a filtered view, open the surrounding lines unfiltered. The single most useful button in Datadog and the one people miss most elsewhere. |
| **Patterns** | new | Cluster similar lines and collapse them: "1,204 lines matching `GET /v1/health 200 in <N>ms`". Turns a wall of noise into a dozen rows. Done client-side over the buffer — no index needed. |
| **Visualisations** | planned | A volume histogram above the stream, split by level. Brushing it sets the time range. |
| **Saved views** | planned | Query, columns, filters and time range, saved per workload. |
| **Grouping / aggregation** | planned | Group by any discovered field with counts; "top 10 `trace_id` by error count" without leaving the viewer. |
| **Export / share** | planned | Copy a line as JSON, copy a permalink that reopens the same query, download the buffer. |
| **Transactions** | planned | Group lines sharing a `trace_id` or `request_id` into one collapsible unit. |

### What we deliberately do not take

| Datadog feature | Why not |
|---|---|
| Watchdog anomaly detection | Needs a trained baseline over historical data. We have a rolling buffer. Pretending otherwise would produce confident nonsense. |
| Log pipelines and processors | That is an ingestion concern. Mjolnir reads what the container wrote. |
| Retention, archives, rehydration | There is no index to rehydrate from. |
| Sampling | A bug for our use case, not a feature. |

### What we do that Datadog cannot

- **Previous-container logs.** Datadog never sees the crashed container's output
  unless an agent shipped it first. We read it straight from the kubelet.
- **Zero setup.** No agent, no pipeline, no ingestion cost. Point at a cluster
  and read.
- **Logs beside the object.** One click from the pod to its owner, node, events
  and YAML. Datadog knows tags; we know the actual resource graph.

---

## Part 2 — Freelens, feature by feature

Read from the source tree, not the marketing page.

### Resources

Every kind Freelens lists: Pods, Deployments, DaemonSets, StatefulSets,
ReplicaSets, ReplicationControllers, Jobs, CronJobs, ConfigMaps, Secrets,
ResourceQuotas, LimitRanges, HPAs, VPAs, PodDisruptionBudgets, PriorityClasses,
RuntimeClasses, Leases, Mutating/Validating webhook configurations, Validating
admission policies and bindings, Services, Endpoints, EndpointSlices, Ingresses,
NetworkPolicies, PortForwards, PersistentVolumes, PersistentVolumeClaims,
StorageClasses, Namespaces, Nodes, Events, ServiceAccounts, Roles, RoleBindings,
ClusterRoles, ClusterRoleBindings, PodSecurityPolicies, CRDs and custom
resources.

**Mjolnir**: the registry in `@mjolnir/k8s` covers 28 kinds today; the rest are
table rows, not code. **Planned — complete parity.**

### Application features

| Freelens | Mjolnir | Notes |
|---|---|---|
| Multi-cluster | **done** | Lazy connections; Freelens opens all of them. |
| Catalog (cluster/entity browser) | planned | |
| **Hotbar** (pinned clusters) | planned | Ours shows reachability in the switcher, so a dead cluster is visible before you click. |
| Dock (tabbed bottom panel) | planned | Logs, terminal, create resource, edit resource, install chart, upgrade chart. |
| Terminal into a pod | planned | |
| **Node shell** | planned | Shell onto the *node*, not just the pod. |
| Local terminal | planned | With shell-sync, inheriting the real environment. |
| Port forwarding | planned | Freelens tracks these as a resource list; we do the same. |
| Helm: charts, releases, install, upgrade, rollback | planned | |
| Custom resources + CRD tree | planned | |
| Metrics (built-in + **custom Prometheus**) | planned | Freelens lets you point at your own Prometheus; so will we. |
| Cluster settings: rename, **custom icon**, accessible namespaces, namespace auth check, node shell config, metrics source | planned | The custom icon matters more than it sounds — it is how people tell prod from staging at a glance. |
| **kubectl version per cluster** | planned | Bundled, selectable. Fixes a whole class of old-cluster failures. |
| Kubeconfig editing in-app | planned | |
| Command palette | planned | |
| Themes | **done** (design) | Light and dark, both designed. |
| Tray / menu bar | planned | Ours does more: health at a glance, session expiry, alerts. |
| Preferences, weblinks, favorites | planned | |
| Entity settings | planned | |
| **Extensions API** | deferred | A permanent public commitment. Revisit once the core is stable — and say so openly rather than pretending it is coming next month. |

### Where we beat Freelens

- **Typed and validated.** Freelens reads the API with hand-written models. One
  malformed object blanks a column. Ours degrades per row and says what failed.
- **The log viewer.** Theirs is good; ours has structured logs, patterns,
  facets, previous-container and multi-pod aggregation.
- **Cloud access.** They have none.
- **Data browsers.** They stop at the control plane.

---

## Part 3 — Leapp, feature by feature

Read from the source tree. MPL-2.0, so all of this is reimplemented, never
copied.

| Leapp | Mjolnir | Notes |
|---|---|---|
| **Session types**: IAM user, IAM role federated (SAML), IAM role chained, AWS SSO role, Azure | planned | Chaining via parent pointer, arbitrary depth. |
| **Integrations**: AWS SSO, Azure tenant — create, login, logout, **sync** | planned | One integration provisions many sessions. |
| Session start / stop / current / list | planned | |
| **Named profile management** | planned | Sessions materialise into `~/.aws/credentials`, so the rest of your terminal keeps working. |
| Change profile, change region | planned | |
| **Open AWS web console** from a session | planned | Federation-token handoff — one click from a session to a signed-in browser console. Genuinely excellent and easy to miss. |
| **SSM session into EC2** | planned | Shell onto an instance without a bastion or a key. |
| Credential rotation | planned | On the **real token expiry**, not Leapp's fixed constant. |
| OS keychain storage | planned | |
| IdP URL management | planned | |
| Workspaces | planned | |
| CLI | planned | `mjolnir session start`, etc. |
| Plugins (`run-aws-credential-plugin`) | deferred | Same reasoning as the extensions API. |
| Teams / shared workspaces | **not doing** | This was Noovolari's commercial product and it died with the company. Re-treading it is not where the value is. |

### Where we beat Leapp

1. **Sessions bound to clusters.** Selecting an EKS cluster activates its
   credentials. Leapp cannot know what a cluster is.
2. **Real expiry.** Their `expired()` compares elapsed time to a global
   constant while `sessionTokenExpiration` sits unused on the model.
3. **Expiry surfaced before it bites** — a countdown and a proactive refresh,
   not an error you discover mid-request.
4. **Typed credentials.** Theirs is `{ sessionToken: any }`.
5. **Keyed state transitions**, not read-mutate-write over the whole session
   array on every change.
6. **It is maintained.** The company shut down; the repo has slowed.

---

## Part 4 — Ideas in the same vein as object storage

The pattern that produced the object browser: *Mjolnir already has an
authenticated path into the cluster and the ability to port-forward. Anything
reachable that way is a feature nobody else can offer, because nobody else is
already standing there.*

Ranked by payoff over effort.

### 1. Database browser — **new**

Detect Postgres, MySQL, Redis, MongoDB from workload images and ports. Read
credentials from the Secret the workload already references. Port-forward,
connect, browse schemas and run read-only queries. The reason a terminal sits
open next to every cluster UI.

*Free*: browse schema, read-only queries. *Pro*: writes, saved queries, export.

### 2. Kafka / queue browser — **new**

Topics, partitions, consumer-group lag, peek at messages with Avro/Protobuf
decoding. Consumer lag is the single most-asked-for number in any event-driven
system and it is invisible in every cluster UI.

### 3. Resource diff and drift — **new**

Diff a live object against its Helm chart, its Argo CD desired state, or its
last-applied annotation. "What changed, when, and who did it" answered from data
already on the cluster.

### 4. Time-travel for a resource — **new**

Every watch event is already streaming through Mjolnir. Keep a rolling window
and let people scrub backwards: what did this Deployment look like twenty
minutes ago, and which field changed when the pods started failing?

### 5. Cost per workload — **new**

Node instance types and prices are knowable; requests and limits are on every
pod. "This namespace is costing roughly $840/month, and 60% of it is requested
and unused." Kubecost as a feature rather than a cluster install.

### 6. Certificate and secret expiry — **new**

Scan TLS Secrets, cert-manager Certificates and Ingress certs for expiry.
Surface it in the menu bar before something goes down at 2am. Cheap to build,
saves an outage.

### 7. Network path checker — **new**

"Can this pod reach that service?" Evaluate NetworkPolicies, Services, endpoints
and DNS and show where the path breaks. People currently debug this with
`kubectl exec` and `curl`.

### 8. Image provenance

What image is this, which registry, which digest, is the tag mutable, is it
signed, when was it built, what CVEs. Partly covered by the Security Center, but
the provenance angle is distinct.

### 9. Workload dependency graph

Which services call which, from NetworkPolicies, Service selectors and Istio
config. Freelens's topology shows ownership; this shows traffic.

### 10. "What broke?" — **new**

One button on a failing workload that assembles the answer: recent events, the
previous container's logs, the last rollout, resource pressure on the node, and
whether a config change preceded it. All the data Mjolnir already has, in the
order a human would look at it.

**Number 10 is the one I would build first** after the core. It is the clearest
expression of what a desktop app can do that a dashboard cannot: it has
everything on hand at once, and it can afford to be opinionated about what to
show you.
