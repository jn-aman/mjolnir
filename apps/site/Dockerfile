# The licence service, as a container.
#
# It runs beside the Cloudflare tunnel on the same Docker network rather than
# on the host, because the tunnel is a container and this box's firewall does
# not let a container reach a host port. Being on the network means the tunnel
# addresses it by name and nothing is published to the internet at all: there
# is no port on the host to find, and the only way in is through Cloudflare.
#
# No build step. The source is TypeScript that Node runs directly by stripping
# the types, which works because the whole repo is compiled with
# `erasableSyntaxOnly` and so contains no TypeScript with runtime behaviour.
FROM node:24-alpine

# tini, because a Node process as PID 1 does not reap children and does not
# get the signals systemd or Docker send it, so a stop takes ten seconds and
# ends in a kill.
RUN apk add --no-cache tini

WORKDIR /app

# The manifests first, so a code change does not re-run the install.
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/site/package.json apps/site/
COPY packages/account/package.json packages/account/
COPY packages/brand/package.json packages/brand/
COPY packages/endpoints/package.json packages/endpoints/
COPY packages/licensing/package.json packages/licensing/
COPY packages/logger/package.json packages/logger/
COPY packages/paddle/package.json packages/paddle/
COPY packages/schemas/package.json packages/schemas/
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund

COPY apps/site apps/site
COPY packages packages

# The state lives on a volume; nothing else is written at runtime.
ENV MJOLNIR_DB=/data/site.db
RUN mkdir -p /data && chown node:node /data
VOLUME /data

USER node
EXPOSE 8787

# Docker's own health check, so a wedged process is restarted rather than
# quietly serving nothing.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--disable-warning=ExperimentalWarning", "apps/site/src/main.ts"]
