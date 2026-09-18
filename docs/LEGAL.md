# Legal exposure audit

Checked on 2026-09-18 against the common list (COPPA age gate, Google Fonts,
session replay, marketing email, subscription renewal terms, DMCA agent).
What applies to Mjolnir, what was changed, and what is a note for the website.

| Item | Applies? | State |
|---|---|---|
| Age gate on signup (COPPA) | No. Mjolnir is a developer tool for adults; there is no signup in the app. The website's checkout is run by Paddle, who collect what they need. | Terms on the website say 18+. No age question in the app. |
| Fonts loaded from Google | **Was yes.** `apps/web/index.html` loaded Geist from fonts.googleapis.com, which sends every visitor's IP to Google. | **Fixed.** Geist and Geist Mono ship with the app from `@fontsource-variable/*`; `index.html` has no third-party links. The website must do the same before launch. |
| Session replay on by default | No. There is no analytics, replay or telemetry in the app at all. | Settings › Privacy states it. If crash reports or update checks arrive, they are opt-in, and inputs are never captured. |
| Marketing email without unsubscribe or address (CAN-SPAM) | Website only. | Note for the site: every marketing email carries an unsubscribe link and a physical postal address. Transactional email (licence keys, receipts) is exempt but should still carry the address. |
| Renewal terms next to the subscribe button (California ARL, and EU rules) | Website only. Paddle is merchant of record and shows its own terms, which does not remove our duty to state them where the button is. | Note for the pricing page: beside each subscribe button, in the same view: price, that it renews automatically monthly or yearly, how to cancel (Paddle customer portal link), and that cancelling stops the next charge. Lifetime shows "one payment, no renewal". |
| DMCA designated agent | Not yet. The app and site host no user-uploaded content. | Register the agent (copyright.gov, $6) before any community feature that stores what users upload (shared dashboards, extensions, screenshots). |

## What the app sends

Nothing, to anyone, unless the user configures it:

- Cluster traffic goes to the cluster the user chose, with their kubeconfig.
- The assistant sends the conversation and tool results to the AI provider
  the user set up, with the user's own key. It is off until a key is added.
- The MCP server listens on stdio, or on 127.0.0.1 with a token when enabled.
- Licence activation verifies the key locally against a public key. No call
  is made to check it. Revalidation against the licence service, when it
  arrives, will be documented here and in Settings › Privacy first.

## Data on disk

`~/.mjolnir/settings.json` (mode 0600): settings, the AI key, the MCP token,
the licence key. `~/.mjolnir/licence-signing.key` exists only on the owner's
machine that issues keys. Kubeconfig files are read from where they are and
written only by "Remove from kubeconfig", with a backup beside the file.
