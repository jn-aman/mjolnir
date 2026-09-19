import { useEffect, useState } from 'react';
import { Copy, Download, ExternalLink, Link2, WrapText } from 'lucide-react';
import { YamlEditor, languageFor, type EditorLanguage } from '../YamlEditor.tsx';
import { formatBytes } from '../columns.tsx';
import { Button } from '../ui/Button.tsx';
import { Modal } from '../ui/Modal.tsx';
import { copyText } from '../ui/ContextMenu.tsx';
import { LoadingState } from '../ui/States.tsx';

/**
 * Any object, viewed in place.
 *
 * Code and text get the editor with the language for their extension,
 * images, PDF, video and audio use the browser's own renderers through the
 * server's streaming route, and everything else gets a hex dump of its
 * first bytes, so nothing is ever "no preview".
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

type Mode = 'code' | 'image' | 'pdf' | 'video' | 'audio' | 'hex' | 'svg';

function modeFor(key: string, type: string): Mode {
  const lower = key.toLowerCase();
  if (/\.svg$/.test(lower) || type === 'image/svg+xml') return 'svg';
  if (/^image\//.test(type) || /\.(png|jpe?g|gif|webp|avif|bmp|ico)$/.test(lower)) return 'image';
  if (type === 'application/pdf' || /\.pdf$/.test(lower)) return 'pdf';
  if (/^video\//.test(type) || /\.(mp4|webm|mov|m4v)$/.test(lower)) return 'video';
  if (/^audio\//.test(type) || /\.(mp3|wav|ogg|m4a|flac)$/.test(lower)) return 'audio';
  if (/^text\//.test(type) || /^application\/(json|xml|yaml|x-yaml|javascript|toml|x-sh|sql|x-ndjson)/.test(type)) return 'code';
  if (languageFor(key) !== 'plain' || /\.(txt|log|csv|tsv|env|conf|ini|cfg|lock|gitignore|editorconfig)$/.test(lower) || !lower.includes('.')) return 'code';
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

export function FileViewer({ file, urlFor, onPresign, onClose }: FileViewerProps) {
  const [text, setText] = useState<string | null>(null);
  const [language, setLanguage] = useState<EditorLanguage>('plain');
  const [wrap, setWrap] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mode = file ? modeFor(file.key, file.type) : 'hex';

  useEffect(() => {
    setText(null);
    setError(null);
    if (!file) return;
    const detected = languageFor(file.key);
    setLanguage(detected);
    setWrap(detected === 'markdown' || detected === 'plain');
    if (mode !== 'code' && mode !== 'hex' && mode !== 'svg') return;
    let cancelled = false;
    setLoading(true);
    void fetch(urlFor(file.key, true))
      .then(async (response) => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        if (mode === 'hex') {
          const buffer = new Uint8Array(await response.arrayBuffer());
          return hexDump(buffer.subarray(0, HEX_BYTES)) + (file.size > HEX_BYTES ? `\n… ${formatBytes(file.size - HEX_BYTES)} more` : '');
        }
        const body = await response.text();
        // A "text" object that is mostly control bytes is binary wearing a text type.
        const sample = body.slice(0, 2000);
        const control = [...sample].filter((c) => c.charCodeAt(0) < 9 || (c.charCodeAt(0) > 13 && c.charCodeAt(0) < 32)).length;
        if (sample.length > 0 && control / sample.length > 0.1) {
          const buffer = new TextEncoder().encode(body);
          return hexDump(buffer.subarray(0, HEX_BYTES)) + '\n… (binary content shown as hex)';
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
    // mode derives from file
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  if (!file) return null;
  const raw = urlFor(file.key, false);
  const name = file.key.split('/').pop() ?? file.key;

  return (
    <Modal
      open
      onClose={onClose}
      title={name}
      description={<span className="font-mono">{file.key} · {formatBytes(file.size)} · {file.type}{mode === 'code' ? ` · ${language}` : ''}</span>}
      width={1120}
      testId="file-viewer"
      footer={
        <>
          {mode === 'code' || mode === 'svg' ? (
            <Button variant="ghost" onClick={() => setWrap((w) => !w)} icon={<WrapText size={12} strokeWidth={1.9} />} aria-pressed={wrap}>
              {wrap ? 'No wrap' : 'Wrap'}
            </Button>
          ) : null}
          {text !== null && mode !== 'hex' ? (
            <Button variant="ghost" onClick={() => copyText(text, 'Contents copied')} icon={<Copy size={12} strokeWidth={1.9} />}>
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
      <div className="mb-4 flex h-[68vh] min-h-[320px] flex-col overflow-hidden rounded-lg border border-line bg-sunken" data-testid={`viewer-${mode}`}>
        {error ? <div className="p-4 text-[12.5px] text-error">{error}</div> : null}
        {loading ? <LoadingState title="Fetching the object" rows={0} /> : null}
        {!loading && !error && (mode === 'code' || mode === 'hex') && text !== null ? (
          <YamlEditor key={`${file.key}:${wrap}`} value={text} language={mode === 'hex' ? 'plain' : language} wrap={wrap} testId="viewer-editor" />
        ) : null}
        {mode === 'svg' && text !== null ? (
          <div className="grid min-h-0 flex-1 grid-cols-2">
            <div className="flex items-center justify-center overflow-auto border-r border-line p-4">
              <img src={raw} alt={name} className="max-h-full max-w-full" />
            </div>
            <YamlEditor key={`${file.key}:svg:${wrap}`} value={text} language="xml" wrap={wrap} testId="viewer-editor" />
          </div>
        ) : null}
        {mode === 'image' ? (
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4" style={{ backgroundImage: 'linear-gradient(45deg, var(--surface-raised) 25%, transparent 25%), linear-gradient(-45deg, var(--surface-raised) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--surface-raised) 75%), linear-gradient(-45deg, transparent 75%, var(--surface-raised) 75%)', backgroundSize: '20px 20px', backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0' }}>
            <img src={raw} alt={name} className="max-h-full max-w-full rounded-md shadow-[var(--shadow-lg)]" />
          </div>
        ) : null}
        {mode === 'pdf' ? <iframe title={name} src={`${raw}#toolbar=1`} className="min-h-0 flex-1 border-0 bg-white" /> : null}
        {mode === 'video' ? <video controls src={raw} className="min-h-0 flex-1 bg-black" /> : null}
        {mode === 'audio' ? (
          <div className="flex flex-1 items-center justify-center p-8">
            <audio controls src={raw} className="w-full max-w-[560px]" />
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
