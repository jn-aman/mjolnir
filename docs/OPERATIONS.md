# Running Mjolnir on other people's machines

Mjolnir is a desktop app that holds credentials for every cluster its user
owns. Everything in this document follows from that: the set of things it will
contact is fixed, the set of things it will say about itself is fixed, and both
are visible from inside the app.

## One apex

Every first-party address is declared in `packages/endpoints`, and
`isAllowedHost` refuses anything that is not `mjolnir.sh` or a subdomain over
HTTPS. The check parses the URL rather than matching a suffix, because
`https://mjolnir.sh.example.com` ends with the right letters and is not us.
Loopback is allowed for development against a stand-in.

| Host | Serves | Behind it |
|---|---|---|
| `mjolnir.sh` | Site, docs, release notes | Static hosting |
| `api.mjolnir.sh` | Licence activation | Our API, which proxies Paddle |
| `flags.mjolnir.sh` | Feature toggles | Unleash Edge |
| `telemetry.mjolnir.sh` | Usage events and crash reports | Ingest |
| `updates.mjolnir.sh` | `latest*.yml` and the artefacts | Object storage |

Third parties still do the work; what matters to the person running Mjolnir is
that an egress rule of `allow *.mjolnir.sh` covers the entire app, and that a
network that blocks everything else degrades the app rather than breaking it.

**What this does not cover**: clusters, container engines, registries and object
stores go wherever the user has pointed them. Mjolnir talks to those directly,
as the user, and never proxies them through us. That is the whole reason the
app exists.

## Feature flags

`packages/flags` holds the catalogue. A flag that is not declared there does not
exist, so a toggle appearing on the server cannot introduce behaviour into a
build that has no code for it.

Precedence, highest first:

1. **An override**, a switch the person moved in Settings, Feature flags.
2. **The flag server**, when one is configured and reachable.
3. **The build default**, compiled in.

The order matters. A remote server may suggest what a build does; it may not
take a switch out of the hands of the person at the keyboard. And because the
default is local, the app has an answer before the network does and behaves the
same on a plane as in an office.

### Wiring up Unleash

Run Unleash Edge behind `flags.mjolnir.sh` and give the app a client token.
Mjolnir polls `GET /api/client/features` on an interval (15 minutes by default),
evaluates the strategies itself, and keeps the last good answer when a fetch
fails.

Strategies understood: `default`, `flexibleRollout` (with `stickiness` and
`groupId`), the legacy `gradualRollout*` family, and `userWithId`. Constraints
understood: `IN`, `NOT_IN`, `STR_CONTAINS`, `STR_STARTS_WITH`, `STR_ENDS_WITH`,
the `NUM_*`, `SEMVER_*` and `DATE_*` operators, with `inverted` and
`caseInsensitive`.

A strategy this client cannot judge evaluates to false rather than true. An
unknown strategy is not an absent one, and guessing would silently change the
answer.

Percentage rollouts use MurmurHash3, 32-bit, seed 0, the same hash Unleash uses,
so a machine inside a 20% rollout here is inside it in every other Unleash
client. The context is `userId` = the installation id, plus `platform`,
`osRelease`, `version` and `channel` as properties, which is what constraints
can target. There is no user identity to target, by design.

### The installation id

A random UUID minted on first read, stored in `~/.mjolnir/settings.json`. It is
not derived from the machine, the user, the network or anything else, so it
cannot be correlated with anything outside Mjolnir, and deleting settings.json
genuinely starts a new one. It exists so a percentage rollout is stable and so a
crash report can be matched to the one before it.

## Telemetry

Two switches, both off until the person answers the question during the welcome,
plus a third stored value, `decided`, which records that the question was asked.
Without it there is no way to tell "they said no" from "we never asked", and the
difference is whether asking again is a reminder or nagging.

The design constraint is that **the set of things that can be sent is written
down in advance**, in `apps/server/src/telemetry.ts`. An event is a name from
that list plus fields the event declares; a string field may only hold one of
the values listed for it. A namespace, a pod name, a cluster name, a bucket
name, a file path, a hostname or a log line has nowhere to fit, and anything not
matching is dropped rather than truncated.

Crash reports carry a message and up to 24 stack frames, with the home directory
replaced by `~`, every path reduced to a file name, and anything resembling an
email address redacted.

The queue lives at `~/.mjolnir/telemetry.jsonl`, bounded at 500 entries, and
flushes every 15 minutes to `POST telemetry.mjolnir.sh/v1/ingest`. Settings,
Privacy shows the exact envelope and queue as JSON before it is sent, and the
full catalogue of event shapes. Turning both switches off empties the queue,
because keeping it would make "no" mean "not yet".

### The ingest side

Expect `POST /v1/ingest` with:

```json
{
  "install": "<uuid>",
  "version": "0.1.0",
  "channel": "stable",
  "platform": "darwin",
  "arch": "arm64",
  "osRelease": "25.6.0",
  "events": [{ "name": "module.open", "at": "…", "props": { "module": "kubernetes" } }]
}
```

Answer 2xx to have the batch dropped from the queue. Anything else keeps it for
the next interval, so a bad deploy on our side does not lose a week of crash
reports.

## Updates

`electron-updater` against a generic provider at
`updates.mjolnir.sh/<channel>/<os>/<arch>`. Publish the channel file
(`latest-mac.yml` and friends) and the artefacts beside it, per channel and per
architecture.

Defaults: check 8 seconds after launch and every 6 hours, download in the
background, install on quit. An outdated Kubernetes client is a real hazard, and
nobody reads an update prompt at the moment it appears. It is still a default,
not a policy: turning automatic off means the app tells you and waits, and a
version the person skips stays skipped.

Every dialog names the version it is talking about. An update prompt that will
not say what it is installing is one people learn to dismiss.

Releasing:

```bash
npm run dmg                       # DMG and ZIP for arm64 and x64
# upload the artefacts and latest-mac*.yml to updates.mjolnir.sh/stable/mac/<arch>/
```

The ZIP is what the updater downloads; the DMG is what a first-time visitor
gets. Both need to be signed and notarised, see [DISTRIBUTION.md](DISTRIBUTION.md).

The updater lives in the Electron main process, which the sandboxed renderer
cannot reach. Rather than open an IPC channel to a page that renders cluster
data, main hands the local server a small object with exactly four operations
(`apps/server/src/desktop-bridge.ts`), and the UI reaches them over the same
loopback HTTP it already uses. A build with no bridge, which is what a browser
or a source checkout is, answers "this build does not update itself" rather than
pretending.
