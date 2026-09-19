# Feature plan

What Mjolnir builds, what inspired it, and where we deliberately do it differently.
Nothing here is a port, both reference apps get things wrong that are worth
fixing rather than inheriting.

## The differentiator

**Cloud sessions are bound to clusters.**

Lens and Freelens manage clusters but know nothing about cloud credentials.
Leapp manages cloud credentials but knows nothing about clusters. So the daily
loop for anyone on EKS is: notice a call failed, switch to a credentials tool,
refresh a session, come back, retry.

In Mjolnir an EKS cluster records which cloud session authenticates it. Selecting
the cluster activates that session if it is inactive, refreshes it if it is near
expiry, and says so in the UI. The user never learns that two concepts existed.

Everything in `@mjolnir/cloud` exists to make that one interaction work.

## Log viewer

The source app fetches logs once over HTTP and renders every line as a DOM node.
Freelens streams properly. Neither handles structured logs, which is what most
services actually emit.

| Feature | Notes |
|---|---|
| Streaming follow | WebSocket, auto-pauses when the user scrolls up, resumes on click |
| Virtualized rendering | Bounded DOM regardless of buffer size, asserted in the E2E suite |
| Previous container | The first thing anyone wants on a CrashLoopBackOff; absent from the source app |
| ANSI colour | Currently rendered as literal escape garbage |
| **Structured log view** | **New.** Detect JSON lines and offer a real table with extracted columns, per-field filtering and a detail expander. Neither reference app does this, and most modern services log JSON. |
| Multi-pod aggregation | Stern-style, by deployment or label selector, with per-pod colour |
| Pinned lines | **New.** Bookmark a line and jump back to it, the log equivalent of a breakpoint, for when you are correlating across a long buffer |
| Highlight vs filter | Two distinct modes. Highlight keeps context; filter hides it. Every tool conflates them |
| Time range | Scrub to a window rather than only tailing N lines |
| Download | Blob-based, replacing the `data:` URI that truncates past a few megabytes |

## Cloud access

Modelled on Leapp's concepts, written from scratch (their MPL-2.0 licence makes
copying impossible, and there are things to fix anyway).

**Concepts.** An *Integration* is a durable connection that provisions sessions
(AWS SSO, an Azure tenant). A *Session* is one named, typed, expiring intent to
access an account. Keeping them separate is what lets one SSO integration
discover fifty accounts without fifty pieces of configuration.

**Session types.** IAM user, federated role via SAML, chained role, SSO role,
Azure subscription.

**Chaining as a parent pointer.** A chained session holds a `parentSessionId`,
so a chain is a linked list rather than a special case in credential code.
Arbitrary depth falls out free and every hop stays independently revocable.

**Where we improve on Leapp:**

1. **Expire on the actual token expiry.** Leapp's `Session.expired()` compares
   elapsed time against a global constant, even though the model already carries
   `sessionTokenExpiration`. We use the real value.
2. **Surface expiry before it bites.** A countdown in the UI and a proactive
   refresh, instead of the user discovering expiry through a failed API call.
3. **Typed credentials.** Their `CredentialsInfo` is `{ sessionToken: any }`.
   Ours is validated at the boundary like everything else.
4. **Transitions, not array rewrites.** Their session service reads the whole
   session collection, mutates one entry and writes it all back on every state
   change. Ours does keyed state transitions.
5. **Named profiles stay the write target**, this part they got right. Sessions
   materialise into `~/.aws/credentials`, so every other tool in the terminal
   keeps working. No shell wrapper, no environment injection.

## Cluster experience

| Feature | Source |
|---|---|
| Pinned clusters | Freelens's hotbar. Ours shows reachability in the switcher, so a dead cluster is visible before you click it |
| Per-cluster kubectl version | Freelens. Removes a whole class of old-cluster failures |
| Shell sync | Freelens. Inherit the user's real shell environment in the embedded terminal |
| Dock | Freelens's bottom panel: tabbed logs, terminal, YAML edit, all persistent across navigation |
| Command palette | Already present; becomes cheap and complete once routes are data |

## Resource lists

One generic, virtualized list drives every resource kind. Columns are declared,
not hand-written per screen:

```ts
{ id, priority, header, content(item), sortBy?(item), searchFilter?(item) }
```

This is Freelens's column contract, minus the dependency-injection machinery it
is wrapped in. A plain priority-ordered registry gives the same extensibility
without the ceremony.

**New: saved views.** Filter, sort and column configuration persisted per
resource kind, so "the way I look at pods" survives a restart.

## In-cluster data browsers

Nobody in this category lets you see the *data*, Lens, Freelens and k9s all
stop at the control plane. You can see that a MinIO pod is running and read its
logs, but to look at what is actually in a bucket you leave the app, port-forward
by hand, and reach for `mc` or a browser.

**Bucket store first**, because it is the most common and the easiest to do
well. Detect S3-compatible services in the cluster, MinIO, RustFS, SeaweedFS,
Ceph RGW, from their images, ports and labels, then offer to open them.

| Step | How it works |
|---|---|
| Detection | Known images and container ports, plus an explicit annotation for anything unusual. Never a guess that costs the user anything if wrong. |
| Credentials | Read from the Secret the workload already references (`MINIO_ROOT_USER` and friends), with a manual override. Never stored by Mjolnir, resolved per session and held in the keychain if the user asks. |
| Transport | Port-forward the service, speak S3 over the forward. No ingress required, no credentials leaving the machine. |
| Browsing | Buckets, prefixes as folders, object metadata, sizes and modified times. |
| Preview | Text, JSON, CSV, images and Parquet headers inline. Anything else offers download. |
| Actions | Download, upload, delete, copy an object's `s3://` path or a presigned URL. |

**Why this is worth building.** The reason people keep a terminal open next to a
cluster UI is that the UI stops at the edge of the data. Every time Mjolnir can
answer "what is actually in there?" without a context switch, it replaces a tool
rather than sitting beside one.

**Where the line goes.** Read-only browsing and preview are free, it is the
part that makes people switch. Writes, deletes, uploads and credential
management are Pro, on the same principle as Argo CD: looking is free, acting on
production is not.

**The pattern generalises.** Postgres, Redis, Kafka and Elasticsearch all have
the same shape, a service in the cluster, credentials in a Secret, a protocol
worth a viewer. Bucket store is first because the payoff is highest and the
protocol is simplest. The detection and port-forward machinery is built once and
reused.

## Menu bar extra

A status item that answers "is anything wrong?" without opening the window.
Built with Electron's `Tray`, so it costs nothing extra on the current stack and
works identically on Windows and Linux where those platforms support it.

| Element | Behaviour |
|---|---|
| Icon state | Reflects the worst state across pinned clusters, healthy, degraded, unreachable. A red icon is the whole point: you learn something is wrong without looking for it |
| Cluster switcher | Pinned clusters with live reachability, switch in one click |
| Active cloud session | Which session is active and a countdown to expiry, with refresh inline |
| Quick actions | Open to a saved view, start a port-forward, open a terminal |
| Alerts | Pods entering CrashLoopBackOff or a session about to expire, as native notifications |

The design constraint: the menu bar is glanceable, not a second app. Anything
needing more than one click belongs in the main window.

## Platform

Cross-platform Electron, macOS, Windows, Linux, plus the standalone Docker/web
mode. Native feel is pursued through polish (real title bar, menu bar extra,
native notifications, Keychain-backed secrets, window state restoration) rather
than by giving up three platforms and the Node ecosystem the app depends on.

## Deliberately not doing yet

- **An extension API.** A permanent public commitment that distorts every
  internal boundary designed around it. Revisit once the core is stable.
- **Dependency injection throughout.** Freelens inherits this from Lens. It
  suits a large team and a plugin marketplace; here it is cost without benefit.
