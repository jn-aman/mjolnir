<div align="center">

# Mjolnir

**See your whole cluster in one window.**

A desktop app for Kubernetes — browse and operate any cluster from your local
kubeconfig, manage cloud access across accounts, and read the data inside the
cluster, without leaving the window.

[mjolnir.sh](https://mjolnir.sh) · [Licence](LICENSE) · [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md)

</div>

---

> **Status: early.** Nothing is released yet. The foundation is built and the
> app is being assembled on top of it — see [the roadmap](docs/ROADMAP.md) for
> what lands when, and why in that order.

## What makes it different

Three things nothing else in this category does.

**Cloud sessions are bound to clusters.** Lens and Freelens manage clusters but
know nothing about cloud credentials. Leapp manages credentials but knows
nothing about clusters. So the daily loop on EKS is: notice a call failed,
switch to a credentials tool, refresh, come back, retry. In Mjolnir, selecting a
cluster activates the session that authenticates it. You never learn there were
two concepts.

**Logs that understand what they are reading.** A streaming tail that pauses
when you scroll and resumes when you ask. The previous container's output when
the current one is crash-looping — the first thing anyone wants, and absent from
most tools. JSON log lines detected automatically and given real columns,
discovered from the keys rather than configured by hand.

**It reads the data, not just the control plane.** Every tool here stops at the
edge of the cluster's data, which is why a terminal stays open beside it.
Mjolnir already holds an authenticated path in and can port-forward, so it can
answer "what is actually in that bucket?" without a context switch.

## Try it without a cluster

The app ships with a **demo cluster** — real-shaped resources including a
CrashLoopBackOff pod, an unschedulable Pending pod, and workloads emitting both
plain and JSON logs. No kubeconfig, no network, nothing to set up.

It is also what the entire test suite runs against, so it stays honest.

## Development

```bash
npm install          # Node 20.11+
npm run verify       # no JS source, typecheck, unit tests
npm run e2e          # Playwright against the demo cluster
npm run dev          # server + web client
```

| Package | What it does | State |
|---|---|---|
| `@mjolnir/schemas` | Kubernetes object schemas, quantity arithmetic | working |
| `@mjolnir/logger` | Structured logging with redaction | working |
| `@mjolnir/k8s` | Kubeconfig, transport, log streaming, watch cache | working |
| `@mjolnir/demo` | The synthetic cluster | working |
| `@mjolnir/licensing` | Licence verification and tier gating | working |
| `@mjolnir/paddle` | Payment webhooks | working |
| `@mjolnir/server` | Local API | working |
| `@mjolnir/web` | React client | not started |
| `@mjolnir/desktop` | Electron shell | not started |
| `@mjolnir/cloud` | Multi-account AWS/Azure sessions | not started |

## How it is built

**TypeScript, strictly, end to end.** No JavaScript source anywhere; the build
fails if any appears. Every Kubernetes API response is validated at the boundary
by a Zod schema, leniently but *totally* — a malformed object costs one row and
gets reported, never a blank screen.

**Watch-backed, not polling.** A local cache kept in sync by the API server, so
reads are synchronous and updates arrive in milliseconds. This is most of the
difference between a UI that feels instant and one that feels laggy.

**Cross-platform.** macOS, Windows, Linux, plus a standalone Docker/web mode.

## Documentation

`docs/` is where decisions live, with the reasoning attached:

- [ROADMAP.md](docs/ROADMAP.md) — what gets built when, and why in that order
- [FEATURES.md](docs/FEATURES.md) — the feature plan
- [PARITY.md](docs/PARITY.md) — every feature of Freelens, Leapp and Datadog's
  log explorer, and what Mjolnir does about each
- [RESEARCH.md](docs/RESEARCH.md) — what was worth taking from the reference apps
- [ACTIVATION.md](docs/ACTIVATION.md) — how buying and licensing work
- [DISTRIBUTION.md](docs/DISTRIBUTION.md) — packaging, signing, the paid tier
- [MIGRATION.md](docs/MIGRATION.md) — the migration plan

## Licence

[Elastic License 2.0](LICENSE) — source-available. You can read, modify and
build Mjolnir. You may not offer it as a hosted service or circumvent its
licence key. See [DISTRIBUTION.md](docs/DISTRIBUTION.md) for the free/Pro split.
