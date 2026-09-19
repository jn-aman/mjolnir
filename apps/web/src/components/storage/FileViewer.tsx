import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Copy, Download, ExternalLink, Link2, WrapText } from 'lucide-react';
import { parse as parseYaml } from 'yaml';
import { YamlEditor, languageFor, type EditorLanguage } from '../YamlEditor.tsx';
import { formatBytes } from '../columns.tsx';
import { Button } from '../ui/Button.tsx';
import { Modal } from '../ui/Modal.tsx';
import { copyText } from '../ui/ContextMenu.tsx';
import { LoadingState } from '../ui/States.tsx';
import { DataTree } from './DataTree.tsx';
import { TableView } from './TableView.tsx';
import { ArchiveView } from './ArchiveView.tsx';
import { Markdown } from './Markdown.tsx';
import { readZip, type ZipEntry } from '../../lib/zip.ts';

/**
 * Any object, viewed in place, in the form it is actually in.
 *
 * Highlighted source is the floor, not the ceiling. JSON and YAML get a real
 * tree with search and paths, because "find the field" is the whole job;
 * a CSV gets a table; Markdown gets rendered; an archive gets browsed and its
 * entries open in this same viewer. Images, PDF, video and audio go through
 * the browser's own renderers, and anything genuinely opaque gets a hex dump,
 * so nothing is ever "no preview available".
 *
 * Every view is a switch away from the source, never instead of it: the
 * structured view is an aid, and when it disagrees with the bytes the bytes
 * are what is true.
 */
interface FileViewerProps {
  readonly file: { key: string; type: string; size: number } | null;
  /** Streams the object through the server; `inline` limits to the first bytes. */
  readonly urlFor: (key: string, inline: boolean) => string;
  readonly onPresign: (key: string) => Promise<string>;
  readonly onClose: () => void;
}

const TEXT_LIMIT = 4 * 1024 * 1024;
const HEX_BYTES = 4096;
/** Archives are read whole, because the directory is at the end. */
const ARCHIVE_LIMIT = 256 * 1024 * 1024;

type Mode = 'code' | 'image' | 'pdf' | 'video' | 'audio' | 'hex' | 'svg' | 'archive' | 'table';

/** Zip-shaped containers. All of them are ordinary zip files under another name. */
const ARCHIVE = /\.(zip|jar|war|ear|whl|nupkg|apk|aab|docx|xlsx|pptx|odt|ods|odp|epub|crx|vsix|ipa)$/;

function modeFor(key: string, type: string): Mode {
  const lower = key.toLowerCase();
  if (ARCHIVE.test(lower) || type === 'application/zip' || type === 'application/x-zip-compressed') return 'archive';
  if (/\.(csv|tsv)$/.test(lower) || type === 'text/csv' || type === 'text/tab-separated-values') return 'table';
  if (/\.svg$/.test(lower) || type === 'image/svg+xml') return 'svg';
  if (/^image\//.test(type) || /\.(png|jpe?g|gif|webp|avif|bmp|ico)$/.test(lower)) return 'image';
  if (type === 'application/pdf' || /\.pdf$/.test(lower)) return 'pdf';
  if (/^video\//.test(type) || /\.(mp4|webm|mov|m4v)$/.test(lower)) return 'video';
  if (/^audio\//.test(type) || /\.(mp3|wav|ogg|m4a|flac)$/.test(lower)) return 'audio';
  if (/^text\//.test(type) || /^application\/(json|xml|yaml|x-yaml|javascript|toml|x-sh|sql|x-ndjson)/.test(type)) return 'code';
  if (languageFor(key) !== 'plain' || /\.(txt|log|env|conf|ini|cfg|lock|gitignore|editorconfig)$/.test(lower) || !lower.includes('.')) return 'code';
  return 'hex';
}

function hexDump(bytes: Uint8Array): string {
  const lines: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const slice = bytes.subarray(offset, offset + 16);
    const hex = Array.from(slice, (b) => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(slice, (b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
    lines.push(`${offset.toString(16).padStart(8, '0')}  ${hex.padEnd(47)}  ${ascii}`);
  }
  return lines.join('\n');
}

/** Structured data, or nothing: a parse failure means show the source, not an error. */
function structureOf(text: string | null, language: EditorLanguage, mode: Mode): { value: unknown } | null {
  if (text === null || mode !== 'code') return null;
  try {
    if (language === 'json') {
      // A .jsonl file is many documents; parse it as the array it stands for.
      const trimmed = text.trim();
      if (!trimmed) return null;
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) return { value: JSON.parse(trimmed) as unknown };
      const lines = trimmed.split('\n').filter((line) => line.trim());
      return { value: lines.map((line) => JSON.parse(line) as unknown) };
    }
    if (language === 'yaml') {
      const value = parseYaml(text) as unknown;
      return value !== null && typeof value === 'object' ? { value } : null;
    }
  } catch {
    // Truncated or invalid: the source view is the honest one.
  }
  return null;
}

type Opened = { key: string; type: string; size: number; text: string | null; bytes: Uint8Array | null };

export function FileViewer({ file, urlFor, onPresign, onClose }: FileViewerProps) {
  const [text, setText] = useState<string | null>(null);
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);
  const [zip, setZip] = useState<ZipEntry[] | null>(null);
  const [inner, setInner] = useState<Opened | null>(null);
  const [language, setLanguage] = useState<EditorLanguage>('plain');
  const [wrap, setWrap] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<string>('');

  const mode = file ? modeFor(file.key, file.type) : 'hex';

  useEffect(() => {
    setText(null);
    setBuffer(null);
    setZip(null);
    setInner(null);
    setError(null);
    if (!file) return;
    const detected = languageFor(file.key);
    setLanguage(detected);
    setWrap(detected === 'markdown' || detected === 'plain');

    if (mode === 'archive') {
      if (file.size > ARCHIVE_LIMIT) {
        setError(`This archive is ${formatBytes(file.size)}. Mjolnir opens archives up to ${formatBytes(ARCHIVE_LIMIT)} in place; download it to look inside.`);
        return;
      }
      let cancelled = false;
      setLoading(true);
      void fetch(urlFor(file.key, false))
        .then(async (response) => {
          if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
          return response.arrayBuffer();
        })
        .then((bytes) => {
          if (cancelled) return;
          setBuffer(bytes);
          setZip(readZip(bytes));
        })
        .catch((cause: unknown) => {
          if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }

    if (mode !== 'code' && mode !== 'hex' && mode !== 'svg' && mode !== 'table') return;
    let cancelled = false;
    setLoading(true);
    void fetch(urlFor(file.key, true))
      .then(async (response) => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        if (mode === 'hex') {
          const bytes = new Uint8Array(await response.arrayBuffer());
          return hexDump(bytes.subarray(0, HEX_BYTES)) + (file.size > HEX_BYTES ? `\n… ${formatBytes(file.size - HEX_BYTES)} more` : '');
        }
        const body = await response.text();
        // A "text" object that is mostly control bytes is binary wearing a text type.
        const sample = body.slice(0, 2000);
        const control = [...sample].filter((c) => c.charCodeAt(0) < 9 || (c.charCodeAt(0) > 13 && c.charCodeAt(0) < 32)).length;
        if (sample.length > 0 && control / sample.length > 0.1) {
          const bytes = new TextEncoder().encode(body);
          return hexDump(bytes.subarray(0, HEX_BYTES)) + '\n… (binary content shown as hex)';
        }
        return body + (file.size > TEXT_LIMIT ? `\n\n… first ${formatBytes(TEXT_LIMIT)} of ${formatBytes(file.size)} shown` : '');
      })
      .then((result) => {
        if (!cancelled) setText(result);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // mode and language both derive from file
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  // What is on screen: the object, or an entry opened from inside its archive.
  const shownKey = inner?.key ?? file?.key ?? '';
  const shownText = inner ? inner.text : text;
  const shownLanguage = inner ? languageFor(inner.key) : language;
  const shownMode: Mode = inner ? (inner.text === null ? 'hex' : modeFor(inner.key, inner.type)) : mode;

  const structure = useMemo(() => structureOf(shownText, shownLanguage, shownMode), [shownText, shownLanguage, shownMode]);

  const views = useMemo(() => {
    if (shownMode === 'archive') return ['files'];
    if (structure) return ['tree', 'source'];
    if (shownMode === 'table') return ['table', 'source'];
    if (shownLanguage === 'markdown') return ['reading', 'source'];
    if (shownLanguage === 'html') return ['preview', 'source'];
    if (shownMode === 'svg') return ['preview', 'source'];
    return [];
  }, [shownMode, shownLanguage, structure]);

  useEffect(() => {
    setView(views[0] ?? '');
  }, [views]);

  if (!file) return null;
  const raw = urlFor(file.key, false);
  const name = shownKey.split('/').pop() ?? shownKey;
  const showing = view || views[0] || 'source';

  return (
    <Modal
      open
      onClose={onClose}
      title={name}
      description={
        <span className="font-mono">
          {inner ? `${file.key} › ${inner.key}` : file.key} · {formatBytes(inner?.size ?? file.size)}
          {shownMode === 'code' || shownMode === 'table' ? ` · ${shownLanguage}` : ` · ${inner?.type ?? file.type}`}
          {zip ? ` · ${zip.filter((entry) => !entry.directory).length} entries` : ''}
        </span>
      }
      width={1180}
      testId="file-viewer"
      footer={
        <>
          {inner ? (
            <Button variant="ghost" onClick={() => setInner(null)} icon={<ArrowLeft size={12} strokeWidth={1.9} />}>
              Back to the archive
            </Button>
          ) : null}
          {views.length > 1 ? (
            <span className="flex items-center gap-0.5 rounded-md border border-line bg-sunken p-0.5" role="tablist" aria-label="View">
              {views.map((entry) => (
                <button
                  key={entry}
                  type="button"
                  role="tab"
                  aria-selected={showing === entry}
                  data-testid={`view-${entry}`}
                  onClick={() => setView(entry)}
                  className={`h-[22px] rounded-sm px-2.5 text-[12px] capitalize transition-colors duration-100 ${
                    showing === entry ? 'bg-raised text-primary shadow-[0_1px_0_var(--highlight)_inset]' : 'text-tertiary hover:text-secondary'
                  }`}
                >
                  {entry}
                </button>
              ))}
            </span>
          ) : null}
          {showing === 'source' || shownMode === 'hex' ? (
            <Button variant="ghost" onClick={() => setWrap((w) => !w)} icon={<WrapText size={12} strokeWidth={1.9} />} aria-pressed={wrap}>
              {wrap ? 'No wrap' : 'Wrap'}
            </Button>
          ) : null}
          {shownText !== null && shownMode !== 'hex' ? (
            <Button variant="ghost" onClick={() => copyText(shownText, 'Contents copied')} icon={<Copy size={12} strokeWidth={1.9} />}>
              Copy contents
            </Button>
          ) : null}
          <Button variant="ghost" onClick={() => void onPresign(file.key).then((url) => copyText(url, 'Presigned link copied'))} icon={<Link2 size={12} strokeWidth={1.9} />}>
            Presigned link
          </Button>
          <Button variant="ghost" onClick={() => window.open(raw, '_blank')} icon={<ExternalLink size={12} strokeWidth={1.9} />}>
            Open raw
          </Button>
          <Button onClick={() => window.open(raw, '_blank')} icon={<Download size={12} strokeWidth={1.9} />}>
            Download
          </Button>
        </>
      }
    >
      <div className="mb-4 flex h-[70vh] min-h-[340px] flex-col overflow-hidden rounded-lg border border-line bg-sunken" data-testid={`viewer-${shownMode}`}>
        {error ? <div className="p-4 text-[12.5px] text-error">{error}</div> : null}
        {loading ? <LoadingState title={mode === 'archive' ? 'Reading the archive' : 'Fetching the object'} rows={0} /> : null}

        {!loading && !error && shownMode === 'archive' && zip && buffer ? (
          <ArchiveView
            entries={zip}
            buffer={buffer}
            onOpen={(entry, bytes) => setInner(openedFrom(entry, bytes))}
          />
        ) : null}

        {!loading && !error && showing === 'tree' && structure ? <DataTree value={structure.value} /> : null}
        {!loading && !error && showing === 'table' && shownText !== null ? <TableView text={shownText} /> : null}
        {!loading && !error && showing === 'reading' && shownText !== null ? <Markdown text={shownText} /> : null}
        {!loading && !error && showing === 'preview' && shownLanguage === 'html' && shownText !== null ? (
          // Sandboxed with no allowances at all: it renders, it cannot run.
          <iframe title={name} srcDoc={shownText} sandbox="" className="min-h-0 flex-1 border-0 bg-white" />
        ) : null}
        {!loading && !error && showing === 'preview' && shownMode === 'svg' ? (
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
            <img src={inner ? blobUrl(inner) : raw} alt={name} className="max-h-full max-w-full" />
          </div>
        ) : null}

        {!loading && !error && (showing === 'source' || (views.length === 0 && (shownMode === 'code' || shownMode === 'hex' || shownMode === 'svg' || shownMode === 'table'))) && shownText !== null ? (
          <YamlEditor
            key={`${shownKey}:${wrap}`}
            value={shownText}
            language={shownMode === 'hex' ? 'plain' : shownMode === 'svg' ? 'xml' : shownLanguage}
            wrap={wrap}
            testId="viewer-editor"
          />
        ) : null}

        {!loading && !error && !inner && shownMode === 'image' ? (
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4" style={{ backgroundImage: 'linear-gradient(45deg, var(--surface-raised) 25%, transparent 25%), linear-gradient(-45deg, var(--surface-raised) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--surface-raised) 75%), linear-gradient(-45deg, transparent 75%, var(--surface-raised) 75%)', backgroundSize: '20px 20px', backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0' }}>
            <img src={raw} alt={name} className="max-h-full max-w-full rounded-md shadow-[var(--shadow-lg)]" />
          </div>
        ) : null}
        {!loading && !error && inner && shownMode === 'image' ? (
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
            <img src={blobUrl(inner)} alt={name} className="max-h-full max-w-full rounded-md shadow-[var(--shadow-lg)]" />
          </div>
        ) : null}
        {!loading && !error && !inner && shownMode === 'pdf' ? <iframe title={name} src={`${raw}#toolbar=1`} className="min-h-0 flex-1 border-0 bg-white" /> : null}
        {!loading && !error && inner && shownMode === 'pdf' ? <iframe title={name} src={blobUrl(inner)} className="min-h-0 flex-1 border-0 bg-white" /> : null}
        {!loading && !error && shownMode === 'video' ? <video controls src={inner ? blobUrl(inner) : raw} className="min-h-0 flex-1 bg-black" /> : null}
        {!loading && !error && shownMode === 'audio' ? (
          <div className="flex flex-1 items-center justify-center p-8">
            <audio controls src={inner ? blobUrl(inner) : raw} className="w-full max-w-[560px]" />
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

/** Decides whether an archive entry is text, and keeps the bytes either way. */
function openedFrom(entry: ZipEntry, bytes: Uint8Array): Opened {
  const type = guessType(entry.name);
  const mode = modeFor(entry.name, type);
  if (mode !== 'code' && mode !== 'table' && mode !== 'svg' && mode !== 'hex') {
    return { key: entry.name, type, size: entry.size, text: null, bytes };
  }
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const sample = text.slice(0, 2000);
  const control = [...sample].filter((c) => c.charCodeAt(0) < 9 || (c.charCodeAt(0) > 13 && c.charCodeAt(0) < 32)).length;
  if (sample.length > 0 && control / sample.length > 0.1) {
    return { key: entry.name, type, size: entry.size, text: hexDump(bytes.subarray(0, HEX_BYTES)), bytes };
  }
  return { key: entry.name, type, size: entry.size, text, bytes };
}

/** Enough of a content type for the browser's own renderers. */
function guessType(name: string): string {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  const map: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
    svg: 'image/svg+xml', pdf: 'application/pdf', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav',
    json: 'application/json', yaml: 'application/yaml', yml: 'application/yaml', csv: 'text/csv', tsv: 'text/tab-separated-values',
    html: 'text/html', txt: 'text/plain', md: 'text/markdown', zip: 'application/zip',
  };
  return map[ext] ?? 'application/octet-stream';
}

/**
 * A URL for bytes we already hold.
 *
 * Cached on the record so re-rendering does not leak a new object URL each
 * time; the whole set goes when the viewer closes and the page drops them.
 */
const blobUrls = new WeakMap<Opened, string>();
function blobUrl(opened: Opened): string {
  const existing = blobUrls.get(opened);
  if (existing) return existing;
  const url = URL.createObjectURL(new Blob([(opened.bytes ?? new Uint8Array()) as BlobPart], { type: opened.type }));
  blobUrls.set(opened, url);
  return url;
}
