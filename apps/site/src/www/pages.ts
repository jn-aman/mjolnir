import { escape, page } from './shell.ts';

/**
 * The pages of mjolnir.sh.
 *
 * Four of them, and only one is load bearing. `/device` is where a sign-in
 * finishes: somebody is sitting in front of it with a code in their hand and
 * an app on another screen waiting. Everything else on this site can be wrong
 * for a day and cost nothing.
 */

export function landing(version: string): string {
  return page({
    title: 'Mjolnir',
    description:
      'A desktop app for Kubernetes that tells you what broke, which certificates nobody is renewing, and what changed just before it started.',
    canonical: 'https://mjolnir.sh/',
    body: `
<section class="hero">
  <div class="wrap">
    <p class="eyebrow">Kubernetes, on your desktop</p>
    <h1>Know what broke<br>before you go looking.</h1>
    <p class="lead">
      Mjolnir reads your cluster the way you would: every event, every restart, every node condition and every recent
      change at once, and then tells you which one came first.
    </p>
    <div class="row" style="margin-top:26px">
      <a class="btn primary lg" href="/download">Download for macOS</a>
      <a class="btn lg" href="#features">What it does</a>
    </div>
    <p class="muted" style="margin-top:14px">Free for reading. ${escape(version)} · Apple silicon and Intel.</p>
  </div>
</section>

<section id="features">
  <div class="wrap">
    <h2>The things a dashboard cannot do</h2>
    <p class="lead" style="margin-bottom:28px">
      A browser tab shows you one object at a time. A desktop app can hold the whole cluster at once and have an
      opinion about it.
    </p>
    <div class="grid">
      <article class="card">
        <h3>What broke?</h3>
        <p>
          Fifteen rules over events, pod statuses, node conditions and recent changes, ranked so the cause sits above
          the symptom. <code>kubectl get events</code> sorts by time, so forty backoff lines bury the one config error
          that explains them.
        </p>
      </article>
      <article class="card">
        <h3>Certificates</h3>
        <p>
          Every TLS secret, cert-manager certificate and admission webhook CA bundle, sorted by expiry and led by the
          ones nothing will renew. It also catches an Ingress serving a hostname its certificate does not cover.
        </p>
      </article>
      <article class="card">
        <h3>Time travel</h3>
        <p>
          Kubernetes keeps no history. Mjolnir keeps a rolling window of what every watched object used to look like,
          so "what changed just before this started" has an answer.
        </p>
      </article>
      <article class="card">
        <h3>Diff and drift</h3>
        <p>
          Your live object against its Helm chart or the last <code>kubectl apply</code>, ignoring the hundred fields
          Kubernetes defaults on admission so the two or three somebody actually changed are the whole list.
        </p>
      </article>
      <article class="card">
        <h3>Vulnerabilities</h3>
        <p>
          Every distinct image the cluster runs, grouped by the workloads that run it, scanned with Trivy. A critical
          finding on an image thirty pods run is a different morning from the same finding on one.
        </p>
      </article>
      <article class="card">
        <h3>Logs, shells, forwards</h3>
        <p>
          In a dock along the bottom that keeps them open while you work elsewhere. A log tail keeps streaming while
          you read the deployment that owns the pod.
        </p>
      </article>
    </div>
  </div>
</section>

<section style="border-top:1px solid var(--line)">
  <div class="wrap">
    <h2>Your cluster stays yours</h2>
    <p class="lead">
      Mjolnir talks to your cluster from your machine, with your kubeconfig. No agent to install, no data sent
      anywhere, nothing in the middle. Cluster names, namespaces and object names never leave the app.
    </p>
    <div class="row" style="margin-top:22px">
      <a class="btn primary" href="/download">Download</a>
      <a class="btn" href="https://github.com/jn-aman/mjolnir">Read the source</a>
    </div>
  </div>
</section>`,
  });
}

export function pricing(): string {
  return page({
    title: 'Pricing',
    description: 'Reading a cluster is free. Acting on one is paid, per person, on up to five machines.',
    canonical: 'https://mjolnir.sh/pricing',
    body: `
<section>
  <div class="wrap">
    <h1 style="font-size:clamp(28px,4.5vw,40px)">Pricing</h1>
    <p class="lead">Reading is free and stays free. The tools that act on a cluster, and the ones that take real work to
      keep correct, are what you pay for.</p>

    <div class="grid" style="margin-top:32px">
      <article class="card">
        <p class="eyebrow">Free</p>
        <h3 style="font-size:28px;margin:0 0 4px">&pound;0</h3>
        <p class="muted" style="margin:0 0 14px">Forever, no account</p>
        <p>Every cluster, every kind including your CRDs, logs, shells, port forwards, YAML, events, and the dock.</p>
      </article>
      <article class="card" style="border-color:color-mix(in oklab, var(--accent) 45%, var(--line))">
        <p class="eyebrow" style="color:var(--accent)">Pro</p>
        <h3 style="font-size:28px;margin:0 0 4px">&pound;7<span class="muted" style="font-size:14px;font-weight:400"> / month</span></h3>
        <p class="muted" style="margin:0 0 14px">Per person, up to five machines</p>
        <p>Everything free, plus what broke, certificates, drift, time travel, cluster-wide image scanning, and writes:
          scale, restart, edit, cordon, drain, delete.</p>
        <a class="btn primary" style="margin-top:14px" href="/download">Start free</a>
      </article>
      <article class="card">
        <p class="eyebrow">Team</p>
        <h3 style="font-size:28px;margin:0 0 4px">Talk to us</h3>
        <p class="muted" style="margin:0 0 14px">Single sign-on and seats</p>
        <p>Okta or your own identity provider, SCIM so removing somebody in your directory takes their seat, and seat
          counts you set.</p>
        <a class="btn" style="margin-top:14px" href="mailto:hello@mjolnir.sh">hello@mjolnir.sh</a>
      </article>
    </div>

    <h2 style="margin-top:48px">Things worth saying plainly</h2>
    <div class="grid">
      <article class="card">
        <h3>It works offline</h3>
        <p>A licence is a signed file your machine can check on its own. Mjolnir keeps working on a plane, and it keeps
          working if this website goes away.</p>
      </article>
      <article class="card">
        <h3>Five machines, not five people</h3>
        <p>A seat is held by a machine that is actually using it. Sign one out and the seat is free that second.</p>
      </article>
      <article class="card">
        <h3>Cancelling is not a cliff</h3>
        <p>Stop paying and the free tier keeps working. Nothing is deleted, no cluster is touched, and reading a cluster
          costs nothing forever.</p>
      </article>
    </div>
  </div>
</section>`,
  });
}

export interface DownloadInfo {
  readonly version: string;
  readonly arm64?: string | undefined;
  readonly intel?: string | undefined;
  readonly notes?: string | undefined;
  readonly publishedAt?: string | undefined;
}

export function download(info: DownloadInfo): string {
  const ready = Boolean(info.arm64 || info.intel);
  return page({
    title: 'Download',
    description: 'Mjolnir for macOS, Apple silicon and Intel.',
    canonical: 'https://mjolnir.sh/download',
    body: `
<section>
  <div class="wrap">
    <h1 style="font-size:clamp(28px,4.5vw,40px)">Download</h1>
    ${
      ready
        ? `<p class="lead">Version ${escape(info.version)}${info.publishedAt ? `, released ${escape(info.publishedAt.slice(0, 10))}` : ''}. macOS 12 or newer.</p>
    <div class="row" style="margin-top:24px">
      ${info.arm64 ? `<a class="btn primary lg" href="${escape(info.arm64)}">Apple silicon</a>` : ''}
      ${info.intel ? `<a class="btn lg" href="${escape(info.intel)}">Intel</a>` : ''}
    </div>
    <p class="muted" style="margin-top:12px">Not sure? Apple silicon is right for any Mac sold since late 2020.</p>`
        : `<p class="lead">The first build is not published yet.</p>
    <div class="card" style="margin-top:20px;max-width:620px">
      <h3>Build it yourself in the meantime</h3>
      <p class="mono" style="margin-top:8px">git clone https://github.com/jn-aman/mjolnir<br>npm install<br>npm run release</p>
      <p style="margin-top:12px">The source is the whole app. There is no hidden half.</p>
    </div>`
    }

    ${
      info.notes
        ? `<h2 style="margin-top:44px">What is new</h2>
    <div class="card" style="max-width:720px;white-space:pre-wrap">${escape(info.notes)}</div>`
        : ''
    }

    <h2 style="margin-top:44px">Windows and Linux</h2>
    <p class="lead">Not yet. The app is built on Electron and nothing in it is macOS-only, so they are a build target
      rather than a rewrite, and they will come once the first paying customers are happy.</p>
  </div>
</section>`,
  });
}

/**
 * The page a sign-in finishes on.
 *
 * The one page here that has a person waiting in front of it. It is a form
 * and three states, written so that each state says what happened rather than
 * what went wrong, and it never leaves somebody looking at a spinner with no
 * idea whether their code was even read.
 *
 * `noindex`, because a device code in a search result is somebody else's
 * sign-in.
 */
export function devicePage(code: string): string {
  return page({
    title: 'Sign in',
    description: 'Finish signing in to Mjolnir.',
    indexable: false,
    body: `
<section style="padding:64px 0">
  <div class="wrap" style="max-width:520px">
    <h1 style="font-size:28px">Sign in to Mjolnir</h1>
    <p>Enter the code showing in the app, then confirm it is you.</p>

    <form id="form" style="margin-top:24px">
      <label for="code" style="display:block;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);margin-bottom:8px">Code from the app</label>
      <input id="code" name="code" value="${escape(code)}" placeholder="XXXX-XXXX" autocomplete="off"
        spellcheck="false" required
        style="width:100%;height:52px;padding:0 16px;border-radius:12px;border:1px solid var(--line);background:var(--sunken);color:var(--fg);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:22px;letter-spacing:.18em;text-transform:uppercase">

      <div id="who" style="margin-top:20px"></div>
      <div id="step"></div>
      <p id="message" class="muted" style="margin-top:14px;min-height:20px"></p>
    </form>
  </div>
</section>

<script type="module">
const form = document.getElementById('form');
const codeInput = document.getElementById('code');
const who = document.getElementById('who');
const step = document.getElementById('step');
const message = document.getElementById('message');

const api = (path, body) =>
  fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    .then(async (response) => ({ ok: response.ok, body: await response.json().catch(() => ({})) }));

const say = (text, tone) => {
  message.textContent = text;
  message.style.color = tone === 'bad' ? 'var(--fg)' : 'var(--dim)';
};

const button = (label, primary) =>
  '<button type="button" class="btn' + (primary ? ' primary' : '') + '" style="margin-top:14px">' + label + '</button>';

let grant = null;

/** Looks the code up, and says what device is asking. */
async function lookUp() {
  const code = codeInput.value.trim().toUpperCase();
  if (code.length < 8) return;
  const found = await api('/api/device/verify/' + encodeURIComponent(code));
  if (!found.ok) {
    who.innerHTML = '';
    step.innerHTML = '';
    say('That code is not one we are waiting on, or it has expired. The app will show you a fresh one.', 'bad');
    return;
  }
  grant = { code, ...found.body };
  // Naming the machine is the whole security value of this screen: somebody
  // who was not expecting this should be able to see that and stop.
  who.innerHTML =
    '<div class="card"><p class="eyebrow" style="margin:0 0 6px">Signing in</p>' +
    '<p style="margin:0;color:var(--fg)">' + (found.body.deviceName || 'A machine') + '</p>' +
    '<p class="muted" style="margin:4px 0 0">' + (found.body.platform || '') + ' · Mjolnir ' + (found.body.appVersion || '') + '</p></div>';
  askForEmail();
  say('');
}

function askForEmail() {
  step.innerHTML =
    '<label for="email" style="display:block;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);margin:22px 0 8px">Your email</label>' +
    '<input id="email" type="email" autocomplete="email" required placeholder="you@example.com" style="width:100%;height:44px;padding:0 14px;border-radius:10px;border:1px solid var(--line);background:var(--sunken);color:var(--fg);font-size:15px">' +
    button('Email me a code', true);
  step.querySelector('button').addEventListener('click', sendCode);
}

async function sendCode() {
  const email = step.querySelector('#email').value.trim();
  if (!email.includes('@')) return say('That is not an email address.', 'bad');
  say('Sending…');
  const sent = await api('/api/auth/email/start', { email });
  if (!sent.ok) return say(sent.body.error_description || 'We could not send a code to that address.', 'bad');
  step.innerHTML =
    '<p class="muted" style="margin:22px 0 8px">We sent a six digit code to ' + email + '.</p>' +
    '<input id="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" style="width:100%;height:44px;padding:0 14px;border-radius:10px;border:1px solid var(--line);background:var(--sunken);color:var(--fg);font-family:ui-monospace,Menlo,monospace;font-size:18px;letter-spacing:.3em">' +
    button('Confirm', true);
  step.querySelector('button').addEventListener('click', () => confirmCode(email));
  step.querySelector('#otp').focus();
  say('');
}

async function confirmCode(email) {
  const otp = step.querySelector('#otp').value.trim();
  say('Checking…');
  const verified = await api('/api/auth/email/verify', { email, code: otp });
  if (!verified.ok) return say(verified.body.error_description || 'That code is not right.', 'bad');

  const approved = await api('/api/device/approve', { user_code: grant.code, account_id: verified.body.accountId });
  if (!approved.ok) return say('We could not finish the sign-in. The code may have expired.', 'bad');

  who.innerHTML =
    '<div class="card" style="border-color:color-mix(in oklab, var(--ok) 45%, var(--line))">' +
    '<p style="margin:0;color:var(--fg);font-weight:600">You are signed in</p>' +
    '<p class="muted" style="margin:6px 0 0">Go back to Mjolnir on ' + (grant.deviceName || 'your machine') +
    '. It is already picking this up, and you can close this tab.</p></div>';
  step.innerHTML = '';
  codeInput.disabled = true;
  say('');
}

codeInput.addEventListener('input', () => {
  const raw = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  codeInput.value = raw.length > 4 ? raw.slice(0, 4) + '-' + raw.slice(4, 8) : raw;
  if (codeInput.value.length === 9) lookUp();
});
form.addEventListener('submit', (event) => event.preventDefault());
if (codeInput.value.length >= 8) lookUp();
else codeInput.focus();
</script>`,
  });
}

export function legal(): string {
  return page({
    title: 'Licence',
    description: 'Mjolnir is source-available under the Elastic License 2.0.',
    body: `
<section>
  <div class="wrap" style="max-width:720px">
    <h1 style="font-size:28px">Licence</h1>
    <p class="lead">Mjolnir is source-available under the Elastic License 2.0. Read it, build it, change it, run it.</p>
    <p>The one thing it does not allow is providing Mjolnir to others as a hosted or managed service. Everything else a
      person or a company would normally want to do with software they are using, you may do.</p>
    <p><a href="https://github.com/jn-aman/mjolnir/blob/main/LICENSE">The full text</a> is in the repository, which is
      also where the whole app is: there is no hidden half.</p>
    <h2 style="margin-top:36px">Privacy</h2>
    <p>Mjolnir talks to your cluster from your machine. Cluster names, context names, namespaces, object names and
      anything read from a cluster never leave the app.</p>
    <p>An account stores an email, and per machine: a name you can edit, the platform, the app version and a last-seen
      date. That is all of it. Usage telemetry is anonymous, off unless you turn it on, and never joined to an account.</p>
    <p>Payment goes through Paddle, who are the merchant of record. No card number ever reaches us.</p>
  </div>
</section>`,
  });
}
