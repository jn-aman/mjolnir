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

**Five by default.** The people who buy this run a laptop, a desktop, a work
machine and something in a VM, and a tool that makes them choose is a tool they
resent on the second machine. Five costs us nothing, and it is small enough
that a team of twenty still has to buy twenty.

Seats are the `quantity` on the Paddle subscription item, so buying more is
buying more of the same thing and the price follows automatically. A seat
count that goes up mid-period takes effect immediately rather than at the next
renewal, because someone who has just paid for more machines wants them today.

**A seat is held by a machine with a live licence, not by one that has signed
in.** Those are not the same and conflating them is wrong in both directions:
signing in on a sixth machine just to look at the account page would burn a
seat before that machine had a licence at all, and a machine that stopped
renewing would keep its seat long after it stopped being used. Tying the seat
to the lease means it frees itself a week after a machine stops asking, which
is the same week that machine stops being Pro. One clock, not two.

- Asking for a lease when every seat is taken returns `seat_limit` **with the
  list of machines holding them**: name, platform, version, last seen. "No
  seats left" with nothing to act on is a dead end, and what the person
  actually wants is to sign out a laptop they no longer own.
- Signing a machine out frees its seat immediately. The lease already on that
  machine keeps working until it expires, because it is signed and we cannot
  reach into it. That is the revocation window, and it is why the window is a
  week.

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

GET  /api/auth/providers                     what this deployment can offer
GET  /api/auth/oauth/:provider/start         browser leaves for the provider
GET  /api/auth/oauth/:provider/callback      and comes back here

GET  /api/org/:id/sso           an organisation's Okta settings
POST /api/org/:id/sso/verify    prove a domain with a DNS TXT record
GET  /scim/v2/ServiceProviderConfig          what Okta reads before it will set up
GET  /scim/v2/ResourceTypes
GET  /scim/v2/Schemas
     /scim/v2/Users                          the directory owns who has a seat
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

## What is built

| Piece | State |
|---|---|
| `packages/account`: lease format, verification, device grant client | done, 37 tests |
| Keychain storage with a stated fallback | done |
| `/api/account/*` in the local server | done |
| Settings → Account: sign in, plan, machines, billing | done, behind `account.sign-in` |
| `apps/site`: the service itself | done, 19 tests through HTTP |
| Paddle webhook: payment becomes a subscription | done, not yet run against Paddle |
| GitHub, Google and Okta callbacks | done, 18 tests through HTTP |
| SCIM deprovisioning | done, 16 tests through HTTP |
| Deployment of api.mjolnir.sh | running on the VM, waiting on DNS |

### Configuring the browser providers

Each provider needs an app, and each app needs exactly one redirect URI:

```
https://api.mjolnir.sh/api/auth/oauth/github/callback
https://api.mjolnir.sh/api/auth/oauth/google/callback
https://api.mjolnir.sh/api/auth/oauth/okta/callback
```

GitHub and Google are configured once, for the whole deployment:

```
MJOLNIR_PUBLIC_URL=https://api.mjolnir.sh
GITHUB_CLIENT_ID=...      GITHUB_CLIENT_SECRET=...
GOOGLE_CLIENT_ID=...      GOOGLE_CLIENT_SECRET=...
```

Half-configured counts as off. A client id with no secret would produce a
button that opens a browser and fails at the exchange, so `/api/device/code`
only offers the providers whose apps are complete, and the app renders the
buttons it is told about rather than a fixed list.

Okta is per organisation and lives in the `organisations` row: `sso_issuer`,
`sso_client_id`, `sso_client_secret`. The issuer is the authorisation server,
usually `https://tenant.okta.com/oauth2/default`, and its endpoints are read
from `/.well-known/openid-configuration` rather than assembled by hand, because
tenants using a custom authorisation server do not put them where the
conventional layout says.

Scopes: `read:user user:email` on GitHub, `openid email profile` elsewhere.
Nothing on GitHub touches a repository, and nothing here should ever need to.

### What makes it safe

Five properties, each with a test that fails if it is removed:

- **PKCE on every provider**, confidential client or not. The secret already
  protects the exchange; this closes the case where a code leaks through a
  redirect, a proxy log or an extension before we redeem it.
- **State is single use and bound to the grant**, so a callback cannot approve
  a device other than the one it was started for, and a replayed callback
  finds nothing.
- **Identity comes from the token endpoint, server to server, over TLS.**
  Nothing the browser hands us decides who anyone is.
- **An unverified address never reaches an existing account.** GitHub will
  return an address the user typed into their profile and never confirmed;
  `/user/emails` is the only trustworthy answer, and absent means no.
- **A tenant may only vouch for domains its organisation has verified.**
  Without that check, anyone able to configure an Okta tenant could have it
  assert a stranger's address.

### SCIM, and why it is the part that sells

Provisioning is a convenience. Deprovisioning is the reason an organisation
asks for SCIM at all, because "we removed them in Okta three weeks ago and
they still have a licence" is a finding in an audit rather than a support
ticket, and it is the question every security review asks before a deal
closes.

So the important line is short. Setting `active` to false:

1. revokes every device on that account, which frees the seat that second
   rather than whenever the last lease happens to lapse,
2. marks the account, so `issueLease` refuses to hand out another one,
3. and leaves the lease already on their laptop working until it expires.

Step three is not a gap, it is the stated revocation window. A lease is signed
and offline-verifiable, which is the whole reason the app keeps working on a
plane, and the cost of that is that we cannot reach into one already issued.
The window is a week because `LEASE_DAYS` is seven. Making it shorter makes
offboarding faster and flying worse; that trade is the number, and it is the
number to argue about if a customer needs a different one.

Deactivating does **not** delete the account. Someone who leaves a company and
comes back, or who has a personal licence on the same address, should not find
their history erased by an offboarding script. A `DELETE` removes them from
the directory and suspends the account, and the account itself survives.

Only the User resource is implemented. `/scim/v2/Groups` answers 501, because
plans are not per-group yet and an endpoint that accepts writes and silently
does nothing with them is worse than one that says what it is.

Setting a tenant up is a conversation, not a form, and there is a script for
it rather than a half-finished admin UI that would still need the call:

```
npm run org -- --create "Acme" --domain acme.com     prints the DNS TXT record
npm run org -- --id org_x --verify acme.com          once the record is there
npm run org -- --id org_x --sso https://acme.okta.com/oauth2/default                           --client-id A --client-secret B
npm run org -- --id org_x --enforce                  everyone on the domain
npm run org -- --id org_x --scim-token               printed once, hashed here
npm run org -- --list
```

Verifying a domain decides where every sign-in on it is routed, so it goes in
only once the TXT record has actually been seen.

### Deployed

`npm run deploy:site` puts it on the box. It builds the workspace packages
here, ships the source, and runs it as a container beside the Cloudflare
tunnel on the tunnel's own Docker network.

**Beside the tunnel, not on the host**, for two reasons. A container on that
box cannot reach a host port, because the firewall does not allow it. And
being on the tunnel's network means nothing is published on the host at all:
there is no port to find, and the only way in is through Cloudflare.

The signing key is generated on the server and never leaves it. It is
bind-mounted read-only, and the deploy reads the *image's* gid to chown it,
because a bind mount carries numeric ids across unchanged and the host user
and the image user are not the same number. That one cost an EACCES with
nothing to say why.

**The script does not touch the tunnel.** A connector already runs in the
Unleash stack, and the ingress rules live in Cloudflare rather than in a file
on the box. An earlier version of this script installed a second connector on
the same token, which makes Cloudflare load-balance across both: half of
every request for `unleash.mjolnir.sh` would arrive at a connector with no
route to Unleash and come back 502.

Still to do by hand, both in a browser:

1. Point `mjolnir.sh` at Cloudflare. It is registered and has no nameservers,
   so nothing on it resolves yet.
2. Add the public hostname `api.mjolnir.sh` to the tunnel, pointing at
   `http://mjolnir-site:8787`.

### Running it locally

```
MJOLNIR_DB=/tmp/site.db PORT=8787 node apps/site/dist/main.js
MJOLNIR_API_URL=http://127.0.0.1:8787 npm run dev
```

With no configuration it uses an in-memory store, makes a development signing
key beside the database, and prints sign-in codes to its log instead of
emailing them. That is not a shortcut: it is what makes the whole flow
testable without an email provider or a Paddle account.

### Verified end to end

- Sign in from the app, approve on the site, app receives it
- Subscription becomes a lease, lease verifies offline against the public key
- The same lease refuses to work on a different machine
- Five machines get seats, the sixth is refused with the list attached
- Signing one out frees the seat and the sixth succeeds immediately
- **Service killed: the app stays Pro, the cluster is untouched, and the error
  names the host it could not reach**
