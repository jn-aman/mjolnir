# Distribution, licensing and the paid tier

## The blocker: MIT and a paywall are incompatible

Odin's `LICENSE` is MIT. MIT grants everyone the right to modify and
redistribute — including deleting the licence check, rebuilding, and publishing
the result as "Odin Free". That is not piracy under MIT; it is the licence
working as written. A paywall on an MIT-licensed public repository cannot be
enforced.

This has to be settled before any paywall code is written, because the answer
changes what the repository is.

### Options

| Option | How it works | Trade-off |
|---|---|---|
| **Open core** (recommended) | Core stays MIT and public. Paid features live in a separate closed-source package the build links in. | Legally clean, keeps community goodwill, proven by GitLab and Grafana. Requires a hard internal boundary between free and paid code. |
| **Source-available** | Relicense to BSL 1.1, Elastic License 2.0 or PolyForm Shield. Source stays public; removing licence checks and commercial redistribution are prohibited. | Enforceable and simple. Not OSI "open source", which some users object to loudly. Used by HashiCorp, Sentry and Elastic. |
| **Closed** | Private repository, distribute signed binaries only. | Simplest legally. Gives up every benefit of being public. |

As sole copyright holder you can relicense future versions freely; what is
already published under MIT stays MIT for those versions forever.

**Recommendation: open core.** The cluster browser is the part that benefits
from being public — it drives adoption and trust for a tool people point at
production. The paid capability (multi-account cloud access) is naturally
separable, is the thing professionals will actually pay for, and sits cleanly
in its own package.

## Free vs paid

The free tier has to be genuinely complete for one developer with a handful of
clusters. A crippled free tier earns bad reviews and no conversions. The paid
tier targets the person managing many accounts professionally — the one with a
budget.

### Free

- Unlimited clusters from the local kubeconfig
- Every resource kind: browse, YAML view and edit, scale, restart, delete
- Pod logs: streaming follow, search, previous-container, ANSI, download
- Interactive terminal and port-forwarding
- Cluster dashboard, topology, events, Helm releases
- Demo mode
- One cloud session at a time

### Pro

| Feature | Why it is the paid side |
|---|---|
| **Multi-account cloud access** | The differentiator. Named sessions, role chaining, SSO integrations, keychain storage, expiry handling. This is what Leapp's users lost and what nobody else bundles with a cluster UI. |
| **Advanced log viewer** | Multi-pod aggregation, the structured-log table, saved searches, pinned lines |
| **Security Center** | Trivy-backed CVE scanning, RBAC audit, exposed-secret detection |
| **Argo CD** | GitOps dashboard, sync, rollback |
| **AI assistant** | Cluster-grounded, bring-your-own endpoint |
| **Menu bar monitoring** | Background health watching and alerts |
| **Saved views** | Per-kind filter, sort and column configuration that persists |

Indicative pricing: **$9/month or $90/year** for an individual. A team tier with
shared configuration comes later, once the single-user product is solid.

## Licence key mechanism

Design constraints, in priority order:

1. **The free tier never depends on the network.** A failed licence call must
   never block someone browsing their own cluster.
2. **Offline-first for Pro too.** Developers work on planes and in airgapped
   environments. A key validates locally.
3. **No phone-home telemetry as a side effect.** Validation checks a licence; it
   does not report usage.

Shape:

- A licence key is an **Ed25519-signed token** carrying tier, issue date, expiry
  and seat identifier.
- The app embeds the **public key** and verifies signatures locally. No network
  needed to start a Pro session.
- **Periodic revalidation** against the licence server every 7 days, to catch
  refunds and revocations, with a **30-day offline grace period**. Past grace,
  Pro features degrade to free — the app keeps working.
- The key lives in the **OS keychain**, like every other secret Odin holds.

Being honest about the limit: with an open-core build, a determined user can
compile the free core and stub the paid package. That is true of every desktop
product and is not worth engineering against. The licence check exists to make
paying the path of least resistance for honest users, not to defeat attackers.

## Payment provider

**Lemon Squeezy or Paddle**, not Stripe directly.

Both are merchants of record: they handle VAT, sales tax and invoicing across
every jurisdiction you sell into. Stripe leaves all of that to you, which for a
solo developer selling internationally is a genuine and recurring burden. The
few extra percent they take is cheaper than the alternative.

## Shipping a DMG

`electron-builder` produces the `.dmg`. The part that actually matters is what
happens when someone else opens it.

### Signing and notarization are not optional

On macOS 15 and later, an unsigned or un-notarized app downloaded from the web
shows **"Odin is damaged and can't be opened. You should move it to the Trash."**
That is Gatekeeper, and it is indistinguishable from a broken build to the
person seeing it. For a paid product it is fatal.

Requirements:

1. **Apple Developer Program membership** — $99/year. There is no way around
   this for distributing outside the App Store.
2. **Developer ID Application certificate**, issued from that account.
3. **Notarization** via `notarytool` with an App Store Connect API key, then
   **stapling** the ticket to the DMG so it validates offline.
4. **Hardened runtime** enabled, with entitlements for the things Odin actually
   does — spawning `kubectl` and shell processes needs
   `com.apple.security.cs.allow-unsigned-executable-memory` and
   `allow-jit` for the embedded terminal.

### Build targets

| Platform | Artifact | Signing |
|---|---|---|
| macOS | `.dmg` (arm64 + x64, or universal) | Developer ID + notarization, required |
| Windows | `.exe` (NSIS) | Authenticode cert, strongly recommended — SmartScreen warns otherwise |
| Linux | `.AppImage`, `.deb` | Not required |

### Auto-update

`electron-updater` against GitHub Releases is the cheapest path and works with
the signing already in place. This is also where the earlier appId note bites:
changing the bundle identifier breaks the update path for existing installs, so
it must be settled before the first public release, not after.

## Order of work

1. Settle the licence question — everything else depends on it
2. Apple Developer enrolment (takes days, sometimes longer — start early)
3. `@odin/licensing`: key verification, tier gating, keychain storage
4. Feature gates at the package boundary, not sprinkled through the UI
5. electron-builder config, signing, notarization, stapling
6. Auto-update
7. Payment integration and the purchase flow
