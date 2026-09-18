# Security

Mjolnir holds credentials for production clusters and cloud accounts. That makes
its security model part of the product, not an afterthought — so it is written
down here rather than left implicit.

## Reporting a vulnerability

Email **jain.aman1497@gmail.com** with "Mjolnir security" in the subject.
Please do not open a public issue for anything exploitable.

You can expect an acknowledgement within 72 hours and an assessment within a
week. If a fix is warranted you will be credited in the release notes unless you
would rather not be.

## What Mjolnir does with your credentials

- **Nothing leaves your machine.** Mjolnir talks to your clusters and cloud
  providers directly. There is no Mjolnir backend, no telemetry pipeline, and no
  proxy. The only outbound connections are: your clusters, your cloud provider,
  the update feed, the licence server, and — only if you configure one — the AI
  endpoint you chose.
- **The local API binds to loopback only.** The server holds every cluster
  credential you have loaded; exposing it on all interfaces would be an
  unpleasant surprise on shared wifi.
- **Secrets go in the OS keychain**, never in plaintext on disk.
- **Logs are redacted at the boundary.** Every field passed to the logger is
  scrubbed before it reaches a transport — kubeconfig credential blocks, AWS key
  ids, JWTs, PEM blocks, and anything under a key that looks like a secret. See
  `packages/logger/src/redact.ts`, and the tests beside it.
- **The AI assistant is read-only** and its input is redacted by the same code
  before anything is sent to whichever endpoint you configured.

## What it does not do

- No analytics, no crash telemetry that includes your data, no usage reporting.
- Licence validation checks a licence. It does not report what you do with it,
  and Pro features never depend on a network round-trip to work.
- Mjolnir will never send a cluster's contents anywhere you did not point it at.

## Destructive actions

Delete, scale and rollout restart all require a second confirmation. This is
deliberate friction, and it is not configurable.

## Dependencies

The app bundles Trivy for image scanning and, in future, cloud token helpers.
These are fetched at build time from their official releases and pinned by
version. Every binary inside a macOS build is signed and notarized.

## Supported versions

While the project is pre-1.0, only the latest release receives fixes.
