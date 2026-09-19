import { createHash, createHmac } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import http from 'node:http';
import https from 'node:https';

/**
 * Enough S3 to browse a bucket, signed the way AWS wants it (SigV4), with no
 * SDK. Works against MinIO, RustFS, SeaweedFS, Garage, Ceph RGW, LocalStack
 * and S3 itself: path-style for the ones that need it, virtual-host for AWS.
 */

export interface S3Config {
  readonly endpoint: string;
  readonly region: string;
  readonly accessKey: string;
  readonly secretKey: string;
  readonly pathStyle: boolean;
  readonly sessionToken?: string | undefined;
}

export interface S3Object {
  readonly key: string;
  readonly size: number;
  readonly lastModified: string;
  readonly etag: string;
  readonly storageClass?: string | undefined;
}

export class S3Error extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'S3Error';
    this.status = status;
  }
}

const sha256 = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string): Buffer => createHmac('sha256', key).update(data, 'utf8').digest();

/** RFC 3986 encoding, the way S3 canonicalises paths and query strings. */
function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}
function encodePath(path: string): string {
  return path.split('/').map(encodeRfc3986).join('/');
}

function amzDate(date: Date): { long: string; short: string } {
  const long = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { long, short: long.slice(0, 8) };
}

export function s3Url(config: S3Config, bucket?: string, key?: string): URL {
  const base = new URL(config.endpoint.replace(/\/+$/, ''));
  if (bucket && !config.pathStyle) base.host = `${bucket}.${base.host}`;
  const parts = [config.pathStyle && bucket ? bucket : '', key ?? ''].filter((p) => p !== '');
  base.pathname = `/${parts.map(encodePath).join('/')}`.replace(/\/+/g, '/');
  return base;
}

interface SignInput {
  readonly method: string;
  readonly url: URL;
  readonly headers: Record<string, string>;
  readonly payloadHash: string;
  readonly now?: Date;
}

/** Returns the headers to send, Authorization included. */
export function signHeaders(config: S3Config, input: SignInput): Record<string, string> {
  const { long, short } = amzDate(input.now ?? new Date());
  const headers: Record<string, string> = {
    ...input.headers,
    host: input.url.host,
    'x-amz-date': long,
    'x-amz-content-sha256': input.payloadHash,
    ...(config.sessionToken ? { 'x-amz-security-token': config.sessionToken } : {}),
  };
  const canonicalHeaders = Object.entries(headers)
    .map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, ' ')] as const)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  const signedHeaders = canonicalHeaders.map(([k]) => k).join(';');
  const canonicalQuery = [...input.url.searchParams.entries()]
    .map(([k, v]) => [encodeRfc3986(k), encodeRfc3986(v)] as const)
    .sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const canonicalRequest = [input.method, input.url.pathname, canonicalQuery, canonicalHeaders.map(([k, v]) => `${k}:${v}`).join('\n') + '\n', signedHeaders, input.payloadHash].join('\n');
  const scope = `${short}/${config.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', long, scope, sha256(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.secretKey}`, short), config.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
  return { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` };
}

/** A URL anyone can use for `expires` seconds, signed in the query string. */
export function presign(config: S3Config, method: string, bucket: string, key: string, expires: number, now = new Date()): string {
  const url = s3Url(config, bucket, key);
  const { long, short } = amzDate(now);
  const scope = `${short}/${config.region}/s3/aws4_request`;
  url.searchParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256');
  url.searchParams.set('X-Amz-Credential', `${config.accessKey}/${scope}`);
  url.searchParams.set('X-Amz-Date', long);
  url.searchParams.set('X-Amz-Expires', String(expires));
  url.searchParams.set('X-Amz-SignedHeaders', 'host');
  if (config.sessionToken) url.searchParams.set('X-Amz-Security-Token', config.sessionToken);
  const canonicalQuery = [...url.searchParams.entries()]
    .map(([k, v]) => [encodeRfc3986(k), encodeRfc3986(v)] as const)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const canonicalRequest = [method, url.pathname, canonicalQuery, `host:${url.host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', long, scope, sha256(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.secretKey}`, short), config.region), 's3'), 'aws4_request');
  url.searchParams.set('X-Amz-Signature', createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex'));
  return url.toString();
}

function request(url: URL, method: string, headers: Record<string, string>, body?: Buffer): Promise<IncomingMessage> {
  const lib = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(url, { method, headers: { ...headers, ...(body ? { 'content-length': String(body.length) } : {}) } }, resolve);
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function readAll(stream: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

/**
 * XML entities, including the numeric ones.
 *
 * MinIO escapes the quotes around an ETag as `&#34;` rather than `&quot;`,
 * which is equally valid XML and came out the other side as the literal text
 * "&#34;abc&#34;" in the ETag column. `&amp;` is decoded last, so an escaped
 * ampersand cannot turn its neighbours into entities on the way through.
 */
const unescapeXml = (text: string): string =>
  text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
const tagValue = (xml: string, name: string): string | undefined => {
  const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml);
  return match?.[1] === undefined ? undefined : unescapeXml(match[1]);
};
const blocks = (xml: string, name: string): string[] => [...xml.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'g'))].map((m) => m[1] ?? '');

async function fail(response: IncomingMessage): Promise<never> {
  const text = (await readAll(response)).toString('utf8');
  const message = tagValue(text, 'Message') ?? tagValue(text, 'Code') ?? text.slice(0, 200) ?? '';
  throw new S3Error(response.statusCode ?? 0, message || `S3 responded ${response.statusCode}`);
}

export class S3Client {
  readonly config: S3Config;

  constructor(config: S3Config) {
    this.config = config;
  }

  async #call(method: string, url: URL, headers: Record<string, string> = {}, body?: Buffer): Promise<IncomingMessage> {
    const payloadHash = body ? sha256(body) : sha256('');
    const signed = signHeaders(this.config, { method, url, headers, payloadHash });
    const response = await request(url, method, signed, body);
    if ((response.statusCode ?? 0) >= 400) await fail(response);
    return response;
  }

  async listBuckets(): Promise<Array<{ name: string; created: string }>> {
    const xml = (await readAll(await this.#call('GET', s3Url(this.config)))).toString('utf8');
    return blocks(xml, 'Bucket').map((b) => ({ name: tagValue(b, 'Name') ?? '', created: tagValue(b, 'CreationDate') ?? '' }));
  }

  async listObjects(bucket: string, prefix: string, token?: string): Promise<{ objects: S3Object[]; prefixes: string[]; next?: string | undefined }> {
    const url = s3Url(this.config, bucket);
    url.searchParams.set('list-type', '2');
    url.searchParams.set('delimiter', '/');
    url.searchParams.set('max-keys', '500');
    if (prefix) url.searchParams.set('prefix', prefix);
    if (token) url.searchParams.set('continuation-token', token);
    const xml = (await readAll(await this.#call('GET', url))).toString('utf8');
    return {
      objects: blocks(xml, 'Contents').map((c) => ({
        key: tagValue(c, 'Key') ?? '',
        size: Number(tagValue(c, 'Size') ?? 0),
        lastModified: tagValue(c, 'LastModified') ?? '',
        etag: (tagValue(c, 'ETag') ?? '').replace(/"/g, ''),
        storageClass: tagValue(c, 'StorageClass'),
      })),
      prefixes: blocks(xml, 'CommonPrefixes').map((p) => tagValue(p, 'Prefix') ?? ''),
      next: tagValue(xml, 'IsTruncated') === 'true' ? tagValue(xml, 'NextContinuationToken') : undefined,
    };
  }

  async getObject(bucket: string, key: string, range?: string): Promise<IncomingMessage> {
    return this.#call('GET', s3Url(this.config, bucket, key), range ? { range } : {});
  }

  async headObject(bucket: string, key: string): Promise<{ size: number; type: string; lastModified: string }> {
    const response = await this.#call('HEAD', s3Url(this.config, bucket, key));
    response.resume();
    return { size: Number(response.headers['content-length'] ?? 0), type: String(response.headers['content-type'] ?? 'application/octet-stream'), lastModified: String(response.headers['last-modified'] ?? '') };
  }

  async putObject(bucket: string, key: string, body: Buffer, contentType: string): Promise<void> {
    (await this.#call('PUT', s3Url(this.config, bucket, key), { 'content-type': contentType }, body)).resume();
  }

  async deleteObject(bucket: string, key: string): Promise<void> {
    (await this.#call('DELETE', s3Url(this.config, bucket, key))).resume();
  }

  async createBucket(bucket: string): Promise<void> {
    (await this.#call('PUT', s3Url(this.config, bucket))).resume();
  }

  presign(bucket: string, key: string, expires: number): string {
    return presign(this.config, 'GET', bucket, key, expires);
  }
}
