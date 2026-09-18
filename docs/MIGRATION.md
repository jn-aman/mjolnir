# Migration plan

Mjolnir is a TypeScript rewrite of a ~17,300-line JavaScript codebase (6,900 lines
of Express server, 10,400 of React). This is the order the work goes in and why.

## Decisions taken

| Decision | Choice |
|---|---|
| Language | TypeScript, strict, with Zod validating every API boundary |
| Server shape | Split into routers over a shared cluster-client service layer |
| Testing | Playwright E2E against the demo cluster; unit tests only for pure logic |
| Repo shape | npm workspaces — `packages/*` for libraries, `apps/*` for deliverables |

## Why Zod at the boundary

The source app reads Kubernetes API responses with optional chaining all the way
down (`item?.status?.containerStatuses?.[0]?.state?.waiting?.reason`). That style
never throws, which sounds safe but means a shape change shows up as a silently
blank column instead of an error anyone can act on.

`@mjolnir/schemas` replaces it with lenient parsing that is still *total*: a list of
500 pods containing 2 unreadable ones renders 498 rows and reports 2 skipped.
Nothing throws, nothing blanks, and the mismatch is logged with the raw object.

## Order of work

### 1. Foundation — done
- Workspace, strict TS, Playwright harness
- `@mjolnir/schemas`: lenient parsing, quantity arithmetic, core object schemas

### 2. Core migration
- `@mjolnir/k8s` — typed cluster client, kubeconfig and context handling
- `@mjolnir/server` — split `server.js` (~70 routes) into routers:
  `k8s`, `aws`, `azure`, `helm`, `argocd`, `security`, `metrics`, `topology`
- `@mjolnir/web` — port React components to TS, decomposing the three oversized
  ones (`ArgoCD` 1,192 lines, `ResourceViewer` 704, `App` 662)
- `@mjolnir/desktop` — Electron main and preload, with a real IPC contract

### 3. Log viewer
Rebuilt rather than ported. The source version is a one-shot `axios.get`, so it
does not stream at all. Target:
- WebSocket streaming with `follow`, auto-pausing when the user scrolls up
- Virtualized rendering — a bounded DOM window regardless of buffer size
- `--previous` for crashed containers, the first thing anyone wants on a
  CrashLoopBackOff and absent from the original
- ANSI escape handling, currently rendered as literal garbage
- Multi-pod aggregation by deployment or label selector, Stern-style
- Time-range and `since` filtering
- Blob downloads, replacing the `data:` URI that breaks past a few megabytes

### 4. Mac stability
- Crash reporting and structured logging
- Error boundaries per surface, so one broken panel cannot take the window down
- Hardened runtime, notarization, signed auto-update
- Playwright suite green in CI on every PR

### 5. Cloud access layer
Multi-account session management along the lines of Leapp, building on the
existing EKS/AKS import:
- Named sessions per account and role, with chained assume-role
- Credential rotation and expiry surfaced in the UI before it breaks a call
- Keychain-backed secret storage — never plaintext on disk
- Fast switching without touching the user's shell environment

### 6. Docker manager
Local containers, images, volumes and networks alongside the cluster view.
Largest greenfield piece; deliberately last because it shares the resource-list
and log-viewer components built in stages 2 and 3.

## Provenance note

This repository was started fresh with no history carried over from the source
tree, which itself had none. If the original commit history is recoverable from
a backup or a remote, importing it here is worth doing before this tree grows —
it is far better evidence of authorship than any file's contents.
