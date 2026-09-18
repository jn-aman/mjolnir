<div align="center">

# Odin

**See your whole cluster in one window.**

A native desktop app for Kubernetes — browse and operate any cluster from your
local kubeconfig, manage cloud access across accounts, and drive local Docker,
without leaving the window.

</div>

## Status

Early. The foundation is in place and the migration from the previous
JavaScript codebase is underway — see [docs/MIGRATION.md](docs/MIGRATION.md) for
the order of work and the reasoning behind it.

| Package | What it is | State |
|---|---|---|
| `@odin/schemas` | Zod schemas and quantity arithmetic for the Kubernetes API | Working |
| `@odin/k8s` | Typed cluster client | Kubeconfig, transport, logs, watch |
| `@odin/cloud` | Multi-account AWS/Azure session management | Not started |
| `@odin/licensing` | Licence key verification and tier gating | In progress |
| `@odin/docker` | Local Docker engine client | Not started |
| `@odin/server` | Express API, split by domain | Not started |
| `@odin/web` | React client | Not started |
| `@odin/desktop` | Electron shell | Not started |

## Development

```bash
npm install          # workspaces, Node 20.11+
npm run typecheck    # strict TypeScript across all packages
npm test             # unit tests (pure logic only)
npm run e2e          # Playwright against the demo cluster
```

End-to-end tests drive the real Electron app against a synthetic demo cluster,
so they need no kubeconfig and no network. They are the primary safety net;
unit tests are reserved for pure logic such as quantity parsing.

## Licence

[Elastic License 2.0](LICENSE) — source-available. You can read, modify and
build Odin; you may not offer it as a hosted service or circumvent its licence
key. See [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md) for the free/Pro split.
