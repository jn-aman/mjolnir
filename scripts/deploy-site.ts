import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Deploying api.mjolnir.sh.
 *
 * A script rather than a page of instructions, because a deployment that
 * exists only as steps somebody followed once is a deployment nobody can
 * repeat, and the second time it is needed is always the worst time to be
 * working it out again.
 *
 *   npm run deploy:site
 *   CLOUDFLARE_TUNNEL_TOKEN=... npm run deploy:site     also sets up the tunnel
 *
 * ## What it ships
 *
 * The site's source and the workspace packages it imports, and nothing else.
 * No build step runs on the server: the code is TypeScript that Node runs
 * directly by stripping the types, which works because the whole repo is
 * compiled with `erasableSyntaxOnly` and therefore contains no TypeScript with
 * runtime behaviour. One less thing to go wrong at three in the morning.
 *
 * ## What it refuses to do
 *
 * It never writes a secret into the repository, and never puts one on a
 * command line, where it would sit in `ps` output and in the shell history of
 * whoever ran it. Secrets go over stdin into root-only files.
 *
 * The licence signing key is generated **on the server** and never leaves it.
 * That key is the one artefact here that cannot be rebuilt from Paddle and a
 * sign-in, so the right number of copies of it on a laptop is zero.
 */

const HOST = process.env['MJOLNIR_HOST'] ?? 'ubuntu@vm.aman.wiki';
const KEY = process.env['MJOLNIR_SSH_KEY'] ?? `${process.env['HOME']}/Downloads/ssh-key-2026-02-21.key`;
const REMOTE = '/opt/mjolnir';
/**
 * The Docker network the Cloudflare tunnel is on.
 *
 * The site runs beside the tunnel rather than on the host, because a
 * container on this box cannot reach a host port: the firewall does not allow
 * it. Being on the tunnel's network also means nothing is published on the
 * host at all, so there is no port to find and the only way in is Cloudflare.
 */
const NETWORK = process.env['MJOLNIR_TUNNEL_NETWORK'] ?? 'unleash-mjolnir_unleash';
const PORT = process.env['MJOLNIR_SITE_PORT'] ?? '8787';
const PUBLIC_URL = process.env['MJOLNIR_PUBLIC_URL'] ?? 'https://api.mjolnir.sh';
const NODE_MAJOR = '24';

/** Everything the site imports, and nothing else. */
const SHIP = [
  'package.json',
  'package-lock.json',
  'tsconfig.base.json',
  'apps/site',
  'deploy',
  'packages/account',
  'packages/brand',
  'packages/endpoints',
  'packages/licensing',
  'packages/logger',
  'packages/paddle',
  'packages/schemas',
];

const root = new URL('..', import.meta.url).pathname;
const SSH_ARGS = ['-i', KEY, '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=20'];

function ssh(script: string): string {
  return execFileSync('ssh', [...SSH_ARGS, HOST, 'bash -s'], {
    input: script,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
}

/**
 * A secret, over stdin, into a file only root can read.
 *
 * Never an argument: anything on a command line is visible in `ps` to every
 * other user on the box for as long as it runs, and lands in the shell history
 * of whoever ran it.
 */
function sendSecret(remotePath: string, body: string): void {
  execFileSync(
    'ssh',
    [...SSH_ARGS, HOST, `sudo install -d -m 750 -o root -g ubuntu "$(dirname ${remotePath})" && sudo tee ${remotePath} >/dev/null && sudo chmod 600 ${remotePath}`],
    { input: body, encoding: 'utf8' },
  );
}

function step(message: string): void {
  console.log(`\n== ${message}`);
}

// ---- 1. build, then pack --------------------------------------------------

/*
 * The workspace packages are built here, not on the server.
 *
 * Each one's `main` points at `dist/index.js`, so `import '@mjolnir/paddle'`
 * resolves there and nowhere else: Node has no way to know the source is next
 * door. That output is plain JavaScript with no native code in it, so a build
 * made here runs anywhere, and building it here rather than there keeps the
 * TypeScript toolchain off a box whose job is to hold a signing key.
 *
 * Built every time rather than reused, because the failure mode of shipping a
 * stale `dist` is a server running code nobody can find in the repository.
 */
step('Building the workspace packages');
execFileSync('npm', ['run', 'build', '--workspaces', '--if-present'], { cwd: root, stdio: 'inherit' });

step('Packing what the site needs');
const staging = mkdtempSync(join(tmpdir(), 'mjolnir-deploy-'));
const tarball = join(staging, 'site.tar.gz');
execFileSync(
  'tar',
  [
    '-czf',
    tarball,
    '-C',
    root,
    // node_modules is excluded because a Mac's is not what arm64 needs. `dist`
    // is not excluded: it was rebuilt a moment ago, and it is what the imports
    // actually resolve to.
    '--exclude=node_modules',
    '--exclude=*.tsbuildinfo',
    '--exclude=*.map',
    '--exclude=.DS_Store',
    ...SHIP,
  ],
  { stdio: 'inherit' },
);
console.log(`  ${execFileSync('du', ['-h', tarball], { encoding: 'utf8' }).split('\t')[0]?.trim()} to send`);

// ---- 2. the host ----------------------------------------------------------

step('Making sure the host has what it needs');
process.stdout.write(
  ssh(`set -euo pipefail
if ! command -v node >/dev/null || [ "$(node -v | cut -c2- | cut -d. -f1)" -lt ${NODE_MAJOR} ]; then
  echo "installing node ${NODE_MAJOR}"
  curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | sudo -E bash - >/dev/null 2>&1
  sudo apt-get install -y nodejs >/dev/null 2>&1
fi
echo "node $(node -v)"
sudo install -d -m 755 -o ubuntu -g ubuntu ${REMOTE}
sudo install -d -m 700 -o ubuntu -g ubuntu /var/lib/mjolnir
# Traversable by the service user, readable by nobody else. The key inside it
# is group-readable so the process can read it; everything else stays 600, so
# the tokens in site.env remain root-only.
sudo install -d -m 750 -o root -g ubuntu /etc/mjolnir
`),
);

// ---- 3. the code ----------------------------------------------------------

step('Sending the code');
execFileSync('scp', [...SSH_ARGS, tarball, `${HOST}:/tmp/mjolnir-site.tar.gz`], { stdio: 'inherit' });
process.stdout.write(
  ssh(`set -euo pipefail
cd ${REMOTE}
tar -xzf /tmp/mjolnir-site.tar.gz
rm -f /tmp/mjolnir-site.tar.gz
# --omit=dev keeps the test runner and the toolchain off a production box; the
# site needs express, zod and the workspace links and nothing else.
npm install --omit=dev --ignore-scripts --no-audit --no-fund 2>&1 | tail -2
# Every workspace package the site imports must have its built output, or
# the import resolves to a file that is not there and systemd restarts it
# forever.
missing=""
for p in account brand endpoints licensing logger paddle schemas; do
  [ -f "packages/$p/dist/index.js" ] || missing="$missing $p"
done
[ -z "$missing" ] || { echo "MISSING BUILD OUTPUT:$missing"; exit 1; }
echo "built output present for every package"
echo "workspace links: $(ls node_modules/@mjolnir 2>/dev/null | tr '\\n' ' ')"
`),
);

// ---- 4. the signing key, made there and left there ------------------------

step('The licence signing key');
process.stdout.write(
  ssh(`set -euo pipefail
if sudo test -f /etc/mjolnir/licence-signing.key; then
  echo "already present, left alone"
else
  sudo openssl genpkey -algorithm ed25519 -out /etc/mjolnir/licence-signing.key
  sudo chmod 600 /etc/mjolnir/licence-signing.key
  echo "generated"
fi
echo "--- the public half, which the app verifies leases against ---"
sudo openssl pkey -in /etc/mjolnir/licence-signing.key -pubout
`),
);

// ---- 5. configuration -----------------------------------------------------

step('Configuration');
const settings = [
  `PORT=${PORT}`,
  'MJOLNIR_DB=/var/lib/mjolnir/site.db',
  'MJOLNIR_LICENCE_KEY_FILE=/etc/mjolnir/licence-signing.key',
  `MJOLNIR_PUBLIC_URL=${PUBLIC_URL}`,
  `MJOLNIR_VERIFY_URI=${process.env['MJOLNIR_VERIFY_URI'] ?? 'https://mjolnir.sh/device'}`,
];
for (const name of ['PADDLE_WEBHOOK_SECRET', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']) {
  const value = process.env[name];
  if (value) settings.push(`${name}=${value}`);
}
sendSecret('/etc/mjolnir/site.env', `${settings.join('\n')}\n`);
console.log(`  /etc/mjolnir/site.env written, root only, ${settings.length} settings`);

// ---- 6. the service -------------------------------------------------------

step('Building and starting the container');
process.stdout.write(
  ssh(`set -euo pipefail
cd ${REMOTE}

if ! sudo docker network inspect ${NETWORK} >/dev/null 2>&1; then
  echo "network ${NETWORK} does not exist; is the tunnel stack up?"
  exit 1
fi

# The systemd unit from an earlier shape of this deployment, removed rather
# than left running beside the container listening on the same port.
if systemctl list-unit-files mjolnir-site.service >/dev/null 2>&1; then
  sudo systemctl disable --now mjolnir-site >/dev/null 2>&1 || true
  sudo rm -f /etc/systemd/system/mjolnir-site.service /etc/mjolnir/licence.env
  sudo systemctl daemon-reload
  echo "removed the old systemd unit"
fi

sudo docker compose --env-file /etc/mjolnir/site.env -f deploy/site.compose.yml build --quiet 2>&1 | tail -3

# The key is bind-mounted, and a bind mount carries numeric ids across
# unchanged. The host's own user happens to be gid 1001 here and the image's
# is 1000, so a file the host user could read was one the container could not,
# which fails as EACCES with nothing to say why. The gid is read off the image
# rather than written down, so this keeps working if the base image renumbers.
KEYGID=$(sudo docker run --rm --entrypoint id mjolnir/site:local -g)
sudo chown "root:$KEYGID" /etc/mjolnir/licence-signing.key
sudo chmod 640 /etc/mjolnir/licence-signing.key
echo "signing key readable by gid $KEYGID, which is the image's"

sudo docker compose --env-file /etc/mjolnir/site.env -f deploy/site.compose.yml up -d --force-recreate 2>&1 | tail -4
`),
);

// ---- 7. the tunnel --------------------------------------------------------

/*
 * The tunnel is deliberately not touched.
 *
 * A connector is already running in the Unleash stack on this box, and the
 * ingress rules live in Cloudflare rather than in a file here. Installing a
 * second connector on the same token, which an earlier version of this script
 * did, means Cloudflare load-balances across both: half of every request for
 * `unleash.mjolnir.sh` would arrive at a connector with no route to Unleash
 * and come back 502.
 *
 * So this prints what the route should be and leaves the tunnel alone.
 */
step('The tunnel');
process.stdout.write(
  ssh(`set -euo pipefail
running=$(sudo docker ps --filter ancestor=cloudflare/cloudflared:latest --format '{{.Names}}' | head -1)
echo "connector: \${running:-none found}"
sudo docker exec "$running" cloudflared --version 2>/dev/null | head -1 || true
`),
);
console.log(`  add this public hostname to the tunnel in Cloudflare:`);
console.log(`    ${new URL(PUBLIC_URL).hostname}  ->  http://mjolnir-site:${PORT}`);

// ---- 8. does it actually work ---------------------------------------------

step('Checking');
process.stdout.write(
  ssh(`set -euo pipefail
sleep 2
echo "container: $(sudo docker inspect -f '{{.State.Status}}' mjolnir-site 2>/dev/null || echo missing)"
# Asked for from another container on the tunnel's own network, which is the
# path a real request takes. Checking from the host would prove something
# different from what matters.
echo "health via the tunnel network: $(sudo docker run --rm --network ${NETWORK} curlimages/curl:latest -sS -m 5 http://mjolnir-site:${PORT}/health 2>&1 | tail -1)"
echo "--- recent log ---"
sudo docker logs mjolnir-site --tail 12 2>&1
`),
);

rmSync(staging, { recursive: true, force: true });
console.log(`\nDone. ${PUBLIC_URL} works once that hostname is on the tunnel and mjolnir.sh resolves.`);
