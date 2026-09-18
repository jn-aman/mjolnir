# Contributing

Thanks for looking. A few things worth knowing before you spend time.

## Licence

Mjolnir is under the [Elastic License 2.0](LICENSE), source-available, not OSI
open source. You can read, modify and build it. You may not offer it as a hosted
service or circumvent its licence key.

By contributing you agree your contribution is licensed the same way.

## The rules the codebase keeps

**TypeScript only.** No `.js`, `.cjs` or `.mjs` source files anywhere -
`npm run verify` fails the build if one appears. Imports use `.ts` specifiers;
TypeScript rewrites them on emit.

**Strict types, and validation at the boundary.** Every Kubernetes API response
is parsed through a Zod schema in `@mjolnir/schemas`. Parsing is lenient but
*total*: a malformed object costs one row and gets reported, never a thrown
exception or a blank screen.

**Playwright over unit tests.** End-to-end specs drive the real Electron app
against the built-in demo cluster. Unit tests are reserved for pure logic -
quantity parsing, redaction, line splitting, licence verification.

**Comments say why, not what.** If a line needs explaining, explain the reason
it exists, not what it does.

## Getting set up

```bash
npm install          # Node 20.11+
npm run verify       # no JS source, typecheck, unit tests
npm run e2e          # Playwright against the demo cluster
npm run dev          # server + web client
```

You do not need a Kubernetes cluster. The demo cluster is always present and
contains a CrashLoopBackOff pod, a Pending pod, and pods that emit both plain
and JSON logs, which is most of what the test suite needs.

## Before you open a pull request

- `npm run verify` passes
- `npm run e2e` passes
- New behaviour has a Playwright spec, or a unit test if it is pure logic
- The diff does what its description says and nothing else

## Where things live

| Path | What |
|---|---|
| `packages/schemas` | Kubernetes object schemas, quantity arithmetic |
| `packages/logger` | Structured logging with redaction |
| `packages/k8s` | Kubeconfig, transport, log streaming, watch cache |
| `packages/demo` | The synthetic cluster |
| `packages/licensing` | Licence verification and tier gating |
| `packages/paddle` | Payment webhooks |
| `apps/server` | Local API |
| `docs/` | Plans, research and decisions, with reasoning |

`docs/` is worth reading before proposing anything large. Most "why isn't this
done differently" questions are answered there.
