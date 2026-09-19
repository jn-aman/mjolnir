<div align="center">

# Mjolnir

**See your whole cluster in one window.**

A desktop app for Kubernetes, browse and operate any cluster from your local
kubeconfig, manage cloud access across accounts, and read the data inside the
cluster, without leaving the window.

[mjolnir.sh](https://mjolnir.sh) · [Licence](LICENSE) · [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md)

</div>

---

> **Status: early.** Nothing is released yet. The foundation is built and the
> app is being assembled on top of it, see [the roadmap](docs/ROADMAP.md) for
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
the current one is crash-looping, the first thing anyone wants, and absent from
most tools. JSON log lines detected automatically and given real columns,
discovered from the keys rather than configured by hand.

**It reads the data, not just the control plane.** Every tool here stops at the
edge of the cluster's data, which is why a terminal stays open beside it.
Mjolnir already holds an authenticated path in and can port-forward, so it can
answer "what is actually in that bucket?" without a context switch.

## Try it without a cluster

The app ships with a **demo cluster**, real-shaped resources including a
CrashLoopBackOff pod, an unschedulable Pending pod, and workloads emitting both
plain and JSON logs. No kubeconfig, no network, nothing to set up.

It is also what the entire test suite runs against, so it stays honest.

## Running it

Node 20.11 or newer, and nothing else. There is no database, no daemon and no
account to make.

```bash
npm install
npm run dev
```

`npm run dev` starts three things and prints one address: a TypeScript build in
watch mode, the local API on `127.0.0.1:7845`, and the UI on
`127.0.0.1:5273`. Open the second one. Ctrl-C stops all three. Set
`MJOLNIR_PORT` or `MJOLNIR_WEB_PORT` if either port is taken; if one is busy the
command says so in a sentence instead of a stack trace.

The first launch opens a short welcome: what the modules are, which clusters and
container engines it found on this machine, whether you want an assistant, and
what may leave the machine. It is skippable from the first frame, and Settings,
Privacy brings it back.

Other ways to run it:

```bash
npm start            # build everything and serve the built UI from the API
npm run desktop      # the Electron app, from source
npm run dmg          # signed-ready DMGs in apps/desktop/release
npm run verify       # no JS source, typecheck, unit tests
npm run e2e          # Playwright against the demo cluster
```

The app finds clusters in `KUBECONFIG` and `~/.kube/config`, and a container
engine on the local Docker socket, which covers Docker Desktop, OrbStack, Colima
and Rancher Desktop. Nothing needs configuring for either. With neither present
there is still the built-in demo cluster.

## What it connects to

Mjolnir talks to `*.mjolnir.sh` and to your own infrastructure, and to nothing
else. That is a rule in the code rather than a promise: every first-party
address lives in `packages/endpoints`, and a URL that is not under the apex is
refused before a request is made.

| Host | What for | Default |
|---|---|---|
| `updates.mjolnir.sh` | The update feed and installer | on, and asks before installing |
| `telemetry.mjolnir.sh` | Crash reports, usage counters | **off** until you say yes |
| `flags.mjolnir.sh` | Feature toggles, Unleash | off |
| `api.mjolnir.sh` | Licence activation | only when you enter a key |

Your clusters, container engines and object stores are reached straight from
your machine as you, never proxied through us. Settings, Privacy shows the exact
JSON queued for sending before it is sent, and the complete list of event shapes
that can ever exist.

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
by a Zod schema, leniently but *totally*, a malformed object costs one row and
gets reported, never a blank screen.

**Watch-backed, not polling.** A local cache kept in sync by the API server, so
reads are synchronous and updates arrive in milliseconds. This is most of the
difference between a UI that feels instant and one that feels laggy.

**Cross-platform.** macOS, Windows, Linux, plus a standalone Docker/web mode.

## Documentation

`docs/` is where decisions live, with the reasoning attached:

- [ROADMAP.md](docs/ROADMAP.md), what gets built when, and why in that order
- [FEATURES.md](docs/FEATURES.md), the feature plan
- [PARITY.md](docs/PARITY.md), every feature of Freelens, Leapp and Datadog's
  log explorer, and what Mjolnir does about each
- [RESEARCH.md](docs/RESEARCH.md), what was worth taking from the reference apps
- [ACTIVATION.md](docs/ACTIVATION.md), how buying and licensing work
- [DISTRIBUTION.md](docs/DISTRIBUTION.md), packaging, signing, the paid tier
- [MIGRATION.md](docs/MIGRATION.md), the migration plan

## Licence

[Elastic License 2.0](LICENSE), source-available. You can read, modify and
build Mjolnir. You may not offer it as a hosted service or circumvent its
licence key. See [DISTRIBUTION.md](docs/DISTRIBUTION.md) for the free/Pro split.
