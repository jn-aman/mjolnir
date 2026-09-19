import type { ReactNode } from 'react';

/**
 * Markdown, rendered, without a parser in the bundle.
 *
 * A README in a bucket is meant to be read, not audited, and showing it as
 * source with hashes and asterisks is showing the packaging instead of the
 * thing. This covers what documents actually use: headings, both kinds of
 * list, fenced and inline code, emphasis, links, quotes, rules and tables.
 *
 * It builds React elements and never HTML strings, so a document from a
 * bucket someone else writes to cannot inject anything: an `onerror` in the
 * source is text, because it is only ever text.
 */
export function Markdown({ text }: { text: string }) {
  return <div className="markdown-body min-h-0 flex-1 overflow-auto px-6 py-5">{blocks(text)}</div>;
}

function blocks(text: string): ReactNode[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out: ReactNode[] = [];
  let at = 0;
  let key = 0;

  while (at < lines.length) {
    const line = lines[at] ?? '';

    if (line.trim() === '') {
      at += 1;
      continue;
    }

    const fence = /^\s*(```+|~~~+)(.*)$/.exec(line);
    if (fence) {
      const marker = fence[1] ?? '```';
      const language = (fence[2] ?? '').trim();
      const body: string[] = [];
      at += 1;
      while (at < lines.length && !(lines[at] ?? '').trimStart().startsWith(marker)) {
        body.push(lines[at] ?? '');
        at += 1;
      }
      at += 1;
      out.push(
        <pre key={key++} className="my-3 overflow-auto rounded-lg border border-line bg-sunken p-3 font-mono text-[12px] leading-[1.6] text-secondary">
          {language ? <span className="mb-1 block text-[10.5px] uppercase tracking-[0.07em] text-tertiary">{language}</span> : null}
          <code>{body.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = (heading[1] ?? '#').length;
      const size = ['20px', '17px', '15px', '14px', '13px', '12.5px'][level - 1] ?? '13px';
      out.push(
        <p
          key={key++}
          role="heading"
          aria-level={level}
          className={`text-primary ${level <= 2 ? 'mb-2 mt-5 border-b border-line pb-1.5' : 'mb-1.5 mt-4'} font-semibold tracking-[-0.01em]`}
          style={{ fontSize: size }}
        >
          {inline(heading[2] ?? '')}
        </p>,
      );
      at += 1;
      continue;
    }

    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
      out.push(<hr key={key++} className="my-5 border-0 border-t border-line" />);
      at += 1;
      continue;
    }

    if (line.trimStart().startsWith('>')) {
      const body: string[] = [];
      while (at < lines.length && (lines[at] ?? '').trimStart().startsWith('>')) {
        body.push((lines[at] ?? '').replace(/^\s*>\s?/, ''));
        at += 1;
      }
      out.push(
        <blockquote key={key++} className="my-3 border-l-2 border-accent pl-3 text-[13px] leading-[1.7] text-tertiary">
          {blocks(body.join('\n'))}
        </blockquote>,
      );
      continue;
    }

    // A table needs the separator row under the header to be a table at all.
    if (line.includes('|') && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[at + 1] ?? '')) {
      const rows: string[][] = [];
      while (at < lines.length && (lines[at] ?? '').includes('|')) {
        const cells = (lines[at] ?? '').trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
        if (!/^[\s:|-]+$/.test(cells.join('|'))) rows.push(cells);
        at += 1;
      }
      const [header, ...body] = rows;
      out.push(
        <div key={key++} className="my-3 overflow-auto rounded-lg border border-line">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                {(header ?? []).map((cell, index) => (
                  <th key={index} className="border-b border-line bg-raised px-3 py-1.5 text-left font-semibold text-primary">
                    {inline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, index) => (
                    <td key={index} className="border-b border-subtle px-3 py-1.5 align-top text-secondary">
                      {inline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    const bullet = /^\s*([-*+]|\d+[.)])\s+/.exec(line);
    if (bullet) {
      const ordered = /\d/.test(bullet[1] ?? '');
      const items: string[] = [];
      while (at < lines.length) {
        const entry = lines[at] ?? '';
        const start = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(entry);
        if (start) {
          items.push(start[2] ?? '');
          at += 1;
          continue;
        }
        // A continuation line belongs to the item above it.
        if (entry.trim() !== '' && /^\s{2,}/.test(entry) && items.length) {
          items[items.length - 1] = `${items[items.length - 1] ?? ''} ${entry.trim()}`;
          at += 1;
          continue;
        }
        break;
      }
      const List = ordered ? 'ol' : 'ul';
      out.push(
        <List key={key++} className={`my-2.5 space-y-1 pl-5 text-[13px] leading-[1.7] text-secondary ${ordered ? 'list-decimal' : 'list-disc'}`}>
          {items.map((item, index) => (
            <li key={index} className="pl-1 marker:text-tertiary">
              {inline(item)}
            </li>
          ))}
        </List>,
      );
      continue;
    }

    const paragraph: string[] = [];
    while (at < lines.length && (lines[at] ?? '').trim() !== '' && !/^\s*(#{1,6}\s|>|```|~~~|[-*+]\s|\d+[.)]\s)/.test(lines[at] ?? '')) {
      paragraph.push(lines[at] ?? '');
      at += 1;
    }
    out.push(
      <p key={key++} className="my-2.5 text-[13px] leading-[1.75] text-secondary">
        {inline(paragraph.join(' '))}
      </p>,
    );
  }

  return out;
}

/** Inline spans, innermost first, so `**a `b` c**` comes out right. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)|(~~[^~]+~~)|(\[[^\]]*\]\([^)\s]+\))|(https?:\/\/[^\s<>()]+)/g;
  let last = 0;
  let key = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith('`')) {
      out.push(
        <code key={key++} className="rounded-xs border border-line bg-sunken px-1 py-px font-mono text-[11.5px] text-primary">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('**') || token.startsWith('__')) {
      out.push(<strong key={key++} className="font-semibold text-primary">{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('~~')) {
      out.push(<del key={key++} className="text-tertiary">{token.slice(2, -2)}</del>);
    } else if (token.startsWith('[')) {
      const link = /^\[([^\]]*)\]\(([^)\s]+)\)$/.exec(token);
      out.push(<Link key={key++} href={link?.[2] ?? ''} label={link?.[1] ?? token} />);
    } else if (token.startsWith('http')) {
      out.push(<Link key={key++} href={token} label={token} />);
    } else {
      out.push(<em key={key++} className="italic">{token.slice(1, -1)}</em>);
    }
    last = match.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Only http(s) opens. Anything else stays text: a `javascript:` link is not a link. */
function Link({ href, label }: { href: string; label: string }) {
  if (!/^https?:\/\//i.test(href)) return <>{label}</>;
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className="text-accent underline decoration-[var(--accent-base)]/40 underline-offset-2 hover:decoration-[var(--accent-base)]">
      {label}
    </a>
  );
}
