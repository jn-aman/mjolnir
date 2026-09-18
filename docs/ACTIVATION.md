# Buying and activating Pro

## The constraint nobody tells you until you build it

**Paddle Billing does not issue licence keys.** Paddle *Classic* did, it had a
licensing framework and a Mac SDK, and that is what CleanShot X and most of that
generation of Mac apps were built on. Classic is being wound down, Billing
replaced it, and Billing has no licensing entity at all. A search of all 105
methods in the Paddle API returns notification settings, subscriptions and
transactions, nothing that mints or validates a key.

So licence generation, delivery, validation and revocation are entirely ours.
That is why `@mjolnir/licensing` exists and signs its own Ed25519 tokens rather
than asking Paddle for a key. The architecture was already right; this just
means there is no fallback if we get it wrong.

## The flow, in the order the customer experiences it

### 1. In the app

"Get Pro" opens the **system browser** at
`https://mjolnir.sh/buy?plan=annual&n=<nonce>`, not an in-app webview.

People are measurably more willing to enter card details in their own browser,
where they can see the address bar and their password manager works. An embedded
checkout looks like a phishing attempt to exactly the security-minded audience
this app sells to.

`<nonce>` is a random 128-bit value the app generates and remembers. It is what
makes step 4 possible.

### 2. On the website

`mjolnir.sh/buy` opens Paddle Checkout with the nonce passed through as
`custom_data`. Paddle handles card entry, tax, and the receipt.

### 3. The licence service

Paddle sends `transaction.completed` or `subscription.created` to our webhook.
The service, which already exists in `@mjolnir/paddle`:

1. Verifies the `Paddle-Signature` HMAC over the raw body
2. Decides the licence action, issue, extend or revoke
3. Signs an Ed25519 token carrying plan, expiry and update entitlement
4. Stores it against the Paddle customer id **and** the nonce
5. Emails it to the customer

### 4. Activation, three paths, in order of how few clicks they take

**Zero clicks, the app is already waiting.** After opening the browser, the app
polls `GET /activation/<nonce>` every few seconds for about fifteen minutes. The
moment the webhook lands, the poll returns the token and the app activates
itself. The customer finishes paying, switches back, and Pro is already on. They
never see a key. This is the path most people will take, because most people buy
on the machine they are going to use.

**One click, the deep link.** The success page and the email both carry
`mjolnir://activate?key=<token>`. Clicking it launches the app and activates.
This covers buying on a phone, or on a different machine, or coming back a week
later.

**Manual, paste the key.** "I have a licence key" in the app's upgrade screen.
Always present, because deep links fail in corporate mail clients and some
browsers, and a customer who has paid must never be stuck.

### 5. Getting the key back

`mjolnir.sh/license`, enter the purchase email, the key is re-sent. No account,
no password. This is what CleanShot does and it removes most of the support
burden: nearly every "I lost my key" email is really "I did not know where to
look".

## Why not accounts?

Raycast and Linear use sign-in; CleanShot, TablePlus, Proxyman and Bartender use
keys. Keys are right here for three reasons:

1. **Mjolnir works offline.** It talks to clusters on a VPN, in airgapped
   environments, on a plane. A licence that needs a login round-trip is a
   licence that fails exactly when the tool matters most.
2. **No account is a feature** for an audience that already resents having to
   create one, and it means no password reset flow, no session management, and
   no user database to breach.
3. **It is less to build.** Accounts become worth it when workspace sync arrives;
   until then they are a liability.

Workspace sync is the Pro feature that will eventually want an account. The
licence token already carries a seat identifier, so accounts can be added later
without invalidating anything sold before.

## Seats and machines

The token carries a seat id. The licence service records which machines have
activated a key, and the portal at `mjolnir.sh/license` lists them with a
deactivate button.

Policy: **three machines, self-service, no questions.** People have a laptop, a
desktop and a work machine. Fighting that generates support tickets and buys
nothing, anyone determined to share a key will do it regardless, and the
Elastic licence is what makes that a violation rather than merely difficult.

## What has to be built

| Piece | State |
|---|---|
| Ed25519 signing and verification | Done, `@mjolnir/licensing` |
| Webhook verification and licence decisions | Done, `@mjolnir/paddle` |
| Licence service: sign, store, email, `/activation/<nonce>` | Not built |
| `mjolnir://` URL scheme handler in Electron | Not built |
| In-app upgrade screen, nonce polling, key entry | Not built |
| `mjolnir.sh/buy` and `/license` pages | Not built |

The licence service is the next gap and it is small, perhaps 200 lines. It
needs somewhere to run and somewhere to keep the Ed25519 private key, which must
never be in the repo or the app bundle. Cloudflare Workers with the key in a
secret binding is the cheapest option that is not embarrassing.

## Sources

- [Paddle Classic → Billing migration](https://developer.paddle.com/migrate/paddle-classic/concepts)
- [Paddle: selling a Mac app with trials and licensing](https://www.paddle.com/help/start/intro-to-paddle/selling-a-mac-app-with-trials-and-licensing)
- [CleanShot X FAQ, key delivery and the License Manager](https://cleanshot.com/faq)
- [Eternal Storms: selling outside the Mac App Store with Paddle](https://blog.eternalstorms.at/2024/12/18/selling-outside-of-the-mac-app-store-part-ii-lets-meddle-with-paddle/)
