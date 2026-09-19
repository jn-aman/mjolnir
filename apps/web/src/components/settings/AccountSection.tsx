import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Building2, Check, Copy, ExternalLink, KeyRound, Laptop, LogOut, Mail, Monitor, RefreshCw, Server, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { api, type AccountDevice, type AccountStatus, type SignInPrompt, type SignInProvider } from '../../lib/api.ts';
import { Card } from '../ui/Card.tsx';
import { Button } from '../ui/Button.tsx';
import { copyText } from '../ui/ContextMenu.tsx';
import { Tip } from '../ui/Tooltip.tsx';

/**
 * The account, and what it is for.
 *
 * An account exists so a subscription can be moved between machines, taken
 * back when it is cancelled, and counted against seats. It is not a gate:
 * every screen in this app works signed out, and the page says so rather than
 * making someone find out.
 *
 * Signing in is a device code, not a password field. A desktop app cannot keep
 * a client secret, and a code you read out loud works when the browser is on a
 * different machine entirely, which on a locked-down work laptop it often is.
 */
export function AccountSection() {
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [prompt, setPrompt] = useState<SignInPrompt | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await api.account.get());
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [load]);

  const signIn = async (provider?: SignInProvider['id']) => {
    setFailure(null);
    setBusy(provider ?? 'sign-in');
    try {
      const started = await api.account.signIn(provider ? { provider } : {});
      setPrompt(started);
      setSecondsLeft(started.expiresIn);
      timer.current = setInterval(() => setSecondsLeft((current) => Math.max(0, current - 1)), 1000);
      setWaiting(true);

      // The long poll resolves when the person approves in their browser. It
      // is deliberately a separate request from the one that produced the
      // code, so the code is on screen the instant it exists.
      const result = await api.account.wait();
      if (timer.current) clearInterval(timer.current);
      setWaiting(false);
      setPrompt(null);
      setStatus(result.status);
      if (result.ok) toast.success('Signed in');
      else setFailure(result.failure?.description ?? 'Sign-in did not complete.');
    } catch (error) {
      setWaiting(false);
      setPrompt(null);
      if (timer.current) clearInterval(timer.current);
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const cancel = async () => {
    if (timer.current) clearInterval(timer.current);
    setPrompt(null);
    setWaiting(false);
    setStatus(await api.account.cancel().catch(() => status));
  };

  const act = async (name: string, run: () => Promise<AccountStatus>, done: string) => {
    setBusy(name);
    setFailure(null);
    try {
      setStatus(await run());
      toast.success(done);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const tierTint = status?.tier === 'pro' ? 'var(--status-ok)' : 'var(--text-tertiary)';

  return (
    <>
      <Card
        title="Your account"
        subtitle="Signing in is how a subscription reaches this machine. Everything here works signed out: the free tier is a complete Kubernetes client, and it stays that way."
      >
        {status ? (
          <div className="space-y-3 py-1">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="flex h-[26px] items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium"
                style={{ color: tierTint, background: `color-mix(in oklab, ${tierTint} 12%, transparent)` }}
                data-testid="account-tier"
              >
                {status.tier === 'pro' ? <ShieldCheck size={12} strokeWidth={2.2} aria-hidden /> : null}
                {status.tier === 'pro' ? 'Pro' : 'Free'}
              </span>
              <span className="text-[13px] text-primary">{status.headline}</span>
              {status.email ? <span className="font-mono text-[11.5px] text-tertiary">{status.email}</span> : null}
              {status.identity ? (
                <span className="flex items-center gap-1.5 rounded-full border border-line px-2 py-[2px] text-[11px] text-tertiary" data-testid="account-provider">
                  <ProviderIcon id={status.identity.provider} />
                  {status.identity.handle ?? PROVIDER_LABEL[status.identity.provider]}
                  {status.identity.organisation ? <span className="text-secondary">· {status.identity.organisation}</span> : null}
                </span>
              ) : null}
            </div>
            {status.detail ? <p className="text-[12px] leading-[1.6] text-tertiary">{status.detail}</p> : null}

            {status.seats ? <Seats used={status.seats.used} total={status.seats.total} /> : null}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              {status.signedIn ? (
                <>
                  <Button
                    onClick={() => void act('refresh', () => api.account.refresh(), 'Licence checked')}
                    disabled={busy !== null}
                    icon={<RefreshCw size={13} strokeWidth={2} />}
                    hint="Asks the licence service for a fresh lease now"
                  >
                    {busy === 'refresh' ? 'Checking…' : 'Check now'}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => void api.account.billing().then((b) => window.open(b.url, '_blank'))}
                    icon={<ExternalLink size={13} strokeWidth={1.9} />}
                    hint="Cards and invoices live with our payment provider, never here"
                  >
                    Billing
                  </Button>
                  <div className="flex-1" />
                  <Button
                    variant="ghost"
                    data-testid="account-sign-out"
                    onClick={() => void act('sign-out', () => api.account.signOut(), 'Signed out')}
                    disabled={busy !== null}
                    icon={<LogOut size={13} strokeWidth={1.9} />}
                    hint="Frees this machine's seat"
                  >
                    Sign out
                  </Button>
                </>
              ) : (
                <Button
                  variant="primary"
                  data-testid="account-sign-in"
                  onClick={() => void signIn()}
                  disabled={busy !== null || waiting}
                  icon={<KeyRound size={13} strokeWidth={2} />}
                  hint="Opens a page in your browser, on this machine or any other"
                >
                  {busy === 'sign-in' ? 'Starting…' : 'Sign in'}
                </Button>
              )}
            </div>
          </div>
        ) : (
          <p className="py-2 text-[12.5px] text-tertiary">Reading the account…</p>
        )}

        {failure ? (
          <div className="mt-2 flex items-start gap-2 rounded-md border border-[var(--status-error)] bg-[color-mix(in_oklab,var(--status-error)_8%,transparent)] px-2.5 py-2">
            <AlertTriangle size={13} strokeWidth={2} className="mt-[2px] shrink-0 text-[var(--status-error)]" aria-hidden />
            <span className="break-words text-[12px] text-secondary [overflow-wrap:anywhere]" data-testid="account-error">{failure}</span>
          </div>
        ) : null}
      </Card>

      {prompt ? (
        <Card
          title="Finish signing in"
          subtitle="Open the address below on any device, including your phone, and enter this code. Mjolnir is waiting."
        >
          <div className="flex flex-col items-center gap-3 py-3" data-testid="device-code">
            <button
              type="button"
              onClick={() => copyText(prompt.userCode, 'Code copied')}
              className="rounded-lg border border-line bg-sunken px-5 py-3 font-mono text-[26px] font-semibold tracking-[0.18em] text-primary transition-colors duration-100 hover:border-strong"
              aria-label={`Sign-in code ${prompt.userCode.split('').join(' ')}`}
            >
              {prompt.userCode}
            </button>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                onClick={() => window.open(prompt.verificationUriComplete, '_blank')}
                icon={<ExternalLink size={13} strokeWidth={1.9} />}
              >
                Open the page
              </Button>
              <Tip label="Copy the code">
                <Button
                  iconOnly
                  variant="ghost"
                  aria-label="Copy the code"
                  onClick={() => copyText(prompt.userCode, 'Code copied')}
                  icon={<Copy size={13} strokeWidth={1.9} />}
                />
              </Tip>
            </div>
            <p className="font-mono text-[11.5px] text-tertiary">{prompt.verificationUri}</p>

            {/*
              The provider buttons are here rather than before the code, on
              purpose. The code is what makes the sign-in work from a phone or
              a locked-down machine, so it goes first; these are a shortcut for
              the common case where the browser is right here.
            */}
            {prompt.enforcement ? (
              <p className="max-w-[360px] text-center text-[11.5px] leading-[1.6] text-tertiary" data-testid="sign-in-enforcement">
                {prompt.enforcement}
              </p>
            ) : null}
            {prompt.providers.length > 1 || prompt.enforcement ? (
              <div className="flex flex-wrap items-center justify-center gap-1.5 pt-1" data-testid="sign-in-providers">
                {prompt.providers.map((provider) => (
                  <Button
                    key={provider.id}
                    variant="secondary"
                    data-testid={`sign-in-${provider.id}`}
                    /*
                     * Opens the browser at that provider, carrying this code.
                     * It does not start a second sign-in: the poll running
                     * behind this card is already waiting on this grant, and
                     * asking for a fresh code would strand it and put a
                     * different number on screen from the one just clicked.
                     */
                    onClick={() => (provider.startUri ? window.open(provider.startUri, '_blank') : window.open(prompt.verificationUriComplete, '_blank'))}
                    icon={<ProviderIcon id={provider.id} />}
                    hint={provider.detail}
                  >
                    {provider.label}
                  </Button>
                ))}
              </div>
            ) : null}
            <p className="text-[11.5px] text-tertiary">
              {waiting ? 'Waiting for you to approve' : 'Ready'} · expires in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
            </p>
            <Button variant="ghost" onClick={() => void cancel()}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}

      {status ? (
        <Card
          title="This machine"
          subtitle="A licence is issued to one machine, so copying a home directory to a second one does not quietly take a second seat."
        >
          <div className="space-y-2 py-1 text-[12.5px]">
            <Row label="Name" value={status.device.name} />
            <Row label="Identifier" value={status.device.fingerprint} hint="a short fingerprint, not the id itself" mono />
            {status.expiresAt ? (
              <Row label="Licence valid until" value={new Date(status.expiresAt).toLocaleString()} hint="renewed automatically well before this" />
            ) : null}
            {status.lastCheckedAt ? <Row label="Last checked" value={new Date(status.lastCheckedAt).toLocaleString()} /> : null}
            <Row
              label="Credentials kept in"
              value={status.credentialStore === 'keychain' ? 'the system keychain' : 'a file in ~/.mjolnir'}
              hint={
                status.credentialStore === 'keychain'
                  ? 'protected by your login password'
                  : 'no secret service on this machine, so the file is mode 600 and nothing more'
              }
            />
            {status.lastError ? (
              <div className="flex items-start gap-2 pt-1 text-[12px] text-[var(--status-warn)]">
                <AlertTriangle size={12} strokeWidth={2} className="mt-[3px] shrink-0" aria-hidden />
                <span className="break-words [overflow-wrap:anywhere]">{status.lastError}</span>
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}

      {status && status.signedIn ? (
        <Card
          title="Your machines"
          subtitle="A seat is held by a machine with a current licence, not by one that merely signed in. A machine that stops renewing gives its seat back a week later, on its own."
        >
          {status.devices.length === 0 ? (
            <p className="py-2 text-[12.5px] text-tertiary">No machines yet. This one appears once it has a licence.</p>
          ) : (
            <div className="-mx-1" data-testid="account-devices">
              {status.devices.map((device) => (
                <DeviceRow
                  key={device.id}
                  device={device}
                  busy={busy === `revoke:${device.id}`}
                  onRevoke={() => void act(`revoke:${device.id}`, () => api.account.revokeDevice(device.id), device.current ? 'Signed out' : `${device.name} signed out`)}
                />
              ))}
            </div>
          )}
        </Card>
      ) : null}

      <Card
        title="What an account is not"
        subtitle="Worth stating plainly, because a desktop tool asking you to sign in deserves the question."
      >
        <ul className="space-y-1.5 py-1 text-[12.5px] leading-[1.6] text-secondary">
          {[
            'Nothing about reaching a cluster depends on it. Offline, the app behaves exactly as it does online.',
            'The free tier is a complete single-user Kubernetes client, with no account, forever.',
            'A licence key on its own still works, for air-gapped machines and teams who would rather not have accounts.',
            'Cluster names, namespaces, object names and kubeconfig contents never leave this machine.',
          ].map((line) => (
            <li key={line} className="flex items-start gap-2">
              <Check size={13} strokeWidth={2.2} aria-hidden className="mt-[3px] shrink-0 text-ok" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

const PROVIDER_LABEL: Record<SignInProvider['id'], string> = {
  email: 'Email',
  github: 'GitHub',
  google: 'Google',
  okta: 'Okta',
};

/**
 * The mark each provider is recognised by.
 *
 * GitHub is drawn rather than taken from the icon set, which dropped its
 * brand marks: a brand button that does not carry the brand reads as a
 * phishing page, and this is the one button where looking exactly right is
 * the point. Okta has no mark to borrow, so a building says "your
 * organisation", which is what it means.
 */
function ProviderIcon({ id }: { id: SignInProvider['id'] }) {
  const size = 13;
  const strokeWidth = 1.9;
  if (id === 'github') {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden focusable="false">
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
      </svg>
    );
  }
  if (id === 'okta') return <Building2 size={size} strokeWidth={strokeWidth} aria-hidden />;
  if (id === 'google') return <ShieldCheck size={size} strokeWidth={strokeWidth} aria-hidden />;
  return <Mail size={size} strokeWidth={strokeWidth} aria-hidden />;
}

/**
 * Seats as a bar, not a sentence.
 *
 * "4 of 5" is a number people have to think about. A bar that is nearly full
 * is understood before it is read, which matters because the moment this
 * matters is the moment someone is trying to use a sixth machine.
 */
function Seats({ used, total }: { used: number; total: number }) {
  const full = used >= total;
  const tint = full ? 'var(--status-warn)' : 'var(--status-ok)';
  return (
    <div className="flex items-center gap-2.5" data-testid="account-seats">
      <span className="flex h-[6px] w-[120px] overflow-hidden rounded-full bg-sunken" aria-hidden>
        <span className="h-full rounded-full transition-[width] duration-200" style={{ width: `${Math.min(100, (used / Math.max(total, 1)) * 100)}%`, background: tint }} />
      </span>
      <span className="text-[12px] text-secondary">
        <span className="font-mono text-primary">{used}</span> of <span className="font-mono text-primary">{total}</span> machines
        {full ? <span className="ml-1.5 text-[var(--status-warn)]">all in use</span> : null}
      </span>
    </div>
  );
}

function DeviceRow({ device, busy, onRevoke }: { device: AccountDevice; busy: boolean; onRevoke: () => void }) {
  const seen = new Date(device.lastSeenAt);
  const days = Math.floor((Date.now() - seen.getTime()) / 86_400_000);
  const when = days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
  return (
    <div className="group/row flex items-center gap-3 rounded-md px-1 py-2 hover:bg-hover" data-testid="account-device">
      <span className="flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-md border border-line text-tertiary">
        {device.platform === 'linux' ? <Server size={13} strokeWidth={1.9} aria-hidden /> : <Laptop size={13} strokeWidth={1.9} aria-hidden />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[13px] text-primary">{device.name}</span>
          {device.current ? (
            <span className="shrink-0 rounded-full bg-accent-subtle px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-[0.05em] text-accent">
              this machine
            </span>
          ) : null}
          {!device.active ? (
            <Tip label="No current licence, so it is not using a seat">
              <span className="shrink-0 rounded-full border border-line px-1.5 py-[1px] text-[10px] uppercase tracking-[0.05em] text-tertiary">
                no seat
              </span>
            </Tip>
          ) : null}
        </span>
        <span className="truncate font-mono text-[11px] text-tertiary">
          {device.platform} · {device.appVersion} · last seen {when}
        </span>
      </span>
      <Button
        variant="ghost"
        data-testid={`revoke-${device.id}`}
        disabled={busy}
        onClick={onRevoke}
        icon={<LogOut size={12} strokeWidth={1.9} />}
        hint={device.current ? 'Signs this machine out and frees its seat' : 'Frees this seat straight away. That machine keeps Pro until its licence runs out, up to a week.'}
      >
        {busy ? 'Signing out…' : 'Sign out'}
      </Button>
    </div>
  );
}

function Row({ label, value, hint, mono = false }: { label: string; value: string; hint?: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="w-[150px] shrink-0 text-tertiary">{label}</span>
      <span className={`min-w-0 flex-1 break-words text-primary [overflow-wrap:anywhere] ${mono ? 'font-mono' : ''}`}>
        {value}
        {hint ? <span className="ml-2 text-[11.5px] text-tertiary">{hint}</span> : null}
      </span>
    </div>
  );
}

export { Monitor as AccountIcon };
