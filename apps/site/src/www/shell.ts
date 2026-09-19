import { MARK_HAFT, MARK_HEAD } from '@mjolnir/brand';

/**
 * mjolnir.sh, served from the same process as the API.
 *
 * Server-rendered HTML with the CSS inline, and no build step, because this
 * site is four pages and one of them is load bearing in a way a marketing
 * page never is: `/device` is where a sign-in completes, and a person is
 * sitting there with a code in their hand waiting for it. A blank screen
 * while a bundle downloads is the wrong thing to show them.
 *
 * One process also means one thing to deploy and one tunnel route. A separate
 * static host would be a second deployment, a second certificate and a second
 * thing to be down while the first one is fine.
 */

export interface PageOptions {
  readonly title: string;
  readonly description: string;
  readonly body: string;
  /** Left out on /device, which nobody should find in a search result. */
  readonly indexable?: boolean;
  readonly canonical?: string;
}

const STYLE = `
  :root {
    color-scheme: dark;
    --bg: #0b0d12; --raised: #12151d; --sunken: #0e1017;
    --fg: #f2f3f7; --dim: #9aa0b0; --faint: #6b7081;
    --line: #232733; --strong: #333949;
    --accent: #6d8cff; --accent-soft: #1a2038;
    --ok: #4ec98a;
  }
  @media (prefers-color-scheme: light) {
    :root:not([data-theme="dark"]) {
      color-scheme: light;
      --bg: #fbfbfc; --raised: #ffffff; --sunken: #f3f4f7;
      --fg: #14161c; --dim: #585e6e; --faint: #7b8191;
      --line: #e4e6ec; --strong: #c9cdd8;
      --accent: #3358e0; --accent-soft: #eceffd;
      --ok: #1f8a56;
    }
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body {
    margin: 0; background: var(--bg); color: var(--fg);
    font: 15px/1.6 ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  a { color: inherit; }
  .wrap { width: 100%; max-width: 1040px; margin: 0 auto; padding: 0 24px; }
  header.top {
    position: sticky; top: 0; z-index: 10;
    backdrop-filter: blur(12px); background: color-mix(in oklab, var(--bg) 86%, transparent);
    border-bottom: 1px solid var(--line);
  }
  header.top .wrap { display: flex; align-items: center; gap: 20px; height: 60px; }
  .brand { display: flex; align-items: center; gap: 9px; font-weight: 640; letter-spacing: -0.01em; text-decoration: none; }
  .brand svg { width: 22px; height: 22px; }
  nav.links { display: flex; gap: 20px; margin-left: auto; align-items: center; font-size: 13.5px; }
  nav.links a { color: var(--dim); text-decoration: none; }
  nav.links a:hover { color: var(--fg); }
  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    height: 38px; padding: 0 18px; border-radius: 999px; border: 1px solid var(--line);
    background: var(--raised); color: var(--fg); font-size: 14px; font-weight: 550;
    text-decoration: none; cursor: pointer; transition: border-color .12s, background .12s, transform .12s;
  }
  .btn:hover { border-color: var(--strong); }
  .btn:active { transform: scale(.985); }
  .btn.primary {
    background: linear-gradient(135deg, color-mix(in oklab, var(--accent) 88%, #000), var(--accent));
    border-color: color-mix(in oklab, var(--accent) 60%, var(--line)); color: #fff;
    box-shadow: 0 6px 20px color-mix(in oklab, var(--accent) 28%, transparent);
  }
  .btn.lg { height: 46px; padding: 0 24px; font-size: 15px; }
  h1 { font-size: clamp(34px, 6vw, 56px); line-height: 1.06; letter-spacing: -0.03em; margin: 0 0 18px; font-weight: 680; }
  h2 { font-size: clamp(22px, 3.4vw, 30px); line-height: 1.18; letter-spacing: -0.02em; margin: 0 0 12px; font-weight: 640; }
  h3 { font-size: 16px; margin: 0 0 6px; font-weight: 620; letter-spacing: -0.01em; }
  p { margin: 0 0 14px; color: var(--dim); }
  .lead { font-size: 18px; line-height: 1.55; max-width: 620px; }
  section { padding: 64px 0; }
  section.hero { padding: 84px 0 64px; }
  .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
  .card { border: 1px solid var(--line); border-radius: 14px; background: var(--raised); padding: 20px; }
  .card p { margin: 0; font-size: 13.5px; }
  .eyebrow { font-size: 11px; font-weight: 640; letter-spacing: .08em; text-transform: uppercase; color: var(--faint); margin: 0 0 10px; }
  code, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
  footer { border-top: 1px solid var(--line); padding: 32px 0; color: var(--faint); font-size: 13px; }
  footer .wrap { display: flex; flex-wrap: wrap; gap: 16px; align-items: center; }
  footer a { color: var(--dim); text-decoration: none; }
  .row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
  .muted { color: var(--faint); font-size: 13px; }
  @media (max-width: 620px) {
    nav.links a:not(.btn) { display: none; }
    section { padding: 44px 0; }
  }
`;

export function page(options: PageOptions): string {
  const title = options.title === 'Mjolnir' ? 'Mjolnir' : `${options.title} · Mjolnir`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<meta name="description" content="${escape(options.description)}">
${options.indexable === false ? '<meta name="robots" content="noindex">' : ''}
${options.canonical ? `<link rel="canonical" href="${escape(options.canonical)}">` : ''}
<meta property="og:title" content="${escape(title)}">
<meta property="og:description" content="${escape(options.description)}">
<meta property="og:type" content="website">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>${STYLE}</style>
</head>
<body>
<header class="top">
  <div class="wrap">
    <a class="brand" href="/">${mark()} Mjolnir</a>
    <nav class="links">
      <a href="/#features">Features</a>
      <a href="/pricing">Pricing</a>
      <a href="https://github.com/jn-aman/mjolnir">Source</a>
      <a class="btn" href="/download">Download</a>
    </nav>
  </div>
</header>
${options.body}
<footer>
  <div class="wrap">
    <span>${mark(16)}</span>
    <span>Mjolnir</span>
    <span style="margin-left:auto"></span>
    <a href="/pricing">Pricing</a>
    <a href="/download">Download</a>
    <a href="https://github.com/jn-aman/mjolnir">Source</a>
    <a href="/legal">Licence</a>
  </div>
</footer>
</body>
</html>`;
}

export function mark(size = 22): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" aria-hidden="true"><path d="${MARK_HEAD}"/><path d="${MARK_HAFT}"/></svg>`;
}

export function escape(value: string): string {
  return value.replace(/[&<>"']/g, (character) =>
    character === '&' ? '&amp;' : character === '<' ? '&lt;' : character === '>' ? '&gt;' : character === '"' ? '&quot;' : '&#39;',
  );
}
