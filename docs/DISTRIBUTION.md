# Distribution, licensing and the paid tier

## Licence

Odin is licensed under the **Elastic License 2.0**, replacing the MIT licence
used by earlier versions.

MIT could not work here: it grants everyone the right to delete the licence
check, rebuild, and redistribute the result as "Odin Free", legally. Elastic
License 2.0 keeps the source public and readable while explicitly prohibiting
the three things that would break a paid product:

1. Providing Odin to third parties as a hosted or managed service
2. **Circumventing the licence key functionality**
3. Removing or obscuring licensing, copyright or other notices

It is short, widely understood, and used by Elastic and others for exactly this
shape of product. It is *source-available*, not OSI open source — some people
object to that publicly, and it is worth being upfront rather than implying
otherwise.

As sole copyright holder you can license future versions however you like.
Versions already published under MIT remain MIT for those versions, permanently.
That cannot be undone, only stopped going forward.

> This reflects the stated requirement — a public repository with an enforceable
> paywall. It is not legal advice. If real revenue is going to depend on it,
> have a lawyer read it once.

## Free vs paid

The line: **free is a complete Kubernetes desktop client for one person and
their own clusters. Pro is for managing access across many accounts, and for
anything that acts on a cluster in a privileged or automated way.**

That line is defensible in a sentence, which matters — a pricing page nobody can
summarise converts badly.

### Free — deliberately generous

Everything a working developer needs day to day:

- **Unlimited clusters and contexts** from the local kubeconfig
- **Every resource kind** — browse, inspect, YAML view and edit, scale, rollout
  restart, delete
- **The full single-pod log viewer**: streaming follow, regex search, previous
  container, ANSI colour, time ranges, pinned lines, the structured-log table,
  and file download
- **Interactive terminal** and **port-forwarding**
- **Cluster dashboard**, topology graph, events, node and capacity views
- **Helm releases** — browse, values, rendered manifests
- **Argo CD** — read-only dashboard and resource tree
- **Custom resources** — full tree and detail
- **Menu bar extra** with cluster health at a glance
- **Saved views**, pinned clusters, command palette
- **Demo mode**
- **One cloud account** — EKS and AKS import, as today

The structured-log table stays free on purpose. It is the most visible thing
Odin does that Lens and Freelens do not, and it is worth more as a reason to
switch than as a line item on a pricing page.

### Pro

| Feature | Why it sits here |
|---|---|
| **Multi-account cloud access** | The differentiator. Named sessions, role chaining, SSO integrations, keychain storage, expiry handling, and sessions bound to clusters so selecting an EKS cluster activates its credentials. This is what Leapp's users lost and what nobody bundles with a cluster UI. |
| **Multi-pod log aggregation** | Stern-style tailing across a deployment or label selector. Single-pod logs are free; fanning out across a fleet is a team-scale need. |
| **Security Center** | Trivy-backed CVE scanning, RBAC audit, exposed-secret detection. |
| **Argo CD operations** | Sync, refresh, rollback. Reading is free; acting on GitOps is not. |
| **AI assistant** | Cluster-grounded, bring-your-own endpoint. |
| **Background monitoring and alerts** | Menu bar health is free; watching for CrashLoopBackOff and expiring sessions in the background, with notifications, is Pro. |
| **Workspace sync and export** | Share saved views and cluster configuration across machines. |

## Pricing

Both models, as requested. Paddle supports subscriptions and one-time purchases
under the same account.

| Plan | Price | What you get |
|---|---|---|
| **Monthly** | $9/month | Pro features, updates while subscribed |
| **Annual** | $90/year | Two months free versus monthly |
| **Lifetime** | $149 once | Perpetual licence, plus 12 months of updates |

**How the one-time plan works — the perpetual fallback model**, as used by
JetBrains, Sublime Text and Tower:

- You pay once and own Odin permanently
- You receive every update released in the following 12 months
- After 12 months the app keeps working forever, at the newest version you were
  entitled to. Nothing expires, nothing degrades
- Continuing to receive *new* updates costs a renewal, around $79/year

This matters for sustainability. A true unlimited-lifetime licence sells well in
month one and then funds nothing, while support costs continue indefinitely. The
perpetual fallback gives buyers genuine ownership — the thing they actually want
from a one-time purchase — without promising free work forever.

## Licence key mechanism

Constraints, in priority order:

1. **Free never depends on the network.** A failed licence call must never block
   someone browsing their own cluster.
2. **Offline-first for Pro too.** Developers work on planes and in airgapped
   environments.
3. **No telemetry as a side effect.** Validation checks a licence; it does not
   report usage.

Shape:

- A licence key is an **Ed25519-signed token** carrying plan, tier, issue date,
  update-entitlement expiry and a seat identifier
- The app embeds only the **public key** and verifies locally — no network is
  needed to start a Pro session
- **Revalidation** against Paddle every 7 days catches refunds, chargebacks and
  revocations, with a **30-day offline grace period**. Past grace, Pro features
  fall back to free; the app keeps working
- For lifetime keys, an expired update entitlement is **not** a licence
  expiry — the token's version ceiling is what gates new builds
- The key lives in the **OS keychain**, like every other secret Odin holds

Being honest about the limit: a determined user can patch any desktop binary.
The licence check makes paying the path of least resistance for honest users. It
is not, and cannot be, an anti-tamper system — and the Elastic licence is what
makes circumventing it a licence violation rather than merely difficult.

## Payment: Paddle

Paddle is the **merchant of record** — it handles VAT, sales tax and invoicing
in every jurisdiction you sell into. For a solo developer selling
internationally that removes a genuine recurring burden that Stripe would leave
entirely to you.

Integration points:

- **Paddle Checkout** — hosted overlay, opened from the app's upgrade screen
- **Webhooks** — `subscription.created`, `subscription.canceled`,
  `transaction.completed`, `adjustment.created` (refunds) drive licence issuance
  and revocation
- **Licence issuance** — a small service signs an Ed25519 token on a completed
  transaction and emails it, plus makes it retrievable in-app
- **Customer portal** — Paddle-hosted, so no subscription management UI to build

## Shipping a DMG

`electron-builder` produces the `.dmg`. What matters is what happens when
someone else opens it.

### Signing and notarization are not optional

On macOS 15 and later, an unsigned or un-notarized app downloaded from the web
shows **"Odin is damaged and can't be opened. You should move it to the Trash."**
That is Gatekeeper, and to the person seeing it, it is indistinguishable from a
broken build. For a paid product it is fatal.

Requirements:

1. **Apple Developer Program membership** — $99/year. No way around it for
   distribution outside the App Store. Enrolment can take days; start early
2. **Developer ID Application certificate** from that account
3. **Notarization** via `notarytool` with an App Store Connect API key, then
   **stapling** the ticket so the DMG validates offline
4. **Hardened runtime** with entitlements for what Odin actually does — spawning
   `kubectl` and shell processes, and JIT for the embedded terminal
5. Every **nested binary** in the bundle must be signed too, including the
   bundled Trivy

### Build targets

| Platform | Artifact | Signing |
|---|---|---|
| macOS | `.dmg`, arm64 + x64 | Developer ID + notarization, required |
| Windows | `.exe` (NSIS) | Authenticode, strongly recommended — SmartScreen warns otherwise |
| Linux | `.AppImage`, `.deb` | Not required |

### Auto-update

`electron-updater` against GitHub Releases, which works with the signing already
in place. The bundle identifier must be settled before the first public release:
changing it later breaks the update path for every existing install.

## Order of work

1. ~~Settle the licence question~~ — done, Elastic License 2.0
2. Apple Developer enrolment — start now, it gates the first shareable build
3. `@odin/licensing` — Ed25519 verification, tier gating, keychain storage
4. Feature gates at the package boundary, not sprinkled through the UI
5. electron-builder config, signing, notarization, stapling
6. Auto-update
7. Paddle integration, licence-issuing service, purchase flow
