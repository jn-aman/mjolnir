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

### 1. "What broke?" — built

Fifteen rules over events, pod statuses, node conditions, replica sets and
`managedFields`, ranked so the **cause sits above the symptom**: a rollout or
a config change that preceded the failures outranks the failures, and those
outrank the backoff loop they produced. `kubectl get events --sort-by` does
the opposite, which is why the forty BackOff lines bury the one
`CreateContainerConfigError` that explains them.

Three things it does that a sorted event list cannot:

- **Dates a change against a failure.** Nothing in the API links "the
  deployment changed" to "the pods started failing"; a person does it by
  eye. A first deploy is not reported, because nothing was replaced and
  there is nothing to roll back to.
- **Collapses one problem seen on many pods into one finding**, named for
  the workload rather than for one of its replicas.
- **Explains every term where it appears.** "BackOff" is not a word. Each
  finding carries a plain sentence, the evidence it was read from, and what
  to do next.

Run against a live cluster it took 25ms warm, and it found a crash loop
nobody had noticed.

### 2. Certificate and secret expiry — built

Four sources: TLS secrets, cert-manager Certificates, **admission webhook CA
bundles** and aggregated API services. The last two are the ones nobody looks
at, and an expired admission webhook CA does not break a website, it breaks
the cluster: every create is rejected by a webhook nobody can reach.

The column that matters is not the date, it is **who renews it**. A
cert-manager certificate eleven days out needs nothing; a hand-made one
eleven days out is why the page exists, so the headline leads on the nearest
expiry that nothing will renew rather than the nearest expiry.

It also catches what a date cannot: an Ingress serving a hostname its
certificate does not cover (with real wildcard rules, so `*.acme.test` does
not cover `deep.api.acme.test`), a cert-manager renewal scheduled for after
the expiry, and issuance that is failing while the old certificate still
works.

Reading TLS secrets means the private keys pass through the local server.
Nothing parses, stores, logs or returns one, and there is a test asserting
the answer cannot contain one.

### 3. Bucket store browser
MinIO, RustFS, SeaweedFS, Ceph RGW. Detect, port-forward, browse, preview.
Builds the detection-and-forward machinery that every other data browser reuses,
so its real cost is lower than it looks and its successors get cheaper.

### 4. Security Center
RBAC audit, exposed secrets and image provenance folded in with the scanning
below. Pro. Substantial, and the second-most-asked-for thing after logs.

**Cluster-wide CVE scanning is built.** The unit is the image, not the pod:
a hundred pods usually run fifteen distinct images, and every image carries
the workloads that run it, ordered by how many pods that is, because a
critical finding on an image thirty pods run is a different morning from the
same finding on one.

Identity is the digest from `imageID`, not the tag. Two pods on `:latest`
scheduled a week apart are running different code, and a report that merged
them would be quietly wrong about one of them. Where the spec names a tag
that moves, the row says so, because a clean scan against a moving tag is a
weaker promise than it looks.

Nothing scans on open: a page that fires off forty Trivy runs because someone
clicked a tab is a page people learn not to click. The inventory alone
already answers "what are we actually running". Scanning is three at a time,
streamed one image at a time so the table fills in, cached for an hour, with
one retry on a dropped connection and SBOM export in CycloneDX.

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
