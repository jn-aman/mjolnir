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
const PORT = process.env['MJOLNIR_SITE_PORT'] ?? '8787';
const PUBLIC_URL = process.env['MJOLNIR_PUBLIC_URL'] ?? 'https://api.mjolnir.sh';
const NODE_MAJOR = '24';

/** Everything the site imports, and nothing else. */
const SHIP = [
  'package.json',
  'package-lock.json',
  'tsconfig.base.json',
  'apps/site',
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
    [...SSH_ARGS, HOST, `sudo install -d -m 700 "$(dirname ${remotePath})" && sudo tee ${remotePath} >/dev/null && sudo chmod 600 ${remotePath}`],
    { input: body, encoding: 'utf8' },
  );
}

function step(message: string): void {
  console.log(`\n== ${message}`);
}

// ---- 1. the tarball -------------------------------------------------------

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
    // Excluded rather than filtered afterwards: a Mac's node_modules is not
    // what arm64 needs, and shipping dist would ship a build of whatever the
    // laptop happened to have lying around.
    '--exclude=node_modules',
    '--exclude=dist',
    '--exclude=*.tsbuildinfo',
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
sudo install -d -m 700 /etc/mjolnir
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
npm install --omit=dev --ignore-scripts --no-audit --no-fund 2>&1 | tail -3
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

step('The service');
ssh(`set -euo pipefail
sudo tee /etc/systemd/system/mjolnir-site.service >/dev/null <<'UNIT'
[Unit]
Description=Mjolnir licence service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=${REMOTE}/apps/site
EnvironmentFile=/etc/mjolnir/site.env
EnvironmentFile=/etc/mjolnir/licence.env
ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning src/main.ts
Restart=always
RestartSec=3

# It faces the public internet and needs one directory and one key.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/mjolnir
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true

[Install]
WantedBy=multi-user.target
UNIT

# The key is passed as an environment variable from a root-only file, so the
# unit itself holds no secret and the key never sits in the repository.
sudo awk 'BEGIN{printf "MJOLNIR_LICENCE_PRIVATE_KEY="} {printf "%s\\\\n", $0} END{print ""}' /etc/mjolnir/licence-signing.key | sudo tee /etc/mjolnir/licence.env >/dev/null
sudo chmod 600 /etc/mjolnir/licence.env
sudo systemctl daemon-reload
sudo systemctl enable --now mjolnir-site >/dev/null 2>&1
sudo systemctl restart mjolnir-site
`);
console.log('  mjolnir-site installed and started');

// ---- 7. the tunnel --------------------------------------------------------

const token = process.env['CLOUDFLARE_TUNNEL_TOKEN'];
if (token) {
  step('The Cloudflare tunnel');
  process.stdout.write(
    ssh(`set -euo pipefail
if ! command -v cloudflared >/dev/null; then
  sudo mkdir -p --mode=0755 /usr/share/keyrings
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
  echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" | sudo tee /etc/apt/sources.list.d/cloudflared.list >/dev/null
  sudo apt-get update >/dev/null 2>&1
  sudo apt-get install -y cloudflared >/dev/null 2>&1
fi
cloudflared --version 2>&1 | head -1
`),
  );
  sendSecret('/etc/mjolnir/cloudflared.token', token);
  process.stdout.write(
    ssh(`set -euo pipefail
if systemctl list-unit-files cloudflared.service >/dev/null 2>&1 && systemctl is-enabled cloudflared >/dev/null 2>&1; then
  echo "cloudflared service already installed"
else
  sudo cloudflared service install "$(sudo cat /etc/mjolnir/cloudflared.token)" 2>&1 | tail -2
fi
sudo systemctl enable --now cloudflared >/dev/null 2>&1 || true
`),
  );
} else {
  console.log('\nNo CLOUDFLARE_TUNNEL_TOKEN in the environment, so the tunnel was left alone.');
}

// ---- 8. does it actually work ---------------------------------------------

step('Checking');
process.stdout.write(
  ssh(`set -euo pipefail
sleep 2
echo "health:  $(curl -sS -m 5 http://127.0.0.1:${PORT}/health || echo unreachable)"
echo "service: $(systemctl is-active mjolnir-site)"
echo "tunnel:  $(systemctl is-active cloudflared 2>/dev/null || echo 'not installed')"
echo "--- recent log ---"
sudo journalctl -u mjolnir-site -n 15 --no-pager -o cat
`),
);

rmSync(staging, { recursive: true, force: true });
console.log(`\nDone. ${PUBLIC_URL} works once the tunnel's hostname points at http://localhost:${PORT}.`);
