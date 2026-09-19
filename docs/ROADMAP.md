# Roadmap

Everything in [PARITY.md](PARITY.md) and [FEATURES.md](FEATURES.md) is in scope.
This is the order, and why.

## How things are ranked

Three questions, in this order:

1. **Does it get us to something shippable?** A half-built app earns nothing and
   teaches nothing. Breadth before depth until v1 is out.
2. **Does it make someone switch?** Free-tier features are the marketing budget.
   The thing that makes a Lens user try Mjolnir is worth more than the fifth Pro
   feature.
3. **Does it make someone pay?** Revenue funds the rest, and every Pro feature
   built before there is a free tier worth using is built on speculation.

A note on sequencing, stated plainly because it is the most common way solo
products die: **nothing in Phase 3 or later gets started before Phase 1 ships.**
Every one of those ideas is more interesting than the work in Phase 1. That is
exactly why they are dangerous.

---

## Phase 0, Foundation · *in progress*

| Item | State |
|---|---|
| `@mjolnir/schemas`, lenient validation, quantities | done |
| `@mjolnir/logger`, structured logging, redaction | done |
| `@mjolnir/k8s`, kubeconfig, transport, log streaming, watch cache | done |
| `@mjolnir/licensing`, Ed25519 keys, tier gating | done |
| `@mjolnir/paddle`, webhook verification, licence decisions | done |
| `@mjolnir/server`, cluster registry, resource routes, log socket | done |
| Storm design system, tokens, components, motion | done |
| **Demo mode**, synthetic cluster | **next** |
| Web app shell, routing, layout, dock | next |
| Electron shell, window, menu, IPC, URL scheme | next |

**Demo mode is next and it is not optional.** Without it the Playwright suite
cannot run at all, no screenshot can be taken without a live cluster, and
nobody can try the app before connecting it to production. It is the cheapest
thing on this page with the highest leverage.

---

## Phase 1, Ship v1, free · *the only thing that matters until it is out*

The minimum that is genuinely better than Lens for one developer and their own
clusters.

**Resources**
- Generic virtualized list, column registry, all built-in kinds
- Detail view, YAML edit and apply, scale, rollout restart, delete
- Events, node view, namespace filtering, custom resources
- Command palette, pinned clusters with reachability

**The log viewer**, the reason to switch
- Streaming follow with scroll-to-pause, virtualized
- Previous container, ANSI, time ranges, download
- Structured table with discovered fields
- Highlight vs filter, regex, pinned lines
- Patterns (clustering), client-side over the buffer

**Operate**
- Terminal into a pod, node shell, local terminal with shell-sync
- Port forwarding
- Helm browse, values, manifests

**Shell**
- Light and dark, menu bar health, preferences
- Per-cluster kubectl version, custom cluster icon, accessible namespaces

**Ship it**
- Apple Developer enrolment, signing, notarization, stapling
- Auto-update, crash reporting
- Playwright green in CI

Exit criterion: a stranger downloads the DMG, opens it, connects a cluster, and
reads logs without help.

---

## Phase 2, First revenue

Only after v1 is out and people are using it.

- **Cloud access**: sessions, SSO and Azure integrations, role chaining, named
  profiles, keychain, real expiry with countdown
- **Sessions bound to clusters**, the differentiator; selecting an EKS cluster
  activates its credentials
- **AWS web console handoff** and **SSM shell into EC2** (both from Leapp)
- Multi-pod log aggregation, Stern-style
- Licence service, `mjolnir://` activation, in-app upgrade, Paddle live
- `mjolnir.sh`, buy page, licence portal

Exit criterion: someone who is not you has paid, activated, and kept using it.

---

## Phase 3, Depth

Ranked by value over effort, which is not the same as by how interesting they
are.

### 1. "What broke?"
One button on a failing workload that assembles recent events, the previous
container's logs, the last rollout, node pressure, and whether a config change
preceded it. **Highest value on this page and it needs no new integration** -
every input is already in hand. It is also the clearest expression of what a
desktop app can do that a dashboard cannot: hold everything at once and be
opinionated about what to show.

### 2. Certificate and secret expiry
Scan TLS Secrets, cert-manager Certificates and Ingress certs; surface in the
menu bar. **Cheapest item here and it prevents an outage.** A day's work for a
feature people tell their colleagues about.

### 3. Bucket store browser
MinIO, RustFS, SeaweedFS, Ceph RGW. Detect, port-forward, browse, preview.
Builds the detection-and-forward machinery that every other data browser reuses,
so its real cost is lower than it looks and its successors get cheaper.

### 4. Security Center
Trivy CVE scanning, RBAC audit, exposed secrets, image provenance folded in.
Pro. Substantial, and the second-most-asked-for thing after logs.

### 5. Argo CD
Browse free, operate Pro. Large surface, narrower audience than the above.

### 6. Saved views and workspace sync
Small, and they make everything before them stickier.

---

## Phase 4, Expand

### 7. Time travel
Watch events are already streaming through the app. Keep a rolling window and
let people scrub backwards: what did this Deployment look like twenty minutes
ago, and which field changed when the pods started failing? **Nothing else in
the category does this**, and the data is already passing through us, the cost
is storage and UI, not integration.

### 8. Database browser
Postgres, MySQL, Redis, MongoDB. Reuses Phase 3's detection and forwarding.
Higher effort than bucket store because each protocol needs its own client and
its own viewer, so it comes after the pattern is proven once.

### 9. Cost per workload
Node instance types and prices against requests and limits. High perceived
value; the hidden cost is that cloud pricing data needs maintaining forever.
Worth doing, worth knowing what it commits us to.

### 10. Resource diff and drift
Live object against its Helm chart, Argo desired state, or last-applied
annotation.

### 11. Network path checker
"Can this pod reach that service?" Genuinely useful and genuinely hard -
NetworkPolicy evaluation has enough subtleties that a wrong answer is worse than
none. Needs care, so it waits for time to give it.

### 12. Kafka and queue browser
Topics, partitions, consumer lag, message peek with Avro/Protobuf. Excellent for
the people who need it, narrower than the rest.

### 13. Traffic dependency graph
From NetworkPolicies, Service selectors and Istio config.

---

## Deferred, with reasons

| Item | Why |
|---|---|
| **Extensions API** | A permanent public commitment that distorts every internal boundary designed around it. Revisit when the core is stable, and say so honestly rather than promising it soon. |
| **Leapp's Teams** | Was Noovolari's commercial product; it died with the company. Not where the value is. |
| **Watchdog-style anomaly detection** | Needs a trained baseline over historical data we do not have. Time travel (item 7) is the honest version of this. |
| **Accounts and login** | Keys work offline and need no user database. Revisit when workspace sync makes an account earn its keep. |

---

## The single biggest risk

Not any item on this list. It is starting items 7 through 13 before Phase 1
ships. They are more fun than building a resource list, they demo better, and
each one individually looks like a week's work.

Phase 1 is the whole product. Everything after it is why someone stays.
