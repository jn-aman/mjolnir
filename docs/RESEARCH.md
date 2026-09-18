# What to take from Freelens and Leapp

Research notes feeding stage 2 of [MIGRATION.md](MIGRATION.md).

## Licensing — read this first

| Project | License | What that means for Odin |
|---|---|---|
| [Freelens](https://github.com/freelensapp/freelens) | **MIT** | Code can be reused directly, with attribution. Compatible with Odin. |
| [Leapp](https://github.com/Noovolari/leapp) | **MPL-2.0** | **Design reference only.** Do not copy source. |

MPL-2.0 is file-level copyleft: any file containing Leapp code stays MPL-2.0 and
carries source-disclosure obligations, even inside an otherwise-MIT project.
Architecture and concepts are not copyrightable, so we can learn from the model
freely — but every line in `@odin/cloud` must be ours.

## Freelens

MIT · 5,592 stars · last push 2026-09-18 · TypeScript · pnpm + Turbo

A maintained fork of OpenLens, which is itself the open core of Lens Desktop.
It is the closest thing to a reference implementation of this product category.

### Package decomposition worth copying

Their split maps almost one-to-one onto the plan already written, which is
reassuring, and sharpens it in three places:

| Freelens package | Lesson for Odin |
|---|---|
| `kube-object` | Object modelling lives in its own package, isolated from UI. Matches `@odin/schemas`. |
| `list-layout` | **The important one.** One generic resource-list abstraction drives every resource type. It is how they support 40+ kinds without 40 components — and the reason the source app has a 704-line `ResourceViewer`. |
| `metrics` | Metrics is its own package, not a field on each resource. Worth splitting out of `@odin/k8s`. |
| `logger` | Structured logging as a first-class package, not `console.log` scattered through routes. |
| `routing` | Routes as data, which is what makes their command palette and deep links cheap. |

### Features worth taking

1. **Hotbar / pinned clusters** — pin frequently used clusters for one-click switching. Directly useful given Odin targets multi-account users.
2. **kubectl version management per cluster** — bundle and select a kubectl matching the cluster version. Solves a real class of "works on my machine" bugs with older clusters.
3. **Shell sync** — inherit the user's actual shell environment in the embedded terminal. A constant source of complaints in every tool that gets it wrong.
4. **Download logs to file** — they treat it as a distinct feature with its own tests, not a `data:` URI afterthought.
5. **Namespace filtering as a global concern** rather than per-screen state.
6. **Resource templates** — scaffolds for creating new objects from the UI.

### What to skip

- **The dependency-injection architecture.** `register-injectables-main.ts` /
  `register-injectables-renderer.ts` and injection tokens throughout are a Lens
  inheritance that suits a large team and a plugin marketplace. For Odin it is
  ceremony that buys nothing yet.
- **The extension system**, for now. It is a large, permanent API commitment.
  Revisit once the core is stable; designing for it prematurely distorts
  everything else.

## Leapp

MPL-2.0 · 1,774 stars · last push 2026-05-16 · TypeScript · Electron

Noovolari, the company behind it, [shut down](https://blog.leapp.cloud/noovolari-has-officially-come-to-an-end);
the commercial Pro and Team products went offline on 30 June 2024. The OSS repo
is still maintained but the cadence has slowed. Their users need a new home, and
nobody has combined cluster viewing with cloud access management in one app —
which is the clearest differentiator Odin has against Lens, Freelens and k9s.

### The domain model to learn from

A `Session` is the unit of everything: a named, typed, expiring intent to access
a cloud account. It carries `sessionId`, `status`, `type`, `startDateTime`,
`sessionTokenExpiration`, and an `expired()` predicate that drives rotation.

Session types observed in their model:

- `awsIamUser` — long-lived keys, exchanged for short-lived credentials
- `awsIamRoleFederated` — SAML assertion against an IdP URL
- `awsIamRoleChained` — assume a role *using another session's credentials*
- `awsSsoRole` — provisioned automatically from an AWS SSO integration
- `azure` — subscription and tenant based
- plus `google`, `alibaba`, `localstack`

### The three ideas worth adopting

1. **Chaining as a parent pointer.** `AwsIamRoleChainedSession` holds a
   `parentSessionId`, so a chain is a linked list of sessions rather than a
   special case in the credential code. Arbitrary depth falls out for free, and
   each hop stays independently inspectable and revocable.
2. **Integration vs Session.** An *Integration* (AWS SSO, Azure tenant) is a
   durable connection that *provisions* sessions; a *Session* is one access
   intent. Keeping them separate is what lets SSO discover fifty accounts and
   generate fifty sessions without fifty pieces of configuration.
3. **Named profiles as the write target.** Sessions materialise into
   `~/.aws/credentials` profiles. Every other tool in the user's terminal keeps
   working, because the integration point is the file AWS already reads —
   no shell wrapper, no environment injection.

### Security model to match or beat

- Secrets in the OS keychain, never plaintext on disk
- Short-lived credentials with automatic rotation before expiry
- Configuration and secrets stored separately, so config is portable and
  secrets are not

Odin should beat this on one axis: surface impending expiry *in the UI before a
call fails*, rather than letting the user discover it through an error.

## Effect on the plan

- `@odin/schemas` stays as designed — Freelens validates isolating object
  modelling from UI.
- **Add `@odin/metrics` and `@odin/logger`** as separate packages in stage 2.
- **Build the generic list-layout abstraction early**, before porting resource
  screens. Porting first and abstracting later reproduces the 704-line component
  we are trying to escape.
- `@odin/cloud` models `Session` and `Integration` as distinct concepts from day
  one, with chaining as a parent pointer — written from scratch, MPL-clean.
