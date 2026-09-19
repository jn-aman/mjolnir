import { MARK_HEAD, MARK_HAFT } from '@mjolnir/brand';

/**
 * The two pages a browser sees at the end of a sign-in.
 *
 * Plain server-rendered HTML with the CSS inline, because this is the one
 * moment where a person has left the app, is waiting, and has no idea whether
 * it worked. A blank page while a bundle loads reads as a failure. There is
 * nothing to hydrate: the whole page is one sentence and a mark.
 *
 * It says what to do next in the app's own words, since "Authentication
 * successful" tells someone nothing about the window they were looking at
 * thirty seconds ago.
 */

function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escape(title)} · Mjolnir</title>
<style>
  :root { color-scheme: light dark; --bg:#fbfbfa; --fg:#18181b; --dim:#6b6b76; --line:#e6e6e3; --accent:#2f6fed; --bad:#b4342a; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#141416; --fg:#f3f3f1; --dim:#9a9aa4; --line:#2a2a2e; --accent:#7ba3f5; --bad:#f0857c; }
  }
  * { box-sizing: border-box; }
  body {
    margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px;
    background:var(--bg); color:var(--fg);
    font:15px/1.55 ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif;
  }
  main { width:100%; max-width:420px; text-align:center; }
  svg { width:34px; height:34px; color:var(--fg); }
  h1 { font-size:19px; font-weight:600; margin:18px 0 8px; letter-spacing:-0.01em; }
  p { margin:0; color:var(--dim); font-size:13.5px; }
  p + p { margin-top:10px; }
  .bad h1 { color:var(--bad); }
  .note { margin-top:22px; padding-top:16px; border-top:1px solid var(--line); font-size:12.5px; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12.5px; }
</style>
</head>
<body>
<main>
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${MARK_HEAD}"/><path d="${MARK_HAFT}"/></svg>
  ${body}
</main>
</body>
</html>`;
}

export function successPage(input: { email: string; provider: string; deviceName: string }): string {
  return shell(
    'Signed in',
    `<h1>You are signed in</h1>
     <p>${escape(input.email)}, through ${escape(label(input.provider))}.</p>
     <p class="note">Go back to Mjolnir on <strong>${escape(input.deviceName)}</strong>. It is already picking this up, and you can close this tab.</p>`,
  );
}

export function errorPage(input: { title: string; detail: string; hint?: string | undefined }): string {
  return shell(
    input.title,
    `<div class="bad"><h1>${escape(input.title)}</h1></div>
     <p>${escape(input.detail)}</p>
     ${input.hint ? `<p class="note">${escape(input.hint)}</p>` : ''}`,
  );
}

function label(provider: string): string {
  return provider === 'github' ? 'GitHub' : provider === 'google' ? 'Google' : provider === 'okta' ? 'your identity provider' : 'email';
}

function escape(value: string): string {
  return value.replace(/[&<>"']/g, (character) =>
    character === '&' ? '&amp;' : character === '<' ? '&lt;' : character === '>' ? '&gt;' : character === '"' ? '&quot;' : '&#39;',
  );
}
