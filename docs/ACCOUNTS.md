# Accounts and subscriptions

## Why an account at all

Mjolnir already has offline licence keys: an Ed25519-signed blob of claims,
verified against a public key inside the build. That is a good thing and it
stays. It is also not enough, and here is exactly what it cannot do.

| Situation | With a key alone | Why it matters |
|---|---|---|
| Customer loses the key | They email support | Every single one of them, eventually |
| Key pasted on 200 machines | Works on all 200 | There is no seat model, so there is no team plan |
| Subscription cancelled | Key keeps working until it expires | A monthly key stays valid for up to a month after the money stops |
| Refund or chargeback | Key keeps working | No way to take it back |
| Lifetime key leaks | Valid forever, everywhere | One leaked key is the whole product |
| Buy 10 seats | No concept of assigning them | Cannot sell to a team |
| Upgrade monthly to annual | Needs a new key by email | Friction on the one path we want to be easy |
| "Sign me out of my old laptop" | Impossible | Basic hygiene people expect |
| Sync workspaces between machines | Nothing to sync against | `workspace.sync` is already listed as a Pro feature |
| Update a card, read an invoice | Nothing | Paddle's portal needs to know who is asking |

So: an account. The question is how to add one without turning a desktop tool
into something that stops working when a server does.

## The shape

**The account is how you get a licence. The licence is still what grants
access, and it is still verified offline.**

Signing in does not make the app phone home to decide whether to open. It
fetches a short-lived signed lease, and everything after that is local.

```
  mjolnir.sh                          the app
  ----------                          -------
  sign in (email code)   ──────────▶  refresh token  → OS keychain
  refresh                ──────────▶  access token   → memory, 15 min
  POST /licence/lease    ──────────▶  lease          → ~/.mjolnir/lease.json
                                        │
                                        ▼
                                      verified against the public key
                                      in the build. No network.
```

A lease is the existing claims plus three fields: the device it was issued to,
an expiry about a week out, and a nonce. The app refreshes it daily while it
can, and keeps working on the last one until it expires.

That single change buys almost everything in the table above:

- **Revocation** happens because leases are short. Cancel, and the app loses
  Pro within the lease window rather than never.
- **Seats** work because a lease names a device, and the server counts them.
- **Recovery** is signing in again.
- **Device management** is a list of leases, revocable from the website.

## Sign-in, concretely

A desktop app cannot keep a client secret, so the usual web OAuth dance is the
wrong one. Two options work:

1. **Loopback redirect with PKCE.** The app opens a browser at
   `mjolnir.sh/authorize`, listens on `127.0.0.1:0`, and the browser redirects
   back with a code.
2. **Device authorization grant** (RFC 8628). The app shows a short code, the
   person opens `mjolnir.sh/device` anywhere and types it.

**Use the device grant.** It is fewer moving parts, it survives a browser on a
different machine, it does not need a loopback listener that corporate security
software dislikes, and the code is readable over a desk. The loopback flow can
come later as a convenience.

### Who signs you in

The device grant decides *how the app waits*. It says nothing about how the
person proves who they are, and that is the point: the website owns that, so
adding a provider never needs an app release.

| Provider | For | What we read |
|---|---|---|
| Email code | Anyone, and the fallback when everything else is down | The address |
| GitHub | Most of our buyers already have one open | The primary email. No repository scopes, ever |
| Google | The other half | The email |
| Okta | Organisations that require it | Whatever their tenant asserts |

**Email is a one-time code, not a password.** No password means no reset flow,
no credential stuffing, no hashing decisions, and no breach that matters.

The app's part is small but not nothing:

- It renders the buttons the server says are available, rather than a fixed
  list that goes stale when a provider is added or an organisation disables one.
- It can send a `provider` preference, so clicking "Continue with GitHub" goes
  straight there instead of showing a code to read aloud for no reason. It is
  a **preference**: a tenant that enforces Okta must be able to ignore it, or
  enforcement is a suggestion.
- It can send a `login_hint`, so an enterprise sign-in routes to the right
  tenant without asking someone which company they work for.
- It reports which identity is signed in afterwards. "Signed in" with no name
  attached is not an answer to "who is using this seat".

### Okta, specifically

Okta is not a fourth button, it is a different shape of customer.

- **Configured per organisation.** An org record holds its Okta issuer, client
  id and secret, plus the email domains it claims.
- **Domain capture.** Once `acme.com` is verified, anyone signing in with an
  `@acme.com` address is sent to Acme's Okta, whatever button they pressed.
  Without this, one employee uses GitHub, another uses Okta, and the same
  human has two accounts and two seats.
- **Enforcement is visible.** The app shows one button and a sentence naming
  whose policy it is. "Sign-in is restricted" with no reason reads as a bug;
  "Acme requires everyone to sign in through Okta" reads as a policy, which is
  what it is.
- **SCIM comes with it.** Organisations that buy Okta expect deprovisioning to
  work: removing someone in Okta should free their seat without anyone filing
  a ticket. `/scim/v2/Users` with `active: false` revokes their refresh tokens
  and their device leases.
- **Verify the domain before trusting it.** A DNS TXT record, checked before
  any redirect is honoured, or anyone who signs up with a Gmail address could
  claim `google.com` and hijack every sign-in on that domain.

Group to plan mapping is deliberately **not** in the first version. Okta
groups deciding who gets Pro sounds tidy and turns every support question into
a question about someone else's directory.

```
app                          mjolnir.sh                      person
---                          ----------                      ------
POST /device/code      ────▶
  {client, scope}
                       ◀────  {device_code, user_code: "HAMR-4Q7X",
                               verification_uri, interval: 5, expires_in: 900}

shows HAMR-4Q7X and the URL                                   opens the URL,
                                                              enters the code,
                                                              enters their email,
                                                              enters the emailed code

POST /device/token     ────▶  (every 5s)
  {device_code}
                       ◀────  authorization_pending
                       ◀────  ...
                       ◀────  {refresh_token, access_token, expires_in}
```

The app polls at the interval the server gave it, honours `slow_down`, and
gives up at `expires_in`. Nothing is stored until the exchange succeeds.

## Where secrets live

| Secret | Where | Why |
|---|---|---|
| Refresh token | OS keychain (Keychain, Credential Manager, libsecret) | It is a long-lived credential; `settings.json` is world-readable to anything running as the user, gets copied into dotfile repos, and ends up in screenshots |
| Access token | Memory only | 15 minutes, never written |
| Lease | `~/.mjolnir/lease.json`, mode 600 | It is signed and device-bound, so a copy is useless elsewhere; it must survive a restart with no network |
| Licence public key | In the build | Verification must not depend on anything downloaded |
| Licence signing key | Only on the server, ideally in a KMS | A leaked signing key mints free licences forever |

If the keychain is unavailable (headless Linux, locked login keyring), fall
back to `~/.mjolnir/credentials.json` at mode 600 and **say so in settings**,
rather than silently doing the less safe thing.

## Seats

A subscription has a seat count. A lease consumes a seat for its device.

- Asking for a lease when every seat is taken returns `seat_limit` with the
  list of devices holding them: name, platform, last seen.
- The app shows that list and offers to sign one out, which revokes that
  device's refresh token and frees the seat immediately.
- A device that has not refreshed for 60 days releases its seat on its own, so
  a lost laptop does not permanently cost a seat.

## Lifetime licences

A lifetime purchase that stops working when a server goes away is not a
lifetime purchase. So lifetime accounts can mint a **perpetual key**: the
existing format, no `notAfter`, bound to nothing, valid forever, covering
releases up to `updatesUntil`.

Leases are the default because they are better for everyone while the service
is healthy. The perpetual key is a one-click escape hatch on the account page,
and it is the honest thing to offer someone who paid once.

## Failure behaviour

This is the part that decides whether people trust the tool.

| What happened | What the app does |
|---|---|
| Offline | Nothing changes. The lease is valid until `notAfter` |
| Lease expired, still offline | 30 day grace, Pro stays on, a quiet line in the status bar counting down |
| Grace exhausted | Falls back to Free. Never blocks, never logs anyone out of their clusters |
| mjolnir.sh is down | Nothing changes. Refresh fails quietly and retries with backoff |
| Refresh token rejected | Sign-in prompt in settings. Pro continues until the lease expires |
| Not signed in at all | Free tier, fully usable, forever |

**Nothing about reaching a cluster ever depends on the licence server.** An
ops tool that will not open a cluster because a billing service is down is a
tool nobody will keep. Free tier is a complete single-cluster Kubernetes
client and it stays that way.

## What runs on mjolnir.sh

```
POST /api/device/code           start a device grant; returns the providers
                                this person may use, and any enforcement
POST /api/device/token          poll for the result; returns the identity
POST /api/token/refresh         access token from a refresh token
POST /api/token/revoke          sign out this device

GET  /api/account               email, plan, seats, renewal date
GET  /api/account/devices       every device with a lease
DELETE /api/account/devices/:id sign out another device

POST /api/licence/lease         issue or renew a lease for this device
POST /api/licence/perpetual     mint a lifetime key (lifetime plans only)

POST /api/webhooks/paddle       subscription and transaction events

GET  /oauth/github/callback     provider callbacks, browser side
GET  /oauth/google/callback
GET  /oauth/okta/callback

GET  /api/org/:id/sso           an organisation's Okta settings
POST /api/org/:id/sso/verify    prove a domain with a DNS TXT record
     /scim/v2/Users             Okta deprovisioning frees the seat
```

Paddle stays the merchant of record. Card changes, invoices and cancellation
go to Paddle's customer portal, linked from the account page, so we never
touch a card number.

Webhooks to handle: `subscription.created`, `subscription.updated`,
`subscription.canceled`, `transaction.completed`, and `adjustment.created`
for refunds. The link between a payment and an account is `customer.email`.
If no account exists when a payment arrives, create one and email a sign-in
link, because the purchase must work before the account does.

## Privacy

The account stores an email, a Paddle customer id, and per device: a name
(the hostname, editable), platform, app version, and a last-seen date.

It does not store, and must never store, cluster names, context names,
namespaces, object names, kubeconfig contents, or anything read from a
cluster. Telemetry stays anonymous and is not joined to the account.

An account is optional. A licence key pasted into settings works with no
account at all, which is what an air-gapped site or a security-conscious team
will want.

## Order of work

1. `packages/account`: the lease format, its verification, and the device
   grant client. Pure, testable, no network required to test.
2. Keychain-backed credential storage with a stated fallback.
3. `/api/account/*` in the local server, talking to mjolnir.sh.
4. Settings → Account: sign in, plan, devices, billing link.
5. The mjolnir.sh service.
6. Paddle sandbox end to end, then live.
